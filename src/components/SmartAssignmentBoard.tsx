/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { CivicIssue, CivicStatus, CivicCategory, UserScope } from "../types";
import type { User } from "firebase/auth";
import { db, corroborateAndApprove } from "../lib/firebase";
import { canActOnIssue, statusOptions, statusLabel } from "../lib/roles";
import { doc, updateDoc } from "firebase/firestore";
import {
  LayoutDashboard,
  Pin,
  X,
  ShieldCheck,
  Truck,
  Send,
  Loader2,
  Check,
} from "lucide-react";

interface KanbanProps {
  issues: CivicIssue[];
  currentUser: User | null;
  scope: UserScope;
}

// Each board column groups one or more real issue statuses. The first status in
// `statuses` is the canonical one applied when a card is dropped into the column.
// The "Reported" column was removed (reports auto-route on submission). Any
// legacy "Reported" issues are folded into the "Routed / Verify" column so they
// never disappear from the board. The canonical drop status is the first entry.
const COLUMNS: { key: string; label: string; statuses: CivicStatus[] }[] = [
  {
    key: "routed",
    label: "Routed / Verify",
    statuses: [
      "Auto-Routed",
      "Requires Human Verification",
      "Corroborated Report",
      // Trust Engine: fresh trust-track reports + suspected fraud await review.
      "Pending Verification",
      "Flagged for Review",
      // Legacy/edge: pre-auto-route submissions still surface here.
      "Reported",
    ],
  },
  {
    key: "verified",
    label: "Verified",
    // Canonical drop status is "Staff Verified" (a staff action in this column).
    statuses: ["Staff Verified", "Community Verified"],
  },
  { key: "in-progress", label: "In Progress", statuses: ["In Progress"] },
  { key: "resolved", label: "Resolved", statuses: ["Resolved"] },
];

const CATEGORIES: (CivicCategory | "All")[] = [
  "All",
  "Pothole",
  "Water Leak",
  "Vandalism",
  "Streetlight Out",
  "Waste Issue",
  "Other",
];

const priorityColor = (tier?: string) =>
  tier === "P1"
    ? "#EF4444"
    : tier === "P2"
      ? "#F59E0B"
      : tier === "P3"
        ? "#3B82F6"
        : "#9CA3AF";

