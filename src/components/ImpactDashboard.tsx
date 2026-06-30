/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from "react";
import type { User } from "firebase/auth";
import { Sparkles, Target } from "lucide-react";
import { CitizenProfile, LeaderboardEntry, CivicIssue } from "../types";
import { aiLanguageName } from "../i18n";
import { T } from "../lib/translate";
import {
  calculateCivicRank,
  computeImpactPoints,
  computeReportsCount,
  WELCOME_POINTS,
  POINTS_PER_REPORT,
  POINTS_PER_RESOLVED,
} from "../lib/firebase";
import { missions as buildMissions, nextRank } from "../lib/civic";
import { BADGES, BadgeMedal, computeBadgeStats } from "./../lib/badges";

interface ImpactProps {
  currentUser: User | null;
  currentProfile: CitizenProfile | null;
  issues: CivicIssue[];
}

export default function ImpactDashboard({
  currentUser,
  currentProfile,
  issues,
}: ImpactProps) {
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [impactStory, setImpactStory] = useState<{
    title: string;
    story: string;
  } | null>(null);

  // Everything is derived from the live issues collection — one source of
  // truth, so counts can never drift (purge/delete are automatically correct).
  const liveReportsCount = currentUser
    ? computeReportsCount(issues, currentUser.uid)
    : 0;
  const liveImpactPoints = currentUser
    ? computeImpactPoints(issues, currentUser.uid)
    : 0;
  const liveResolvedCount = issues.filter(
    (i) => i.reportedByUid === currentUser?.uid && i.status === "Resolved",
  ).length;
  const liveCivicRank = calculateCivicRank(liveImpactPoints);
  const badgeStats = computeBadgeStats(issues, currentUser?.uid, liveImpactPoints);

  // Missions Coach (rule-based missions + an AI coaching line on top).
  const myMissions = useMemo(
    () =>
      buildMissions(
        issues,
        currentUser?.uid,
        liveImpactPoints,
        currentProfile?.ward,
      ),
    [issues, currentUser?.uid, liveImpactPoints, currentProfile?.ward],
  );
  const [coach, setCoach] = useState<string>("");
  useEffect(() => {
    if (!currentUser) return;
    const nr = nextRank(liveImpactPoints);
    const ctx = {
      rank: liveCivicRank,
      points: liveImpactPoints,
      nextRank: nr?.title,
      pointsToNext: nr?.needed,
      ward: currentProfile?.ward,
      openMissions: myMissions.map((m) => m.title),
    };
    let cancelled = false;
    fetch("/api/missions-coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: ctx, language: aiLanguageName() }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.coach) setCoach(d.coach);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Refresh when standing changes meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveImpactPoints, myMissions.length]);

  // Leaderboard aggregated from issues (not a stored counter).
  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    const byUser = new Map<string, LeaderboardEntry>();
    for (const issue of issues) {
      const existing = byUser.get(issue.reportedByUid) || {
        uid: issue.reportedByUid,
        displayName: issue.reportedByName || "Civic Hero",
        impactPoints: WELCOME_POINTS,
        civicRank: "Civic Novice",
        reportsCount: 0,
        ward: issue.ward,
      };
      existing.reportsCount += 1;
      existing.impactPoints +=
        POINTS_PER_REPORT + (issue.status === "Resolved" ? POINTS_PER_RESOLVED : 0);
      if (issue.ward) existing.ward = issue.ward;
      byUser.set(issue.reportedByUid, existing);
    }
    return Array.from(byUser.values())
      .map((e) => ({ ...e, civicRank: calculateCivicRank(e.impactPoints) }))
      .sort((a, b) => b.impactPoints - a.impactPoints)
      .slice(0, 10);
  }, [issues]);

  const generateStory = async () => {
    if (!currentProfile) return;
    setIsGeneratingStory(true);
    setImpactStory(null);
    try {
      const response = await fetch("/api/impact-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stats: {
            reports: liveReportsCount,
            resolved: liveResolvedCount,
            points: liveImpactPoints,
          },
          language: aiLanguageName(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setImpactStory(data.story);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const getProgressToNextRank = (points: number) => {
    let currentLimit = 0,
      nextLimit = 50,
      nextTitle = "Level 2 Guardian";
    if (points >= 500)
      return { percentage: 100, remaining: 0, nextTitle: "Max Level" };
    else if (points >= 300) {
      currentLimit = 300;
      nextLimit = 500;
      nextTitle = "Level 5";
    } else if (points >= 150) {
      currentLimit = 150;
      nextLimit = 300;
      nextTitle = "Level 4";
    } else if (points >= 50) {
      currentLimit = 50;
      nextLimit = 150;
      nextTitle = "Level 3";
    }
    const percent = Math.min(
      100,
      Math.max(0, ((points - currentLimit) / (nextLimit - currentLimit)) * 100),
    );
    return {
      percentage: Math.round(percent),
      remaining: nextLimit - points,
      nextTitle,
    };
  };

  const progress = currentProfile
    ? getProgressToNextRank(liveImpactPoints)
    : null;

  return (
   <div className="space-y-5">
    {/* AI Missions Coach */}
    <div className="glass-card rounded-3xl p-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-emerald-500" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-700 dark:text-gray-200">
          <T>Your Missions</T>
        </h3>
      </div>
      {coach && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed bg-emerald-50/60 dark:bg-emerald-900/15 border border-emerald-100 dark:border-emerald-800/40 rounded-2xl p-3">
          {coach}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {myMissions.map((m) => (
          <div
            key={m.id}
            className="p-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-1.5 text-primary">
              <Target className="w-3.5 h-3.5" />
              <p className="text-xs font-bold text-gray-900 dark:text-white">
                {m.title}
              </p>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              {m.detail}
            </p>
          </div>
        ))}
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div className="md:col-span-1 glass-card flex flex-col rounded-3xl overflow-hidden mt-2">
        <div className="p-6 border-b border-[#E5E5E5] dark:border-gray-800">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#1A1A1A] dark:text-white mb-1">
                <T>Your Impact</T>
              </h2>
              <p className="text-sm text-[#717171] dark:text-gray-400">
                {currentProfile?.displayName}
              </p>
            </div>
            <div className="text-2xl sm:text-3xl font-light text-primary shrink-0">
              {liveImpactPoints}{" "}
              <span className="text-sm font-bold text-semantic-success">
                <T>pts</T>
              </span>
            </div>
          </div>
          {progress && (
            <div className="flex items-center gap-4 mt-6">
              <div className="relative w-16 h-16 shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-gray-200 dark:text-gray-700"
                    strokeWidth="3"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="text-primary transition-all duration-1000 ease-out"
                    strokeDasharray={`${progress.percentage}, 100`}
                    strokeWidth="3"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-900 dark:text-white">
                  {progress.percentage}%
                </div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-gray-900 dark:text-white mb-0.5">
                  {liveCivicRank}
                </div>
                <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                  Next: {progress.nextTitle} ({progress.remaining} pts)
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 p-6 bg-gray-50/50 dark:bg-gray-800/30 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="text-2xl text-[#1A1A1A] dark:text-white font-light mb-1">
                {liveReportsCount}
              </span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#717171] dark:text-gray-400">
                <T>Reports</T>
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="text-2xl text-[#1A1A1A] dark:text-white font-light mb-1">
                {liveResolvedCount}
              </span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#717171] dark:text-gray-400">
                <T>Resolved</T>
              </span>
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <T>Badges</T>
              <span className="normal-case tracking-normal text-gray-400">
                {BADGES.filter((b) => b.earned(badgeStats)).length}/
                {BADGES.length}
              </span>
            </h4>
            <div className="grid grid-cols-4 gap-x-2 gap-y-3">
              {BADGES.map((b) => {
                const earned = b.earned(badgeStats);
                return (
                  <div
                    key={b.id}
                    className="relative group flex flex-col items-center gap-1.5"
                  >
                    <BadgeMedal badge={b} earned={earned} size={44} />
                    <span
                      className="text-[8px] font-bold text-center leading-tight text-gray-600 dark:text-gray-400 w-full line-clamp-2"
                      title={b.name}
                    >
                      {b.name}
                    </span>
                    <div className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-40 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <div className="bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-snug rounded-lg px-2.5 py-1.5 shadow-xl text-center">
                        <span className="font-bold block mb-0.5">
                          {b.name}
                          {earned ? " · Earned ✓" : ""}
                        </span>
                        {b.requirement}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider space-y-2 font-bold p-2 mb-4">
            <p>+10 pts per Report</p>
            <p>+50 pts when Resolved</p>
          </div>

          <button
            onClick={generateStory}
            disabled={isGeneratingStory}
            className="w-full py-3 bg-gradient-to-r from-primary to-primary-dark text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGeneratingStory ? (
              <span className="flex items-center gap-2">
                <img src="/civic-logo.svg" className="w-4 h-4 animate-pulse brightness-0 invert" alt="Loading" />
                <T>Generating...</T>
              </span>
            ) : (
              "Generate My Impact Story"
            )}
          </button>

          {impactStory && (
            <div className="mt-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800/50 rounded-2xl relative overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-20">
                <span className="text-4xl">🏆</span>
              </div>
              <h4 className="text-sm font-bold text-amber-800 dark:text-amber-400 mb-2 relative z-10">
                {impactStory.title}
              </h4>
              <p className="text-xs text-amber-900/80 dark:text-amber-200/80 leading-relaxed relative z-10">
                "{impactStory.story}"
              </p>
              <button className="mt-3 text-[10px] uppercase tracking-widest font-bold text-amber-700 dark:text-amber-500 hover:text-amber-900 dark:hover:text-amber-400 transition-colors flex items-center gap-1">
                <T>Share</T> <span className="text-sm">→</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="md:col-span-2 glass-card rounded-3xl p-6 mt-2">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-bold text-[#717171] dark:text-gray-400 uppercase tracking-widest">
            <T>Community Leaderboard</T>
          </h3>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700">
              <T>Global</T>
            </span>
            {currentProfile?.ward && (
              <span className="px-3 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                {currentProfile.ward}
              </span>
            )}
          </div>
        </div>

        {leaderboard.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
            <T>No reports yet — be the first to put your ward on the board.</T>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#4A4A4A] dark:text-gray-300">
              <thead>
                <tr className="border-b border-[#E5E5E5] dark:border-gray-800 text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                  <th className="pb-3 px-2 font-medium"><T>Rank</T></th>
                  <th className="pb-3 px-2 font-medium"><T>Citizen</T></th>
                  <th className="pb-3 px-2 font-medium"><T>Ward</T></th>
                  <th className="pb-3 px-2 font-medium text-center"><T>Reports</T></th>
                  <th className="pb-3 px-2 font-medium text-right"><T>Points</T></th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((u, i) => (
                  <tr
                    key={u.uid}
                    className={`border-b border-[#E5E5E5] dark:border-gray-800 last:border-0 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${u.uid === currentUser?.uid ? "bg-primary/5 dark:bg-primary/10" : ""}`}
                  >
                    <td className="py-4 px-2 text-gray-400 font-mono">
                      {i + 1}
                    </td>
                    <td className="py-4 px-2 font-medium text-[#1A1A1A] dark:text-white flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0">
                        <img
                          src={`https://api.dicebear.com/7.x/bottts/svg?seed=${u.uid}`}
                          alt=""
                          className="w-full h-full"
                        />
                      </div>
                      {u.displayName}
                    </td>
                    <td className="py-4 px-2 text-gray-500 dark:text-gray-400 text-xs">
                      {u.ward || "Unknown"}
                    </td>
                    <td className="py-4 px-2 text-center text-[#717171] dark:text-gray-400">
                      {u.reportsCount || 0}
                    </td>
                    <td className="py-4 px-2 text-right font-bold text-primary">
                      {u.impactPoints}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
   </div>
  );
}
