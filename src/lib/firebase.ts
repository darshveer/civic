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
  getDocs
} from 'firebase/firestore';
import { CitizenProfile, CivicIssue } from '../types';

// Load configurations directly from the config json injected in workspace
import firebaseConfigJson from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId
};

// Initialize Firebase App gracefully
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore targeting the specific custom database assigned in config
const db = initializeFirestore(app, {}, firebaseConfigJson.firestoreDatabaseId || '(default)');

// Initialize Auth
const auth = getAuth(app);

export { auth, db };

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
 * Ensures a citizen profile document exists in Firestore.
 * If not, creates one centered around default tier levels.
 * 
 * @param user - Firebase authenticated user instance
 * @returns Promise containing the updated or existing CitizenProfile
 */
export async function syncCitizenProfile(user: User, role: 'citizen' | 'staff' = 'citizen'): Promise<CitizenProfile> {
  const profileRef = doc(db, 'citizens', user.uid);
  try {
    const snap = await getDoc(profileRef);
    if (snap.exists()) {
      const data = snap.data() as CitizenProfile;
      if (data.role !== role) {
        await updateDoc(profileRef, { role: role });
        data.role = role;
      }
      return data;
    } else {
      const newProfile: CitizenProfile = {
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Anonymous Hero',
        photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
        joinedAt: Date.now(),
        impactPoints: 20, // Start with welcome incentive points
        civicRank: 'Civic Novice',
        reportsCount: 0,
        role: role
      };
      await setDoc(profileRef, newProfile);
      return newProfile;
    }
  } catch (err) {
    console.error('Error syncing citizen profile:', err);
    throw err;
  }
}

/**
 * Adds impact points to a user's citizen document in Firestore, adjusting rank level.
 * 
 * @param uid - The unique identifier of the target citizen user
 * @param pointsToAdd - Scalar points to aggregate
 */
export async function rewardImpactPoints(uid: string, pointsToAdd: number): Promise<void> {
  const profileRef = doc(db, 'citizens', uid);
  try {
    const snap = await getDoc(profileRef);
    if (snap.exists()) {
      const currentData = snap.data() as CitizenProfile;
      const nextPoints = (currentData.impactPoints || 0) + pointsToAdd;
      const nextRank = calculateCivicRank(nextPoints);
      await updateDoc(profileRef, {
        impactPoints: increment(pointsToAdd),
        civicRank: nextRank
      });
    }
  } catch (err) {
    console.error('Error adding points to citizen:', err);
  }
}

/**
 * Increments report counter on user profile document.
 * 
 * @param uid - The unique identifier of the target citizen user
 */
export async function incrementReportsCount(uid: string): Promise<void> {
  const profileRef = doc(db, 'citizens', uid);
  try {
    await updateDoc(profileRef, {
      reportsCount: increment(1)
    });
  } catch (err) {
    console.error('Error incrementing reports count:', err);
  }
}
