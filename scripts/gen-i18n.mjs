/**
 * One-time / on-demand UI translation generator.
 *
 * Extracts every <T>…</T> and tr("…") string from src/ and translates them into
 * Hindi + Kannada using a FREE, keyless machine-translation endpoint (Google's
 * public translate_a). Writes src/locales/ui-hi.json and ui-kn.json, which the
 * app loads as a STATIC dictionary — so the running app does zero translation
 * calls (no LLM credits, instant, offline-friendly).
 *
 * Incremental: only translates keys not already present in the JSON files.
 * Run it again after you add new <T>/tr() strings:  node scripts/gen-i18n.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(SRC, "locales");
const LANGS = { hi: "ui-hi.json", kn: "ui-kn.json" };

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function extractStrings() {
  const set = new Set();
  const reT = /<T>([^<]+)<\/T>/g;
  const reTr = /\btr\("((?:[^"\\]|\\.)+)"\)/g;
  for (const f of walk(SRC)) {
    const s = fs.readFileSync(f, "utf8");
    let m;
    while ((m = reT.exec(s))) set.add(m[1].trim());
    while ((m = reTr.exec(s))) set.add(m[1].replace(/\\"/g, '"').trim());
  }
  return [...set].filter((x) => x.length > 1);
}

async function translate(text, code) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto" +
    `&tl=${code}&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const out = Array.isArray(data?.[0])
        ? data[0].map((seg) => (seg && seg[0]) || "").join("")
        : "";
      if (out.trim()) return out.trim();
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return text; // fail open
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const strings = extractStrings();
  console.log(`Found ${strings.length} unique UI strings.`);
  for (const [code, file] of Object.entries(LANGS)) {
    const fp = path.join(OUT, file);
    const dict = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : {};
    const missing = strings.filter((s) => !(s in dict));
    console.log(`[${code}] ${missing.length} new strings to translate…`);
    let done = 0;
    // small concurrency pool
    const POOL = 6;
    for (let i = 0; i < missing.length; i += POOL) {
      const batch = missing.slice(i, i + POOL);
      const results = await Promise.all(batch.map((s) => translate(s, code)));
      batch.forEach((s, j) => (dict[s] = results[j]));
      done += batch.length;
      if (done % 30 === 0 || done === missing.length)
        console.log(`[${code}] ${done}/${missing.length}`);
    }
    // stable sorted output
    const sorted = Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
    fs.writeFileSync(fp, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`[${code}] wrote ${Object.keys(sorted).length} entries → ${path.relative(ROOT, fp)}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
