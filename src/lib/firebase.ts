/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  signInAnonymously,
  onAuthStateChanged,
  updateProfile,
  User
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  increment,
  limit,
  getDocs,
  runTransaction
} from 'firebase/firestore';
import { CitizenProfile, CivicIssue } from '../types';

// Load configuration. Prefer env vars (so you can point at YOUR OWN Firebase
// project), falling back to the AI Studio-injected firebase-applet-config.json.
import firebaseConfigJson from '../../firebase-applet-config.json';

const env = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : (process as unknown as { env?: Record<string, string | undefined> }).env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY || firebaseConfigJson.apiKey,
  authDomain:
    env.VITE_FIREBASE_AUTH_DOMAIN || env.FIREBASE_AUTH_DOMAIN ||
    firebaseConfigJson.authDomain ||
    `${env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || firebaseConfigJson.projectId}.firebaseapp.com`,
  projectId: env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || firebaseConfigJson.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || env.FIREBASE_STORAGE_BUCKET || firebaseConfigJson.storageBucket,
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_MESSAGING_SENDER_ID || firebaseConfigJson.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID || firebaseConfigJson.appId,
};

// Initialize Firebase App gracefully
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const isCustomProject = !!(env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID);

// Target the Firestore database id (env override → JSON → default).
const db = initializeFirestore(
  app,
  {},
  env.VITE_FIREBASE_DATABASE_ID || env.FIREBASE_DATABASE_ID || (isCustomProject ? '(default)' : firebaseConfigJson.firestoreDatabaseId) || '(default)',
);

// Initialize Auth
const auth = getAuth(app);

export { auth, db };

// ---------------------------------------------------------------------------
// Gamification: single source of truth.
//
// Points and report counts are ALWAYS derived from the live `issues`
// collection — never from denormalized counters on the citizen doc. This makes
// purge/delete automatically consistent (deleting issues removes their points)
// and keeps every surface (header, dashboard, leaderboard) in agreement.
// ---------------------------------------------------------------------------

export const WELCOME_POINTS = 20;
export const POINTS_PER_REPORT = 10;
export const POINTS_PER_RESOLVED = 50;

/** Number of genuine reports a user has authored. */
export function computeReportsCount(issues: CivicIssue[], uid: string): number {
  return issues.filter((i) => i.reportedByUid === uid).length;
}

/** Live impact points for a user, derived from their issues. */
export function computeImpactPoints(issues: CivicIssue[], uid: string): number {
  return issues
    .filter((i) => i.reportedByUid === uid)
    .reduce(
      (sum, i) =>
        sum + POINTS_PER_REPORT + (i.status === "Resolved" ? POINTS_PER_RESOLVED : 0),
      WELCOME_POINTS,
    );
}

/**
 * Toggles the current user's upvote on an issue inside a transaction so the
 * count can never drift. `upvotesCount` is derived from `upvotedBy.length`
 * (one source of truth). Self-upvotes are rejected. Returns the new upvote
 * state, or throws on a real failure so the UI can roll back.
 *
 * NOTE: role gating (only citizens may upvote) is enforced by the caller and by
 * Firestore rules; this helper only guards self-upvotes and atomicity.
 */
export async function toggleUpvote(
  issueId: string,
  uid: string,
): Promise<{ upvoted: boolean; upvotesCount: number }> {
  const issueRef = doc(db, "issues", issueId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(issueRef);
    if (!snap.exists()) throw new Error("Issue no longer exists.");
    const data = snap.data() as CivicIssue;
    if (data.reportedByUid === uid) {
      throw new Error("You cannot upvote your own report.");
    }
    const current = data.upvotedBy || [];
    const has = current.includes(uid);
    const next = has ? current.filter((id) => id !== uid) : [...current, uid];
    tx.update(issueRef, { upvotedBy: next, upvotesCount: next.length });
    return { upvoted: !has, upvotesCount: next.length };
  });
}

/**
 * Marks an issue resolved exactly once. Guarded by a transaction so rapid or
 * concurrent clicks cannot re-trigger it. No points are written here — points
 * are computed live from the issue's "Resolved" status (see computeImpactPoints).
 * Returns true if this call performed the resolution, false if it was already
 * resolved.
 */
