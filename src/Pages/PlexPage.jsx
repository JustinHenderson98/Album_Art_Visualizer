import React, { useEffect, useMemo, useRef, useState } from "react";
import RecentGrid from "../components/recentGrid";

/**
 * PlexPage
 * - Self-host friendly page that fetches a user's listening history from a specific Plex Media Server
 * - Uses /status/sessions/history/all to get plays and filters to music tracks
 * - Maps album/track thumbs to RecentGrid tiles
 *
 * Requirements to work in-browser:
 *  - Serve this SPA from the same origin as your PMS (or via a reverse proxy) to avoid CORS issues.
 *  - Provide a valid X-Plex-Token with at least read access on the target server.
 */

const store = {
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  get(key) { const x = localStorage.getItem(key); try { return x ? JSON.parse(x) : null; } catch { return null; } },
  del(key) { localStorage.removeItem(key); },
};

const PLEX_SETTINGS_KEY = "plex_settings_v1";

function usePlexSettings() {
  const [settings, setSettings] = useState(() => store.get(PLEX_SETTINGS_KEY) || {
    serverUrl: "/plexapi",           // ← dev proxy path (recommended); change to full PMS URL only if same-origin
    token: "",
    accountId: "",                   // numeric id from /accounts or from history's accountID
    mediaKind: "music",              // "music" | "video" | "all"
  });

  useEffect(() => { store.set(PLEX_SETTINGS_KEY, settings); }, [settings]);
  return [settings, setSettings];
}

// --- Helpers ---
const trimSlash = (s) => s;

const withToken = (base, path, token) =>
  `${trimSlash(base)}${path}${path.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(token)}`;

// Normalize a Plex art path:
// - fix backslashes
// - strip absolute host to keep it RELATIVE (needed for transcoder + proxy)
// - ensure it starts with "/"
function asRelativePath(p) {
  if (!p) return "";
  let v = p.replace(/\\+/g, "/");        // fix backslashes like http:\\\\...
  try {
    const u = new URL(v, "http://placeholder");
    // If it looks absolute (http/https), keep only path+search
    if (/^https?:$/i.test(u.protocol) && u.host !== "placeholder") {
      return (u.pathname || "/") + (u.search || "");
    }
  } catch { /* not a URL, keep as-is */ }
  return v.startsWith("/") ? v : `/${v}`;
}

function isValidThumb(p){
    console.log("isValidThumb: " +p); 
    return !p.endsWith("-1");
} 

/** Use the photo transcoder to get a square image. Pass a *relative* path. */
function transcodeSquare(base, relPath, token, size = 512) {
    console.log("relPath: " + relPath);
  if (!relPath || !isValidThumb(relPath)){
    console.log("returning null");
    return null;
  } 
  const rel = asRelativePath(relPath);
  console.log("base " + base);
  console.log({rel});
  const qs = new URLSearchParams({
    width: String(size),
    height: String(size),
    minSize: "1",
    upscale: "1",
    url: rel, // e.g. "/library/metadata/14475/thumb/1699962721"
  });
  return `${trimSlash(base)}/photo/:/transcode?${qs.toString()}&X-Plex-Token=${encodeURIComponent(token)}`;
}

/** Pick best available artwork (prefer album/parent), ignore “-1”, transcode to square. */
function resolveThumbUrl(node, base, token) {
    console.log(node);
    const candidates = [
    node.getAttribute("grandparentThumb"),
    node.getAttribute("parentThumb"),
    node.getAttribute("thumb"),
    node.getAttribute("grandparentArt"),
    node.getAttribute("art"),
  ];
  console.log("candidates: " + candidates);

  for (const c of candidates) {
    console.log("candidate: " + c);
    if (!isValidThumb(c)){
        console.log("invalid: " + c);
        continue;
    }
    console.log("before transcode " + base);
    const url = transcodeSquare(base, c, token, 512);
    console.log("transcode " + url);
    if (url) return url;
  }
  console.log("resolveThumbUrl return null")
  return null;
}

async function fetchXml(url) {
  const res = await fetch(url, {
    headers: {
      // Optional (some setups like to see these headers):
      "X-Plex-Product": "AlbumArtVisualizer",
      "X-Plex-Version": "1.0",
      "X-Plex-Client-Identifier": "aav-web-client",
    },
  });
  if (!res.ok) throw new Error(`Plex GET ${url} -> ${res.status}`);
  const txt = await res.text();
  return new window.DOMParser().parseFromString(txt, "text/xml");
}

function parseAccounts(xml) {
  const out = [];
  const nodes = xml.querySelectorAll("MediaContainer > Account");
  nodes.forEach((n) => {
    const id = n.getAttribute("id") || "";
    const name = n.getAttribute("name") || "";
    if (id) out.push({ id, name });
  });
  return out;
}

function parseHistory(xml) {
  // Returns array of { kind: 'track'|'video', type: 'track'|'movie'|'episode', viewedAt:number, node: Element }
  const out = [];
  const mc = xml.querySelector("MediaContainer");
  if (!mc) return out;

  mc.querySelectorAll("Video, Track").forEach((n) => {
    const tag = n.tagName; // 'Video' | 'Track'
    const type = n.getAttribute("type") || (tag === "Track" ? "track" : "video");
    const viewedAt = Number(n.getAttribute("viewedAt") || "0");
    out.push({ kind: tag === "Track" ? "track" : "video", type, viewedAt, node: n });
  });

  out.sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0));
  return out;
}

function buildTileFromTrack(node, base, token) {
  const id =
    node.getAttribute("grandparentKey") ||
    node.getAttribute("parentKey") ||
    node.getAttribute("ratingKey") ||
    node.getAttribute("historyKey") ||
    crypto.randomUUID();

  const src = resolveThumbUrl(node, base, token);
  console.log("src " + src);
  if (!src) return null;
  return { id, src };
}

