/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight, dependency-free profanity moderation for community comments.
 *
 * Two-tier, rule-based (no network call — instant, offline):
 *  - MASK_LIST  → common profanity. The comment is still posted, but the words
 *                 are masked with asterisks.
 *  - BLOCK_LIST → severe slurs / hate terms. The comment is rejected outright.
 *
 * Matching normalises common "leetspeak" (e.g. @→a, 3→e, 0→o, $→s) and matches
 * whole tokens, so innocent words like "class", "assistant", "grass" are never
 * flagged (avoids the "Scunthorpe problem"). Severe slurs are also matched as a
 * collapsed substring so they can't be slipped through with spacing/punctuation.
 */

// Tier 1 — masked, but the comment still posts.
const MASK_LIST: string[] = [
  "fuck",
  "fuk",
  "fuc",
  "fck",
  "fack",
  "fcuk",
  "fok",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "arsehole",
  "dick",
  "dickhead",
  "prick",
  "cock",
  "pussy",
  "slut",
  "whore",
  "douche",
  "wanker",
  "twat",
  "jackass",
  "dumbass",
  "bollocks",
  "crap",
  "piss",
];

// Tier 2 — rejected entirely (severe slurs / hate terms).
const BLOCK_LIST: string[] = [
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "chink",
  "spic",
  "kike",
  "tranny",
  "cunt",
  "coon",
  "paki",
];

const MASK_SET = new Set(MASK_LIST);
const BLOCK_SET = new Set(BLOCK_LIST);

/** Normalise leetspeak + casing so obfuscated words still match. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[8]/g, "b")
    .replace(/\+/g, "t");
}

/** Letters-only form of a single token (for set lookups). */
function letters(token: string): string {
  return normalize(token).replace(/[^a-z]/g, "");
}

/**
 * True if the text contains a BLOCK-tier slur (whole word, or collapsed
 * substring for hate terms that are often spaced/obfuscated).
 */
export function containsBlocked(text: string): boolean {
  if (!text) return false;
  const norm = normalize(text);
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (BLOCK_SET.has(w)) return true;
  }
  const collapsed = norm.replace(/[^a-z]/g, "");
  for (const slur of BLOCK_LIST) {
    if (collapsed.includes(slur)) return true;
  }
  return false;
}

/**
 * Masks MASK-tier profanity with asterisks, preserving the original spacing and
 * punctuation. (BLOCK-tier terms are handled separately by containsBlocked.)
 */
export function maskProfanity(text: string): string {
  if (!text) return text;
  return text.replace(/\S+/g, (token) => {
    const core = letters(token);
    if (core && MASK_SET.has(core)) {
      return "*".repeat(token.length);
    }
    return token;
  });
}

export interface ModerationResult {
  ok: boolean; // false → reject the comment
  text: string; // masked text to post when ok === true
  reason?: string; // shown to the user when rejected
}

/**
 * Moderates a comment: rejects severe slurs, masks ordinary profanity.
 */
export function moderateComment(text: string): ModerationResult {
  if (containsBlocked(text)) {
    return {
      ok: false,
      text,
      reason:
        "This comment contains hate speech or a slur and can't be posted. Please rephrase respectfully.",
    };
  }
  return { ok: true, text: maskProfanity(text) };
}
