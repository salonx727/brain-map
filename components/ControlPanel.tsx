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
  deleteFileAction,
  deleteNodeLinkAction,
  proposeConnectionAction,
  renamePmNodeAction,
  updateNodeLinkAction,
} from "@/app/actions/pm";
import { updateRulingIntentAction } from "@/app/actions/rulings";
import { connectionSummary } from "@/lib/pm/coyoteText";
import type { BrainNode, Item, Link } from "@/lib/types";
import type { ConnectionIntent, ConnectionRelation } from "@/lib/types/pm";
import ListEditor from "./ListEditor";
import PrototypePanel from "./PrototypePanel";
import RulingList from "./RulingList";
import WalkPanel, { type WalkLanding } from "./WalkPanel";
import WirePicker, { optionsFromModel } from "./WirePicker";

/** One past TAGS, and only ever rendered on Shawn's card — see the strip below. */
const RULING_TAB = TAGS.length;
/** One past RULING_TAB, and only ever rendered on an engine card — see isEngine below. */
const PROTOTYPE_TAB = TAGS.length + 1;

/** The four fields §35 declares a connection with. connections.ts reads exactly these, so a ruling written in this vocabulary parses back correctly once Shawn puts it in COYOTE. */
const INTENT_FIELDS = [
  { key: "downstream", label: "DOWNSTREAM", hint: "Which engine reads what this writes" },
  { key: "reads", label: "READS", hint: "Which engine's data this reads" },
  { key: "emits", label: "EMITS", hint: "What this emits at session close" },
  { key: "trigger", label: "TRIGGER", hint: "What intake object starts this" },
] as const;

/**
 * The same four fields, as the choice a wire has to make before it can be drawn.
 *
 * Required, not defaulted — Shawn's operator, 2026-09-09. A default would put a relation
 * Shawn never chose into the §35 block he is about to paste, and DOWNSTREAM guessed wrong
 * is not a smaller mistake than no wire at all: READS and TRIGGER are written on the other
 * end of the edge entirely (see coyoteText.ts).
 */
const RELATIONS: { key: ConnectionRelation; label: string; hint: string }[] = [
  { key: "downstream", label: "DOWNSTREAM", hint: "This card writes it · that card reads it" },
  { key: "reads", label: "READS", hint: "That card's data flows into this one" },
  { key: "emits", label: "EMITS", hint: "This card emits it at session close" },
  { key: "trigger", label: "TRIGGER", hint: "That intake object starts this one" },
];

