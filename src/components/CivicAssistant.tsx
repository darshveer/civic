import React, { useState, useEffect, useRef } from "react";
import { T } from "../lib/translate";
import {
  MessageSquare,
  X,
  Send,
  Bot,
  User,
  Loader2,
  Globe,
  MapPin,
  Check,
  Camera,
  Upload,
  Sparkles,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { User as FirebaseUser } from "firebase/auth";
import { addDoc, doc, updateDoc, collection } from "firebase/firestore";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import { db, setCitizenPhone } from "../lib/firebase";
import { loadWardsConfig, zoneForWard } from "../lib/roles";
import { resolveZoneAuthoritative } from "../lib/cityZones";
import { wardZoneAtPoint } from "../lib/wardLookup";
import { CivicCategory, CivicIssue, CivicStatus, CitizenProfile } from "../types";
import { aiLanguageName } from "../i18n";
import { homeCoords, haversineMeters } from "../lib/civic";
import { searchPlaces, reverseGeocode, GeoResult } from "../lib/geocode";

const MAPS_KEY =
  (process.env as any).GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

interface PickedLocation {
  lat: number;
  lng: number;
  address: string;
  ward: string;
  city: string;
  state: string;
}

/** Keeps the map centred on the current pin. */
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (map) map.panTo({ lat, lng });
  }, [map, lat, lng]);
  return null;
}

function LocationPickerInner({
  lat,
  lng,
  onPick,
}: {
  lat: number;
  lng: number;
  onPick: (p: PickedLocation) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);

  // Debounced free place search (Photon — keyless, no Google billing).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(q, ctrl.signal);
        setResults(r);
        setOpen(true);
      } catch (e) {
        if ((e as any)?.name !== "AbortError") setResults([]);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  // Drop the pin immediately, then enrich with a reverse-geocoded address.
  const reverseAndPick = async (la: number, ln: number) => {
    onPick({
      lat: la,
      lng: ln,
      address: `${la.toFixed(5)}, ${ln.toFixed(5)}`,
      ward: "",
      city: "",
      state: "",
    });
    try {
      const geo = await reverseGeocode(la, ln);
      if (geo) onPick(geo);
    } catch {
      /* keep coords if reverse lookup fails */
    }
  };

  const pick = (r: GeoResult) => {
    onPick(r);
    setQuery(r.address);
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search address or place…"
          className="w-full text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
        />
        {open && results.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-40 overflow-y-auto no-scrollbar">
            {results.map((r, idx) => (
              <button
                key={idx}
                onClick={() => pick(r)}
                className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0 flex items-start gap-1.5"
              >
                <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                <span className="truncate">{r.address}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="h-40 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        <GoogleMap
          defaultCenter={{ lat, lng }}
          defaultZoom={16}
          mapId="DEMO_MAP_ID"
          disableDefaultUI
          gestureHandling="greedy"
          onClick={(e) =>
            e.detail.latLng &&
            reverseAndPick(e.detail.latLng.lat, e.detail.latLng.lng)
          }
        >
          <MapRecenter lat={lat} lng={lng} />
          <AdvancedMarker
            position={{ lat, lng }}
            draggable
            onDragEnd={(e) =>
              e.latLng && reverseAndPick(e.latLng.lat(), e.latLng.lng())
            }
          >
            <Pin background="#2F6F6A" borderColor="#1C2B2A" glyphColor="#fff" />
          </AdvancedMarker>
        </GoogleMap>
      </div>
      <button
        type="button"
        onClick={() =>
          navigator.geolocation?.getCurrentPosition((p) =>
            reverseAndPick(p.coords.latitude, p.coords.longitude),
          )
        }
        className="text-[10px] flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold uppercase tracking-wider border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
      >
        <MapPin className="w-3 h-3" /> Use my GPS
      </button>
    </div>
  );
}

/** Searchable + draggable map location picker (drops the map until expanded). */
function ChatLocationPicker(props: {
  lat: number;
  lng: number;
  onPick: (p: PickedLocation) => void;
}) {
  if (!MAPS_KEY) {
    return (
      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        <T>Map unavailable (no Maps key) — the report uses your current location.</T>
      </p>
    );
  }
  return (
    <APIProvider apiKey={MAPS_KEY}>
      <LocationPickerInner {...props} />
    </APIProvider>
  );
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  reportId?: string; // when set, render a rich detail card for this report
}

/** Inline markdown: **bold**, *italic*, `code`. */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined) nodes.push(<em key={key++}>{m[2]}</em>);
    else if (m[3] !== undefined)
      nodes.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[11px]"
        >
          {m[3]}
        </code>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Tiny dependency-free markdown: paragraphs + bullet/numbered lists + inline. */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const bullet = /^\s*[-*•]\s+(.*)/.exec(lines[i]);
    const numbered = /^\s*\d+[.)]\s+(.*)/.exec(lines[i]);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const b = /^\s*[-*•]\s+(.*)/.exec(lines[i]);
        if (!b) break;
        items.push(b[1]);
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-4 space-y-0.5 my-1">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (numbered) {
      const items: string[] = [];
      while (i < lines.length) {
        const n = /^\s*\d+[.)]\s+(.*)/.exec(lines[i]);
        if (!n) break;
        items.push(n[1]);
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-4 space-y-0.5 my-1">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    blocks.push(
      <p key={key++} className="my-0.5">
        {renderInline(lines[i])}
      </p>,
    );
    i++;
  }
  return <>{blocks}</>;
}

