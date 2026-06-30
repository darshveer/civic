/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Staff "Create Complaint" — files a complaint received offline (a scanned
 * letter, a pasted email, or a phone call) on a citizen's behalf. The letter /
 * email paths use the Complaint-Intake Extraction Agent to pre-fill the form.
 * The issue is stored with reportedByUid = the staff member (so the existing
 * create rule passes), filedByStaffUid set, and the complainant's name/phone in
 * the reporter fields so staff can call back.
 */

import React, { useState, useEffect } from "react";
import type { User } from "firebase/auth";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { fileToDataUrl } from "../lib/resolveWithProof";
import { searchPlaces } from "../lib/geocode";
import { loadWardsConfig, zoneForWard } from "../lib/roles";
import { wardZoneAtPoint, getZoneToWards, wardsCenter } from "../lib/wardLookup";
import { resolveZoneAuthoritative } from "../lib/cityZones";
import { CivicCategory, CivicIssue, ReportSource } from "../types";
import { T, useTr } from "../lib/translate";
import { X, Loader2, Sparkles, FileText, Mail, Phone } from "lucide-react";

// Letter/email addresses are often landmark-based ("near Reliance Fresh, Pole
// No. MH-04-A") that geocoders can't resolve. We append a city hint and strip
// obvious non-geocodable noise to improve the hit rate before falling back to a
// manual ward pick.
const CITY_HINT = "Bengaluru, Karnataka, India";
function geocodeQueries(address: string): string[] {
  const a = address.trim();
  const withCity = /bengaluru|bangalore|karnataka/i.test(a)
    ? a
    : `${a}, ${CITY_HINT}`;
  // Drop pole numbers / "near ..." clauses for a coarser second attempt.
  const coarse = a
    .replace(/\bpole\s*no\.?[^,]*/gi, "")
    .replace(/\bnear[^,]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "");
  const coarseWithCity = coarse ? `${coarse}, ${CITY_HINT}` : "";
  return [...new Set([withCity, coarseWithCity, CITY_HINT].filter(Boolean))];
}

const CATEGORIES: CivicCategory[] = [
  "Pothole",
  "Water Leak",
  "Vandalism",
  "Streetlight Out",
  "Waste Issue",
  "Other",
];

const priorityFor = (sev: number): { priorityTier: CivicIssue["priorityTier"]; slaTargetHours: number } =>
  sev >= 8
    ? { priorityTier: "P1", slaTargetHours: 24 }
    : sev >= 5
      ? { priorityTier: "P2", slaTargetHours: 48 }
      : { priorityTier: "P3", slaTargetHours: 72 };

