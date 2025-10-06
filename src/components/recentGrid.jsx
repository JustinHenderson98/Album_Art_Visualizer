import React, { useEffect, useRef, useState } from "react";
import AlbumTunnel from "./AlbumTunnel";

/**
 * A small contract for bring-your-own data:
 * - source can be:
 *    1) Array<string | {id:string, src:string}>
 *    2) Async function: () => Promise<{ tiles: Array<{id, src}>, retryMs?: number }>
 */


export default function RecentGrid({
  source,                 // Array or Async fetcher function (preferred)
  full = false,
  gap = 30,
  knobs,
  maxTiles = 6,
  pollMs = 10000,
  onTiles,                // optional callback when tiles change
}) {
  const [tiles, setTiles] = useState([]);     // [{id, src}]
  const prevRef = useRef([]);                 // last emitted tiles
  const timerRef = useRef(null);

  // normalize array sources into [{id, src}]
  const normalizeArraySource = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((v, i) =>
        typeof v === "string" ? { id: v, src: v } : { id: v.id ?? String(i), src: v.src ?? "" }
      )
      .filter((t) => t.id && t.src);
  };

  const sameTiles = (a, b) =>
    a.length === b.length && a.every((t, i) => t.id === b[i].id && t.src === b[i].src);

  useEffect(() => {
    let stop = false;

    const applyNext = (fresh) => {
      // fill up to maxTiles using previous tiles (stable visual)
      const seen = new Set(fresh.map((t) => t.id));
      let next = fresh.slice(0, maxTiles);
      if (next.length < maxTiles && prevRef.current.length) {
        for (const t of prevRef.current) {
          if (next.length >= maxTiles) break;
          if (!seen.has(t.id)) {
            next.push(t);
            seen.add(t.id);
          }
        }
      }
      if (!sameTiles(prevRef.current, next)) {
        prevRef.current = next;
        setTiles(next);
        onTiles?.(next);
      }
    };

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = (ms) => {
      if (stop) return;
      clearTimer();
      timerRef.current = setTimeout(loop, Math.max(0, ms ?? pollMs));
    };

    const fetchOnce = async () => {
      // CASE 1: array source -> one-shot, no polling unless arrays change
      if (Array.isArray(source)) {
        applyNext(normalizeArraySource(source).slice(0, maxTiles));
        return null; // no retry
      }

      // CASE 2: function source -> call it and respect its backoff
      if (typeof source === "function") {
        const { tiles: fresh = [], retryMs = null } = (await source()) || {};
        applyNext(Array.isArray(fresh) ? fresh : []);
        return retryMs; // allow custom backoff from the fetcher
      }
      
      // nothing to do
      applyNext([]);
      return null;
    };

    const loop = async () => {
      try {
        const wait = await fetchOnce();
        if (stop) return;

        // If source is array, don't poll repeatedly
        if (Array.isArray(source)) return;

        schedule(wait ?? pollMs);
      } catch {
        if (stop) return;
        schedule(30000);
      }
    };

    loop();
    return () => {
      stop = true;
      clearTimer();
    };
    // Re-run if these change
  }, [source, pollMs, maxTiles, onTiles]);

  // ---------- render ----------
  const slots = tiles.slice(0, maxTiles);
  while (slots.length < maxTiles) {
    slots.push({ id: `placeholder-${slots.length}`, src: null });
  }

  // Preserve your existing 2x3 layout
  const [t0, t1, t2, t3, t4, t5] = slots.concat(Array(6).fill({ id: "ph", src: null })).slice(0, 6);

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

  const cssVars = { "--g": `${gap | 0}px` };

  return (
    <div
      className={full ? "h-full w-full" : "rounded-2xl"}
      style={{ ...cssVars, padding: full ? 0 : "var(--g)", backgroundColor: "#000", height: full ? "100%" : undefined }}
    >
      <div className="h-full w-full">
        <div
          className="grid h-full w-full min-h-0 min-w-0"
          style={{
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr",
            gap: "var(--g)",
            backgroundColor: "#000",
            padding: "var(--g)",
            height: full ? "100%" : undefined,
            boxSizing: "border-box",
          }}
        >
          {/* Left column */}
          <div className="grid h-full min-h-0" style={{ gridTemplateRows: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
            <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
              <Tile key={t0?.id} tile={t0} biasX={0} biasY={0} />
              <Tile key={t1?.id} tile={t1} biasX={0} biasY={0} />
            </div>
            <Tile key={t2?.id} tile={t2} biasX={0} biasY={0} />
          </div>
          {/* Right column */}
          <div className="grid h-full min-h-0" style={{ gridTemplateRows: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
            <Tile key={t3?.id} tile={t3} biasX={0} biasY={0} />
            <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--g)", backgroundColor: "#000" }}>
              <Tile key={t4?.id} tile={t4} biasX={0} biasY={0} />
              <Tile key={t5?.id} tile={t5} biasX={0} biasY={0} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
