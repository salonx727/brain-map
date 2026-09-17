"use client";

import { useRef, useState } from "react";
import {
  branchFromScreenAction,
  createScreenAtEndAction,
  discardStagedImageAction,
  insertScreenBetweenAction,
  replaceScreenImageAction,
  stageWalkImageAction,
  type WalkGraphWithUrls,
} from "@/app/actions/walk";

/**
 * WALK's own staging tray — Shawn's ruling, 2026-09-17: manual upload only, plus the
 * ability to move a tray image onto an existing screen, a new screen at the end, or
 * between two screens. Deliberately its own section, not the pre-existing UI-screenshot
 * grid — that grid stays a plain reference-image list for cards that have no flow at all;
 * conflating the two would mean picking one meaning for a feature that currently has two
 * legitimate ones. "Move to…" is the required, phone-safe interaction (drag-and-drop is
 * unreliable on touch, per Shawn's own screenshots); this component doesn't implement
 * desktop drag as an addition on top of it — the button already works everywhere.
 */
export default function WalkTray({
  nodeId,
  flowId,
  main,
  graph,
  onChanged,
}: {
  nodeId: string;
  flowId: string | null;
  main: string[];
  graph: WalkGraphWithUrls;
  onChanged: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [insertModeFor, setInsertModeFor] = useState<string | null>(null);
  const [branchModeFor, setBranchModeFor] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<{ stagedId: string; screenId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function closeMenus() {
    setOpenMenuFor(null);
    setInsertModeFor(null);
    setBranchModeFor(null);
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("nodeId", nodeId);
      const { duplicate } = await stageWalkImageAction(form);
      onChanged();
      if (duplicate) setError(`"${file.name}" is already in the tray — uploaded again as a separate copy.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard(stagedId: string) {
    setBusy(true);
    setError("");
    try {
      await discardStagedImageAction(stagedId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReplace(stagedId: string, screenId: string) {
    setBusy(true);
    setError("");
    setConfirmReplace(null);
    closeMenus();
    try {
      await replaceScreenImageAction({ nodeId, stagedId, screenId });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleNewAtEnd(stagedId: string) {
    if (!flowId) return;
    setBusy(true);
    setError("");
    closeMenus();
    try {
      await createScreenAtEndAction({ nodeId, flowId, stagedId });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleInsertAfter(stagedId: string, afterScreenId: string) {
    if (!flowId) return;
    const idx = main.indexOf(afterScreenId);
    const beforeScreenId = idx >= 0 ? main[idx + 1] : undefined;
    if (!beforeScreenId) return;
    setBusy(true);
    setError("");
    closeMenus();
    try {
      await insertScreenBetweenAction({ nodeId, flowId, stagedId, afterScreenId, beforeScreenId });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Unlike insert, the source screen keeps its existing next screen — this only adds a second path off it. */
  async function handleBranchFrom(stagedId: string, fromScreenId: string) {
    if (!flowId) return;
    setBusy(true);
    setError("");
    closeMenus();
    try {
      await branchFromScreenAction({ nodeId, flowId, stagedId, fromScreenId });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const insertableAfter = main.slice(0, -1);

  return (
    <div className="walk-tray">
      <div className="walk-tray-head">
        <span className="lab">STAGING TRAY</span>
        <button className="act" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          + UPLOAD IMAGE
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void handleUpload(f);
          }}
        />
      </div>

      {error ? <div className="walk-tray-error">{error}</div> : null}

      {graph.stagedImages.length === 0 ? (
        <div className="none">Nothing in the tray.</div>
      ) : (
        <div className="walk-tray-list">
          {graph.stagedImages.map((s) => (
            <div className="walk-tray-item" key={s.id}>
              {graph.stagedUrls[s.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="walk-tray-thumb" src={graph.stagedUrls[s.id]} alt={s.fileName} />
              ) : (
                <div className="walk-tray-thumb walk-tray-thumb-empty" />
              )}
              <div className="walk-tray-info">
                <div className="walk-tray-name">{s.fileName}</div>
                <span className="walk-tray-tag">unassigned</span>
              </div>
              <div className="walk-tray-actions">
                <button
                  className="act"
                  disabled={busy || !flowId}
                  onClick={() => (openMenuFor === s.id ? closeMenus() : setOpenMenuFor(s.id))}
                >
                  MOVE TO…
                </button>
                {openMenuFor === s.id ? (
                  <div className="walk-tray-menu">
                    {main.map((screenId) => (
                      <button key={screenId} onClick={() => setConfirmReplace({ stagedId: s.id, screenId })}>
                        {screenId}
                      </button>
                    ))}
                    <button onClick={() => handleNewAtEnd(s.id)}>New screen at end</button>
                    {insertModeFor === s.id
                      ? insertableAfter.map((screenId) => (
                          <button key={screenId} onClick={() => handleInsertAfter(s.id, screenId)}>
                            After {screenId}
                          </button>
                        ))
                      : insertableAfter.length > 0 && (
                          <button onClick={() => setInsertModeFor(s.id)}>Insert after…</button>
                        )}
                    {branchModeFor === s.id
                      ? main.map((screenId) => (
                          <button key={screenId} onClick={() => handleBranchFrom(s.id, screenId)}>
                            From {screenId}
                          </button>
                        ))
                      : main.length > 0 && <button onClick={() => setBranchModeFor(s.id)}>Branch from…</button>}
                  </div>
                ) : null}
              </div>
              <button className="minus" aria-label="Remove from tray" disabled={busy} onClick={() => handleDiscard(s.id)}>
                <span />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmReplace ? (
        <div
          className="screens-modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmReplace(null);
          }}
        >
          <div className="screens-modal-card">
            <div className="head">
              <div className="title">{`Replace ${confirmReplace.screenId} image?`}</div>
            </div>
            <p style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 1.5 }}>
              The current image stays on record as an earlier version — nothing is deleted. Touch points on{" "}
              {confirmReplace.screenId} will be flagged to check their position.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="act" onClick={() => setConfirmReplace(null)}>
                Cancel
              </button>
              <button className="act armed" onClick={() => handleReplace(confirmReplace.stagedId, confirmReplace.screenId)}>
                Replace
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
