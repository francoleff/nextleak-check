"use client";
import { config } from "../lib/shared";

// Both server values are used by the client page, so both reach the browser bundle.
export default function Page() {
  return <p>{config.dbPassword && config.stripeKey ? "ready" : "missing"}</p>;
}
