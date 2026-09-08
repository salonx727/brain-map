"use client";

import { useState } from "react";
import { useBrain } from "@/lib/brain";
import { splitCitation } from "@/lib/graph";
import {
  createItemAction,
  deleteItemAction,
  updateItemStatusAction,
  updateItemTitleAction,
} from "@/app/actions/pm";
import type { BrainNode, Item } from "@/lib/types";
import EditableLine from "./EditableLine";

type Field = "todos" | "blockers" | "subs";

const EMPTY: Record<Field, string> = {
  todos: "Nothing to do here yet.",
  blockers: "Nothing is blocking this card.",
  subs: "No sub-nodes yet.",
};

/** pm_items has one kind column and this component edits two of its three lists. */
const ITEM_KIND: Partial<Record<Field, "todo" | "blocker">> = {
  todos: "todo",
  blockers: "blocker",
};

/* A list you read, not a form you edit. Rows carry a done mark, the line at
   reading size, and the citation that says where the item came from. */
export default function ListEditor({
  d,
  field,
  placeholder,
  title,
  onPromote,
}: {
  d: BrainNode;
  field: Field;
  placeholder: string;
  title?: string;
  onPromote?: (item: Item, index: number) => void;
}) {
  const { bump, persist } = useBrain();
  const [draft, setDraft] = useState("");

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
        const created = await createItemAction({ kind, title: text, nodeKey: d.id });
        entry.id = created.id;
        bump();
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
          <div key={item.id ?? i} className={"listrow" + (item.done ? " is-done" : "")}>
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
                    () => updateItemStatusAction(item.id as string, item.done ? "done" : "next_action"),
                    () => {
                      item.done = was;
                    },
                  );
                }}
              />
            ) : null}

            <div className="lbody">
              {item.canon ? (
                <div>{item.text}</div>
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
                    persist(() => updateItemTitleAction(item.id as string, next));
                  }}
                />
              )}
              {item.sec ? <div className="sub">{item.sec}</div> : null}
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

            {/* A canon item has no pm_items row to delete and would return on the next
                publish, so it is labelled rather than given a button that cannot work. */}
            {item.canon ? (
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
                    () => deleteItemAction(item.id as string),
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
    </div>
  );
}