export default function SmartAssignmentBoard({
  issues,
  currentUser,
  scope,
}: KanbanProps) {
  const uid = currentUser?.uid || "anon";
  const pinKey = `civic_pins_${uid}`;

  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<CivicCategory | "All">(
    "All",
  );
  const [draggedIssue, setDraggedIssue] = useState<CivicIssue | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [detailIssue, setDetailIssue] = useState<CivicIssue | null>(null);
  // Keep the open detail card in sync with the live snapshot.
  const liveDetail = detailIssue
    ? issues.find((i) => i.id === detailIssue.id) ?? detailIssue
    : null;

  // Pins are per-account: each signed-in uid keeps its own pinned set.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(pinKey);
      setPinned(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      setPinned(new Set());
    }
  }, [pinKey]);

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem(pinKey, JSON.stringify([...next]));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };

  const setStatus = async (issue: CivicIssue, status: CivicStatus) => {
    if (issue.status === status) return;
    try {
      await updateDoc(doc(db, "issues", issue.id), { status });
    } catch (err) {
      console.error("Failed to move card:", err);
    }
  };

  // RULE B — Official Staff Override: bypass community thresholds and promote
  // straight to "Staff Verified". Only staff whose scope covers the issue.
  const [approving, setApproving] = useState<string | null>(null);
  const handleApprove = async (issue: CivicIssue) => {
    if (!currentUser) return;
    setApproving(issue.id);
    try {
      await corroborateAndApprove(issue.id, currentUser.uid);
    } catch (err) {
      console.error("Staff approval failed:", err);
    } finally {
      setApproving(null);
    }
  };

  // --- Auto-Dispatch Agent: draft a work-order email, staff approves & sends ---
  interface DispatchDraft {
    toName: string;
    subject: string;
    body: string;
  }
  const [dispatchDraft, setDispatchDraft] = useState<DispatchDraft | null>(null);
  const [dispatchTo, setDispatchTo] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const resetDispatch = () => {
    setDispatchDraft(null);
    setDispatchTo("");
    setDrafting(false);
    setSending(false);
    setDispatchError(null);
  };

  const draftDispatch = async (issue: CivicIssue) => {
    setDrafting(true);
    setDispatchError(null);
    setDispatchDraft(null);
    try {
      const res = await fetch("/api/draft-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed.");
      setDispatchDraft(data.dispatch);
      if (data.suggestedTo) setDispatchTo(data.suggestedTo);
    } catch (err: any) {
      setDispatchError(err.message || "Couldn't draft the dispatch.");
    } finally {
      setDrafting(false);
    }
  };

  const sendDispatch = async (issue: CivicIssue) => {
    if (!dispatchDraft) return;
    setSending(true);
    setDispatchError(null);
    try {
      const res = await fetch("/api/send-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: dispatchTo,
          subject: dispatchDraft.subject,
          body: dispatchDraft.body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      // Record the dispatch on the issue and advance it to In Progress.
      try {
        await updateDoc(doc(db, "issues", issue.id), {
          status: "In Progress",
          dispatchedAt: Date.now(),
          dispatchedToName: dispatchDraft.toName,
          dispatchSummary: dispatchDraft.subject,
        });
      } catch (e) {
        console.warn("Dispatch recorded but status update skipped:", e);
      }
      resetDispatch();
    } catch (err: any) {
      setDispatchError(err.message || "Couldn't send the dispatch.");
    } finally {
      setSending(false);
    }
  };

  const onDrop = async (statuses: CivicStatus[]) => {
    const issue = draggedIssue;
    setDraggedIssue(null);
    setDragOverCol(null);
    if (!issue || statuses.includes(issue.status)) return;
    await setStatus(issue, statuses[0]);
  };

  const matchesCategory = (i: CivicIssue) =>
    categoryFilter === "All" || i.category === categoryFilter;
  const visibleIssues = issues.filter(matchesCategory);
  const pinnedIssues = visibleIssues.filter((i) => pinned.has(i.id));

  const Card = (issue: CivicIssue) => {
    const isPinned = pinned.has(issue.id);
    return (
      <div
        key={issue.id}
        draggable
        onDragStart={() => setDraggedIssue(issue)}
        onDragEnd={() => setDraggedIssue(null)}
        onClick={() => setDetailIssue(issue)}
        title="Click for full details"
        className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm cursor-pointer active:cursor-grabbing border-l-4 border border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
        style={{ borderLeftColor: priorityColor(issue.priorityTier) }}
      >
        <div className="flex items-start gap-2.5">
          <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            {issue.imageUrl ? (
              <img
                src={issue.imageUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-xs text-gray-900 dark:text-white truncate">
              {issue.category}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
              {issue.recommendedDepartment || "General Ops"}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              {issue.priorityTier && (
                <span className="text-[9px] bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full font-bold text-gray-700 dark:text-gray-300">
                  {issue.priorityTier}
                </span>
              )}
              {issue.ward && (
                <span className="text-[9px] text-gray-400 dark:text-gray-500 truncate">
                  📍 {issue.ward}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePin(issue.id);
            }}
            title={isPinned ? "Unpin" : "Pin to top"}
            aria-pressed={isPinned}
            className={`shrink-0 p-1.5 rounded-lg transition-colors cursor-pointer ${
              isPinned
                ? "text-primary"
                : "text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400"
            }`}
          >
            <Pin
              className="w-4 h-4"
              fill={isPinned ? "currentColor" : "none"}
            />
          </button>
        </div>

        {/* Non-drag alternative (keyboard/touch accessible). */}
        <div
          className="mt-2.5 border-t border-gray-100 dark:border-gray-700 pt-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="sr-only">Move to status</label>
          <select
            value={issue.status}
            onChange={(e) => setStatus(issue, e.target.value as CivicStatus)}
            className="w-full text-[10px] min-h-[38px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2 font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
          >
            {statusOptions(issue.status).map((s) => (
              <option key={s} value={s}>
                Move: {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto w-full min-w-0 text-gray-900 dark:text-white">
      <div className="mb-4">
        <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="w-7 h-7 shrink-0" />
          Smart Assignment Board
        </h2>
        <p className="text-sm text-[#717171] dark:text-gray-400 mt-1">
          Drag a card between columns (or use its dropdown) to update status. Pin
          cards you're actively working on to the top — pins are saved per account.
        </p>
      </div>

      {/* Filter by issue type */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-3 mb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer shrink-0 ${
              categoryFilter === cat
                ? "bg-primary text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Pinned strip */}
      {pinnedIssues.length > 0 && (
        <div className="mb-5 rounded-2xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-2.5 flex items-center gap-1.5">
            <Pin className="w-3.5 h-3.5" fill="currentColor" />
            Pinned · actively working ({pinnedIssues.length})
          </h3>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {pinnedIssues.map((issue) => (
              <div key={issue.id} className="w-60 shrink-0">
                {Card(issue)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Columns: stacked full-width on mobile (no horizontal scroll → no page
          overflow); a comfortable row on desktop (scrolls if it can't fit). */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full min-w-0 sm:overflow-x-auto pb-6">
        {COLUMNS.map((col) => {
          const cards = visibleIssues.filter((i) =>
            col.statuses.includes(i.status),
          );
          const isOver = dragOverCol === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.key);
              }}
              onDragLeave={() =>
                setDragOverCol((c) => (c === col.key ? null : c))
              }
              onDrop={() => onDrop(col.statuses)}
              className={`w-full sm:w-auto sm:flex-1 sm:min-w-[15rem] rounded-2xl p-3 flex flex-col border transition-colors ${
                isOver
                  ? "bg-primary/5 border-primary/40 dark:bg-primary/10"
                  : "bg-gray-100 dark:bg-gray-800/60 border-gray-200 dark:border-gray-800"
              }`}
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-bold text-sm text-gray-700 dark:text-gray-200">
                  {col.label}
                </h3>
                <span className="bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded-full text-[11px] font-bold border border-gray-200 dark:border-gray-600">
                  {cards.length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 max-h-[44vh] sm:max-h-[58vh] pr-0.5">
                {cards.length === 0 ? (
                  <div className="text-center text-[11px] text-gray-400 dark:text-gray-600 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl py-8">
                    No issues here
                  </div>
                ) : (
                  cards.map((issue) => Card(issue))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Card detail modal */}
      {liveDetail && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
          onClick={() => {
            setDetailIssue(null);
            resetDispatch();
          }}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl relative animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setDetailIssue(null);
                resetDispatch();
              }}
              className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {liveDetail.imageUrl && (
              <img
                src={liveDetail.imageUrl}
                alt={liveDetail.category}
                className="w-full h-52 object-cover rounded-t-3xl"
              />
            )}

            <div className="p-6 space-y-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {liveDetail.category}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                      liveDetail.severityScore >= 8
                        ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                        : liveDetail.severityScore >= 5
                          ? "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800"
                          : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700"
                    }`}
                  >
                    Sev {liveDetail.severityScore}/10
                  </span>
                  {liveDetail.priorityTier && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
                      {liveDetail.priorityTier} · {liveDetail.slaTargetHours}h SLA
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Routed to{" "}
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {liveDetail.recommendedDepartment || "General Operations"}
                  </span>{" "}
                  · Status:{" "}
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {liveDetail.status}
                  </span>
                </p>
                {liveDetail.urgencyReasoning && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg px-2.5 py-1.5">
                    <strong>Ranked {liveDetail.priorityTier || "P3"}:</strong>{" "}
                    {liveDetail.urgencyReasoning}
                  </p>
                )}
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed border border-gray-100 dark:border-gray-700">
                {liveDetail.description || "No description provided."}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <Detail label="Reported by" value={liveDetail.reportedByName} />
                <Detail
                  label="Reported"
                  value={new Date(liveDetail.reportedAt).toLocaleString()}
                />
                <Detail
                  label="Location"
                  value={
                    [liveDetail.ward, liveDetail.city, liveDetail.state]
                      .filter(Boolean)
                      .join(", ") || "—"
                  }
                />
                <Detail label="Zone" value={liveDetail.zone || "—"} />
                {liveDetail.address && (
                  <div className="col-span-2">
                    <Detail label="Address" value={liveDetail.address} />
                  </div>
                )}
                <Detail
                  label="Upvotes"
                  value={String(liveDetail.upvotesCount || 0)}
                />
                <Detail
                  label="Corroborations"
                  value={String(liveDetail.duplicateCount || 1)}
                />
              </div>

              {/* RULE B — Official Staff Override */}
              {canActOnIssue(scope, liveDetail) &&
                liveDetail.status !== "Staff Verified" &&
                liveDetail.status !== "Resolved" && (
                  <button
                    onClick={() => handleApprove(liveDetail)}
                    disabled={approving === liveDetail.id}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-widest py-3 rounded-xl transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {approving === liveDetail.id
                      ? "Approving…"
                      : "Corroborate & Approve"}
                  </button>
                )}

              {/* Auto-Dispatch Agent — draft a work-order, review, one-click send */}
              {canActOnIssue(scope, liveDetail) &&
                liveDetail.status !== "Resolved" && (
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5" /> Auto-Dispatch
                      </span>
                      {liveDetail.dispatchedAt && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Dispatched to{" "}
                          {liveDetail.dispatchedToName || "department"}
                        </span>
                      )}
                    </div>

                    {!dispatchDraft ? (
                      <button
                        onClick={() => draftDispatch(liveDetail)}
                        disabled={drafting}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-widest py-2.5 rounded-xl transition-colors cursor-pointer"
                      >
                        {drafting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Truck className="w-4 h-4" />
                        )}
                        {drafting
                          ? "Drafting work-order…"
                          : liveDetail.dispatchedAt
                            ? "Re-draft Dispatch"
                            : "Draft Dispatch"}
                      </button>
                    ) : (
                      <div className="space-y-2.5 animate-in fade-in duration-200">
                        <div>
                          <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                            To (department inbox)
                          </label>
                          <input
                            type="email"
                            value={dispatchTo}
                            onChange={(e) => setDispatchTo(e.target.value)}
                            placeholder="works.dept@city.gov"
                            className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary text-gray-800 dark:text-gray-200"
                          />
                          <p className="text-[9px] text-gray-400 mt-1">
                            Addressed to:{" "}
                            <span className="font-semibold">
                              {dispatchDraft.toName}
                            </span>
                          </p>
                        </div>
                        <input
                          type="text"
                          value={dispatchDraft.subject}
                          onChange={(e) =>
                            setDispatchDraft({
                              ...dispatchDraft,
                              subject: e.target.value,
                            })
                          }
                          className="w-full text-xs font-semibold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary text-gray-800 dark:text-gray-200"
                        />
                        <textarea
                          value={dispatchDraft.body}
                          onChange={(e) =>
                            setDispatchDraft({
                              ...dispatchDraft,
                              body: e.target.value,
                            })
                          }
                          rows={6}
                          className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary text-gray-700 dark:text-gray-300 leading-relaxed"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => sendDispatch(liveDetail)}
                            disabled={sending || !dispatchTo.trim()}
                            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-widest py-2.5 rounded-xl transition-colors cursor-pointer"
                          >
                            {sending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            {sending ? "Sending…" : "Approve & Send"}
                          </button>
                          <button
                            onClick={resetDispatch}
                            disabled={sending}
                            className="px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold text-xs uppercase tracking-widest py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {dispatchError && (
                      <p className="text-[11px] text-red-600 dark:text-red-400">
                        {dispatchError}
                      </p>
                    )}
                  </div>
                )}

              {/* Quick status change from the detail view */}
              <div className="pt-1">
                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  Update status
                </label>
                <select
                  value={liveDetail.status}
                  onChange={(e) =>
                    setStatus(liveDetail, e.target.value as CivicStatus)
                  }
                  className="w-full text-xs min-h-[44px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl px-3 font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                >
                  {statusOptions(liveDetail.status).map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-gray-800 dark:text-gray-200 font-medium break-words">
        {value || "—"}
      </p>
    </div>
  );
}
