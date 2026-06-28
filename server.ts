/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { initializeApp, getApps } from "firebase/app";
import {
  initializeFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
} from "firebase/firestore";

// Load environment variables early. Prefer .env.local (gitignored, where local
// secrets live) and fall back to .env. In hosted environments (e.g. Google AI
// Studio / Cloud Run) the vars are already present in process.env and dotenv
// leaves those untouched.
dotenv.config({ path: [".env.local", ".env"] });

// Load Firestore credentials for backend calculations
import firebaseConfigJson from "./firebase-applet-config.json";
import {
  runTriageAgent,
  runRoutingAgent,
  runVerificationAgent,
  runPriorityAgent,
  runForensicsAgent,
  runResolutionVerificationAgent,
  runChatbotAgent,
  runAssistantAgent,
  runStaffAnalyticsAgent,
  runSmartDescriptionAgent,
  runImpactStoryAgent,
  runPredictiveInsightAgent,
  computeHotspots,
  runDailyBriefingAgent,
  runPetitionAgent,
  runMissionsCoachAgent,
  runDispatchAgent,
  runZoneMappingAgent,
  getHaversineDistanceMeters,
} from "./server/gemini";
import { CivicCategory } from "./src/types";

const app = express();
// Cloud Run / AI Studio inject the port via $PORT; fall back to 3000 locally.
const PORT = Number(process.env.PORT) || 3000;

// Enable JSON middleware with increased payload limit for image uploads
app.use(express.json({ limit: "12mb" }));

// Server-side Firebase client. Prefer env vars (your own project), else the
// AI Studio-injected firebase-applet-config.json.
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || firebaseConfigJson.apiKey,
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN || firebaseConfigJson.authDomain,
  projectId: process.env.FIREBASE_PROJECT_ID || firebaseConfigJson.projectId,
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET || firebaseConfigJson.storageBucket,
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    firebaseConfigJson.messagingSenderId,
  appId: process.env.FIREBASE_APP_ID || firebaseConfigJson.appId,
};

const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const firestoreDb = initializeFirestore(
  firebaseApp,
  {},
  process.env.FIREBASE_DATABASE_ID ||
    firebaseConfigJson.firestoreDatabaseId ||
    "(default)",
);

/**
 * Endpoint to test connectivity and server status.
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", datetime: new Date().toISOString() });
});

/**
 * API Route: /api/triage
 * Orchestrates the Triage, Routing, and Verification agent loop.
 * Expects { image: string (base64 data url), mimeType: string, latitude: number, longitude: number }
 */
app.post("/api/triage", async (req, res) => {
  const { image, mimeType, latitude, longitude } = req.body;

  if (!image) {
    return res
      .status(400)
      .json({ error: "Image body payload is required for Triage." });
  }
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res
      .status(400)
      .json({ error: "Valid Geolocation coordinate parameters are required." });
  }

  try {
    console.log("[Triage] Running Multimodal analysis...");
    // 1. Triage Agent analysis
    const triageResult = await runTriageAgent(image, mimeType);
    console.log("[Triage] Done:", triageResult);

    // 2. Routing Agent analysis
    const routedStatus = runRoutingAgent(triageResult);
    console.log("[Routing] Recommended status:", routedStatus);

    // 3. Verification Agent: Retrieve existing unresolved issues of this same category
    console.log(
      "[Verification] Fetching active issues to compute corroboration...",
    );
    const issuesRef = collection(firestoreDb, "issues");

    // Select unresolved ones of the same category
    const q = query(
      issuesRef,
      where("category", "==", triageResult.category),
      where("status", "in", [
        "Reported",
        "Auto-Routed",
        "Requires Human Verification",
        "Corroborated Report",
        "In Progress",
      ]),
    );
    const snap = await getDocs(q);
    const activeUnresolved: Array<{
      id: string;
      latitude: number;
      longitude: number;
      category: CivicCategory;
      corroboratedGroupId?: string;
    }> = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      activeUnresolved.push({
        id: docSnap.id,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        category: data.category as CivicCategory,
        corroboratedGroupId: data.corroboratedGroupId || undefined,
      });
    });

    // Run verification algorithm
    const verification = runVerificationAgent(
      latitude,
      longitude,
      triageResult.category,
      activeUnresolved,
    );
    console.log("[Verification] Computed output:", verification);

    // Run priority algorithm
    const priority = runPriorityAgent(
      triageResult.severityScore,
      0,
      triageResult.category,
      verification.isCorroborated,
    );
    console.log("[Priority] Computed output:", priority);

    // Adjust status if corroborated
    let finalStatus: string = routedStatus;
    if (verification.isCorroborated) {
      finalStatus = "Corroborated Report";
    }

    return res.json({
      success: true,
      triage: {
        ...triageResult,
        priorityTier: priority.priorityTier,
        slaTargetHours: priority.slaTargetHours,
      },
      status: finalStatus,
      isCorroborated: verification.isCorroborated,
      corroboratedGroupId: verification.corroboratedGroupId,
      targetIssueId: verification.targetIssueId,
    });
  } catch (error: any) {
    console.error("Error handling triage api pipeline:", error);
    return res.status(500).json({
      error:
        error.message ||
        "Civic infrastructure triage agent encountered an error.",
    });
  }
});

