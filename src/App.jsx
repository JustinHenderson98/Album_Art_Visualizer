import { Routes, Route, Link } from "react-router-dom";
import SpotifyPage from "./Pages/SpotifyPage";
import PlexPage from "./Pages/PlexPage.jsx";


export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="min-h-screen bg-neutral-950 text-neutral-100">
            <div className="max-w-5xl mx-auto px-4 py-10">
              <h1 className="text-2xl font-semibold mb-3">Album Art Visualizer</h1>
              <p className="text-neutral-400">
                Choose a service to continue.
              </p>
              <div className="mt-6">
                <Link
                  to="/spotify"
                  className="inline-block px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500"
                >
                  Open Spotify Visualizer
                </Link>
                <br></br>
                <Link to="/plex"
                 className="inline-block px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500"
                >
                  Open Plex Visualizer
                </Link>
              </div>
            </div>
          </div>
        }
      />
      <Route path="/spotify" element={<SpotifyPage />} />
      <Route path="/plex" element={<PlexPage />} />
      <Route
        path="*"
        element={
          <div className="min-h-screen grid place-items-center bg-neutral-950 text-neutral-100">
            <div className="text-center">
              <div className="text-3xl font-semibold">404</div>
              <p className="text-neutral-400 mt-2">Not found</p>
              <Link to="/" className="mt-6 inline-block underline">
                Go home
              </Link>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
