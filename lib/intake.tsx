"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useBrain } from "./brain";
import { readImage } from "./graph";
import type { Shot } from "./types";

/** Where a pick lands: on the open card, or in the unrouted pile. */
export type Dest = "node" | "unrouted";

export type Intake = {
  pickPhotos: (to: Dest) => void;
  pickCamera: (to: Dest) => void;
  pickFiles: (to: Dest) => void;
  pickSlot: (index: number) => void;
};

const IntakeCtx = createContext<Intake | null>(null);

export function useIntake(): Intake {
  const ctx = useContext(IntakeCtx);
  if (!ctx) throw new Error("useIntake must be used inside IntakeProvider");
  return ctx;
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
  const { model, bump, saveNow } = useBrain();

  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const slot = useRef<HTMLInputElement>(null);

  /* the target is decided when the picker is opened, not when it returns */
  const dest = useRef<Dest>("node");
  const slotIndex = useRef<number>(0);
  const openIdRef = useRef<string | null>(openId);
  openIdRef.current = openId;

  const takeFiles = useCallback(
    (list: FileList | null) => {
      const to = dest.current;
      if (!list || !list.length) return;

      if (to === "unrouted") {
        Array.from(list).forEach((f) => {
          model.unrouted.push({ name: f.name, size: f.size, type: f.type || "", data: null });
        });
        bump();
        saveNow();
        onUnrouted();
        return;
      }

      const id = openIdRef.current;
      if (!id) return;
      const d = model.nodes[id];
      if (!d) return;

      const arr = Array.from(list);
      let left = arr.length;
      arr.forEach((f) => {
        const rec = { name: f.name, size: f.size, type: f.type || "", data: null as string | null };
        const finish = () => {
          d.drops = d.drops.concat([rec]);
          if (--left === 0) {
            bump();
            saveNow();
          }
        };
        if (f.type && f.type.indexOf("image/") === 0) {
          readImage(f, (url) => {
            rec.data = url;
            finish();
          });
        } else {
          finish();
        }
      });
    },
    [model, bump, saveNow, onUnrouted]
  );

  const takeSlot = useCallback(
    (file: File | undefined, index: number) => {
      const id = openIdRef.current;
      if (!id || !file) return;
      const d = model.nodes[id];
      if (!d) return;
      readImage(file, (url, w, h) => {
        if (!url) return;
        const arr = d.screens.slice();
        while (arr.length < 4) arr.push(null);
        const shot: Shot = { name: file.name, data: url, w, h };
        arr[index] = shot;
        d.screens = arr;
        bump();
        saveNow();
      });
    },
    [model, bump, saveNow]
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
      pickSlot: (index) => {
        slotIndex.current = index;
        slot.current?.click();
      },
    }),
    []
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
        ref={slot}
        type="file"
        accept="image/*"
        style={hidden}
        onChange={(e) => {
          takeSlot(e.target.files?.[0], slotIndex.current);
          e.target.value = "";
        }}
      />
    </IntakeCtx.Provider>
  );
}
