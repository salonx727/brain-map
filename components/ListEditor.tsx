"use client";

import { useState } from "react";
import { useBrain } from "@/lib/brain";
import { splitCitation } from "@/lib/graph";
import {
  assignCanonBlockerAction,
  createItemAction,
  deleteItemAction,
  updateItemStatusAction,
  updateItemTitleAction,
} from "@/app/actions/pm";
import { isOwnerKey, itemFingerprint, otherOwnerKey } from "@/lib/owners";
import type { BrainNode, Item } from "@/lib/types";
import EditableLine from "./EditableLine";

type Field = "todos" | "blockers" | "subs";

const EMPTY: Record<Field, string> = {
  todos: "Nothing to do here yet.",
  blockers: "Nothing in COYOTE is blocking this card.",
  subs: "No sub-nodes yet.",
};

/** Only TO DO writes to pm_items. BLK is COYOTE, read-only. */
const ITEM_KIND: Partial<Record<Field, "todo">> = {
  todos: "todo",
};

/* A list you read, not a form you edit. Rows carry a done mark, the line at
   reading size, and the citation that says where the item came from. */
export default function ListEditor({
  d,
  field,
  placeholder,
  title,
  onPromote,
  onAsk,
}: {
  d: BrainNode;
  field: Field;
  placeholder: string;
  title?: string;
  onPromote?: (item: Item, index: number) => void;
  onAsk?: (item: Item) => void;
}) {
  const { bump, persist, refreshNodeLists, model } = useBrain();
  const [draft, setDraft] = useState("");
  const canMove = field === "blockers" && isOwnerKey(d.id);

  const list = d[field];
  const kind = ITEM_KIND[field];

  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    const { text, sec } = splitCitation(v);
    setDraft("");

    if (!kind) {
      // subs are handled by the panel's own promote path, which creates a real PM node.
      d[field] = list.concat([{ text, done: false, sec }]);
      bump();
      return;
    }

    // Shown immediately without an id, then given the real one when the row exists. Until
    // then the row cannot be toggled or retitled, because there is nothing yet to address.
    const entry: Item = { text, done: false, sec };
    d[field] = list.concat([entry]);
    bump();

    persist(
      async () => {
        await createItemAction({ kind, title: text, nodeKey: d.id });
        // The list is whatever Supabase now holds for this card — not the optimistic row.
        await refreshNodeLists(d.id);
      },
      () => {
        d[field] = d[field].filter((x) => x !== entry);
      },
    );
  };

  return (
    <div className="sect">
      {title ? <div className="lab">{title}</div> : null}

      {!list.length ? (
        <div className="none">{EMPTY[field]}</div>
      ) : (
        list.map((item, i) => (
          <div
            key={item.id ?? i}
            className={"listrow" + (item.done ? " is-done" : "") + (onAsk ? " askable" : "")}
            onClick={(e) => {
              if (!onAsk) return;
              const hit = e.target as HTMLElement;
              // Edit, delete, and the done mark keep their own jobs. Everything else on
              // the row is the ask — that is the click the hub is listening for.
              if (hit.closest(".minus, .mark, [contenteditable], input, textarea, button.act")) return;
              onAsk(item);
            }}
          >
            {field === "todos" ? (
              <button
                className={"mark" + (item.done ? " done" : "")}
                aria-label={item.done ? "Mark not done" : "Mark done"}
                disabled={!item.id || item.canon}
                onClick={() => {
                  if (!item.id) return;
                  const was = item.done;
                  item.done = !was;
                  bump();
                  persist(
                    async () => {
                      await updateItemStatusAction(item.id as string, item.done ? "done" : "next_action");
                      await refreshNodeLists(d.id);
                    },
                    () => {
                      item.done = was;
                    },
                  );
                }}
              />
            ) : null}

            <div className="lbody">
              {item.canon || field === "blockers" ? (
                <div className="line">{item.text}</div>
              ) : (
                <EditableLine
                  text={item.text}
                  onInput={(value) => {
                    item.text = value;
                    bump();
                  }}
                  onBlur={() => {
                    if (!item.id) return;
                    const next = item.text.trim();
                    if (!next) return;
                    persist(async () => {
                      await updateItemTitleAction(item.id as string, next);
                      await refreshNodeLists(d.id);
                    });
                  }}
                />
              )}
              {item.sec ? <div className="sub">{item.sec}</div> : null}
              {/* TO DO keeps its own delete button (the right-side slot below), so ASK's
                  hint lives here instead of competing for that space — same walk-through
                  BLK already had, discoverable the same way: text says so, the row itself
                  is the tap target. */}
              {onAsk && field === "todos" ? <div className="sub">TAP TO ASK THE HUB</div> : null}
            </div>

            {field === "subs" && onPromote ? (
              <button
                className="act"
                title="Promote to its own card, wired to this one"
                onClick={() => onPromote(item, i)}
              >
                WIRE IT
              </button>
            ) : null}

            {canMove && item.sourceSection ? (
              <button
                className="act"
                title="Send this line to the other person. The line stays in COYOTE; only the card it sits on changes."
                onClick={() => {
                  const destId = otherOwnerKey(d.id);
                  const dest = model.nodes[destId];
                  if (!dest || !item.sourceSection) return;
                  const priorFrom = list.slice();
                  const priorTo = dest.blockers.slice();
                  d.blockers = list.filter((_, k) => k !== i);
                  dest.blockers = dest.blockers.concat([item]);
                  bump();
                  persist(
                    () =>
                      assignCanonBlockerAction({
                        fingerprint: itemFingerprint({
                          sourceSection: item.sourceSection as string,
                          qId: item.qId,
                          text: item.text,
                        }),
                        assignedTo: destId,
                        text: item.text,
                        sourceSection: item.sourceSection as string,
                        kind: item.canonKind ?? "blocker",
                      }),
                    () => {
                      d.blockers = priorFrom;
                      dest.blockers = priorTo;
                    },
                  );
                }}
              >
                {destIdLabel(d.id)}
              </button>
            ) : field === "blockers" ? (
              <span className="cap" title="Declared by COYOTE — tap the line to ask the hub">
                ASK
              </span>
            ) : item.canon ? (
              <span className="cap" title="Declared by COYOTE">
                CANON
              </span>
            ) : (
              <button
                className="minus"
                aria-label="Remove"
                onClick={() => {
                  const priorList = list.slice();
                  d[field] = list.filter((_, k) => k !== i);
                  bump();
                  if (!item.id) return; // never reached the database; nothing to delete
                    persist(
                      async () => {
                        await deleteItemAction(item.id as string);
                        await refreshNodeLists(d.id);
                      },
                      () => {
                        d[field] = priorList;
                      },
                    );
                }}
              >
                <span />
              </button>
            )}
          </div>
        ))
      )}

      {field === "blockers" ? (
        <div className="cap" style={{ marginTop: 12 }}>
          {canMove
            ? "FROM COYOTE · TAP A LINE TO ASK · MOVE SENDS IT TO THE OTHER PERSON"
            : "FROM COYOTE · TAP A LINE TO ASK THE HUB · NOTHING HERE IS TYPED"}
        </div>
      ) : (
        <div className="row addrow">
          <input
            className="f"
            value={draft}
            placeholder={placeholder + "   — end with §35.6 to cite it"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
          <button className="act" onClick={commit}>
            ADD
          </button>
        </div>
      )}
    </div>
  );
}

function destIdLabel(fromId: string): string {
  return fromId === "owner:shawn" ? "TO CODEMAN" : "TO SHAWN";
}