/**
 * API Route: /api/reports/verify  — Three-Layer Trust & Verification Engine.
 *
 * LAYER 2 (Cognitive Forensics): passes the image to Gemini Multimodal to score
 * authenticity / fraud and extract visual-evidence tags. A report is flagged
 * when the image is judged inauthentic OR the fraud-confidence exceeds 0.7.
 *
 * LAYER 3 / RULE A (Spatial Consensus): runs a 50m geospatial radius check
 * against existing unresolved reports and corroborates when an INDEPENDENT
 * reporter has logged a report with overlapping visual-evidence tags nearby.
 * The actual dual-write (flipping both reports to "Community Verified") is
 * performed client-side under the `isValidCommunityVerification()` Firestore
 * rule — this endpoint only computes the match.
 *
 * Expects { image, mimeType, latitude, longitude, reporterUid?, category?,
 *           visualEvidenceTags? }
 * Returns { success, forensics: { isAuthentic, fraudConfidenceScore,
 *           visualEvidenceTags, flagged }, consensus: { communityVerified,
 *           matchedIssueId, corroboratedGroupId } }
 */
const FRAUD_FLAG_THRESHOLD = 0.7; // > 0.7 fraud confidence ⇒ flag for review
const CONSENSUS_RADIUS_METERS = 50; // Rule A spatial radius

app.post("/api/reports/verify", async (req, res) => {
  const { image, mimeType, latitude, longitude, reporterUid, category } =
    req.body;

  if (!image) {
    return res
      .status(400)
      .json({ error: "Image body payload is required for verification." });
  }
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res
      .status(400)
      .json({ error: "Valid Geolocation coordinate parameters are required." });
  }

  try {
    // --- LAYER 2: Cognitive Forensics ------------------------------------
    console.log("[Forensics] Running cognitive forensics check...");
    const forensics = await runForensicsAgent(image, mimeType);
    const flagged =
      !forensics.isAuthentic ||
      forensics.fraudConfidenceScore > FRAUD_FLAG_THRESHOLD;
    console.log("[Forensics] Verdict:", { ...forensics, flagged });

    // A flagged report skips community consensus entirely — a suspected fraud
    // must not corroborate (or be corroborated by) anything.
    let consensus: {
      communityVerified: boolean;
      matchedIssueId: string | null;
      corroboratedGroupId: string | null;
    } = { communityVerified: false, matchedIssueId: null, corroboratedGroupId: null };

    if (!flagged) {
      // --- LAYER 3 / RULE A: Spatial consensus --------------------------
      const incomingTags = forensics.visualEvidenceTags;
      const issuesRef = collection(firestoreDb, "issues");
      // Active (unresolved) reports are eligible to corroborate.
      const q = query(
        issuesRef,
        where("status", "in", [
          "Reported",
          "Auto-Routed",
          "Requires Human Verification",
          "Corroborated Report",
          "In Progress",
          "Pending Verification",
          "Community Verified",
          "Staff Verified",
        ]),
      );
      const snap = await getDocs(q);

      let best: { id: string; groupId: string | null } | null = null;
      snap.forEach((docSnap) => {
        if (best) return; // first independent match wins
        const data = docSnap.data();
        // Independence: a citizen cannot corroborate their own report.
        if (reporterUid && data.reportedByUid === reporterUid) return;

        const distance = getHaversineDistanceMeters(
          latitude,
          longitude,
          Number(data.latitude),
          Number(data.longitude),
        );
        if (distance > CONSENSUS_RADIUS_METERS) return;

        // Tag similarity (≥1 shared visual-evidence tag). Fall back to category
        // equality for legacy reports that predate forensics tagging.
        const candidateTags: string[] = Array.isArray(data.visualEvidenceTags)
          ? data.visualEvidenceTags
          : [];
        const tagOverlap =
          incomingTags.length > 0 &&
          candidateTags.some((t) => incomingTags.includes(t));
        const categoryFallback =
          candidateTags.length === 0 && category && data.category === category;

        if (tagOverlap || categoryFallback) {
          best = {
            id: docSnap.id,
            groupId: data.corroboratedGroupId || docSnap.id,
          };
        }
      });

      if (best) {
        consensus = {
          communityVerified: true,
          matchedIssueId: best.id,
          corroboratedGroupId: best.groupId,
        };
        console.log("[Consensus] Community match found:", consensus);
      } else {
        console.log("[Consensus] No nearby independent corroboration.");
      }
    }

    return res.json({
      success: true,
      forensics: { ...forensics, flagged },
      consensus,
    });
  } catch (error: any) {
    console.error("Error handling reports/verify pipeline:", error);
    return res.status(500).json({
      error: error.message || "Trust & verification engine encountered an error.",
    });
  }
});

