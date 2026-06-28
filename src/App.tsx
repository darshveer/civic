/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  auth,
  db,
  syncCitizenProfile,
  computeImpactPoints,
  computeReportsCount,
} from "./lib/firebase";
import {
  loadRolesConfig,
  resolveUserScope,
  tierLabel,
  issuesInScope,
} from "./lib/roles";
import {
  neighborhoodAlerts,
  missions as buildMissions,
  petitionEligible,
  homeWard,
} from "./lib/civic";
import { BADGES, BadgeMedal, computeBadgeStats } from "./lib/badges";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updateProfile,
  User,
} from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
} from "firebase/firestore";
import { CitizenProfile, CivicIssue, UserScope } from "./types";

const Reporter = lazy(() => import("./components/Reporter"));
const CommandMap = lazy(() => import("./components/CommandMap"));
const ImpactDashboard = lazy(() => import("./components/ImpactDashboard"));
const StaffReportsList = lazy(() => import("./components/StaffReportsList"));
const StaffDashboard = lazy(() => import("./components/StaffDashboard"));
const SmartAssignmentBoard = lazy(() => import("./components/SmartAssignmentBoard"));
const CivicAssistant = lazy(() => import("./components/CivicAssistant"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));
import CursorFx from "./components/CursorFx";
import {
  TwoFactorChallenge,
  TwoFactorSettings,
  ForcePasswordChange,
  loadStaff2FA,
  mustChangePassword,
} from "./components/StaffSecurity";

