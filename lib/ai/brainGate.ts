// The lock on the BRAIN engine, and only on the BRAIN engine.
//
// The map is deliberately public — anyone with the URL can open it, read the graph, and
// edit the PM layer. That is Shawn's ruling and this file does not touch it. What it does
// gate is the one door that leads somewhere else: BRAIN is not a chat box, it is the
// CommandOS agent on Shawn's machine, with the vault, the workspace and Bash. Public Bash
// on a page with no login would hand that machine to every visitor, so the panel asks for
// a passphrase once and remembers it.
//
// Reads are gated as hard as writes, and that is not belt-and-braces. Threads here are
// global — latestOrNewThread returns the most recent thread on the whole deployment, not
// one per browser — so an answer that quoted a secret would otherwise be readable by the
// next visitor who opened the panel. The transcript is as sensitive as the prompt.
//
// Unset BRAIN_PASSPHRASE means no gate, which is the right default for the local map:
// localhost is already only reachable by the person sitting at the machine, and the
// origin allowlist in the workspace .env is the boundary that matters there.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "brain_unlock";
const DAYS = 30;

/** Deliberately versioned: bump it and every existing cookie stops verifying. */
const TOKEN_PURPOSE = "brain-unlock-v1";

function secret(): string {
  return process.env.BRAIN_PASSPHRASE?.trim() ?? "";
}

/** Whether this deployment has a passphrase at all. No passphrase, no gate. */
export function brainGateConfigured(): boolean {
  return secret().length > 0;
}

/**
 * What we store instead of the passphrase.
 *
 * An HMAC rather than the passphrase itself, so the secret never comes to rest in a
 * cookie jar, a proxy log, or a browser profile backup. httpOnly stops scripts reading
 * it; deriving it stops it being worth reading.
 */
function token(): string {
  return createHmac("sha256", secret()).update(TOKEN_PURPOSE).digest("hex");
}

function sameToken(got: string): boolean {
  const want = token();
  // timingSafeEqual throws on a length mismatch, so the cheap check has to come first.
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** True when this browser has already answered, or when no passphrase is configured. */
export async function brainUnlocked(): Promise<boolean> {
  if (!brainGateConfigured()) return true;
  const jar = await cookies();
  return sameToken(jar.get(COOKIE)?.value ?? "");
}

/** Throws rather than returning a value, so a forgotten check is a failure, not a leak. */
export async function requireBrainUnlocked(): Promise<void> {
  if (await brainUnlocked()) return;
  throw new Error("BRAIN is locked. Enter the passphrase to reach CommandOS.");
}

/**
 * Checks a passphrase and, if it is right, remembers it on this browser.
 *
 * The wrong-answer delay is the only brake here. A counter would be theatre on serverless
 * — instances are not shared, so an attacker gets a fresh allowance every cold start —
 * and it would read as protection that is not there. The real defence is a passphrase
 * long enough that a few attempts per second never gets anywhere.
 */
export async function openBrainGate(attempt: string): Promise<boolean> {
  if (!brainGateConfigured()) return true;

  const offered = createHmac("sha256", attempt.trim()).update(TOKEN_PURPOSE).digest("hex");
  if (!sameToken(offered)) {
    await new Promise((r) => setTimeout(r, 400));
    return false;
  }

  const jar = await cookies();
  jar.set(COOKIE, token(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DAYS * 24 * 60 * 60,
  });
  return true;
}

/** Forgets the passphrase on this browser. */
export async function closeBrainGate(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
