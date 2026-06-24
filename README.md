# Civic Connect

A modern, gamified civic engagement platform that connects citizens directly with city administration.

## Features

- **AI-Powered Triaging**: Upload a photo of a civic issue, and the Gemini-powered agent will automatically categorize, assign severity, and route it to the correct department.
- **Location Context**: Built with Google Maps Platform, including Geocoding for accurate addresses, Places API for nearby context, and clustered issue mapping.
- **Smart Assignment & Deduplication**: Groups similar issues together using radius-based and semantic corroboration.
- **Gamification**: Earn civic points, climb the global and ward leaderboards, and unlock badges for being an active participant in your community.
- **Real-Time Updates**: Get in-app notifications when the status of your reported issues changes.
- **Community Interaction**: Upvote, corroborate, and comment on local issues.

## Tech Stack

- **Frontend**: React, Tailwind CSS
- **Mapping**: Google Maps Platform (Advanced Markers, Geocoding, Places API)
- **Backend/Database**: Firebase Firestore (Real-time NoSQL)
- **Authentication**: Firebase Auth (Google Sign-In)
- **AI/ML**: Gemini Pro for text & image analysis
- **Hosting**: Designed to be deployed via **Firebase Hosting**

## Future Extensions

- **Google Cloud Vision / Vertex AI**: Can be enabled behind environment flags for advanced image moderation, deep fake detection, or structural damage analysis prior to human review.
- **Firebase Cloud Messaging (FCM)**: Native push notifications for mobile clients.

## Security & Hygiene

- **Firebase Config is Public**: The `firebase-applet-config.json` file contains your Firebase web API keys. This is **safe to commit** and expose in the browser. Security for Firebase comes from the `firestore.rules` and key restrictions, not by hiding the API key.
- **API Keys**: The ONLY real secrets are your `GEMINI_API_KEY` and `GOOGLE_MAPS_PLATFORM_KEY`. These belong in your `.env.local` file (which is gitignored) and must **NEVER** be hardcoded or committed to version control.
- **Google Maps API**: Restrict your Google Maps API key by HTTP referrer in the Google Cloud Console to prevent unauthorized usage on other domains.
- **Gemini API**: The Gemini API key is kept securely server-side and is never exposed to the client browser.
- **Firestore Rules**: Ensure you tighten your `firestore.rules` before production so that only authenticated users can write data, and only staff members can change the status or delete issues.

## How to Run

1. Clone the repository.
2. Create a `.env.local` file in the root directory (do not commit this file).
3. Add your Google Maps API Key: `GOOGLE_MAPS_PLATFORM_KEY="your_maps_key"`
4. Add your Gemini API Key: `GEMINI_API_KEY="your_gemini_key"`
5. Install dependencies: `npm install`
6. Start the development server: `npm run dev`

## How to Test

1. Open the app as a Citizen. Take a photo of a random object (or upload one) to report a "pothole" or "vandalism". Allow location access.
2. View your report on the map. Click it to see nearby context powered by Places API and add comments.
3. Check your Impact Dashboard for your points, badges, and the Ward Leaderboard.
4. Switch to Staff view via the top-right profile dropdown, go to the Kanban board, and drag the issue to "In Progress" or "Resolved".
5. Switch back to Citizen view and check the top-right Bell icon for a notification!
