/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import {
  Camera,
  Upload,
  MapPin,
  Sparkles,
  Check,
  Mic,
  StopCircle,
} from "lucide-react";
import ExifReader from "exifreader";
import { db } from "../lib/firebase";
import { loadWardsConfig, zoneForWard } from "../lib/roles";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { TriageResult, CivicIssue, MetadataMode } from "../types";
import { useMapsLibrary, Map as GoogleMap, AdvancedMarker, Pin, useMap } from "@vis.gl/react-google-maps";

interface ReporterProps {
  onSuccess: (newIssue: CivicIssue) => void;
  currentUser: User | null;
  isDarkMode?: boolean;
}

interface ParsedGeo {
  address: string;
  ward: string;
  city: string;
  state: string;
}

/** Extracts a usable address + administrative geography from a geocode result. */
function parseGeocode(result: google.maps.GeocoderResult): ParsedGeo {
  const find = (types: string[]) =>
    result.address_components.find((c) =>
      types.some((t) => c.types.includes(t)),
    );
  const ward =
    find(["sublocality", "neighborhood"])?.short_name ||
    find(["locality"])?.short_name ||
    "";
  const city =
    find(["locality", "administrative_area_level_2"])?.long_name || "";
  const state = find(["administrative_area_level_1"])?.long_name || "";
  return { address: result.formatted_address, ward, city, state };
}

/**
 * LAYER 1 — Parses embedded EXIF metadata from an image file binary.
 * Returns the original capture GPS coordinates and timestamp when the photo
 * carries them (location services were ON at capture), or null when the EXIF
 * GPS block is absent (e.g. location privacy was off, or the file was stripped).
 */
async function parseExifTelemetry(
  file: File,
): Promise<{ latitude: number; longitude: number; capturedAt: number | null } | null> {
  try {
    const buffer = await file.arrayBuffer();
    const tags = ExifReader.load(buffer, { expanded: true });
    const lat = tags.gps?.Latitude;
    const lng = tags.gps?.Longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;

    // DateTimeOriginal is "YYYY:MM:DD HH:MM:SS" — normalise to an epoch ms.
    let capturedAt: number | null = null;
    const original = tags.exif?.DateTimeOriginal?.description;
    if (typeof original === "string") {
      const iso = original.replace(
        /^(\d{4}):(\d{2}):(\d{2})/,
        "$1-$2-$3",
      );
      const parsed = Date.parse(iso);
      if (!Number.isNaN(parsed)) capturedAt = parsed;
    }
    return { latitude: lat, longitude: lng, capturedAt };
  } catch (e) {
    console.warn("EXIF parse failed; will fall back to live location.", e);
    return null;
  }
}

const API_KEY =
  (process.env as any).GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

