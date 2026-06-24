/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navigation, MapPin, ThumbsUp, CheckCircle } from 'lucide-react';
import { db, rewardImpactPoints } from '../lib/firebase';
import { doc, updateDoc, increment } from 'firebase/firestore';
import { CivicIssue } from '../types';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';

interface CommandMapProps {
  issues: CivicIssue[];
  onSelectIssue?: (issue: CivicIssue) => void;
  currentUser: any;
  selectedIssueFromParent?: CivicIssue | null;
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

export default function CommandMap({ issues, onSelectIssue, currentUser, selectedIssueFromParent }: CommandMapProps) {
  const [selectedIssue, setSelectedIssue] = useState<CivicIssue | null>(null);
  const [hoveredIssue, setHoveredIssue] = useState<CivicIssue | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('All');

  const viewCenter = { lat: 12.9716, lng: 77.5946 };
  const [center, setCenter] = useState<{ lat: number; lng: number }>(viewCenter);

  // Sync with parent selected issue (e.g. from staff list "Locate on Map" action)
  useEffect(() => {
    if (selectedIssueFromParent) {
      setSelectedIssue(selectedIssueFromParent);
      setCenter({ lat: selectedIssueFromParent.latitude, lng: selectedIssueFromParent.longitude });
    }
  }, [selectedIssueFromParent]);

  // Direct map click/drag support
  const handleMarkerClick = (issue: CivicIssue) => {
    setSelectedIssue(issue);
    setCenter({ lat: issue.latitude, lng: issue.longitude });
    if (onSelectIssue) {
      onSelectIssue(issue);
    }
  };

  const upvoteIssue = async (issueId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!currentUser) return;
      const issue = issues.find(i => i.id === issueId);
      if (!issue) return;

      const upvotedByList = issue.upvotedBy || [];
      const hasUpvoted = upvotedByList.includes(currentUser.uid);

      const issueRef = doc(db, 'issues', issueId);
      if (hasUpvoted) {
        const nextList = upvotedByList.filter(id => id !== currentUser.uid);
        await updateDoc(issueRef, { upvotesCount: increment(-1), upvotedBy: nextList });
        if (selectedIssue && selectedIssue.id === issueId) {
          setSelectedIssue({ ...selectedIssue, upvotesCount: Math.max(0, (selectedIssue.upvotesCount || 0) - 1), upvotedBy: nextList });
        }
      } else {
        const nextList = [...upvotedByList, currentUser.uid];
        await updateDoc(issueRef, { upvotesCount: increment(1), upvotedBy: nextList });
        if (selectedIssue && selectedIssue.id === issueId) {
          setSelectedIssue({ ...selectedIssue, upvotesCount: (selectedIssue.upvotesCount || 0) + 1, upvotedBy: nextList });
        }
      }
    } catch (err) { }
  };

  const resolveIssueSimulated = async (issue: CivicIssue, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const issueRef = doc(db, 'issues', issue.id);
      await updateDoc(issueRef, { status: 'Resolved' });
      await rewardImpactPoints(issue.reportedByUid, 50);
      const resolvedObj = { ...issue, status: 'Resolved' as const };
      setSelectedIssue(resolvedObj);
      if (onSelectIssue) onSelectIssue(resolvedObj);
    } catch (err) { }
  };

  const filteredIssues = filterCategory === 'All' 
    ? issues 
    : issues.filter((i) => i.category === filterCategory);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 border border-[#E5E5E5] rounded-3xl bg-white overflow-hidden shadow-[-10px_0_15px_rgba(0,0,0,0.02)]">
      <div className="lg:col-span-2 bg-[#DEE1E6] relative min-h-[480px] flex flex-col justify-between border-r border-[#E5E5E5] overflow-hidden">
        
        <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-2">
          <div className="bg-white/90 backdrop-blur-sm p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#E5E5E5]">
            <h3 className="text-xs font-bold text-[#717171] uppercase mb-3 tracking-widest flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-ping"></div>
              Active Filters
            </h3>
            <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider max-w-sm md:max-w-md">
              <button onClick={() => setFilterCategory('All')} className={`px-4 py-1.5 rounded-full border transition-colors ${filterCategory === 'All' ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-[#F9FAFB] text-[#717171] border-[#E5E5E5]'}`}>All</button>
              {['Pothole', 'Water Leak', 'Vandalism', 'Streetlight Out', 'Waste Issue', 'Other'].map(cat => (
                <button key={cat} onClick={() => setFilterCategory(cat)} className={`px-4 py-1.5 rounded-full border transition-colors ${filterCategory === cat ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-[#F9FAFB] text-[#717171] border-[#E5E5E5]'}`}>{cat}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="absolute inset-0">
          {!hasValidKey ? (
            <div className="flex items-center justify-center h-full bg-[#F3F4F6] text-center p-6 font-sans">
              <div className="max-w-md bg-white p-8 rounded-2xl shadow-sm border border-[#E5E5E5]">
                <h2 className="text-xl font-semibold mb-4 text-[#1A1A1A]">Google Maps API Key Required</h2>
                <p className="text-sm text-[#717171] mb-2 font-medium text-left"><strong>Step 1:</strong> <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noopener" className="text-blue-600 underline">Get an API Key</a></p>
                <p className="text-sm text-[#717171] mb-2 font-medium text-left"><strong>Step 2:</strong> Add your key as a secret:</p>
                <ul className="text-left text-sm text-[#717171] leading-relaxed list-disc list-inside mb-4">
                  <li>Open <strong>Settings</strong> (⚙️ gear icon, top-right)</li>
                  <li>Select <strong>Secrets</strong></li>
                  <li>Type <code>GOOGLE_MAPS_PLATFORM_KEY</code>, press <strong>Enter</strong></li>
                  <li>Paste your API key, press <strong>Enter</strong></li>
                </ul>
                <p className="text-xs text-[#9CA3AF] italic">The app rebuilds automatically.</p>
              </div>
            </div>
          ) : (
            <APIProvider apiKey={API_KEY} version="weekly">
              <Map
                center={center}
                onCenterChanged={(e) => {
                  if (e.detail?.center) {
                    setCenter(e.detail.center);
                  }
                }}
                defaultZoom={12}
                mapId="DEMO_MAP_ID"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                style={{width: '100%', height: '100%'}}
              >
                {filteredIssues.map((issue) => {
                  const isSelected = selectedIssue?.id === issue.id;
                  let bgBg = '#1A1A1A';
                  if (issue.severityScore >= 8) bgBg = '#EF4444';
                  else if (issue.severityScore >= 5) bgBg = '#F59E0B';

                  return (
                    <AdvancedMarker 
                      key={issue.id} 
                      position={{ lat: issue.latitude, lng: issue.longitude }}
                      title={issue.category}
                      onClick={() => handleMarkerClick(issue)}
                      zIndex={isSelected ? 40 : 20}
                    >
                      <Pin background={bgBg} glyphColor="#fff" borderColor="#fff" scale={isSelected ? 1.4 : 1} />
                    </AdvancedMarker>
                  );
                })}
              </Map>
            </APIProvider>
          )}
        </div>
      </div>

      <div className="bg-white p-6 flex flex-col justify-between min-h-[480px] relative z-10">
        {selectedIssue ? (
          <div className="space-y-5 h-full flex flex-col justify-between">
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-[#F5F5F5] border border-[#E5E5E5] max-h-48 flex items-center justify-center">
                <img 
                  src={selectedIssue.imageUrl || "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=400&auto=format&fit=crop"} 
                  alt={selectedIssue.category} 
                  className="max-h-48 w-full object-cover rounded-xl" 
                />
                <div className="absolute top-3 left-3 bg-white px-3 py-1.5 rounded-full text-[10px] font-bold uppercase border border-[#E5E5E5] text-[#1A1A1A] flex items-center gap-1.5 shadow-sm">
                  <span className={`w-1.5 h-1.5 rounded-full ${selectedIssue.severityScore >= 8 ? 'bg-[#EF4444]' : 'bg-[#F59E0B]'}`}></span>
                  Severity {selectedIssue.severityScore}
                </div>
                <div className="absolute bottom-3 right-3 bg-[#10B981] font-bold text-white px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wide shadow-sm">
                  {selectedIssue.status}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-[#1A1A1A] text-lg">{selectedIssue.category}</h3>
                  <div className="flex items-center gap-1 text-[#717171] text-xs">
                    <Navigation className="w-3.5 h-3.5" />
                    <span className="font-mono text-[10px]">{Number(selectedIssue.latitude).toFixed(4)}, {Number(selectedIssue.longitude).toFixed(4)}</span>
                  </div>
                </div>
                <p className="text-[10px] text-[#9CA3AF] mt-1 font-bold uppercase tracking-wider">
                  Reported by <span className="text-[#1A1A1A]">{selectedIssue.reportedByName}</span>
                </p>
              </div>

              <div className="bg-[#F9FAFB] rounded-xl p-4 text-xs text-[#4B5563] italic font-serif border border-[#E5E7EB] leading-relaxed">
                "{selectedIssue.description || 'No summary provided.'}"
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#E5E7EB]">
                <div className="text-center p-2">
                  <div className="text-[10px] text-[#9CA3AF] uppercase font-bold mb-1 tracking-widest">Department</div>
                  <div className="text-sm font-semibold text-[#1A1A1A] truncate">{selectedIssue.recommendedDepartment || 'N/A'}</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-[10px] text-[#9CA3AF] uppercase font-bold mb-1 tracking-widest">Radius Check</div>
                  <div className="text-sm font-semibold text-[#3B82F6]">{selectedIssue.isCorroborated ? 'Corroborated' : 'Unique'}</div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={(e) => upvoteIssue(selectedIssue.id, e)}
                className={`flex-1 py-3.5 rounded-full font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 transition-colors cursor-pointer ${currentUser && (selectedIssue.upvotedBy || []).includes(currentUser.uid) ? 'bg-[#3B82F6] text-white hover:bg-[#2563EB]' : 'bg-[#F5F5F5] text-[#1A1A1A] hover:bg-[#E5E5E5]'}`}
              >
                <ThumbsUp className="w-4 h-4" /> {currentUser && (selectedIssue.upvotedBy || []).includes(currentUser.uid) ? 'Upvoted' : 'Upvote'} ({selectedIssue.upvotesCount || 0})
              </button>
              {selectedIssue.status !== 'Resolved' && currentUser?.role === 'staff' && (
                <button 
                  onClick={(e) => resolveIssueSimulated(selectedIssue, e)}
                  className="flex-1 bg-[#1A1A1A] hover:bg-[#333333] text-white py-3.5 rounded-full font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 transition-colors cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" /> Resolve
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 space-y-4">
            <div className="w-14 h-14 bg-[#F5F5F5] rounded-full flex items-center justify-center text-[#9CA3AF]">
              <MapPin className="w-7 h-7 stroke-1" />
            </div>
            <div>
              <h4 className="font-semibold text-[#1A1A1A] text-sm">Select a Live Pin</h4>
              <p className="text-xs text-[#717171] max-w-xs mt-1 leading-relaxed">
                Click on any coordinate node from the Command Center to inspect details and resolve issues.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
