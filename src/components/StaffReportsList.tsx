/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  deleteDoc,
  writeBatch,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { CivicIssue, CivicStatus, CivicCategory } from "../types";
import {
  Trash2,
  MapPin,
  Filter,
  Search,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  X,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface StaffReportsListProps {
  issues: CivicIssue[];
  currentUser: any;
  onSelectIssue?: (issue: CivicIssue) => void;
  onSetTab?: (tab: "map" | "reporter") => void;
}

export default function StaffReportsList({
  issues,
  currentUser,
  onSelectIssue,
  onSetTab,
}: StaffReportsListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [cityFilter, setCityFilter] = useState<string>("All");
  const [severityFilter, setSeverityFilter] = useState<string>("All");
  const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedImageForModal, setSelectedImageForModal] = useState<
    string | null
  >(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());

  const activeFilterCount =
    (statusFilter !== "All" ? 1 : 0) +
    (categoryFilter !== "All" ? 1 : 0) +
    (cityFilter !== "All" ? 1 : 0) +
    (severityFilter !== "All" ? 1 : 0);

  const clearAllFilters = () => {
    setStatusFilter("All");
    setCategoryFilter("All");
    setCityFilter("All");
    setSeverityFilter("All");
    setSearchTerm("");
  };

  const handleSelectIssue = (id: string) => {
    const newSet = new Set(selectedIssues);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIssues(newSet);
  };

  const handleSelectAll = () => {
    if (selectedIssues.size === filteredIssues.length) {
      setSelectedIssues(new Set());
    } else {
      setSelectedIssues(new Set(filteredIssues.map((i) => i.id)));
    }
  };

  const exportCSV = () => {
    const headers = [
      "ID",
      "Category",
      "Status",
      "Severity",
      "Priority",
      "Department",
      "Reported By",
      "Date",
    ];
    const csvContent = [
      headers.join(","),
      ...filteredIssues.map((i) =>
        [
          i.id,
          `"${i.category}"`,
          `"${i.status}"`,
          i.severityScore,
          i.priorityTier || "",
          `"${i.recommendedDepartment}"`,
          `"${i.reportedByName}"`,
          new Date(i.reportedAt).toISOString(),
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `civic_reports_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkUpdate = async (status: CivicStatus) => {
    if (selectedIssues.size === 0) return;
    try {
      const batch = writeBatch(db);
      
      const affectedUids = new Set<string>();
      
      selectedIssues.forEach((id) => {
        const issueRef = doc(db, "issues", id);
        batch.update(issueRef, { status });
        const issue = issues.find(i => i.id === id);
        if (issue) affectedUids.add(issue.reportedByUid);
      });
      
      affectedUids.forEach((uid) => {
        const userIssues = issues.filter(i => i.reportedByUid === uid);
        const newImpactPoints = 20 + userIssues.reduce((sum, i) => {
          const effectiveStatus = selectedIssues.has(i.id) ? status : i.status;
          return sum + 10 + (effectiveStatus === "Resolved" ? 50 : 0);
        }, 0);
        batch.update(doc(db, "citizens", uid), { impactPoints: newImpactPoints });
      });

      await batch.commit();
      setActionMessage(
        `Bulk updated ${selectedIssues.size} issues to "${status}"`,
      );
      setSelectedIssues(new Set());
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      console.error("Bulk update failed", err);
      setActionMessage("Bulk update failed");
    }
  };

  // Helper to determine the approximate city based on latitude and longitude
  const getCityName = (lat: number, lng: number) => {
    // Bangalore is around 12.9716, 77.5946
    const bangaloreLat = 12.9716;
    const bangaloreLng = 77.5946;
    const distanceToBlr = Math.sqrt(
      Math.pow(lat - bangaloreLat, 2) + Math.pow(lng - bangaloreLng, 2),
    );

    if (distanceToBlr < 0.8) {
      return "Bangalore";
    }
    return "Other";
  };

  // Filter issues based on criteria
  const filteredIssues = issues.filter((issue) => {
    const cityName = getCityName(issue.latitude, issue.longitude);

    // Search filter (description, category, recommended department, reporter's name)
    const matchesSearch =
      (issue.description || "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      (issue.category || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.recommendedDepartment || "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      (issue.reportedByName || "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "All" || issue.status === statusFilter;
    const matchesCategory =
      categoryFilter === "All" || issue.category === categoryFilter;
    const matchesCity = cityFilter === "All" || cityName === cityFilter;

    let matchesSeverity = true;
    if (severityFilter === "High") {
      matchesSeverity = issue.severityScore >= 8;
    } else if (severityFilter === "Medium") {
      matchesSeverity = issue.severityScore >= 5 && issue.severityScore < 8;
    } else if (severityFilter === "Low") {
      matchesSeverity = issue.severityScore < 5;
    }

    return (
      matchesSearch &&
      matchesStatus &&
      matchesCategory &&
      matchesCity &&
      matchesSeverity
    );
  });

  // Function to change status of a report
  const handleUpdateStatus = async (
    issueId: string,
    newStatus: CivicStatus,
  ) => {
    try {
      const targetIssue = issues.find(i => i.id === issueId);
      const batch = writeBatch(db);
      const issueRef = doc(db, "issues", issueId);
      batch.update(issueRef, { status: newStatus });
      
      if (targetIssue) {
        // Recompute user's stats dynamically by substituting the updated status
        const userIssues = issues.filter(i => i.reportedByUid === targetIssue.reportedByUid);
        const newImpactPoints = 20 + userIssues.reduce((sum, i) => {
          const effectiveStatus = i.id === issueId ? newStatus : i.status;
          return sum + 10 + (effectiveStatus === "Resolved" ? 50 : 0);
        }, 0);
        
        batch.update(doc(db, "citizens", targetIssue.reportedByUid), {
          impactPoints: newImpactPoints
        });
      }

      await batch.commit();
      setActionMessage(`Status streamlined/updated to "${newStatus}"`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      console.error("Failed to update status:", err);
    }
  };

  // Function to delete a single report via safe modal callback
  const handleConfirmDeleteReport = async () => {
    if (!deleteTargetId) return;
    try {
      const targetIssue = issues.find(i => i.id === deleteTargetId);
      const batch = writeBatch(db);
      batch.delete(doc(db, "issues", deleteTargetId));
      
      if (targetIssue) {
        // Recompute user's stats dynamically from remaining issues
        const remainingUserIssues = issues.filter(i => i.id !== deleteTargetId && i.reportedByUid === targetIssue.reportedByUid);
        const newReportsCount = remainingUserIssues.length;
        const newImpactPoints = 20 + remainingUserIssues.reduce((sum, i) => sum + 10 + (i.status === "Resolved" ? 50 : 0), 0);
        
        batch.update(doc(db, "citizens", targetIssue.reportedByUid), {
          reportsCount: newReportsCount,
          impactPoints: newImpactPoints
        });
      }

      await batch.commit();
      setActionMessage("Report successfully deleted from the ledger.");
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      console.error("Failed to delete report:", err);
    } finally {
      setDeleteTargetId(null);
    }
  };

  // Function to purge ALL reports for reset db via safe modal callback
  const handleConfirmPurgeAllReports = async () => {
    setIsPurging(true);
    setShowPurgeModal(false);
    try {
      const issuesSnap = await getDocs(collection(db, "issues"));
      const citizensSnap = await getDocs(collection(db, "citizens"));
      const batch = writeBatch(db);

      issuesSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      
      citizensSnap.forEach((docSnap) => {
        batch.update(docSnap.ref, {
          reportsCount: 0,
          impactPoints: 20,
          civicRank: "Civic Novice"
        });
      });

      await batch.commit();
      setActionMessage(
        "All reports have been purged and database has been successfully reset!",
      );
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err: any) {
      console.error("Failed to purge reports:", err);
      setActionMessage("Error resetting database: " + (err.message || err));
    } finally {
      setIsPurging(false);
    }
  };

  const getSeverityBadgeClass = (score: number) => {
    if (score >= 8) return "bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]";
    if (score >= 5) return "bg-[#FEF3C7] text-[#D97706] border-[#FCD34D]";
    return "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]";
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case "Reported":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
      case "Resolved":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800";
      case "In Progress":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700";
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 overflow-hidden shadow-2xl dark:shadow-none max-w-7xl mx-auto p-6 space-y-6 relative">
      {/* Header section with Reset/Purge */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-[#F0F0F0] dark:border-gray-800">
        <div>
          <h2 className="text-3xl font-display font-bold text-[#1A1A1A] dark:text-white tracking-tight flex items-center gap-2">
            <FileText className="w-8 h-8 text-[#1A1A1A] dark:text-white" />
            Staff Control Dashboard
          </h2>
          <p className="text-sm text-[#717171] dark:text-gray-400 mt-2">
            Review, verify, and resolve issues reported across municipal bounds.
          </p>
        </div>

        <button
          onClick={() => setShowPurgeModal(true)}
          disabled={isPurging}
          className="bg-[#EF4444] hover:bg-[#DC2626] disabled:bg-gray-400 text-white font-bold text-xs py-2.5 px-5 rounded-full tracking-wider uppercase transition-all duration-200 cursor-pointer flex items-center gap-2 shadow-sm"
        >
          <Trash2 className="w-4 h-4" />
          {isPurging ? "Purging Archive..." : "Reset Database (Purge Reports)"}
        </button>
      </div>

      {actionMessage && (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 transition-all">
          <CheckCircle className="w-4 h-4" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Filter and search bar */}
      <div className="flex flex-col gap-3 bg-[#F9FAFB] dark:bg-gray-800/50 p-4 rounded-2xl border border-[#E5E7EB] dark:border-gray-800 relative">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] dark:text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search details, reporter..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-4 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white transition-all"
            />
          </div>
          
          <button
            onClick={() => setShowFiltersDropdown(!showFiltersDropdown)}
            className={`min-h-[44px] flex items-center justify-center gap-2 px-4 rounded-xl border text-xs font-bold transition-all ${showFiltersDropdown ? "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white" : "bg-white dark:bg-gray-900 border-[#E5E5E5] dark:border-gray-700 text-[#717171] dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            aria-expanded={showFiltersDropdown}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-primary text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showFiltersDropdown ? "rotate-180" : ""}`} />
          </button>
        </div>

        <AnimatePresence>
          {showFiltersDropdown && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700 mt-2">
                {/* Category Filter */}
                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    Category
                  </label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All Categories</option>
                    <option value="Pothole">Pothole</option>
                    <option value="Water Leak">Water Leak</option>
                    <option value="Vandalism">Vandalism</option>
                    <option value="Streetlight Out">Streetlight Out</option>
                    <option value="Waste Issue">Waste Issue</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
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
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    Region
                  </label>
                  <select
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All Regions</option>
                    <option value="Bangalore">Bangalore</option>
                    <option value="Other">Other Region</option>
                  </select>
                </div>

                {/* Severity Filter */}
                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    Severity
                  </label>
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All Severities</option>
                    <option value="High">High (8-10)</option>
                    <option value="Medium">Medium (5-7)</option>
                    <option value="Low">Low (1-4)</option>
                  </select>
                </div>
              </div>

              {(activeFilterCount > 0 || searchTerm) && (
                <div className="flex justify-end mt-4">
                  <button
                    onClick={clearAllFilters}
                    className="text-xs font-bold text-red-600 dark:text-red-400 min-h-[44px] px-4 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                  >
                    Clear All Filters
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex justify-between items-center bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 p-3 rounded-xl mt-4">
        <div className="flex gap-3 items-center">
          <button
            onClick={handleSelectAll}
            className="text-xs font-bold text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {selectedIssues.size === filteredIssues.length &&
            filteredIssues.length > 0
              ? "Deselect All"
              : "Select All"}
          </button>
          <span className="text-xs text-gray-500 font-semibold">
            {selectedIssues.size} selected
          </span>

          {selectedIssues.size > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value)
                  handleBulkUpdate(e.target.value as CivicStatus);
                e.target.value = "";
              }}
              className="text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 focus:outline-none text-gray-700 dark:text-gray-300 font-bold"
            >
              <option value="">Bulk Update Status...</option>
              <option value="Reported">Reported</option>
              <option value="Auto-Routed">Auto-Routed</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
            </select>
          )}
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"
        >
          <FileText className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Tabular Reports List */}
      <div className="overflow-x-auto overflow-y-auto max-h-[600px] glass-card rounded-3xl mt-2 relative">
        {filteredIssues.length === 0 ? (
          <div className="p-12 text-center text-[#717171] dark:text-gray-400 flex flex-col items-center justify-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-[#9CA3AF] stroke-1" />
            <p className="text-sm">
              No reports matching your active filters were found.
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-[#E5E5E5] dark:divide-gray-800 text-left block md:table">
            <thead className="bg-gray-50/50 dark:bg-gray-800/30 sticky top-0 z-10 hidden md:table-header-group">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={
                      selectedIssues.size === filteredIssues.length &&
                      filteredIssues.length > 0
                    }
                    className="w-3 h-3"
                  />
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  Report
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  Location
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  Reporter
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider">
                  Upvotes
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0F0] dark:divide-gray-800 text-xs block md:table-row-group">
              {filteredIssues.map((issue) => {
                const issueCityName = getCityName(
                  issue.latitude,
                  issue.longitude,
                );

                // Flag overdue issues
                const reportedAtDate = new Date(issue.reportedAt).getTime();
                const now = Date.now();
                const hoursPassed = (now - reportedAtDate) / (1000 * 60 * 60);
                const isOverdue =
                  issue.status !== "Resolved" &&
                  issue.priorityTier &&
                  (issue.priorityTier === "P1" ||
                    issue.priorityTier === "P2") &&
                  issue.slaTargetHours &&
                  hoursPassed > issue.slaTargetHours;

                return (
                  <tr
                    key={issue.id}
                    className={`transition-colors block md:table-row border border-gray-200 dark:border-gray-800 md:border-0 rounded-2xl md:rounded-none mb-4 md:mb-0 p-4 md:p-0 ${isOverdue ? "bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20" : "bg-white dark:bg-gray-900 md:bg-transparent hover:bg-gray-50/50 dark:hover:bg-gray-800/50"}`}
                  >
                    <td className="px-0 py-2 md:px-6 md:py-4 block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="flex items-center justify-between md:justify-start">
                        <span className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider">Select</span>
                        <input
                          type="checkbox"
                          checked={selectedIssues.has(issue.id)}
                          onChange={() => handleSelectIssue(issue.id)}
                          className="w-4 h-4 md:w-3 md:h-3 min-h-[44px] min-w-[44px] md:min-h-[auto] md:min-w-[auto] cursor-pointer"
                        />
                      </div>
                    </td>
                    {/* Thumbnail & description */}
                    <td className="px-0 py-3 md:px-6 md:py-4 max-w-sm block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Report</div>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0 border border-[#E5E5E5] dark:border-gray-700 cursor-pointer relative group"
                          onClick={() =>
                            setSelectedImageForModal(issue.imageUrl || null)
                          }
                        >
                          {issue.imageUrl ? (
                            <>
                              <img
                                src={issue.imageUrl}
                                alt="issue"
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                              />
                              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Search className="w-4 h-4 text-white drop-shadow-md" />
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800">
                              No img
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-[#1A1A1A] dark:text-white line-clamp-1">
                            {issue.description || "No description provided"}
                          </p>
                          <div className="flex flex-col gap-1 mt-0.5">
                            <p className="text-[10px] text-[#717171] dark:text-gray-400">
                              Dep:{" "}
                              <span className="font-semibold text-gray-900 dark:text-gray-300">
                                {issue.recommendedDepartment || "General"}
                              </span>
                            </p>
                            {issue.duplicateCount &&
                              issue.duplicateCount > 1 && (
                                <p className="text-[9px] text-orange-600 font-bold bg-orange-50 w-fit px-1.5 py-0.5 rounded-full border border-orange-200">
                                  🔥 {issue.duplicateCount} duplicates
                                </p>
                              )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Category & Severity */}
                    <td className="px-0 py-3 md:px-6 md:py-4 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Category & Severity</div>
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-[#1A1A1A] dark:text-white">
                          {issue.category}
                        </span>
                        <span
                          className={`inline-block px-2 py-0.5 text-[9px] rounded-full font-bold border text-center w-fit ${getSeverityBadgeClass(issue.severityScore)}`}
                        >
                          Severity {issue.severityScore}/10
                        </span>
                        {issue.priorityTier && (
                          <span className="inline-block px-2 py-0.5 text-[9px] rounded-full font-bold border text-center w-fit bg-blue-50 text-blue-600 border-blue-200">
                            {issue.priorityTier} ({issue.slaTargetHours}h SLA)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-0 py-3 md:px-6 md:py-4 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Location</div>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-[#1a1a1a] dark:text-white flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-[#3B82F6]" />
                          {issueCityName}
                        </span>
                        <span className="text-[10px] text-[#717171] dark:text-gray-400 font-mono">
                          {issue.latitude.toFixed(4)},{" "}
                          {issue.longitude.toFixed(4)}
                        </span>
                        {onSelectIssue && onSetTab && (
                          <button
                            onClick={() => {
                              onSelectIssue(issue);
                              onSetTab("map");
                            }}
                            className="text-left text-blue-600 dark:text-blue-400 hover:underline text-[10px] font-semibold mt-0.5 cursor-pointer min-h-[44px] md:min-h-[auto] flex items-center"
                          >
                            Locate on Map
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Reporter Name & Date */}
                    <td className="px-0 py-3 md:px-6 md:py-4 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Reporter</div>
                      <div className="flex flex-col">
                        <span className="font-medium text-[#1A1A1A] dark:text-white">
                          {issue.reportedByName || "Citizen"}
                        </span>
                        <span className="text-[10px] text-[#717171] dark:text-gray-400">
                          {new Date(issue.reportedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>

                    {/* Status Select dropdown */}
                    <td className="px-0 py-3 md:px-6 md:py-4 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Status</div>
                      <select
                        value={issue.status}
                        onChange={(e) =>
                          handleUpdateStatus(
                            issue.id,
                            e.target.value as CivicStatus,
                          )
                        }
                        className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border outline-none min-h-[44px] cursor-pointer appearance-none text-center ${getStatusBadgeStyle(issue.status)}`}
                      >
                        <option value="Reported">Reported</option>
                        <option value="Auto-Routed">Auto-Routed</option>
                        <option value="Requires Human Verification">
                          Verify Report
                        </option>
                        <option value="Corroborated Report">
                          Corroborated
                        </option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                    </td>

                    {/* Upvote count */}
                    <td className="px-0 py-3 md:px-6 md:py-4 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="flex items-center justify-between md:justify-center">
                        <span className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider">Upvotes</span>
                        <div className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] md:min-h-[auto] md:min-w-[auto] gap-1.5 px-2 py-1 rounded bg-[#EFF6FF] border border-[#BFDBFE] text-blue-700 font-bold">
                          <span>{issue.upvotesCount || 0}</span>
                        </div>
                      </div>
                    </td>

                    {/* Deletion / Action button */}
                    <td className="px-0 py-3 md:px-6 md:py-4 whitespace-nowrap block md:table-cell">
                      <div className="flex items-center justify-between md:justify-end">
                        <span className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider">Actions</span>
                        <button
                          onClick={() => setDeleteTargetId(issue.id)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#EF4444] hover:bg-[#FEE2E2] rounded-xl transition-all cursor-pointer"
                          title="Delete Report"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-sm w-full p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-white">
                Delete Civic Report?
              </h3>
              <p className="text-xs text-[#717171] dark:text-gray-400 leading-relaxed">
                Are you sure you want to delete this report from the list? This
                action is permanent and cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="flex-1 py-2.5 rounded-full border border-[#E5E5E5] dark:border-gray-700 text-xs font-bold hover:bg-[#F9FAFB] dark:hover:bg-gray-800 text-gray-900 dark:text-white transition-colors cursor-pointer"
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
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 max-w-md w-full p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-white">
                Purge All Civic Reports?
              </h3>
              <p className="text-xs text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-900/20 p-2.5 rounded-xl border border-red-100 dark:border-red-900/50">
                CRITICAL WARNING: This action permanently purges ALL municipal
                issue coordinates from the Firestore database active ledger.
              </p>
              <p className="text-xs text-[#717171] dark:text-gray-400 leading-relaxed">
                This utility resets active developer accounts, clears historical
                analytics logs, and clears markers of duplication.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowPurgeModal(false)}
                className="flex-1 py-3 rounded-full border border-[#E5E5E5] dark:border-gray-700 text-xs font-bold hover:bg-[#F9FAFB] dark:hover:bg-gray-800 text-gray-900 dark:text-white transition-colors cursor-pointer"
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

      {/* Expand Image Modal */}
      <AnimatePresence>
        {selectedImageForModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setSelectedImageForModal(null)}
          >
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25 }}
              src={selectedImageForModal}
              alt="Expanded issue view"
              className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl cursor-default"
              onClick={(e) => e.stopPropagation()}
            />
            <button className="absolute top-6 right-6 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 backdrop-blur-md transition-colors">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
