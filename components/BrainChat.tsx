"use client";

// The map's chat with the real brain — the same agent Telegram talks to, reached through
// the queue in 0008_ai_bridge.sql and answered by apps/command/web_bridge.py.
//
// It polls rather than streams. A Server Action cannot hold a connection open for the
// minutes a real piece of work takes on Vercel, and the answer is not produced here in
// any case — it is produced on Shawn's machine and written to a table. Polling a table is
// the honest shape for that, and it survives a reload, a closed panel, and a phone picked
// up ten minutes later: the conversation is in the database, not in this component.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  openBrainThreadAction,
  readBrainThreadAction,
  sendToBrainAction,
  startBrainThreadAction,
  uploadForBrainAction,
} from "@/app/actions/aiBridge";
import type { AiMessage } from "@/lib/ai/bridge";

const POLL_MS = 2000;

type Attachment = { id: string; fileName: string };

export default function BrainChat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [stalled, setStalled] = useState(false);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tail = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const state = await readBrainThreadAction(id);
      setMessages(state.messages);
      setStalled(state.stalled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    openBrainThreadAction()
      .then((id) => {
        setThreadId(id);
        return refresh(id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const waiting = messages.some((m) => m.status === "pending" || m.status === "running");

  // Only while something is in flight. An idle panel polling every two seconds forever
  // would be a request every two seconds for as long as the map is left open.
  useEffect(() => {
    if (!threadId || !waiting) return;
    const timer = setInterval(() => refresh(threadId), POLL_MS);
    return () => clearInterval(timer);
  }, [threadId, waiting, refresh]);

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, waiting]);

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        // Sequential, not Promise.all: uploads go through a Server Action, and a phone
        // sending eight photos at once should not open eight of them simultaneously.
        const stored = await uploadForBrainAction(form);
        setAttachments((list) => [...list, stored]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function send() {
    if (!threadId || (!text.trim() && !attachments.length)) return;
    const body = text.trim();
    const fileIds = attachments.map((a) => a.id);
    setText("");
    setAttachments([]);
    setError(null);
    try {
      await sendToBrainAction({ threadId, content: body, fileIds });
      await refresh(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function newThread() {
    try {
      const id = await startBrainThreadAction();
      setThreadId(id);
      setMessages([]);
      setStalled(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panelCol">
      <div className="chatlog">
        {!messages.length ? (
          <div className="none">
            This is the same brain Telegram talks to — it can read the vault, search the
            workspace, file what you send it, and capture to your GTD inbox.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={"turn " + m.role}>
              <div className="who mono">{m.role === "user" ? "YOU" : "BRAIN"}</div>
              <div className="say">{m.content || (m.status === "error" ? "" : "…")}</div>
              {m.fileIds.length ? (
                <div className="sub">
                  {m.fileIds.length} file{m.fileIds.length === 1 ? "" : "s"} attached
                </div>
              ) : null}
              {m.status === "error" ? <div className="sub">COULD NOT RUN — {m.error}</div> : null}
            </div>
          ))
        )}

        {waiting ? (
          <div className="turn assistant">
            <div className="who mono">BRAIN</div>
            <div className="say">
              {stalled
                ? // The distinction that matters: a queued message nobody has claimed
                  // means CommandOS is not running, which is normal and fixable, and
                  // looks exactly like thinking for the first few seconds.
                  "Waiting. CommandOS does not appear to be listening — start it on your machine with COMMAND_WEB_BRIDGE=1 and this will go through."
                : "Working on it…"}
            </div>
          </div>
        ) : null}
        <div ref={tail} />
      </div>

      <div className="composer">
        {error ? (
          <div className="none" style={{ marginBottom: 8 }}>
            {error}
          </div>
        ) : null}

        {attachments.length ? (
          <div className="chips">
            {attachments.map((a) => (
              <span className="chip" key={a.id}>
                {a.fileName}
                <button aria-label="Remove" onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          className="f"
          style={{ width: "100%", minHeight: 62, resize: "none", fontFamily: "inherit" }}
          placeholder="Ask it anything, or send a file to read and file"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />

        <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={(e) => attach(e.target.files)} />

        <div className="acts">
          <button className="act" style={{ padding: 12, fontSize: 10 }} disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? "UPLOADING…" : "ATTACH"}
          </button>
          <button
            className="act armed"
            style={{ flex: 1, padding: 12, fontSize: 10 }}
            disabled={!threadId || (!text.trim() && !attachments.length)}
            onClick={send}
          >
            SEND
          </button>
          <button className="act" style={{ padding: 12, fontSize: 10 }} onClick={newThread} title="Start a fresh conversation">
            NEW
          </button>
        </div>
      </div>
    </div>
  );
}
