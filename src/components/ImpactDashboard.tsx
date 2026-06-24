/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { CitizenProfile, LeaderboardEntry } from "../types";

interface ImpactProps {
  currentUser: any;
  currentProfile: CitizenProfile | null;
}

export default function ImpactDashboard({
  currentUser,
  currentProfile,
}: ImpactProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [impactStory, setImpactStory] = useState<{
    title: string;
    story: string;
  } | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "citizens"),
      orderBy("impactPoints", "desc"),
      limit(10),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: LeaderboardEntry[] = [];
      snapshot.forEach((docSnap) =>
        records.push({
          uid: docSnap.id,
          ...(docSnap.data() as Omit<LeaderboardEntry, "uid">),
        }),
      );
      setLeaderboard(records);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
            reports: currentProfile.reportsCount || 0,
            resolved: 0, // In a real app we'd fetch this from their issues
            points: currentProfile.impactPoints || 0,
          },
          language: "English",
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
    ? getProgressToNextRank(currentProfile.impactPoints)
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div className="md:col-span-1 glass-card flex flex-col rounded-3xl overflow-hidden mt-2">
        <div className="p-6 border-b border-[#E5E5E5] dark:border-gray-800">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[#1A1A1A] dark:text-white">
                Your Impact
              </h2>
              <p className="text-sm text-[#717171] dark:text-gray-400">
                {currentProfile?.displayName}
              </p>
            </div>
            <div className="text-3xl font-light text-primary">
              {currentProfile?.impactPoints || 0}{" "}
              <span className="text-sm font-bold text-semantic-success">
                pts
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
                  {currentProfile?.civicRank}
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
                {currentProfile?.reportsCount || 0}
              </span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#717171] dark:text-gray-400">
                Reports
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="text-2xl text-[#1A1A1A] dark:text-white font-light mb-1">
                {(currentProfile?.impactPoints || 0) > 0 ? Math.floor((currentProfile?.impactPoints || 0) / 10) : 0}
              </span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#717171] dark:text-gray-400">
                Resolved
              </span>
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
              Achievements
            </h4>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col items-center gap-2">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 transition-all ${currentProfile?.reportsCount && currentProfile.reportsCount > 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800 shadow-sm scale-100" : "bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700 opacity-50 grayscale scale-95"}`} title="First Report">
                  🌱
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 text-center w-16 leading-tight">First Report</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 transition-all ${currentProfile?.reportsCount && currentProfile.reportsCount >= 5 ? "bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 shadow-sm scale-100" : "bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700 opacity-50 grayscale scale-95"}`} title="Streak Keeper">
                  🔥
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 text-center w-16 leading-tight">Streak Keeper</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 transition-all ${currentProfile?.impactPoints && currentProfile.impactPoints >= 100 ? "bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 shadow-sm scale-100" : "bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700 opacity-50 grayscale scale-95"}`} title="Pothole Hunter">
                  🕵️
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 text-center w-16 leading-tight">Pothole Hunter</span>
              </div>
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
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Generating...
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
                Share <span className="text-sm">→</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="md:col-span-2 glass-card rounded-3xl p-6 mt-2">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-bold text-[#717171] dark:text-gray-400 uppercase tracking-widest">
            Community Leaderboard
          </h3>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700">
              Global
            </span>
            {currentProfile?.ward && (
              <span className="px-3 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                {currentProfile.ward}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse" />
            <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse delay-75" />
            <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse delay-150" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#4A4A4A] dark:text-gray-300">
              <thead>
                <tr className="border-b border-[#E5E5E5] dark:border-gray-800 text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                  <th className="pb-3 px-2 font-medium">Rank</th>
                  <th className="pb-3 px-2 font-medium">Citizen</th>
                  <th className="pb-3 px-2 font-medium">Ward</th>
                  <th className="pb-3 px-2 font-medium text-center">Reports</th>
                  <th className="pb-3 px-2 font-medium text-right">Points</th>
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
  );
}
