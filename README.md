### Album Art Visualizer

A zero-backend, React + Vite visualizer that renders a 2×3 grid of animated “album tunnels.”
It currently supports Spotify via client-side PKCE and is structured to add other services (e.g., Plex) behind separate routes/pages.

> Non-commercial use only. See License and Legal/TOS below.

## Features

* Service-agnostic UI: a RecentGrid component that accepts either a fetcher function or a static list of images.
* Per-service pages: each music/media service lives on its own route and page (/spotify today, /plex next).
* Smooth visuals: layered “tunnel” effect with configurable knobs.
* Self-host friendly: static build; deploy behind any web server.

## Routes & Structure
```
src/
  components/
    recentGrid.jsx      # Grid + polling orchestrator (pluggable data source)
    AlbumTunnel.jsx     # Tunnel visual for a single image
  App.jsx               # Routes: "/" (home) → service links
  SpotifyPage.jsx       # Spotify PKCE + page logic mounted at /spotify
```

* Home (/) — a simple landing page with links to services.
* Spotify (/spotify) — OAuth+visualizer flow (PKCE, no backend).
* Plex (/plex) — planned: separate page with its own logic & fetcher.

> Make sure your Spotify Redirect URI in the developer dashboard is set to your deployed /spotify URL (exact match).

## Component API

# RecentGrid

```
<RecentGrid
  source={async () => ({ tiles, retryMs })} // preferred: provide a fetcher
  // OR: source={[ "https://example.com/a.jpg", { id: "b", src: "..." } ]}
  full
  gap={30}
  pollMs={10000}
  maxTiles={6}
  knobs={{ /* forwarded to AlbumTunnel */ }}
/>
```

Source contract

```
type Tile = { id: string; src: string };
type SourceResult = { tiles: Tile[]; retryMs?: number };
type Source = () => Promise<SourceResult>;
```

* If source is a function, RecentGrid will poll it on an interval (respecting retryMs for backoff).
* If source is an array, it’s treated as static (no polling).

## Setup

# Prerequisites

* Node: v22.18.0
* npm: 10.9.3

# Install
```npm i```

# Environment

Copy .env.sample → .env and set your Spotify Client ID:
```VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id```

# Dev

```npm run dev```

# Build & Preview

```
npm run build
npm run preview
```

# Self-Hosting

Nginx
```
location / {
  try_files $uri /index.html;
}
```
Apache (.htaccess)

```
RewriteEngine On
RewriteBase /
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

Add your production redirect URI (e.g., https://yourdomain/spotify) in the Spotify Dashboard.

## Privacy

* This app runs entirely in the browser. No server stores your data.
* OAuth tokens are stored in localStorage on your device for session continuity.
* Tokens are only used to call the provider APIs needed to render album art.
* To remove tokens, click Disconnect in the UI or clear browser storage.
* Do not deploy this as-is for production user data without reviewing wallet/session hardening, token lifetime handling, and CSP/headers.

## Legal / TOS
* Personal, non-commercial use only. Some streaming services (e.g., Spotify) impose restrictions on usage and branding. By using this project you agree to comply with those terms and any applicable developer policies. This project is provided for educational/demonstration purposes.

## License

<b> TBD </b>

## Extending to Other Services

* Add a route and page for each service (e.g., /plex → PlexPage.jsx).
* Implement a fetcher that returns { tiles, retryMs? }.
* Pass that fetcher to RecentGrid via the source prop.
* Keep any service-specific auth and API logic inside that page.

Example fetcher shape:

```
async function MyServiceFetcher() {
  // fetch recent items...
  const tiles = results.slice(0, 6).map(x => ({ id: x.id, src: x.imageUrl }));
  return { tiles, retryMs: 15000 };
}
```

## Troubleshooting

* VITE_SPOTIFY_CLIENT_ID undefined
Ensure .env exists, variable names start with VITE_, and restart the dev server.
* High CPU usage / black flash on refresh
Reduce LAYERS, tweak GROWTH, or increase pollMs.
* 429 rate limit from providers
Your fetcher should surface retryMs; RecentGrid will back off automatically.

## Roadmap

* ✅ Spotify page at /spotify
* 🔜 Plex page at /plex
* 🔜 Apple page at /apple
* 🔜 LastFm page at /lastfm
* 🔜 Pandora page at /pandora

## Contributing

PRs are welcome for:
* Additional service pages
* Performance improvements
* Docs and examples