/**
 * What the surface shows while it has nothing to draw yet.
 *
 * Two moments need it and they are back to back: Next streams this from `app/loading.tsx`
 * while the page does its Supabase reads, then BrainSurface shows the same mark again for
 * the frame between hydration and the mount that lets the canvas measure the window.
 * Before this existed both moments were a blank black page, which is why a refresh read
 * as "nothing is happening" for four seconds rather than "it is coming."
 *
 * Deliberately styleless beyond the tokens — no spinner, no progress bar. A progress bar
 * here would be a claim about how long the read takes, and this surface does not know.
 */
export default function Booting() {
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--ground)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-space-mono), monospace",
          fontSize: 10,
          letterSpacing: "0.22em",
          color: "var(--baton)",
          opacity: 0.7,
          animation: "boot-pulse 1.4s ease-in-out infinite",
        }}
      >
        SALON X · BRAIN WORK SURFACE
      </span>
    </main>
  );
}
