import React, { useEffect, useMemo, useRef, useState } from "react";
import RecentGrid from "./components/recentGrid";

// =====================
// 🔧 CONFIG
// =====================
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

// Route we want Spotify to return to:
const REDIRECT_PATH = "/spotify";
const REDIRECT_URI =
  typeof window !== "undefined"
    ? new URL(REDIRECT_PATH, window.location.origin).toString()
    : "http://localhost:5173/spotify";

const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",
];

// =====================
// PKCE Helpers
// =====================
function base64UrlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  return await crypto.subtle.digest("SHA-256", data);
}
function makeCodeVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => ("0" + b.toString(16)).slice(-2))
    .join("")
    .slice(0, 128);
}
async function makeCodeChallenge(codeVerifier) {
  const hashed = await sha256(codeVerifier);
  return base64UrlEncode(hashed);
}

// =====================
// Small storage utils
// =====================
const store = {
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  get(key) { const x = localStorage.getItem(key); try { return x ? JSON.parse(x) : null; } catch { return null; } },
  del(key) { localStorage.removeItem(key); },
};

// =====================
// Spotify API wrappers
// =====================
async function tokenFromAuthCode({ code, verifier }) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return await res.json();
}

async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  return await res.json();
}

async function apiGet(path, access_token) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (res.status === 204) return null;
  if (res.status === 401) {
    const err = new Error("Unauthorized");
    err.code = 401;
    throw err;
  }
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return await res.json();
}

// =====================
// BYO data fetcher for RecentGrid
// =====================
function SpotifyFetcher(token, { limit = 50, take = 6 } = {}) {
  return async () => {
    if (!token?.access_token) return { tiles: [] };

    const res = await fetch(
      `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    if (res.status === 429) {
      const retrySec = Number(res.headers.get("Retry-After") || 15);
      return { tiles: [], retryMs: retrySec * 1000 };
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
      if (fresh.length >= take) break;
    }

    return { tiles: fresh };
  };
}

// =====================
// Page component mounted at /spotify
// =====================
export default function SpotifyPage() {
  const [token, setToken] = useState(() => store.get("spotify_token"));
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  // Handle OAuth redirect on /spotify
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    async function doExchange() {
      const storedState = store.get("pkce_state");
      const verifier = store.get("pkce_verifier");
      if (!code || !verifier || state !== storedState) return;
      try {
        const tok = await tokenFromAuthCode({ code, verifier });
        const payload = {
          ...tok,
          received_at: Date.now(),
          expires_at: Date.now() + tok.expires_in * 1000,
        };
        store.set("spotify_token", payload);
        store.del("pkce_state");
        store.del("pkce_verifier");
        // Clean the URL in-place, stay on /spotify
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState({}, "", url.toString());
        setToken(payload);
      } catch (e) {
        setError(e.message);
      }
    }
    doExchange();
  }, []);

  const refreshingRef = useRef(false);
  const isTokenFresh = (t, skewMs = 60_000) =>
    !!(t?.access_token && t?.expires_at && Date.now() < t.expires_at - skewMs);

  async function safeRefresh(t) {
    if (refreshingRef.current || !t?.refresh_token) return null;
    refreshingRef.current = true;
    try {
      const rt = await refreshToken(t.refresh_token);
      const newTok = {
        ...t,
        access_token: rt.access_token,
        expires_in: rt.expires_in,
        expires_at: Date.now() + rt.expires_in * 1000,
        refresh_token: rt.refresh_token ?? t.refresh_token, // Spotify may rotate
        received_at: Date.now(),
      };
      store.set("spotify_token", newTok);
      setToken(newTok);
      return newTok;
    } catch (e) {
      setError(`Refresh error: ${e.message}`);
      return null;
    } finally {
      refreshingRef.current = false;
    }
  }

  // Top-up immediately if needed + schedule a refresh slightly before expiry
  useEffect(() => {
    if (!token?.refresh_token) return;

    if (!isTokenFresh(token, 60_000)) { void safeRefresh(token); }

    const delay = Math.max(0, (token.expires_at ?? 0) - Date.now() - 60_000);
    const handle = setTimeout(() => safeRefresh(token), delay);
    return () => clearTimeout(handle);
  }, [token?.refresh_token, token?.expires_at]);

  // Fetch profile once (or when token changes)
  useEffect(() => {
    (async () => {
      if (!token?.access_token) return;
      try { setProfile(await apiGet("/me", token.access_token)); }
      catch (e) { setError(e.message); }
    })();
  }, [token?.access_token]);

  function login() {
    const verifier = makeCodeVerifier();
    makeCodeChallenge(verifier).then((challenge) => {
      const state = Math.random().toString(36).slice(2);
      store.set("pkce_state", state);
      store.set("pkce_verifier", verifier);
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,            // <<— now points to /spotify
        code_challenge_method: "S256",
        code_challenge: challenge,
        state,
        scope: SCOPES.join(" "),
      });
      window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
    });
  }

  function logout() {
    store.del("spotify_token");
    setToken(null);
  }

  const signedIn = !!(token?.access_token || token?.refresh_token);
  const source = useMemo(
    () => SpotifyFetcher(token),
    [token?.access_token, token?.expires_at]
  );

  return signedIn ? (
    <div className="h-svh w-full bg-black overflow-hidden">
      <RecentGrid source={source} pollMs={30000} full gap={30} />
    </div>
  ) : (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500" />
            <div>
              <div className="text-lg font-semibold">Album Art Visualizer</div>
              <div className="text-xs text-neutral-400">Spotify visualizer (PKCE, no backend)</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {profile && <div className="text-sm text-neutral-300">{profile.display_name}</div>}
            {token ? (
              <button onClick={logout} className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700">
                Disconnect
              </button>
            ) : (
              <button onClick={login} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500">
                Connect Spotify
              </button>
            )}
          </div>
        </header>

        <main className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start bg-black">
          <aside className="order-1 lg:order-2">
            <div className="bg-neutral-900 rounded-2xl p-4 shadow-xl">
              {error && <div className="mt-3 text-rose-400 text-sm">{error}</div>}
              {!token && (
                <div className="mt-3 text-xs text-neutral-400">
                  Set <code>VITE_SPOTIFY_CLIENT_ID</code> and add <code>{REDIRECT_URI}</code> to your Spotify app’s Redirect URIs.
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
