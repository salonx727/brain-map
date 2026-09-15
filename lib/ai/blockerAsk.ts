import type { BrainNode, Item } from "@/lib/types";

/**
 * The draft that lands in the hub composer when someone taps a blocker or a to-do.
 *
 * Not sent automatically — Shawn (or anyone) still hits SEND. What this removes is only
 * the mechanical part: naming the card and the line so the brain is asked about that
 * specific item, not asked to guess which one.
 *
 * Shawn, 2026-09-12: wanted the same walk-through on TO DO he already had on BLK — the
 * blocker-handoff package's 326 items landed as TO DO (BLK stays canon-only, LOCK from
 * 2026-09-11), and "blocker" in the wording would have been wrong for a to-do that isn't
 * one. "Item" reads correctly for both without knowing which list it came from.
 */
export function blockerAskDraft(card: BrainNode, item: Item): string {
  const where = [card.ref, card.name].filter(Boolean).join(" ").trim() || card.id;
  const cite = item.sec ? `\nCited: ${item.sec}` : "";
  return [
    `This item is on ${where} (${card.id}):`,
    "",
    item.text.trim(),
    cite,
    "",
    "Tell me in detail what this is, why it exists, what COYOTE and the vault say about it, and what has to happen to clear it.",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();
}