export default function CreateComplaintModal({
  currentUser,
  onClose,
  onCreated,
}: {
  currentUser: User | null;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const tr = useTr();
  const [tab, setTab] = useState<"phone" | "letter" | "email">("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<CivicCategory>("Other");
  const [severity, setSeverity] = useState(5);
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [manualWard, setManualWard] = useState(""); // fallback when geocoding fails
  const [zoneToWards, setZoneToWards] = useState<Record<string, string[]>>({});
  const [emailText, setEmailText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the official ward list (for the manual-ward fallback dropdown).
  useEffect(() => {
    getZoneToWards().then(setZoneToWards).catch(() => {});
  }, []);
  const allWards = (Object.values(zoneToWards) as string[][]).flat().sort();
  const zoneForWardName = (w: string): string => {
    for (const [z, list] of Object.entries(zoneToWards) as [string, string[]][]) {
      if (list.includes(w)) return z;
    }
    return "";
  };

  const sourceFor = (): ReportSource =>
    tab === "letter" ? "staff-letter" : tab === "email" ? "staff-email" : "staff-phone";

  const extract = async () => {
    setError(null);
    setExtracting(true);
    try {
      const body: any = {};
      if (tab === "letter") {
        if (!file) throw new Error("Choose the scanned complaint file first.");
        body.fileBase64 = await fileToDataUrl(file);
        body.mimeType = file.type || "application/pdf";
      } else {
        if (emailText.trim().length < 5) throw new Error("Paste the email text first.");
        body.emailText = emailText;
      }
      const res = await fetch("/api/intake/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed.");
      const d = data.draft;
      setCategory(d.category || "Other");
      setSeverity(d.severityScore || 5);
      setDescription(d.description || "");
      if (d.locationHint) setAddress(d.locationHint);
      if (d.complainantName) setName(d.complainantName);
      if (d.complainantPhone) setPhone(d.complainantPhone);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!currentUser) return setError("Please sign in.");
    if (description.trim().length < 8) return setError("Add a description of the complaint.");
    if (address.trim().length < 3 && !manualWard)
      return setError("Add a location/address, or pick the ward below.");
    setBusy(true);
    try {
      // 1) Try to geocode the (cleaned, city-hinted) address.
      let loc: { lat: number; lng: number; address: string; ward: string; city: string; state: string } | null = null;
      for (const q of geocodeQueries(address)) {
        const results = await searchPlaces(q).catch(() => []);
        if (results.length) {
          const r = results[0];
          loc = { lat: r.lat, lng: r.lng, address: address.trim() || r.address, ward: r.ward, city: r.city, state: r.state };
          break;
        }
      }
      // 2) Fallback: landmark-only addresses don't geocode — use the ward the
      //    staff member picked, anchored to that ward's polygon centroid.
      if (!loc) {
        if (!manualWard)
          throw new Error(
            "Couldn't locate that address. Pick the ward from the list below so we can route it correctly.",
          );
        const center = await wardsCenter([manualWard]);
        if (!center)
          throw new Error("Couldn't resolve that ward — please choose another.");
        loc = {
          lat: center.lat,
          lng: center.lng,
          address: address.trim(),
          ward: manualWard,
          city: "Bengaluru",
          state: "Karnataka",
        };
      }
      const wards = await loadWardsConfig();
      const official = await wardZoneAtPoint(loc.lat, loc.lng);
      // Prefer a manually-picked ward (staff knows the area) over geocoder guess.
      const ward = manualWard || official?.ward || loc.ward || "";
      const zone =
        zoneForWardName(ward) ||
        official?.zone ||
        resolveZoneAuthoritative(loc.city, ward) ||
        zoneForWard(ward, wards) ||
        "";
      const pr = priorityFor(severity);
      const issueData: Omit<CivicIssue, "id"> = {
        imageUrl: "",
        category,
        severityScore: severity,
        confidencePercentage: 60,
        recommendedDepartment: "General Operations",
        description: description.trim(),
        priorityTier: pr.priorityTier,
        slaTargetHours: pr.slaTargetHours,
        duplicateCount: 1,
        escalationLevel: 0,
        latitude: loc.lat,
        longitude: loc.lng,
        address: address.trim() || loc.address,
        state: loc.state,
        city: loc.city,
        ward,
        zone,
        reportedByUid: currentUser.uid,
        reportedByName: name.trim() || "Citizen (intake)",
        reportedByPhone: phone.trim(),
        source: sourceFor(),
        filedByStaffUid: currentUser.uid,
        reportedAt: Date.now(),
        status: "Pending Verification",
        upvotesCount: 0,
        isCorroborated: false,
        corroboratedGroupId: null,
        metadataMode: "Live-Fallback",
        metadataWarning: true,
        visualEvidenceTags: [],
      };
      await addDoc(collection(db, "issues"), issueData);
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't file the complaint.");
    } finally {
      setBusy(false);
    }
  };

  const TabBtn = ({ id, label, Icon }: { id: typeof tab; label: string; Icon: any }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
        tab === id
          ? "bg-primary text-white"
          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {tr(label)}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white"><T>Create Complaint</T></h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          <TabBtn id="phone" label="Phone call" Icon={Phone} />
          <TabBtn id="letter" label="Scanned letter" Icon={FileText} />
          <TabBtn id="email" label="Email" Icon={Mail} />
        </div>

        {tab === "letter" && (
          <div className="space-y-2">
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:bg-primary file:text-white file:font-bold file:text-xs cursor-pointer"
            />
            <button onClick={extract} disabled={extracting || !file} className="w-full flex items-center justify-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-bold py-2.5 rounded-xl disabled:opacity-50 cursor-pointer">
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <T>Extract complaint from document</T>
            </button>
          </div>
        )}
        {tab === "email" && (
          <div className="space-y-2">
            <textarea
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              rows={4}
              placeholder={tr("Paste the complaint email here…")}
              className="w-full text-sm p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white resize-none"
            />
            <button onClick={extract} disabled={extracting || emailText.trim().length < 5} className="w-full flex items-center justify-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-bold py-2.5 rounded-xl disabled:opacity-50 cursor-pointer">
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <T>Extract complaint from email</T>
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Complainant name")} className="text-sm px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tr("Contact number")} className="text-sm px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white" />
          <select value={category} onChange={(e) => setCategory(e.target.value as CivicCategory)} className="text-sm px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white cursor-pointer">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="text-sm px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white cursor-pointer">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={n}>{tr("Severity")} {n}</option>)}
          </select>
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={tr("Describe the complaint…")} className="w-full text-sm p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white resize-none" />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tr("Location / address (e.g. 12th Main, BTM Layout)")} className="w-full text-sm px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white" />
        <div>
          <input
            value={manualWard}
            onChange={(e) => setManualWard(e.target.value)}
            list="complaint-ward-list"
            placeholder={tr("Ward (use if the address can't be located — type to search)")}
            className="w-full text-sm px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white"
          />
          <datalist id="complaint-ward-list">
            {allWards.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
            <T>Landmark-only addresses (e.g. "near Reliance Fresh, Pole No. MH-04-A") can't be mapped exactly — pick the ward and we'll route it there; the full address text stays on the report.</T>
          </p>
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{tr(error)}</p>}

        <button onClick={submit} disabled={busy} className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-bold text-sm py-3 rounded-2xl transition-colors disabled:opacity-60 cursor-pointer">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          <T>File complaint</T>
        </button>
      </div>
    </div>
  );
}
