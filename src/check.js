// Core check: does any non-public env value show up in the browser build output?
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
// Where Next.js puts browser code: .next/static for `next build`, out/ for static export.
export const CLIENT_DIRS = [".next/static", "out"];
// ponytail: shorter values are too common to match safely; ceiling = false negatives on short secrets.
export const MIN_LENGTH = 8;

// Result: { scannedFiles, scannedDirs: string[], leaks: {key, file}[], publicKeys: string[] }
// publicKeys = NEXT_PUBLIC_ values found in the bundle: expected, not a failure.

// ponytail: one line per variable, like dotenv. A value that spans lines is not joined, so it is not matched. Upgrade: join lines until the closing quote.
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const quoted = m[2].trim().match(/^(["'`])(.*?)\1(\s+#.*)?$/);
    let v = quoted ? quoted[2] : m[2].trim().replace(/\s+#.*$/, "").replace(/^["'`]/, ""); // an unclosed quote is dropped, so it cannot hide the value
    if (quoted?.[1] === '"') v = v.replace(/\\n/g, "\n"); // dotenv expands \n in double quotes
    out[m[1]] = v;
  }
  return out;
}

// Every file's pairs, not the merged result: a value that a later file overrides can still be in the build.
export function loadEnv(projectDir) {
  const pairs = [];
  for (const name of ENV_FILES) {
    const path = join(projectDir, name);
    if (existsSync(path)) pairs.push(...Object.entries(parseEnv(readFileSync(path, "utf8"))));
  }
  return pairs;
}

// Follows symlinks. `seen` stops a loop. A dangling link throws, so the run exits 2 instead of passing.
function walk(dir, files = [], seen = new Set()) {
  const real = realpathSync(dir);
  if (seen.has(real)) return files;
  seen.add(real);
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files, seen);
    else if (st.isFile()) files.push(p);
  }
  return files;
}

// Non-ASCII as JS escapes, per UTF-16 unit. wide=true: \xNN below 256 (SWC style), else \uNNNN.
function escapeNonAscii(s, wide) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) out += s[i];
    else if (wide && c < 256) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += "\\u" + c.toString(16).padStart(4, "0");
  }
  return out;
}

export function checkBuild(projectDir, pairs, clientDirs = CLIENT_DIRS) {
  const scannedDirs = clientDirs.filter((d) => existsSync(join(projectDir, d)));
  const result = { scannedFiles: 0, scannedDirs, leaks: [], publicKeys: [] };
  const needles = pairs
    .filter(([, v]) => v.length >= MIN_LENGTH)
    .flatMap(([key, v]) => {
      // the raw value, its JS string-literal form (a quote or backslash is escaped in the bundle),
      // and the minifier's \xNN / \uNNNN form of non-ASCII text (Next's SWC writes "ü" as \xfc).
      const forms = new Set([v, JSON.stringify(v).slice(1, -1), escapeNonAscii(v, true), escapeNonAscii(v, false)]);
      return [...forms].map((text) => ({ key, text, isPublic: key.startsWith("NEXT_PUBLIC_") }));
    });

  for (const dir of scannedDirs) {
    for (const file of walk(join(projectDir, dir))) {
      result.scannedFiles++;
      const content = readFileSync(file, "utf8");
      const rel = file.slice(projectDir.length + 1);
      for (const n of needles) {
        if (!content.includes(n.text)) continue;
        if (n.isPublic) {
          if (!result.publicKeys.includes(n.key)) result.publicKeys.push(n.key);
        } else if (!result.leaks.some((l) => l.key === n.key && l.file === rel)) {
          result.leaks.push({ key: n.key, file: rel });
        }
      }
    }
  }
  return result;
}
