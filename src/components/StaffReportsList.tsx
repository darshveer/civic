/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { db, corroborateAndApprove } from "../lib/firebase";
import { canActOnIssue } from "../lib/roles";
import {
  collection,
  doc,
  deleteDoc,
  writeBatch,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { CivicIssue, CivicStatus, UserScope } from "../types";
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
  ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface StaffReportsListProps {
  issues: CivicIssue[];
  scope: UserScope;
  currentUser: User | null;
  onSelectIssue?: (issue: CivicIssue) => void;
  onSetTab?: (tab: "map" | "reporter") => void;
}

export default function StaffReportsList({
  issues,
  scope,
  currentUser,
  onSelectIssue,
  onSetTab,
}: StaffReportsListProps) {
  const canPurge = scope.tier === "city"; // only the city admin may reset the DB
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  // Cascading geographic filter: State → City → Zone → Ward.
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [cityFilter, setCityFilter] = useState<string>("All");
  const [zoneFilter, setZoneFilter] = useState<string>("All");
  const [wardFilter, setWardFilter] = useState<string>("All");
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
    (stateFilter !== "All" ? 1 : 0) +
    (cityFilter !== "All" ? 1 : 0) +
    (zoneFilter !== "All" ? 1 : 0) +
    (wardFilter !== "All" ? 1 : 0) +
    (severityFilter !== "All" ? 1 : 0);

  const clearAllFilters = () => {
    setStatusFilter("All");
    setCategoryFilter("All");
    setStateFilter("All");
    setCityFilter("All");
    setZoneFilter("All");
    setWardFilter("All");
    setSeverityFilter("All");
    setSearchTerm("");
  };

  // Cascading option lists — each level is constrained by the levels above it.
  const uniqueSorted = (vals: (string | undefined)[]) =>
    Array.from(new Set(vals.filter((v): v is string => Boolean(v)))).sort();
  const stateOptions = uniqueSorted(issues.map((i) => i.state));
  const cityOptions = uniqueSorted(
    issues
      .filter((i) => stateFilter === "All" || i.state === stateFilter)
      .map((i) => i.city),
  );
  const zoneOptions = uniqueSorted(
    issues
      .filter(
        (i) =>
          (stateFilter === "All" || i.state === stateFilter) &&
          (cityFilter === "All" || i.city === cityFilter),
      )
      .map((i) => i.zone),
  );
  const wardOptions = uniqueSorted(
    issues
      .filter(
        (i) =>
          (stateFilter === "All" || i.state === stateFilter) &&
          (cityFilter === "All" || i.city === cityFilter) &&
          (zoneFilter === "All" || i.zone === zoneFilter),
      )
      .map((i) => i.ward),
  );

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
      // Only issue docs change — points/counts are derived live from issues,
      // so there is nothing to denormalize (and rules forbid staff writing
      // citizen profiles).
      const batch = writeBatch(db);
      selectedIssues.forEach((id) => {
        batch.update(doc(db, "issues", id), { status });
      });
      await batch.commit();
      setActionMessage(
        `Bulk updated ${selectedIssues.size} issues to "${status}"`,
      );
      setSelectedIssues(new Set());
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error("Bulk update failed", err);
      setActionMessage("Bulk update failed — check your permissions for this area.");
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  // Filter issues based on criteria
  const filteredIssues = issues.filter((issue) => {
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
    const matchesState = stateFilter === "All" || issue.state === stateFilter;
    const matchesCity = cityFilter === "All" || issue.city === cityFilter;
    const matchesZone = zoneFilter === "All" || issue.zone === zoneFilter;
    const matchesWard = wardFilter === "All" || issue.ward === wardFilter;

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
      matchesState &&
      matchesCity &&
      matchesZone &&
      matchesWard &&
      matchesSeverity
    );
  });

  // Function to change status of a report
  const handleUpdateStatus = async (
    issueId: string,
    newStatus: CivicStatus,
  ) => {
    try {
      await updateDoc(doc(db, "issues", issueId), { status: newStatus });
      setActionMessage(`Status updated to "${newStatus}"`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error("Failed to update status:", err);
      setActionMessage("Update failed — you may not have rights for this area.");
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  // RULE B — Official Staff Override: promote straight to "Staff Verified".
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const handleApprove = async (issueId: string) => {
    if (!currentUser) return;
    setApprovingId(issueId);
    try {
      await corroborateAndApprove(issueId, currentUser.uid);
      setActionMessage("Report approved — promoted to Staff Verified.");
    } catch (err) {
      console.error("Approval failed:", err);
      setActionMessage("Approval failed — you may not have rights for this area.");
    } finally {
      setApprovingId(null);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  // Function to delete a single report via safe modal callback
  const handleConfirmDeleteReport = async () => {
    if (!deleteTargetId) return;
    try {
      // Deleting the issue automatically removes its contribution to the
      // reporter's live-computed points/count — no profile write needed.
      await deleteDoc(doc(db, "issues", deleteTargetId));
      setActionMessage("Report successfully deleted from the ledger.");
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error("Failed to delete report:", err);
      setActionMessage("Delete failed — you may not have rights for this area.");
      setTimeout(() => setActionMessage(null), 3000);
    } finally {
      setDeleteTargetId(null);
    }
  };

  // Function to purge ALL reports for reset db via safe modal callback
  const handleConfirmPurgeAllReports = async () => {
    setIsPurging(true);
    setShowPurgeModal(false);
    try {
      // Delete only issues. Citizen profiles are NOT touched — points/counts
      // are derived live from the issues collection, so removing issues resets
      // every total automatically and consistently.
      const issuesSnap = await getDocs(collection(db, "issues"));
      const batch = writeBatch(db);
      issuesSnap.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      setActionMessage(
        "All reports have been purged and the database has been reset.",
      );
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      console.error("Failed to purge reports:", err);
      setActionMessage(
        "Error resetting database: " +
          (err instanceof Error ? err.message : String(err)),
      );
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
      case "Staff Verified":
        return "bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
      case "Community Verified":
      case "Corroborated Report":
        return "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800";
      case "In Progress":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
      case "Flagged for Review":
        return "bg-red-50 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700";
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-[#E5E5E5] dark:border-gray-800 overflow-hidden shadow-2xl dark:shadow-none max-w-7xl mx-auto p-4 sm:p-6 space-y-6 relative">
      {/* Header section with Reset/Purge */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-[#F0F0F0] dark:border-gray-800">
        <div>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#1A1A1A] dark:text-white tracking-tight flex items-center gap-2">
            <FileText className="w-7 h-7 sm:w-8 sm:h-8 text-[#1A1A1A] dark:text-white shrink-0" />
            Staff Control Dashboard
          </h2>
          <p className="text-sm text-[#717171] dark:text-gray-400 mt-2">
            Review, verify, and resolve issues reported across municipal bounds.
          </p>
        </div>

        {canPurge && (
          <button
            onClick={() => setShowPurgeModal(true)}
            disabled={isPurging}
            className="bg-[#EF4444] hover:bg-[#DC2626] disabled:bg-gray-400 text-white font-bold text-xs py-2.5 px-5 rounded-full tracking-wider uppercase transition-all duration-200 cursor-pointer flex items-center gap-2 shadow-sm"
          >
            <Trash2 className="w-4 h-4" />
            {isPurging ? "Purging Archive..." : "Reset Database (Purge Reports)"}
          </button>
        )}
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
          <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
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
                    <option value="Pending Verification">Pending Verification</option>
                    <option value="Corroborated Report">Corroborated</option>
                    <option value="Community Verified">Community Verified</option>
                    <option value="Staff Verified">Staff Verified</option>
                    <option value="Flagged for Review">Flagged for Review</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>

                {/* Cascading geography: State → City → Zone → Ward */}
                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    State
                  </label>
                  <select
                    value={stateFilter}
                    onChange={(e) => {
                      setStateFilter(e.target.value);
                      setCityFilter("All");
                      setZoneFilter("All");
                      setWardFilter("All");
                    }}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All States</option>
                    {stateOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    City
                  </label>
                  <select
                    value={cityFilter}
                    onChange={(e) => {
                      setCityFilter(e.target.value);
                      setZoneFilter("All");
                      setWardFilter("All");
                    }}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All Cities</option>
                    {cityOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    Zone
                  </label>
                  <select
                    value={zoneFilter}
                    onChange={(e) => {
                      setZoneFilter(e.target.value);
                      setWardFilter("All");
                    }}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All Zones</option>
                    {zoneOptions.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-[#717171] dark:text-gray-400 uppercase tracking-wider mb-1">
                    Ward
                  </label>
                  <select
                    value={wardFilter}
                    onChange={(e) => setWardFilter(e.target.value)}
                    className="w-full text-xs px-3 min-h-[44px] bg-white dark:bg-gray-900 border border-[#E5E5E5] dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-[#1A1A1A] dark:text-white font-medium cursor-pointer"
                  >
                    <option value="All">All Wards</option>
                    {wardOptions.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
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

      <div className="flex flex-wrap gap-2 justify-between items-center bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 p-3 rounded-xl mt-4">
        <div className="flex flex-wrap gap-2 items-center">
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
              <option value="Pending Verification">Pending Verification</option>
              <option value="Community Verified">Community Verified</option>
              <option value="Staff Verified">Staff Verified</option>
              <option value="Flagged for Review">Flagged for Review</option>
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

      {/* Reports List — compact cards on mobile, full table on desktop. */}
      <div className="md:overflow-x-auto overflow-y-auto md:max-h-[600px] glass-card rounded-3xl mt-2 relative">
        {filteredIssues.length === 0 ? (
          <div className="p-12 text-center text-[#717171] dark:text-gray-400 flex flex-col items-center justify-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-[#9CA3AF] stroke-1" />
            <p className="text-sm">
              No reports matching your active filters were found.
            </p>
          </div>
        ) : (
          <>
          {/* ---- Mobile: compact cards ---- */}
          <div className="md:hidden divide-y divide-[#F0F0F0] dark:divide-gray-800">
            {filteredIssues.map((issue) => {
              const loc = issue.ward || issue.city || issue.state || "Unmapped";
              const sub = [issue.city, issue.state].filter(Boolean).join(", ");
              const hoursPassed =
                (Date.now() - new Date(issue.reportedAt).getTime()) / 3.6e6;
              const isOverdue =
                issue.status !== "Resolved" &&
                (issue.priorityTier === "P1" || issue.priorityTier === "P2") &&
                issue.slaTargetHours &&
                hoursPassed > issue.slaTargetHours;
              const canApprove =
                canActOnIssue(scope, issue) &&
                issue.status !== "Staff Verified" &&
                issue.status !== "Resolved";
              return (
                <div
                  key={issue.id}
                  className={`flex gap-2.5 p-3 ${isOverdue ? "bg-red-50/60 dark:bg-red-900/10" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIssues.has(issue.id)}
                    onChange={() => handleSelectIssue(issue.id)}
                    className="w-4 h-4 mt-0.5 shrink-0 cursor-pointer accent-primary"
                  />
                  <button
                    onClick={() => setSelectedImageForModal(issue.imageUrl || null)}
                    className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0 border border-[#E5E5E5] dark:border-gray-700"
                  >
                    {issue.imageUrl ? (
                      <img src={issue.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[9px] text-gray-400">No img</span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-[13px] leading-snug text-[#1A1A1A] dark:text-white line-clamp-2 break-words">
                        {issue.description || "No description provided"}
                      </p>
                      <div className="flex items-center gap-0.5 shrink-0 -mr-1">
                        {canApprove && (
                          <button
                            onClick={() => handleApprove(issue.id)}
                            disabled={approvingId === issue.id}
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg disabled:opacity-50"
                            title="Corroborate & Approve"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteTargetId(issue.id)}
                          className="p-1.5 text-[#EF4444] hover:bg-[#FEE2E2] rounded-lg"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      <span className="px-1.5 py-0.5 text-[9px] rounded-full font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                        {issue.category}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 text-[9px] rounded-full font-bold border ${getSeverityBadgeClass(issue.severityScore)}`}
                      >
                        Sev {issue.severityScore}
                      </span>
                      {issue.priorityTier && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded-full font-bold border bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                          {issue.priorityTier}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded-full font-bold bg-[#EFF6FF] text-blue-700 border border-[#BFDBFE] dark:bg-blue-900/20 dark:border-blue-800">
                        ▲ {issue.upvotesCount || 0}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-[#717171] dark:text-gray-400 min-w-0">
                      <MapPin className="w-3 h-3 text-[#3B82F6] shrink-0" />
                      <span className="truncate">
                        {loc}
                        {sub ? ` · ${sub}` : ""}
                      </span>
                    </div>

                    <div className="text-[10px] text-[#9CA3AF] dark:text-gray-500 truncate">
                      {issue.reportedByName || "Citizen"} ·{" "}
                      {new Date(issue.reportedAt).toLocaleDateString()}
                    </div>

                    <div className="flex items-center gap-2 pt-0.5">
                      <select
                        value={issue.status}
                        onChange={(e) =>
                          handleUpdateStatus(issue.id, e.target.value as CivicStatus)
                        }
                        className={`flex-1 min-w-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-lg border outline-none cursor-pointer ${getStatusBadgeStyle(issue.status)}`}
                      >
                        <option value="Reported">Reported</option>
                        <option value="Auto-Routed">Auto-Routed</option>
                        <option value="Requires Human Verification">Verify Report</option>
                        <option value="Pending Verification">Pending Verification</option>
                        <option value="Corroborated Report">Corroborated</option>
                        <option value="Community Verified">Community Verified</option>
                        <option value="Staff Verified">Staff Verified</option>
                        <option value="Flagged for Review">Flagged for Review</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                      {onSelectIssue && onSetTab && (
                        <button
                          onClick={() => {
                            onSelectIssue(issue);
                            onSetTab("map");
                          }}
                          className="shrink-0 text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1.5 rounded-lg border border-blue-100 dark:border-blue-900/50 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          Map
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- Desktop: full table ---- */}
          <table className="min-w-full divide-y divide-[#E5E5E5] dark:divide-gray-800 text-left hidden md:table">
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
                const issueLocationLabel =
                  issue.ward || issue.city || issue.state || "Unmapped";

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
                    className={`transition-colors block md:table-row border border-gray-200 dark:border-gray-800 md:border-0 rounded-xl md:rounded-none mb-3 md:mb-0 p-3 md:p-0 ${isOverdue ? "bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20" : "bg-white dark:bg-gray-900 md:bg-transparent hover:bg-gray-50/50 dark:hover:bg-gray-800/50"}`}
                  >
                    <td className="px-0 py-2 md:px-4 md:py-2.5 block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
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
                    <td className="px-0 py-3 md:px-4 md:py-2.5 max-w-sm block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Report</div>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0 border border-[#E5E5E5] dark:border-gray-700 cursor-pointer relative group"
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
                    <td className="px-0 py-3 md:px-4 md:py-2.5 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
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
                    <td className="px-0 py-3 md:px-4 md:py-2.5 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Location</div>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-[#1a1a1a] dark:text-white flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-[#3B82F6]" />
                          {issueLocationLabel}
                        </span>
                        <span className="text-[10px] text-[#717171] dark:text-gray-400">
                          {[issue.city, issue.state].filter(Boolean).join(", ") ||
                            `${issue.latitude.toFixed(4)}, ${issue.longitude.toFixed(4)}`}
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
                    <td className="px-0 py-3 md:px-4 md:py-2.5 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
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
                    <td className="px-0 py-3 md:px-4 md:py-2.5 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
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
                        <option value="Pending Verification">
                          Pending Verification
                        </option>
                        <option value="Corroborated Report">
                          Corroborated
                        </option>
                        <option value="Community Verified">
                          Community Verified
                        </option>
                        <option value="Staff Verified">Staff Verified</option>
                        <option value="Flagged for Review">
                          Flagged for Review
                        </option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                    </td>

                    {/* Upvote count */}
                    <td className="px-0 py-3 md:px-4 md:py-2.5 whitespace-nowrap block md:table-cell border-b border-gray-100 dark:border-gray-800 md:border-0">
                      <div className="flex items-center justify-between md:justify-center">
                        <span className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider">Upvotes</span>
                        <div className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] md:min-h-[auto] md:min-w-[auto] gap-1.5 px-2 py-1 rounded bg-[#EFF6FF] border border-[#BFDBFE] text-blue-700 font-bold">
                          <span>{issue.upvotesCount || 0}</span>
                        </div>
                      </div>
                    </td>

                    {/* Deletion / Action button */}
                    <td className="px-0 py-2.5 md:px-4 md:py-2.5 whitespace-nowrap block md:table-cell">
                      <div className="flex items-center justify-between md:justify-end gap-1">
                        <span className="md:hidden text-[10px] font-bold text-gray-500 uppercase tracking-wider">Actions</span>
                        <div className="flex items-center gap-1">
                          {/* RULE B — Official Staff Override */}
                          {canActOnIssue(scope, issue) &&
                            issue.status !== "Staff Verified" &&
                            issue.status !== "Resolved" && (
                              <button
                                onClick={() => handleApprove(issue.id)}
                                disabled={approvingId === issue.id}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                                title="Corroborate & Approve (Staff Verified)"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                            )}
                          <button
                            onClick={() => setDeleteTargetId(issue.id)}
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#EF4444] hover:bg-[#FEE2E2] rounded-xl transition-all cursor-pointer"
                            title="Delete Report"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </>
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
