import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /* the surface is the whole screen — nothing else sits on top of it */
  devIndicators: false,
  /**
   * How stale a cached render may be before Next stops handing it out and makes the
   * asking visitor wait for a fresh one. `/` revalidates every 30 seconds, but the
   * default ceiling on serving a stale page while that happens is a year: nobody visits
   * for a week, and the next person gets the week-old map while the new one builds behind
   * them. An hour bounds it, and signModelFiles signs its image URLs for a day so even
   * the oldest page this can serve still has working images on it.
   */
  expireTime: 3600,
  /**
   * A Server Action's request body defaults to a 1 MB ceiling — fine for the tiny test
   * uploads that pass locally, silently fatal for a real phone photo. Confirmed live
   * 2026-09-17 (Salman): "Server Components render" errors on WALK's upload and the
   * screenshot grid both traced to this — every real upload on this app goes through a
   * Server Action (stageWalkImageAction, addUiScreenshotAction, uploadFileAction), so all
   * of them were exposed, not just WALK's. 20 MB covers a real camera photo with room.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