function buildTileFromVideo(node, base, token) {
  const id =
    node.getAttribute("ratingKey") ||
    node.getAttribute("historyKey") ||
    crypto.randomUUID();

  const src = resolveThumbUrl(node, base, token);
  if (!src) return null;
  return { id, src };
}

function makePlexFetcher({ serverUrl, token, accountId, mediaKind = "music", take = 6 }) {
  const base = serverUrl
  console.log("ServerUrl " + base);
  return async () => {
    if (!base || !token) return { tiles: [] };

    // Build URL for session history; server may ignore accountID -> we filter client-side too
    const qp = new URLSearchParams();
    if (accountId) qp.set("accountID", accountId);

    const url = withToken(base, `/status/sessions/history/all?${qp.toString()}`, token);
    const xml = await fetchXml(url);
    const entries = parseHistory(xml);

    // Client-side filter by user to be safe
    const byUser = accountId
      ? entries.filter(e => String(e.node.getAttribute("accountID")) === String(accountId))
      : entries;

    // Filter by media kind
    const filtered = byUser.filter((e) => {
      if (mediaKind === "music") return e.kind === "track" || e.type === "track";
      if (mediaKind === "video") return e.kind === "video" && (e.type === "movie" || e.type === "episode");
      return true; // all
    });

    const seen = new Set();
    const tiles = [];
    for (const e of filtered) {
      const node = e.node;
      const tile = e.kind === "track"
        ? buildTileFromTrack(node, base, token)
        : buildTileFromVideo(node, base, token);
      if (!tile) continue;
      if (seen.has(tile.id)) continue;
      seen.add(tile.id);
      tiles.push(tile);
      console.log("tile: " + tile.src);
      if (tiles.length >= take) break;
    }

    if (import.meta.env.DEV) {
      console.log("[PlexFetcher] url:", url);
      console.log("[PlexFetcher] entries:", entries.length, "user-filtered:", byUser.length, "tiles:", tiles.length);
    }
    console.log(tiles);
    return { tiles };
  };
}

export default function PlexPage() {
  const [settings, setSettings] = usePlexSettings();
  const { serverUrl, token, accountId, mediaKind } = settings;

  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Load accounts when server/token change
  useEffect(() => {
    (async () => {
      setError("");
      setAccounts([]);
      if (!serverUrl || !token) return;
      setLoadingAccounts(true);
      try {
        const url = withToken(serverUrl, "/accounts/", token);
        const xml = await fetchXml(url);
        const list = parseAccounts(xml);
        setAccounts(list);
        // Auto-select the first account if none selected
        if (!accountId && list.length) {
          setSettings((s) => ({ ...s, accountId: list[0].id }));
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingAccounts(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, token]);

  const source = useMemo(
    () => makePlexFetcher({ serverUrl, token, accountId, mediaKind }),
    [serverUrl, token, accountId, mediaKind]
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500" />
            <div>
              <div className="text-lg font-semibold">Plex Visualizer</div>
              <div className="text-xs text-neutral-400">Self-hosted; reads play history from your PMS</div>
            </div>
          </div>
        </header>

        <main className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <section className="lg:col-span-2 order-2 lg:order-1">
            <div className="h-[70vh] w-full bg-black rounded-2xl overflow-hidden">
              {serverUrl && token ? (
                <RecentGrid source={source} pollMs={30000} full gap={30} />
              ) : (
                <div className="h-full w-full grid place-items-center text-neutral-400 text-sm">
                  Enter your Plex server URL and token to begin.
                </div>
              )}
            </div>
          </section>

          <aside className="order-1 lg:order-2">
            <div className="bg-neutral-900 rounded-2xl p-4 shadow-xl space-y-4">
              <div>
                <label className="text-sm text-neutral-300">Server URL</label>
                <input
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-neutral-800 outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="/plexapi"
                  value={serverUrl}
                  onChange={(e) => setSettings({ ...settings, serverUrl: e.target.value })}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Use <code>/plexapi</code> when developing with the Vite proxy, or a full PMS URL if serving from the same origin.
                </p>
              </div>

              <div>
                <label className="text-sm text-neutral-300">X-Plex-Token</label>
                <input
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-neutral-800 outline-none focus:ring-2 focus:ring-amber-500"
                  type="password"
                  placeholder="Paste your Plex token"
                  value={token}
                  onChange={(e) => setSettings({ ...settings, token: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-neutral-300">User</label>
                  <select
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-neutral-800 outline-none focus:ring-2 focus:ring-amber-500"
                    disabled={!accounts.length || loadingAccounts}
                    value={accountId}
                    onChange={(e) => setSettings({ ...settings, accountId: e.target.value })}
                  >
                    {accounts.length === 0 && <option value="">{loadingAccounts ? "Loading..." : "No accounts found"}</option>}
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name || `Account ${a.id}`}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm text-neutral-300">Media Type</label>
                  <select
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-neutral-800 outline-none focus:ring-2 focus:ring-amber-500"
                    value={mediaKind}
                    onChange={(e) => setSettings({ ...settings, mediaKind: e.target.value })}
                  >
                    <option value="music">Music</option>
                    <option value="video">Video (Movies/TV)</option>
                    <option value="all">All</option>
                  </select>
                </div>
              </div>

              {error && <div className="text-rose-400 text-sm">{error}</div>}

              <div className="text-xs text-neutral-400 pt-2 border-t border-neutral-800">
                <p>
                  <strong>Privacy:</strong> This page stores the PMS URL, token, and selected user in your browser's localStorage. Nothing is sent to any backend.
                </p>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
