/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App-wide internationalisation (i18next + react-i18next). Three languages:
 * English (en), Hindi (hi), Kannada (kn). The chosen language is persisted to
 * localStorage and ALSO drives the AI endpoints (via `aiLanguageName()`), so
 * Gemini replies in the same language the UI is showing.
 *
 * UI strings are migrated incrementally; any missing key falls back to English
 * (and then to the key itself), so the app never shows blanks.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export const SUPPORTED_LANGS = [
  { code: "en", label: "English", ai: "English" },
  { code: "hi", label: "हिन्दी", ai: "Hindi" },
  { code: "kn", label: "ಕನ್ನಡ", ai: "Kannada" },
] as const;

const en = {
  nav: {
    map: "Map",
    report: "Report",
    dashboard: "Dashboard",
    board: "Assignment Board",
    impact: "Impact",
    admin: "Admin",
    assistant: "Civic Assistant",
  },
  common: {
    cancel: "Cancel",
    submit: "Submit",
    save: "Save",
    close: "Close",
    loading: "Loading…",
    signOut: "Sign out",
  },
  auth: {
    signIn: "Sign In",
    register: "Create account",
    fullName: "Full Name",
    email: "Email Address",
    password: "Password",
    mobile: "Mobile Number",
    sendCode: "Send Verification Code",
    citizen: "Citizen",
    staff: "Staff",
    haveAccount: "Already have an account? Sign in",
    noAccount: "New here? Create an account",
  },
  report: {
    openCamera: "Open Camera",
    uploadImage: "Upload Image",
    describeInstead: "No photo? File a description-only report →",
    analyze: "Analyze with AI",
    submit: "Submit Report",
  },
  status: {
    resolved: "Resolved",
    escalated: "Escalated / Re-opened",
    inProgress: "In Progress",
  },
  actions: {
    meToo: "Me Too",
    upvoted: "Upvoted",
    resolveIssue: "Resolve Issue",
    corroborate: "Corroborate & Approve",
    approving: "Approving…",
    downloadReport: "Download resolution report (PDF)",
    escalate: "Not satisfied? Escalate to a higher authority",
  },
  comments: {
    title: "Comments",
    add: "Add a comment...",
    post: "Post",
    removed: "Comment removed",
  },
} as const;

// Hindi (high-traffic keys; missing keys fall back to English).
const hi = {
  nav: {
    map: "नक्शा",
    report: "शिकायत दर्ज करें",
    dashboard: "डैशबोर्ड",
    board: "असाइनमेंट बोर्ड",
    impact: "प्रभाव",
    admin: "एडमिन",
    assistant: "सिविक सहायक",
  },
  common: {
    cancel: "रद्द करें",
    submit: "जमा करें",
    save: "सहेजें",
    close: "बंद करें",
    loading: "लोड हो रहा है…",
    signOut: "साइन आउट",
  },
  auth: {
    signIn: "साइन इन",
    register: "खाता बनाएँ",
    fullName: "पूरा नाम",
    email: "ईमेल पता",
    password: "पासवर्ड",
    mobile: "मोबाइल नंबर",
    sendCode: "सत्यापन कोड भेजें",
    citizen: "नागरिक",
    staff: "कर्मचारी",
    haveAccount: "पहले से खाता है? साइन इन करें",
    noAccount: "नए हैं? खाता बनाएँ",
  },
  report: {
    openCamera: "कैमरा खोलें",
    uploadImage: "छवि अपलोड करें",
    describeInstead: "फ़ोटो नहीं है? केवल विवरण वाली शिकायत दर्ज करें →",
    analyze: "एआई से विश्लेषण करें",
    submit: "शिकायत जमा करें",
  },
  status: {
    resolved: "हल हो गया",
    escalated: "पुनः खोला गया",
    inProgress: "प्रगति पर",
  },
  actions: {
    meToo: "मैं भी",
    upvoted: "समर्थित",
    resolveIssue: "समस्या हल करें",
    corroborate: "पुष्टि करें और स्वीकृत करें",
    approving: "स्वीकृत किया जा रहा है…",
    downloadReport: "समाधान रिपोर्ट डाउनलोड करें (PDF)",
    escalate: "संतुष्ट नहीं हैं? उच्च अधिकारी को भेजें",
  },
  comments: {
    title: "टिप्पणियाँ",
    add: "एक टिप्पणी जोड़ें...",
    post: "पोस्ट करें",
    removed: "टिप्पणी हटाई गई",
  },
};

