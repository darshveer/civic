import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { CivicIssue } from "../types";

interface DashboardProps {
  issues: CivicIssue[];
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

let cachedInsights: any[] = [];
let cachedBriefing: string = "";
let cachedIssuesCount = -1;

export default function StaffDashboard({ issues }: DashboardProps) {
  const [insights, setInsights] = useState<any[]>(cachedInsights);
  const [briefing, setBriefing] = useState<string>(cachedBriefing);
  const [loading, setLoading] = useState(cachedIssuesCount === -1);

  useEffect(() => {
    const fetchAI = async () => {
      if (issues.length === cachedIssuesCount && cachedInsights.length > 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const now = Date.now();
        const recentIssues = issues.filter(
          (i) => now - i.reportedAt < 24 * 60 * 60 * 1000,
        );

        const categoryCounts = (recentIssues.length > 0 ? recentIssues : issues).reduce(
          (acc: any, issue) => {
            const cat = issue.category || "Other";
            acc[cat] = (acc[cat] || 0) + 1;
            return acc;
          },
          {},
        );
        let trendingCategory = "Unknown";
        let maxCount = 0;
        for (const cat in categoryCounts) {
          if (categoryCounts[cat] > maxCount) {
            maxCount = categoryCounts[cat];
            trendingCategory = cat;
          }
        }

        const stats = {
          newReports: recentIssues.length,
          resolved: issues.filter(
            (i) => i.status === "Resolved" && now - (i as any).reportedAt < 24 * 60 * 60 * 1000,
          ).length,
          trendingCategory,
          slaBreaches: issues.filter(
            (i) => i.priorityTier === "P1" && i.status !== "Resolved",
          ).length,
        };

        const [insightsRes, briefingRes] = await Promise.all([
          fetch("/api/predictive-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ issues: issues.slice(0, 50) }),
          }).then((res) => res.json()),
          fetch("/api/daily-briefing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stats }),
          }).then((res) => res.json()),
        ]);

        if (insightsRes.success) {
          setInsights(insightsRes.insights);
          cachedInsights = insightsRes.insights;
        }
        if (briefingRes.success) {
          setBriefing(briefingRes.briefing);
          cachedBriefing = briefingRes.briefing;
        }
        cachedIssuesCount = issues.length;
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };

    if (issues.length > 0) fetchAI();
  }, [issues]);

  const categoryData = issues.reduce((acc: any, curr) => {
    const cat = curr.category || "Other";
    const existing = acc.find((a: any) => a.name === cat);
    if (existing) existing.value++;
    else acc.push({ name: cat, value: 1 });
    return acc;
  }, []);

  const statusData = issues.reduce((acc: any, curr) => {
    const stat = curr.status || "Reported";
    const existing = acc.find((a: any) => a.name === stat);
    if (existing) existing.value++;
    else acc.push({ name: stat, value: 1 });
    return acc;
  }, []);

  return (
    <div className="p-6 space-y-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">
            Daily Briefing Agent
          </h3>
          {loading ? (
            <div className="animate-pulse flex gap-2">
              <div className="w-4 h-4 bg-primary rounded-full"></div> Loading...
            </div>
          ) : (
            <p className="text-xl font-light text-gray-900 dark:text-white leading-relaxed">
              {briefing}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">
            Resolution Funnel
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((_: any, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">
          Predictive Insight Agents
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {loading
            ? [1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-32 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-xl"
                />
              ))
            : (Array.isArray(insights) ? insights : []).map((insight, idx) => (
                <div
                  key={idx}
                  className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 rounded-xl"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-blue-900 dark:text-blue-300">
                      {insight.title}
                    </h4>
                    <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full font-bold">
                      {insight.confidence}%
                    </span>
                  </div>
                  <p className="text-sm text-blue-800 dark:text-blue-400 mb-3">
                    {insight.prediction}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-500 font-semibold border-t border-blue-200 dark:border-blue-800/50 pt-2">
                    Action: {insight.actionRecommended}
                  </p>
                </div>
              ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">
          Issues by Category
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryData}>
              <XAxis
                dataKey="name"
                stroke="#888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.05)" }}
                contentStyle={{
                  borderRadius: "12px",
                  border: "none",
                  boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                }}
              />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