const statusBadgeClass = (status: string): string => {
  if (status === "Resolved" || status === "Staff Verified")
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (status === "In Progress")
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (status === "Flagged for Review")
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  if (
    status === "Community Verified" ||
    status === "Corroborated Report" ||
    status === "Auto-Routed"
  )
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
};

/** Rich detail card for one of the user's reports. */
function ReportCard({ issue }: { issue: CivicIssue }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {issue.imageUrl && (
        <img
          src={issue.imageUrl}
          alt={issue.category}
          className="w-full h-28 object-cover"
        />
      )}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            {issue.category}
          </span>
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusBadgeClass(issue.status)}`}
          >
            {issue.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {issue.priorityTier && (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 font-bold text-gray-700 dark:text-gray-300">
              {issue.priorityTier} · {issue.slaTargetHours || 72}h SLA
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 font-bold text-gray-700 dark:text-gray-300">
            Severity {issue.severityScore}/10
          </span>
          {(issue.upvotesCount || 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 font-bold text-gray-700 dark:text-gray-300">
              ▲ {issue.upvotesCount}
            </span>
          )}
        </div>
        {(issue.ward || issue.address) && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {[issue.ward, issue.city].filter(Boolean).join(", ") ||
              issue.address}
          </p>
        )}
        {issue.description && (
          <p className="text-[11px] text-gray-700 dark:text-gray-300 leading-snug">
            {issue.description}
          </p>
        )}
        <p className="text-[9px] text-gray-400 dark:text-gray-500">
          Reported {new Date(issue.reportedAt).toLocaleDateString()} · routed to{" "}
          {issue.recommendedDepartment || "General Operations"}
        </p>
      </div>
    </div>
  );
}

/**
 * The guided in-chat reporting flow. The agent only signals intent
 * ("collect_photo"); all report DETAILS come from running the real triage
 * pipeline on the user's photo — never fabricated by the chat model.
 */
type ReportFlow =
  | { stage: "photo"; category?: string }
  | { stage: "analyzing" }
  | {
      stage: "review";
      imageUrl: string;
      mimeType: string;
      category: CivicCategory;
      severity: number;
      confidence: number;
      recommendedDepartment: string;
      priorityTier: "P1" | "P2" | "P3" | "P4";
      slaTargetHours: number;
      urgencyReasoning: string;
      description: string; // editable
      locationText: string; // editable address
      latitude: number;
      longitude: number;
      // Resolved admin geography when the user sets a precise location on the
      // map (empty → submit falls back to nearest-report inference).
      ward: string;
      city: string;
      state: string;
      status: CivicStatus;
      matchedIssueId: string | null;
      corroboratedGroupId: string | null;
      forensicsFlagged: boolean;
      isAuthentic: boolean;
      fraudConfidenceScore: number;
      visualEvidenceTags: string[];
    }
  | null;

// Best-fit municipal department per category (fallback if triage omits one).
const DEPARTMENT_BY_CATEGORY: Record<string, string> = {
  Pothole: "Department of Transportation",
  "Water Leak": "Water & Sewage Authority",
  "Streetlight Out": "Electrical / Street Lighting",
  Vandalism: "Parks & Public Property",
  "Waste Issue": "Sanitation & Waste Management",
  Other: "General Operations",
};

interface CivicAssistantProps {
  currentUser: FirebaseUser | null;
  profile?: CitizenProfile | null;
  issues: CivicIssue[];
}

const LANGUAGES = [
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
];

export default function CivicAssistant({
  currentUser,
  profile,
  issues,
}: CivicAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  // Best-effort current location so the assistant can answer "near me" queries.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "model",
      text: "Hi! I am your Civic Assistant. How can I help you today?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [language, setLanguage] = useState(aiLanguageName());
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [reportFlow, setReportFlow] = useState<ReportFlow>(null);
  // AI-chat mobile-number capture: prompts when the profile has no number yet.
  const [localPhone, setLocalPhone] = useState<string>(profile?.phone || "");
  const [savingPhone, setSavingPhone] = useState(false);
  const hasPhone = Boolean(profile?.phone || localPhone);
  const saveChatPhone = async () => {
    if (!currentUser || !/^[+]?[0-9][0-9 ()-]{6,14}$/.test(localPhone.trim())) return;
    setSavingPhone(true);
    try {
      await setCitizenPhone(currentUser.uid, localPhone.trim());
    } catch (e) {
      console.error("Could not save phone:", e);
    } finally {
      setSavingPhone(false);
    }
  };
  const [submitting, setSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen, reportFlow]);

  // One-tap conversation starters.
  const SUGGESTIONS = [
    "Report a new issue",
    "How do I check my badges?",
    "What issues are near me?",
    "How do I earn more impact points?",
    "What's the status of my reports?",
  ];

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, text: m.text }));

      // Resolve a location (live GPS → fallback to the user's usual area) and
      // pre-compute nearby community issues so the assistant can answer
      // "what's near me?" without asking for an address.
      const here = coords || homeCoords(issues, currentUser?.uid);
      const nearbyIssues = here
        ? issues
            .map((i) => ({
              i,
              d: haversineMeters(here.lat, here.lng, i.latitude, i.longitude),
            }))
            .filter((x) => x.d <= 2000)
            .sort((a, b) => a.d - b.d)
            .slice(0, 15)
            .map(({ i, d }) => ({
              category: i.category,
              status: i.status,
              ward: i.ward,
              distance_m: Math.round(d),
              severity: i.severityScore,
            }))
        : [];

      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.text,
          history,
          language,
          userId: currentUser?.uid,
          location: here,
          nearbyIssues,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const reportId =
        data.action?.type === "show_report" ? data.action.reportId : undefined;
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "model", text: data.reply, reportId },
      ]);

      // The agent wants to file a NEW report → start the guided photo flow.
      // (No details are taken from the model; they come from triaging the photo.)
      if (data.action?.type === "collect_photo" && currentUser) {
        setReportFlow({ stage: "photo", category: data.action.category });
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "model",
          text: "Sorry, I encountered an error connecting to the civic servers.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);

  const botSay = (text: string) =>
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString() + Math.random().toString(36).slice(2, 6), role: "model", text },
    ]);

  // Resolve a usable location: live GPS → user's usual area → one fresh prompt.
  const ensureLocation = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (coords) return resolve(coords);
      const home = homeCoords(issues, currentUser?.uid);
      if (home) return resolve(home);
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(c);
          resolve(c);
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });

  const handlePhotoSelected = (file: File) => {
    const mimeType = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = () => analyzePhoto(reader.result as string, mimeType);
    reader.readAsDataURL(file);
  };

  // --- In-chat camera (live capture, like the Reporter) -------------------
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      cameraStreamRef.current = stream;
      setCameraOn(true);
      // Attach after the <video> mounts.
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 0);
    } catch (e) {
      console.error("Camera access failed:", e);
      botSay(
        "I couldn't open the camera — please allow camera access, or use Upload instead.",
      );
    }
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg");
    stopCamera();
    analyzePhoto(dataUrl, "image/jpeg");
  };

  // Stop the camera if the flow is cancelled or the window closes.
  useEffect(() => {
    if (!cameraOn) return;
    if (reportFlow?.stage !== "photo" || !isOpen) stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFlow, isOpen]);

  // Step 2 of the guided flow: run the REAL triage + smart-description + trust
  // pipeline (same endpoints as the Reporter) on the captured/uploaded image so
  // the draft is grounded in the actual photo, then show an editable review card.
  const analyzePhoto = async (imageUrl: string, mimeType: string) => {
    if (!currentUser) return;
    setReportFlow({ stage: "analyzing" });
    const here = await ensureLocation();
    if (!here) {
      botSay(
        "I need your location to file a report — please enable location access and try again, or use the Reporter tab.",
      );
      setReportFlow(null);
      return;
    }

    try {
      const [triageData, descData, verifyData] = await Promise.all([
        fetch("/api/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageUrl,
            mimeType,
            latitude: here.lat,
            longitude: here.lng,
          }),
        }).then((r) => r.json()),
        fetch("/api/smart-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageUrl,
            imageMimeType: mimeType,
            language,
          }),
        })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/reports/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageUrl,
            mimeType,
            latitude: here.lat,
            longitude: here.lng,
            reporterUid: currentUser.uid,
          }),
        })
          .then((r) => r.json())
          .catch(() => null),
      ]);

      if (!triageData || triageData.error) {
        throw new Error(triageData?.error || "Analysis failed.");
      }

      const t = triageData.triage;
      const flagged = verifyData?.forensics?.flagged ?? false;
      const matchedIssueId = verifyData?.consensus?.matchedIssueId ?? null;
      const corroboratedGroupId =
        verifyData?.consensus?.corroboratedGroupId ?? null;
      const communityVerified = !flagged && Boolean(matchedIssueId);
      const status: CivicStatus = flagged
        ? "Flagged for Review"
        : communityVerified
          ? "Community Verified"
          : "Pending Verification";

      setReportFlow({
        stage: "review",
        imageUrl,
        mimeType,
        category: t.category || "Other",
        severity: t.severityScore ?? 5,
        confidence: t.confidencePercentage ?? 50,
        recommendedDepartment:
          t.recommendedDepartment ||
          DEPARTMENT_BY_CATEGORY[t.category] ||
          "General Operations",
        priorityTier: t.priorityTier || "P3",
        slaTargetHours: t.slaTargetHours || 72,
        urgencyReasoning: t.urgencyReasoning || "",
        description: descData?.description || t.autoGeneratedDescription || "",
        locationText: "",
        latitude: here.lat,
        longitude: here.lng,
        ward: "",
        city: "",
        state: "",
        status,
        matchedIssueId,
        corroboratedGroupId,
        forensicsFlagged: flagged,
        isAuthentic: verifyData?.forensics?.isAuthentic ?? true,
        fraudConfidenceScore: verifyData?.forensics?.fraudConfidenceScore ?? 0,
        visualEvidenceTags: verifyData?.forensics?.visualEvidenceTags ?? [],
      });
    } catch (err) {
      console.error("Chat triage failed:", err);
      botSay(
        "Sorry — I couldn't analyse that photo just now. Please try again, or use the Reporter tab.",
      );
      setReportFlow(null);
    }
  };

  // Step 3: file the reviewed report to Firestore (same trust-track write as the
  // Reporter, including forensics fields and the Rule-A community dual-write).
  const submitReport = async () => {
    if (!currentUser || !reportFlow || reportFlow.stage !== "review") return;
    const f = reportFlow;
    setSubmitting(true);
    try {
      // Prefer the precise admin geography the user picked on the map; otherwise
      // borrow ward/city from the nearest existing report so staff scoping works.
      let nearestWard = f.ward || "";
      let nearestCity = f.city || "";
      let nearestState = f.state || "";
      if (!nearestWard) {
        let best = Infinity;
        for (const i of issues) {
          const d = haversineMeters(
            f.latitude,
            f.longitude,
            i.latitude,
            i.longitude,
          );
          if (d < best && d <= 800) {
            best = d;
            nearestWard = i.ward || "";
            nearestCity = i.city || "";
            nearestState = i.state || "";
          }
        }
      }
      const wards = await loadWardsConfig();
      const official = await wardZoneAtPoint(f.latitude, f.longitude);
      const officialWard = official?.ward || nearestWard;
      const zone =
        official?.zone ||
        resolveZoneAuthoritative(nearestCity, nearestWard) ||
        zoneForWard(nearestWard, wards) ||
        "";
      const communityVerified =
        !f.forensicsFlagged && Boolean(f.matchedIssueId);

      const issueData: Omit<CivicIssue, "id"> = {
        imageUrl: f.imageUrl,
        category: f.category,
        severityScore: f.severity,
        confidencePercentage: f.confidence,
        recommendedDepartment: f.recommendedDepartment,
        description: f.description || "Reported civic issue.",
        priorityTier: f.priorityTier,
        slaTargetHours: f.slaTargetHours,
        urgencyReasoning: f.urgencyReasoning,
        duplicateCount: 1,
        escalationLevel: 0,
        latitude: f.latitude,
        longitude: f.longitude,
        address: f.locationText || "",
        ward: officialWard,
        city: nearestCity,
        state: nearestState,
        zone,
        reportedByUid: currentUser.uid,
        reportedByName: currentUser.displayName || "Civic Hero",
        reportedByPhone: profile?.phone || localPhone.trim() || "",
        source: "citizen-photo",
        reportedAt: Date.now(),
        status: f.status,
        upvotesCount: 0,
        isCorroborated: communityVerified,
        corroboratedGroupId: communityVerified ? f.corroboratedGroupId : null,
        metadataMode: "Live-Fallback",
        metadataWarning: true,
        isAuthentic: f.isAuthentic,
        fraudConfidenceScore: f.fraudConfidenceScore,
        visualEvidenceTags: f.visualEvidenceTags,
      };
      await addDoc(collection(db, "issues"), issueData);

      // Rule A dual-write: promote the matched (other citizen's) report too.
      if (communityVerified && f.matchedIssueId) {
        try {
          await updateDoc(doc(db, "issues", f.matchedIssueId), {
            status: "Community Verified",
            isCorroborated: true,
            corroboratedGroupId: f.corroboratedGroupId ?? f.matchedIssueId,
          });
        } catch (e) {
          console.warn("Community-verification dual-write skipped:", e);
        }
      }

      setReportFlow(null);
      botSay(
        f.forensicsFlagged
          ? `I've logged your ${issueData.category} report, but the image authenticity check flagged it — staff will review it manually. Track it on the Map tab.`
          : communityVerified
            ? `✅ Filed your ${issueData.category} report (priority ${issueData.priorityTier}) — a nearby report corroborates it, so it's Community Verified! +10 Civic Points.`
            : `✅ Done! Filed your ${issueData.category} report (priority ${issueData.priorityTier}, routed to ${issueData.recommendedDepartment}). +10 Civic Points — track it on the Map tab.`,
      );
    } catch (err) {
      console.error("Chat report submission failed:", err);
      botSay(
        "Sorry — I couldn't file that report just now. Please try again, or use the Reporter tab.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating Chat Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-24 right-6 w-14 h-14 bg-primary text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 transition-transform z-50 ${isOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"}`}
      >
        <MessageSquare className="w-6 h-6" />
      </button>

      {/* Chat Window */}
      <div
        className={`fixed bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right z-50 ${
          fullscreen
            ? "inset-3 sm:inset-6 md:inset-y-10 md:inset-x-[12%] lg:inset-x-[20%] rounded-2xl"
            : "bottom-24 right-6 w-80 sm:w-96 rounded-3xl"
        } ${isOpen ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}
        style={
          fullscreen
            ? undefined
            : { height: "500px", maxHeight: "calc(100vh - 120px)" }
        }
      >
        {/* Header */}
        <div className="bg-primary p-4 flex items-center justify-between text-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm"><T>Civic Assistant</T></h3>
              <p className="text-[10px] opacity-80"><T>AI-Powered Support</T></p>
            </div>
          </div>
          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="p-1.5 hover:bg-white/20 rounded-full transition-colors relative"
              title="Change Language"
            >
              <Globe className="w-4 h-4" />
            </button>
            <button
              onClick={() => setFullscreen((v) => !v)}
              className="p-1.5 hover:bg-white/20 rounded-full transition-colors hidden sm:block"
              title={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Language Dropdown */}
            {isLangMenuOpen && (
              <div className="absolute top-10 right-8 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 w-32 z-50 max-h-48 overflow-y-auto no-scrollbar">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => {
                      setLanguage(lang);
                      setIsLangMenuOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${language === lang ? "font-bold text-primary" : ""}`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50 dark:bg-gray-900/50">
          {messages.map((msg) => {
            const cardIssue = msg.reportId
              ? issues.find((i) => i.id === msg.reportId)
              : undefined;
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300" : "bg-primary/10 text-primary"}`}
                >
                  {msg.role === "user" ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>
                <div
                  className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"} max-w-[80%]`}
                >
                  <div
                    className={`rounded-2xl px-4 py-2 text-sm shadow-sm ${msg.role === "user" ? "bg-primary text-white rounded-tr-none" : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-none border border-gray-100 dark:border-gray-700"}`}
                  >
                    {msg.role === "model" ? (
                      <MarkdownLite text={msg.text} />
                    ) : (
                      msg.text
                    )}
                  </div>
                  {cardIssue && (
                    <div className="w-full max-w-[16rem]">
                      <ReportCard issue={cardIssue} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-1">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Hidden upload input (gallery / file picker). Camera is separate. */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handlePhotoSelected(file);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />

        {/* AI-chat mobile-number capture (only when the profile lacks one) */}
        {reportFlow?.stage === "photo" && !hasPhone && (
          <div className="mx-3 mb-2 mt-1 rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1.5">
              <T>Add your mobile number</T>
            </p>
            <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2">
              <T>So municipal staff can call you back about this issue.</T>
            </p>
            <div className="flex gap-2">
              <input
                type="tel"
                inputMode="tel"
                value={localPhone}
                onChange={(e) => setLocalPhone(e.target.value)}
                placeholder="Mobile number"
                className="flex-1 min-w-0 text-xs px-3 py-2 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white outline-none focus:border-primary"
              />
              <button
                onClick={saveChatPhone}
                disabled={savingPhone || !/^[+]?[0-9][0-9 ()-]{6,14}$/.test(localPhone.trim())}
                className="shrink-0 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-full transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingPhone ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Guided reporting flow */}
        {reportFlow?.stage === "photo" && (
          <div className="mx-3 mb-2 mt-1 rounded-2xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-3 shrink-0 animate-in slide-in-from-bottom-2 duration-200">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">
              Step 1 · Add a photo
            </p>

            {cameraOn ? (
              <div className="space-y-2">
                <div className="relative rounded-xl overflow-hidden bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-44 object-cover"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={capturePhoto}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold uppercase tracking-wider py-2 rounded-full transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" /> Capture
                  </button>
                  <button
                    onClick={stopCamera}
                    className="px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-[11px] font-bold uppercase tracking-wider py-2 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <T>Cancel</T>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-gray-700 dark:text-gray-300 mb-2.5">
                  Share a clear photo of the{" "}
                  {reportFlow.category
                    ? reportFlow.category.toLowerCase()
                    : "issue"}{" "}
                  and I'll analyse it, draft the details, and confirm with you
                  before filing.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={startCamera}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold uppercase tracking-wider py-2 rounded-full transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" /> Take Photo
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-[11px] font-bold uppercase tracking-wider py-2 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                  <button
                    onClick={() => setReportFlow(null)}
                    className="px-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-[11px] font-bold uppercase tracking-wider py-2 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {reportFlow?.stage === "analyzing" && (
          <div className="mx-3 mb-2 mt-1 rounded-2xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-3 shrink-0 flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
            <p className="text-[11px] text-gray-700 dark:text-gray-300">
              Analysing your photo — categorising, scoring severity & checking
              authenticity…
            </p>
          </div>
        )}

        {reportFlow?.stage === "review" && (
          <div className="mx-3 mb-2 mt-1 rounded-2xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-3 shrink-0 animate-in slide-in-from-bottom-2 duration-200 max-h-[300px] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                Step 2 · Review & file
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                {reportFlow.priorityTier} · {reportFlow.slaTargetHours}h SLA
              </span>
            </div>
            <div className="flex gap-2.5">
              <img
                src={reportFlow.imageUrl}
                alt="Reported issue"
                className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-900 dark:text-white">
                  {reportFlow.category}{" "}
                  <span className="font-normal text-gray-500">
                    · severity {reportFlow.severity}/10
                  </span>
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                  {reportFlow.recommendedDepartment}
                </p>
                {reportFlow.urgencyReasoning && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 flex items-start gap-1">
                    <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
                    {reportFlow.urgencyReasoning}
                  </p>
                )}
              </div>
            </div>

            {reportFlow.forensicsFlagged && (
              <p className="mt-2 text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg px-2 py-1">
                ⚠️ Image authenticity check flagged this — it'll be queued for
                manual staff review.
              </p>
            )}

            <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-2.5 mb-1">
              <T>Description (editable)</T>
            </label>
            <textarea
              value={reportFlow.description}
              onChange={(e) =>
                setReportFlow({ ...reportFlow, description: e.target.value })
              }
              className="w-full text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 min-h-[60px] focus:ring-2 focus:ring-primary/20 outline-none text-gray-800 dark:text-gray-200"
            />

            <div className="flex items-center justify-between mt-2 mb-1">
              <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <T>Location</T>
              </label>
              <button
                onClick={() => setShowMap((v) => !v)}
                className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                <MapPin className="w-3 h-3" />
                {showMap ? "Hide map" : "Set on map"}
              </button>
            </div>
            <input
              type="text"
              value={reportFlow.locationText}
              onChange={(e) =>
                setReportFlow({ ...reportFlow, locationText: e.target.value })
              }
              placeholder="Street / landmark, or set it on the map"
              className="w-full text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-primary/20 outline-none text-gray-800 dark:text-gray-200"
            />
            {showMap ? (
              <div className="mt-2">
                <ChatLocationPicker
                  lat={reportFlow.latitude}
                  lng={reportFlow.longitude}
                  onPick={(p) =>
                    setReportFlow({
                      ...reportFlow,
                      latitude: p.lat,
                      longitude: p.lng,
                      locationText: p.address || reportFlow.locationText,
                      ward: p.ward,
                      city: p.city,
                      state: p.state,
                    })
                  }
                />
              </div>
            ) : (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />
                {reportFlow.ward || reportFlow.city
                  ? `Pinned: ${[reportFlow.ward, reportFlow.city].filter(Boolean).join(", ")}`
                  : "Pinned to your current location — tap “Set on map” to change."}
              </p>
            )}

            <div className="flex gap-2 mt-2.5">
              <button
                onClick={submitReport}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold uppercase tracking-wider py-2 rounded-full transition-colors disabled:opacity-60 cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {submitting ? "Filing…" : "Submit Report"}
              </button>
              <button
                onClick={() => {
                  setShowMap(false);
                  setReportFlow({
                    stage: "photo",
                    category: reportFlow.category,
                  });
                }}
                disabled={submitting}
                title="Use a different photo"
                className="px-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-[11px] font-bold uppercase tracking-wider py-2 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 cursor-pointer"
              >
                <T>Retake</T>
              </button>
              <button
                onClick={() => {
                  setShowMap(false);
                  setReportFlow(null);
                }}
                disabled={submitting}
                className="px-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-[11px] font-bold uppercase tracking-wider py-2 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 cursor-pointer"
              >
                <T>Cancel</T>
              </button>
            </div>
          </div>
        )}

        {/* Quick-reply suggestions */}
        <div className="px-3 pt-2 bg-white dark:bg-gray-900 shrink-0">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                disabled={isLoading}
                className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="p-3 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask about your reports..."
              className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-full pl-4 pr-12 py-3 text-sm focus:ring-2 focus:ring-primary/20 dark:text-white"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 p-2 bg-primary text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              {isLoading ? (
                <img src="/civic-logo.svg" className="w-4 h-4 animate-pulse brightness-0 invert" alt="Loading" />
              ) : (
                <Send className="w-4 h-4 ml-0.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
