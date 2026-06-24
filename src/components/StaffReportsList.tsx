/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { collection, doc, deleteDoc, writeBatch, getDocs, updateDoc } from 'firebase/firestore';
import { CivicIssue, CivicStatus, CivicCategory } from '../types';
import { 
  Trash2, 
  MapPin, 
  Filter, 
  Search, 
  RefreshCw, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  FileText
} from 'lucide-react';

interface StaffReportsListProps {
  issues: CivicIssue[];
  currentUser: any;
  onSelectIssue?: (issue: CivicIssue) => void;
  onSetTab?: (tab: 'map' | 'reporter') => void;
}

export default function StaffReportsList({ issues, currentUser, onSelectIssue, onSetTab }: StaffReportsListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [cityFilter, setCityFilter] = useState<string>('All');
  const [severityFilter, setSeverityFilter] = useState<string>('All');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Helper to determine the approximate city based on latitude and longitude
  const getCityName = (lat: number, lng: number) => {
    // Bangalore is around 12.9716, 77.5946
    const bangaloreLat = 12.9716;
    const bangaloreLng = 77.5946;
    const distanceToBlr = Math.sqrt(Math.pow(lat - bangaloreLat, 2) + Math.pow(lng - bangaloreLng, 2));
    
    if (distanceToBlr < 0.8) {
      return 'Bangalore';
    }
    return 'Other';
  };

  // Filter issues based on criteria
  const filteredIssues = issues.filter(issue => {
    const cityName = getCityName(issue.latitude, issue.longitude);
    
    // Search filter (description, category, recommended department, reporter's name)
    const matchesSearch = 
      (issue.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.recommendedDepartment || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.reportedByName || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'All' || issue.status === statusFilter;
    const matchesCategory = categoryFilter === 'All' || issue.category === categoryFilter;
    const matchesCity = cityFilter === 'All' || cityName === cityFilter;
    
    let matchesSeverity = true;
    if (severityFilter === 'High') {
      matchesSeverity = issue.severityScore >= 8;
    } else if (severityFilter === 'Medium') {
      matchesSeverity = issue.severityScore >= 5 && issue.severityScore < 8;
    } else if (severityFilter === 'Low') {
      matchesSeverity = issue.severityScore < 5;
    }

    return matchesSearch && matchesStatus && matchesCategory && matchesCity && matchesSeverity;
  });

  // Function to change status of a report
  const handleUpdateStatus = async (issueId: string, newStatus: CivicStatus) => {
    try {
      const issueRef = doc(db, 'issues', issueId);
      await updateDoc(issueRef, { status: newStatus });
      setActionMessage(`Status streamlined/updated to "${newStatus}"`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to update status:', err);
    }
  };

  // Function to delete a single report via safe modal callback
  const handleConfirmDeleteReport = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteDoc(doc(db, 'issues', deleteTargetId));
      setActionMessage('Report successfully deleted from the ledger.');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to delete report:', err);
    } finally {
      setDeleteTargetId(null);
    }
  };

  // Function to purge ALL reports for reset db via safe modal callback
  const handleConfirmPurgeAllReports = async () => {
    setIsPurging(true);
    setShowPurgeModal(false);
    try {
      const querySnapshot = await getDocs(collection(db, 'issues'));
      const batch = writeBatch(db);
      
      querySnapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      
      await batch.commit();
      setActionMessage('All reports have been purged and database has been successfully reset!');
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err: any) {
      console.error('Failed to purge reports:', err);
      setActionMessage('Error resetting database: ' + (err.message || err));
    } finally {
      setIsPurging(false);
    }
  };

  const getSeverityBadgeClass = (score: number) => {
    if (score >= 8) return 'bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]';
    if (score >= 5) return 'bg-[#FEF3C7] text-[#D97706] border-[#FCD34D]';
    return 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]';
  };

  return (
    <div className="bg-white rounded-3xl border border-[#E5E5E5] overflow-hidden shadow-[-10px_0_15px_rgba(0,0,0,0.02)] max-w-7xl mx-auto p-6 space-y-6 relative">
      
      {/* Header section with Reset/Purge */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-[#F0F0F0]">
        <div>
          <h2 className="text-2xl font-light text-[#1A1A1A] tracking-tight flex items-center gap-2">
            <FileText className="w-6 h-6 text-[#1A1A1A]" />
            Staff Control Dashboard
          </h2>
          <p className="text-xs text-[#717171] mt-1">
            Review, verify, and resolve issues reported across municipal bounds.
          </p>
        </div>
        
        <button
          onClick={() => setShowPurgeModal(true)}
          disabled={isPurging}
          className="bg-[#EF4444] hover:bg-[#DC2626] disabled:bg-gray-400 text-white font-bold text-xs py-2.5 px-5 rounded-full tracking-wider uppercase transition-all duration-200 cursor-pointer flex items-center gap-2 shadow-sm"
        >
          <Trash2 className="w-4 h-4" />
          {isPurging ? 'Purging Archive...' : 'Reset Database (Purge Reports)'}
        </button>
      </div>

      {actionMessage && (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 transition-all">
          <CheckCircle className="w-4 h-4" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Filter and search bar */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-[#F9FAFB] p-4 rounded-2xl border border-[#E5E7EB]">
        
        {/* Search Input */}
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Search details, reporter..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2.5 bg-white border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
          />
        </div>

        {/* Category Filter */}
        <div>
          <label className="block text-[9px] font-bold text-[#717171] uppercase tracking-wider mb-1">Category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full text-xs px-3 py-2 bg-white border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A] font-medium"
          >
            <option value="All">All Categories</option>
            <option value="Pothole">Pothole</option>
            <option value="Water Leak">Water Leak</option>
            <option value="Vandalism">Vandalism</option>
            <option value="Streetlight Out">Streetlight Out</option>
            <option value="Waste Issue">Waste Issue</option>
            <option value="Other">Other Category</option>
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-[9px] font-bold text-[#717171] uppercase tracking-wider mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full text-xs px-3 py-2 bg-white border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A] font-medium"
          >
            <option value="All">All Statuses</option>
            <option value="Reported">Reported</option>
            <option value="Auto-Routed">Auto-Routed</option>
            <option value="Requires Human Verification">Verify Report</option>
            <option value="Corroborated Report">Corroborated</option>
            <option value="In Progress">In Progress</option>
            <option value="Resolved">Resolved</option>
          </select>
        </div>

        {/* City Filter */}
        <div>
          <label className="block text-[9px] font-bold text-[#717171] uppercase tracking-wider mb-1">Region</label>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="w-full text-xs px-3 py-2 bg-white border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A] font-medium"
          >
            <option value="All">All Regions</option>
            <option value="Bangalore">Bangalore</option>
            <option value="Other">Other Region</option>
          </select>
        </div>

        {/* Severity Filter */}
        <div>
          <label className="block text-[9px] font-bold text-[#717171] uppercase tracking-wider mb-1">Severity</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="w-full text-xs px-3 py-2 bg-white border border-[#E5E5E5] rounded-xl focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A] font-medium"
          >
            <option value="All">All Severities</option>
            <option value="High">High Severity (8-10)</option>
            <option value="Medium">Medium Severity (5-7)</option>
            <option value="Low">Low Severity (1-4)</option>
          </select>
        </div>

      </div>

      {/* Tabular Reports List */}
      <div className="overflow-x-auto border border-[#E5E5E5] rounded-2xl bg-white shadow-sm">
        {filteredIssues.length === 0 ? (
          <div className="p-12 text-center text-[#717171] flex flex-col items-center justify-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-[#9CA3AF] stroke-1" />
            <p className="text-sm">No reports matching your active filters were found.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-[#E5E5E5] text-left">
            <thead className="bg-[#F9FAFB]">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider">Report</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider">Category</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider">Location</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider">Reporter</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider">Upvotes</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0F0] text-xs">
              {filteredIssues.map((issue) => {
                const issueCityName = getCityName(issue.latitude, issue.longitude);
                
                return (
                  <tr key={issue.id} className="hover:bg-gray-50/50 transition-colors">
                    
                    {/* Thumbnail & description */}
                    <td className="px-6 py-4 max-w-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0 border border-[#E5E5E5]">
                          {issue.imageUrl ? (
                            <img src={issue.imageUrl} alt="issue" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-50">No img</div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-[#1A1A1A] line-clamp-1">{issue.description || 'No description provided'}</p>
                          <p className="text-[10px] text-[#717171] mt-0.5">Dep: <span className="font-semibold">{issue.recommendedDepartment || 'General'}</span></p>
                        </div>
                      </div>
                    </td>

                    {/* Category & Severity */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-[#1A1A1A]">{issue.category}</span>
                        <span className={`inline-block px-1.5 py-0.5 text-[9px] rounded-full font-bold border text-center w-fit ${getSeverityBadgeClass(issue.severityScore)}`}>
                          Severity {issue.severityScore}/10
                        </span>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-[#1a1a1a] flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-[#3B82F6]" />
                          {issueCityName}
                        </span>
                        <span className="text-[10px] text-[#717171] font-mono">
                          {issue.latitude.toFixed(4)}, {issue.longitude.toFixed(4)}
                        </span>
                        {onSelectIssue && onSetTab && (
                          <button
                            onClick={() => {
                              onSelectIssue(issue);
                              onSetTab('map');
                            }}
                            className="text-left text-blue-600 hover:underline text-[10px] font-semibold mt-0.5 cursor-pointer"
                          >
                            Locate on Map
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Reporter Name & Date */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium text-[#1A1A1A]">{issue.reportedByName || 'Citizen'}</span>
                        <span className="text-[10px] text-[#717171]">
                          {new Date(issue.reportedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>

                    {/* Status Select dropdown */}
                    <td className="px-6 py-4 id-status-select whitespace-nowrap">
                      <select
                        value={issue.status}
                        onChange={(e) => handleUpdateStatus(issue.id, e.target.value as CivicStatus)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E5E5E5] bg-[#F9FAFB] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                      >
                        <option value="Reported">Reported</option>
                        <option value="Auto-Routed">Auto-Routed</option>
                        <option value="Requires Human Verification">Verify Report</option>
                        <option value="Corroborated Report">Corroborated</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                    </td>

                    {/* Upvote count */}
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#EFF6FF] border border-[#BFDBFE] text-blue-700 font-bold">
                        <span>{issue.upvotesCount || 0}</span>
                      </div>
                    </td>

                    {/* Deletion / Action button */}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => setDeleteTargetId(issue.id)}
                        className="p-2 text-[#EF4444] hover:bg-[#FEE2E2] rounded-xl transition-all cursor-pointer"
                        title="Delete Report"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTargetId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-[#E5E5E5] max-w-sm w-full p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Delete Civic Report?</h3>
              <p className="text-xs text-[#717171] leading-relaxed">
                Are you sure you want to delete this report from the list? This action is permanent and cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="flex-1 py-2.5 rounded-full border border-[#E5E5E5] text-xs font-bold hover:bg-[#F9FAFB] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteReport}
                className="flex-1 py-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purge All Database Confirmation Modal */}
      {showPurgeModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-[#E5E5E5] max-w-md w-full p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Purge All Civic Reports?</h3>
              <p className="text-xs text-red-600 font-semibold bg-red-50 p-2.5 rounded-xl border border-red-100">
                CRITICAL WARNING: This action permanently purges ALL municipal issue coordinates from the Firestore database active ledger.
              </p>
              <p className="text-xs text-[#717171] leading-relaxed">
                This utility resets active developer accounts, clears historical analytics logs, and clears markers of duplication.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowPurgeModal(false)}
                className="flex-1 py-3 rounded-full border border-[#E5E5E5] text-xs font-bold hover:bg-[#F9FAFB] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPurgeAllReports}
                className="flex-1 py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Reset Ledger
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
