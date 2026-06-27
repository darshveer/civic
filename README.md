# C.I.V.I.C - Community Infrastructure Verification & Intelligent Clustering

A modern, gamified civic engagement platform that connects citizens directly with city administration — built around a **fleet of 17 Gemini agents** that triage, verify, deduplicate, prioritise, predict, dispatch, and advocate. Several are **tool-using** agents: a citizen can file a report by chatting, staff can query live city data in plain language, and a work-order can be drafted and dispatched in one click.

## Features

- **AI-Powered Triaging**: Upload a photo of a civic issue, and the Gemini-powered agent automatically categorizes it, assigns a 1–10 severity (with a **one-line urgency rationale** — "exposed live wire beside a school, heavy foot traffic"), computes a confidence score, and routes it to the correct department.
- **Conversational Reporting (tool-using agent)**: Citizens can file a report just by chatting with the Civic Assistant — it gathers the details, drafts the report, and (on a one-tap confirm) writes it to Firestore at their location.
- **Staff "Ask Your City" Analyst (function-calling agent)**: Staff ask questions in plain language ("which ward has the most overdue potholes?") and a tool-using agent queries the live, jurisdiction-scoped data and shows the tool calls it made.
- **Auto-Dispatch (human-in-the-loop agent)**: For any triaged issue, an agent drafts a formal work-order email to the responsible department; staff review/edit it and send with one click (SMTP), which advances the issue to In Progress.
- **Predictive Insights with Hotspot Clustering**: A geospatial clustering pass detects dense same-category clusters ("3× Pothole within 180m of Ward 12 over 12 days"), and the Predictive Insight agent grounds its forecasts on those real hotspots.
- **Three-Layer Trust & Verification Engine**: Every report passes through (1) EXIF/metadata checks, (2) a **Cognitive Forensics agent** that scores image authenticity and detects manipulation/AI-generation, and (3) **spatial consensus** — independent reporters within 50m with overlapping visual-evidence tags auto-corroborate each other into "Community Verified". Suspected fraud is flagged and excluded from consensus.
- **Location Context**: Built with Google Maps Platform, including Geocoding for accurate addresses, Places API for nearby context, and clustered issue mapping.
- **Smart Assignment & Deduplication**: Groups similar issues together using radius-based and semantic (visual-tag) corroboration, with a P1–P4 priority tier and SLA target computed per report.
- **Voice & Multimodal Intake**: Citizens can speak a report or upload a photo with no text — the **Smart Description agent** transcribes audio and/or reads the image and drafts a clear, professional, multilingual description for city workers.
- **Civic Assistant (Conversational Agent)**: A grounded, multilingual chatbot that answers "what's near me?" and status questions directly from the user's own report history and nearby community issues (prompt-injection hardened — untrusted data is sandboxed).
- **Predictive Insights**: A staff-facing agent analyses historical + active reports to forecast hotspots ("Ward 12 likely to see drainage issues this monsoon") with confidence and a recommended action.
- **AI Daily Briefing**: City staff get a natural-language executive summary of new/resolved reports, the trending category, and SLA breaches — with a deterministic rule-based fallback if AI is unavailable.
- **Civic Advocacy / Petitions**: Once an issue crosses the community-support threshold, an agent drafts a formal, location-specific petition addressed to the right department that residents can rally behind.
- **Gamification**: Earn civic points, climb the global and ward leaderboards, unlock badges, complete **missions**, and get personalised nudges from the **Missions Coach agent**. Points and report counts are **derived live from the issues collection** — a single source of truth, so they never drift after a delete or purge. A shareable AI-generated **Impact Story** card celebrates each citizen's contribution.
- **Neighborhood Alerts**: Citizens see a live summary of issues clustered around their home ward/coordinates.
- **Real-Time Updates**: Get in-app notifications when the status of your reported issues changes.
- **Community Interaction**: Upvote, corroborate, and comment on local issues, with **offline rule-based profanity moderation** (mask common profanity, block severe slurs, leetspeak-aware). Municipal staff cannot upvote, and nobody can upvote their own report.
- **Municipal Hierarchy (RBAC)**: Three staff tiers modelled on Indian urban local bodies — **Ward Officer (field)** → **Zonal Supervisor** → **City Administrator** — each scoped to the area they govern. Staff views, the cascading **State → City → Zone → Ward** filter, and all status/delete/purge actions are bounded by the signed-in officer's scope and enforced server-side by Firestore rules.
- **Before / After Resolution**: Staff upload an "after" photo; the **Resolution-Verification agent** confirms the fix before the status flips to Resolved (once, via a transaction — no double-awards), and citizens see a before/after comparison.
- **Email OTP Verification**: Email/password sign-ups verify via a one-time code over SMTP (in-memory, short TTL — no firebase-admin required).
- **Resilient Model Cascade**: Every agent falls through **primary Gemini → lightweight Gemini (flash-lite) → Groq (text agents)**, then a static fallback, so an AI outage never breaks a citizen submission.