/**
 * API Route: /api/verify-resolution
 */
app.post("/api/verify-resolution", async (req, res) => {
  const { beforeImage, afterImage, mimeType, category, issueId } = req.body;
  if (!beforeImage || !afterImage) {
    return res
      .status(400)
      .json({ error: "Both before and after images are required." });
  }

  try {
    console.log("[Resolution Verification] Running analysis...");
    const result = await runResolutionVerificationAgent(
      beforeImage,
      afterImage,
      mimeType || "image/jpeg",
      category || "issue",
    );
    console.log("[Resolution Verification] Done:", result);
    return res.json({ success: true, verification: result });
  } catch (error: any) {
    console.error("Error handling resolution verification:", error);
    return res
      .status(500)
      .json({ error: error.message || "Verification failed." });
  }
});

/**
 * API Route: /api/chat
 */
app.post("/api/chat", async (req, res) => {
  const { message, history, language, userId, nearbyIssues, location } =
    req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  try {
    let userIssuesContext: any[] = [];
    if (userId) {
      const issuesRef = collection(firestoreDb, "issues");
      const q = query(issuesRef, where("reportedByUid", "==", userId));
      const snap = await getDocs(q);
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        userIssuesContext.push({
          category: data.category,
          status: data.status,
          date: new Date(data.reportedAt).toLocaleDateString(),
        });
      });
    }

    const reply = await runChatbotAgent(
      message,
      history || [],
      userIssuesContext,
      language || "English",
      Array.isArray(nearbyIssues) ? nearbyIssues.slice(0, 15) : [],
      Boolean(location),
    );
    return res.json({ success: true, reply });
  } catch (error: any) {
    console.error("Error handling chat:", error);
    return res.status(500).json({ error: error.message || "Chat failed." });
  }
});

/**
 * API Route: /api/assistant
 * Conversational Reporting Agent — chat that can also file reports (tool use).
 * Returns { reply, draft } where draft is non-null when the agent chose to file.
 */
