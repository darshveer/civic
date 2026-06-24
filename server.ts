/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApps } from 'firebase/app';
import { initializeFirestore, collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';

// Load environment variables early
dotenv.config();

// Load Firestore credentials for backend calculations
import firebaseConfigJson from './firebase-applet-config.json';
import { 
  runTriageAgent, 
  runRoutingAgent, 
  runVerificationAgent 
} from './server/gemini';
import { CivicCategory } from './src/types';

const app = express();
const PORT = 3000;

// Enable JSON middleware with increased payload limit for image uploads
app.use(express.json({ limit: '12mb' }));

// Initialize unique Server-Side Firebase client connection to sync state
const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const firestoreDb = initializeFirestore(firebaseApp, {}, firebaseConfigJson.firestoreDatabaseId || '(default)');

/**
 * Endpoint to test connectivity and server status.
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', datetime: new Date().toISOString() });
});

/**
 * API Route: /api/triage
 * Orchestrates the Triage, Routing, and Verification agent loop.
 * Expects { image: string (base64 data url), mimeType: string, latitude: number, longitude: number }
 */
app.post('/api/triage', async (req, res) => {
  const { image, mimeType, latitude, longitude } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Image body payload is required for Triage.' });
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Valid Geolocation coordinate parameters are required.' });
  }

  try {
    console.log('[Triage] Running Multimodal analysis...');
    // 1. Triage Agent analysis
    const triageResult = await runTriageAgent(image, mimeType);
    console.log('[Triage] Done:', triageResult);

    // 2. Routing Agent analysis
    const routedStatus = runRoutingAgent(triageResult);
    console.log('[Routing] Recommended status:', routedStatus);

    // 3. Verification Agent: Retrieve existing unresolved issues of this same category
    console.log('[Verification] Fetching active issues to compute corroboration...');
    const issuesRef = collection(firestoreDb, 'issues');
    
    // Select unresolved ones of the same category
    const q = query(
      issuesRef, 
      where('category', '==', triageResult.category),
      where('status', 'in', ['Reported', 'Auto-Routed', 'Requires Human Verification', 'Corroborated Report', 'In Progress'])
    );
    const snap = await getDocs(q);
    const activeUnresolved: Array<{ id: string; latitude: number; longitude: number; category: CivicCategory; corroboratedGroupId?: string }> = [];
    
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      activeUnresolved.push({
        id: docSnap.id,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        category: data.category as CivicCategory,
        corroboratedGroupId: data.corroboratedGroupId || undefined
      });
    });

    // Run verification algorithm
    const verification = runVerificationAgent(latitude, longitude, triageResult.category, activeUnresolved);
    console.log('[Verification] Computed output:', verification);

    // Adjust status if corroborated
    let finalStatus: string = routedStatus;
    if (verification.isCorroborated) {
      finalStatus = 'Corroborated Report';
    }

    return res.json({
      success: true,
      triage: triageResult,
      status: finalStatus,
      isCorroborated: verification.isCorroborated,
      corroboratedGroupId: verification.corroboratedGroupId
    });
  } catch (error: any) {
    console.error('Error handling triage api pipeline:', error);
    return res.status(500).json({ error: error.message || 'Civic infrastructure triage agent encountered an error.' });
  }
});

/**
 * Configures the pipeline interface with Vite or Production assets serving.
 */
async function mountApplication() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Mounting in DEVELOPMENT mode.');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Mounting in PRODUCTION mode.');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[C.I.V.I.C.] Running fully active on http://0.0.0.0:${PORT}`);
  });
}

mountApplication();