## AI Agent Fleet

| # | Agent | Trigger | What it does |
|---|-------|---------|--------------|
| 1 | **Triage** | New report (image) | Category, severity (1–10) + one-line urgency rationale, confidence, department, description |
| 2 | **Routing** | After triage | Auto-route (≥85% confidence) vs. Requires Human Verification |
| 3 | **Verification / Dedup** | New report | 50m same-category radius match → corroborated group |
| 4 | **Priority** | New report | P1–P4 tier + SLA target hours from severity/upvotes/corroboration |
| 5 | **Cognitive Forensics** | New report (image) | Authenticity / fraud-confidence score + visual-evidence tags |
| 6 | **Spatial Consensus** | New report | Independent nearby corroboration → Community Verified |
| 7 | **Resolution-Verification** | Staff "after" photo | Before/after comparison confirms the fix before Resolved |
| 8 | **Civic Assistant** | Chat | Grounded, multilingual Q&A over the user's + nearby reports |
| 9 | **Smart Description** | Reporter | Image + voice note → polished multilingual description |
| 10 | **Predictive Insight** | Staff dashboard | Geo-clusters reports into hotspots, then forecasts systemic problems with confidence |
| 11 | **Daily Briefing** | Staff dashboard | Natural-language executive summary of the day |
| 12 | **Impact Story** | Citizen dashboard | Shareable gamified contribution card |
| 13 | **Civic Advocacy / Petition** | High-support issue | Drafts a formal petition to the right department |
| 14 | **Missions Coach** | Citizen dashboard | Personalised motivating nudge toward the next rank |
| 15 | **Conversational Reporting** 🛠️ | Civic Assistant chat | Tool-using: gathers details and files a report on the citizen's behalf |
| 16 | **Staff Operations Analyst** 🛠️ | Staff dashboard | Function-calling loop over live, scoped data answers NL questions |
| 17 | **Auto-Dispatch** 🛠️ | Staff issue detail | Drafts a department work-order email for one-click staff approval & send |

🛠️ = tool-using / function-calling agent (multi-step, takes or proposes an action).

## Tech Stack

- **Frontend**: React + Vite, Tailwind CSS
- **Mapping**: Google Maps Platform (Advanced Markers, Geocoding, Places API)
- **Backend**: Express server (Vite middleware in dev, static in prod) — uses the Firebase **client** SDK server-side, **no firebase-admin**, so it deploys cleanly on Google AI Studio / Cloud Run.
- **Database**: Firebase Firestore (Real-time NoSQL), secured entirely by `firestore.rules`.
- **Authentication**: Firebase Auth (Google Sign-In) + email/password with SMTP OTP verification.
- **AI/ML**: Gemini multimodal (text, image, audio) with a resilient **Gemini → Gemini Lite → Groq** model cascade.
- **Hosting**: Deployable via Google AI Studio / Firebase Hosting + a Node server for the `/api` routes.

## Future Extensions

- **Google Cloud Vision / Vertex AI**: Can be enabled behind environment flags for advanced image moderation, deep-fake detection, or structural damage analysis prior to human review.
- **Firebase Cloud Messaging (FCM)**: Native push notifications for mobile clients (client-token based, no admin SDK).

## Security & Hygiene