app.post("/api/assistant", async (req, res) => {
  const { message, history, language, userId, nearbyIssues, location } =
    req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  try {
    // Fetch ONLY this signed-in user's own reports (server-enforced scope: the
    // get_my_reports tool can never see another citizen's data because the
    // executor is only handed this array).
    let userReports: any[] = [];
    if (userId) {
      const issuesRef = collection(firestoreDb, "issues");
      const q = query(issuesRef, where("reportedByUid", "==", userId));
      const snap = await getDocs(q);
      const raw: any[] = [];
      snap.forEach((docSnap) => raw.push({ id: docSnap.id, ...docSnap.data() }));
      // Newest first so "report 3" maps to a stable item across turns.
      raw.sort((a, b) => (Number(b.reportedAt) || 0) - (Number(a.reportedAt) || 0));
      userReports = raw.map((data) => ({
        id: data.id,
        category: data.category,
        status: data.status,
        priority: data.priorityTier,
        severity: data.severityScore,
        slaTargetHours: data.slaTargetHours,
        ward: data.ward || data.city || "",
        address: data.address || "",
        description: String(data.description || "").slice(0, 160),
        reportedAt: new Date(data.reportedAt).toLocaleDateString(),
        upvotes: data.upvotesCount || 0,
      }));
    }

    // Live badge stats (mirrors the client's computeBadgeStats / points model).
    let badgeStats: any = null;
    if (userId) {
      const reports = userReports.length;
      const resolved = userReports.filter((r) => r.status === "Resolved").length;
      const potholes = userReports.filter((r) => r.category === "Pothole").length;
      const categories = new Set(userReports.map((r) => r.category)).size;
      const points = 20 + 10 * reports + 50 * resolved;
      let upvotesGiven = 0;
      try {
        const upSnap = await getDocs(
          query(
            collection(firestoreDb, "issues"),
            where("upvotedBy", "array-contains", userId),
          ),
        );
        upvotesGiven = upSnap.size;
      } catch {
        /* index/permission edge — non-fatal */
      }
      badgeStats = { reports, resolved, points, potholes, categories, upvotesGiven };
    }

    const { reply, action } = await runAssistantAgent(
      message,
      history || [],
      userReports,
      language || "English",
      Array.isArray(nearbyIssues) ? nearbyIssues.slice(0, 15) : [],
      Boolean(location),
      badgeStats,
    );
    return res.json({ success: true, reply, action });
  } catch (error: any) {
    console.error("Error handling assistant:", error);
    return res.status(500).json({ error: error.message || "Assistant failed." });
  }
});

/**
 * API Route: /api/staff-query
 * Staff Operations Analyst — answers NL questions via a function-calling loop
 * over the live issues, scoped to the staff member's jurisdiction.
 * Expects { question, history?, scope: { tier, wards?, zone? } }.
 */
app.post("/api/staff-query", async (req, res) => {
  const { question, history, scope } = req.body;
  if (!question) return res.status(400).json({ error: "A question is required." });
  if (!scope || scope.role !== "staff") {
    return res.status(403).json({ error: "Staff access required." });
  }

  try {
    const snap = await getDocs(collection(firestoreDb, "issues"));
    const all: any[] = [];
    snap.forEach((d) => all.push({ id: d.id, ...d.data() }));

    // Scope to the officer's jurisdiction (mirrors lib/roles canActOnIssue and
    // the Firestore rules): city → all; zonal → their zone; field → their wards.
    let scoped = all;
    if (scope.tier === "zonal") {
      scoped = all.filter((i) => i.zone && i.zone === scope.zone);
    } else if (scope.tier === "field") {
      const wards: string[] = Array.isArray(scope.wards) ? scope.wards : [];
      scoped = all.filter((i) => i.ward && wards.includes(i.ward));
    }

    const result = await runStaffAnalyticsAgent(
      String(question),
      Array.isArray(history) ? history : [],
      scoped,
    );
    return res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Error handling staff-query:", error);
    return res
      .status(500)
      .json({ error: error.message || "Staff analytics failed." });
  }
});

/**
 * API Route: /api/smart-description
 */
app.post("/api/smart-description", async (req, res) => {
  const { image, imageMimeType, voice, voiceMimeType, language } = req.body;

  if (!image && !voice) {
    return res.status(400).json({ error: "Image or voice is required." });
  }

  try {
    const description = await runSmartDescriptionAgent(
      image,
      imageMimeType,
      voice,
      voiceMimeType,
      language || "English",
    );
    return res.json({ success: true, description });
  } catch (error: any) {
    console.error("Error handling smart description:", error);
    return res
      .status(500)
      .json({ error: error.message || "Smart Description failed." });
  }
});

/**
 * API Route: /api/impact-story
 */
app.post("/api/impact-story", async (req, res) => {
  const { stats, language } = req.body;

  if (!stats) {
    return res.status(400).json({ error: "Stats are required." });
  }

  try {
    const story = await runImpactStoryAgent(stats, language || "English");
    return res.json({ success: true, story });
  } catch (error: any) {
    console.error("Error handling impact story:", error);
    return res
      .status(500)
      .json({ error: error.message || "Impact Story failed." });
  }
});

/**
 * API Route: /api/predictive-insights
 */