export default function ControlPanel({
  d,
  tab,
  setTab,
  onDismiss,
  onOpenCard,
  onShowOnField,
  onAskBlocker,
}: {
  d: BrainNode;
  tab: number | null;
  setTab: (t: number | null) => void;
  onDismiss: () => void;
  onOpenCard: (id: string, tab: number | null) => void;
  onShowOnField: (id: string) => void;
  onAskBlocker: (item: Item) => void;
}) {
  const { model, bump, persist, addFiles, addNode, removeNode, canEditNode } = useBrain();
  const intake = useIntake();

  /**
   * A canonical card is COYOTE's, not this app's. Its name and ref are read from the
   * published snapshot and there is no write path for them anywhere in the PM layer —
   * renamePmNode simply has no canonical equivalent. Everything else on this panel still
   * works against it: to-dos, files, wires and position are PM rows that point at the
   * node, they are not the node.
   */
  const editable = canEditNode(d.id);
  const isShawn = d.id === "owner:shawn";
  const isEngine = d.id.startsWith("engine:");
  const engineKey = isEngine ? d.id.slice(d.id.indexOf(":") + 1) : null;
  const ruling = model.rulings.find((r) => r.nodeKey === d.id) ?? null;

  // Held locally because updateRulingIntent writes all four fields at once — sending only
  // the one that changed would blank the other three.
  const [intent, setIntent] = useState<ConnectionIntent>(
    ruling?.intent ?? { downstream: null, reads: null, emits: null, trigger: null },
  );

  const [retargetId, setRetargetId] = useState<string | null>(null);
  /** Which §35 field the next wire asserts. Null until picked — a wire has to say what it means before it can be drawn. */
  const [relation, setRelation] = useState<ConnectionRelation | null>(null);
  const [over, setOver] = useState(false);
  const [delArmed, setDelArmed] = useState(false);
  const delTimer = useRef<number | null>(null);
  /** The full-sequence view for UI screenshots beyond the first 4 on the card face. */
  const [screensOpen, setScreensOpen] = useState(false);
  /** Where WALK should land after an exit tile switched this panel to another node. */
  const [walkLanding, setWalkLanding] = useState<WalkLanding | null>(null);

  useEffect(() => {
    return () => {
      if (delTimer.current) window.clearTimeout(delTimer.current);
    };
  }, []);

  const c = counts(d);
  const mine = linksOf(model.links, d.id);

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
    true,
  );

  function applyWire(targetId: string) {
    if (retargetId) {
      const link = model.links.find((l) => l.id === retargetId);
      if (!link || link.canon || link.containment) return;
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
    if (!relation) return; // the picker is disabled without one; this is the belt to that brace

    // Stored in DATA-FLOW direction, never in the order the two cards were clicked.
    // connections.ts reads DOWNSTREAM/EMITS outward from the declaring engine and READS/
    // TRIGGER inward toward it, so a proposal written the other way round would never
    // match the edge canon eventually publishes, and would sit in Shawn's queue forever
    // after he had already ruled on it.
    const outward = relation === "downstream" || relation === "emits";
    const from = outward ? d.id : targetId;
    const to = outward ? targetId : d.id;

    const link: Link = { a: from, b: to, relation, awaitingRuling: true };
    model.links.push(link);
    bump();

    // Same fallback as RulingList.tsx's labelOf: a blank ref+name must never produce a
    // blank name in the stored ruling text.
    const fromLabel = `${model.nodes[from]?.ref ?? ""} ${model.nodes[from]?.name ?? ""}`.trim() || "UNNAMED CARD";
    const toLabel = `${model.nodes[to]?.ref ?? ""} ${model.nodes[to]?.name ?? ""}`.trim() || "UNNAMED CARD";

    persist(
      async () => {
        const { ruling, linkId } = await proposeConnectionAction({
          fromNodeKey: from,
          toNodeKey: to,
          relation,
          label: connectionSummary(fromLabel, relation, toLabel),
        });
        link.id = linkId ?? undefined;
        if (ruling) {
          link.rulingRef = ruling.rulingRef;
          // Straight onto Shawn's queue, without a reload — the same reason a new card
          // carries its ruling back: a proposal that does not visibly reach him looks
          // like it was accepted.
          if (!model.rulings.some((r) => r.id === ruling.id)) model.rulings = [...model.rulings, ruling];
        }
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
    tally = c[0] + (c[0] === 1 ? " SCREENSHOT" : " SCREENSHOTS");
  }

  return (
    <div id="panel" className={tab === 0 ? "walk-open" : undefined} role="dialog" aria-label="Node control surface">
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
        <div style={{ display: "flex", gap: 8 }}>
          {/* Canonical cards have no delete path — same gate as REMOVE THIS CARD below.
              Shares its armed state: arming one arms both, so the two controls never
              disagree about whether the next tap deletes. */}
          {editable ? (
            <button
              className={"delete-x" + (delArmed ? " armed" : "")}
              aria-label={delArmed ? `Tap again to permanently remove ${totalItems(d)} items and ${mine.length} wires` : "Delete this card"}
              title={delArmed ? `Tap again to permanently remove ${totalItems(d)} items and ${mine.length} wires` : "Delete this card"}
              onClick={() => {
                if (!delArmed) {
                  setDelArmed(true);
                  delTimer.current = window.setTimeout(() => setDelArmed(false), 5000);
                  return;
                }
                if (delTimer.current) window.clearTimeout(delTimer.current);
                setDelArmed(false);
                removeNode(d.id, false);
                onDismiss();
              }}
            >
              <span />
              <span />
            </button>
          ) : null}
          <button className="dismiss" aria-label="Dismiss" onClick={onDismiss}>
            <span />
          </button>
        </div>
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

      {/* What this card is proposing, in the vocabulary Shawn writes canon in. Shown only
          while its ruling is open: once he has ruled, the intent is the record of what he
          ruled on and editing it would misrepresent that. */}
      {ruling ? (
        <div className="sect" style={{ marginBottom: 18 }}>
          <div className="lab">{ruling.rulingRef} · AWAITING SHAWN&rsquo;S RULING</div>
          {INTENT_FIELDS.map((f) => (
            <label key={f.key} style={{ display: "block", marginTop: 8 }}>
              <span className="lab">{f.label}</span>
              <input
                className="f"
                defaultValue={intent[f.key] ?? ""}
                placeholder={f.hint}
                onBlur={(e) => {
                  const next = e.target.value.trim() || null;
                  if (next === (intent[f.key] ?? null)) return;
                  const prior = { ...intent };
                  const updated = { ...intent, [f.key]: next };
                  setIntent(updated);
                  persist(
                    () => updateRulingIntentAction(d.id, updated),
                    () => setIntent(prior),
                  );
                }}
              />
            </label>
          ))}
          <div className="cap" style={{ marginTop: 10 }}>
            THIS CARD IS ON THE MAP, NOT IN CANON · IT REACHES CANON ONLY WHEN SHAWN RULES
          </div>
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
        {/* Only on Shawn's card. The queue is his — nothing reaches canon except by his
            ruling — so it is a category on his card, not a sixth tab everywhere. */}
        {isShawn ? (
          <button className={tab === RULING_TAB ? "on" : ""} onClick={() => setTab(tab === RULING_TAB ? null : RULING_TAB)}>
            {"RULING " + model.rulings.length}
          </button>
        ) : null}
        {/* Only on an engine card — a prototype belongs to the engine it's a UI for,
            never a generic tab everywhere else. */}
        {isEngine ? (
          <button className={tab === PROTOTYPE_TAB ? "on" : ""} onClick={() => setTab(tab === PROTOTYPE_TAB ? null : PROTOTYPE_TAB)}>
            PROTOTYPE
          </button>
        ) : null}
      </div>

      {isShawn && tab === RULING_TAB ? <RulingList onOpenCard={(id) => onOpenCard(id, null)} /> : null}

      {isEngine && tab === PROTOTYPE_TAB && engineKey ? <PrototypePanel engineKey={engineKey} /> : null}

      {/* WALK first in the UI tab — the reference mockup is a bar / stage / strip viewer,
          and burying it under the screenshot grid plus ADD CARD clipped it to a one-line
          sliver. Screenshots stay on this tab, below the viewer. */}
      {tab === 0 ? (
        <WalkPanel
          nodeId={d.id}
          landing={walkLanding}
          onLandingConsumed={() => setWalkLanding(null)}
          onOpenNode={(id, landing) => {
            if (landing) setWalkLanding(landing);
            onOpenCard(id, 0);
          }}
        />
      ) : null}

      {/* UI screenshots — unbounded, oldest first (see types.ts's screens field comment).
          Only the first 4 render here; VIEW ALL reaches the rest. */}
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
                        d.screens = d.screens.filter((s) => s.id !== shot.id);
                        bump();
                        if (!shot.id) return;
                        persist(
                          () => deleteFileAction(shot.id as string),
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
                ) : idx === d.screens.length ? (
                  <button className="empty" onClick={() => intake.pickScreenshot()}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                    <span>{"UI SLOT " + (idx + 1)}</span>
                  </button>
                ) : (
                  <div className="empty" aria-hidden="true" />
                )}
              </div>
            );
          })}
          {d.screens.length >= 4 ? (
            <div className="slot">
              <button className="empty" onClick={() => intake.pickScreenshot()}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                <span>{"UI SLOT " + (d.screens.length + 1)}</span>
              </button>
            </div>
          ) : null}
          {d.screens.length > 4 ? (
            <div className="slot">
              <button className="empty" onClick={() => setScreensOpen(true)}>
                <span>{"VIEW ALL (" + d.screens.length + ")"}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {screensOpen ? (
        <div
          className="screens-modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setScreensOpen(false);
          }}
        >
          <div className="screens-modal-card">
            <div className="head">
              <div className="title">{"ALL SCREENSHOTS · " + d.screens.length}</div>
              <button className="dismiss" aria-label="Dismiss" onClick={() => setScreensOpen(false)}>
                <span />
              </button>
            </div>
            {d.screens.map((shot, i) => (
              <div className="item file" key={shot.id ?? i}>
                {shot.data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={shot.data} alt={shot.name || shot.id} />
                ) : null}
                <div style={{ flex: 1 }}>
                  <div>{shot.name || "Untitled"}</div>
                  {shot.id ? <div className="meta">{"ID " + shot.id}</div> : null}
                </div>
                <button
                  className="minus"
                  aria-label="Remove"
                  onClick={() => {
                    const prior = d.screens.slice();
                    d.screens = d.screens.filter((s) => s.id !== shot.id);
                    bump();
                    if (!shot.id) return;
                    persist(
                      () => deleteFileAction(shot.id as string),
                      () => {
                        d.screens = prior;
                      },
                    );
                  }}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Same ASK affordance on both lists — Shawn, 2026-09-12: "I should be able to click
          on the blocker and walk through... I cannot do that in the to-do column." The
          326-item blocker handoff landed as TO DO (BLK stays canon-only), so TO DO needed
          the same walk-through BLK already had, not a separate feature. */}
      {tab === 1 ? <ListEditor d={d} field="todos" placeholder="Add a to-do" onAsk={onAskBlocker} /> : null}
      {tab === 2 ? <ListEditor d={d} field="blockers" placeholder="Add a blocker" onAsk={onAskBlocker} /> : null}

      {tab === 4 ? (
        <>
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
        </>
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

          {/* A wire is an assertion about §35, so it has to name which field it asserts
              before it can be drawn at all. Nothing is preselected: see RELATIONS. */}
          {!retargetId ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {RELATIONS.map((r) => (
                  <button
                    key={r.key}
                    className={"act" + (relation === r.key ? " armed" : "")}
                    style={{ padding: "6px 10px", fontSize: 9 }}
                    title={r.hint}
                    onClick={() => setRelation(relation === r.key ? null : r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="cap" style={{ marginBottom: 8 }}>
                {relation
                  ? RELATIONS.find((r) => r.key === relation)?.hint.toUpperCase()
                  : "PICK WHAT THE WIRE MEANS FIRST · IT GOES TO SHAWN AS A RULING, NOT TO CANON"}
              </div>
            </>
          ) : null}

          {retargetId || relation ? (
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
          ) : null}
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
                    <span>
                      {other.ref + "  " + (other.name || "")}
                      {l.relation ? <span className="cap" style={{ marginLeft: 8 }}>{l.relation.toUpperCase()}</span> : null}
                      {l.awaitingRuling ? (
                        <span className="cap ruling" style={{ marginLeft: 8 }} title="Waiting on Shawn's ruling — not canon">
                          {l.rulingRef ?? "RULING"}
                        </span>
                      ) : null}
                    </span>
                    {l.canon ? (
                      <span
                        className="cap"
                        title={
                          l.evidence === "inferred"
                            ? "Inferred — no engine declares this edge; the target's own READS names the source"
                            : "Declared by COYOTE"
                        }
                      >
                        {l.evidence === "inferred" ? "INFERRED" : "CANON"}
                      </span>
                    ) : l.containment ? (
                      <span className="cap" title="Nesting, derived from this card's parent — not a wire to delete">
                        NESTED
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
                  {l.canon || l.containment ? (
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
            style={{ marginTop: 6 }}
            onClick={() => onShowOnField(d.id)}
          >
            SHOW ON FIELD
          </button>
        </div>
      ) : null}

      {/* Salman, 2026-09-16: only on the card's own face, not inside any category tab —
          clicking into UI/BLK/whatever is looking at that category's own content, not a
          place to reach for wiring a new card from. */}
      {tab === null ? (
        <div style={{ paddingTop: 6 }}>
          <button
            className="act armed"
            style={{ width: "100%", padding: 14, fontSize: 10 }}
            onClick={() => {
              const spot = freeSpot(model.nodes, model.order, d.id, "box");
              void addNode({ x: spot.x, y: spot.y, wireTo: d.id }).then((id) => {
                if (id) onOpenCard(id, null);
              });
            }}
          >
            ADD A SUB NODE OR MODULE
          </button>
        </div>
      ) : null}

      {/* Canonical cards have no delete path — an engine exists because COYOTE says so.
          Only PM-created cards can be taken away, empty or not. */}
      {editable ? (
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
