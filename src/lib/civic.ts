/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client-side "civic intelligence": the deterministic core behind the three
 * agentic features (Neighbourhood Watch, Petitions, Missions). These run
 * instantly with no AI call so notifications/insights always appear; the AI
 * agents enrich the narrative on top (petition body, mission coaching, etc.).
 */

import { CivicIssue } from "../types";

export const PETITION_THRESHOLD = 10; // upvotes+corroborations to unlock a petition
const WATCH_WINDOW_MS = 48 * 60 * 60 * 1000; // "recent" window for watch alerts
const RANKS: { title: string; min: number }[] = [
  { title: "Civic Novice", min: 0 },
  { title: "Local Vigilante", min: 50 },
  { title: "Neighbourhood Champion", min: 150 },
  { title: "Urban Architect", min: 300 },
  { title: "Metropolitan Guardian", min: 500 },
];

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** The citizen's most active ward (their "home" area). */
export function homeWard(
  issues: CivicIssue[],
  uid: string | undefined,
  fallbackWard?: string,
): string | undefined {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    if (i.reportedByUid === uid && i.ward) {
      counts[i.ward] = (counts[i.ward] || 0) + 1;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : fallbackWard;
}

/** Approximate "home" coordinate = average of the user's report locations. */
export function homeCoords(
  issues: CivicIssue[],
  uid: string | undefined,
): { lat: number; lng: number } | null {
  const mine = issues.filter((i) => i.reportedByUid === uid);
  if (mine.length === 0) return null;
  const lat = mine.reduce((s, i) => s + i.latitude, 0) / mine.length;
  const lng = mine.reduce((s, i) => s + i.longitude, 0) / mine.length;
  return { lat, lng };
}

const PREDICTION: Record<string, string> = {
  "Water Leak":
    "It may cause water-pressure drops or pooling on nearby roads tonight.",
  Pothole: "It could be a hazard for vehicles and two-wheelers on your route.",
  "Streetlight Out": "It may reduce visibility and safety after dark nearby.",
  "Waste Issue": "It could attract pests and odour in your neighbourhood.",
  Vandalism: "It may point to a safety concern in your area.",
  Other: "It may affect your neighbourhood.",
};

export interface WatchAlert {
  id: string;
  issueId: string;
  message: string;
  time: number;
  severity: number;
}

/**
 * Neighbourhood Watch: recent, notable issues near the citizen's home that they
 * did NOT report — surfaced with a short predictive narrative.
 */
export function neighborhoodAlerts(
  issues: CivicIssue[],
  uid: string | undefined,
  fallbackWard?: string,
): WatchAlert[] {
  const ward = homeWard(issues, uid, fallbackWard);
  const home = homeCoords(issues, uid);
  const now = Date.now();
  return issues
    .filter(
      (i) =>
        i.reportedByUid !== uid &&
        i.status !== "Resolved" &&
        now - i.reportedAt < WATCH_WINDOW_MS &&
        i.severityScore >= 5 &&
        ((ward && i.ward === ward) ||
          (home &&
            haversineMeters(home.lat, home.lng, i.latitude, i.longitude) <=
              800)),
    )
    .sort((a, b) => b.reportedAt - a.reportedAt)
    .slice(0, 8)
    .map((i) => {
      const dist =
        home &&
        Math.round(
          haversineMeters(home.lat, home.lng, i.latitude, i.longitude),
        );
      const where = dist ? `${dist}m from your usual area` : `in ${i.ward}`;
      const sev = i.severityScore >= 8 ? "severe " : "";
      return {
        id: `watch-${i.id}`,
        issueId: i.id,
        time: i.reportedAt,
        severity: i.severityScore,
        message: `A ${sev}${i.category.toLowerCase()} was just reported ${where}. ${
          PREDICTION[i.category] || PREDICTION.Other
        } Plan accordingly.`,
      };
    });
}

export interface NextRank {
  title: string;
  needed: number;
}

/** Points needed to reach the next civic rank (null if at the top). */
export function nextRank(points: number): NextRank | null {
  const next = RANKS.find((r) => r.min > points);
  return next ? { title: next.title, needed: next.min - points } : null;
}

export interface Mission {
  id: string;
  title: string;
  detail: string;
  issueId?: string;
}

/**
 * Missions Coach (rule-based core): personalised nudges from rank progress and
 * nearby unverified reports the citizen could corroborate.
 */
export function missions(
  issues: CivicIssue[],
  uid: string | undefined,
  points: number,
  fallbackWard?: string,
): Mission[] {
  const out: Mission[] = [];
  const nr = nextRank(points);
  if (nr) {
    out.push({
      id: "rank",
      title: `${nr.needed} points to ${nr.title}`,
      detail: `File or corroborate reports to reach ${nr.title}.`,
    });
  }

  const ward = homeWard(issues, uid, fallbackWard);
  const toVerify = issues.filter(
    (i) =>
      i.reportedByUid !== uid &&
      (i.status === "Requires Human Verification" || i.status === "Reported") &&
      (i.upvotedBy || []).indexOf(uid || "") === -1 &&
      (!ward || i.ward === ward),
  );
  toVerify.slice(0, 2).forEach((i) =>
    out.push({
      id: `verify-${i.id}`,
      issueId: i.id,
      title: `Corroborate a ${i.category}`,
      detail: `An unverified ${i.category.toLowerCase()} near ${
        i.ward || "your area"
      } needs community confirmation. Tap to view & upvote.`,
    }),
  );

  if (out.length < 2) {
    out.push({
      id: "report",
      title: "Spot something? Report it",
      detail: "Snap a photo of any civic issue to earn +10 impact points.",
    });
  }
  return out.slice(0, 3);
}

/** True once an issue has enough community backing to warrant a petition. */
export function petitionEligible(issue: CivicIssue): boolean {
  const support = (issue.upvotesCount || 0) + ((issue.duplicateCount || 1) - 1);
  return support >= PETITION_THRESHOLD;
}
