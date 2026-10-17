# Changelog

## 0.1.0 (unreleased)

First release.

- `nextleak-check [projectDir]`: after `next build`, checks `.next/static` and `out/` for the values of non-`NEXT_PUBLIC_` variables in `.env`, `.env.local`, `.env.production` and `.env.production.local`.
- Exit 0 when clean, 1 when a value is in the build (variable name and file printed, value never printed), 2 when there is nothing to check, a file cannot be read, or more than one folder is given.
- Fixed before release: symlinked files and folders in the build are scanned; dotted and dashed names are read; backtick-quoted values match; a value overridden in a later env file is still checked; a value with a quote or backslash matches its escaped form; an unclosed quote in `.env` does not hide the value; `\n` in double quotes is expanded; an unreadable `.env` exits 2 with one line, not a stack trace; a non-ASCII value written as `\xNN` or `\uNNNN` escapes in the bundle (what Next's minifier emits) is matched; a second folder on the command line is a usage error (exit 2), not a silent skip.