function MapUpdater({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap("DEMO_MAP_ID");
  useEffect(() => {
    if (map) {
      map.panTo({ lat, lng });
    }
  }, [map, lat, lng]);
  return null;
}

function ReporterInner({ onSuccess, currentUser, isDarkMode }: ReporterProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    address?: string;
    ward?: string;
    city?: string;
    state?: string;
  } | null>(null);
  const [locatingState, setLocatingState] = useState<
    "idle" | "tracking" | "success" | "failed"
  >("idle");
  const [geolocError, setGeolocError] = useState<string | null>(null);

  type PermState = "unknown" | "granted" | "denied" | "prompt";
  const [cameraPermission, setCameraPermission] = useState<PermState>("unknown");
  const [locationPermission, setLocationPermission] =
    useState<PermState>("unknown");
  // Camera + geolocation only work in a secure context (https or localhost).
  const isSecureContext =
    typeof window === "undefined" ? true : window.isSecureContext;

  /**
   * Pre-warms the camera permission so the browser prompt appears up front.
   * Immediately stops the stream — we only want the grant, not a live feed.
   * (Safari needs a user gesture, so this is also wired to a button.)
   */
  const requestCameraAccess = async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPermission("denied");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      stream.getTracks().forEach((t) => t.stop());
      setCameraPermission("granted");
      return true;
    } catch (e) {
      setCameraPermission("denied");
      return false;
    }
  };

  // Request BOTH permissions up front, and re-trigger via the banner button.
  const requestAllPermissions = () => {
    requestLocation();
    requestCameraAccess();
  };

  const geocodingLib = useMapsLibrary("geocoding");
  const placesLib = useMapsLibrary("places");

  const [isTriaging, setIsTriaging] = useState<boolean>(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageOutput, setTriageOutput] = useState<{
    triage: TriageResult;
    status: string;
    isCorroborated: boolean;
    corroboratedGroupId: string | null;
    targetIssueId?: string | null;
  } | null>(null);

  // --- LAYER 1: Citizen telemetry (how the pin coordinates were sourced) ---
  const [metadataMode, setMetadataMode] = useState<MetadataMode | null>(null);
  const [captureTimestamp, setCaptureTimestamp] = useState<number | null>(null);

  // --- LAYER 2/3: Gemini forensics + spatial consensus result ---
  const [verifyOutput, setVerifyOutput] = useState<{
    forensics: {
      isAuthentic: boolean;
      fraudConfidenceScore: number;
      visualEvidenceTags: string[];
      flagged: boolean;
    };
    consensus: {
      communityVerified: boolean;
      matchedIssueId: string | null;
      corroboratedGroupId: string | null;
    };
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);
  const [wasDuplicate, setWasDuplicate] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Proactively ask for location AND camera as soon as the reporter opens.
    requestLocation();
    requestCameraAccess();

    // Reflect live permission state where the Permissions API is supported.
    const perms = navigator.permissions;
    if (perms?.query) {
      perms
        .query({ name: "geolocation" as PermissionName })
        .then((p) => {
          setLocationPermission(p.state as PermState);
          p.onchange = () => setLocationPermission(p.state as PermState);
        })
        .catch(() => {});
      perms
        .query({ name: "camera" as PermissionName })
        .then((p) => {
          setCameraPermission(p.state as PermState);
          p.onchange = () => setCameraPermission(p.state as PermState);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (geocodingLib && location && !location.address) {
      const fetchAddress = async () => {
        const geocoder = new geocodingLib.Geocoder();
        try {
          const result = await geocoder.geocode({
            location: { lat: location.latitude, lng: location.longitude },
          });
          if (result.results[0]) {
            const geo = parseGeocode(result.results[0]);
            setLocation((prev) => (prev ? { ...prev, ...geo } : prev));
          }
        } catch (e) {
          console.error("Geocoding fetch failed", e);
        }
      };
      fetchAddress();
    }
  }, [geocodingLib, location?.latitude, location?.longitude]);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocatingState("failed");
      setGeolocError("Geolocation not supported.");
      return;
    }
    setLocatingState("tracking");
    setGeolocError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        let geo: ParsedGeo = { address: "", ward: "", city: "", state: "" };
        if (geocodingLib) {
          const geocoder = new geocodingLib.Geocoder();
          try {
            const result = await geocoder.geocode({
              location: { lat: position.coords.latitude, lng: position.coords.longitude },
            });
            if (result.results[0]) geo = parseGeocode(result.results[0]);
          } catch (e) {
            console.error("Geocoding failed", e);
          }
        }
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          ...geo,
        });
        setLocatingState("success");
      },
      (error) => {
        setLocatingState("failed");
        setLocation({ latitude: 12.9716, longitude: 77.5946 });
        setGeolocError(
          "Location access denied. Defaulting to Bangalore city center.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const startCamera = async () => {
    setIsCapturing(true);
    setTriageOutput(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setCameraPermission("granted");
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setIsCapturing(false);
      setCameraPermission("denied");
      setTriageError(
        "Camera access was blocked. Allow camera in your browser's site settings, or upload a file instead.",
      );
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg");
        setImagePreview(dataUrl);
        // Canvas capture strips EXIF, so an in-app photo always uses the live
        // device location (Layer 1 fallback path).
        setMetadataMode("Live-Fallback");
        setCaptureTimestamp(null);
        setVerifyOutput(null);
        fetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) =>
            setSelectedFile(
              new File([blob], "capture.jpg", { type: "image/jpeg" }),
            ),
          );
      }
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setTriageOutput(null);
      setVerifyOutput(null);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);

      // LAYER 1: prefer the photo's ORIGINAL capture coordinates (EXIF) so the
      // map pin reflects where/when the issue was actually photographed — even
      // if the citizen uploads it later from a different place.
      const exif = await parseExifTelemetry(file);
      if (exif) {
        setMetadataMode("Historical-EXIF");
        setCaptureTimestamp(exif.capturedAt);
        // Setting location WITHOUT an address lets the geocoding effect reverse-
        // geocode the EXIF point into ward/city/state.
        setLocation({ latitude: exif.latitude, longitude: exif.longitude });
        setLocatingState("success");
        setGeolocError(null);
      } else {
        // No embedded GPS → fall back to the browser's live location.
        setMetadataMode("Live-Fallback");
        setCaptureTimestamp(null);
        if (!location) requestLocation();
      }
    }
  };

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceBase64, setVoiceBase64] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const [triageStep, setTriageStep] = useState<number>(0);
  const [editedDescription, setEditedDescription] = useState<string>("");
  const [language, setLanguage] = useState<string>("English");
  
  const [isLocationConfirmed, setIsLocationConfirmed] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const autocompleteInputRef = useRef<HTMLInputElement>(null);
  const [placeAutocomplete, setPlaceAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  const handleLocationChange = async (lat: number, lng: number) => {
    setIsLocationConfirmed(false);
    setLocationError(null);
    setLocation(prev => ({ latitude: lat, longitude: lng, address: "Fetching address...", ward: prev?.ward }));
    
    if (geocodingLib) {
      try {
        const geocoder = new geocodingLib.Geocoder();
        const result = await geocoder.geocode({ location: { lat, lng } });
        if (result.results[0]) {
          const geo = parseGeocode(result.results[0]);
          setLocation((prev) => (prev ? { ...prev, ...geo } : prev));
        } else {
          setLocation((prev) =>
            prev ? { ...prev, address: "Address not found for this location." } : prev,
          );
        }
      } catch (e) {
        console.error("Geocoding failed", e);
        setLocation((prev) =>
          prev ? { ...prev, address: "Network error: couldn't fetch address." } : prev,
        );
      }
    }
  };

  useEffect(() => {
    if (!placesLib || !autocompleteInputRef.current) return;
    const options = { fields: ["geometry", "name", "formatted_address"] };
    setPlaceAutocomplete(new placesLib.Autocomplete(autocompleteInputRef.current, options));
  }, [placesLib]);

  useEffect(() => {
    if (!placeAutocomplete) return;
    const listener = placeAutocomplete.addListener("place_changed", () => {
      const place = placeAutocomplete.getPlace();
      if (place.geometry?.location) {
        handleLocationChange(place.geometry.location.lat(), place.geometry.location.lng());
      } else {
        setLocationError("Please select a valid place from the dropdown or tap on the map.");
      }
    });
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [placeAutocomplete, geocodingLib]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        setVoiceBlob(audioBlob);
        const reader = new FileReader();
        reader.onload = () => setVoiceBase64(reader.result as string);
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const triggerAITriage = async () => {
    if (!imagePreview || !location) return;
    setIsTriaging(true);
    setTriageError(null);
    setTriageOutput(null);
    setTriageStep(0);
    setEditedDescription("");

    // Animate pipeline steps
    const interval = setInterval(() => {
      setTriageStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 1500);

    try {
      // Parallelize triage and smart description if voice is provided
      const triagePromise = fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imagePreview,
          mimeType: selectedFile?.type || "image/jpeg",
          ...location,
        }),
      }).then((res) => res.json());

      let descPromise = Promise.resolve(null);
      if (voiceBase64) {
        descPromise = fetch("/api/smart-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imagePreview,
            imageMimeType: selectedFile?.type || "image/jpeg",
            voice: voiceBase64,
            voiceMimeType: voiceBlob?.type || "audio/webm",
            language,
          }),
        }).then((res) => res.json());
      }

      // LAYER 2 + LAYER 3 (Rule A): run cognitive forensics + spatial consensus
      // in parallel with triage. Fails soft — a verify error must not block the
      // report (it just lands as "Pending Verification").
      const verifyPromise = fetch("/api/reports/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imagePreview,
          mimeType: selectedFile?.type || "image/jpeg",
          latitude: location.latitude,
          longitude: location.longitude,
          reporterUid: currentUser?.uid || null,
        }),
      })
        .then((res) => res.json())
        .catch(() => null);

      const [triageData, descData, verifyData] = await Promise.all([
        triagePromise,
        descPromise,
        verifyPromise,
      ]);

      if (triageData.error) throw new Error(triageData.error);

      clearInterval(interval);
      setTriageStep(5);
      setTriageOutput(triageData);
      if (verifyData && verifyData.success) {
        setVerifyOutput({
          forensics: verifyData.forensics,
          consensus: verifyData.consensus,
        });
      }
      setEditedDescription(
        descData?.description || triageData.triage.autoGeneratedDescription,
      );
    } catch (err: any) {
      clearInterval(interval);
      setTriageError(err.message || "Error occurred.");
    } finally {
      setIsTriaging(false);
    }
  };

  const submitIssueToFirestore = async () => {
    if (!currentUser) return setTriageError("Please sign in first.");
    if (!location || !triageOutput) return;
    if (!isLocationConfirmed) {
      setLocationError("Please confirm the incident location on the map.");
      return;
    }
    setIsSubmitting(true);
    try {
      // --- Resolve the Trust & Verification Engine outcome ----------------
      // A flagged image is parked for review; otherwise, if an independent
      // nearby report corroborates this one (Rule A — from forensics consensus,
      // or the triage 50m detector as a fallback when forensics was down), both
      // points become "Community Verified". Failing that, it enters the trust
      // track as "Pending Verification".
      const flagged = verifyOutput?.forensics.flagged ?? false;
      const matchedIssueId =
        verifyOutput?.consensus.matchedIssueId ??
        (triageOutput.isCorroborated ? triageOutput.targetIssueId ?? null : null);
      const corroboratedGroupId =
        verifyOutput?.consensus.corroboratedGroupId ??
        triageOutput.corroboratedGroupId ??
        null;
      const communityVerified = !flagged && Boolean(matchedIssueId);

      let trustStatus: CivicIssue["status"];
      if (flagged) trustStatus = "Flagged for Review";
      else if (communityVerified) trustStatus = "Community Verified";
      else trustStatus = "Pending Verification";

      // Stamp the zone from the ward→zone map so staff hierarchy scoping works.
      const wards = await loadWardsConfig();
      const zone = zoneForWard(location.ward, wards) || "";
      const issueData: Omit<CivicIssue, "id"> = {
        imageUrl: imagePreview || "",
        category: triageOutput.triage.category || "Other",
        severityScore: triageOutput.triage.severityScore ?? 5,
        confidencePercentage: triageOutput.triage.confidencePercentage ?? 50,
        recommendedDepartment:
          triageOutput.triage.recommendedDepartment || "General Operations",
        description: editedDescription || "Reported civic issue.",
        priorityTier: triageOutput.triage.priorityTier || "P3",
        slaTargetHours: triageOutput.triage.slaTargetHours || 72,
        ...(triageOutput.triage.urgencyReasoning
          ? { urgencyReasoning: triageOutput.triage.urgencyReasoning }
          : {}),
        duplicateCount: 1,
        escalationLevel: 0,
        ...location,
        zone,
        reportedByUid: currentUser.uid,
        reportedByName: currentUser.displayName || "Civic Hero",
        reportedAt: Date.now(),
        status: trustStatus,
        upvotesCount: 0,
        isCorroborated: communityVerified,
        corroboratedGroupId: communityVerified ? corroboratedGroupId : null,
        // LAYER 1 telemetry
        metadataMode: metadataMode ?? "Live-Fallback",
        metadataWarning: (metadataMode ?? "Live-Fallback") === "Live-Fallback",
        ...(captureTimestamp ? { captureTimestamp } : {}),
        // LAYER 2 forensics
        ...(verifyOutput
          ? {
              isAuthentic: verifyOutput.forensics.isAuthentic,
              fraudConfidenceScore: verifyOutput.forensics.fraudConfidenceScore,
              visualEvidenceTags: verifyOutput.forensics.visualEvidenceTags,
            }
          : {}),
      };
      const docRef = await addDoc(collection(db, "issues"), issueData);

      // RULE A dual-write: promote the matched (other citizen's) report too.
      // Authorized by the `isValidCommunityVerification()` Firestore rule. Wrapped
      // so a permission hiccup never fails the citizen's own submission.
      if (communityVerified && matchedIssueId) {
        try {
          await updateDoc(doc(db, "issues", matchedIssueId), {
            status: "Community Verified",
            isCorroborated: true,
            corroboratedGroupId: corroboratedGroupId ?? matchedIssueId,
          });
        } catch (e) {
          console.warn("Community-verification dual-write skipped:", e);
        }
      }

      setWasDuplicate(communityVerified);
      onSuccess({ id: docRef.id, ...issueData });

      setIsDone(true);
      setTimeout(resetForm, 4000);
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setImagePreview(null);
    setTriageOutput(null);
    setVerifyOutput(null);
    setMetadataMode(null);
    setCaptureTimestamp(null);
    setTriageError(null);
    setLocationError(null);
    setIsLocationConfirmed(false);
    setIsDone(false);
    setWasDuplicate(false);
    stopCamera();
  };

  const cameraReady = cameraPermission === "granted";
  const locationReady =
    locationPermission === "granted" || locatingState === "success";
  const showPermissionBanner =
    !isSecureContext || !cameraReady || !locationReady;

  return (
    // Vertically + horizontally centre the reporter card in the available space
    // (it previously hugged the top of the page).
    <div className="min-h-[72vh] flex items-center justify-center">
    <div className="glass-card rounded-3xl overflow-hidden max-w-2xl w-full mx-auto">
      <div className="p-4 sm:p-6 border-b border-[#E5E5E5] dark:border-gray-800 flex justify-between items-center gap-2 bg-white/50 dark:bg-gray-900/50">
        <div>
          <h2 className="text-2xl font-display font-bold tracking-tight text-[#1A1A1A] dark:text-white">
            Civic Reporter
          </h2>
          <p className="text-xs text-[#717171] dark:text-gray-400 mt-1">
            Capture visual evidence and submit.
          </p>
        </div>
        <div
          onClick={requestLocation}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer border border-[#E5E5E5] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#4A4A4A] dark:text-gray-300"
        >
          <MapPin className="w-3 h-3" />
          <span>
            {locatingState === "success" && location
              ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
              : "Locating..."}
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-6 md:p-8 space-y-6">
        {geolocError && (
          <div className="text-xs text-semantic-danger p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
            {geolocError}
          </div>
        )}

        {/* LAYER 1: telemetry-source indicator (EXIF vs live fallback). */}
        {imagePreview && metadataMode && (
          <div
            className={`flex items-start gap-2 text-[11px] p-2.5 rounded-xl border ${
              metadataMode === "Historical-EXIF"
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400"
            }`}
          >
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {metadataMode === "Historical-EXIF" ? (
                <>
                  <strong>Original capture location</strong> read from photo EXIF
                  {captureTimestamp
                    ? ` · taken ${new Date(captureTimestamp).toLocaleString()}`
                    : ""}
                  .
                </>
              ) : (
                <>
                  <strong>Live device location</strong> — this photo has no GPS
                  EXIF, so we used your current position.
                </>
              )}
            </span>
          </div>
        )}

        {showPermissionBanner && (
          <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20">
            {!isSecureContext ? (
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <strong>Camera & location need a secure connection.</strong>{" "}
                Open the app over <code>https</code> or{" "}
                <code>http://localhost:3000</code> (not a raw IP address) so your
                browser can grant these permissions.
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-1.5">
                    This report needs camera & location access
                  </p>
                  <div className="flex flex-wrap gap-3 text-[11px] font-semibold">
                    <span
                      className={`inline-flex items-center gap-1 ${locationReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Location {locationReady ? "granted ✓" : "needed"}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 ${cameraReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Camera {cameraReady ? "granted ✓" : "needed"}
                    </span>
                  </div>
                  {(cameraPermission === "denied" ||
                    locationPermission === "denied") && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1.5">
                      If you previously blocked access, enable it in your
                      browser's site settings (the 🔒 icon in the address bar),
                      then tap below.
                    </p>
                  )}
                </div>
                <button
                  onClick={requestAllPermissions}
                  className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 px-4 rounded-full uppercase tracking-wider transition-colors cursor-pointer min-h-[44px]"
                >
                  Enable Access
                </button>
              </div>
            )}
          </div>
        )}

        {!imagePreview && !isCapturing && (
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={startCamera}
              className="border border-[#E5E5E5] dark:border-gray-700 hover:border-primary dark:hover:border-primary rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center transition-colors text-[#1A1A1A] dark:text-white bg-gray-50/50 dark:bg-gray-800/50 cursor-pointer"
            >
              <Camera className="w-8 h-8 mb-3 text-primary" />
              <span className="font-semibold text-sm">Open Camera</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="border border-[#E5E5E5] dark:border-gray-700 hover:border-primary dark:hover:border-primary rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center transition-colors text-[#1A1A1A] dark:text-white bg-gray-50/50 dark:bg-gray-800/50 cursor-pointer"
            >
              <Upload className="w-8 h-8 mb-3 text-primary" />
              <span className="font-semibold text-sm">Upload Image</span>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
            </button>
          </div>
        )}

        {isCapturing && (
          <div className="relative rounded-3xl overflow-hidden bg-black shadow-xl border border-gray-800">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-80 object-cover opacity-90"
            />
            <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
              <button
                onClick={capturePhoto}
                className="px-6 py-3 bg-white dark:bg-gray-800 text-[#1A1A1A] dark:text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-[0_2px_4px_rgba(0,0,0,0.1)] dark:shadow-none cursor-pointer"
              >
                Snap Photo
              </button>
              <button
                onClick={stopCamera}
                className="px-6 py-3 bg-black/50 border border-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest backdrop-blur-md cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {imagePreview && !triageOutput && !isTriaging && (
          <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="relative rounded-3xl overflow-hidden border border-[#E5E5E5] dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-center py-4 px-2">
              <img
                src={imagePreview}
                className="max-h-72 object-contain rounded-2xl shadow-sm"
                alt="Preview"
              />
              <button
                onClick={resetForm}
                className="absolute top-4 right-4 px-4 py-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-[#E5E5E5] dark:border-gray-700 text-[10px] font-bold uppercase tracking-widest rounded-full shadow-sm text-[#1A1A1A] dark:text-white cursor-pointer"
              >
                Retake
              </button>
            </div>

            <div className="flex flex-col gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Add Voice Context (Optional)
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold transition-colors ${
                    isRecording
                      ? "bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800 animate-pulse"
                      : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800"
                  }`}
                >
                  {isRecording ? (
                    <StopCircle className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                  {isRecording
                    ? "Stop Recording"
                    : voiceBase64
                      ? "Re-record"
                      : "Record Audio"}
                </button>
                {voiceBase64 && !isRecording && (
                  <span className="text-xs text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Audio Saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-500">Language:</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 outline-none text-gray-700 dark:text-gray-300"
                >
                  {[
                    "English",
                    "Hindi",
                    "Bengali",
                    "Telugu",
                    "Marathi",
                    "Tamil",
                    "Urdu",
                    "Gujarati",
                    "Kannada",
                    "Odia",
                    "Malayalam",
                  ].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={triggerAITriage}
              disabled={!location}
              className="w-full py-4 px-6 bg-primary hover:bg-primary-dark text-white rounded-full font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Sparkles className="w-4 h-4" /> Analyze with AI
            </button>
          </div>
        )}

        {isTriaging && (
          <div className="p-8 space-y-6 bg-gray-50/50 dark:bg-gray-800/30 rounded-3xl border border-[#E5E5E5] dark:border-gray-700">
            <div className="flex items-center gap-3 mb-6">
              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                AI Agents Triaging...
              </p>
            </div>
            <div className="space-y-4">
              {[
                "Analyzing image visually...",
                "Categorizing & scoring severity...",
                "Routing to correct Department...",
                "Checking for duplicate reports (50m radius)...",
                "Scoring priority & SLA...",
              ].map((step, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 transition-opacity duration-500 ${triageStep >= idx ? "opacity-100" : "opacity-0"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${triageStep > idx ? "bg-semantic-success" : triageStep === idx ? "bg-primary animate-ping" : "bg-gray-300 dark:bg-gray-700"}`}
                  ></div>
                  <span
                    className={`text-xs ${triageStep > idx ? "text-gray-500 dark:text-gray-400 line-through" : triageStep === idx ? "text-gray-900 dark:text-white font-bold" : "text-gray-400 dark:text-gray-600"}`}
                  >
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {triageError && (
          <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl text-xs text-red-600 dark:text-red-400">
            <strong>Error:</strong> {triageError}{" "}
            <button
              onClick={resetForm}
              className="underline ml-2 font-bold focus:outline-none cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        {triageOutput && triageOutput.triage && !isTriaging && !isDone && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-3xl border border-[#E5E7EB] dark:border-gray-700 p-6 md:p-8 space-y-6 animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                Triage Complete
              </h3>
              <span className="text-[10px] bg-emerald-50 dark:bg-emerald-900/30 font-bold px-2.5 py-1 border border-emerald-200 dark:border-emerald-800/50 rounded-full text-emerald-700 dark:text-emerald-400">
                {triageOutput.triage.confidencePercentage}% Match
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 pb-4 border-b border-[#E5E7EB] dark:border-gray-700">
              <div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 tracking-widest">
                  Category
                </div>
                <div className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                  {triageOutput.triage.category}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 tracking-widest">
                  Priority
                </div>
                <div className="text-sm font-semibold text-[#1A1A1A] dark:text-white flex items-center gap-1">
                  {triageOutput.triage.priorityTier || "P3"}{" "}
                  <span className="text-[10px] text-gray-500 ml-1 font-normal">
                    ({triageOutput.triage.slaTargetHours || 72}h SLA)
                  </span>
                </div>
              </div>
            </div>

            {triageOutput.triage.urgencyReasoning && (
              <div className="-mt-2 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-2.5">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Ranked {triageOutput.triage.priorityTier || "P3"}:</strong>{" "}
                  {triageOutput.triage.urgencyReasoning}
                </span>
              </div>
            )}

            <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-[#E5E5E5] dark:border-gray-700 shadow-sm">
              <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 tracking-widest">
                Routing
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate pr-2">
                  {triageOutput.triage.recommendedDepartment}
                </span>
                <span className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800/50 shrink-0">
                  {triageOutput.status}
                </span>
              </div>
            </div>

            {/* LAYER 2/3: Trust & Verification verdict (forensics + consensus). */}
            {verifyOutput && (
              <div
                className={`p-4 rounded-2xl border shadow-sm ${
                  verifyOutput.forensics.flagged
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50"
                    : verifyOutput.consensus.communityVerified
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50"
                      : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-widest">
                    Trust & Verification
                  </span>
                  <span
                    className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase shrink-0 ${
                      verifyOutput.forensics.flagged
                        ? "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40"
                        : verifyOutput.consensus.communityVerified
                          ? "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40"
                          : "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800"
                    }`}
                  >
                    {verifyOutput.forensics.flagged
                      ? "Flagged for Review"
                      : verifyOutput.consensus.communityVerified
                        ? "Community Verified"
                        : "Pending Verification"}
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2">
                  {verifyOutput.forensics.flagged
                    ? `Image authenticity check failed (fraud score ${(verifyOutput.forensics.fraudConfidenceScore * 100).toFixed(0)}%). This report will be queued for staff review.`
                    : verifyOutput.consensus.communityVerified
                      ? "An independent nearby report corroborates this issue — auto-verified by the community."
                      : `Image authenticated (fraud score ${(verifyOutput.forensics.fraudConfidenceScore * 100).toFixed(0)}%). Awaiting corroboration.`}
                </p>
                {verifyOutput.forensics.visualEvidenceTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {verifyOutput.forensics.visualEvidenceTags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-2 tracking-widest">
                AI Smart Description (Editable)
              </div>
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                className="w-full text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 min-h-[80px] focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>

            <div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-2 tracking-widest">
                Confirm Location
              </div>
              <div className="flex flex-col gap-2 mb-3">
                <input
                  ref={autocompleteInputRef}
                  type="text"
                  placeholder="Search address or place"
                  className="w-full text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={requestLocation}
                  className="text-[10px] self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold uppercase tracking-widest cursor-pointer border border-[#E5E5E5] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#4A4A4A] dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <MapPin className="w-3 h-3" /> Use my GPS
                </button>
              </div>
              <div className="relative h-48 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 mb-3 shadow-sm">
                <GoogleMap
                  defaultCenter={{ lat: location.latitude, lng: location.longitude }}
                  defaultZoom={17}
                  disableDefaultUI={true}
                  mapId="DEMO_MAP_ID"
                  colorScheme={isDarkMode ? "DARK" : "LIGHT"}
                  onClick={(e) => {
                    if (e.detail.latLng) {
                      handleLocationChange(e.detail.latLng.lat, e.detail.latLng.lng);
                    }
                  }}
                >
                  <MapUpdater lat={location.latitude} lng={location.longitude} />
                  <AdvancedMarker
                    position={{ lat: location.latitude, lng: location.longitude }}
                    draggable={true}
                    onDragEnd={(e) => {
                      if (e.latLng) {
                        handleLocationChange(e.latLng.lat(), e.latLng.lng());
                      }
                    }}
                  >
                    <Pin background={"#2F6F6A"} borderColor={"#1C2B2A"} glyphColor={"#fff"} />
                  </AdvancedMarker>
                </GoogleMap>
              </div>
              
              <div className="flex flex-col gap-3">
                <p className="text-xs text-[#4A4A4A] dark:text-gray-300 bg-gray-100 dark:bg-gray-800 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 truncate">
                  {location.address || "Fetching address..."}
                </p>
                <button
                  onClick={() => setIsLocationConfirmed(true)}
                  className={`w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${
                    isLocationConfirmed
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                      : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 cursor-pointer"
                  }`}
                >
                  {isLocationConfirmed ? "Location Confirmed ✓" : "Confirm Pin"}
                </button>
                {locationError && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
                    <span aria-hidden="true">⚠️</span> Error: {locationError}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-4 flex gap-3">
              <button
                onClick={submitIssueToFirestore}
                disabled={isSubmitting}
                className="flex-1 bg-primary hover:bg-primary-dark text-white py-3.5 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
              >
                {isSubmitting ? "Registering..." : "Submit Report"}
              </button>
              <button
                onClick={resetForm}
                disabled={isSubmitting}
                className="px-6 bg-white dark:bg-gray-800 border border-[#E5E5E5] dark:border-gray-700 text-[#1A1A1A] dark:text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {isDone && (
          <div className="py-12 text-center flex flex-col items-center">
            <Check className="w-10 h-10 text-[#10B981] mb-4" />
            <h3 className="text-2xl font-display font-bold tracking-tight text-[#1A1A1A] dark:text-white">
              {wasDuplicate ? "Community Verified" : "Report Logged"}
            </h3>
            <p className="text-[#10B981] text-xs font-bold uppercase tracking-widest mt-2">
              {wasDuplicate
                ? "A nearby report corroborates yours — both verified"
                : "+10 Civic Points"}
            </p>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

import { APIProvider } from "@vis.gl/react-google-maps";

const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

export default function Reporter(props: ReporterProps) {
  return (
    <APIProvider apiKey={API_KEY || ""} version="weekly" libraries={["places", "geocoding"]}>
      {!hasValidKey ? (
        <div className="flex flex-col items-center justify-center p-6 text-center bg-gray-50 dark:bg-gray-800 rounded-2xl h-full">
          <p className="text-red-600 dark:text-red-400 font-bold mb-2">Maps API Key Missing</p>
          <p className="text-xs text-gray-500">
            Please add your GOOGLE_MAPS_PLATFORM_KEY to the environment secrets to enable location features.
          </p>
        </div>
      ) : (
        <ReporterInner {...props} />
      )}
    </APIProvider>
  );
}
