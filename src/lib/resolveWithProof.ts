/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared "resolve an issue WITH photographic proof" flow, used by both the map
 * detail sheet (CommandMap) and the Kanban board (SmartAssignmentBoard) so the
 * board can no longer resolve an issue by a bare drag-and-drop.
 *
 * Steps: downscale the after-photo (keeps Firestore docs under the 1 MB limit
 * even with before + after + escalation images) → POST /api/verify-resolution
 * (Gemini before/after check) → on confirmation, resolveIssue() transaction.
 */

import { resolveIssue } from "./firebase";
import { CivicIssue } from "../types";

export interface ResolutionOutcome {
  isResolved: boolean;
  confidence: number;
  notes: string;
  resolvedImageUrl?: string; // the (downscaled) after-image, present on success
}

/**
 * Downscales a base64 data URL to at most `maxDim` on its longest edge and
 * re-encodes as JPEG. Falls back to the original string if anything fails
 * (e.g. SSR / no canvas) so the flow never hard-breaks.
 */
export function downscaleDataUrl(
  dataUrl: string,
  maxDim = 1280,
  quality = 0.7,
): Promise<string> {
  return new Promise((resolve) => {
    try {
      if (typeof document === "undefined" || !dataUrl.startsWith("data:image")) {
        return resolve(dataUrl);
      }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/** Reads a File into a base64 data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Runs the full proof-gated resolution for one issue. Returns the verification
 * outcome; the caller surfaces failures to the UI. Only writes "Resolved" when
 * the AI confirms the fix.
 */
export async function resolveWithProof(opts: {
  issue: CivicIssue;
  file: File;
  resolverUid: string;
}): Promise<ResolutionOutcome> {
  const { issue, file, resolverUid } = opts;
  const raw = await fileToDataUrl(file);
  const afterImage = await downscaleDataUrl(raw, 1280, 0.6);

  const response = await fetch("/api/verify-resolution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      beforeImage: issue.imageUrl,
      afterImage,
      mimeType: "image/jpeg",
      category: issue.category,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Verification failed.");

  const v = data.verification as {
    isResolved: boolean;
    confidence: number;
    notes: string;
  };

  if (v.isResolved) {
    // Firestore caps a document at 1 MB. The doc already holds the original
    // base64 image; adding the after-photo (and any escalation history) can
    // exceed it. If the combined size is too big, recompress the BEFORE image
    // so the resolve write fits — handles large legacy reports too.
    let beforeImageUrl: string | undefined;
    const BUDGET = 760_000; // bytes, leaves headroom for other doc fields
    let combined = approxBytes(issue.imageUrl) + approxBytes(afterImage) + approxHistoryBytes(issue);
    if (combined > BUDGET && issue.imageUrl) {
      beforeImageUrl = await downscaleDataUrl(issue.imageUrl, 1024, 0.5);
      combined = approxBytes(beforeImageUrl) + approxBytes(afterImage) + approxHistoryBytes(issue);
      if (combined > BUDGET) {
        // Still tight — shrink the before image harder.
        beforeImageUrl = await downscaleDataUrl(issue.imageUrl, 720, 0.45);
      }
    }
    await resolveIssue(issue.id, resolverUid, {
      resolvedImageUrl: afterImage,
      resolutionConfidence: v.confidence,
      resolutionNotes: v.notes,
      ...(beforeImageUrl ? { beforeImageUrl } : {}),
    });
    return { ...v, resolvedImageUrl: afterImage };
  }
  return v;
}

/** Rough byte size of a base64 data URL (base64 is ~4/3 of the raw bytes). */
export function approxBytes(dataUrl?: string): number {
  return dataUrl ? Math.floor(dataUrl.length * 0.75) : 0;
}

function approxHistoryBytes(issue: CivicIssue): number {
  return (issue.escalationHistory || []).reduce(
    (sum, r) => sum + approxBytes(r.previousResolvedImageUrl),
    0,
  );
}
