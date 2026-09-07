"use client";

import { useState } from "react";
import { useBrain } from "@/lib/brain";
import { splitCitation } from "@/lib/graph";
import type { BrainNode, Item } from "@/lib/types";
import EditableLine from "./EditableLine";

type Field = "todos" | "blockers" | "subs";

const EMPTY: Record<Field, string> = {
  todos: "Nothing to do here yet.",
  blockers: "Nothing is blocking this card.",
  subs: "No sub-nodes yet.",
};

/** A save written before items carried a citation holds bare strings. */
function migrate(it: Item): Item {
  return typeof (it as unknown) === "string"
    ? { text: it as unknown as string, done: false, sec: "" }
    : it;
}

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
  const { bump, saveNow, saveSoon } = useBrain();
  const [draft, setDraft] = useState("");

  /* every item is stored as an object; older strings are migrated on read */
  d[field] = d[field].map(migrate);

  const list = d[field];

  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    const { text, sec } = splitCitation(v);
    d[field] = list.concat([{ text, done: false, sec }]);
    setDraft("");
    bump();
    saveNow();
  };

  return (
    <div className="sect">
      {title ? <div className="lab">{title}</div> : null}

      {!list.length ? (
        <div className="none">{EMPTY[field]}</div>
      ) : (
        list.map((item, i) => (
          <div key={i} className={"listrow" + (item.done ? " is-done" : "")}>
            {field === "todos" ? (
              <button
                className={"mark" + (item.done ? " done" : "")}
                aria-label={item.done ? "Mark not done" : "Mark done"}
                onClick={() => {
                  item.done = !item.done;
                  bump();
                  saveNow();
                }}
              />
            ) : null}

            <div className="lbody">
              <EditableLine
                text={item.text}
                onInput={(value) => {
                  item.text = value;
                  bump();
                  saveSoon();
                }}
                onBlur={saveNow}
              />
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

            <button
              className="minus"
              aria-label="Remove"
              onClick={() => {
                d[field] = list.filter((_, k) => k !== i);
                bump();
                saveNow();
              }}
            >
              <span />
            </button>
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
