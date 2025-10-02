import React, { useEffect, useRef, useState } from "react";
import AlbumTunnel from "./AlbumTunnel";

export default function RecentGrid({ token, full = false, gap = 30, knobs }) {
  const [tiles, setTiles] = useState([]);           // [{id, src}]
  const prevRef = useRef([]);                       // last emitted tiles

  // --- poll recently-played and keep the first 6 unique albums ---
  useEffect(() => {
    if (!token?.access_token) return;
    let stop = false;
    let timer = null;

    const sameTiles = (a, b) =>
      a.length === b.length && a.every((t, i) => t.id === b[i].id && t.src === b[i].src);

    const fetchOnce = async () => {
      const res = await fetch(
        "https://api.spotify.com/v1/me/player/recently-played?limit=50",
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );

      if (res.status === 429) {
        const retry = Number(res.headers.get("Retry-After") || 15) * 1000;
        return retry; // back off
      }
      if (!res.ok) throw new Error(`recently-played ${res.status}`);

      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];

      // newest -> oldest, dedupe by album id
      const seen = new Set();
      const fresh = [];
      for (const it of items) {
        const a = it?.track?.album;
        if (!a) continue;
        const id = a.id || a.name;
        const src = a.images?.[0]?.url || "";
        if (!id || !src || seen.has(id)) continue;
        seen.add(id);
        fresh.push({ id, src });
        if (fresh.length >= 6) break;
      }

      // fill with previous tiles if fewer than 6 new
      let next = fresh.slice(0, 6);
      if (next.length < 6 && prevRef.current.length) {
        for (const t of prevRef.current) {
          if (next.length >= 6) break;
          if (!seen.has(t.id)) { next.push(t); seen.add(t.id); }
        }
      }

      if (!sameTiles(prevRef.current, next)) {
        prevRef.current = next;
        setTiles(next);
      }
      return null;
    };

    const loop = async () => {
      try {
        const wait = await fetchOnce();
        if (stop) return;
        timer = setTimeout(loop, wait ?? 10000); // 25s default
      } catch {
        if (!stop) timer = setTimeout(loop, 30000);
      }
    };

    loop();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [token]);

  // ---------- render ----------
  const slots = tiles.slice(0, 6);
  while (slots.length < 6) slots.push({ id: `placeholder-${slots.length}`, src: null });
  const [t0, t1, t2, t3, t4, t5] = slots;

  const Tile = ({ tile, biasX = 0, biasY = 0 }) => (
    <div className="h-full w-full rounded-md overflow-hidden bg-black">
      <AlbumTunnel
        imageUrl={tile.src ?? null}
        biasX={biasX}
        biasY={biasY}
        LAYERS={17}
        ROT_STEP={Math.PI / 200}
        GROWTH={1.1}
        ALPHA0={1}
        ALPHA_FALLOFF={1}
        FRONT_FACTOR={0.25}
        centerFront
        direction={Math.random() < 0.5 ? -1 : 1}
        {...(knobs || {})}
      />
    </div>
  );

  // full-screen container + exact gap control
  const cssVars = { "--g": `${gap | 0}px` };

  return (
    <div className={full ? "h-full w-full" : "rounded-2xl"} style={{ ...cssVars, padding: full ? 0 : "var(--g)", backgroundColor: "#000", height: full ? "100%" : undefined }}>
      <div className="h-full w-full">
        <div className="grid h-full w-full min-h-0 min-w-0"         style={{
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr",   // <-- stretch to full height
          gap: "var(--g)",
          backgroundColor: "#000",
          padding: "var(--g)",          // ← perimeter border = same as gap
          height: full ? "100%" : undefined,
          boxSizing: "border-box",      // ← padding doesn’t push past viewport
        }}>
          {/* Left column */}
          <div className="grid h-full min-h-0" style={{ gridTemplateRows: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
            <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
              <Tile key={t0.id} tile={t0} biasX={0} biasY={0} />
              <Tile key={t1.id} tile={t1} biasX={0} biasY={0} />
            </div>
            <Tile key={t2.id} tile={t2} biasX={0} biasY={0} />
          </div>
          {/* Right column */}
          <div className="grid h-full min-h-0" style={{ gridTemplateRows: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
            <Tile key={t3.id} tile={t3} biasX={0} biasY={0} />
            <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
              <Tile key={t4.id} tile={t4} biasX={0} biasY={0} />
              <Tile key={t5.id} tile={t5} biasX={0} biasY={0} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
