"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useBrain } from "./brain";
import { addUiScreenshotAction, getSignedFileUrlAction, uploadFileAction } from "@/app/actions/pm";
import type { Drop, Shot } from "./types";

/** Where a pick lands: on the open card, or in the unrouted pile. */
export type Dest = "node" | "unrouted";

export type Intake = {
  pickPhotos: (to: Dest) => void;
  pickCamera: (to: Dest) => void;
  pickFiles: (to: Dest) => void;
  pickScreenshot: () => void;
};

const IntakeCtx = createContext<Intake | null>(null);

export function useIntake(): Intake {
  const ctx = useContext(IntakeCtx);
  if (!ctx) throw new Error("useIntake must be used inside IntakeProvider");
  return ctx;
}

/** One upload. Bytes go to the Server Action, never to Storage from the browser — there is no anon write policy on the bucket (0002_pm_layer.sql). */
async function upload(file: File, nodeKey: string | null) {
  const form = new FormData();
  form.set("file", file);
  if (nodeKey) form.set("nodeKey", nodeKey);
  return uploadFileAction(form);
}

/* Drag and drop does not exist on a phone. These are the way in. */
export function IntakeProvider({
  openId,
  onUnrouted,
  children,
}: {
  openId: string | null;
  onUnrouted: () => void;
  children: React.ReactNode;
}) {
  const { model, bump, persist, addFiles } = useBrain();

  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const screenshot = useRef<HTMLInputElement>(null);

  /* the target is decided when the picker is opened, not when it returns */
  const dest = useRef<Dest>("node");
  const openIdRef = useRef<string | null>(openId);
  openIdRef.current = openId;

  const takeFiles = useCallback(
    (list: FileList | null) => {
      const to = dest.current;
      if (!list || !list.length) return;
      const arr = Array.from(list);

      if (to === "unrouted") {
        persist(async () => {
          for (const f of arr) {
            const record = await upload(f, null);
            model.unrouted.push({
              id: record.id,
              storagePath: record.storagePath,
              name: record.fileName,
              size: record.sizeBytes,
              type: record.contentType ?? undefined,
              data: null,
            });
            bump();
          }
        });
        onUnrouted();
        return;
      }

      const id = openIdRef.current;
      if (!id) return;
      addFiles(id, arr);
    },
    [model, bump, persist, onUnrouted, addFiles],
  );

  const takeScreenshot = useCallback(
    (file: File | undefined) => {
      const id = openIdRef.current;
      if (!id || !file) return;
      const d = model.nodes[id];
      if (!d) return;

      const prior = d.screens.slice();
      persist(
        async () => {
          const form = new FormData();
          form.set("file", file);
          form.set("nodeKey", id);
          const record = await addUiScreenshotAction(form);
          const url = await getSignedFileUrlAction(record.storagePath);
          const shot: Shot = { id: record.id, storagePath: record.storagePath, name: record.fileName, data: url };
          // Appended, never placed at an index — addUiScreenshotAction already decided
          // this file's order server-side; here it just always goes last.
          d.screens = [...d.screens, shot];
          bump();
        },
        () => {
          d.screens = prior;
        },
      );
    },
    [model, bump, persist],
  );

  const value = useMemo<Intake>(
    () => ({
      pickPhotos: (to) => {
        dest.current = to;
        photos.current?.click();
      },
      pickCamera: (to) => {
        dest.current = to;
        camera.current?.click();
      },
      pickFiles: (to) => {
        dest.current = to;
        files.current?.click();
      },
      pickScreenshot: () => {
        screenshot.current?.click();
      },
    }),
    [],
  );

  const hidden: React.CSSProperties = {
    position: "fixed",
    left: -9999,
    width: 1,
    height: 1,
    opacity: 0,
  };

  return (
    <IntakeCtx.Provider value={value}>
      {children}
      <input
        ref={photos}
        type="file"
        accept="image/*"
        multiple
        style={hidden}
        onChange={(e) => {
          takeFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        style={hidden}
        onChange={(e) => {
          takeFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={files}
        type="file"
        multiple
        style={hidden}
        onChange={(e) => {
          takeFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={screenshot}
        type="file"
        accept="image/*"
        style={hidden}
        onChange={(e) => {
          takeScreenshot(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </IntakeCtx.Provider>
  );
}
