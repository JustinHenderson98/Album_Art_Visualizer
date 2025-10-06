import React, { useEffect, useMemo, useRef, useState } from "react";
import RecentGrid from "./components/recentGrid";
// =====================
// 🔧 CONFIG — EDIT ME
// =====================
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = (typeof window !== "undefined" && window.location.origin) || "http://localhost:5173/"; // add this in your Spotify app
console.log('REDIRECT_URI being sent:', REDIRECT_URI);
const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",  // 👈 needed for RecentGrid
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
// Small utilities
// =====================
const store = {
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  get(key) { const x = localStorage.getItem(key); try { return x ? JSON.parse(x) : null; } catch { return null; } },
  del(key) { localStorage.removeItem(key); },
};

function millisToClock(ms) {
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60);
  const s = (t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

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
// Main App
// =====================
export default function App() {
  const [token, setToken] = useState(() => store.get("spotify_token"));
  const [profile, setProfile] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState("");

  // --- Handle OAuth redirect ---
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

  let refreshing = false;
  const isTokenFresh = (t, skewMs = 60_000) =>
    !!(t?.access_token && t?.expires_at && Date.now() < t.expires_at - skewMs);


  async function safeRefresh(t) {
    if (refreshing) return null;
    refreshing = true;
    try {
      const rt = await refreshToken(t.refresh_token);
      const newTok = {
        ...t,
        access_token: rt.access_token,
        expires_in: rt.expires_in,
        expires_at: Date.now() + rt.expires_in * 1000,
        refresh_token: rt.refresh_token ?? t.refresh_token, // Spotify rotates sometimes
        received_at: Date.now(),
      };
      store.set("spotify_token", newTok);
      setToken(newTok);
      return newTok;
    } catch (e) {
      // Try to read the body for specific errors
      try {
        const clone = e.response ? await e.response.json() : null;
        if (clone?.error === "invalid_grant") {
          // Only now do a hard logout
          store.del("spotify_token");
          setToken(null);
        }
      } catch {}
      // For any other error, keep tokens and surface an error; we can retry on next tick
      setError(`Refresh error: ${e.message}`);
      return null;
    } finally {
      refreshing = false;
    }
  }

  useEffect(() => {
    if (!token?.refresh_token) return;

    // immediate top-up if not fresh
    if (!isTokenFresh(token, 60_000)) { safeRefresh(token); }

    // schedule one refresh slightly before expiry
    const delay = Math.max(0, (token.expires_at ?? 0) - Date.now() - 60_000);
    const handle = setTimeout(() => safeRefresh(token), delay);

    return () => clearTimeout(handle);
  }, [token?.refresh_token, token?.expires_at]);


  useEffect(() => {
    if (!token) return;
    const id = setInterval(async () => {
      if (Date.now() > (token.expires_at - 30_000) && token.refresh_token) {
        try {
          const rt = await refreshToken(token.refresh_token);
          const newTok = {
            ...token,
            access_token: rt.access_token,
            expires_in: rt.expires_in,
            expires_at: Date.now() + rt.expires_in * 1000,
            refresh_token: rt.refresh_token ?? token.refresh_token,
          };
          store.set("spotify_token", newTok);
          setToken(newTok);
        } catch (e) {
          store.del("spotify_token");
          setToken(null);
          setError(e.message);
        }
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [token]);

  // --- Fetch profile once ---
  useEffect(() => {
    (async () => {
      if (!token?.access_token) return;
      try { setProfile(await apiGet("/me", token.access_token)); }
      catch (e) { setError(e.message); }
    })();
  }, [token]);
            const [artEnergy, setArtEnergy] = useState(0.65); // optional visual knob


  function login() {
    const verifier = makeCodeVerifier();
    makeCodeChallenge(verifier).then((challenge) => {
      const state = Math.random().toString(36).slice(2);
      store.set("pkce_state", state);
      store.set("pkce_verifier", verifier);
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
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

  const album = playing?.item?.album;
  const artists = useMemo(() => playing?.item?.artists?.map(a => a.name).join(", ") || "", [playing]);
  const isPlaying = playing?.is_playing;
  const progress = playing ? playing.progress_ms : 0;
  const duration = playing?.item?.duration_ms || 0;
  const img = album?.images?.[0]?.url || "";
  const signedIn = !!(token?.access_token || token?.refresh_token);
  console.log(signedIn);
  console.log(token?.access_token);


return signedIn ? (
<div className="h-svh w-full bg-black overflow-hidden">
  <RecentGrid token={token} full gap={30} />
</div>
) : ( <div className="min-h-screen bg-neutral-950 text-neutral-100" >
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500" />
            <div>
              <div className="text-lg font-semibold">TunnelTunes</div>
              <div className="text-xs text-neutral-400">Spotify visualizer (PKCE, no backend)</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {profile && <div className="text-sm text-neutral-300">{profile.display_name}</div>}
            {token ? (
              <button onClick={logout} className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700">Disconnect</button>
            ) : (
              <button onClick={login} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500">Connect Spotify</button>
            )}
          </div>
        </header>

        <main className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start bg-black">
          <aside className="order-1 lg:order-2">
            <div className="bg-neutral-900 rounded-2xl p-4 shadow-xl">
              <div className="flex gap-4">
                {img ? (
                  <img src={img} alt="album" className="w-28 h-28 object-cover rounded-xl" />
                ) : (
                  <div className="w-28 h-28 rounded-xl bg-neutral-800" />
                )}                
                <div className="flex-1">
                  <div className="font-semibold text-lg leading-tight line-clamp-2">{playing?.item?.name || "Nothing playing"}</div>
                  <div className="text-sm text-neutral-400 line-clamp-1">{artists}</div>
                  <div className="text-xs text-neutral-500 mt-1">{album?.name}</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }} />
                </div>
                <div className="flex justify-between text-xs text-neutral-500 mt-1">
                  <span>{millisToClock(progress)}</span>
                  <span>{millisToClock(duration)}</span>
                </div>
              </div>

              {features && (
                <div className="grid grid-cols-2 gap-3 text-sm mt-4">
                  <Stat label="Tempo" value={`${Math.round(features.tempo)} bpm`} />
                  <Stat label="Energy" value={features.energy.toFixed(2)} />
                  <Stat label="Danceability" value={features.danceability.toFixed(2)} />
                  <Stat label="Valence" value={features.valence.toFixed(2)} />
                </div>
              )}

              {error && <div className="mt-3 text-rose-400 text-sm">{error}</div>}
              {!token && (
                <div className="mt-3 text-xs text-neutral-400">
                  Set <code>CLIENT_ID</code> and add <code>{REDIRECT_URI}</code> to your Spotify app's Redirect URIs.
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}


function computeImageEnergy(url, cb) {
  if (!url) return cb(0.65);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const c = document.createElement("canvas");
    const s = 48; c.width = c.height = s;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, s, s);
    const { data } = ctx.getImageData(0, 0, s, s);
    let sum = 0, sumSq = 0, n = data.length/4;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]; // luminance
      sum += l; sumSq += l*l;
    }
    const mean = sum / n;
    const varc = Math.max(0, sumSq/n - mean*mean); // contrast proxy
    // map brightness + contrast to [0..1]
    const brightness = mean / 255;
    const contrast = Math.min(1, Math.sqrt(varc)/128);
    cb(Math.min(1, 0.4*brightness + 0.6*contrast));
  };
  img.onerror = () => cb(0.65);
  img.src = url;
}


function Stat({ label, value }) {
  return (
    <div className="bg-neutral-800 rounded-xl p-3">
      <div className="text-neutral-400 text-xs">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
