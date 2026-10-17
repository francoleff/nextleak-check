import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBuild, parseEnv } from "../src/check.js";
import { run } from "../src/cli.js";

const SECRET = "FAKE_SERVER_SECRET_value1";
const PUBLIC = "pk_test_PUBLICVALUE99";

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "nextleak-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

function capture(args, dir) {
  const lines = [];
  const code = run(args, dir, (l) => lines.push(l));
  return { code, out: lines.join("\n") };
}

test("parseEnv reads quotes, export, comments and inline comments", () => {
  const env = parseEnv(`# comment\nexport A=1\nB="two words"\nC='x' # note\nD=plain # trailing\n`);
  assert.deepEqual(env, { A: "1", B: "two words", C: "x", D: "plain" });
});

test("a server secret inlined in the build fails with exit 1, value not printed", () => {
  const dir = project({
    ".env": `STRIPE_SECRET_KEY=${SECRET}\nNEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\n`,
    ".next/static/chunks/app.js": `const k="${SECRET}";`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /STRIPE_SECRET_KEY in .next\/static\/chunks\/app\.js/);
  assert.ok(!out.includes(SECRET), "secret value must never be printed");
});

test("a NEXT_PUBLIC_ value in the build is expected, exit 0", () => {
  const dir = project({
    ".env": `NEXT_PUBLIC_KEY=${PUBLIC}\n`,
    "out/index.html": `<script>${PUBLIC}</script>`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 0);
  assert.match(out, /Public NEXT_PUBLIC_ values seen.*NEXT_PUBLIC_KEY/);
});

test("clean build is OK, exit 0", () => {
  const dir = project({
    ".env": `STRIPE_SECRET_KEY=${SECRET}\n`,
    ".next/static/chunks/app.js": `console.log("hello");`,
  });
  assert.equal(capture([dir], dir).code, 0);
});

test("two folders on the command line is a usage error, exit 2, not a silent check of the first one", () => {
  const clean = project({ ".env": `NEXT_PUBLIC_URL=https://x.io\n`, ".next/static/chunks/app.js": `console.log("hello");` });
  const leak = project({ ".env": `DB_PASSWORD=${SECRET}\n`, ".next/static/chunks/app.js": `const k="${SECRET}";` });
  const { code, out } = capture([clean, leak], clean);
  assert.equal(code, 2, "the second folder must not be skipped with exit 0");
  assert.match(out, /one project folder/);
  assert.ok(!out.includes(SECRET), "secret value must never be printed");
});

test("no build output is exit 2, not a false pass", () => {
  const dir = project({ ".env": `STRIPE_SECRET_KEY=${SECRET}\n` });
  assert.equal(capture([dir], dir).code, 2);
});

test("values shorter than 8 characters are ignored", () => {
  const dir = project({
    ".env": `DEBUG=true\n`,
    ".next/static/chunks/app.js": `if (x === "true") {}`,
  });
  assert.equal(capture([dir], dir).code, 0);
});

test("unreadable env (a directory named .env) is exit 2 with a clear line, no stack trace", () => {
  const dir = project({ ".next/static/chunks/app.js": `console.log(1);` });
  mkdirSync(join(dir, ".env"));
  const { code, out } = capture([dir], dir);
  assert.equal(code, 2);
  assert.match(out, /could not read files/);
  assert.ok(!out.includes("at "), "no stack trace in output");
});

// Edge cases. Each one was a false pass or an unverified assumption before its fix.
test("parseEnv: CRLF lines, = inside values, dotted names, backtick quotes, \\n in double quotes", () => {
  assert.deepEqual(parseEnv(`A=one\r\nB="x=y=="\r\n`), { A: "one", B: "x=y==" });
  assert.deepEqual(parseEnv("my-api.key=abc\nBT=`tick value`\nPEM=\"a\\nb\"\n"), {
    "my-api.key": "abc",
    BT: "tick value",
    PEM: "a\nb",
  });
});

test("a CRLF .env still catches a leak, exit 1, no \\r in the match", () => {
  const dir = project({
    ".env": `STRIPE_SECRET_KEY=${SECRET}\r\nNEXT_PUBLIC_URL=https://x.supabase.co\r\n`,
    ".next/static/chunks/app.js": `const k="${SECRET}";`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /STRIPE_SECRET_KEY in .next\/static\/chunks\/app\.js/);
  assert.ok(!out.includes(SECRET));
});

test("a quoted value that contains = is matched in full", () => {
  const url = "postgres://app:pw=ABCDEFGH@db.internal/app";
  const dir = project({
    ".env": `DATABASE_URL="${url}"\n`,
    ".next/static/chunks/app.js": `const u="${url}";`,
  });
  assert.equal(capture([dir], dir).code, 1);
});

test("a secret that is a substring of a longer public value is reported (its bytes are in the build)", () => {
  const dir = project({
    ".env": `SERVER_SEGMENT=${SECRET}\nNEXT_PUBLIC_URL=https://x.io/${SECRET}/v1\n`,
    ".next/static/chunks/app.js": `const u="https://x.io/${SECRET}/v1";`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /SERVER_SEGMENT in .next\/static\/chunks\/app\.js/);
  assert.ok(!out.includes(SECRET));
});

test("a symlinked .next directory is scanned", () => {
  const elsewhere = project({ ".next/static/chunks/app.js": `const k="${SECRET}";` });
  const dir = project({ ".env": `STRIPE_SECRET_KEY=${SECRET}\n` });
  symlinkSync(join(elsewhere, ".next"), join(dir, ".next"));
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /STRIPE_SECRET_KEY in .next\/static\/chunks\/app\.js/);
});

test("a symlinked file inside the build is scanned, not skipped", () => {
  const outside = project({ "leak.js": `const k="${SECRET}";` });
  const dir = project({ ".env": `STRIPE_SECRET_KEY=${SECRET}\n`, ".next/static/chunks/ok.js": "console.log(1);" });
  symlinkSync(join(outside, "leak.js"), join(dir, ".next/static/chunks/linked.js"));
  assert.equal(capture([dir], dir).code, 1);
});

test("a symlinked folder inside the build is scanned, not skipped", () => {
  const outside = project({ "leak.js": `const k="${SECRET}";` });
  const dir = project({ ".env": `STRIPE_SECRET_KEY=${SECRET}\n`, ".next/static/chunks/ok.js": "console.log(1);" });
  symlinkSync(outside, join(dir, ".next/static/linked-dir"));
  assert.equal(capture([dir], dir).code, 1);
});

test("a symlink loop inside the build ends, and the real files still count", () => {
  const dir = project({ ".env": `STRIPE_SECRET_KEY=${SECRET}\n`, ".next/static/chunks/app.js": `const k="${SECRET}";` });
  symlinkSync("..", join(dir, ".next/static/chunks/back"));
  assert.equal(capture([dir], dir).code, 1);
});

test("a dangling symlink inside the build is exit 2, not a silent pass", () => {
  const dir = project({ ".env": `STRIPE_SECRET_KEY=${SECRET}\n`, ".next/static/chunks/ok.js": "console.log(1);" });
  symlinkSync(join(dir, "gone.js"), join(dir, ".next/static/chunks/dangling.js"));
  const { code, out } = capture([dir], dir);
  assert.equal(code, 2);
  assert.match(out, /could not read files/);
});

test("a dotted or dashed env name is checked", () => {
  const dir = project({ ".env": `my-api.token=${SECRET}\n`, ".next/static/chunks/app.js": `const k="${SECRET}";` });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /my-api\.token in/);
});

test("a backtick-quoted value is unquoted before matching", () => {
  const dir = project({ ".env": "DB_PASSWORD=`" + SECRET + "`\n", ".next/static/chunks/app.js": `const k="${SECRET}";` });
  assert.equal(capture([dir], dir).code, 1);
});

test("an unclosed quote in .env does not hide the value", () => {
  const dir = project({
    ".env": `DB_PASSWORD="${SECRET}\n`,
    ".next/static/chunks/app.js": `const k = \`${SECRET}\`;`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.ok(!out.includes(SECRET));
});

test("a value overridden in .env.local is still checked (the shadowed .env value can be in the build)", () => {
  const dir = project({
    ".env": `API_TOKEN=${SECRET}\n`,
    ".env.local": "API_TOKEN=another_value_9999\n",
    ".next/static/chunks/app.js": `const k="${SECRET}";`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /API_TOKEN in/);
});

test("a value with a quote or backslash is also matched in its escaped JS string form", () => {
  const pw = 'ab"cd\\ef-GHIJ';
  const dir = project({
    ".env": `DB_PASSWORD=${pw}\n`,
    ".next/static/chunks/app.js": `const k = ${JSON.stringify(pw)};`,
  });
  assert.equal(capture([dir], dir).code, 1);
});

test("a non-ASCII value written as \\xNN and \\uNNNN escapes in the bundle is still matched", () => {
  const pw = "pässwörd-çé-Ünïcode-4417"; // Next's SWC wrote this as \xdcn\xefcode in a real build
  const dir = project({
    ".env": `BACKUP_NODE=${pw}\n`,
    ".next/static/chunks/app.js": `var a="p\\xe4ssw\\xf6rd-\\xe7\\xe9-\\xdcn\\xefcode-4417";var b="\\u00e4\\u20ac";`,
    ".next/static/chunks/b.js": `var c="p\\u00e4ssw\\u00f6rd-\\u00e7\\u00e9-\\u00dcn\\u00efcode-4417";`,
  });
  assert.equal(capture([dir], dir).code, 1);
});

test("a ${VAR} composed value leaks through its part: the expanded URL carries DB_PASS's own value", () => {
  const dbPass = randomBytes(15).toString("base64url"); // 20 characters
  const dir = project({
    ".env": `DB_PASS=${dbPass}\nDB_URL=postgres://u:\${DB_PASS}@h/db\n`,
    ".next/static/chunks/app.js": `const url = "postgres://u:${dbPass}@h/db";`,
  });
  const { code, out } = capture([dir], dir);
  assert.equal(code, 1);
  assert.match(out, /DB_PASS in .next\/static\/chunks\/app\.js/);
  assert.ok(!out.includes(dbPass), "part value must never be printed");
});

test("a multi-line PEM-style value written with \\n escapes is matched against real newlines in the build", () => {
  const key = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----";
  const dir = project({
    ".env": `SERVICE_PRIVATE_KEY="${key.replace(/\n/g, "\\n")}"\n`,
    ".next/static/chunks/app.js": "const k = `" + key + "`;",
  });
  assert.equal(capture([dir], dir).code, 1);
});