app.post("/api/predictive-insights", async (req, res) => {
  const { issues } = req.body;
  if (!issues || !Array.isArray(issues)) {
    return res.status(400).json({ error: "Historical issues required." });
  }
  try {
    const [insights, hotspots] = [
      await runPredictiveInsightAgent(issues),
      computeHotspots(issues),
    ];
    return res.json({ success: true, insights, hotspots });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * API Route: /api/daily-briefing
 */
app.post("/api/daily-briefing", async (req, res) => {
  const { stats } = req.body;
  if (!stats) return res.status(400).json({ error: "Stats required." });
  try {
    const briefing = await runDailyBriefingAgent(stats);
    return res.json({ success: true, briefing });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * API Route: /api/draft-petition
 * Civic Advocacy Agent drafts a formal petition for a high-impact issue.
 */
app.post("/api/draft-petition", async (req, res) => {
  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: "Issue is required." });
  try {
    const petition = await runPetitionAgent(issue);
    return res.json({ success: true, petition });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Petition draft failed." });
  }
});

/**
 * API Route: /api/missions-coach
 * Returns a short, motivating coaching line for a citizen's missions.
 */
app.post("/api/missions-coach", async (req, res) => {
  const { context } = req.body;
  try {
    const coach = await runMissionsCoachAgent(context || {});
    return res.json({ success: true, coach });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Coach failed." });
  }
});

/**
 * API Route: /api/draft-dispatch
 * Auto-Dispatch Agent drafts a work-order email for a triaged issue.
 */
app.post("/api/draft-dispatch", async (req, res) => {
  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: "Issue is required." });
  try {
    const dispatch = await runDispatchAgent(issue);
    // Suggest a recipient from env (a real deployment maps departments → inboxes).
    const suggestedTo = process.env.DISPATCH_TO_EMAIL || "";
    return res.json({ success: true, dispatch, suggestedTo });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err.message || "Dispatch draft failed." });
  }
});

/**
 * API Route: /api/send-dispatch
 * Sends the staff-approved work-order email via SMTP (reuses the OTP mailer).
 * In local dev without SMTP, returns a simulated preview so the flow is testable.
 */
app.post("/api/send-dispatch", async (req, res) => {
  const to = String(req.body?.to || "").trim().toLowerCase();
  const subject = String(req.body?.subject || "").trim();
  const body = String(req.body?.body || "").trim();
  if (!EMAIL_RE.test(to)) {
    return res.status(400).json({ error: "A valid recipient email is required." });
  }
  if (!subject || !body) {
    return res.status(400).json({ error: "Subject and body are required." });
  }

  const mailer = getMailer();
  const isProd = process.env.NODE_ENV === "production";
  if (!mailer) {
    if (isProd) {
      return res.status(503).json({
        error:
          "Email dispatch isn't configured on the server (set SMTP_* env vars).",
      });
    }
    // Dev: simulate a successful send so the demo flow works without SMTP.
    console.log(`[Dispatch] (simulated) → ${to} :: ${subject}`);
    return res.json({ success: true, sent: false, simulated: true });
  }

  try {
    const from = process.env.OTP_FROM_EMAIL || process.env.SMTP_USER || "CIVIC";
    await mailer.sendMail({
      from,
      to,
      subject,
      text: body,
      html: `<div style="font-family:sans-serif;white-space:pre-wrap">${body.replace(
        /</g,
        "&lt;",
      )}</div>`,
    });
    return res.json({ success: true, sent: true });
  } catch (e: any) {
    console.error("[Dispatch] SMTP send failed:", e?.message || e);
    return res.status(502).json({ error: "Failed to send the dispatch email." });
  }
});

