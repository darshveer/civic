/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { T } from "../lib/translate";
import { updatePassword, type User } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import {
  ShieldCheck,
  ShieldOff,
  Loader2,
  Smartphone,
  Lock,
  KeyRound,
} from "lucide-react";
import { db } from "../lib/firebase";

/**
 * Reads a staff member's stored (encrypted) 2FA record. Returns the ciphertext
 * blob if enabled, else null. The plaintext secret never lives client-side.
 */
export async function loadStaff2FA(
  uid: string,
): Promise<{ enabled: boolean; enc: string | null }> {
  try {
    const snap = await getDoc(doc(db, "staffSecurity", uid));
    if (snap.exists()) {
      const d = snap.data() as any;
      return { enabled: Boolean(d.totpEnabled), enc: d.enc || null };
    }
  } catch (e) {
    console.warn("Could not read 2FA record:", e);
  }
  return { enabled: false, enc: null };
}

/** True if this staff member must change their temporary password first. */
export async function mustChangePassword(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "staffOnboarding", uid));
    return snap.exists() && Boolean((snap.data() as any).mustChangePassword);
  } catch (e) {
    console.warn("Could not read onboarding record:", e);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* First-login forced password change                                 */
/* ------------------------------------------------------------------ */
export function ForcePasswordChange({
  currentUser,
  onDone,
  onCancel,
}: {
  currentUser: User | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!currentUser) return;
    if (pw.length < 6) return setError("Use at least 6 characters.");
    if (pw !== pw2) return setError("Passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await updatePassword(currentUser, pw);
      await setDoc(
        doc(db, "staffOnboarding", currentUser.uid),
        { mustChangePassword: false, changedAt: Date.now() },
        { merge: true },
      );
      onDone();
    } catch (e: any) {
      if (e?.code === "auth/requires-recent-login") {
        setError(
          "For security, please sign out and sign back in, then change your password.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Could not change password.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-gray-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card rounded-3xl p-6 sm:p-8 max-w-sm w-full space-y-5">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
            <KeyRound className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            <T>Set your password</T>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            <T>This is your first sign-in — please replace the temporary password.</T>
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="New password"
          className="w-full text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white"
        />
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Confirm new password"
          className="w-full text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || !pw || !pw2}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold text-sm py-3 rounded-2xl transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {busy ? "Saving…" : "Set password & continue"}
        </button>
        <button
          onClick={onCancel}
          className="block mx-auto text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold"
        >
          <T>Sign out instead</T>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login-time challenge                                               */
/* ------------------------------------------------------------------ */
export function TwoFactorChallenge({
  enc,
  onPass,
  onCancel,
}: {
  enc: string;
  onPass: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enc, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed.");
      onPass();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-gray-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card rounded-3xl p-6 sm:p-8 max-w-sm w-full space-y-5 text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            <T>Two-factor authentication</T>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            <T>Enter the 6-digit code from your authenticator app to continue.</T>
          </p>
        </div>
        <input
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && submit()}
          placeholder="••••••"
          className="w-full text-center tracking-[0.5em] text-xl font-bold bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || code.length !== 6}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold text-sm py-3 rounded-2xl transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {busy ? "Verifying…" : "Verify & continue"}
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold"
        >
          <T>Cancel & sign out</T>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile settings: enable / disable                                 */
/* ------------------------------------------------------------------ */
export function TwoFactorSettings({
  currentUser,
  isAdmin = false,
}: {
  currentUser: User | null;
  isAdmin?: boolean;
}) {
  // Administrators have COMPULSORY 2FA enforced via the server (ADMIN_TOTP_SECRET)
  // for the Admin Panel — it isn't the per-staff opt-in, so show it as enforced.
  if (isAdmin) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              <T>Two-factor authentication</T>
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              <T>Enforced for administrators.</T>
            </p>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
          Your account requires an authenticator code to open the Admin Panel,
          configured on the server (<code>ADMIN_TOTP_SECRET</code>). It can't be
          turned off here. To re-add the authenticator on a new device, use the
          Admin Panel → “Set up the authenticator”.
        </p>
      </div>
    );
  }
  return <StaffTwoFactorSettings currentUser={currentUser} />;
}

function StaffTwoFactorSettings({ currentUser }: { currentUser: User | null }) {
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Enrollment flow state
  const [enrolling, setEnrolling] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");

  useEffect(() => {
    if (!currentUser) return;
    loadStaff2FA(currentUser.uid).then((r) => setEnabled(r.enabled));
  }, [currentUser]);

  const startEnroll = async () => {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/staff/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentUser?.email || "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed.");
      setSetup(data);
      setEnrolling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!currentUser || !setup) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/staff/2fa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: setup.secret, code: confirmCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not confirm.");
      await setDoc(doc(db, "staffSecurity", currentUser.uid), {
        totpEnabled: true,
        enc: data.enc,
        updatedAt: Date.now(),
      });
      setEnabled(true);
      setEnrolling(false);
      setSetup(null);
      setConfirmCode("");
      setMsg("Two-factor authentication is now ON. You'll be asked for a code at sign-in.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!currentUser) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, "staffSecurity", currentUser.uid));
      setEnabled(false);
      setMsg("Two-factor authentication has been turned off.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            enabled
              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
              : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
          }`}
        >
          {enabled ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            <T>Two-factor authentication</T>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {enabled === null
              ? "Checking…"
              : enabled
                ? "On — a code is required at sign-in."
                : "Off — protect your staff account with an authenticator app."}
          </p>
        </div>
      </div>

      {msg && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-lg p-2.5">
          {msg}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-2.5">
          {error}
        </p>
      )}

      {!enrolling && enabled === false && (
        <button
          onClick={startEnroll}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
          Enable 2FA
        </button>
      )}

      {!enrolling && enabled === true && (
        <button
          onClick={disable}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-bold text-sm py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
          Turn off 2FA
        </button>
      )}

      {enrolling && setup && (
        <div className="space-y-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-2xl p-4">
          <p className="text-xs text-gray-700 dark:text-gray-300">
            1. Scan this with Google Authenticator / Authy (or enter the key
            manually):
          </p>
          <div className="flex justify-center">
            <div className="bg-white p-2.5 rounded-xl">
              <QRCodeSVG value={setup.otpauth} size={148} level="M" marginSize={1} />
            </div>
          </div>
          <code className="block break-all text-center text-[11px] font-bold bg-white dark:bg-gray-900 rounded-lg p-2 text-gray-800 dark:text-gray-200">
            {setup.secret}
          </code>
          <p className="text-xs text-gray-700 dark:text-gray-300">
            2. Enter the current 6-digit code to confirm:
          </p>
          <input
            inputMode="numeric"
            maxLength={6}
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className="w-full text-center tracking-[0.4em] text-base font-bold bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={confirmEnroll}
              disabled={busy || confirmCode.length !== 6}
              className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-60 cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Confirm & enable
            </button>
            <button
              onClick={() => {
                setEnrolling(false);
                setSetup(null);
                setConfirmCode("");
                setError(null);
              }}
              disabled={busy}
              className="px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold text-sm py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 cursor-pointer"
            >
              <T>Cancel</T>
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        Your authenticator secret is encrypted with a server key before it's
        stored — it can't be read from the database.
      </p>
    </div>
  );
}