// Kannada.
const kn = {
  nav: {
    map: "ನಕ್ಷೆ",
    report: "ದೂರು ಸಲ್ಲಿಸಿ",
    dashboard: "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
    board: "ಅಸೈನ್‌ಮೆಂಟ್ ಬೋರ್ಡ್",
    impact: "ಪರಿಣಾಮ",
    admin: "ಆಡ್ಮಿನ್",
    assistant: "ಸಿವಿಕ್ ಸಹಾಯಕ",
  },
  common: {
    cancel: "ರದ್ದುಮಾಡಿ",
    submit: "ಸಲ್ಲಿಸಿ",
    save: "ಉಳಿಸಿ",
    close: "ಮುಚ್ಚಿ",
    loading: "ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
    signOut: "ಸೈನ್ ಔಟ್",
  },
  auth: {
    signIn: "ಸೈನ್ ಇನ್",
    register: "ಖಾತೆ ರಚಿಸಿ",
    fullName: "ಪೂರ್ಣ ಹೆಸರು",
    email: "ಇಮೇಲ್ ವಿಳಾಸ",
    password: "ಪಾಸ್‌ವರ್ಡ್",
    mobile: "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ",
    sendCode: "ಪರಿಶೀಲನಾ ಕೋಡ್ ಕಳುಹಿಸಿ",
    citizen: "ನಾಗರಿಕ",
    staff: "ಸಿಬ್ಬಂದಿ",
    haveAccount: "ಈಗಾಗಲೇ ಖಾತೆ ಇದೆಯೇ? ಸೈನ್ ಇನ್ ಮಾಡಿ",
    noAccount: "ಹೊಸಬರೇ? ಖಾತೆ ರಚಿಸಿ",
  },
  report: {
    openCamera: "ಕ್ಯಾಮೆರಾ ತೆರೆಯಿರಿ",
    uploadImage: "ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ",
    describeInstead: "ಫೋಟೋ ಇಲ್ಲವೇ? ವಿವರಣೆ-ಮಾತ್ರ ದೂರು ಸಲ್ಲಿಸಿ →",
    analyze: "AI ನಿಂದ ವಿಶ್ಲೇಷಿಸಿ",
    submit: "ದೂರು ಸಲ್ಲಿಸಿ",
  },
  status: {
    resolved: "ಪರಿಹರಿಸಲಾಗಿದೆ",
    escalated: "ಮರು-ತೆರೆಯಲಾಗಿದೆ",
    inProgress: "ಪ್ರಗತಿಯಲ್ಲಿದೆ",
  },
  actions: {
    meToo: "ನಾನೂ",
    upvoted: "ಬೆಂಬಲಿಸಲಾಗಿದೆ",
    resolveIssue: "ಸಮಸ್ಯೆ ಪರಿಹರಿಸಿ",
    corroborate: "ಖಚಿತಪಡಿಸಿ ಮತ್ತು ಅನುಮೋದಿಸಿ",
    approving: "ಅನುಮೋದಿಸಲಾಗುತ್ತಿದೆ…",
    downloadReport: "ಪರಿಹಾರ ವರದಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ (PDF)",
    escalate: "ತೃಪ್ತರಾಗಿಲ್ಲವೇ? ಉನ್ನತ ಅಧಿಕಾರಿಗೆ ಕಳುಹಿಸಿ",
  },
  comments: {
    title: "ಕಾಮೆಂಟ್‌ಗಳು",
    add: "ಕಾಮೆಂಟ್ ಸೇರಿಸಿ...",
    post: "ಪೋಸ್ಟ್ ಮಾಡಿ",
    removed: "ಕಾಮೆಂಟ್ ತೆಗೆದುಹಾಕಲಾಗಿದೆ",
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      kn: { translation: kn },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "hi", "kn"],
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "civic_lang",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

/** The full language NAME for the current UI language, for AI prompts. */
export function aiLanguageName(): string {
  const code = (i18n.language || "en").split("-")[0];
  return SUPPORTED_LANGS.find((l) => l.code === code)?.ai || "English";
}

export default i18n;
