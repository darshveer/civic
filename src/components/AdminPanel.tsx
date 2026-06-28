/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
} from "firebase/firestore";
import { CivicIssue } from "../types";
import { zonesForCity, resolveZoneAuthoritative } from "../lib/cityZones";
import { getZoneToWards, wardZoneAtPoint } from "../lib/wardLookup";
import {
  ShieldCheck,
  Loader2,
  UserPlus,
  Trash2,
  KeyRound,
  Crown,
  MapPin,
  ExternalLink,
  Sparkles,
  Map as MapIcon,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { db, firebaseConfig } from "../lib/firebase";
import { StaffTier } from "../types";

interface AdminPanelProps {
  currentUser: User | null;
  issues: CivicIssue[];
}

interface StaffEntry {
  tier: StaffTier;
  wards?: string[];
  zone?: string;
  displayName?: string;
}

const TIER_LABEL: Record<StaffTier, string> = {
  field: "Ward Officer (field)",
  zonal: "Zonal Supervisor",
  city: "City Administrator",
};

// Deep link to this project's Firebase Console → Authentication → Users, where
// a removed staff member's login can be deleted (the client SDK can't do it).
const CONSOLE_USERS_URL = firebaseConfig.projectId
  ? `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/users`
  : "https://console.firebase.google.com/";

// A separate Firebase app so creating a staff account does NOT replace the
// admin's own auth session (Firebase client signs the newest user into `auth`).
const SECONDARY_APP = "civic-admin-secondary";
function secondaryAuth() {
  const app =
    getApps().find((a) => a.name === SECONDARY_APP) ||
    initializeApp(firebaseConfig, SECONDARY_APP);
  return getAuth(app);
}

export default function AdminPanel({ currentUser, issues }: AdminPanelProps) {
  const email = currentUser?.email || "";

  // --- Gate state (access code + authenticator 2FA) ---------------------
  const [unlocked, setUnlocked] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [setupInfo, setSetupInfo] = useState<{
    secret: string;
    otpauth: string;
    alreadyConfigured: boolean;
  } | null>(null);

  const verifyAdmin = async () => {
    setVerifying(true);
    setGateError(null);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, secretCode: accessCode, totpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed.");
      setUnlocked(true);
      setAccessCode("");
      setTotpCode("");
    } catch (e) {
      setGateError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  const fetchSetup = async () => {
    setGateError(null);
    try {
      const res = await fetch("/api/admin/totp-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, secretCode: accessCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed.");
      setSetupInfo(data);
    } catch (e) {
      setGateError(e instanceof Error ? e.message : "Setup failed.");
    }
  };

  // --- Provisioning state -----------------------------------------------
  const [staff, setStaff] = useState<Record<string, StaffEntry>>({});
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState<StaffTier>("field");
  const [newZone, setNewZone] = useState(""); // zonal supervisor's zone
  const [newFieldZone, setNewFieldZone] = useState(""); // field officer: pick zone…
  const [newWard, setNewWard] = useState(""); // …then a ward within it
  const [zoneToWards, setZoneToWards] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Per-area officer limits (admin-editable). Defaults: 1 zonal supervisor per
  // zone, 3 ward officers per ward.
  const [limits, setLimits] = useState<{ zonalPerZone: number; fieldPerWard: number }>(
    { zonalPerZone: 1, fieldPerWard: 1 },
  );

  const refreshStaff = async () => {
    setLoadingStaff(true);
    try {
      const snap = await getDoc(doc(db, "config", "roles"));
      const data = snap.exists() ? (snap.data() as any) : {};
      setStaff(data.staff || {});
      if (data.limits)
        setLimits({
          zonalPerZone: Number(data.limits.zonalPerZone) || 1,
          fieldPerWard: Number(data.limits.fieldPerWard) || 3,
        });
    } catch (e) {
      console.error("Load staff failed:", e);
    } finally {
      setLoadingStaff(false);
    }
  };

  // Live counts from the registry: zonal supervisors per zone, field officers
  // per ward.
  const zonalByZone: Record<string, number> = {};
  const fieldByWard: Record<string, number> = {};
  for (const s of Object.values(staff) as StaffEntry[]) {
    if (s.tier === "zonal" && s.zone)
      zonalByZone[s.zone] = (zonalByZone[s.zone] || 0) + 1;
    if (s.tier === "field")
      for (const w of s.wards || [])
        fieldByWard[w] = (fieldByWard[w] || 0) + 1;
  }

  const saveLimits = async (next: { zonalPerZone: number; fieldPerWard: number }) => {
    setLimits(next);
    try {
      await setDoc(doc(db, "config", "roles"), { limits: next }, { merge: true });
    } catch (e) {
      console.error("Could not save limits:", e);
    }
  };

  // --- Zones & wards -----------------------------------------------------
  const [wardToZone, setWardToZone] = useState<Record<string, string>>({});
  const [zoneBusy, setZoneBusy] = useState(false);
  const [zoneMsg, setZoneMsg] = useState<string | null>(null);
  const [zoneErr, setZoneErr] = useState<string | null>(null);

  const refreshWards = async () => {
    try {
      const snap = await getDoc(doc(db, "config", "wards"));
      setWardToZone(snap.exists() ? (snap.data() as any).wardToZone || {} : {});
    } catch (e) {
      console.error("Load wards failed:", e);
    }
  };

  useEffect(() => {
    if (unlocked) {
      refreshStaff();
      refreshWards();
      getZoneToWards().then(setZoneToWards).catch(() => {});
    }
  }, [unlocked]);

  // Distinct ward names actually present on the issues (what we need to map).
  const distinctWards = Array.from(
    new Set(
      issues
        .map((i) => (i.ward || "").trim())
        .filter((w) => w.length > 0),
    ),
  ).sort();
  // The dominant city across issues drives the authoritative zone list.
  const dominantCity = (() => {
    const counts: Record<string, number> = {};
    for (const i of issues)
      if (i.city) counts[i.city] = (counts[i.city] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  })();
  // A ward is "unmapped" only if it's in neither the authoritative city map nor
  // the admin's config/wards (those are the ones the LLM fallback would handle).
  const unmappedWards = distinctWards.filter(
    (w) => !wardToZone[w] && !resolveZoneAuthoritative(dominantCity, w),
  );
  // Zones for the dropdowns: official city zones + any from config/wards.
  const distinctZones = Array.from(
    new Set([...zonesForCity(dominantCity), ...Object.values(wardToZone)]),
  ).sort();
  // Prefer the zones from the boundary file (always the 8 BBMP zones), else fall
  // back to whatever we can derive.
  const zoneOptions = Object.keys(zoneToWards).length
    ? Object.keys(zoneToWards).sort()
    : distinctZones;

  // Re-stamp the OFFICIAL ward + zone on every existing issue by point-in-polygon
  // against the BBMP boundaries. Deterministic — no AI, no network call. (New
  // reports already get this at submission time; this is for older reports.)
  const autoMapZones = async () => {
    if (!currentUser) return;
    setZoneBusy(true);
    setZoneErr(null);
    setZoneMsg(null);
    try {
      const writes: Promise<void>[] = [];
      let outside = 0;
      for (const i of issues) {
        const pip = await wardZoneAtPoint(i.latitude, i.longitude);
        if (!pip) {
          outside++;
          continue; // outside BBMP — leave its geocoded ward as-is
        }
        const upd: Record<string, string> = {};
        if (i.ward !== pip.ward) upd.ward = pip.ward;
        if (i.zone !== pip.zone) upd.zone = pip.zone;
        if (Object.keys(upd).length)
          writes.push(updateDoc(doc(db, "issues", i.id), upd));
      }
      const results = await Promise.allSettled(writes);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      setZoneMsg(
        `Backfilled ${ok} issue(s) to their official ward & zone${
          outside ? `; ${outside} outside BBMP left as-is` : ""
        }.` +
          (failed
            ? ` ${failed} update(s) were denied — click "Make me City Administrator" above first, then re-run.`
            : ""),
      );
    } catch (e) {
      setZoneErr(e instanceof Error ? e.message : "Backfill failed.");
    } finally {
      setZoneBusy(false);
    }
  };

  const writeStaffEntry = async (uid: string, entry: StaffEntry) => {
    await setDoc(
      doc(db, "config", "roles"),
      { staff: { [uid]: entry } },
      { merge: true },
    );
  };

  const makeMeCityAdmin = async () => {
    if (!currentUser) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await writeStaffEntry(currentUser.uid, {
        tier: "city",
        displayName: currentUser.displayName || "City Administrator",
      });
      setMsg("Your account is now a City Administrator.");
      await refreshStaff();
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "Failed — is your admin email set in firestore.rules?",
      );
    } finally {
      setBusy(false);
    }
  };

  const createStaff = async () => {
    setErr(null);
    setMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
      return setErr("Enter a valid email.");
    if (newPassword.length < 6)
      return setErr("Password must be at least 6 characters.");
    if (newTier === "field" && (!newFieldZone || !newWard))
      return setErr("Field officers need a zone and a ward within it.");
    if (newTier === "zonal" && !newZone.trim())
      return setErr("Zonal supervisors need a zone.");

    // --- Per-area quota checks (the panel enforces against the live registry) ---
    if (newTier === "zonal") {
      const have = zonalByZone[newZone.trim()] || 0;
      if (have >= limits.zonalPerZone)
        return setErr(
          `Zone "${newZone.trim()}" already has ${have}/${limits.zonalPerZone} zonal supervisor(s). Remove one or raise the limit.`,
        );
    }
    if (newTier === "field") {
      const have = fieldByWard[newWard] || 0;
      if (have >= limits.fieldPerWard)
        return setErr(
          `Ward "${newWard}" already has ${have}/${limits.fieldPerWard} officer(s). Remove one or raise the limit.`,
        );
    }

    setBusy(true);
    try {
      // 1. Create the auth account on the SECONDARY app (keeps your session).
      const auth2 = secondaryAuth();
      const cred = await createUserWithEmailAndPassword(
        auth2,
        newEmail.trim(),
        newPassword,
      );
      if (newName.trim())
        await updateProfile(cred.user, { displayName: newName.trim() });
      const uid = cred.user.uid;
      await signOut(auth2);

      // 2. Register them in the staff allowlist (authorized by your admin email).
      const entry: StaffEntry = {
        tier: newTier,
        displayName: newName.trim() || newEmail.trim(),
        ...(newTier === "field" ? { wards: [newWard] } : {}),
        ...(newTier === "zonal" ? { zone: newZone.trim() } : {}),
      };
      await writeStaffEntry(uid, entry);

      // 3. Flag first-login password change. BEST-EFFORT — must not block the
      //    invite email if the rule isn't deployed yet or it transiently fails.
      let onboardingOk = false;
      try {
        await setDoc(doc(db, "staffOnboarding", uid), {
          mustChangePassword: true,
          createdAt: Date.now(),
        });
        onboardingOk = true;
      } catch (e) {
        console.warn(
          "Could not set the onboarding flag (deploy firestore.rules?):",
          e,
        );
      }

      // Account + role exist now — refresh the list so it shows regardless of
      // what happens with the email step below.
      await refreshStaff();

      // 4. Email the temporary password. Report the REAL outcome so failures
      //    are visible instead of silently swallowed.
      let inviteNote: string;
      try {
        const res = await fetch("/api/staff/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: newEmail.trim(),
            password: newPassword,
            name: newName.trim(),
            tier: newTier,
          }),
        });
        const data = await res.json().catch(() => ({}) as any);
        if (res.ok && data.sent) {
          inviteNote = "✅ Temporary password emailed (ask them to check spam too).";
        } else if (res.ok && data.simulated) {
          inviteNote =
            "⚠️ No SMTP configured on the server — email was simulated. Set SMTP_* env vars, or share the password manually.";
        } else {
          inviteNote = `⚠️ Couldn't email the password (${data.error || `HTTP ${res.status}`}). Share it manually.`;
        }
      } catch (e) {
        inviteNote =
          "⚠️ Couldn't reach the email service. Share the temporary password manually.";
      }

      const onboardingNote = onboardingOk
        ? ""
        : " ⚠️ Could not set the first-login password-reset flag — DEPLOY firestore.rules (the staffOnboarding rule is new), then re-create this account so they're prompted to change their password.";

      setMsg(
        `Staff account created: ${newEmail.trim()} (${TIER_LABEL[newTier]}). ${inviteNote}${onboardingNote}`,
      );
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewWard("");
      setNewFieldZone("");
      setNewZone("");
    } catch (e: any) {
      const code = e?.code || "";
      if (code === "auth/email-already-in-use")
        setErr("That email already has an account.");
      else if (code === "auth/operation-not-allowed")
        setErr("Enable Email/Password sign-in in Firebase → Authentication.");
      else setErr(e instanceof Error ? e.message : "Failed to create staff.");
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (uid: string) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const who = staff[uid]?.displayName || uid;
    try {
      // 1. Revoke staff role.
      await updateDoc(doc(db, "config", "roles"), {
        [`staff.${uid}`]: deleteField(),
      });
      // 2. Delete all of their app data (best-effort — a missing doc is fine).
      await Promise.allSettled([
        deleteDoc(doc(db, "citizens", uid)),
        deleteDoc(doc(db, "staffOnboarding", uid)),
        deleteDoc(doc(db, "staffSecurity", uid)),
      ]);
      setMsg(
        `Removed ${who} and deleted their app data. Final step: delete their login below (Firebase Console → Users) so they can no longer sign in.`,
      );
      await refreshStaff();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove.");
    } finally {
      setBusy(false);
    }
  };

  // --- Gate screen -------------------------------------------------------
  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto w-full p-4">
        <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Admin Access
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enter your access code and authenticator code.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Admin access code"
                className="w-full text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
              />
            </div>
            <input
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit authenticator code"
              className="w-full text-center tracking-[0.4em] text-base font-bold bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
            />
          </div>

          {gateError && (
            <p className="text-xs text-red-600 dark:text-red-400">{gateError}</p>
          )}

          <button
            onClick={verifyAdmin}
            disabled={verifying || !accessCode || totpCode.length !== 6}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-60 cursor-pointer"
          >
            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {verifying ? "Verifying…" : "Unlock Admin Panel"}
          </button>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <button
              onClick={fetchSetup}
              className="text-xs font-semibold text-primary hover:underline"
            >
              First time? Set up the authenticator →
            </button>
            {setupInfo && (
              <div className="mt-3 text-[11px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 space-y-2 text-amber-800 dark:text-amber-300">
                {setupInfo.alreadyConfigured ? (
                  <p>
                    2FA is already configured. Scan this on a new authenticator
                    if needed:
                  </p>
                ) : (
                  <p>
                    <strong>Scan</strong> this QR in Google Authenticator / Authy
                    (or enter the key manually), then set{" "}
                    <code>ADMIN_TOTP_SECRET</code> to the key in your server env
                    and restart:
                  </p>
                )}
                <div className="flex justify-center py-1">
                  <div className="bg-white p-2.5 rounded-xl">
                    <QRCodeSVG
                      value={setupInfo.otpauth}
                      size={148}
                      level="M"
                      marginSize={1}
                    />
                  </div>
                </div>
                <p className="text-center opacity-80">
                  Manual entry key:
                </p>
                <code className="block break-all text-center font-bold bg-white dark:bg-gray-900 rounded-lg p-2 text-gray-800 dark:text-gray-200">
                  {setupInfo.secret}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Provisioning panel ------------------------------------------------
  const staffEntries = Object.entries(staff) as [string, StaffEntry][];
  return (
    <div className="max-w-2xl mx-auto w-full p-4 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Staff Administration
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Signed in as {email}
          </p>
        </div>
      </div>

      {(msg || err) && (
        <div
          className={`text-xs rounded-xl p-3 ${
            err
              ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50"
              : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50"
          }`}
        >
          {err || msg}
        </div>
      )}

      {/* Bootstrap self as city admin */}
      <div className="glass-card rounded-2xl p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
            <Crown className="w-4 h-4 text-amber-500" /> Make me City Administrator
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Adds your account to the registry so you can act on all issues.
          </p>
        </div>
        <button
          onClick={makeMeCityAdmin}
          disabled={busy}
          className="shrink-0 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-full hover:opacity-90 disabled:opacity-60 cursor-pointer transition-opacity"
        >
          Grant
        </button>
      </div>

      {/* Zones & wards — backfill existing issues to official ward/zone */}
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
            <MapIcon className="w-4 h-4" /> Zones &amp; Wards
          </h3>
          <button
            onClick={autoMapZones}
            disabled={zoneBusy || issues.length === 0}
            className="shrink-0 flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-full transition-colors disabled:opacity-60 cursor-pointer"
          >
            {zoneBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MapIcon className="w-3.5 h-3.5" />
            )}
            {zoneBusy ? "Backfilling…" : "Backfill ward & zone"}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          New reports are tagged with their official BBMP ward &amp; zone
          automatically (by the boundary they fall inside). Run this once to
          re-stamp <strong>existing</strong> issues so zonal supervisors and ward
          officers see them. No need to re-run unless boundaries change.
        </p>

        {zoneMsg && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-lg p-2.5">
            {zoneMsg}
          </p>
        )}
        {zoneErr && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-2.5">
            {zoneErr}
          </p>
        )}

        {zoneOptions.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Zones (assign these to zonal supervisors)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {zoneOptions.map((z) => (
                <span
                  key={z}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/50"
                >
                  {z}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Staffing limits (per-area quotas) */}
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
          Staffing limits
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600 dark:text-gray-300">
            Zonal supervisors / zone
            <input
              type="number"
              min={1}
              value={limits.zonalPerZone}
              onChange={(e) =>
                saveLimits({
                  ...limits,
                  zonalPerZone: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="mt-1 w-full text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-300">
            Ward officers / ward
            <input
              type="number"
              min={1}
              value={limits.fieldPerWard}
              onChange={(e) =>
                saveLimits({
                  ...limits,
                  fieldPerWard: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="mt-1 w-full text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
            />
          </label>
        </div>
        {(Object.keys(zonalByZone).length > 0 ||
          Object.keys(fieldByWard).length > 0) && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
            {Object.entries(zonalByZone).map(([z, n]) => (
              <div key={z} className="flex justify-between">
                <span>Zone {z}</span>
                <span
                  className={
                    n >= limits.zonalPerZone
                      ? "font-bold text-amber-600 dark:text-amber-400"
                      : ""
                  }
                >
                  {n}/{limits.zonalPerZone} supervisor(s)
                </span>
              </div>
            ))}
            {Object.entries(fieldByWard).map(([w, n]) => (
              <div key={w} className="flex justify-between">
                <span className="truncate">{w}</span>
                <span
                  className={
                    n >= limits.fieldPerWard
                      ? "font-bold text-amber-600 dark:text-amber-400"
                      : ""
                  }
                >
                  {n}/{limits.fieldPerWard} officer(s)
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          The panel blocks adding staff beyond these limits. (Counts are read live
          from the registry.)
        </p>
      </div>

      {/* Create staff */}
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
          <UserPlus className="w-4 h-4" /> Add a staff member
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Full name"
            className="text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
          />
          <select
            value={newTier}
            onChange={(e) => setNewTier(e.target.value as StaffTier)}
            className="text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200 cursor-pointer"
          >
            <option value="field">{TIER_LABEL.field}</option>
            <option value="zonal">{TIER_LABEL.zonal}</option>
            <option value="city">{TIER_LABEL.city}</option>
          </select>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="staff@email.com"
            className="text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
          />
          <input
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Temporary password (≥6 chars)"
            className="text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
          />
          {newTier === "zonal" && (
            <input
              value={newZone}
              onChange={(e) => setNewZone(e.target.value)}
              placeholder="Zone — type to search (e.g. East)"
              list="zone-list"
              className="sm:col-span-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
            />
          )}
          {newTier === "field" && (
            <>
              <input
                value={newFieldZone}
                onChange={(e) => {
                  setNewFieldZone(e.target.value);
                  setNewWard("");
                }}
                placeholder="1 · Zone — type to search"
                list="zone-list"
                className="sm:col-span-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200"
              />
              <input
                value={newWard}
                onChange={(e) => setNewWard(e.target.value)}
                placeholder={
                  newFieldZone
                    ? `2 · Ward in ${newFieldZone} — type to search`
                    : "Pick a zone first"
                }
                list="ward-list"
                disabled={!newFieldZone}
                className="sm:col-span-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 text-gray-800 dark:text-gray-200 disabled:opacity-50"
              />
            </>
          )}
          <datalist id="zone-list">
            {zoneOptions.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <datalist id="ward-list">
            {(zoneToWards[newFieldZone] || []).map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </div>
        <button
          onClick={createStaff}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          Create staff account
        </button>
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          They sign in with this email & password. Share the temporary password
          securely; they can change it later.
        </p>
      </div>

      {/* Current staff */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            Registered staff ({staffEntries.length})
          </h3>
          {loadingStaff && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        </div>
        {staffEntries.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            No staff yet. Add yourself as City Administrator and create officers above.
          </p>
        ) : (
          <div className="space-y-2">
            {staffEntries.map(([uid, s]) => (
              <div
                key={uid}
                className="flex items-center justify-between gap-3 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {s.displayName || uid}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-primary">{TIER_LABEL[s.tier]}</span>
                    {s.zone && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" /> {s.zone}
                      </span>
                    )}
                    {s.wards && s.wards.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" /> {s.wards.join(", ")}
                      </span>
                    )}
                  </p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-600 font-mono truncate">
                    {uid}
                  </p>
                </div>
                <button
                  onClick={() => removeStaff(uid)}
                  disabled={busy}
                  title="Remove from registry"
                  className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2">
            Removing a member revokes their role and deletes their app data. The
            Firebase Auth <strong>login</strong> can't be deleted from here
            (client SDK limitation) — finish the job with one click:
          </p>
          <a
            href={CONSOLE_USERS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Firebase Console → Authentication → Users
          </a>
        </div>
      </div>
    </div>
  );
}
