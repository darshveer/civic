/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client-side translate-on-demand for CACHED / STORED text that was generated
 * (or written) in another language — e.g. a report description, a stored daily
 * briefing, or resolution notes. New AI output is already produced in the active
 * language at generation time; this layer covers text that already exists.
 *
 * Results are cached in localStorage (keyed by language + source) so a given
 * string is only translated once, and English is a no-op.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { aiLanguageName } from "../i18n";
// Pre-built static UI dictionaries (generated offline by scripts/gen-i18n.mjs
// via a FREE machine-translation endpoint). Bundled with the app → zero runtime
// translation calls for known UI strings, instant and offline.
import uiHi from "../locales/ui-hi.json";
import uiKn from "../locales/ui-kn.json";

const STATIC: Record<string, Record<string, string>> = {
  Hindi: uiHi as Record<string, string>,
  Kannada: uiKn as Record<string, string>,
};

const memCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function cacheKey(lang: string, text: string): string {
  // Keep the key bounded; localStorage values are small text snippets.
  return `civic_tr:${lang}:${text}`;
}

/** Pre-bundled static translation for a known UI string, or null. */
function staticTranslation(lang: string, src: string): string | null {
  return STATIC[lang]?.[src] ?? null;
}

/** Synchronous cache read (static dict → memory → localStorage). Null on miss. */
function cachedTranslation(lang: string, src: string): string | null {
  const stat = staticTranslation(lang, src);
  if (stat !== null) return stat;
  const key = cacheKey(lang, src);
  if (memCache.has(key)) return memCache.get(key)!;
  try {
    const ls = localStorage.getItem(key);
    if (ls) {
      memCache.set(key, ls);
      return ls;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Translate `text` into the active UI language (no-op for English). */
export async function translateText(text: string): Promise<string> {
  const src = (text || "").trim();
  const lang = aiLanguageName();
  if (!src || lang === "English") return text;

  const hit = cachedTranslation(lang, src);
  if (hit !== null) return hit;

  const key = cacheKey(lang, src);
  // Dedupe concurrent requests for the same string (common when many identical
  // labels render at once).
  if (inflight.has(key)) return inflight.get(key)!;

  const p = (async () => {
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: src, language: lang }),
      });
      const data = await res.json();
      const out = (data && data.text) || text;
      memCache.set(key, out);
      try {
        localStorage.setItem(key, out);
      } catch {
        /* ignore quota */
      }
      return out;
    } catch {
      return text; // fail open
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * Hook returning a synchronous `tr(text)` function for static UI strings.
 * Reads from cache instantly; on a miss it returns the English original, kicks
 * off a background translation, and re-renders when it lands. Use it for both
 * text and attributes (placeholder/title/aria-label). English is a no-op.
 *
 *   const tr = useTr();
 *   <button>{tr("Submit")}</button>
 *   <input placeholder={tr("Search…")} />
 */
export function useTr(): (text: string) => string {
  const { i18n } = useTranslation();
  const [, bump] = useState(0);
  const lang = aiLanguageName();
  return useCallback(
    (text: string) => {
      const src = (text || "").trim();
      if (!src || lang === "English") return text;
      const hit = cachedTranslation(lang, src);
      if (hit !== null) return hit;
      translateText(src).then(() => bump((n) => n + 1));
      return text; // original until the translation arrives
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, i18n.language],
  );
}

/** Component form of useTr for inline JSX text: <T>Submit</T>. */
export function T({ children }: { children: string }) {
  const tr = useTr();
  return React.createElement(React.Fragment, null, tr(children));
}

/**
 * Hook: returns `text` translated into the active UI language. Re-runs when the
 * language changes. Shows the original until the translation arrives.
 */
export function useTranslated(text: string | undefined): string {
  const { i18n } = useTranslation();
  const [out, setOut] = useState<string>(text || "");

  useEffect(() => {
    let cancelled = false;
    setOut(text || "");
    if (!text || aiLanguageName() === "English") return;
    translateText(text).then((t) => {
      if (!cancelled) setOut(t);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, i18n.language]);

  return out;
}
