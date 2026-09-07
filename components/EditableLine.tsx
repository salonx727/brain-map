"use client";

import { useEffect, useRef } from "react";

/** Editing is one tap into the line; it is not on by default. The text is
    written to the DOM only when the row is not being typed into, so a repaint
    elsewhere on the card cannot move the caret. */
export default function EditableLine({
  text,
  onInput,
  onBlur,
}: {
  text: string;
  onInput: (value: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== text) el.textContent = text;
  }, [text]);

  return (
    <div
      ref={ref}
      className="line"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      onInput={() => onInput(ref.current?.textContent || "")}
      onBlur={onBlur}
    />
  );
}
