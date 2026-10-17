# Contributing

- Run `npm test` before you open a pull request. CI runs the same command on Node 24.
- No runtime dependencies. If a change needs one, open an issue first.
- Each bug fix comes with a test that fails before the fix.
- Output must never contain a secret value, including on error paths. If you touch the output, add a test that checks it.
- Scope for 0.1.0: `.env*` files, `.next/static` and `out/`, value matching. Other frameworks and server-side scans are out of scope.
- To report a false pass (a leak the tool missed), open an issue with the smallest file layout that shows it. Use fake values only.