// ---------------------------------------------------------------------------
// Admin gate — provisioning staff is restricted to the env-configured admin(s).
//
//   ADMIN_EMAILS       comma-separated admin email allowlist
//   ADMIN_SECRET_CODE  the "key" entered after login (only you know it)
//   ADMIN_TOTP_SECRET  base32 secret for the authenticator app (compulsory 2FA)
//
// All three are checked server-side. TOTP (RFC 6238, SHA1/6-digit/30s) is
// implemented with Node crypto — no dependency, no billing, no Firebase MFA.
// NOTE: the REAL authority to write config/roles is the Firestore rule that
// allows the admin email; this gate is the app-level lock on top.
// ---------------------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** Verifies a 6-digit TOTP against a base32 secret (±1 time-step tolerance). */
function verifyTotp(token: string, base32Secret: string): boolean {
  if (!base32Secret || !/^\d{6}$/.test(token)) return false;
  const secret = base32Decode(base32Secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let i = -1; i <= 1; i++) {
    if (hotp(secret, step + i) === token) return true;
  }
  return false;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function isAdminEmail(email: string): boolean {
  return adminEmails().includes(String(email || "").trim().toLowerCase());
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Lightweight check so the client knows whether to show the Admin Panel. */
app.post("/api/admin/whoami", (req, res) => {
  return res.json({ isAdmin: isAdminEmail(req.body?.email) });
});

/**
 * Returns an authenticator-app secret + otpauth URI for first-time 2FA setup.
 * Gated by the admin email + access code so the secret isn't world-readable. If
 * ADMIN_TOTP_SECRET is already set, returns it (to re-add on a new device);
 * otherwise generates one to COPY into the env var.
 */
app.post("/api/admin/totp-setup", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isAdminEmail(email))
    return res.status(403).json({ error: "Not an admin account." });
  const expected = process.env.ADMIN_SECRET_CODE || "";
  if (!expected)
    return res
      .status(503)
      .json({ error: "ADMIN_SECRET_CODE is not set on the server." });
  if (!safeEqual(String(req.body?.secretCode || ""), expected))
    return res.status(401).json({ error: "Enter the correct admin access code first." });

  const existing = process.env.ADMIN_TOTP_SECRET || "";
  const secret = existing || base32Encode(crypto.randomBytes(20));
  const label = encodeURIComponent(`CIVIC Admin (${email})`);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=CIVIC&algorithm=SHA1&digits=6&period=30`;
  return res.json({ secret, otpauth, alreadyConfigured: Boolean(existing) });
});

/**
 * Full admin verification: email allowlist + access code + authenticator code.
 * On success the client unlocks the provisioning panel. (Firestore rules still
 * independently gate the actual config/roles writes by the admin email.)
 */
app.post("/api/admin/verify", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isAdminEmail(email))
    return res.status(403).json({ error: "This account is not an administrator." });

  const expectedCode = process.env.ADMIN_SECRET_CODE || "";
  if (!expectedCode)
    return res
      .status(503)
      .json({ error: "Admin access code not configured (set ADMIN_SECRET_CODE)." });
  if (!safeEqual(String(req.body?.secretCode || ""), expectedCode))
    return res.status(401).json({ error: "Incorrect admin access code." });

  const totpSecret = process.env.ADMIN_TOTP_SECRET || "";
  if (!totpSecret)
    return res.status(503).json({
      error: "2FA isn't set up yet — use “Set up authenticator” to configure ADMIN_TOTP_SECRET.",
    });
  if (!verifyTotp(String(req.body?.totpCode || "").trim(), totpSecret))
    return res.status(401).json({ error: "Invalid authenticator code." });

  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Optional per-staff 2FA (authenticator app), enabled from a staff member's
// profile. The TOTP secret is AES-256-GCM encrypted with a SERVER-ONLY key
// (STAFF_2FA_KEY) before the client stores it in their own Firestore doc — so
// reading that doc reveals only ciphertext, and verification must come through
// the server. (No firebase-admin / Identity Platform / billing required.)
// ---------------------------------------------------------------------------
function staff2faKey(): Buffer | null {
  const k = process.env.STAFF_2FA_KEY;
  if (!k) return null;
  return crypto.createHash("sha256").update(k).digest(); // 32-byte AES key
}
function encryptSecret(secret: string): string {
  const key = staff2faKey() as Buffer;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}
function decryptSecret(blob: string): string | null {
  try {
    const key = staff2faKey() as Buffer;
    const raw = Buffer.from(blob, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// New secret + otpauth URI for staff enrollment (client renders the QR).
app.post("/api/staff/2fa/setup", (req, res) => {
  if (!staff2faKey())
    return res
      .status(503)
      .json({ error: "Staff 2FA isn't enabled on the server (set STAFF_2FA_KEY)." });
  const label = encodeURIComponent(`CIVIC Staff (${String(req.body?.email || "staff")})`);
  const secret = base32Encode(crypto.randomBytes(20));
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=CIVIC&algorithm=SHA1&digits=6&period=30`;
  return res.json({ secret, otpauth });
});

