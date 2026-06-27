import React, { useState, useEffect, useRef } from "react";
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
import { Sparkles, Send, Loader2, RotateCw } from "lucide-react";
import { CivicIssue, UserScope } from "../types";

interface DashboardProps {
  issues: CivicIssue[];
  scope: UserScope;
}

interface AnalystStep {
  tool: string;
  args: Record<string, any>;
  resultSummary: string;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

// Session cache. The AI briefing/insights are generated ONCE and kept stable —
// they intentionally do NOT regenerate every time the live `issues` snapshot
// changes (new report, upvote, status flip), because the model output varies
// each call and silently "reloading" them is jarring. Staff regenerate on
// demand with the Refresh button. Survives tab switches (module scope).
let cachedInsights: any[] = [];
let cachedHotspots: any[] = [];
let cachedBriefing: string = "";
let cachedReady = false;

export default function StaffDashboard({ issues, scope }: DashboardProps) {
  const [insights, setInsights] = useState<any[]>(cachedInsights);
  const [hotspots, setHotspots] = useState<any[]>(cachedHotspots);
  const [briefing, setBriefing] = useState<string>(cachedBriefing);
  const [loading, setLoading] = useState(!cachedReady);
  const [refreshing, setRefreshing] = useState(false);
  const didInit = useRef(false);

  // "Ask your city" — function-calling analytics agent.
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string>("");
  const [steps, setSteps] = useState<AnalystStep[]>([]);

  const ASK_SUGGESTIONS = [
    "Which ward has the most unresolved issues?",
    "How many P1 issues are past SLA?",
    "Break down open issues by category",
  ];

  const askCity = async (q: string) => {
    const question = q.trim();
    if (!question || asking) return;
    setAsking(true);
    setAnswer("");
    setSteps([]);
    setAskInput("");
    try {
      const res = await fetch("/api/staff-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, scope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Query failed.");
      setAnswer(data.reply || "No answer returned.");
      setSteps(Array.isArray(data.steps) ? data.steps : []);
    } catch (err) {
      setAnswer(
        "Sorry — I couldn't analyse that just now. Please try again in a moment.",
      );
    } finally {
      setAsking(false);
    }
  };

  // Generate (or regenerate) the AI briefing + insights from the CURRENT issues
  // snapshot. Called once on first load and thereafter only via the Refresh
  // button — never automatically on a live `issues` change.
  const runFetch = async () => {
    const isInitial = !cachedReady;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const now = Date.now();
      const recentIssues = issues.filter(
        (i) => now - i.reportedAt < 24 * 60 * 60 * 1000,
      );

      const categoryCounts = (
        recentIssues.length > 0 ? recentIssues : issues
      ).reduce((acc: any, issue) => {
        const cat = issue.category || "Other";
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});
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
          (i) =>
            i.status === "Resolved" &&
            now - (i as any).reportedAt < 24 * 60 * 60 * 1000,
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
        if (Array.isArray(insightsRes.hotspots)) {
          setHotspots(insightsRes.hotspots);
          cachedHotspots = insightsRes.hotspots;
        }
      }
      if (briefingRes.success) {
        setBriefing(briefingRes.briefing);
        cachedBriefing = briefingRes.briefing;
      }
      cachedReady = true;
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch exactly ONCE, when issue data first becomes available. Reuses the
  // session cache on remount (tab switches) and never refetches on live updates.
  useEffect(() => {
    if (cachedReady) {
      setLoading(false);
      return;
    }
    if (didInit.current || issues.length === 0) return;
    didInit.current = true;
    runFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.length]);

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
    <div className="p-4 sm:p-6 space-y-6 bg-gray-50 dark:bg-gray-900">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        <div className="col-span-1 md:col-span-2 bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Daily Briefing Agent
            </h3>
            <button
              onClick={runFetch}
              disabled={loading || refreshing}
              title="Regenerate briefing & insights"
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-primary disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RotateCw
                className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {loading ? (
            <div className="animate-pulse flex gap-2">
              <div className="w-4 h-4 bg-primary rounded-full"></div> Loading...
            </div>
          ) : (
            <p className="text-base sm:text-xl font-light text-gray-900 dark:text-white leading-relaxed">
              {briefing}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-4">
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

      {/* Ask your city — function-calling analytics agent */}
      <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Ask Your City
        </h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          Ask in plain language — the agent queries live data and shows its work.
        </p>

        <div className="relative flex items-center">
          <input
            type="text"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askCity(askInput)}
            placeholder="e.g. Which ward has the most overdue potholes?"
            disabled={asking}
            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full pl-4 pr-12 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none dark:text-white disabled:opacity-60"
          />
          <button
            onClick={() => askCity(askInput)}
            disabled={asking || !askInput.trim()}
            className="absolute right-2 p-2 bg-primary text-white rounded-full disabled:opacity-50 hover:bg-primary/90 transition-colors cursor-pointer"
          >
            {asking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3">
          {ASK_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => askCity(s)}
              disabled={asking}
              className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {(asking || answer) && (
          <div className="mt-4 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 p-4">
            {steps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {steps.map((st, idx) => (
                  <span
                    key={idx}
                    title={JSON.stringify(st.args)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/50"
                  >
                    🔧 {st.tool} → {st.resultSummary}
                  </span>
                ))}
              </div>
            )}
            {asking && !answer ? (
              <p className="text-sm text-gray-400 animate-pulse">
                Querying live data…
              </p>
            ) : (
              <p className="text-sm text-gray-900 dark:text-white leading-relaxed whitespace-pre-wrap">
                {answer}
              </p>
            )}
          </div>
        )}
      </div>

      {!loading && hotspots.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">
            Detected Hotspots
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Geospatial clusters of unresolved same-category reports — likely systemic root causes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {hotspots.map((h, idx) => (
              <div
                key={idx}
                className="bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/50 p-4 rounded-xl"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-2xl font-bold text-rose-700 dark:text-rose-300 leading-none">
                    {h.count}×
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/40 px-2 py-0.5 rounded-full">
                    {h.category}
                  </span>
                </div>
                <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                  {h.locationLabel}
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                  Within {h.radiusMeters}m · over {h.windowDays} day(s) · avg severity {h.avgSeverity}/10
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
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

      <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
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