- **Firebase Config is Public**: The `firebase-applet-config.json` file contains your Firebase web API keys. This is **safe to commit** and expose in the browser. Security for Firebase comes from the `firestore.rules` and key restrictions, not by hiding the API key.
- **API Keys**: The ONLY real secrets are your `GEMINI_API_KEY` and `GOOGLE_MAPS_PLATFORM_KEY`. These belong in your `.env.local` file (which is gitignored) and must **NEVER** be hardcoded or committed to version control.
- **Google Maps API**: Restrict your Google Maps API key by HTTP referrer in the Google Cloud Console to prevent unauthorized usage on other domains.
- **Gemini API**: The Gemini API key is kept securely server-side and is never exposed to the client browser.
- **Firestore Rules**: `firestore.rules` now enforces authentication and the municipal hierarchy: only signed-in users can read/write; a user may only edit their **own** profile and cannot set their own `role`; issue **status changes, assignment, and deletion** are allowed only for staff whose scope covers the issue's ward; the **purge/registry** is city-admin only; upvotes can only add/remove the caller's own uid and never on their own report. **Deploy the rules** (Firebase console → Firestore → Rules, or your AI Studio Firebase integration) for them to take effect.

## Municipal Staff Hierarchy (RBAC) & Seeding

Authoritative staff status lives in two Firestore documents (NOT in the client). Seed them once
from the Firebase console (console writes bypass rules; after that only a city admin can edit them):

**`config/roles`** — the staff registry, keyed by Firebase `uid`:

```json
{
  "staff": {
    "<your-uid>":      { "tier": "city" },
    "<zonal-uid>":     { "tier": "zonal", "zone": "Z-South" },
    "<field-uid>":     { "tier": "field", "wards": ["Ward 12", "Ward 13"] }
  }
}
```

**`config/wards`** — maps each ward to its parent zone (used to stamp `zone` on new issues and to
power the cascading filter):

```json
{ "wardToZone": { "Ward 12": "Z-South", "Ward 13": "Z-South", "Ward 5": "Z-North" } }
```

- **Field officers** see/act on issues only in their assigned `wards`.
- **Zonal supervisors** see/act on every ward in their `zone` (with a per-ward rollup), and act as the next escalation tier for overdue field issues.
- **City administrators** see everything and manage the registry and database reset.

**Bootstrap (demo convenience):** until `config/roles` has any entries, choosing the **Staff** tab
on the login screen grants city-admin access in the UI so you can explore immediately. Note that
Firestore rules still treat an unregistered uid as a citizen, so persistent staff actions (status
changes, delete, purge) only work once you add your `uid` to `config/roles`. Find your `uid` in the
Firebase console → Authentication.

## How to Run

1. Clone the repository.
2. Create a `.env.local` file in the root directory (do not commit this file).
3. Add your Google Maps API Key: `GOOGLE_MAPS_PLATFORM_KEY="your_maps_key"`
4. Add your Gemini API Key: `GEMINI_API_KEY="your_gemini_key"`
5. Install dependencies: `npm install`
6. Start the development server: `npm run dev`

## How to Test

1. **Report (Citizen):** sign in as a Citizen, capture/upload a photo, confirm the exact location pin (drag, tap the map, search, or "Use my GPS"), and submit. The AI pipeline animates through triage → routing → dedup → priority.
2. **Map + community:** open the map, filter by category or by **City → Ward**, tap a marker to open the sheet, and add a comment. Try to upvote your **own** report — it's blocked; upvote someone else's — it works.
3. **Counts stay in sync:** note your report count/points in the header and Impact Dashboard. As a city admin, **Purge** all reports, then file 2 new ones — the header, dashboard, leaderboard, and staff archive all show **2** instantly (no drift).
4. **Hierarchy (Staff):** seed `config/roles` + `config/wards` (see above). Sign in as a **field** officer — the archive and map actions are limited to your ward(s); a status change on an out-of-scope ward is denied. A **zonal** account sees the whole zone; **city** sees everything and is the only tier that can Purge.
5. **Resolve once:** as in-scope staff, open an issue → "Resolve Issue" → upload an "after" photo. Gemini verifies it, the status flips to Resolved exactly once, and the citizen sees the **Before / After** comparison + a status notification (top-right bell).

> Local AI/Maps require `GEMINI_API_KEY` and `GOOGLE_MAPS_PLATFORM_KEY` in `.env.local`. Without the Maps key the map degrades to a setup card; without the Gemini key the AI endpoints return an error (the rest of the app still works).
