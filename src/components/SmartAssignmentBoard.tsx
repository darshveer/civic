import React, { useState } from "react";
import { CivicIssue } from "../types";
import { db } from "../lib/firebase";
import { doc, updateDoc } from "firebase/firestore";

interface KanbanProps {
  issues: CivicIssue[];
}

export default function SmartAssignmentBoard({ issues }: KanbanProps) {
  const [draggedIssue, setDraggedIssue] = useState<CivicIssue | null>(null);

  const columns = ["Reported", "Routed", "In Progress", "Resolved"];

  const onDragStart = (issue: CivicIssue) => {
    setDraggedIssue(issue);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = async (status: string) => {
    if (!draggedIssue || draggedIssue.status === status) return;
    try {
      const issueRef = doc(db, "issues", draggedIssue.id);
      await updateDoc(issueRef, { status });
    } catch (err) {
      console.error(err);
    }
    setDraggedIssue(null);
  };

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <h2 className="text-3xl font-display font-bold mb-6 text-gray-900 dark:text-white tracking-tight">
        Smart Assignment Board
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div
            key={col}
            className="flex-1 min-w-[300px] bg-gray-200 dark:bg-gray-800 rounded-xl p-4 flex flex-col gap-4"
            onDragOver={onDragOver}
            onDrop={() => onDrop(col)}
          >
            <h3 className="font-bold text-gray-700 dark:text-gray-300 flex items-center justify-between">
              {col}
              <span className="bg-white dark:bg-gray-700 px-2 py-1 rounded-full text-xs">
                {issues.filter((i) => i.status === col).length}
              </span>
            </h3>

            <div className="flex-1 overflow-y-auto space-y-3 min-h-[500px]">
              {issues
                .filter((i) => i.status === col)
                .map((issue) => (
                  <div
                    key={issue.id}
                    draggable
                    onDragStart={() => onDragStart(issue)}
                    className="bg-white dark:bg-gray-700 p-4 rounded-lg shadow-sm cursor-grab active:cursor-grabbing border-l-4"
                    style={{
                      borderLeftColor:
                        issue.priorityTier === "P1"
                          ? "red"
                          : issue.priorityTier === "P2"
                            ? "orange"
                            : "gray",
                    }}
                  >
                    <p className="font-bold text-sm text-gray-900 dark:text-white">
                      {issue.category}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                      {issue.description}
                    </p>

                    {col === "Reported" && (
                      <div className="mt-3 p-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg flex items-start gap-2">
                        <span className="text-indigo-500 mt-0.5">✨</span>
                        <div>
                          <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase">
                            AI Suggestion
                          </p>
                          <p className="text-xs text-indigo-900 dark:text-indigo-300">
                            Route to{" "}
                            {issue.recommendedDepartment || "General Ops"}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-bold border border-blue-200 dark:border-blue-800">
                        {issue.recommendedDepartment}
                      </span>
                      {issue.priorityTier && (
                        <span className="text-[10px] bg-gray-100 dark:bg-gray-600 px-2 py-0.5 rounded-full font-bold text-gray-700 dark:text-gray-300">
                          {issue.priorityTier}
                        </span>
                      )}
                    </div>
                    
                    <div className="mt-3 border-t border-gray-100 dark:border-gray-600 pt-3">
                      <label className="sr-only">Move to status</label>
                      <select
                        value={issue.status}
                        onChange={async (e) => {
                          try {
                            const issueRef = doc(db, "issues", issue.id);
                            await updateDoc(issueRef, { status: e.target.value });
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="w-full text-[10px] min-h-[44px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 font-bold text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer transition-colors"
                      >
                        <option value="Reported">Move: Reported</option>
                        <option value="Auto-Routed">Move: Auto-Routed</option>
                        <option value="Requires Human Verification">Move: Verify Report</option>
                        <option value="Corroborated Report">Move: Corroborated</option>
                        <option value="In Progress">Move: In Progress</option>
                        <option value="Resolved">Move: Resolved</option>
                      </select>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