// Confirm the authenticator works, then hand back the ENCRYPTED secret to store.
app.post("/api/staff/2fa/enroll", (req, res) => {
  if (!staff2faKey())
    return res.status(503).json({ error: "Staff 2FA isn't enabled on the server." });
  const secret = String(req.body?.secret || "");
  const code = String(req.body?.code || "").trim();
  if (!verifyTotp(code, secret))
    return res
      .status(401)
      .json({ error: "That code didn't match — check your authenticator and try again." });
  return res.json({ enc: encryptSecret(secret) });
});

// Verify a login challenge against the stored ciphertext. Rate-limited.
const twofaAttempts = new Map<string, { count: number; reset: number }>();
app.post("/api/staff/2fa/verify", (req, res) => {
  if (!staff2faKey())
    return res.status(503).json({ error: "Staff 2FA isn't enabled on the server." });
  const enc = String(req.body?.enc || "");
  const code = String(req.body?.code || "").trim();
  const keyId = crypto.createHash("sha256").update(enc).digest("hex").slice(0, 16);
  const now = Date.now();
  const rec = twofaAttempts.get(keyId);
  if (rec && now < rec.reset && rec.count >= 10)
    return res.status(429).json({ error: "Too many attempts — wait a few minutes." });

  const secret = decryptSecret(enc);
  if (!secret) return res.status(400).json({ error: "Corrupt 2FA record." });
  if (!verifyTotp(code, secret)) {
    const r = rec && now < rec.reset ? rec : { count: 0, reset: now + 5 * 60 * 1000 };
    r.count += 1;
    twofaAttempts.set(keyId, r);
    return res.status(401).json({ error: "Invalid authenticator code." });
  }
  twofaAttempts.delete(keyId);
  return res.json({ ok: true });
});

/**
 * Auto-maps the city's ward names to municipal zones (Gemini). The Admin Panel
 * passes the distinct ward names found in the issues; the result is written to
 * config/wards and used to backfill issue zones — no manual mapping needed.
 */
app.post("/api/admin/map-zones", async (req, res) => {
  const wards = Array.isArray(req.body?.wards) ? req.body.wards : [];
  const city = String(req.body?.city || "");
  const state = String(req.body?.state || "");
  try {
    const wardToZone = await runZoneMappingAgent(wards, city, state);
    return res.json({ success: true, wardToZone });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err?.message || "Zone mapping failed." });
  }
});

/**
 * Emails a newly-provisioned staff member their temporary password. Called by
 * the Admin Panel right after the account is created. Reuses the SMTP mailer;
 * in local dev without SMTP it logs (and reports simulated) so the flow works.
 */
const STAFF_TIER_LABEL: Record<string, string> = {
  field: "Ward Officer",
  zonal: "Zonal Supervisor",
  city: "City Administrator",
};
app.post("/api/staff/invite", async (req, res) => {
  const to = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim() || "there";
  const tier = STAFF_TIER_LABEL[String(req.body?.tier || "")] || "staff";
  if (!EMAIL_RE.test(to))
    return res.status(400).json({ error: "A valid email is required." });
  if (!password)
    return res.status(400).json({ error: "Password is required." });

  const appUrl = process.env.APP_URL || "";
  const subject = "Your C.I.V.I.C. staff account";
  const text = `Hi ${name},

A C.I.V.I.C. ${tier} account has been created for you.

Sign in on the "Staff / Admin" tab${appUrl ? ` at ${appUrl}` : ""} with:
  Email:    ${to}
  Password: ${password}

This is a TEMPORARY password — you'll be asked to set your own on first sign-in.
Do not share it. Sign in with email & password (not Google).

— C.I.V.I.C.`;
  const html = `<div style="font-family:sans-serif;line-height:1.5">
<p>Hi ${name},</p>
<p>A C.I.V.I.C. <strong>${tier}</strong> account has been created for you.</p>
<p>Sign in on the <strong>Staff / Admin</strong> tab${appUrl ? ` at <a href="${appUrl}">${appUrl}</a>` : ""} with:</p>
<p style="background:#f3f4f6;padding:10px;border-radius:8px">
Email: <strong>${to}</strong><br/>Temporary password: <strong>${password}</strong></p>
<p>You'll be asked to set your own password on first sign-in. Do not share this, and sign in with email &amp; password (not Google).</p>
<p>— C.I.V.I.C.</p></div>`;

  const mailer = getMailer();
  const isProd = process.env.NODE_ENV === "production";
  if (!mailer) {
    if (isProd)
      return res
        .status(503)
        .json({ error: "Email isn't configured on the server (set SMTP_* env vars)." });
    console.log(`[Invite] (simulated) → ${to} :: temp password ${password}`);
    return res.json({ success: true, sent: false, simulated: true });
  }
  try {
    const from = process.env.OTP_FROM_EMAIL || process.env.SMTP_USER || "CIVIC";
    await mailer.sendMail({ from, to, subject, text, html });
    return res.json({ success: true, sent: true });
  } catch (e: any) {
    console.error("[Invite] SMTP send failed:", e?.message || e);
    return res.status(502).json({ error: "Failed to send the invite email." });
  }
});

