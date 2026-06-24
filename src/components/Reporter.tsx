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
import { db, incrementReportsCount, rewardImpactPoints } from "../lib/firebase";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  increment,
} from "firebase/firestore";
import { TriageResult, CivicIssue } from "../types";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

interface ReporterProps {
  onSuccess: (newIssue: any) => void;
  currentUser: any;
}

export default function Reporter({ onSuccess, currentUser }: ReporterProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    address?: string;
    ward?: string;
  } | null>(null);
  const [locatingState, setLocatingState] = useState<
    "idle" | "tracking" | "success" | "failed"
  >("idle");
  const [geolocError, setGeolocError] = useState<string | null>(null);

  const geocodingLib = useMapsLibrary("geocoding");
  const placesLib = useMapsLibrary("places");

  const [isTriaging, setIsTriaging] = useState<boolean>(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageOutput, setTriageOutput] = useState<{
    triage: TriageResult;
    status: string;
    isCorroborated: boolean;
    corroboratedGroupId: string | null;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestLocation();
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
            let address = result.results[0].formatted_address;
            let ward = "";
            const sublocality = result.results[0].address_components.find(c => c.types.includes("sublocality") || c.types.includes("neighborhood"));
            if (sublocality) {
              ward = sublocality.short_name;
            } else {
              const locality = result.results[0].address_components.find(c => c.types.includes("locality"));
              if (locality) ward = locality.short_name;
            }
            setLocation(prev => prev ? { ...prev, address, ward } : prev);
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
        let address = "";
        let ward = "";
        if (geocodingLib) {
          const geocoder = new geocodingLib.Geocoder();
          try {
            const result = await geocoder.geocode({
              location: { lat: position.coords.latitude, lng: position.coords.longitude },
            });
            if (result.results[0]) {
              address = result.results[0].formatted_address;
              // Simple extraction of a neighborhood/sublocality for ward
              const sublocality = result.results[0].address_components.find(c => c.types.includes("sublocality") || c.types.includes("neighborhood"));
              if (sublocality) {
                ward = sublocality.short_name;
              } else {
                const locality = result.results[0].address_components.find(c => c.types.includes("locality"));
                if (locality) ward = locality.short_name;
              }
            }
          } catch (e) {
            console.error("Geocoding failed", e);
          }
        }
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          address,
          ward,
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
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setIsCapturing(false);
      setTriageError("Camera error. Please upload a file.");
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setTriageOutput(null);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
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

      const [triageData, descData] = await Promise.all([
        triagePromise,
        descPromise,
      ]);

      if (triageData.error) throw new Error(triageData.error);

      clearInterval(interval);
      setTriageStep(5);
      setTriageOutput(triageData);
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
    setIsSubmitting(true);
    try {
      if (triageOutput.isCorroborated && triageOutput.targetIssueId) {
        // Merge into existing cluster
        const issueRef = doc(db, "issues", triageOutput.targetIssueId);
        await updateDoc(issueRef, {
          duplicateCount: increment(1),
        });
      } else {
        // Create new report
        const issueData: Omit<CivicIssue, "id"> = {
          imageUrl: imagePreview || "",
          category: triageOutput?.triage?.category || "Other",
          severityScore: triageOutput?.triage?.severityScore ?? 5,
          confidencePercentage:
            triageOutput?.triage?.confidencePercentage ?? 50,
          recommendedDepartment:
            triageOutput?.triage?.recommendedDepartment || "General Operations",
          description: editedDescription || "Reported civic issue.",
          priorityTier: triageOutput?.triage?.priorityTier || "P3",
          slaTargetHours: triageOutput?.triage?.slaTargetHours || 72,
          duplicateCount: 1,
          ...location,
          reportedByUid: currentUser.uid,
          reportedByName: currentUser.displayName || "Civic Hero",
          reportedAt: Date.now(),
          status: triageOutput.status as any,
          upvotesCount: 0,
          isCorroborated: false,
          corroboratedGroupId: null,
        };
        const docRef = await addDoc(collection(db, "issues"), issueData);
        onSuccess({ id: docRef.id, ...issueData });
      }

      await rewardImpactPoints(currentUser.uid, 10);
      await incrementReportsCount(currentUser.uid);
      setIsDone(true);

      setTimeout(resetForm, 4000);
    } catch (err: any) {
      setTriageError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setImagePreview(null);
    setTriageOutput(null);
    setTriageError(null);
    setIsDone(false);
    stopCamera();
  };

  return (
    <div className="glass-card rounded-3xl overflow-hidden max-w-2xl mx-auto mt-2">
      <div className="p-6 border-b border-[#E5E5E5] dark:border-gray-800 flex justify-between items-center bg-white/50 dark:bg-gray-900/50">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A] dark:text-white">
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

      <div className="p-6 md:p-8 space-y-6">
        {geolocError && (
          <div className="text-xs text-semantic-danger p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
            {geolocError}
          </div>
        )}

        {!imagePreview && !isCapturing && (
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={startCamera}
              className="border border-[#E5E5E5] dark:border-gray-700 hover:border-primary dark:hover:border-primary rounded-3xl p-8 flex flex-col items-center justify-center transition-colors text-[#1A1A1A] dark:text-white bg-gray-50/50 dark:bg-gray-800/50 cursor-pointer"
            >
              <Camera className="w-8 h-8 mb-3 text-primary" />
              <span className="font-semibold text-sm">Open Camera</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="border border-[#E5E5E5] dark:border-gray-700 hover:border-primary dark:hover:border-primary rounded-3xl p-8 flex flex-col items-center justify-center transition-colors text-[#1A1A1A] dark:text-white bg-gray-50/50 dark:bg-gray-800/50 cursor-pointer"
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
            <h3 className="text-xl font-light tracking-tight text-[#1A1A1A] dark:text-white">
              Report Logged
            </h3>
            <p className="text-[#10B981] text-xs font-bold uppercase tracking-widest mt-2">
              +10 Civic Points
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
