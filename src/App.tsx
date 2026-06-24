/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  auth,
  db,
  syncCitizenProfile,
  rewardImpactPoints,
} from "./lib/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
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
import { CitizenProfile, CivicIssue } from "./types";

const Reporter = lazy(() => import("./components/Reporter"));
const CommandMap = lazy(() => import("./components/CommandMap"));
const ImpactDashboard = lazy(() => import("./components/ImpactDashboard"));
const StaffReportsList = lazy(() => import("./components/StaffReportsList"));
const StaffDashboard = lazy(() => import("./components/StaffDashboard"));
const SmartAssignmentBoard = lazy(() => import("./components/SmartAssignmentBoard"));
const CivicAssistant = lazy(() => import("./components/CivicAssistant"));

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
} from "lucide-react";

type TabType = "reporter" | "map" | "impact" | "staff-list" | "staff-analytics" | "staff-kanban";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [issues, setIssues] = useState<CivicIssue[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("reporter");
  const [loginRoleTab, setLoginRoleTab] = useState<"citizen" | "staff">(
    "citizen",
  );
  const [selectedIssueFromParent, setSelectedIssueFromParent] =
    useState<CivicIssue | null>(null);

  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [activeModal, setActiveModal] = useState<
    "profile" | "my-reports" | null
  >(null);
  const [leaderboardCity, setLeaderboardCity] = useState<"Bangalore" | "Other">(
    "Bangalore",
  );
  const [customSeed, setCustomSeed] = useState<string>("");

  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [isNotificationsExpanded, setIsNotificationsExpanded] = useState<boolean>(false);

  const [isAuthMode, setIsAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  const userNotifications = issues
    .filter((i) => i.reportedByUid === user?.uid && i.status !== "Reported")
    .map((i) => ({
      id: i.id,
      message: `Your ${i.category} report is now ${i.status}.`,
      time: i.reportedAt,
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 5);
    
  const currentUserIssues = issues.filter(i => i.reportedByUid === user?.uid);
  const liveReportsCount = currentUserIssues.length;
  const liveImpactPoints = 20 + currentUserIssues.reduce((sum, i) => sum + 10 + (i.status === "Resolved" ? 50 : 0), 0);

  useEffect(() => {
    // If a sandbox session was stored previously, initialize it right away
    const initSandbox = async () => {
      if (localStorage.getItem("civic_sandbox_session") === "true") {
        const mockUser = {
          uid: "sandbox-dev-citizen",
          displayName: "Sandbox Developer",
          email: "developer@civic.local",
          photoURL:
            "https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen",
        } as any;
        setUser(mockUser);
        try {
          const userProfile = await syncCitizenProfile(mockUser, "citizen");
          setProfile(userProfile);
          if (userProfile.role === "staff") setActiveTab("map");
        } catch (err) {
          setProfile({
            uid: "sandbox-dev-citizen",
            displayName: "Sandbox Developer",
            photoURL:
              "https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen",
            joinedAt: Date.now(),
            impactPoints: 120,
            civicRank: "Neighbourhood Champion",
            reportsCount: 4,
            role: "citizen",
          });
        }
      }
    };
    initSandbox();

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true);
      if (firebaseUser) {
        localStorage.removeItem("civic_sandbox_session");
        setUser(firebaseUser);
        try {
          const userProfile = await syncCitizenProfile(
            firebaseUser,
            loginRoleTab,
          );
          setProfile(userProfile);
          if (userProfile.role === "staff" || loginRoleTab === "staff")
            setActiveTab("map");
        } catch (err) {}
      } else {
        setUser((prev) => {
          if (prev && prev.uid === "sandbox-dev-citizen") return prev;
          return null;
        });
        setProfile((prev) => {
          if (prev && prev.uid === "sandbox-dev-citizen") return prev;
          return null;
        });
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
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === "staff" || loginRoleTab === "staff") setActiveTab("map");
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, {
        displayName: name || email.split("@")[0],
        photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${cred.user.uid}`,
      });
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === "staff" || loginRoleTab === "staff") setActiveTab("map");
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === "staff" || loginRoleTab === "staff") setActiveTab("map");
    } catch (err: any) {
      setAuthError("Sign in popup blocked or failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    localStorage.removeItem("civic_sandbox_session");
    setUser(null);
    setProfile(null);
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
      const cred = await signInAnonymously(auth);
      await updateProfile(cred.user, {
        displayName: `Hero_${Math.floor(1000 + Math.random() * 9000)}`,
        photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${cred.user.uid}`,
      });
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === "staff" || loginRoleTab === "staff") setActiveTab("map");
    } catch (err: any) {
      console.warn(
        "Anonymous sign-in failed. Activating local sandbox resilient developer access...",
        err,
      );
      // Fallback: If Firebase Anonymous sign-in is disabled, instantly fallback to sandbox developer flow
      try {
        localStorage.setItem("civic_sandbox_session", "true");
        const mockUser = {
          uid: "sandbox-dev-citizen",
          displayName: "Sandbox Developer",
          email: "developer@civic.local",
          photoURL:
            "https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen",
        } as any;
        setUser(mockUser);
        const userProfile = await syncCitizenProfile(mockUser, loginRoleTab);
        setProfile(userProfile);
        if (userProfile.role === "staff" || loginRoleTab === "staff")
          setActiveTab("map");
      } catch (fallbackErr: any) {
        // Even if Firestore fails, give them a simulated full mock profile
        setProfile({
          uid: "sandbox-dev-citizen",
          displayName: "Sandbox Developer",
          photoURL:
            "https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen",
          joinedAt: Date.now(),
          impactPoints: 20,
          civicRank: "Civic Novice",
          reportsCount: 0,
          role: loginRoleTab,
        });
        if (loginRoleTab === "staff") setActiveTab("map");
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
      case "In Progress":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "Corroborated Report":
      case "Corroborated":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "Auto-Routed":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "Requires Human Verification":
      case "Verify Report":
        return "bg-rose-50 text-rose-700 border-rose-200";
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col justify-between font-sans text-[#1A1A1A] dark:text-white transition-colors duration-300">
      <header className="h-16 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-[#E5E5E5] dark:border-gray-800 flex items-center justify-between px-6 z-10 w-full sticky top-0">
        <div className="flex items-center gap-3">
          <img src="/civic-wordmark.svg" alt="CIVIC" className="h-6 sm:h-7 dark:invert" />
        </div>

        <div className="flex items-center gap-4 relative">
          {user ? (
            <div className="relative flex items-center gap-2">
              {profile?.role !== "staff" && (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-[#4A4A4A] dark:text-gray-400 uppercase tracking-wider">
                    Civic Rank
                  </div>
                  <div className="text-sm text-[#717171] dark:text-gray-300">
                    {profile?.civicRank || "Civic Novice"}
                  </div>
                </div>
              )}
              {profile?.role === "staff" && (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    Staff Role
                  </div>
                  <div className="text-sm text-blue-700 dark:text-blue-300 font-semibold">
                    Municipal Administrator
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
                    <div 
                      className={`px-4 py-2 border-b border-[#F0F0F0] dark:border-gray-800 bg-red-50/50 dark:bg-red-900/10 ${userNotifications.length > 1 ? 'cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors' : ''}`}
                      onClick={() => {
                        if (userNotifications.length > 1) {
                          setIsNotificationsExpanded(!isNotificationsExpanded);
                        }
                      }}
                      role={userNotifications.length > 1 ? "button" : "region"}
                      tabIndex={userNotifications.length > 1 ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (userNotifications.length > 1) setIsNotificationsExpanded(!isNotificationsExpanded);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <Bell className="w-3 h-3" /> Notifications
                        </p>
                        {userNotifications.length > 1 && (
                          <span className="text-[10px] text-red-600/70 dark:text-red-400/70 font-semibold">
                            {isNotificationsExpanded ? "Show Less" : `+${userNotifications.length - 1} more`}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {(isNotificationsExpanded ? userNotifications : [userNotifications[0]]).map((n) => (
                          <div key={n.id} className="text-xs text-gray-800 dark:text-gray-200">
                            <span className="font-semibold block">{n.message}</span>
                            <span className="text-[9px] text-gray-500">{new Date(n.time).toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {profile?.role !== "staff" ? (
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
                    <div className="px-4 py-2 text-[9px] font-bold text-blue-600 bg-blue-50/50 uppercase tracking-widest my-1 text-center rounded-lg mx-2">
                      Municipal Administrator
                    </div>
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
        className={`${activeTab === "map" && user ? "flex-1 w-full relative" : (!user ? "flex-1 w-full flex flex-col sm:max-w-7xl sm:mx-auto sm:px-4 sm:py-8" : "max-w-7xl mx-auto px-4 py-8 flex-1 w-full flex flex-col gap-6")}`}
      >
        {!user ? (
          <div className="flex-1 w-full flex items-center justify-center relative overflow-hidden bg-gray-50 dark:bg-gray-900 sm:rounded-3xl mx-auto my-auto max-w-7xl h-full sm:h-[90vh] sm:max-h-[900px]">
            {/* Animated background gradient */}
            <motion.div
              className="absolute inset-0 z-0 opacity-40 dark:opacity-60"
              animate={{
                background: [
                  "radial-gradient(circle at 0% 0%, var(--color-brand-teal) 0%, transparent 50%)",
                  "radial-gradient(circle at 100% 100%, var(--color-brand-blue) 0%, transparent 50%)",
                  "radial-gradient(circle at 0% 100%, var(--color-brand-teal-light) 0%, transparent 50%)",
                  "radial-gradient(circle at 100% 0%, var(--color-brand-ink) 0%, transparent 50%)",
                  "radial-gradient(circle at 0% 0%, var(--color-brand-teal) 0%, transparent 50%)",
                ]
              }}
              transition={{ duration: 20, ease: "linear", repeat: Infinity }}
            />
            
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="max-w-md w-full mx-auto glass-card rounded-t-[2rem] sm:rounded-[2rem] overflow-y-auto p-6 sm:p-10 space-y-6 sm:space-y-8 z-10 mt-12 sm:m-4 shadow-2xl backdrop-blur-xl bg-white/70 dark:bg-gray-900/70 border border-white/20 dark:border-gray-800/50 absolute bottom-0 sm:relative sm:bottom-auto h-auto max-h-[85vh] sm:max-h-[calc(100%-2rem)] flex flex-col"
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
                  onClick={() => setLoginRoleTab("citizen")}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${loginRoleTab === "citizen" ? "bg-white dark:bg-gray-700 shadow-md text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-gray-700/50"}`}
                >
                  Citizen
                </button>
                <button
                  onClick={() => setLoginRoleTab("staff")}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${loginRoleTab === "staff" ? "bg-white dark:bg-gray-700 shadow-md text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-gray-700/50"}`}
                >
                  Staff
                </button>
              </div>

              {authError && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 text-xs text-red-600 dark:text-red-400 p-3.5 rounded-xl flex gap-2 items-start">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{authError}</span>
                </motion.div>
              )}

              <div className="space-y-4">
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
                      isAuthMode === "login" ? "Sign In" : "Create Account"
                    )}
                  </button>
                </form>

                <div className="text-center mt-6">
                  <button
                    onClick={() => setIsAuthMode(isAuthMode === "login" ? "register" : "login")}
                    className="text-xs text-primary hover:text-primary-dark dark:hover:text-primary-light font-semibold transition-colors"
                  >
                    {isAuthMode === "login"
                      ? "Need an account? Sign up"
                      : "Already have an account? Sign in"}
                  </button>
                </div>
                
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700 text-center">
                   <button
                    onClick={handleInstantGuestSignIn}
                    disabled={authLoading}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition-colors flex items-center justify-center gap-1.5 mx-auto"
                  >
                    <span>
                      {loginRoleTab === "staff"
                        ? "Explore as Staff (Guest)"
                        : "Continue as Guest"}
                    </span>
                  </button>
                </div>
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
                        selectedIssueFromParent={selectedIssueFromParent}
                        isDarkMode={isDarkMode}
                      />
                    )}
                    {activeTab === "impact" && (
                      <ImpactDashboard currentUser={user} currentProfile={profile} issues={issues} />
                    )}
                    {activeTab === "staff-list" && (
                      <StaffReportsList
                        issues={issues}
                        currentUser={user}
                        onSelectIssue={(issue) => setSelectedIssueFromParent(issue)}
                        onSetTab={(tab) => setActiveTab(tab)}
                      />
                    )}
                    {activeTab === "staff-analytics" && (
                      <StaffDashboard issues={issues} />
                    )}
                    {activeTab === "staff-kanban" && (
                      <SmartAssignmentBoard issues={issues} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </div>
          </div>
        )}
      </main>

      {user && profile && profile.role === "citizen" && (
        <Suspense fallback={null}>
          <CivicAssistant currentUser={user} />
        </Suspense>
      )}

      {/* FLOATING NAVIGATION */}
      {user && profile && (
        <div 
          className="fixed bottom-6 left-0 right-0 z-40 pointer-events-none flex justify-center px-4"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="glass-nav rounded-full p-1.5 flex gap-1 items-center pointer-events-auto shadow-xl">
            {profile.role !== "staff" && (
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

            {profile.role === "staff" && (
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

            {profile.role !== "staff" && (
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
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-2xl w-full p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
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
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-4xl w-full p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
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
    </div>
  );
}
