// Plants fresh fake secrets for the leak test. Values are random every run, never committed.
// .env and lib/shared.js are gitignored. Canary values go to $TMPDIR (outside the repo) for the exposure grep.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const custom = "dbpass_" + randomBytes(18).toString("base64url"); // no standard key format
const stripe = "sk_test_" + randomBytes(18).toString("hex"); // Stripe test-key shape

writeFileSync(".env", `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nDB_PASSWORD=${custom}\nSTRIPE_SECRET_KEY=${stripe}\n`);
mkdirSync("lib", { recursive: true });
// The leak: the server values were pasted into a helper that a client component imports.
writeFileSync("lib/shared.js", `export const config = { dbPassword: "${custom}", stripeKey: "${stripe}" };\n`);
writeFileSync(join(process.env.TMPDIR || "/tmp", "nextleak-canaries.json"), JSON.stringify({ custom, stripe }, null, 2));
console.log("planted: 2 values (.env, lib/shared.js); canaries written outside the repo");
