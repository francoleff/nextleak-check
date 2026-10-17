#!/usr/bin/env node
// nextleak-check [projectDir]. Exit 0 = clean, 1 = secret in browser build, 2 = nothing to check or usage error.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBuild, loadEnv } from "./check.js";

export function run(args, cwd, log = console.log) {
  if (args.includes("-h") || args.includes("--help")) {
    log("Usage: nextleak-check [projectDir]\nRun after `next build`. Fails if a non-NEXT_PUBLIC_ value from your .env files is in the browser build.");
    return 0;
  }
  // One folder per run. A second folder would be skipped without a word, so it is a usage error.
  if (args.length > 1) {
    log("nextleak-check: give one project folder, or none. Usage: nextleak-check [projectDir]");
    return 2;
  }
  const dir = resolve(cwd, args[0] ?? ".");
  // ponytail: one catch for any read error; prints the error code only (no path, no content) so a broken setup exits 2, never looks like a leak (1).
  let r;
  try {
    r = checkBuild(dir, loadEnv(dir));
  } catch (e) {
    log(`nextleak-check: could not read files in ${dir} (${e.code ?? "error"}). Check file permissions and symlinks, then run again.`);
    return 2;
  }
  if (r.scannedDirs.length === 0 || r.scannedFiles === 0) {
    log("nextleak-check: no browser build found in .next/static or out/. Run your build first, then check again.");
    return 2;
  }
  if (r.leaks.length > 0) {
    log(`FAIL: ${r.leaks.length} secret value(s) from your env files are in the browser build (values not shown):`);
    for (const l of r.leaks) log(`  ${l.key} in ${l.file}`);
    log("Fix: keep that variable server-only (drop NEXT_PUBLIC_ if present), rebuild, rotate the key.");
    return 1;
  }
  log(`OK: scanned ${r.scannedFiles} files in ${r.scannedDirs.join(", ")}. No non-public env value found in the browser build.`);
  if (r.publicKeys.length > 0) log(`Public NEXT_PUBLIC_ values seen in the build (expected): ${r.publicKeys.join(", ")}`);
  return 0;
}

// realpath: the npm bin is a symlink, so compare resolved paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2), process.cwd());
}
