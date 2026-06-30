/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared "resolve with photographic proof" modal, used by the map detail sheet,
 * the Kanban board, and the staff archive. It walks through three stages in one
 * popup — prompt → verifying (AI) → result — so the "Verifying with AI" state is
 * shown right here instead of a detached bottom toast.
 */

import React, { useRef, useState } from "react";
import type { User } from "firebase/auth";
import confetti from "canvas-confetti";
import { resolveWithProof, ResolutionOutcome } from "../lib/resolveWithProof";
import { T, useTr } from "../lib/translate";
import { CivicIssue } from "../types";
import { X, Camera, Upload, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

export default function ResolveProofModal({
  issue,
  currentUser,
  onClose,
  onResolved,
}: {
  issue: CivicIssue;
  currentUser: User | null;
  onClose: () => void;
  onResolved?: (issue: CivicIssue) => void;
}) {
  const tr = useTr();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<"prompt" | "verifying" | "done">("prompt");
  const [outcome, setOutcome] = useState<ResolutionOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !currentUser) return;
    setStage("verifying");
    setError(null);
    try {
      const o = await resolveWithProof({ issue, file, resolverUid: currentUser.uid });
      setOutcome(o);
      setStage("done");
      if (o.isResolved) {
        confetti({ particleCount: 80, spread: 65, origin: { y: 0.7 }, colors: ["#16A34A", "#2F6F6A"] });
        onResolved?.({ ...issue, status: "Resolved", resolvedImageUrl: o.resolvedImageUrl });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the fix.");
      setStage("done");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div className="relative bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-sm w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <input type="file" accept="image/*" ref={inputRef} onChange={onFile} className="hidden" />

        {stage === "prompt" && (
          <>
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto">
              <Camera className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                <T>Photographic proof required</T>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                <T>To mark this issue as resolved, upload an "after" photo of the fix. The AI compares it to the original report before the status changes.</T>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <T>Cancel</T>
              </button>
              <button
                onClick={() => inputRef.current?.click()}
                className="flex-1 py-2.5 rounded-full bg-primary hover:bg-primary-dark text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" /> <T>Upload after-photo</T>
              </button>
            </div>
          </>
        )}

        {stage === "verifying" && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <Loader2 className="w-9 h-9 text-primary animate-spin" />
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              <T>Verifying the fix with AI…</T>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <T>Comparing your after-photo to the original report.</T>
            </p>
          </div>
        )}

        {stage === "done" && (
          <>
            {outcome?.isResolved ? (
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white"><T>Resolved</T></h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {tr("AI confirmed the fix")} ({outcome.confidence}%{" "}
                  {tr("confidence")}).
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white"><T>Not resolved yet</T></h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {error || outcome?.notes || tr("The photo didn't confirm the fix.")}
                </p>
              </div>
            )}
            <div className="flex gap-3">
              {!outcome?.isResolved && (
                <button
                  onClick={() => { setStage("prompt"); setOutcome(null); setError(null); }}
                  className="flex-1 py-2.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  <T>Try another photo</T>
                </button>
              )}
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-bold transition-colors cursor-pointer"
              >
                <T>Done</T>
              </button>
            </div>
          </>
        )}

        {stage !== "verifying" && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
