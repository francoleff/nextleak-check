# nextleak-check

After `next build`, one command tells you whether any value from your `.env` files, other than `NEXT_PUBLIC_` ones, is in the browser code. It compares the real values, not only the variable names. It never prints a value.

Next.js copies `NEXT_PUBLIC_` variables into the browser bundle at build time. A server secret can get there too: someone renames a variable to make an import work, or pastes a key into a helper that a client component imports. Nothing errors, the page works, and the key is now in a file anyone can download.

I wrote this to catch that case. It reads the non-public values from your `.env` files and searches the build output (`.next/static` and `out/`) for them.

## Install

    npm install -g github:francoleff/nextleak-check

Requires Node 24. No dependencies.

## Quick start

    cd your-next-app
    npm run build
    nextleak-check

Output from a build with two server values in it (a real run of the example app, see Development and testing):

    FAIL: 2 secret value(s) from your env files are in the browser build (values not shown):
      DB_PASSWORD in .next/static/chunks/app/page-505e28d3eaaf1527.js
      STRIPE_SECRET_KEY in .next/static/chunks/app/page-505e28d3eaaf1527.js
    Fix: keep that variable server-only (drop NEXT_PUBLIC_ if present), rebuild, rotate the key.

Output from a clean build (no server values in it):

    OK: scanned 14 files in .next/static. No non-public env value found in the browser build.

## Usage

    nextleak-check [projectDir]

`projectDir` defaults to the current folder. Run it after a build. Give one folder at most: two or more is a usage error (exit 2), so no folder is skipped without a word.

| Exit code | Meaning |
|---|---|
| 0 | No non-public value found in the build. |
| 1 | A value was found. The variable name and file are printed, never the value. |
| 2 | Nothing to check (no `.next/static` or `out/`), a file could not be read, or more than one folder was given. |

Exit 2 means nothing was checked, so a missing build never passes silently.

## What it checks

- Env files: `.env`, `.env.local`, `.env.production`, `.env.production.local`. Every value in them is checked, including a value that a later file overrides.
- Build output: every file under `.next/static` and `out/`. Symlinks are followed.
- Values of 8 characters or more. Each value is matched as written and as a JavaScript string literal, so a quote or backslash in the value still matches.
- `NEXT_PUBLIC_` values are expected in the build. They are listed, not failed.

## Config

None. Version 0.1.0 has no flags and no config file.

## How it compares

One demo app. Measured 2026-10-15 at 10:03, before the 0.1.0 fixes, and re-run on the final code with the same input. The input: `.env` with `NEXT_PUBLIC_SUPABASE_URL` and `BACKUP_NODE=<random 26-char value>`, a shared helper that a client component imports, and no TOKEN, KEY, SECRET or PASSWORD in any name. `next build` exit 0. The value sits in one file under `.next/static/chunks/app/`.

- nextleak-check: exit 1, `FAIL: 1 secret value(s) ... BACKUP_NODE in .next/static/chunks/app/page-bc9d7587dfd1bfe8.js` at 10:03 (the file name changes with each build), value not printed. Same result on the re-run.
- gitleaks on `.next/static`: exit 0, 0 findings, in both runs. In an earlier run with a key named `dbPassword`, gitleaks did flag it, so it depends on names.
- Vercelsior 1.2.0 `project`: exit 2, posture 65/100, in both runs. Its console output never names `BACKUP_NODE`. At 10:03 its `.env` check did not flag `BACKUP_NODE`. On the re-run it flagged `BACKUP_NODE` in `.env` as a hardcoded secret. It does not read the build.

Honest scope: one app, neutral names, two runs of each tool. Vercelsior's `.env` check can flag a neutral-named value, so the claim here is about the build: nextleak-check compares your `.env` values with the browser build, and the other two tools do not. It is not a benchmark.

## Development and testing

    git clone https://github.com/francoleff/nextleak-check
    cd nextleak-check
    npm test

Tests use `node:test` and temporary folders. The package has no dependencies.

The example app in `examples/demo-app` plants fake secrets on purpose, so its check fails:

    cd examples/demo-app
    npm install
    npm run build
    cd ../..
    node src/cli.js examples/demo-app

Continuous integration runs `npm test` on Node 24 (`.github/workflows/ci.yml`).

## Limitations

- Only `.next/static` and `out/` are read. Prerendered HTML under `.next/server` is not.
- Only `.env*` files are read. Values set in the shell or in CI are not checked.
- A value stored under a `NEXT_PUBLIC_` name is treated as public, by design. A secret renamed with that prefix is not caught.
- Values under 8 characters are skipped.
- A composed value (`DB_URL=postgres://u:${DB_PASS}@h/db`) is caught through its parts: the expanded URL contains `DB_PASS`'s value. If every part is under 8 characters, the composed value is missed.
- A value that spans several lines in `.env` is not matched. Single-line values with `\n` escapes in double quotes are.
- Matching is by plain text: the raw value, its JS string form, and its `\xNN` / `\uNNNN` escapes for non-ASCII text. A value the build stores encoded (base64, or an ASCII character written as an escape like `\x3c`) is missed. UTF-16 output is not read.
- Matching is substring matching. A server value that appears inside a longer public value is reported, because its text is in the build.
- Tested on Node 24 only.

## Roadmap

- Scan prerendered HTML under `.next/server`, if people hit that gap.
- Read multi-line values in `.env`.

## License

MIT. See LICENSE.
