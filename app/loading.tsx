import Booting from "@/components/Booting";

/* `page.tsx` is force-dynamic, so every refresh waits on live Supabase reads before it
   can send a byte. With this file Next sends the shell first and streams the surface in
   behind it — the wait is the same length, but it is no longer a blank page. */
export default function Loading() {
  return <Booting />;
}
