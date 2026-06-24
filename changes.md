# Development Changes Log

## Fixes and Improvements

1. **Bug Fix: Fixed Map Crash on App Load**
   - **Issue:** Map layer functionality for Heatmap layer threw an unhandled runtime error preventing staff map load (`Heatmap Layer functionality in the Maps JavaScript API is no longer available in the Maps JavaScript API as of version 3.65`). 
   - **Resolution:** Removed the defunct `HeatmapLayer` implementation, cleaning up the code, removing unused React imports (`useMapsLibrary`), and preventing the crash on mounting. The fallback handles map rendering correctly.

2. **Analytics Tab Persistence & Optimization**
   - **Issue:** The Staff Analytics tab regenerated predictive insights and daily briefings upon every navigation to the tab, causing visual shifts and excessive backend calls.
   - **Resolution:** Implemented application-level caching via module-level variables (`cachedInsights`, `cachedBriefing`, `cachedIssuesCount`) in `StaffDashboard`. The dashboard now smoothly loads existing predictions and re-runs the LLM prompt only when new reports are submitted.

3. **Accurate Briefing Generation**
   - **Issue:** The AI briefing generated an incorrect trend ("Water Leak" always) regardless of actual reported items (like "Potholes").
   - **Resolution:** The `trendingCategory` metric passed to the Gemini prompt was hardcoded. Replaced it with a dynamic reduction logic that properly counts issue occurrences and passes the highest-frequency category to the AI dynamically.

4. **Added Icons for Staff Views**
   - Added missing UI icons from `lucide-react` (like `ClipboardList` and `Map`) in `App.tsx` and removed unused/broken `ErrorBoundary` which was causing previous type-check fails. The application successfully compiles and lint errors are resolved.

5. **Fixed 'Zero New Reports' in Daily Briefing**
   - **Issue:** The AI agent reported 0 new reports despite new issues being added.
   - **Resolution:** `newReports` was previously calculated by checking for `status === "Reported"`. However, newly submitted issues are immediately auto-triaged to "Auto-Routed" or "Requires Human Verification", causing the count to always be 0. Updated the logic to calculate `newReports` dynamically based on issues created within the last 24 hours (`Date.now() - i.reportedAt < 24h`). Additionally, `trendingCategory` now dynamically evaluates recent reports instead of all-time data.
