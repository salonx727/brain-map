// The gate is a security boundary, so the cases worth pinning are the ones where getting
// it wrong is silent: a cookie an attacker can forge, an unset passphrase that locks the
// local map out, a wrong answer that still opens the door.

import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { brainGateConfigured, brainUnlocked, closeBrainGate, openBrainGate, requireBrainUnlocked } = await import("./brainGate");

const PASS = "s9tm-52dz-r37t-tdme";

beforeEach(() => {
  jar.clear();
  process.env.BRAIN_PASSPHRASE = PASS;
});

describe("brainGate", () => {
  it("is open to everything when no passphrase is configured", async () => {
    delete process.env.BRAIN_PASSPHRASE;
    expect(brainGateConfigured()).toBe(false);
    await expect(brainUnlocked()).resolves.toBe(true);
    await expect(requireBrainUnlocked()).resolves.toBeUndefined();
  });

  it("treats a blank passphrase as no passphrase", async () => {
    process.env.BRAIN_PASSPHRASE = "   ";
    expect(brainGateConfigured()).toBe(false);
    await expect(brainUnlocked()).resolves.toBe(true);
  });

  it("starts locked once a passphrase is configured", async () => {
    expect(brainGateConfigured()).toBe(true);
    await expect(brainUnlocked()).resolves.toBe(false);
    await expect(requireBrainUnlocked()).rejects.toThrow(/locked/i);
  });

  it("opens on the right passphrase and stays open", async () => {
    await expect(openBrainGate(PASS)).resolves.toBe(true);
    await expect(brainUnlocked()).resolves.toBe(true);
    await expect(requireBrainUnlocked()).resolves.toBeUndefined();
  });

  it("tolerates whitespace around a pasted passphrase", async () => {
    await expect(openBrainGate(`  ${PASS}\n`)).resolves.toBe(true);
    await expect(brainUnlocked()).resolves.toBe(true);
  });

  it("refuses a wrong passphrase and leaves no cookie behind", async () => {
    await expect(openBrainGate("not-it")).resolves.toBe(false);
    expect(jar.size).toBe(0);
    await expect(brainUnlocked()).resolves.toBe(false);
  });

  it("never stores the passphrase itself", async () => {
    await openBrainGate(PASS);
    expect([...jar.values()].join("|")).not.toContain(PASS);
  });

  it("rejects a cookie the browser made up", async () => {
    jar.set("brain_unlock", "true");
    await expect(brainUnlocked()).resolves.toBe(false);

    // Right shape, wrong contents — the length check must not be the only check.
    jar.set("brain_unlock", "a".repeat(64));
    await expect(brainUnlocked()).resolves.toBe(false);
  });

  it("stops trusting a cookie once the passphrase changes", async () => {
    await openBrainGate(PASS);
    process.env.BRAIN_PASSPHRASE = "something-else-entirely";
    await expect(brainUnlocked()).resolves.toBe(false);
  });

  it("locks again on request", async () => {
    await openBrainGate(PASS);
    await closeBrainGate();
    await expect(brainUnlocked()).resolves.toBe(false);
  });
});
