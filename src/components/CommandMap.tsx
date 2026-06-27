/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Navigation,
  MapPin,
  ThumbsUp,
  CheckCircle,
  X,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  FileText,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import { db, toggleUpvote, resolveIssue, corroborateAndApprove } from "../lib/firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import type { User } from "firebase/auth";
import { CivicIssue, UserScope } from "../types";
import { canActOnIssue } from "../lib/roles";
import { moderateComment } from "../lib/profanity";
import { petitionEligible, PETITION_THRESHOLD } from "../lib/civic";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { motion, AnimatePresence } from "motion/react";
import confetti from "canvas-confetti";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

interface CommandMapProps {
  issues: CivicIssue[];
  onSelectIssue?: (issue: CivicIssue) => void;
  currentUser: User | null;
  scope: UserScope;
  selectedIssueFromParent?: CivicIssue | null;
  isDarkMode?: boolean;
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";
const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

function PlacesContext({ location }: { location: { lat: number; lng: number } }) {
  const placesLib = useMapsLibrary("places");
  const [nearbyPlace, setNearbyPlace] = useState<string>("");

  useEffect(() => {
    if (!placesLib || !location) return;
    const fetchPlaces = async () => {
      try {
        const { places } = await placesLib.Place.searchNearby({
          locationRestriction: {
            center: location,
            radius: 100, // 100 meters
          },
          fields: ["displayName", "primaryTypeDisplayName"],
          maxResultCount: 1,
        });
        if (places && places.length > 0) {
          setNearbyPlace(places[0].displayName || "");
        } else {
          setNearbyPlace("");
        }
      } catch (err) {
        console.error("Failed to fetch nearby places", err);
      }
    };
    fetchPlaces();
  }, [placesLib, location.lat, location.lng]);

  if (!nearbyPlace) return null;

  return (
    <div className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full font-semibold mb-2 inline-flex items-center gap-1">
      <MapPin className="w-3 h-3" /> Near {nearbyPlace}
    </div>
  );
}

function CommentsSection({ selectedIssue, currentUser }: { selectedIssue: CivicIssue, currentUser: User | null }) {
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !currentUser) return;
    // Moderate: reject hate speech/slurs outright, mask ordinary profanity.
    const moderation = moderateComment(newComment.trim());
    if (!moderation.ok) {
      setErrorMsg(moderation.reason || "Please keep comments respectful.");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const issueRef = doc(db, "issues", selectedIssue.id);
      const comment = {
        id: Math.random().toString(36).substring(2, 9),
        authorUid: currentUser.uid,
        authorName: currentUser.displayName || "Civic Hero",
        text: moderation.text,
        createdAt: Date.now(),
      };
      
      // arrayUnion appends atomically so concurrent commenters don't clobber
      // each other (and only the `comments` field changes, satisfying the rules).
      await updateDoc(issueRef, { comments: arrayUnion(comment) });
      setNewComment("");
    } catch (err: any) {
      console.error("Failed to add comment:", err);
      setErrorMsg("Failed to add comment.");
    }
    setIsSubmitting(false);
  };

  return (
    <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-6">
      <h4 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-primary" />
        Comments ({selectedIssue.comments?.length || 0})
      </h4>
      {errorMsg && (
        <div className="p-3 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs rounded-xl mb-4">
          {errorMsg}
        </div>
      )}
      <div className="space-y-4 mb-4 max-h-48 overflow-y-auto no-scrollbar">
        {selectedIssue.comments?.map(comment => (
          <div key={comment.id} className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-2xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-gray-900 dark:text-white">{comment.authorName}</span>
              <span className="text-[10px] text-gray-500">{new Date(comment.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300">{comment.text}</p>
          </div>
        ))}
      </div>
      {currentUser && (
        <form onSubmit={handleAddComment} className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 text-xs px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full outline-none focus:border-primary text-gray-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={isSubmitting || !newComment.trim()}
            className="px-4 bg-primary text-white text-[10px] font-bold uppercase tracking-widest rounded-full hover:bg-primary-dark disabled:opacity-50"
          >
            Post
          </button>
        </form>
      )}
    </div>
  );
}

function PetitionSection({
  issue,
  currentUser,
}: {
  issue: CivicIssue;
  currentUser: User | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = (issue.upvotesCount || 0) + ((issue.duplicateCount || 1) - 1);
  const petition = issue.petition;
  const signed = Boolean(
    petition?.signatures?.includes(currentUser?.uid || ""),
  );

  const draft = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/draft-petition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue }),
      });
      const data = await res.json();
      if (!res.ok || !data.petition) throw new Error(data.error || "Draft failed.");
      const newPetition = {
        ...data.petition,
        draftedAt: Date.now(),
        draftedByUid: currentUser.uid,
        signatures: [currentUser.uid],
      };
      await updateDoc(doc(db, "issues", issue.id), { petition: newPetition });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft the petition.");
    } finally {
      setLoading(false);
    }
  };

  const sign = async () => {
    if (!currentUser) return;
    setError(null);
    try {
      await updateDoc(doc(db, "issues", issue.id), {
        "petition.signatures": arrayUnion(currentUser.uid),
      });
    } catch {
      setError("Couldn't add your signature.");
    }
  };

  return (
    <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-6">
      <h4 className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest mb-4 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Civic Petition
      </h4>

      {petition ? (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 space-y-3">
          <p className="font-bold text-gray-900 dark:text-white text-sm">
            {petition.title}
          </p>
          <p className="text-[10px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400">
            To: {petition.addressedTo}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto no-scrollbar">
            {petition.body}
          </p>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
              {petition.signatures?.length || 0} signature
              {(petition.signatures?.length || 0) === 1 ? "" : "s"}
            </span>
            {signed ? (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Signed
              </span>
            ) : (
              <button
                onClick={sign}
                disabled={!currentUser}
                className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <PenLine className="w-3.5 h-3.5" /> Sign petition
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl p-4">
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">
            This issue has strong community backing ({support} of{" "}
            {PETITION_THRESHOLD}+). An AI advocacy agent can draft a formal
            petition to {issue.recommendedDepartment || "the department"} that
            residents can sign.
          </p>
          <button
            onClick={draft}
            disabled={loading || !currentUser}
            className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 rounded-full transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <img
                src="/civic-logo.svg"
                className="w-4 h-4 animate-pulse brightness-0 invert"
                alt=""
              />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {loading ? "Drafting petition…" : "Draft community petition"}
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>
      )}
    </div>
  );
}

function MapInner({
  issues,
  selectedIssue,
  onMarkerClick,
  isDarkMode,
}: {
  issues: CivicIssue[];
  selectedIssue: CivicIssue | null;
  onMarkerClick: (i: CivicIssue) => void;
  isDarkMode: boolean;
}) {
  const map = useMap();
  const clusterer = useRef<MarkerClusterer | null>(null);

  const [markers, setMarkers] = useState<{
    [key: string]: google.maps.marker.AdvancedMarkerElement;
  }>({});

  useEffect(() => {
    if (!map) return;
    if (!clusterer.current) {
      clusterer.current = new MarkerClusterer({ map });
    }
  }, [map]);

  useEffect(() => {
    clusterer.current?.clearMarkers();
    clusterer.current?.addMarkers(Object.values(markers));
  }, [markers]);

  const setMarkerRef = (
    marker: google.maps.marker.AdvancedMarkerElement | null,
    key: string,
  ) => {
    if (marker && markers[key]) return;
    if (!marker && !markers[key]) return;

    setMarkers((prev) => {
      if (marker) {
        return { ...prev, [key]: marker };
      } else {
        const newMarkers = { ...prev };
        delete newMarkers[key];
        return newMarkers;
      }
    });
  };

  return (
    <>
      {issues.map((issue) => {
        const isSelected = selectedIssue?.id === issue.id;
        // Trust Engine pin colours take precedence over raw severity so the map
        // communicates verification state at a glance:
        //   Staff Verified  → green (high-priority, officially confirmed)
        //   Flagged for Review → danger red (suspected fraud)
        // Otherwise fall back to the severity heat scale.
        let bgBg = "var(--primary)";
        if (issue.status === "Staff Verified") bgBg = "#16A34A"; // green-600
        else if (issue.status === "Flagged for Review")
          bgBg = "var(--semantic-danger)";
        else if (issue.severityScore >= 8) bgBg = "var(--semantic-danger)";
        else if (issue.severityScore >= 5) bgBg = "var(--semantic-warning)";

        const isStaffVerified = issue.status === "Staff Verified";

        return (
          <AdvancedMarker
            key={issue.id}
            ref={(marker) => setMarkerRef(marker, issue.id)}
            position={{ lat: issue.latitude, lng: issue.longitude }}
            title={issue.category}
            onClick={() => onMarkerClick(issue)}
            zIndex={isSelected ? 40 : isStaffVerified ? 35 : 20}
          >
            <div
              className={`relative ${isSelected ? "scale-125" : "scale-100"} transition-transform duration-300`}
            >
              {issue.severityScore >= 8 &&
                !isSelected &&
                !isStaffVerified && (
                  <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-75"></div>
                )}
              <Pin
                background={bgBg}
                glyphColor="#fff"
                borderColor="#fff"
                scale={1}
              />
            </div>
          </AdvancedMarker>
        );
      })}
    </>
  );
}

export default function CommandMap({
  issues,
  onSelectIssue,
  currentUser,
  scope,
  selectedIssueFromParent,
  isDarkMode,
}: CommandMapProps) {
  const isStaff = scope.role === "staff";
  const [selectedIssue, setSelectedIssue] = useState<CivicIssue | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [cityFilter, setCityFilter] = useState<string>("All");
  const [wardFilter, setWardFilter] = useState<string>("All");
  const [showLocationFilter, setShowLocationFilter] = useState(false);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [upvoteError, setUpvoteError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [resolvingIssue, setResolvingIssue] = useState<CivicIssue | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    isResolved: boolean;
    confidence: number;
    notes: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const viewCenter = { lat: 12.9716, lng: 77.5946 };
  const [center, setCenter] = useState<{ lat: number; lng: number }>(
    viewCenter,
  );

  useEffect(() => {
    if (selectedIssueFromParent) {
      setSelectedIssue(selectedIssueFromParent);
      setCenter({
        lat: selectedIssueFromParent.latitude,
        lng: selectedIssueFromParent.longitude,
      });
    }
  }, [selectedIssueFromParent]);

  // Keep the open sheet in sync with the live snapshot (upvotes, status, etc.)
  // so we never need fragile optimistic mutations.
  useEffect(() => {
    setSelectedIssue((prev) =>
      prev ? issues.find((i) => i.id === prev.id) ?? prev : prev,
    );
  }, [issues]);

  const handleMarkerClick = (issue: CivicIssue) => {
    setSelectedIssue(issue);
    setIsSheetExpanded(false);
    setCenter({ lat: issue.latitude, lng: issue.longitude });
    if (onSelectIssue) {
      onSelectIssue(issue);
    }
  };

  const closeSheet = () => {
    setSelectedIssue(null);
  };

  const fireConfetti = () => {
    const end = Date.now() + 1.5 * 1000;
    const colors = ["#34D399", "#2F6F6A"];

    (function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  };

  const upvoteIssue = async (issueId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setUpvoteError(null);
    if (!currentUser) return;
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;

    // Logical guards: municipal staff don't upvote (it's their queue), and
    // nobody upvotes their own report.
    if (isStaff) {
      setUpvoteError("Municipal staff can't upvote community reports.");
      return;
    }
    if (issue.reportedByUid === currentUser.uid) {
      setUpvoteError("You can't upvote your own report.");
      return;
    }

    const wasUpvoting = !(issue.upvotedBy || []).includes(currentUser.uid);
    try {
      // Atomic toggle; the live onSnapshot in App.tsx updates the UI, so no
      // optimistic local mutation is needed (and nothing to roll back).
      const result = await toggleUpvote(issueId, currentUser.uid);
      if (result.upvoted && wasUpvoting) {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.8 },
          colors: ["#4F46E5", "#3B82F6"],
        });
      }
    } catch (err) {
      setUpvoteError(
        err instanceof Error ? err.message : "Couldn't register your vote.",
      );
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && resolvingIssue) {
      const file = e.target.files[0];
      // Guard: a staff member must be in scope for this issue, and it must not
      // already be resolved. (Firestore rules enforce the same.)
      if (!currentUser || !canActOnIssue(scope, resolvingIssue)) {
        setVerificationResult({
          isResolved: false,
          confidence: 0,
          notes: "You are not authorised to resolve issues in this area.",
        });
        e.target.value = "";
        return;
      }
      if (resolvingIssue.status === "Resolved" || isVerifying) {
        e.target.value = "";
        return;
      }
      const file0 = file;
      const reader = new FileReader();

      reader.onload = async () => {
        const afterImageBase64 = reader.result as string;
        setIsVerifying(true);
        setVerificationResult(null);

        try {
          const response = await fetch("/api/verify-resolution", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              beforeImage: resolvingIssue.imageUrl,
              afterImage: afterImageBase64,
              mimeType: file0.type || "image/jpeg",
              category: resolvingIssue.category,
            }),
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Verification failed.");

          setVerificationResult(data.verification);

          if (data.verification.isResolved) {
            // Idempotent: the transaction flips status once; rapid re-clicks
            // and points double-awards are impossible.
            const didResolve = await resolveIssue(
              resolvingIssue.id,
              currentUser.uid,
              {
                resolvedImageUrl: afterImageBase64,
                resolutionConfidence: data.verification.confidence,
                resolutionNotes: data.verification.notes,
              },
            );
            if (didResolve) {
              const resolvedObj = {
                ...resolvingIssue,
                status: "Resolved" as const,
                resolvedImageUrl: afterImageBase64,
                resolutionConfidence: data.verification.confidence,
                resolutionNotes: data.verification.notes,
              };
              setSelectedIssue(resolvedObj);
              if (onSelectIssue) onSelectIssue(resolvedObj);
              fireConfetti();
            }

            setTimeout(() => {
              setResolvingIssue(null);
              setVerificationResult(null);
            }, 3000);
          }
        } catch (err) {
          setVerificationResult({
            isResolved: false,
            confidence: 0,
            notes:
              err instanceof Error ? err.message : "Could not verify the fix.",
          });
        } finally {
          setIsVerifying(false);
          e.target.value = "";
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const startResolution = (issue: CivicIssue, e: React.MouseEvent) => {
    e.stopPropagation();
    if (issue.status === "Resolved" || isVerifying) return;
    setResolvingIssue(issue);
    if (fileInputRef.current) fileInputRef.current.click();
  };

  // RULE B — Official Staff Override: promote straight to "Staff Verified".
  const handleApprove = async (issue: CivicIssue, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;
    setApprovingId(issue.id);
    setUpvoteError(null);
    try {
      await corroborateAndApprove(issue.id, currentUser.uid);
    } catch (err) {
      setUpvoteError(
        err instanceof Error ? err.message : "Approval failed. Try again.",
      );
    } finally {
      setApprovingId(null);
    }
  };

  // City → Ward location filter (cascading).
  const uniqueSorted = (vals: (string | undefined)[]) =>
    Array.from(new Set(vals.filter((v): v is string => Boolean(v)))).sort();
  const cityOptions = uniqueSorted(issues.map((i) => i.city));
  const wardOptions = uniqueSorted(
    issues
      .filter((i) => cityFilter === "All" || i.city === cityFilter)
      .map((i) => i.ward),
  );
  const locationFilterActive = cityFilter !== "All" || wardFilter !== "All";

  const filteredIssues = issues.filter(
    (i) =>
      (filterCategory === "All" || i.category === filterCategory) &&
      (cityFilter === "All" || i.city === cityFilter) &&
      (wardFilter === "All" || i.ward === wardFilter),
  );

  return (
    <div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {!hasValidKey ? (
        <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 text-center p-6 font-sans">
          <div className="max-w-md bg-white dark:bg-gray-800 p-8 rounded-3xl shadow-sm border border-[#E5E5E5] dark:border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-[#1A1A1A] dark:text-white">
              Google Maps API Key Required
            </h2>
            <p className="text-sm text-[#717171] dark:text-gray-300 mb-2 font-medium text-left">
              <strong>Step 1:</strong>{" "}
              <a
                href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais"
                target="_blank"
                rel="noopener"
                className="text-primary underline"
              >
                Get an API Key
              </a>
            </p>
            <p className="text-sm text-[#717171] dark:text-gray-300 mb-2 font-medium text-left">
              <strong>Step 2:</strong> Add your key as a secret:
            </p>
            <ul className="text-left text-sm text-[#717171] dark:text-gray-400 leading-relaxed list-disc list-inside mb-4">
              <li>
                Open <strong>Settings</strong> (⚙️ gear icon, top-right)
              </li>
              <li>
                Select <strong>Secrets</strong>
              </li>
              <li>
                Type <code>GOOGLE_MAPS_PLATFORM_KEY</code>, press{" "}
                <strong>Enter</strong>
              </li>
              <li>
                Paste your API key, press <strong>Enter</strong>
              </li>
            </ul>
            <p className="text-xs text-[#9CA3AF] italic">
              The app rebuilds automatically.
            </p>
          </div>
        </div>
      ) : (
        <APIProvider apiKey={API_KEY} version="weekly">
          <GoogleMap
            center={center}
            onCenterChanged={(e) => {
              if (e.detail?.center && !selectedIssue) {
                setCenter(e.detail.center);
              }
            }}
            defaultZoom={13}
            mapId="DEMO_MAP_ID"
            colorScheme={isDarkMode ? "DARK" : "LIGHT"}
            internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
            style={{ width: "100%", height: "100%" }}
            disableDefaultUI={true}
            zoomControl={true}
          >
            <MapInner
              issues={filteredIssues}
              selectedIssue={selectedIssue}
              onMarkerClick={handleMarkerClick}
              isDarkMode={isDarkMode || false}
            />
          </GoogleMap>
        </APIProvider>
      )}

      {/* Top Filter Bar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex flex-col items-center gap-2 pointer-events-none">
        <div className="glass-nav p-2 rounded-full pointer-events-auto flex gap-1 overflow-x-auto no-scrollbar shadow-lg max-w-full items-center">
          <button
            onClick={() => setFilterCategory("All")}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer shrink-0 ${filterCategory === "All" ? "bg-primary text-white" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"}`}
          >
            All
          </button>
          {[
            "Pothole",
            "Water Leak",
            "Vandalism",
            "Streetlight Out",
            "Waste Issue",
          ].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer shrink-0 ${filterCategory === cat ? "bg-primary text-white" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"}`}
            >
              {cat}
            </button>
          ))}
          <div className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1 shrink-0" />
          <button
            onClick={() => setShowLocationFilter((v) => !v)}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${locationFilterActive || showLocationFilter ? "bg-primary text-white" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"}`}
          >
            <MapPin className="w-3.5 h-3.5" />
            {wardFilter !== "All" ? wardFilter : cityFilter !== "All" ? cityFilter : "Location"}
          </button>
        </div>

        {showLocationFilter && (
          <div className="glass-nav pointer-events-auto rounded-2xl shadow-lg p-3 flex flex-wrap gap-2 items-center max-w-full">
            <select
              value={cityFilter}
              onChange={(e) => {
                setCityFilter(e.target.value);
                setWardFilter("All");
              }}
              className="text-xs px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white font-medium cursor-pointer outline-none"
            >
              <option value="All">All Cities</option>
              {cityOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={wardFilter}
              onChange={(e) => setWardFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white font-medium cursor-pointer outline-none"
            >
              <option value="All">All Wards</option>
              {wardOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            {locationFilterActive && (
              <button
                onClick={() => {
                  setCityFilter("All");
                  setWardFilter("All");
                }}
                className="text-xs font-bold text-red-600 dark:text-red-400 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Animated Bottom Sheet */}
      <AnimatePresence>
        {selectedIssue && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: isSheetExpanded ? "10%" : "0%" }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 250 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, { offset, velocity }) => {
              if (offset.y > 150 || velocity.y > 500) {
                closeSheet();
              } else if (offset.y < -50 || velocity.y < -200) {
                setIsSheetExpanded(true);
              } else {
                setIsSheetExpanded(false);
              }
            }}
            className="absolute bottom-0 left-0 right-0 z-20 flex justify-center pointer-events-none px-4"
          >
            <div className="bg-white dark:bg-gray-900 w-full max-w-md sm:max-w-2xl rounded-t-[2rem] shadow-2xl dark:shadow-none pointer-events-auto flex flex-col max-h-[75vh] sm:max-h-[85vh] border border-gray-200 dark:border-gray-800 border-b-0 pb-6 sm:pb-6">
              {/* Grabber */}
              <div
                className="w-full flex justify-center pt-4 pb-2 cursor-grab active:cursor-grabbing shrink-0"
                onClick={() => setIsSheetExpanded(!isSheetExpanded)}
              >
                <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full" />
              </div>

              <div className="px-6 pb-6 overflow-y-auto no-scrollbar flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <PlacesContext location={{ lat: selectedIssue.latitude, lng: selectedIssue.longitude }} />
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 dark:text-white text-xl">
                        {selectedIssue.category}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${selectedIssue.severityScore >= 8 ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" : "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800"}`}
                      >
                        Sev {selectedIssue.severityScore}
                      </span>
                      {selectedIssue.priorityTier && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
                          {selectedIssue.priorityTier} (
                          {selectedIssue.slaTargetHours}h SLA)
                        </span>
                      )}
                    </div>
                    {selectedIssue.address && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 mb-1 font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {selectedIssue.address}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                      Reported by{" "}
                      <span className="text-gray-900 dark:text-gray-200">
                        {selectedIssue.reportedByName}
                      </span>
                      {selectedIssue.ward && ` • Ward: ${selectedIssue.ward}`}
                    </p>
                    {selectedIssue.duplicateCount &&
                      selectedIssue.duplicateCount > 1 && (
                        <p className="text-xs text-orange-600 font-bold mt-1 bg-orange-50 inline-block px-2 py-0.5 rounded-full border border-orange-200">
                          🔥 {selectedIssue.duplicateCount} people reported this
                        </p>
                      )}
                  </div>
                  <button
                    onClick={closeSheet}
                    className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div
                  className="relative rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800 h-40 sm:h-48 mb-5 sm:mb-6 group cursor-pointer"
                  onClick={() => setIsImageModalOpen(true)}
                >
                  <img
                    src={
                      selectedIssue.imageUrl ||
                      "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=400&auto=format&fit=crop"
                    }
                    alt={selectedIssue.category}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="bg-white/90 dark:bg-black/90 text-gray-900 dark:text-white px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm">
                      View Full Screen
                    </span>
                  </div>
                  <div className="absolute bottom-3 left-3 bg-semantic-success font-bold text-white px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wide shadow-sm flex items-center gap-1.5">
                    {selectedIssue.status === "Resolved" && (
                      <CheckCircle className="w-3 h-3" />
                    )}
                    {selectedIssue.status}
                  </div>
                </div>

                {/* Before / After comparison once an issue is resolved. */}
                {selectedIssue.status === "Resolved" &&
                  selectedIssue.resolvedImageUrl && (
                    <div className="mb-6">
                      <h4 className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-2 tracking-widest">
                        Before / After
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="relative rounded-xl overflow-hidden h-28 bg-gray-100 dark:bg-gray-800">
                          <img
                            src={selectedIssue.imageUrl}
                            alt="Before"
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
                            Before
                          </span>
                        </div>
                        <div className="relative rounded-xl overflow-hidden h-28 bg-gray-100 dark:bg-gray-800">
                          <img
                            src={selectedIssue.resolvedImageUrl}
                            alt="After"
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-1 left-1 bg-emerald-600 text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
                            After
                          </span>
                        </div>
                      </div>
                      {typeof selectedIssue.resolutionConfidence === "number" && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-2">
                          AI verified fix · {selectedIssue.resolutionConfidence}% confidence
                        </p>
                      )}
                    </div>
                  )}

                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 text-sm text-gray-600 dark:text-gray-300 italic mb-6 leading-relaxed border border-gray-100 dark:border-gray-700">
                  "{selectedIssue.description || "No summary provided."}"
                </div>

                {/* Status Timeline */}
                <div className="mb-6">
                  <h4 className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-3 tracking-widest">
                    Status Timeline
                  </h4>
                  <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-2 space-y-4">
                    <div className="relative pl-5">
                      <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-primary ring-4 ring-white dark:ring-gray-900" />
                      <p className="text-xs font-bold text-gray-900 dark:text-white">
                        Reported
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Citizen Submission
                      </p>
                    </div>
                    {selectedIssue.status !== "Reported" && (
                      <div className="relative pl-5">
                        <div
                          className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full ring-4 ring-white dark:ring-gray-900 ${selectedIssue.status === "Resolved" ? "bg-primary" : "bg-blue-500"}`}
                        />
                        <p className="text-xs font-bold text-gray-900 dark:text-white">
                          {selectedIssue.status}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          System Update
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
                  {/* Upvote: citizens only, never on your own report. */}
                  {!isStaff &&
                  currentUser?.uid !== selectedIssue.reportedByUid ? (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => upvoteIssue(selectedIssue.id, e)}
                      className={`flex-1 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 transition-colors cursor-pointer shadow-sm ${currentUser && (selectedIssue.upvotedBy || []).includes(currentUser.uid) ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"}`}
                    >
                      <ThumbsUp className="w-4 h-4" />
                      {currentUser &&
                      (selectedIssue.upvotedBy || []).includes(currentUser.uid)
                        ? "Upvoted"
                        : "Me Too"}
                      <span className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded-full ml-1">
                        {selectedIssue.upvotesCount || 0}
                      </span>
                    </motion.button>
                  ) : (
                    <div className="flex-1 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      <ThumbsUp className="w-4 h-4" />
                      {selectedIssue.upvotesCount || 0} Upvotes
                    </div>
                  )}

                  {selectedIssue.status !== "Resolved" &&
                    isStaff &&
                    canActOnIssue(scope, selectedIssue) && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={(e) => startResolution(selectedIssue, e)}
                        disabled={isVerifying}
                        className="flex-1 bg-gray-900 dark:bg-white text-white dark:text-gray-900 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                      >
                        {isVerifying ? (
                          <img src="/civic-logo.svg" className="w-4 h-4 animate-pulse brightness-0 invert dark:invert-0" alt="Verifying" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        {isVerifying ? "Verifying..." : "Resolve Issue"}
                      </motion.button>
                    )}
                </div>

                {/* RULE B — Official Staff Override: "Corroborate & Approve". */}
                {isStaff &&
                  canActOnIssue(scope, selectedIssue) &&
                  selectedIssue.status !== "Staff Verified" &&
                  selectedIssue.status !== "Resolved" && (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => handleApprove(selectedIssue, e)}
                      disabled={approvingId === selectedIssue.id}
                      className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      {approvingId === selectedIssue.id
                        ? "Approving…"
                        : "Corroborate & Approve"}
                    </motion.button>
                  )}

                {upvoteError && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs rounded-xl">
                    {upvoteError}
                  </div>
                )}

                {petitionEligible(selectedIssue) && (
                  <PetitionSection
                    issue={selectedIssue}
                    currentUser={currentUser}
                  />
                )}

                <CommentsSection selectedIssue={selectedIssue} currentUser={currentUser} />

                {verificationResult && !verificationResult.isResolved && (
                  <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs rounded-xl">
                    <strong>
                      Resolution Failed ({verificationResult.confidence}%
                      confidence):
                    </strong>{" "}
                    {verificationResult.notes}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* Expand Image Modal */}
      <AnimatePresence>
        {isImageModalOpen && selectedIssue && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setIsImageModalOpen(false)}
          >
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25 }}
              src={
                selectedIssue.imageUrl ||
                "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=400&auto=format&fit=crop"
              }
              alt="Expanded"
              className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl cursor-default"
              onClick={(e) => e.stopPropagation()}
            />
            <button className="absolute top-6 right-6 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 backdrop-blur-md">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