export async function resolveIssue(
  issueId: string,
  resolverUid: string,
  resolution: {
    resolvedImageUrl: string;
    resolutionConfidence: number;
    resolutionNotes: string;
  },
): Promise<boolean> {
  const issueRef = doc(db, "issues", issueId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(issueRef);
    if (!snap.exists()) throw new Error("Issue no longer exists.");
    const data = snap.data() as CivicIssue;
    if (data.status === "Resolved") return false; // idempotent: already done
    tx.update(issueRef, {
      status: "Resolved",
      resolvedImageUrl: resolution.resolvedImageUrl,
      resolutionConfidence: resolution.resolutionConfidence,
      resolutionNotes: resolution.resolutionNotes,
      resolvedAt: Date.now(),
      resolvedByUid: resolverUid,
    });
    return true;
  });
}

/**
 * LAYER 3 / RULE B — Official Staff Override ("Corroborate & Approve").
 *
 * When authenticated municipal staff approve a report, it bypasses the community
 * consensus threshold and is immediately promoted to "Staff Verified" (the
 * highest trust tier — turns the map pin green / high-priority). Idempotent and
 * transactional so rapid double-clicks can't re-stamp the audit fields; returns
 * true if THIS call performed the approval, false if it was already staff-verified.
 *
 * Authorization is enforced by Firestore rules: only staff whose scope
 * `canActOn()` the issue may write these fields. Resolved reports are left as-is.
 */
export async function corroborateAndApprove(
  issueId: string,
  staffUid: string,
  notes?: string,
): Promise<boolean> {
  const issueRef = doc(db, "issues", issueId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(issueRef);
    if (!snap.exists()) throw new Error("Issue no longer exists.");
    const data = snap.data() as CivicIssue;
    if (data.status === "Staff Verified") return false; // idempotent
    if (data.status === "Resolved") {
      throw new Error("This report is already resolved.");
    }
    tx.update(issueRef, {
      status: "Staff Verified",
      isCorroborated: true,
      verifiedByUid: staffUid,
      verifiedAt: Date.now(),
      ...(notes ? { verificationNotes: notes } : {}),
    });
    return true;
  });
}

/**
 * Calculates current civic rank status based on total accumulated impact points.
 *
 * @param points - The citizen's current total impact points
 * @returns A descriptive civic level/rank string
 */
export function calculateCivicRank(points: number): string {
  if (points >= 500) return 'Metropolitan Guardian';
  if (points >= 300) return 'Urban Architect';
  if (points >= 150) return 'Neighbourhood Champion';
  if (points >= 50) return 'Local Vigilante';
  return 'Civic Novice';
}

/**
 * Ensures a citizen profile document exists in Firestore and returns it.
 *
 * IMPORTANT: this never writes `role`. Authoritative staff status lives in the
 * server-enforced `config/roles` allowlist (see lib/roles.ts) — the profile's
 * `role` field is display-only and must not be reconciled from the client (the
 * security rules reject a client role change, which would otherwise brick the
 * session for a previously-staff document).
 *
 * @param user - Firebase authenticated user instance
 * @returns Promise containing the existing or newly-created CitizenProfile
 */
export async function syncCitizenProfile(
  user: User,
  _role: 'citizen' | 'staff' = 'citizen',
): Promise<CitizenProfile> {
  const profileRef = doc(db, 'citizens', user.uid);
  try {
    const snap = await getDoc(profileRef);
    if (snap.exists()) {
      return snap.data() as CitizenProfile;
    }
    const newProfile: CitizenProfile = {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'Anonymous Hero',
      photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
      joinedAt: Date.now(),
      impactPoints: 20, // welcome incentive (display only; points are derived live)
      civicRank: 'Civic Novice',
      reportsCount: 0,
      role: 'citizen', // never created as staff; staff come from config/roles
    };
    await setDoc(profileRef, newProfile, { merge: true });
    return newProfile;
  } catch (err) {
    console.error('Error syncing citizen profile:', err);
    throw err;
  }
}

// NOTE: the previous denormalized-counter helpers (rewardImpactPoints /
// incrementReportsCount) were removed. Points and report counts are derived
// live from the issues collection (computeImpactPoints / computeReportsCount),
// so they can never drift out of sync after a delete or purge.
