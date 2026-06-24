/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { CitizenProfile, LeaderboardEntry } from '../types';

interface ImpactProps {
  currentUser: any;
  currentProfile: CitizenProfile | null;
}

export default function ImpactDashboard({ currentUser, currentProfile }: ImpactProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const q = query(collection(db, 'citizens'), orderBy('impactPoints', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: LeaderboardEntry[] = [];
      snapshot.forEach((docSnap) => records.push({ uid: docSnap.id, ...(docSnap.data() as Omit<LeaderboardEntry, 'uid'>) }));
      setLeaderboard(records);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const getProgressToNextRank = (points: number) => {
    let currentLimit = 0, nextLimit = 50, nextTitle = 'Level 2 Guardian';
    if (points >= 500) return { percentage: 100, remaining: 0, nextTitle: 'Max Level' };
    else if (points >= 300) { currentLimit = 300; nextLimit = 500; nextTitle = 'Level 5'; }
    else if (points >= 150) { currentLimit = 150; nextLimit = 300; nextTitle = 'Level 4'; }
    else if (points >= 50) { currentLimit = 50; nextLimit = 150; nextTitle = 'Level 3'; }
    const percent = Math.min(100, Math.max(0, ((points - currentLimit) / (nextLimit - currentLimit)) * 100));
    return { percentage: Math.round(percent), remaining: nextLimit - points, nextTitle };
  };

  const progress = currentProfile ? getProgressToNextRank(currentProfile.impactPoints) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div className="md:col-span-1 border border-[#E5E5E5] bg-white flex flex-col shadow-[-10px_0_15px_rgba(0,0,0,0.02)] rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-[#E5E5E5]">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A]">Your Impact</h2>
              <p className="text-sm text-[#717171]">{currentProfile?.displayName}</p>
            </div>
            <div className="text-3xl font-light text-[#1A1A1A]">
              {currentProfile?.impactPoints || 0} <span className="text-sm font-bold text-[#10B981]">pts</span>
            </div>
          </div>
          {progress && (
            <div className="space-y-2">
              <div className="h-2 w-full bg-[#F5F5F5] rounded-full overflow-hidden">
                <div className="h-full bg-[#1A1A1A] rounded-full" style={{ width: `${progress.percentage}%` }}></div>
              </div>
              <div className="flex justify-between text-[10px] font-bold text-[#A1A1A1] uppercase tracking-widest">
                <span>{currentProfile?.civicRank}</span>
                <span>Next: {progress.nextTitle}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex-1 p-6 bg-[#F9FAFB] space-y-4">
          <div className="p-4 rounded-xl bg-white border border-[#E5E5E5] flex justify-between items-center text-sm font-bold shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <span className="text-[#717171]">Reports Logged</span>
            <span className="text-xl text-[#1A1A1A] font-light">{currentProfile?.reportsCount || 0}</span>
          </div>
          
          <div className="text-[10px] text-[#A1A1A1] uppercase tracking-wider space-y-2 font-bold p-2">
            <p>+10 pts per Report</p>
            <p>+50 pts when Resolved</p>
          </div>
        </div>
      </div>

      <div className="md:col-span-2 bg-white rounded-3xl border border-[#E5E5E5] p-6 shadow-[-10px_0_15px_rgba(0,0,0,0.02)]">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-bold text-[#717171] uppercase tracking-widest">Community Leaderboard</h3>
        </div>

        {loading ? (
          <div className="space-y-4"><div className="h-10 bg-[#F5F5F5] rounded animate-pulse" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#4A4A4A]">
              <thead>
                <tr className="border-b border-[#E5E5E5] text-[10px] text-[#9CA3AF] uppercase font-bold tracking-wider">
                  <th className="pb-3 px-2 font-medium">Rank</th>
                  <th className="pb-3 px-2 font-medium">Citizen</th>
                  <th className="pb-3 px-2 font-medium text-center">Reports</th>
                  <th className="pb-3 px-2 font-medium text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((u, i) => (
                  <tr key={u.uid} className={`border-b border-[#E5E5E5] last:border-0 ${u.uid === currentUser?.uid ? 'bg-[#F9FAFB]' : ''}`}>
                    <td className="py-3 px-2 text-[#9CA3AF] font-mono">{i + 1}</td>
                    <td className="py-3 px-2 font-medium text-[#1A1A1A]">{u.displayName}</td>
                    <td className="py-3 px-2 text-center text-[#717171]">{u.reportsCount || 0}</td>
                    <td className="py-3 px-2 text-right font-bold text-[#1A1A1A]">{u.impactPoints}</td>
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
