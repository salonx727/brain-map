"use client";

import { useEffect, useRef, useState } from "react";
import { useBrain } from "@/lib/brain";
import { useIntake } from "@/lib/intake";
import { TAGS } from "@/lib/seed";
import {
  counts,
  freeSpot,
  hasLink,
  linksOf,
  namesFrom,
  otherEnd,
  sizeOf,
  totalItems,
} from "@/lib/graph";
import type { BrainNode } from "@/lib/types";
import ListEditor from "./ListEditor";

export default function ControlPanel({
  d,
  tab,
  setTab,
  onDismiss,
  onOpenCard,
  onShowOnField,
}: {
  d: BrainNode;
  tab: number | null;
  setTab: (t: number | null) => void;
  onDismiss: () => void;
  onOpenCard: (id: string, tab: number | null) => void;
  onShowOnField: (id: string) => void;
}) {
  const { model, bump, saveNow, saveSoon, addNode, removeNode, isEmpty } = useBrain();
  const intake = useIntake();

  const [wireTo, setWireTo] = useState("");
  const [over, setOver] = useState(false);
  const [addArmed, setAddArmed] = useState(false);
  const [delArmed, setDelArmed] = useState(false);
  const addTimer = useRef<number | null>(null);
  const delTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (addTimer.current) window.clearTimeout(addTimer.current);
      if (delTimer.current) window.clearTimeout(delTimer.current);
    };
  }, []);

  const c = counts(d);
  const mine = linksOf(model.links, d.id);
  const removable = isEmpty(d.id);

  let tally = "";
  if (tab === 1) {
    tally =
      d.todos.filter((x) => !x.done).length +
      " OPEN · " +
      d.todos.filter((x) => x.done).length +
      " DONE";
  } else if (tab === 2) {
    tally = d.blockers.length + (d.blockers.length === 1 ? " BLOCKER" : " BLOCKERS");
  } else if (tab === 4) {
    tally = d.subs.length + (d.subs.length === 1 ? " SUB-NODE" : " SUB-NODES");
  } else if (tab === 3) {
    tally = d.drops.length + " FILED";
  } else if (tab === 0) {
    tally = c[0] + " OF 4 SLOTS";
  }

  const disarmAdd = () => {
    setAddArmed(false);
    if (addTimer.current) window.clearTimeout(addTimer.current);
  };

  return (
    <div id="panel" role="dialog" aria-label="Node control surface">
      <div className="head">
        <div>
          <div className="eyebrow">
            {"CONTROL" +
              (d.sec === "held"
                ? " · OUTSIDE CANON"
                : d.sec && d.sec !== "—"
                  ? " · " + d.sec
                  : "")}
          </div>
          <div className="title">{d.name || d.ref}</div>
          {tally ? <div className="o-count">{tally}</div> : null}
        </div>
        <button className="dismiss" aria-label="Dismiss" onClick={onDismiss}>
          <span />
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <label style={{ width: 128 }}>
          <span className="lab">REF</span>
          <input
            className="f"
            value={d.ref}
            onChange={(e) => {
              d.ref = e.target.value;
              bump();
              saveSoon();
            }}
            onBlur={saveNow}
          />
        </label>
        <label style={{ flex: 1 }}>
          <span className="lab">NAME</span>
          <input
            className="f"
            value={d.name}
            placeholder="Blank keeps the ref"
            onChange={(e) => {
              d.name = e.target.value;
              bump();
              saveSoon();
            }}
            onBlur={saveNow}
          />
        </label>
      </div>

      <div className="strip">
        {TAGS.map((t, i) => (
          <button
            key={t.key}
            className={tab === i ? "on" : ""}
            onClick={() => setTab(tab === i ? null : i)}
          >
            {t.label + " " + c[i]}
          </button>
        ))}
      </div>

      {/* UI slots — a fixed array of 4 where slot_index matters, images only */}
      {tab === 0 ? (
        <div className="grid sect">
          {[0, 1, 2, 3].map((idx) => {
            const shot = d.screens[idx];
            return (
              <div className="slot" key={idx}>
                {shot && shot.data ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.data} alt={shot.name || "UI slot " + (idx + 1)} />
                    <button
                      className="slotbtn"
                      aria-label="Remove image"
                      onClick={() => {
                        const arr = d.screens.slice();
                        arr[idx] = null;
                        while (arr.length && arr[arr.length - 1] === null) arr.pop();
                        d.screens = arr;
                        bump();
                        saveNow();
                      }}
                    >
                      &minus;
                    </button>
                    <div className="cap">
                      {(shot.name || "").slice(0, 28) +
                        (shot.w ? "  " + shot.w + "×" + shot.h : "")}
                    </div>
                  </>
                ) : (
                  <button className="empty" onClick={() => intake.pickSlot(idx)}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                    <span>{"UI SLOT " + (idx + 1)}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === 1 ? <ListEditor d={d} field="todos" placeholder="Add a to-do" /> : null}
      {tab === 2 ? <ListEditor d={d} field="blockers" placeholder="Add a blocker" /> : null}

      {tab === 4 ? (
        <ListEditor
          d={d}
          field="subs"
          placeholder="Add a sub-node"
          onPromote={(item, i) => {
            const parent = d.id;
            const label = item.text;
            const spot = freeSpot(model.nodes, model.order, parent, "box");
            d.subs = d.subs.filter((_, k) => k !== i);
            addNode({ x: spot.x, y: spot.y, name: label, wireTo: parent });
            saveNow();
          }}
        />
      ) : null}

      {tab === 3 ? (
        <div className="sect">
          <div className="intake">
            <button onClick={() => intake.pickPhotos("node")}>
              <span className="plus">+</span>
              <span>PHOTOS</span>
            </button>
            <button onClick={() => intake.pickCamera("node")}>
              <span className="plus">+</span>
              <span>CAMERA</span>
            </button>
            <button onClick={() => intake.pickFiles("node")}>
              <span className="plus">+</span>
              <span>FILES</span>
            </button>
          </div>

          <div
            className={"dropzone" + (over ? " over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const names = namesFrom(e.dataTransfer);
              if (!names.length) return;
              d.drops = d.drops.concat(names.map((n) => ({ name: n, size: null, data: null })));
              bump();
              saveNow();
            }}
          >
            Or drop content here
          </div>

          {!d.drops.length ? (
            <div className="none">Nothing filed yet.</div>
          ) : (
            d.drops.map((f, i) => (
              <div className="item file" key={i}>
                {f.data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={f.data} alt={f.name} />
                ) : null}
                <div style={{ flex: 1 }}>
                  <div>{f.name}</div>
                  {f.size ? (
                    <div className="meta">
                      {sizeOf(f.size) +
                        (f.data ? " · image held in session" : " · filename recorded")}
                    </div>
                  ) : null}
                </div>
                <button
                  className="minus"
                  aria-label="Remove"
                  onClick={() => {
                    d.drops = d.drops.filter((_, k) => k !== i);
                    bump();
                    saveNow();
                  }}
                >
                  <span />
                </button>
              </div>
            ))
          )}

          <div className="cap">HELD IN THIS SESSION ONLY · NOTHING IS UPLOADED</div>
        </div>
      ) : null}

      {tab === 4 ? (
        <div className="sect">
          <div className="row">
            <select
              className="f"
              value={wireTo}
              onChange={(e) => setWireTo(e.target.value)}
            >
              <option value="">Wire to…</option>
              {model.order
                .filter((oid) => oid !== d.id && !hasLink(model.links, d.id, oid))
                .map((oid) => (
                  <option value={oid} key={oid}>
                    {model.nodes[oid].name || model.nodes[oid].ref}
                  </option>
                ))}
            </select>
            <button
              className="act"
              onClick={() => {
                if (!wireTo) return;
                model.links.push({ a: d.id, b: wireTo });
                setWireTo("");
                bump();
                saveNow();
              }}
            >
              WIRE
            </button>
          </div>

          {!mine.length ? (
            <div className="none">Not wired to anything.</div>
          ) : (
            mine.map((l, i) => {
              const other = model.nodes[otherEnd(l, d.id)];
              return (
                <div className="item" key={i}>
                  <span>
                    {other.ref + "  " + (other.name || "")}
                    {l.why ? (
                      <>
                        <br />
                        <span style={{ color: "var(--text-3)", fontSize: 10 }}>{l.why}</span>
                      </>
                    ) : null}
                  </span>
                  <button
                    className="minus"
                    aria-label="Remove"
                    onClick={() => {
                      model.links = model.links.filter((q) => q !== l);
                      bump();
                      saveNow();
                    }}
                  >
                    <span />
                  </button>
                </div>
              );
            })
          )}

          <button
            className="act"
            style={{ marginTop: 6, marginRight: 6 }}
            onClick={() => {
              const spot = freeSpot(model.nodes, model.order, d.id, "box");
              const id = addNode({ x: spot.x, y: spot.y, wireTo: d.id });
              onOpenCard(id, 4);
            }}
          >
            ADD WIRED CARD
          </button>

          <button
            className="act"
            style={{ marginTop: 6 }}
            onClick={() => onShowOnField(d.id)}
          >
            SHOW ON FIELD
          </button>
        </div>
      ) : null}

      {/* ADD — asks the one question that matters before anything is made */}
      <div style={{ paddingTop: 6 }}>
        <button
          className={"act" + (addArmed ? " armed" : "")}
          style={{ width: "100%", padding: 14, fontSize: 10 }}
          onClick={() => {
            if (addArmed) {
              disarmAdd();
              return;
            }
            setAddArmed(true);
            addTimer.current = window.setTimeout(() => setAddArmed(false), 8000);
          }}
        >
          {addArmed ? "WIRED TO THIS CARD, OR INDEPENDENT?" : "ADD A CARD"}
        </button>

        {addArmed ? (
          <div id="addq" style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {([["WIRED TO THIS CARD", true], ["INDEPENDENT", false]] as const).map((opt) => (
              <button
                key={opt[0]}
                className="act"
                style={{ flex: 1, padding: "14px 10px", fontSize: 9.5 }}
                onClick={() => {
                  const parent = d.id;
                  const spot = freeSpot(model.nodes, model.order, parent, "box");
                  const id = addNode({
                    x: spot.x,
                    y: spot.y,
                    wireTo: opt[1] ? parent : null,
                  });
                  disarmAdd();
                  /* the new card opens so it can be named */
                  onOpenCard(id, null);
                }}
              >
                {opt[0]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!removable ? (
        <div style={{ paddingTop: 6 }}>
          <button
            className={"act" + (delArmed ? " armed" : "")}
            style={{ width: "100%", padding: 14, fontSize: 10 }}
            onClick={() => {
              if (!delArmed) {
                setDelArmed(true);
                delTimer.current = window.setTimeout(() => setDelArmed(false), 5000);
                return;
              }
              if (delTimer.current) window.clearTimeout(delTimer.current);
              removeNode(d.id, false);
              onDismiss();
            }}
          >
            {delArmed
              ? "TAP AGAIN TO REMOVE · " +
                totalItems(d) +
                " ITEMS AND " +
                mine.length +
                " WIRES"
              : "REMOVE THIS CARD"}
          </button>
        </div>
      ) : null}

      <div className="foot">CHANGES SAVE THEMSELVES AS YOU TYPE · SAVE CLOSES THE CARD</div>

      <div className="savebar">
        <button
          className="savebtn"
          onClick={() => {
            saveNow();
            onDismiss();
          }}
        >
          SAVE
        </button>
      </div>
    </div>
  );
}
