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
  otherEnd,
  sizeOf,
  totalItems,
} from "@/lib/graph";
import {
  clearUiSlotAction,
  createNodeLinkAction,
  deleteFileAction,
  deleteNodeLinkAction,
  renamePmNodeAction,
  updateNodeLinkAction,
} from "@/app/actions/pm";
import type { BrainNode, Link } from "@/lib/types";
import ListEditor from "./ListEditor";
import WirePicker, { optionsFromModel } from "./WirePicker";

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
  const { model, bump, persist, addFiles, addNode, removeNode, isEmpty, canEditNode } = useBrain();
  const intake = useIntake();

  /**
   * A canonical card is COYOTE's, not this app's. Its name and ref are read from the
   * published snapshot and there is no write path for them anywhere in the PM layer —
   * renamePmNode simply has no canonical equivalent. Everything else on this panel still
   * works against it: to-dos, files, wires and position are PM rows that point at the
   * node, they are not the node.
   */
  const editable = canEditNode(d.id);

  const [retargetId, setRetargetId] = useState<string | null>(null);
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

  /**
   * Every other card on the map, not a filtered subset. Built from nodes and order
   * together so a card that has landed in the model but not yet in the draw order
   * still appears — the native <select> also hid most of these behind a wheel that
   * looked empty on a phone.
   */
  const wireOptions = optionsFromModel(
    model.nodes,
    model.order,
    d.id,
    (oid) => hasLink(model.links, d.id, oid),
  );

  function applyWire(targetId: string) {
    if (retargetId) {
      const link = model.links.find((l) => l.id === retargetId);
      if (!link || link.canon) return;
      const movingA = otherEnd(link, d.id) === link.a;
      const prior = movingA ? link.a : link.b;
      if (movingA) link.a = targetId;
      else link.b = targetId;
      setRetargetId(null);
      bump();
      persist(
        () =>
          updateNodeLinkAction(
            link.id as string,
            movingA ? { fromNodeKey: targetId } : { toNodeKey: targetId },
          ),
        () => {
          if (movingA) link.a = prior;
          else link.b = prior;
        },
      );
      return;
    }
    const link: Link = { a: d.id, b: targetId };
    model.links.push(link);
    bump();
    persist(
      async () => {
        const created = await createNodeLinkAction({ fromNodeKey: link.a, toNodeKey: link.b });
        link.id = created.id;
        bump();
      },
      () => {
        model.links = model.links.filter((q) => q !== link);
      },
    );
  }

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

      <div style={{ display: "flex", gap: 10, marginBottom: editable ? 22 : 8 }}>
        <label style={{ width: 128 }}>
          <span className="lab">REF</span>
          {/* Never editable, for either kind. A canonical ref is derived from the node key
              COYOTE declares; a PM ref is assigned once at creation and pmWriter has no
              path that changes it. An input here would be a field that quietly reverts. */}
          <input className="f" value={d.ref} readOnly disabled />
        </label>
        <label style={{ flex: 1 }}>
          <span className="lab">NAME</span>
          <input
            className="f"
            value={d.name}
            readOnly={!editable}
            disabled={!editable}
            placeholder={editable ? "Blank keeps the ref" : ""}
            onChange={(e) => {
              d.name = e.target.value;
              bump();
            }}
            onBlur={() => {
              if (!editable) return;
              persist(() => renamePmNodeAction(d.id, d.name));
            }}
          />
        </label>
      </div>

      {!editable ? (
        <div className="cap" style={{ marginBottom: 18 }}>
          NAME AND REF COME FROM COYOTE · TO-DOS, FILES AND WIRES BELOW ARE YOURS
        </div>
      ) : null}

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
                        const prior = d.screens.slice();
                        const arr = d.screens.slice();
                        arr[idx] = null;
                        while (arr.length && arr[arr.length - 1] === null) arr.pop();
                        d.screens = arr;
                        bump();
                        persist(
                          () => clearUiSlotAction(d.id, idx),
                          () => {
                            d.screens = prior;
                          },
                        );
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
            const prior = d.subs.slice();
            d.subs = d.subs.filter((_, k) => k !== i);
            bump();
            void addNode({ x: spot.x, y: spot.y, name: label, wireTo: parent }).then((id) => {
              if (id) return;
              d.subs = prior; // the card was never created, so the line stays where it was
              bump();
            });
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
              // Only a drag carrying real bytes can be filed. A drag of bare filenames
              // (from some apps, or a text selection) used to append a row that recorded
              // a name and nothing else — there is no file behind it to store, so it
              // would be a row that looks filed and holds nothing.
              if (e.dataTransfer.files?.length) addFiles(d.id, e.dataTransfer.files);
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
                  {f.size ? <div className="meta">{sizeOf(f.size) + " · stored"}</div> : null}
                </div>
                <button
                  className="minus"
                  aria-label="Remove"
                  onClick={() => {
                    const prior = d.drops.slice();
                    d.drops = d.drops.filter((_, k) => k !== i);
                    bump();
                    if (!f.id) return;
                    persist(
                      () => deleteFileAction(f.id as string),
                      () => {
                        d.drops = prior;
                      },
                    );
                  }}
                >
                  <span />
                </button>
              </div>
            ))
          )}

          <div className="cap">STORED PRIVATELY · SHOWN THROUGH A SIGNED LINK</div>
        </div>
      ) : null}

      {tab === 4 ? (
        <div className="sect">
          <div className="lab">{retargetId ? "MOVE THIS WIRE TO…" : "WIRE TO ANY CARD"}</div>
          <WirePicker
            options={
              retargetId
                ? optionsFromModel(
                    model.nodes,
                    model.order,
                    d.id,
                    (oid) => {
                      const editing = model.links.find((l) => l.id === retargetId);
                      if (editing && otherEnd(editing, d.id) === oid) return false;
                      return hasLink(model.links, d.id, oid);
                    },
                  )
                : wireOptions
            }
            onPick={applyWire}
            placeholder={retargetId ? "Pick the new other end…" : "Search every card on the map…"}
          />
          {retargetId ? (
            <button className="act" style={{ width: "100%", marginTop: 8 }} onClick={() => setRetargetId(null)}>
              CANCEL MOVE
            </button>
          ) : null}

          <div className="cap" style={{ marginBottom: 12 }}>
            {wireOptions.length} CARDS · WIRED AND COYOTE PAIRS STAY VISIBLE, NOT PICKABLE
          </div>

          {!mine.length ? (
            <div className="none">Not wired to anything.</div>
          ) : (
            mine.map((l, i) => {
              const other = model.nodes[otherEnd(l, d.id)];
              if (!other) return null;
              return (
                <div className="item" key={l.id ?? i} style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span>{other.ref + "  " + (other.name || "")}</span>
                    {l.canon ? (
                      <span className="cap" title="Declared by COYOTE">
                        CANON
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 6 }}>
                        <button className="act" style={{ padding: "6px 10px", fontSize: 9 }} onClick={() => setRetargetId(l.id ?? null)}>
                          MOVE
                        </button>
                        <button
                          className="minus"
                          aria-label="Remove"
                          onClick={() => {
                            const prior = model.links.slice();
                            model.links = model.links.filter((q) => q !== l);
                            bump();
                            if (!l.id) return;
                            persist(
                              () => deleteNodeLinkAction(l.id as string),
                              () => {
                                model.links = prior;
                              },
                            );
                          }}
                        >
                          <span />
                        </button>
                      </span>
                    )}
                  </div>
                  {l.canon ? (
                    l.why ? (
                      <div className="cap" style={{ marginTop: 6 }}>
                        {l.why}
                      </div>
                    ) : null
                  ) : (
                    <input
                      className="f"
                      style={{ marginTop: 8 }}
                      defaultValue={l.why ?? ""}
                      placeholder="Why this wire — optional"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        const was = l.why ?? "";
                        if (next === was || !l.id) return;
                        l.why = next || undefined;
                        bump();
                        persist(
                          () => updateNodeLinkAction(l.id as string, { citation: next || null }),
                          () => {
                            l.why = was || undefined;
                          },
                        );
                      }}
                    />
                  )}
                </div>
              );
            })
          )}

          <button
            className="act"
            style={{ marginTop: 6, marginRight: 6 }}
            onClick={() => {
              const spot = freeSpot(model.nodes, model.order, d.id, "box");
              void addNode({ x: spot.x, y: spot.y, wireTo: d.id }).then((id) => {
                if (id) onOpenCard(id, 4);
              });
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
                  disarmAdd();
                  void addNode({
                    x: spot.x,
                    y: spot.y,
                    wireTo: opt[1] ? parent : null,
                  }).then((id) => {
                    /* the new card opens so it can be named */
                    if (id) onOpenCard(id, null);
                  });
                }}
              >
                {opt[0]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Canonical cards have no delete path anywhere in the PM layer — an engine exists
          because COYOTE says so, and removing it here would mean nothing on the next
          publish. Only PM-created cards can be taken away. */}
      {!removable && editable ? (
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
              ? "TAP AGAIN · PERMANENTLY REMOVES " +
                totalItems(d) +
                " ITEMS AND " +
                mine.length +
                " WIRES"
              : "REMOVE THIS CARD"}
          </button>
        </div>
      ) : null}

      <div className="foot">EVERY CHANGE IS WRITTEN AS YOU MAKE IT · DONE CLOSES THE CARD</div>

      <div className="savebar">
        <button className="savebtn" onClick={onDismiss}>
          DONE
        </button>
      </div>
    </div>
  );
}