// ---------------------------------------------------------------------------
// Email OTP verification for new email/password registrations.
//
// Codes are kept in-memory with a short TTL (no DB / no Firestore-rule changes).
// Delivery uses plain SMTP via nodemailer (free — e.g. a Gmail account + App
// Password; works with any SMTP provider). If SMTP isn't configured, the code is
// returned in the response in LOCAL DEV only so the flow stays testable.
// ---------------------------------------------------------------------------
interface OtpRecord {
  code: string;
  expires: number;
  attempts: number;
}
const otpStore = new Map<string, OtpRecord>();
const OTP_TTL_MS = 5 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Lazily build one SMTP transporter from env vars. Returns null if SMTP creds
// aren't set (then we fall back to dev-echo).
let mailTransporter: nodemailer.Transporter | null = null;
function getMailer(): nodemailer.Transporter | null {
  if (mailTransporter) return mailTransporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  });
  return mailTransporter;
}

async function sendOtpEmail(email: string, code: string): Promise<boolean> {
  const mailer = getMailer();
  if (!mailer) return false;
  const from =
    process.env.OTP_FROM_EMAIL || process.env.SMTP_USER || "CIVIC";
  try {
    await mailer.sendMail({
      from,
      to: email,
      subject: "Your CIVIC verification code",
      text: `Your CIVIC verification code is ${code}. It expires in 5 minutes.`,
      html: `<div style="font-family:sans-serif"><p>Your CIVIC verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 5 minutes. If you didn't request this, ignore this email.</p></div>`,
    });
    return true;
  } catch (e) {
    console.error("[OTP] SMTP send failed:", (e as Error)?.message || e);
    return false;
  }
}

app.post("/api/send-otp", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  const code = generateOtp();
  otpStore.set(email, { code, expires: Date.now() + OTP_TTL_MS, attempts: 0 });
  const sent = await sendOtpEmail(email, code);
  const isProd = process.env.NODE_ENV === "production";
  console.log(`[OTP] ${email} -> ${code} (emailed=${sent})`);
  if (!sent && isProd) {
    // Never leak codes in production — require an email provider there.
    return res.status(503).json({
      error:
        "Email verification isn't configured on the server. Please try Google sign-in.",
    });
  }
  // Local/dev convenience only: echo the code so the flow is testable without
  // an email provider. This NEVER runs in production.
  const devCode = !sent && !isProd ? code : undefined;
  return res.json({ success: true, sent, ...(devCode ? { devCode } : {}) });
});

app.post("/api/verify-otp", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const rec = otpStore.get(email);
  if (!rec) {
    return res
      .status(400)
      .json({ error: "No code was requested. Please resend." });
  }
  if (Date.now() > rec.expires) {
    otpStore.delete(email);
    return res.status(400).json({ error: "Code expired. Please resend." });
  }
  rec.attempts += 1;
  if (rec.attempts > 5) {
    otpStore.delete(email);
    return res
      .status(429)
      .json({ error: "Too many attempts. Please request a new code." });
  }
  if (rec.code !== code) {
    return res.status(400).json({ error: "Incorrect code. Try again." });
  }
  otpStore.delete(email);
  return res.json({ success: true, verified: true });
});

/**
 * Configures the pipeline interface with Vite or Production assets serving.
 */
async function mountApplication() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Mounting in DEVELOPMENT mode.");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Mounting in PRODUCTION mode.");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[C.I.V.I.C.] Running fully active on http://0.0.0.0:${PORT}`);
  });
}

mountApplication();
