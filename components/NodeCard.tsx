"use client";

import { useRef, useState } from "react";
import { TAGS } from "@/lib/seed";
import { counts } from "@/lib/graph";
import type { BrainNode } from "@/lib/types";

/* No Control X. That grammar is SALON X platform canon (§37) and this
   internal tool does not inherit it — a tap already opens the card. */
export default function NodeCard({
  d,
  removable,
  discovered,
  unwired,
  wirefocus,
  suppressRef,
  onOpen,
  onControl,
  onState,
  onRemove,
  onDrop,
}: {
  d: BrainNode;
  removable: boolean;
  discovered: boolean;
  unwired: boolean;
  wirefocus: boolean;
  suppressRef: React.RefObject<boolean>;
  onOpen: () => void;
  onControl: (tab: number) => void;
  onState: () => void;
  onRemove: () => void;
  /** Real files only — a drag of bare filenames has no bytes to store, so it is ignored rather than filed as an empty row. */
  onDrop: (files: FileList) => void;
}) {
  const [holding, setHolding] = useState(false);
  const [over, setOver] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);

  const c = counts(d);
  const blocked = d.blockers.length > 0 || d.state === "BLOCKED";
  /* blockers are already said by the solid mark — the hollow one means
     there is other work on the card */
  const work =
    d.todos.length + d.subs.length + d.drops.length + d.screens.filter(Boolean).length > 0;

  const cancelHold = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
    holdStart.current = null;
  };

  const cls = [
    "node",
    d.shape,
    "hasctl",
    holding ? "holding" : "",
    d.sec === "held" ? "held" : "",
    discovered ? "discovered" : "",
    unwired ? "unwired" : "",
    wirefocus ? "wirefocus" : "",
    d.awaitingRuling ? "awaiting" : "",
    !blocked && !work ? "quiet" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      id={"n-" + d.id}
      data-id={d.id}
      tabIndex={0}
      role="button"
      style={{
        left: d.x + "px",
        top: d.y + "px",
        borderColor: over ? "var(--baton)" : undefined,
      }}
      onClick={() => {
        if (suppressRef.current) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!suppressRef.current) onOpen();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (!e.dataTransfer.files?.length) return;
        onDrop(e.dataTransfer.files);
      }}
    >
      <div className="n-ref mono">
        {d.ref + (d.sec && d.sec !== "—" && d.sec !== "held" ? "  " + d.sec : "")}
      </div>
      <div className="n-name">{d.name || "UNNAMED"}</div>
      {/* Two facts, side by side, because they are genuinely independent: how the build is
          going, and whether canon has accepted the card at all. A card can be IN BUILD and
          still be waiting on Shawn. */}
      <div className="n-meta mono">
        {d.state || "UNTOUCHED"}
        {d.awaitingRuling ? <span className="ruling">{d.rulingRef ?? "RULING"}</span> : null}
      </div>
      <div className="marks">
        {blocked ? <i className="solid" /> : null}
        {work ? <i /> : null}
      </div>

      {/* Hold the upper-left corner to open this card's state control */}
      <button
        className="corner"
        aria-label="Hold for state"
        title="Hold for state"
        onPointerDown={(ev) => {
          ev.stopPropagation();
          holdStart.current = { x: ev.clientX, y: ev.clientY };
          setHolding(true);
          holdTimer.current = window.setTimeout(() => {
            cancelHold();
            suppressRef.current = true;
            onState();
            window.setTimeout(() => {
              suppressRef.current = false;
            }, 200);
          }, 420);
        }}
        onPointerMove={(ev) => {
          if (!holdStart.current) return;
          if (
            Math.hypot(ev.clientX - holdStart.current.x, ev.clientY - holdStart.current.y) > 8
          ) {
            cancelHold();
          }
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onClick={(ev) => ev.stopPropagation()}
        /* keyboard route to the same control */
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onState();
          }
        }}
      />

      <button
        className={"rm" + (removable ? "" : " hide")}
        aria-label="Remove this empty card"
        title="Remove — only while the card is empty"
        onClick={(ev) => {
          ev.stopPropagation();
          if (suppressRef.current || !removable) return;
          onRemove();
        }}
      >
        <span />
      </button>

      {/* Five controls. A count when there is something, dim when there is not. */}
      <div className="ctls">
        {TAGS.map((t, i) => (
          <button
            key={t.key}
            className={"ctl" + (c[i] === 0 ? " empty" : "")}
            data-key={t.key}
            onClick={(ev) => {
              ev.stopPropagation();
              if (suppressRef.current || c[i] === 0) return;
              onControl(i);
            }}
          >
            <span>{t.label}</span>
            <span className="n">{c[i]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
