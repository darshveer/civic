/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  auth, 
  db, 
  syncCitizenProfile, 
  rewardImpactPoints 
} from './lib/firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  User
} from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { CitizenProfile, CivicIssue } from './types';

import Reporter from './components/Reporter';
import CommandMap from './components/CommandMap';
import ImpactDashboard from './components/ImpactDashboard';
import StaffReportsList from './components/StaffReportsList';

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
  Sparkles
} from 'lucide-react';

type TabType = 'reporter' | 'map' | 'impact' | 'staff-list';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [issues, setIssues] = useState<CivicIssue[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('reporter');
  const [loginRoleTab, setLoginRoleTab] = useState<'citizen' | 'staff'>('citizen');
  const [selectedIssueFromParent, setSelectedIssueFromParent] = useState<CivicIssue | null>(null);
  
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [activeModal, setActiveModal] = useState<'profile' | 'my-reports' | null>(null);
  const [leaderboardCity, setLeaderboardCity] = useState<'Bangalore' | 'Other'>('Bangalore');
  const [customSeed, setCustomSeed] = useState<string>('');

  const [isAuthMode, setIsAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  useEffect(() => {
    // If a sandbox session was stored previously, initialize it right away
    const initSandbox = async () => {
      if (localStorage.getItem('civic_sandbox_session') === 'true') {
        const mockUser = {
          uid: 'sandbox-dev-citizen',
          displayName: 'Sandbox Developer',
          email: 'developer@civic.local',
          photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen'
        } as any;
        setUser(mockUser);
        try {
          const userProfile = await syncCitizenProfile(mockUser, 'citizen');
          setProfile(userProfile);
          if (userProfile.role === 'staff') setActiveTab('map');
        } catch (err) {
          setProfile({
            uid: 'sandbox-dev-citizen',
            displayName: 'Sandbox Developer',
            photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen',
            joinedAt: Date.now(),
            impactPoints: 120,
            civicRank: 'Neighbourhood Champion',
            reportsCount: 4,
            role: 'citizen'
          });
        }
      }
    };
    initSandbox();

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true);
      if (firebaseUser) {
        localStorage.removeItem('civic_sandbox_session');
        setUser(firebaseUser);
        try {
          const userProfile = await syncCitizenProfile(firebaseUser, loginRoleTab);
          setProfile(userProfile);
          if (userProfile.role === 'staff' || loginRoleTab === 'staff') setActiveTab('map');
        } catch (err) { }
      } else {
        setUser(prev => {
          if (prev && prev.uid === 'sandbox-dev-citizen') return prev;
          return null;
        });
        setProfile(prev => {
          if (prev && prev.uid === 'sandbox-dev-citizen') return prev;
          return null;
        });
      }
      setAuthLoading(false);
    });

    const qIssues = query(collection(db, 'issues'), orderBy('reportedAt', 'desc'));
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

  const refreshProfileState = () => {
    if (user) {
      syncCitizenProfile(user).then((p) => setProfile(p)).catch(() => {});
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(null); setAuthLoading(true);
    try { 
      const cred = await signInWithEmailAndPassword(auth, email, password); 
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === 'staff' || loginRoleTab === 'staff') setActiveTab('map');
    } 
    catch (err: any) { setAuthError(err.message); } 
    finally { setAuthLoading(false); }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(null); setAuthLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name || email.split('@')[0], photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${cred.user.uid}` });
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === 'staff' || loginRoleTab === 'staff') setActiveTab('map');
    } 
    catch (err: any) { setAuthError(err.message); } 
    finally { setAuthLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null); setAuthLoading(true);
    try { 
      const cred = await signInWithPopup(auth, new GoogleAuthProvider()); 
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === 'staff' || loginRoleTab === 'staff') setActiveTab('map');
    } 
    catch (err: any) { setAuthError('Sign in popup blocked or failed.'); } 
    finally { setAuthLoading(false); }
  };

  const handleSignOut = async () => {
    localStorage.removeItem('civic_sandbox_session');
    setUser(null);
    setProfile(null);
    setActiveTab('reporter');
    setLoginRoleTab('citizen');
    setIsDropdownOpen(false);
    setActiveModal(null);
    try {
      await signOut(auth);
    } catch (e) {}
  };

  const handleInstantGuestSignIn = async () => {
    setAuthError(null); setAuthLoading(true);
    try {
      const cred = await signInAnonymously(auth);
      await updateProfile(cred.user, { displayName: `Hero_${Math.floor(1000 + Math.random() * 9000)}`, photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${cred.user.uid}` });
      const p = await syncCitizenProfile(cred.user, loginRoleTab);
      setProfile(p);
      if (p.role === 'staff' || loginRoleTab === 'staff') setActiveTab('map');
    } 
    catch (err: any) {
      console.warn("Anonymous sign-in failed. Activating local sandbox resilient developer access...", err);
      // Fallback: If Firebase Anonymous sign-in is disabled, instantly fallback to sandbox developer flow
      try {
        localStorage.setItem('civic_sandbox_session', 'true');
        const mockUser = {
          uid: 'sandbox-dev-citizen',
          displayName: 'Sandbox Developer',
          email: 'developer@civic.local',
          photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen'
        } as any;
        setUser(mockUser);
        const userProfile = await syncCitizenProfile(mockUser, loginRoleTab);
        setProfile(userProfile);
        if (userProfile.role === 'staff' || loginRoleTab === 'staff') setActiveTab('map');
      } catch (fallbackErr: any) {
        // Even if Firestore fails, give them a simulated full mock profile
        setProfile({
          uid: 'sandbox-dev-citizen',
          displayName: 'Sandbox Developer',
          photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=sandbox-dev-citizen',
          joinedAt: Date.now(),
          impactPoints: 20,
          civicRank: 'Civic Novice',
          reportsCount: 0,
          role: loginRoleTab
        });
        if (loginRoleTab === 'staff') setActiveTab('map');
      }
    } 
    finally {
      setAuthLoading(false);
    }
  };

  const handleReportScored = (newIssue: any) => {
    refreshProfileState();
    setActiveTab('map');
  };

  const handleUpdateAvatar = async (seed: string) => {
    if (!user || !profile) return;
    const nextPhotoURL = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
    try {
      const profileRef = doc(db, 'citizens', user.uid);
      await updateDoc(profileRef, { photoURL: nextPhotoURL });
      setProfile({ ...profile, photoURL: nextPhotoURL });
    } catch (err) {
      console.error('Failed to update avatar photo:', err);
    }
  };

  const handleCustomAvatarSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (customSeed.trim()) {
      await handleUpdateAvatar(customSeed.trim());
      setCustomSeed('');
    }
  };

  const BANGALORE_LEADERBOARD = [
    { rank: 1, displayName: 'Marie Curie', civicRank: 'Metropolitan Guardian', impactPoints: 620, reportsCount: 12, isCurrent: false },
    { rank: 2, displayName: 'Rahul Sharma', civicRank: 'Urban Architect', impactPoints: 410, reportsCount: 8, isCurrent: false },
    { rank: 3, displayName: 'Priya Patel', civicRank: 'Neighbourhood Champion', impactPoints: 280, reportsCount: 5, isCurrent: false },
    { rank: 4, displayName: 'Amit Singh', civicRank: 'Local Vigilante', impactPoints: 110, reportsCount: 2, isCurrent: false }
  ];

  const OTHER_LEADERBOARD = [
    { rank: 1, displayName: 'Jane Doe', civicRank: 'Urban Architect', impactPoints: 380, reportsCount: 7, isCurrent: false },
    { rank: 2, displayName: 'John Smith', civicRank: 'Neighbourhood Champion', impactPoints: 210, reportsCount: 4, isCurrent: false },
    { rank: 3, displayName: 'Alice Wonder', civicRank: 'Local Vigilante', impactPoints: 90, reportsCount: 1, isCurrent: false }
  ];

  const getDynamicLeaderboard = (city: 'Bangalore' | 'Other') => {
    const list = city === 'Bangalore' ? [...BANGALORE_LEADERBOARD] : [...OTHER_LEADERBOARD];
    
    if (profile) {
      const alreadyHasCurrent = list.some(item => item.isCurrent);
      if (!alreadyHasCurrent) {
        list.push({
          rank: 99,
          displayName: profile.displayName || 'You',
          civicRank: profile.civicRank || 'Civic Novice',
          impactPoints: profile.impactPoints || 20,
          reportsCount: profile.reportsCount || 0,
          isCurrent: true
        });
      }
    }
    
    list.sort((a, b) => b.impactPoints - a.impactPoints);
    
    return list.map((item, index) => ({
      ...item,
      rank: index + 1
    }));
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'Resolved':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'In Progress':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Corroborated Report':
      case 'Corroborated':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Auto-Routed':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Requires Human Verification':
      case 'Verify Report':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Reported':
      default:
        return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === 'Requires Human Verification') return 'Verify Report';
    if (status === 'Corroborated Report') return 'Corroborated';
    return status;
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col justify-between font-sans text-[#1A1A1A]">
      <header className="h-16 bg-white border-b border-[#E5E5E5] flex items-center justify-between px-8 z-10 w-full">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#4A4A4A] rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M3 21h18M3 7l9-4 9 4v10H3V7z"></path>
            </svg>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">C.I.V.I.C.</h1>
        </div>

        <div className="flex items-center gap-4 relative">
          {user ? (
            <div className="relative flex items-center gap-2">
              {profile?.role !== 'staff' && (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-[#4A4A4A] uppercase tracking-wider">Civic Rank</div>
                  <div className="text-sm text-[#717171]">{profile?.civicRank || 'Civic Novice'}</div>
                </div>
              )}
              {profile?.role === 'staff' && (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-wider">Staff Role</div>
                  <div className="text-sm text-blue-700 font-semibold">Municipal Administrator</div>
                </div>
              )}
              
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-10 h-10 rounded-full border-2 border-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden flex items-center justify-center bg-[#E5E5E5] focus:outline-none hover:ring-2 hover:ring-offset-2 hover:ring-[#1A1A1A] transition-all cursor-pointer"
                title="Account Menu"
              >
                <img src={profile?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`} alt="Citizen Avatar" className="w-full h-full object-cover" />
              </button>

              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="text-[#717171] hover:text-[#1A1A1A] p-0.5 transition-colors cursor-pointer"
                title="Toggle Menu"
              >
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 top-12 mt-2 w-56 bg-white rounded-2xl border border-[#E5E5E5] shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
                  <div className="px-4 py-3 border-b border-[#F0F0F0]">
                    <p className="text-[10px] text-[#717171] font-bold uppercase tracking-wider">Signed In As</p>
                    <p className="text-xs font-semibold text-[#1A1A1A] truncate">{profile?.displayName || 'Citizen Hero'}</p>
                    <p className="text-[9px] text-[#717171] font-mono truncate">{user.email || 'guest@civic.local'}</p>
                  </div>
                  
                  {profile?.role !== 'staff' ? (
                    <>
                      <button 
                        onClick={() => { setIsDropdownOpen(false); setActiveModal('profile'); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F5F5] transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <UserIcon className="w-4 h-4 text-[#717171]" />
                        My Profile & Leaderboard
                      </button>
                      <button 
                        onClick={() => { setIsDropdownOpen(false); setActiveModal('my-reports'); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F5F5] transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-[#717171]" />
                        My Reports ({profile?.reportsCount || 0})
                      </button>
                    </>
                  ) : (
                    <div className="px-4 py-2 text-[9px] font-bold text-blue-600 bg-blue-50/50 uppercase tracking-widest my-1 text-center rounded-lg mx-2">
                      Municipal Administrator
                    </div>
                  )}
                  
                  <div className="border-t border-[#F0F0F0] mt-1 pt-1">
                    <button 
                      onClick={() => { setIsDropdownOpen(false); handleSignOut(); }}
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
            <div className="text-xs text-[#717171] font-mono font-bold animate-pulse">● Awaiting Connection</div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 flex-1 w-full flex flex-col gap-6">
        {!user ? (
          <div className="max-w-sm w-full mx-auto bg-white rounded-2xl border border-[#E5E5E5] overflow-hidden p-8 space-y-6 self-center shadow-[-10px_0_15px_rgba(0,0,0,0.02)]">
            <div className="text-center space-y-2">
              <h2 id="civic-ledger-title" className="text-2xl font-light tracking-tight text-[#1A1A1A]">C.I.V.I.C Ledger</h2>
              <p className="text-[#717171] text-sm leading-normal">Join C.I.V.I.C. (Community Infrastructure Verification & Intelligent Clustering) to log visual infrastructure issues, claim points, and compare leaderboards.</p>
            </div>

            <div className="flex bg-[#F5F5F5] p-1 rounded-xl mb-6">
              <button 
                onClick={() => setLoginRoleTab('citizen')} 
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${loginRoleTab === 'citizen' ? 'bg-white shadow-sm text-[#1A1A1A]' : 'text-[#717171] hover:text-[#1A1A1A] hover:bg-[#E5E5E5]'}`}
              >
                Citizen Portal
              </button>
              <button 
                onClick={() => setLoginRoleTab('staff')} 
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${loginRoleTab === 'staff' ? 'bg-white shadow-sm text-[#1A1A1A]' : 'text-[#717171] hover:text-[#1A1A1A] hover:bg-[#E5E5E5]'}`}
              >
                Staff Access
              </button>
            </div>

            {authError && <div className="bg-[#FEE2E2] border border-[#FCA5A5] text-xs text-[#B91C1C] p-3 rounded-xl flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{authError}</span></div>}

            <div className="space-y-3">
              <button 
                onClick={handleInstantGuestSignIn} disabled={authLoading}
                className="w-full bg-[#1A1A1A] hover:bg-[#333333] text-white text-xs font-bold py-3.5 px-4 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" /><span>{loginRoleTab === 'staff' ? 'Simulate Staff Access' : 'Developer Access'}</span>
              </button>
              <button 
                onClick={handleGoogleSignIn} disabled={authLoading}
                className="w-full bg-white hover:bg-[#F5F5F5] text-[#1A1A1A] border border-[#E5E5E5] text-xs font-bold py-3 px-4 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" className="w-4 h-4" /><span>Google Connect</span>
              </button>
            </div>

            <div className="relative flex py-2 items-center text-[#E5E5E5]">
              <div className="flex-grow border-t border-[#E5E5E5]"></div>
              <span className="flex-shrink mx-3 text-[10px] uppercase font-bold tracking-widest text-[#9CA3AF] font-mono">OR EMAIL</span>
              <div className="flex-grow border-t border-[#E5E5E5]"></div>
            </div>

            <form onSubmit={isAuthMode === 'login' ? handleEmailLogin : handleEmailRegister} className="space-y-4">
              {isAuthMode === 'register' && (
                <div className="space-y-1">
                  <label className="text-[10px] text-[#717171] font-bold uppercase tracking-wider block">Full Name</label>
                  <input type="text" placeholder="e.g. Marie Curie" value={name} onChange={(e) => setName(e.target.value)} required className="w-full text-xs px-3 py-2.5 border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A]" />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] text-[#717171] font-bold uppercase tracking-wider block">Email Address</label>
                <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full text-xs px-3 py-2.5 border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A]" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-[#717171] font-bold uppercase tracking-wider block">Secret Password</label>
                <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="w-full text-xs px-3 py-2.5 border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A]" />
              </div>
              <button type="submit" disabled={authLoading} className="w-full bg-[#1A1A1A] hover:bg-[#333333] text-white font-bold py-3 rounded-full text-xs transition-all cursor-pointer">
                {authLoading ? 'Verifying...' : isAuthMode === 'login' ? 'Login' : 'Create Account'}
              </button>
            </form>

            <div className="text-center text-xs">
              {isAuthMode === 'login' ? (
                <p className="text-[#717171]">New here? <button onClick={() => setIsAuthMode('register')} className="text-[#1A1A1A] border-b border-[#1A1A1A] font-bold cursor-pointer">Register</button></p>
              ) : (
                <p className="text-[#717171]">Have an account? <button onClick={() => setIsAuthMode('login')} className="text-[#1A1A1A] border-b border-[#1A1A1A] font-bold cursor-pointer">Log In</button></p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex bg-white p-1 rounded-2xl border border-[#E5E5E5] max-w-sm mx-auto shadow-[0_1px_2px_rgba(0,0,0,0.02)] gap-1">
              {profile?.role !== 'staff' && (
                <button onClick={() => setActiveTab('reporter')} className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs flex justify-center items-center gap-2 transition-all cursor-pointer ${activeTab === 'reporter' ? 'bg-[#1A1A1A] text-white' : 'text-[#717171] hover:text-[#1A1A1A] hover:bg-[#F5F5F5]'}`}>
                  <Camera className="w-4 h-4" /><span>Reporter</span>
                </button>
              )}
              <button onClick={() => { setActiveTab('map'); setSelectedIssueFromParent(null); }} className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs flex justify-center items-center gap-2 transition-all cursor-pointer ${activeTab === 'map' ? 'bg-[#1A1A1A] text-white' : 'text-[#717171] hover:text-[#1A1A1A] hover:bg-[#F5F5F5]'}`}>
                <Map className="w-4 h-4" /><span>Command Map</span>
              </button>
              {profile?.role === 'staff' && (
                <button onClick={() => setActiveTab('staff-list')} className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs flex justify-center items-center gap-2 transition-all cursor-pointer ${activeTab === 'staff-list' ? 'bg-[#1A1A1A] text-white' : 'text-[#717171] hover:text-[#1A1A1A] hover:bg-[#F5F5F5]'}`}>
                  <ClipboardList className="w-4 h-4" /><span>Reports Archive</span>
                </button>
              )}
              {profile?.role !== 'staff' && (
                <button onClick={() => setActiveTab('impact')} className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs flex justify-center items-center gap-2 transition-all cursor-pointer ${activeTab === 'impact' ? 'bg-[#1A1A1A] text-white' : 'text-[#717171] hover:text-[#1A1A1A] hover:bg-[#F5F5F5]'}`}>
                  <Trophy className="w-4 h-4" /><span>Impact</span>
                </button>
              )}
            </div>

            <div className="transition-all duration-300">
              {activeTab === 'reporter' && <Reporter currentUser={user} onSuccess={handleReportScored} />}
              {activeTab === 'map' && <CommandMap issues={issues} currentUser={user} selectedIssueFromParent={selectedIssueFromParent} />}
              {activeTab === 'impact' && <ImpactDashboard currentUser={user} currentProfile={profile} />}
              {activeTab === 'staff-list' && (
                <StaffReportsList 
                  issues={issues} 
                  currentUser={user} 
                  onSelectIssue={(issue) => setSelectedIssueFromParent(issue)} 
                  onSetTab={(tab) => setActiveTab(tab)} 
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Profile & Leaderboard Modal */}
      {activeModal === 'profile' && profile && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-[#E5E5E5] max-w-2xl w-full p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-all cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Profile Header */}
            <div className="flex flex-col sm:flex-row items-center gap-5 pb-6 border-b border-gray-100">
              <div className="w-20 h-20 rounded-full border-4 border-gray-50 overflow-hidden bg-gray-100 shadow-inner shrink-0">
                <img src={profile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.uid}`} alt="Profile Avatar" className="w-full h-full object-cover" />
              </div>
              <div className="text-center sm:text-left space-y-1">
                <h3 className="text-xl font-semibold text-gray-900">{profile.displayName}</h3>
                <p className="text-xs text-[#717171] font-mono">{user?.email || 'guest@civic.local'}</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <span className="px-3 py-1 bg-[#1A1A1A] text-white text-[10px] font-bold uppercase tracking-widest rounded-full">
                    {profile.civicRank}
                  </span>
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-bold uppercase tracking-widest rounded-full">
                    {profile.impactPoints} Impact Points
                  </span>
                </div>
              </div>
            </div>

            {/* Change Profile Picture */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#717171] uppercase tracking-wider">Change Profile Avatar</h4>
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                {['star', 'gear', 'bolt', 'spark', 'shield', 'heart', 'leaf', 'gem', 'sun', 'moon'].map((seed) => {
                  const targetUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
                  const isSelected = profile.photoURL === targetUrl;
                  return (
                    <button
                      key={seed}
                      onClick={() => handleUpdateAvatar(seed)}
                      className={`w-10 h-10 rounded-full border-2 overflow-hidden hover:scale-105 transition-all bg-gray-50 flex items-center justify-center p-1 cursor-pointer ${isSelected ? 'border-gray-900 scale-105 ring-2 ring-gray-900/10' : 'border-gray-200 hover:border-gray-400'}`}
                      title={`Select ${seed} avatar`}
                    >
                      <img src={targetUrl} alt={seed} className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
              <form onSubmit={handleCustomAvatarSubmit} className="flex gap-2 max-w-sm pt-1">
                <input
                  type="text"
                  placeholder="Or enter a custom seed name..."
                  value={customSeed}
                  onChange={(e) => setCustomSeed(e.target.value)}
                  className="flex-1 text-xs px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-gray-900 bg-gray-50"
                />
                <button
                  type="submit"
                  className="bg-gray-900 hover:bg-gray-800 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-colors cursor-pointer"
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
                    { title: 'Metropolitan Guardian', min: 500, desc: 'Supreme municipal supervisor.' },
                    { title: 'Urban Architect', min: 300, desc: 'Trusted regional planner.' },
                    { title: 'Neighbourhood Champion', min: 150, desc: 'Local community driver.' },
                    { title: 'Local Vigilante', min: 50, desc: 'Active municipal checker.' },
                    { title: 'Civic Novice', min: 0, desc: 'Entry-level civic reporter.' }
                  ].map((lvl) => {
                    const isCurrent = profile.civicRank === lvl.title;
                    const isPassed = profile.impactPoints >= lvl.min;
                    return (
                      <div 
                        key={lvl.title} 
                        className={`p-3 rounded-xl border transition-all ${isCurrent ? 'bg-gray-900 text-white border-gray-900 shadow-md' : isPassed ? 'bg-gray-50 text-gray-700 border-gray-200' : 'bg-gray-50/50 text-gray-400 border-gray-100'}`}
                      >
                        <div className="flex justify-between items-center font-semibold text-[11px]">
                          <span className="truncate pr-1">{lvl.title}</span>
                          <span className={isCurrent ? 'text-amber-300' : 'text-gray-500'}>{lvl.min}+ pts</span>
                        </div>
                        <p className={`text-[10px] mt-0.5 ${isCurrent ? 'text-gray-200' : 'text-gray-400'}`}>{lvl.desc}</p>
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
                  <div className="flex bg-gray-100 p-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider">
                    <button 
                      onClick={() => setLeaderboardCity('Bangalore')} 
                      className={`px-2.5 py-1 rounded-md transition-colors ${leaderboardCity === 'Bangalore' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      Bangalore
                    </button>
                    <button 
                      onClick={() => setLeaderboardCity('Other')} 
                      className={`px-2.5 py-1 rounded-md transition-colors ${leaderboardCity === 'Other' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      Other
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {getDynamicLeaderboard(leaderboardCity).map((entry) => (
                    <div 
                      key={entry.isCurrent ? 'current-user-lb' : `${entry.displayName}-${entry.rank}`} 
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${entry.isCurrent ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-300 shadow-sm' : 'bg-gray-50 border-gray-100'}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold font-mono text-[10px] ${entry.rank === 1 ? 'bg-yellow-100 text-yellow-800' : entry.rank === 2 ? 'bg-gray-200 text-gray-800' : 'bg-gray-100 text-gray-500'}`}>
                          {entry.rank}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate flex items-center gap-1">
                            {entry.displayName}
                            {entry.isCurrent && <span className="text-[9px] text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-widest scale-90 shrink-0">You</span>}
                          </p>
                          <p className="text-[9px] text-gray-400 font-medium truncate uppercase">{entry.civicRank}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-gray-900 font-mono text-xs">{entry.impactPoints} <span className="text-[10px] text-[#717171] font-sans font-normal">pts</span></p>
                        <p className="text-[9px] text-gray-400 font-medium">{entry.reportsCount} reports</p>
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
      {activeModal === 'my-reports' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-[#E5E5E5] max-w-4xl w-full p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-all cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="text-xl font-light tracking-tight text-gray-900">Your Civic Reports</h3>
              <p className="text-xs text-[#717171] mt-1">Review and locate all municipal infrastructure filings under your account.</p>
            </div>

            {issues.filter(i => i.reportedByUid === user?.uid).length === 0 ? (
              <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200 space-y-3 p-6">
                <FileText className="w-10 h-10 text-gray-300 mx-auto" />
                <h4 className="font-semibold text-gray-700 text-sm">No Filings Logged</h4>
                <p className="text-xs text-gray-400 max-w-xs mx-auto">
                  You haven't logged any infrastructure issues under this session yet. Access the Reporter tab to submit a live image!
                </p>
                <button
                  onClick={() => { setActiveModal(null); setActiveTab('reporter'); }}
                  className="bg-gray-900 hover:bg-gray-800 text-white text-[10px] font-bold uppercase tracking-widest px-5 py-2.5 rounded-full transition-all cursor-pointer shadow-sm"
                >
                  File First Report
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-2xl">
                <table className="min-w-full divide-y divide-gray-100 text-left text-xs">
                  <thead className="bg-gray-50/75">
                    <tr>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Visual</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Issue Detail</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Authority Department</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Civic Status</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Upvotes</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {issues
                      .filter((i) => i.reportedByUid === user?.uid)
                      .map((issue) => (
                        <tr key={issue.id} className="hover:bg-gray-50/25 transition-colors">
                          <td className="px-5 py-3 whitespace-nowrap">
                            <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shadow-sm">
                              {issue.imageUrl ? (
                                <img src={issue.imageUrl} alt={issue.category} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400 bg-gray-50">No Image</div>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 max-w-xs">
                            <p className="font-semibold text-gray-900">{issue.category}</p>
                            <p className="text-[10px] text-[#717171] line-clamp-1 mt-0.5">"{issue.description}"</p>
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-[#717171]">
                            {issue.recommendedDepartment || 'General Operations'}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-full border ${getStatusBadgeStyle(issue.status)}`}>
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
                                setActiveTab('map');
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