import {
  LogOut,
  Map,
  PlusCircle,
  AlertCircle,
  Camera,
  Trophy,
  ClipboardList,
  ChevronDown,
  User as UserIcon,
  Award,
  X,
  FileText,
  CheckCircle,
  MapPin,
  Calendar,
  ChevronRight,
  Sparkles,
  Moon,
  Sun,
  Bell,
  Activity,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";

type TabType = "reporter" | "map" | "impact" | "staff-list" | "staff-analytics" | "staff-kanban" | "admin";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [issues, setIssues] = useState<CivicIssue[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("reporter");
  const [loginRoleTab, setLoginRoleTab] = useState<"citizen" | "staff">(
    "citizen",
  );
  // Authoritative permission scope, derived from the server-side staff
  // allowlist (config/roles) — NOT from the client login toggle.
  const [scope, setScope] = useState<UserScope>({ role: "citizen", wards: [] });
  const isStaff = scope.role === "staff";
  // Whether the signed-in email is an env-configured administrator (gates the
  // Admin Panel — the actual unlock still needs the access code + 2FA).
  const [isAdminAccount, setIsAdminAccount] = useState<boolean>(false);
  // Keep the latest chosen login intent readable inside stable callbacks.
  const loginRoleTabRef = useRef(loginRoleTab);
  useEffect(() => {
    loginRoleTabRef.current = loginRoleTab;
  }, [loginRoleTab]);

  // True only when the user just clicked a sign-in button THIS page-load. A
  // persisted Firebase session restored on page load (e.g. after a server
  // restart) is NOT fresh — we use this to never auto-resume an admin into the
  // app from a cached session; admins always re-authenticate from the login page.
  const freshLoginRef = useRef(false);

  /**
   * Resolves the user's authoritative scope STRICTLY from the server-enforced
   * allowlist (config/roles). There is no client-side bootstrap/demo path —
   * staff exist only because an administrator provisioned them (see AdminPanel),
   * and Firestore rules enforce the same on every write.
   */
  const applyScope = async (uid: string): Promise<UserScope> => {
    const roles = await loadRolesConfig();
    const s = resolveUserScope(uid, roles);
    setScope(s);
    return s;
  };

  const [selectedIssueFromParent, setSelectedIssueFromParent] =
    useState<CivicIssue | null>(null);

  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [activeModal, setActiveModal] = useState<
    "profile" | "my-reports" | "notifications" | "security" | null
  >(null);
  // When a 2FA-enabled staff member signs in, the encrypted blob to challenge
  // against. Non-null = the session is gated until they enter a valid code.
  const [pending2FA, setPending2FA] = useState<string | null>(null);
  // First-login: a freshly-provisioned staff member must replace their
  // temporary password before using the app.
  const [forcePwChange, setForcePwChange] = useState<boolean>(false);
  const [leaderboardCity, setLeaderboardCity] = useState<"Bangalore" | "Other">(
    "Bangalore",
  );
  const [customSeed, setCustomSeed] = useState<string>("");

  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  // Cursor position (in %) for the login screen's mouse-following spotlight.
  const [loginMouse, setLoginMouse] = useState({ x: 50, y: 42 });

  const [isAuthMode, setIsAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  // Email-OTP registration flow.
  const [otpStep, setOtpStep] = useState<"form" | "code">("form");
  const [otpCode, setOtpCode] = useState<string>("");
  const [otpDevHint, setOtpDevHint] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const liveReportsCount = user ? computeReportsCount(issues, user.uid) : 0;
  const liveImpactPoints = user ? computeImpactPoints(issues, user.uid) : 0;
  const myHomeWard = homeWard(issues, user?.uid, profile?.ward);
  const badgeStats = computeBadgeStats(issues, user?.uid, liveImpactPoints);

  // Unified civic-alert feed (latest first): status updates + Neighbourhood
  // Watch + Petition calls-to-action + a Mission nudge. The dropdown shows the
  // newest; the Notifications page lists them all.
  type AlertKind = "status" | "watch" | "petition" | "mission";
  interface CivicAlert {
    id: string;
    kind: AlertKind;
    message: string;
    time: number;
    issueId?: string;
    imageUrl?: string;
  }
  const userNotifications: CivicAlert[] = (() => {
    if (!user) return [];
    const out: CivicAlert[] = [];
    const now = Date.now();

    if (isStaff) {
      // Staff get queue alerts within their scope — NOT "your report" updates.
      const scoped = issuesInScope(scope, issues);
      for (const i of scoped) {
        if (i.status === "Resolved") continue;
        const ageH = (now - i.reportedAt) / 3_600_000;
        const overdue =
          (i.priorityTier === "P1" || i.priorityTier === "P2") &&
          i.slaTargetHours &&
          ageH > i.slaTargetHours;
        if (overdue) {
          out.push({
            id: `sla-${i.id}`,
            kind: "watch",
            message: `SLA breach: ${i.priorityTier} ${i.category}${i.ward ? ` in ${i.ward}` : ""} is overdue and needs action.`,
            time: i.reportedAt,
            issueId: i.id,
          });
        } else if (now - i.reportedAt < 48 * 3_600_000) {
          out.push({
            id: `new-${i.id}`,
            kind: "status",
            message: `New ${i.category} reported${i.ward ? ` in ${i.ward}` : ""} (${i.priorityTier || "P3"}).`,
            time: i.reportedAt,
            issueId: i.id,
            imageUrl: i.imageUrl,
          });
        }
      }
    } else {
      // 1. Status updates on your own reports (citizens only).
      for (const i of issues) {
        if (i.reportedByUid === user.uid && i.status !== "Reported") {
          out.push({
            id: `status-${i.id}`,
            kind: "status",
            message: `Your ${i.category} report is now ${i.status}.`,
            time: i.reportedAt,
            issueId: i.id,
            imageUrl: i.imageUrl,
          });
        }
      }

      // 2. Neighbourhood Watch.
      for (const a of neighborhoodAlerts(issues, user.uid, profile?.ward)) {
        out.push({
          id: a.id,
          kind: "watch",
          message: a.message,
          time: a.time,
          issueId: a.issueId,
        });
      }
      // 3. Petition calls-to-action (issues you're connected to).
      for (const i of issues) {
        const connected =
          i.ward === myHomeWard ||
          i.reportedByUid === user.uid ||
          (i.upvotedBy || []).includes(user.uid);
        if (i.petition && petitionEligible(i) && connected) {
          out.push({
            id: `pet-${i.id}`,
            kind: "petition",
            message: `"${i.category}" near ${i.ward || "you"} reached ${i.upvotesCount || 0} upvotes — a petition has been drafted. Add your signature?`,
            time: i.petition.draftedAt,
            issueId: i.id,
          });
        }
      }
      // 4. One personalised Mission nudge.
      const top = buildMissions(
        issues,
        user.uid,
        liveImpactPoints,
        profile?.ward,
      )[0];
      if (top) {
        out.push({
          id: `mission-${top.id}`,
          kind: "mission",
          message: `Mission · ${top.title} — ${top.detail}`,
          time: Date.now(),
          issueId: top.issueId,
        });
      }
    }

    return out.sort((a, b) => b.time - a.time);
  })();
  // Staff only manage issues within their hierarchy scope (field=ward, zonal=zone, city=all).
  const scopedIssues = isStaff ? issuesInScope(scope, issues) : issues;

  useEffect(() => {
    // Complete a Google redirect sign-in (used when the popup is blocked).
    getRedirectResult(auth).catch((e) => {
      console.warn("Google redirect sign-in did not complete:", e?.message || e);
    });

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true);
      if (firebaseUser) {
        try {
          // Did the user just sign in this page-load, or is this a restored
          // (persisted/cached) session? Consume the flag immediately.
          const isFreshLogin = freshLoginRef.current;
          freshLoginRef.current = false;

          // Is this email an administrator? (server-side env allowlist)
          let admin = false;
          try {
            const r = await fetch("/api/admin/whoami", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: firebaseUser.email || "" }),
            });
            admin = (await r.json())?.isAdmin === true;
          } catch {}

          // Admins must use email & password — never Google sign-in.
          const viaGoogle = firebaseUser.providerData.some(
            (p) => p.providerId === "google.com",
          );
          if (admin && viaGoogle) {
            setIsAdminAccount(false);
            setUser(null);
            setProfile(null);
            setAuthError(
              "Admin accounts must sign in with email & password, not Google.",
            );
            try { await signOut(auth); } catch (e) {}
            setAuthLoading(false);
            return;
          }

          // Never auto-resume an admin from a cached session — require a fresh
          // sign-in from the login page each time the app (re)loads.
          if (admin && !isFreshLogin) {
            setIsAdminAccount(false);
            setUser(null);
            setProfile(null);
            try { await signOut(auth); } catch (e) {}
            setAuthLoading(false);
            return;
          }

          setIsAdminAccount(admin);
          const userProfile = await syncCitizenProfile(firebaseUser);
          const s = await applyScope(firebaseUser.uid);
          setUser(firebaseUser);
          setProfile({ ...userProfile, role: s.role });
          // Auto-jump to the Admin tab only on a FRESH login (not on restore).
          if (admin && isFreshLogin) setActiveTab("admin");
          else if (s.role === "staff") setActiveTab("map");

          // First-login password change, then optional 2FA challenge.
          if (s.role === "staff") {
            if (await mustChangePassword(firebaseUser.uid)) {
              setForcePwChange(true);
            }
            const tfa = await loadStaff2FA(firebaseUser.uid);
            if (tfa.enabled && tfa.enc) setPending2FA(tfa.enc);
          }
        } catch (err: any) {
          console.error("Profile sync failed:", err);
          setAuthError("Profile sync failed: " + (err?.message || err));
          setUser(null);
          setProfile(null);
          try { await signOut(auth); } catch (e) {}
        }
      } else {
        setUser(null);
        setProfile(null);
        setIsAdminAccount(false);
      }
      setAuthLoading(false);
    });

    const qIssues = query(
      collection(db, "issues"),
      orderBy("reportedAt", "desc"),
    );
    const unsubscribeIssues = onSnapshot(qIssues, (snapshot) => {
      const records: CivicIssue[] = [];
      snapshot.forEach((docSnap) => {
        records.push({ id: docSnap.id, ...docSnap.data() } as CivicIssue);
      });
      setIssues(records);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeIssues();
    };
  }, []);

  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      setIsDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const refreshProfileState = () => {
    if (user) {
      syncCitizenProfile(user)
        .then((p) => setProfile(p))
        .catch(() => {});
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      // onAuthStateChanged resolves profile + authoritative scope + landing tab.
      freshLoginRef.current = true;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      freshLoginRef.current = false; // failed attempt — don't leave it set
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        setAuthError("Username or password is incorrect.");
      } else if (err.code === "auth/operation-not-allowed") {
        setAuthError(
          "Email sign-up isn't enabled for this app yet. Admin: enable Email/Password in Firebase → Authentication → Sign-in method.",
        );
      } else {
        setAuthError(err instanceof Error ? err.message : "Sign in failed.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // Registration is now two-step: email OTP, then account creation.
  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (loginRoleTab === "staff") {
      // Staff accounts are provisioned via the allowlist, not self-registration.
      setIsAuthMode("login");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send the code.");
      setOtpDevHint(data.devCode ? `Testing code: ${data.devCode}` : null);
      setOtpStep("code");
      setResendCooldown(30); // throttle resends
      setOtpCode("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified)
        throw new Error(data.error || "Verification failed.");
      // Email confirmed — now create the account.
      freshLoginRef.current = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const finalName = name || email.split("@")[0];
      const finalPhoto = `https://api.dicebear.com/7.x/bottts/svg?seed=${cred.user.uid}`;
      await updateProfile(cred.user, {
        displayName: finalName,
        photoURL: finalPhoto,
      });
      
      // onAuthStateChanged fires before updateProfile completes, so we must
      // patch the created document to ensure the name isn't lost.
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        await setDoc(doc(db, "citizens", cred.user.uid), {
          uid: cred.user.uid,
          displayName: finalName,
          photoURL: finalPhoto,
          role: "citizen",
          joinedAt: Date.now(),
          impactPoints: 20,
          civicRank: "Civic Novice",
          reportsCount: 0
        }, { merge: true });
        
        // Also update local state so UI reflects the name immediately without a refresh
        setProfile(prev => prev ? { ...prev, displayName: finalName, photoURL: finalPhoto } : null);
        setUser({ ...cred.user, displayName: finalName, photoURL: finalPhoto } as any);
      } catch (e) {
        console.error("Failed to patch new user profile:", e);
      }

      setOtpStep("form");
      setOtpCode("");
      // onAuthStateChanged finalises profile + scope.
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (code === "auth/operation-not-allowed") {
        setAuthError(
          "Email sign-up isn't enabled for this app yet. Admin: enable Email/Password in Firebase → Authentication → Sign-in method.",
        );
      } else if (code === "auth/email-already-in-use") {
        setAuthError("That email is already registered — try signing in instead.");
      } else {
        setAuthError(err instanceof Error ? err.message : "Verification failed.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      freshLoginRef.current = true;
      await signInWithPopup(auth, provider);
      // onAuthStateChanged finalises profile + scope.
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        setAuthError("Sign-in was cancelled.");
      } else if (code === "auth/operation-not-allowed") {
        // Most common after migrating to a new Firebase project.
        setAuthError(
          "Google sign-in isn't enabled for this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method → Google.",
        );
      } else if (code === "auth/unauthorized-domain") {
        setAuthError(
          "This domain isn't authorized for Google sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains (localhost is there by default — make sure you're on http://localhost, not a raw IP).",
        );
      } else {
        // Popups are frequently blocked (ad-blockers, embedded previews, COOP).
        // Fall back to a full-page redirect, which is far more reliable.
        try {
          await signInWithRedirect(auth, provider);
          return; // page navigates away to Google
        } catch (err2) {
          const code2 =
            err2 && typeof err2 === "object" && "code" in err2
              ? String((err2 as { code: string }).code)
              : "";
          setAuthError(
            `Couldn't open Google sign-in${code || code2 ? ` (${code || code2})` : ""}. Allow popups/redirects for this site, or sign in with email & password.`,
          );
        }
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setUser(null);
    setProfile(null);
    setIsAdminAccount(false);
    setPending2FA(null);
    setForcePwChange(false);
    setActiveTab("reporter");
    setLoginRoleTab("citizen");
    setIsDropdownOpen(false);
    setActiveModal(null);
    try {
      await signOut(auth);
    } catch (e) {}
  };

  const handleInstantGuestSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      freshLoginRef.current = true;
      const cred = await signInAnonymously(auth);
      const finalName = `Hero_${Math.floor(1000 + Math.random() * 9000)}`;
      const finalPhoto = `https://api.dicebear.com/7.x/bottts/svg?seed=${cred.user.uid}`;
      await updateProfile(cred.user, {
        displayName: finalName,
        photoURL: finalPhoto,
      });
      
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        await setDoc(doc(db, "citizens", cred.user.uid), {
          uid: cred.user.uid,
          displayName: finalName,
          photoURL: finalPhoto,
          role: "citizen",
          joinedAt: Date.now(),
          impactPoints: 20,
          civicRank: "Civic Novice",
          reportsCount: 0
        }, { merge: true });
        
        setProfile(prev => prev ? { ...prev, displayName: finalName, photoURL: finalPhoto } : null);
        setUser({ ...cred.user, displayName: finalName, photoURL: finalPhoto } as any);
      } catch (e) {
        console.error("Failed to patch guest profile:", e);
      }
      // onAuthStateChanged finalises profile + scope.
    } catch (err: any) {
      if (err.code === "auth/operation-not-allowed") {
        setAuthError(
          "Guest sign-in isn't enabled. Admin: enable Anonymous sign-in in Firebase → Authentication → Sign-in method.",
        );
      } else {
        setAuthError("Failed to sign in as guest.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleReportScored = (newIssue: any) => {
    refreshProfileState();
    setActiveTab("map");
  };

  const handleUpdateAvatar = async (seed: string) => {
    if (!user || !profile) return;
    const nextPhotoURL = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
    try {
      const profileRef = doc(db, "citizens", user.uid);
      await updateDoc(profileRef, { photoURL: nextPhotoURL });
      setProfile({ ...profile, photoURL: nextPhotoURL });
    } catch (err) {
      console.error("Failed to update avatar photo:", err);
    }
  };

  const handleCustomAvatarSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (customSeed.trim()) {
      await handleUpdateAvatar(customSeed.trim());
      setCustomSeed("");
    }
  };

  const BANGALORE_LEADERBOARD = [
    {
      rank: 1,
      displayName: "Marie Curie",
      civicRank: "Metropolitan Guardian",
      impactPoints: 620,
      reportsCount: 12,
      isCurrent: false,
    },
    {
      rank: 2,
      displayName: "Rahul Sharma",
      civicRank: "Urban Architect",
      impactPoints: 410,
      reportsCount: 8,
      isCurrent: false,
    },
    {
      rank: 3,
      displayName: "Priya Patel",
      civicRank: "Neighbourhood Champion",
      impactPoints: 280,
      reportsCount: 5,
      isCurrent: false,
    },
    {
      rank: 4,
      displayName: "Amit Singh",
      civicRank: "Local Vigilante",
      impactPoints: 110,
      reportsCount: 2,
      isCurrent: false,
    },
  ];

  const OTHER_LEADERBOARD = [
    {
      rank: 1,
      displayName: "Jane Doe",
      civicRank: "Urban Architect",
      impactPoints: 380,
      reportsCount: 7,
      isCurrent: false,
    },
    {
      rank: 2,
      displayName: "John Smith",
      civicRank: "Neighbourhood Champion",
      impactPoints: 210,
      reportsCount: 4,
      isCurrent: false,
    },
    {
      rank: 3,
      displayName: "Alice Wonder",
      civicRank: "Local Vigilante",
      impactPoints: 90,
      reportsCount: 1,
      isCurrent: false,
    },
  ];

  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // Simulate initial splash screen loading time
    const timer = setTimeout(() => setIsAppReady(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const getDynamicLeaderboard = (city: "Bangalore" | "Other") => {
    const list =
      city === "Bangalore"
        ? [...BANGALORE_LEADERBOARD]
        : [...OTHER_LEADERBOARD];

    if (profile) {
      const alreadyHasCurrent = list.some((item) => item.isCurrent);
      if (!alreadyHasCurrent) {
        list.push({
          rank: 99,
          displayName: profile.displayName || "You",
          civicRank: profile.civicRank || "Civic Novice",
          impactPoints: liveImpactPoints,
          reportsCount: liveReportsCount,
          isCurrent: true,
        });
      }
    }

    list.sort((a, b) => b.impactPoints - a.impactPoints);

    return list.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case "Resolved":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      // Trust Engine: staff override is the highest tier → green/high-priority.
      case "Staff Verified":
        return "bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400";
      case "In Progress":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "Corroborated Report":
      case "Corroborated":
      case "Community Verified":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "Auto-Routed":
        return "bg-purple-50 text-purple-700 border-purple-200";
      // Suspected-fraud reports are parked for review → danger red.
      case "Flagged for Review":
        return "bg-red-50 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400";
      case "Requires Human Verification":
      case "Verify Report":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "Pending Verification":
      case "Reported":
      default:
        return "bg-gray-100 text-gray-700 border-gray-300";
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === "Requires Human Verification") return "Verify Report";
    if (status === "Corroborated Report") return "Corroborated";
    return status;
  };

  if (!isAppReady) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center font-sans">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: "spring" }}
          className="flex flex-col items-center gap-6 relative"
        >
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full animate-spin w-28 h-28 -m-4"></div>
            <img 
              src="/civic-logo.svg" 
              alt="Loading CIVIC" 
              className="w-20 h-20 animate-pulse drop-shadow-xl dark:invert z-10" 
            />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-gray-50 dark:bg-gray-950 flex flex-col justify-between font-sans text-[#1A1A1A] dark:text-white transition-colors duration-300">
      <CursorFx />

      {/* First-login password change takes priority over the 2FA challenge. */}
      {user && forcePwChange ? (
        <ForcePasswordChange
          currentUser={user}
          onDone={() => setForcePwChange(false)}
          onCancel={handleSignOut}
        />
      ) : (
        user && pending2FA && (
          <TwoFactorChallenge
            enc={pending2FA}
            onPass={() => setPending2FA(null)}
            onCancel={handleSignOut}
          />
        )
      )}
      <header className="h-16 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-[#E5E5E5] dark:border-gray-800 flex items-center justify-between px-4 sm:px-6 z-50 w-full sticky top-0">
        <div className="flex items-center gap-3">
          <img src="/civic-wordmark.svg" alt="CIVIC" className="h-6 sm:h-7 dark:invert" />
        </div>

        <div className="flex items-center gap-4 relative">
          {user ? (
            <div className="relative flex items-center gap-2">
              {!isStaff && (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-[#4A4A4A] dark:text-gray-400 uppercase tracking-wider">
                    Civic Rank
                  </div>
                  <div className="text-sm text-[#717171] dark:text-gray-300">
                    {profile?.civicRank || "Civic Novice"}
                  </div>
                </div>
              )}
              {isStaff && (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    Staff Role
                  </div>
                  <div className="text-sm text-blue-700 dark:text-blue-300 font-semibold">
                    {tierLabel(scope.tier)}
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-10 h-10 rounded-full border-2 border-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden flex items-center justify-center bg-[#E5E5E5] focus:outline-none hover:ring-2 hover:ring-offset-2 hover:ring-[#1A1A1A] transition-all cursor-pointer relative"
                title="Account Menu"
              >
                <img
                  src={
                    profile?.photoURL ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`
                  }
                  alt="Citizen Avatar"
                  className="w-full h-full object-cover"
                />
                {userNotifications.length > 0 && (
                  <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 border border-white rounded-full animate-pulse"></span>
                )}
              </button>

              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="text-[#717171] hover:text-[#1A1A1A] p-0.5 transition-colors cursor-pointer"
                title="Toggle Menu"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 top-12 mt-2 w-64 bg-white dark:bg-gray-900 rounded-2xl border border-[#E5E5E5] dark:border-gray-800 shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
                  <div className="px-4 py-3 border-b border-[#F0F0F0] dark:border-gray-800">
                    <p className="text-[10px] text-[#717171] dark:text-gray-400 font-bold uppercase tracking-wider">
                      Signed In As
                    </p>
                    <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white truncate">
                      {profile?.displayName || "Citizen Hero"}
                    </p>
                    <p className="text-[9px] text-[#717171] dark:text-gray-400 font-mono truncate">
                      {user.email || "guest@civic.local"}
                    </p>
                  </div>
                  
                  {userNotifications.length > 0 && (
                    <div className="px-4 py-2 border-b border-[#F0F0F0] dark:border-gray-800 bg-red-50/50 dark:bg-red-900/10">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <Bell className="w-3 h-3" /> Notifications
                        </p>
                        <span className="text-[10px] text-red-600/70 dark:text-red-400/70 font-semibold">
                          {userNotifications.length}
                        </span>
                      </div>
                      {/* Latest only in the dropdown */}
                      <div className="text-xs text-gray-800 dark:text-gray-200">
                        <span className="font-semibold block">
                          {userNotifications[0].message}
                        </span>
                        <span className="text-[9px] text-gray-500">
                          {new Date(userNotifications[0].time).toLocaleString()}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setActiveModal("notifications");
                        }}
                        className="mt-2 w-full text-center text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 hover:bg-red-100/60 dark:hover:bg-red-900/20 rounded-lg py-1.5 transition-colors cursor-pointer"
                      >
                        View all notifications
                      </button>
                    </div>
                  )}

                  {!isStaff ? (
                    <>
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setActiveModal("profile");
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F5] dark:hover:bg-gray-800 transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <UserIcon className="w-4 h-4 text-[#717171] dark:text-gray-400" />
                        My Profile & Leaderboard
                      </button>
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setActiveModal("my-reports");
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F5] dark:hover:bg-gray-800 transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-[#717171] dark:text-gray-400" />
                        My Reports ({liveReportsCount})
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="px-4 py-2 text-[9px] font-bold text-blue-600 bg-blue-50/50 dark:bg-blue-900/20 uppercase tracking-widest my-1 text-center rounded-lg mx-2">
                        {tierLabel(scope.tier)}
                        {scope.tier === "field" && scope.wards.length > 0 && (
                          <span className="block text-[8px] mt-0.5 normal-case tracking-normal text-blue-500">
                            {scope.wards.join(", ")}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setActiveModal("security");
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F5] dark:hover:bg-gray-800 transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-[#717171] dark:text-gray-400" />
                        Security &amp; 2FA
                      </button>
                    </>
                  )}

                  <div className="border-t border-[#F0F0F0] mt-1 pt-1">
                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        handleSignOut();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#EF4444] hover:bg-red-50 transition-colors flex items-center gap-2.5 cursor-pointer"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-[#717171] font-mono font-bold animate-pulse">
              ● Awaiting Connection
            </div>
          )}
        </div>
      </header>

      <main
        className={`${activeTab === "map" && user ? "flex-1 w-full relative" : (!user ? "flex-1 w-full flex flex-col sm:max-w-7xl sm:mx-auto sm:px-4 sm:py-8" : "max-w-7xl mx-auto px-4 py-8 flex-1 w-full min-w-0 flex flex-col gap-6")}`}
      >
        {!user ? (
          <div
            className="flex-1 w-full flex items-center justify-center relative overflow-hidden bg-gray-50 dark:bg-gray-900 sm:rounded-3xl mx-auto my-auto max-w-7xl h-full sm:h-[90vh] sm:max-h-[900px]"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setLoginMouse({
                x: ((e.clientX - r.left) / r.width) * 100,
                y: ((e.clientY - r.top) / r.height) * 100,
              });
            }}
          >
            {/* Spotlight that smoothly follows the cursor */}
            <div
              className="absolute inset-0 z-0 opacity-60 dark:opacity-70 transition-all duration-300 ease-out"
              style={{
                background: `radial-gradient(600px circle at ${loginMouse.x}% ${loginMouse.y}%, var(--color-brand-teal-light), transparent 42%), radial-gradient(720px circle at ${100 - loginMouse.x}% ${100 - loginMouse.y}%, var(--color-brand-blue), transparent 48%)`,
              }}
            />

            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="max-w-md w-[calc(100%-2rem)] mx-auto glass-card rounded-[2rem] overflow-y-auto p-6 sm:p-10 space-y-6 sm:space-y-8 z-10 my-6 sm:m-4 shadow-2xl backdrop-blur-xl bg-white/70 dark:bg-gray-900/70 border border-white/20 dark:border-gray-800/50 relative h-auto max-h-[85vh] sm:max-h-[calc(100%-2rem)] flex flex-col"
            >
              <div className="text-center space-y-3">
                <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-gray-900 dark:text-white">
                  C.I.V.I.C.
                </h1>
                <p className="text-gray-500 dark:text-gray-400 text-sm font-medium tracking-wide">
                  Report it. Track it. Fix it together.
                </p>
              </div>

              <div className="flex bg-gray-100/50 dark:bg-gray-800/50 p-1.5 rounded-2xl mb-8 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => {
                    setLoginRoleTab("citizen");
                    setAuthError(null);
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${loginRoleTab === "citizen" ? "bg-white dark:bg-gray-700 shadow-md text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-gray-700/50"}`}
                >
                  Citizen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Staff don't self-register — force the sign-in view.
                    setLoginRoleTab("staff");
                    setIsAuthMode("login");
                    setOtpStep("form");
                    setOtpCode("");
                    setAuthError(null);
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${loginRoleTab === "staff" ? "bg-white dark:bg-gray-700 shadow-md text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-gray-700/50"}`}
                >
                  Staff / Admin
                </button>
              </div>

              {loginRoleTab === "staff" && (
                <p className="-mt-4 mb-4 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  Municipal staff & administrators sign in with the{" "}
                  <strong>email &amp; password</strong> issued to them. Accounts
                  are created by an administrator — there is no staff self-signup
                  or Google sign-in.
                </p>
              )}

              {authError && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 text-xs text-red-600 dark:text-red-400 p-3.5 rounded-xl flex gap-2 items-start">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{authError}</span>
                </motion.div>
              )}

              <div className="space-y-4">
                {/* Google sign-in is for CITIZENS only — staff/admin use email+password. */}
                {loginRoleTab === "citizen" && (
                  <>
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={authLoading}
                      className="w-full bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 text-sm font-bold py-3.5 px-4 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 cursor-pointer shadow-sm hover:shadow-md"
                    >
                      <img
                        src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                        alt="Google logo"
                        className="w-5 h-5"
                      />
                      <span>Continue with Google</span>
                    </button>

                    <div className="relative flex py-4 items-center">
                      <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                      <span className="flex-shrink mx-4 text-[10px] uppercase font-bold tracking-widest text-gray-400 dark:text-gray-500">
                        OR
                      </span>
                      <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                    </div>
                  </>
                )}

                {isAuthMode === "register" && otpStep === "code" ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-3 duration-200">
                    <div className="text-center">
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        Enter the 6-digit code we sent to
                      </p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white break-all">
                        {email}
                      </p>
                      {otpDevHint && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-semibold">
                          {otpDevHint}
                        </p>
                      )}
                    </div>
                    <input
                      inputMode="numeric"
                      autoFocus
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) =>
                        setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="••••••"
                      className="block w-full text-center tracking-[0.5em] text-lg font-bold px-4 py-3.5 bg-white/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary text-gray-900 dark:text-white"
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center">
                      Didn't get it? Check your <strong>spam / junk</strong> folder
                      (it can take a minute to arrive).
                    </p>
                    <button
                      onClick={handleVerifyOtp}
                      disabled={authLoading || otpCode.length !== 6}
                      className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-2xl text-sm transition-all duration-300 cursor-pointer shadow-md disabled:opacity-60 flex items-center justify-center"
                    >
                      {authLoading ? (
                        <img src="/civic-logo.svg" className="w-5 h-5 animate-pulse invert" alt="Loading" />
                      ) : (
                        "Verify & Create Account"
                      )}
                    </button>
                    <div className="flex justify-between text-xs">
                      <button
                        onClick={() => {
                          setOtpStep("form");
                          setOtpCode("");
                          setAuthError(null);
                        }}
                        className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold"
                      >
                        ← Back
                      </button>
                      <button
                        onClick={(e) => handleEmailRegister(e as unknown as React.FormEvent)}
                        disabled={authLoading || resendCooldown > 0}
                        className="text-primary font-semibold hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        {resendCooldown > 0
                          ? `Resend in ${resendCooldown}s`
                          : "Resend code"}
                      </button>
                    </div>
                  </div>
                ) : (
                <form
                  onSubmit={isAuthMode === "login" ? handleEmailLogin : handleEmailRegister}
                  className="space-y-4"
                >
                  {isAuthMode === "register" && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="relative">
                      <input
                        type="text"
                        id="name"
                        placeholder=" "
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="block w-full px-4 py-3.5 text-sm bg-white/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl appearance-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent peer text-gray-900 dark:text-white backdrop-blur-sm transition-all"
                      />
                      <label htmlFor="name" className="absolute text-sm text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-transparent px-2 peer-focus:px-2 peer-placeholder-shown:scale-100 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:top-1/2 peer-focus:top-2 peer-focus:scale-75 peer-focus:-translate-y-4 left-2">Full Name</label>
                    </motion.div>
                  )}
                  <div className="relative">
                    <input
                      type="email"
                      id="email"
                      placeholder=" "
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="block w-full px-4 py-3.5 text-sm bg-white/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl appearance-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent peer text-gray-900 dark:text-white backdrop-blur-sm transition-all"
                    />
                    <label htmlFor="email" className="absolute text-sm text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-transparent px-2 peer-focus:px-2 peer-placeholder-shown:scale-100 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:top-1/2 peer-focus:top-2 peer-focus:scale-75 peer-focus:-translate-y-4 left-2">Email Address</label>
                  </div>
                  <div className="relative">
                    <input
                      type="password"
                      id="password"
                      placeholder=" "
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="block w-full px-4 py-3.5 text-sm bg-white/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl appearance-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent peer text-gray-900 dark:text-white backdrop-blur-sm transition-all"
                    />
                    <label htmlFor="password" className="absolute text-sm text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-transparent px-2 peer-focus:px-2 peer-placeholder-shown:scale-100 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:top-1/2 peer-focus:top-2 peer-focus:scale-75 peer-focus:-translate-y-4 left-2">Password</label>
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-2xl text-sm transition-all duration-300 cursor-pointer shadow-md hover:shadow-lg disabled:opacity-70 flex items-center justify-center"
                  >
                    {authLoading ? (
                      <img src="/civic-logo.svg" className="w-5 h-5 animate-pulse invert" alt="Loading" />
                    ) : (
                      isAuthMode === "login" ? "Sign In" : "Send Verification Code"
                    )}
                  </button>
                </form>
                )}

                {/* Staff are allowlisted, not self-registered — no sign-up here. */}
                {loginRoleTab !== "staff" && (
                  <div className="text-center mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAuthMode(isAuthMode === "login" ? "register" : "login");
                        setOtpStep("form");
                        setOtpCode("");
                        setAuthError(null);
                      }}
                      className="text-xs text-primary hover:text-primary-dark dark:hover:text-primary-light font-semibold transition-colors"
                    >
                      {isAuthMode === "login"
                        ? "Need an account? Sign up"
                        : "Already have an account? Sign in"}
                    </button>
                  </div>
                )}
                
                {/* Guest access is CITIZEN-only — there is no staff/admin guest path. */}
                {loginRoleTab === "citizen" && (
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700 text-center">
                    <button
                      onClick={handleInstantGuestSignIn}
                      disabled={authLoading}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition-colors flex items-center justify-center gap-1.5 mx-auto"
                    >
                      <span>Continue as Guest</span>
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        ) : (
          <div
            className={
              activeTab === "map" ? "absolute inset-0" : "space-y-6 pb-32"
            }
            style={activeTab !== "map" ? { paddingBottom: 'calc(8rem + env(safe-area-inset-bottom))' } : undefined}
          >
            <div
              className={
                activeTab === "map"
                  ? "h-full w-full"
                  : "transition-all duration-300"
              }
            >
              <Suspense fallback={
                <div className="flex flex-col items-center justify-center h-64 space-y-4">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 border-2 border-primary/20 border-t-primary rounded-full animate-spin w-16 h-16 -m-3"></div>
                    <img src="/civic-logo.svg" className="w-10 h-10 animate-pulse dark:invert opacity-80 z-10" alt="Loading view" />
                  </div>
                  <p className="text-sm text-gray-500 font-medium animate-pulse mt-4">Loading...</p>
                </div>
              }>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={activeTab === "map" ? "h-full w-full" : ""}
                  >
                    {activeTab === "reporter" && (
                      <Reporter currentUser={user} onSuccess={handleReportScored} isDarkMode={isDarkMode} />
                    )}
                    {activeTab === "map" && (
                      <CommandMap
                        issues={issues}
                        currentUser={user}
                        scope={scope}
                        selectedIssueFromParent={selectedIssueFromParent}
                        isDarkMode={isDarkMode}
                      />
                    )}
                    {activeTab === "impact" && (
                      <ImpactDashboard currentUser={user} currentProfile={profile} issues={issues} />
                    )}
                    {activeTab === "staff-list" && (
                      <StaffReportsList
                        issues={scopedIssues}
                        scope={scope}
                        currentUser={user}
                        onSelectIssue={(issue) => setSelectedIssueFromParent(issue)}
                        onSetTab={(tab) => setActiveTab(tab)}
                      />
                    )}
                    {activeTab === "staff-analytics" && (
                      <StaffDashboard issues={scopedIssues} scope={scope} />
                    )}
                    {activeTab === "staff-kanban" && (
                      <SmartAssignmentBoard
                        issues={scopedIssues}
                        currentUser={user}
                        scope={scope}
                      />
                    )}
                    {activeTab === "admin" && isAdminAccount && (
                      <AdminPanel currentUser={user} issues={issues} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </div>
          </div>
        )}
      </main>

      {user && profile && !isStaff && (
        <Suspense fallback={null}>
          <CivicAssistant currentUser={user} issues={issues} />
        </Suspense>
      )}

      {/* FLOATING NAVIGATION */}
      {user && profile && (
        <div 
          className="fixed bottom-6 left-0 right-0 z-40 pointer-events-none flex justify-center px-4"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="glass-nav rounded-full p-1.5 flex gap-1 items-center pointer-events-auto shadow-xl max-w-[calc(100vw-2rem)] overflow-x-auto no-scrollbar">
            {!isStaff && (
              <button
                onClick={() => setActiveTab("reporter")}
                className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
              >
                {activeTab === "reporter" && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
                <Camera
                  className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "reporter" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                />
                <span
                  className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "reporter" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                >
                  Report
                </span>
              </button>
            )}

            <button
              onClick={() => {
                setActiveTab("map");
                setSelectedIssueFromParent(null);
              }}
              className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
            >
              {activeTab === "map" && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
              <Map
                className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "map" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
              />
              <span
                className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "map" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
              >
                Map
              </span>
            </button>

            {isStaff && (
              <>
                <button
                  onClick={() => setActiveTab("staff-analytics")}
                  className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
                >
                  {activeTab === "staff-analytics" && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 25,
                      }}
                    />
                  )}
                  <Activity
                    className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "staff-analytics" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                  />
                  <span
                    className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "staff-analytics" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                  >
                    Analytics
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("staff-kanban")}
                  className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
                >
                  {activeTab === "staff-kanban" && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 25,
                      }}
                    />
                  )}
                  <LayoutDashboard
                    className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "staff-kanban" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                  />
                  <span
                    className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "staff-kanban" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                  >
                    Board
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("staff-list")}
                  className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
                >
                  {activeTab === "staff-list" && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 25,
                      }}
                    />
                  )}
                  <ClipboardList
                    className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "staff-list" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                  />
                  <span
                    className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "staff-list" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                  >
                    Archive
                  </span>
                </button>
              </>
            )}

            {!isStaff && (
              <button
                onClick={() => setActiveTab("impact")}
                className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
              >
                {activeTab === "impact" && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
                <Trophy
                  className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "impact" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                />
                <span
                  className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "impact" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                >
                  Impact
                </span>
              </button>
            )}

            {isAdminAccount && (
              <button
                onClick={() => setActiveTab("admin")}
                className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer group flex items-center gap-2"
              >
                {activeTab === "admin" && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-[#2F6F6A] rounded-full"
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
                <ShieldCheck
                  className={`w-4 h-4 relative z-10 transition-colors ${activeTab === "admin" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                />
                <span
                  className={`relative z-10 transition-colors hidden sm:inline-block ${activeTab === "admin" ? "text-white" : "text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white"}`}
                >
                  Admin
                </span>
              </button>
            )}

            {/* Dark mode toggle built into nav */}
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-700 mx-1"></div>
            <button
              onClick={toggleDarkMode}
              className="relative p-2.5 rounded-full transition-colors cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10"
              title="Toggle Theme"
            >
              {isDarkMode ? (
                <Sun className="w-4 h-4 text-gray-300" />
              ) : (
                <Moon className="w-4 h-4 text-gray-600" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Profile & Leaderboard Modal */}
      {activeModal === "profile" && profile && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-2xl w-full p-4 sm:p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Profile Header */}
            <div className="flex flex-col sm:flex-row items-center gap-5 pb-6 border-b border-gray-100 dark:border-gray-800">
              <div className="w-20 h-20 rounded-full border-4 border-gray-50 dark:border-gray-800 overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-inner shrink-0">
                <img
                  src={
                    profile.photoURL ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.uid}`
                  }
                  alt="Profile Avatar"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="text-center sm:text-left space-y-1">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {profile.displayName}
                </h3>
                <p className="text-xs text-[#717171] dark:text-gray-400 font-mono">
                  {user?.email || "guest@civic.local"}
                </p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <span className="px-3 py-1 bg-[#1A1A1A] dark:bg-gray-800 text-white text-[10px] font-bold uppercase tracking-widest rounded-full">
                    {profile.civicRank}
                  </span>
                  <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 text-[10px] font-bold uppercase tracking-widest rounded-full">
                    {profile.impactPoints} Impact Points
                  </span>
                </div>
              </div>
            </div>

            {/* Change Profile Picture */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#717171] uppercase tracking-wider">
                Change Profile Avatar
              </h4>
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                {[
                  "star",
                  "gear",
                  "bolt",
                  "spark",
                  "shield",
                  "heart",
                  "leaf",
                  "gem",
                  "sun",
                  "moon",
                ].map((seed) => {
                  const targetUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
                  const isSelected = profile.photoURL === targetUrl;
                  return (
                    <button
                      key={seed}
                      onClick={() => handleUpdateAvatar(seed)}
                      className={`w-10 h-10 rounded-full border-2 overflow-hidden hover:scale-105 transition-all bg-gray-50 dark:bg-gray-800 flex items-center justify-center p-1 cursor-pointer ${isSelected ? "border-gray-900 dark:border-white scale-105 ring-2 ring-gray-900/10 dark:ring-white/10" : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"}`}
                      title={`Select ${seed} avatar`}
                    >
                      <img
                        src={targetUrl}
                        alt={seed}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
              <form
                onSubmit={handleCustomAvatarSubmit}
                className="flex gap-2 max-w-sm pt-1"
              >
                <input
                  type="text"
                  placeholder="Or enter a custom seed name..."
                  value={customSeed}
                  onChange={(e) => setCustomSeed(e.target.value)}
                  className="flex-1 text-xs px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-gray-900 dark:focus:border-gray-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                <button
                  type="submit"
                  className="bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-gray-900 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  Apply
                </button>
              </form>
            </div>

            {/* Badges panel — all acquirable badges; earned ones in colour,
                hover shows how to earn each. */}
            <div className="space-y-3 pt-5 border-t border-gray-100 dark:border-gray-800">
              <h4 className="text-xs font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                Badges
                <span className="ml-1 text-[10px] text-gray-400 normal-case tracking-normal">
                  {BADGES.filter((b) => b.earned(badgeStats)).length}/
                  {BADGES.length} earned
                </span>
              </h4>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
                {BADGES.map((b) => {
                  const earned = b.earned(badgeStats);
                  return (
                    <div
                      key={b.id}
                      className="relative group flex flex-col items-center gap-1.5"
                    >
                      <BadgeMedal badge={b} earned={earned} size={46} />
                      <span
                        className="text-[8px] font-bold text-center leading-tight text-gray-600 dark:text-gray-400 w-full line-clamp-2"
                        title={b.name}
                      >
                        {b.name}
                      </span>
                      <div className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-44 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <div className="bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-snug rounded-lg px-2.5 py-1.5 shadow-xl text-center">
                          <span className="font-bold block mb-0.5">
                            {b.name}
                            {earned ? " · Earned ✓" : ""}
                          </span>
                          {b.requirement}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Rank Progression / Levels */}
              <div className="space-y-4 border-r border-gray-100 pr-0 md:pr-6">
                <h4 className="text-xs font-bold text-[#717171] uppercase tracking-wider flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-500" />
                  Civic Rank Ledger
                </h4>
                <div className="space-y-2 text-xs">
                  {[
                    {
                      title: "Metropolitan Guardian",
                      min: 500,
                      desc: "Supreme municipal supervisor.",
                    },
                    {
                      title: "Urban Architect",
                      min: 300,
                      desc: "Trusted regional planner.",
                    },
                    {
                      title: "Neighbourhood Champion",
                      min: 150,
                      desc: "Local community driver.",
                    },
                    {
                      title: "Local Vigilante",
                      min: 50,
                      desc: "Active municipal checker.",
                    },
                    {
                      title: "Civic Novice",
                      min: 0,
                      desc: "Entry-level civic reporter.",
                    },
                  ].map((lvl) => {
                    const isCurrent = profile.civicRank === lvl.title;
                    const isPassed = profile.impactPoints >= lvl.min;
                    return (
                      <div
                        key={lvl.title}
                        className={`p-3 rounded-xl border transition-all ${isCurrent ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white shadow-md" : isPassed ? "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700" : "bg-gray-50/50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 border-gray-100 dark:border-gray-800"}`}
                      >
                        <div className="flex justify-between items-center font-semibold text-[11px]">
                          <span className="truncate pr-1">{lvl.title}</span>
                          <span
                            className={
                              isCurrent ? "text-amber-300 dark:text-amber-600" : "text-gray-500 dark:text-gray-400"
                            }
                          >
                            {lvl.min}+ pts
                          </span>
                        </div>
                        <p
                          className={`text-[10px] mt-0.5 ${isCurrent ? "text-gray-200 dark:text-gray-700" : "text-gray-400 dark:text-gray-500"}`}
                        >
                          {lvl.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Local Leaderboard Simulation (City-wise) */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-[#717171] uppercase tracking-wider flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    Local Leaderboard
                  </h4>
                  <div className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider">
                    <button
                      onClick={() => setLeaderboardCity("Bangalore")}
                      className={`px-2.5 py-1 rounded-md transition-colors ${leaderboardCity === "Bangalore" ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
                    >
                      Bangalore
                    </button>
                    <button
                      onClick={() => setLeaderboardCity("Other")}
                      className={`px-2.5 py-1 rounded-md transition-colors ${leaderboardCity === "Other" ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
                    >
                      Other
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {getDynamicLeaderboard(leaderboardCity).map((entry) => (
                    <div
                      key={
                        entry.isCurrent
                          ? "current-user-lb"
                          : `${entry.displayName}-${entry.rank}`
                      }
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${entry.isCurrent ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-300 dark:ring-emerald-700 shadow-sm" : "bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-800"}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center font-bold font-mono text-[10px] ${entry.rank === 1 ? "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-400" : entry.rank === 2 ? "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-300" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"}`}
                        >
                          {entry.rank}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 dark:text-white truncate flex items-center gap-1">
                            {entry.displayName}
                            {entry.isCurrent && (
                              <span className="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-widest scale-90 shrink-0">
                                You
                              </span>
                            )}
                          </p>
                          <p className="text-[9px] text-gray-400 font-medium truncate uppercase">
                            {entry.civicRank}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-gray-900 dark:text-white font-mono text-xs">
                          {entry.impactPoints}{" "}
                          <span className="text-[10px] text-[#717171] dark:text-gray-500 font-sans font-normal">
                            pts
                          </span>
                        </p>
                        <p className="text-[9px] text-gray-400 font-medium">
                          {entry.reportsCount} reports
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* My Reports List Modal */}
      {activeModal === "my-reports" && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-4xl w-full p-4 sm:p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="text-xl font-light tracking-tight text-gray-900 dark:text-white">
                Your Civic Reports
              </h3>
              <p className="text-xs text-[#717171] dark:text-gray-400 mt-1">
                Review and locate all municipal infrastructure filings under
                your account.
              </p>
            </div>

            {issues.filter((i) => i.reportedByUid === user?.uid).length ===
            0 ? (
              <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 space-y-3 p-6">
                <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
                <h4 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">
                  No Filings Logged
                </h4>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                  You haven't logged any infrastructure issues under this
                  session yet. Access the Reporter tab to submit a live image!
                </p>
                <button
                  onClick={() => {
                    setActiveModal(null);
                    setActiveTab("reporter");
                  }}
                  className="bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-gray-900 text-[10px] font-bold uppercase tracking-widest px-5 py-2.5 rounded-full transition-all cursor-pointer shadow-sm"
                >
                  File First Report
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-2xl">
                <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800 text-left text-xs">
                  <thead className="bg-gray-50/75 dark:bg-gray-800/30">
                    <tr>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Visual
                      </th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Issue Detail
                      </th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Authority Department
                      </th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Civic Status
                      </th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                        Upvotes
                      </th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 font-medium">
                    {issues
                      .filter((i) => i.reportedByUid === user?.uid)
                      .map((issue) => (
                        <tr
                          key={issue.id}
                          className="hover:bg-gray-50/25 dark:hover:bg-gray-800/50 transition-colors"
                        >
                          <td className="px-5 py-3 whitespace-nowrap">
                            <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                              {issue.imageUrl ? (
                                <img
                                  src={issue.imageUrl}
                                  alt={issue.category}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800">
                                  No Image
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 max-w-xs">
                            <p className="font-semibold text-gray-900 dark:text-white">
                              {issue.category}
                            </p>
                            <p className="text-[10px] text-[#717171] dark:text-gray-400 line-clamp-1 mt-0.5">
                              "{issue.description}"
                            </p>
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-[#717171] dark:text-gray-400">
                            {issue.recommendedDepartment ||
                              "General Operations"}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-full border ${getStatusBadgeStyle(issue.status)}`}
                            >
                              {getStatusLabel(issue.status)}
                            </span>
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-center font-mono text-gray-900 font-bold">
                            {issue.upvotesCount || 0}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-right">
                            <button
                              onClick={() => {
                                setSelectedIssueFromParent(issue);
                                setActiveTab("map");
                                setActiveModal(null);
                              }}
                              className="text-xs text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider flex items-center gap-1 ml-auto cursor-pointer"
                            >
                              Show on Map
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Staff security / 2FA */}
      {activeModal === "security" && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-md w-full p-6 md:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-display font-bold tracking-tight text-gray-900 dark:text-white mb-5">
              Account Security
            </h3>
            <TwoFactorSettings currentUser={user} isAdmin={isAdminAccount} />
          </div>
        </div>
      )}

      {/* Notifications page */}
      {activeModal === "notifications" && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-2xl w-full p-6 md:p-8 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="text-xl font-display font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
                <Bell className="w-5 h-5 text-red-500" />
                Notifications
              </h3>
              <p className="text-xs text-[#717171] dark:text-gray-400 mt-1">
                Status updates on every issue you've reported.
              </p>
            </div>

            {userNotifications.length === 0 ? (
              <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 space-y-3">
                <Bell className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  You're all caught up
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                  When the status of a report you filed changes, it'll show up here.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {userNotifications.map((n) => {
                  const issue = n.issueId
                    ? issues.find((i) => i.id === n.issueId)
                    : undefined;
                  const meta = {
                    status: { label: "Status", Icon: Activity, cls: "text-blue-500 bg-blue-50 dark:bg-blue-900/30" },
                    watch: { label: "Neighbourhood Watch", Icon: AlertCircle, cls: "text-amber-500 bg-amber-50 dark:bg-amber-900/30" },
                    petition: { label: "Petition", Icon: FileText, cls: "text-rose-500 bg-rose-50 dark:bg-rose-900/30" },
                    mission: { label: "Mission", Icon: Sparkles, cls: "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30" },
                  }[n.kind];
                  const KindIcon = meta.Icon;
                  return (
                    <div
                      key={n.id}
                      className="flex items-start gap-3 p-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div
                        className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center ${meta.cls}`}
                      >
                        <KindIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                          {meta.label}
                        </p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                          {n.message}
                        </p>
                        <span className="text-[10px] text-gray-400">
                          {new Date(n.time).toLocaleString()}
                        </span>
                      </div>
                      {issue && (
                        <button
                          onClick={() => {
                            setSelectedIssueFromParent(issue);
                            setActiveTab("map");
                            setActiveModal(null);
                          }}
                          className="shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer mt-1"
                        >
                          View
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
