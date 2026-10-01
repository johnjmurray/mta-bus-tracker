# MTA Bus Tracker

A lightweight static web app for tracking active NYC MTA buses on a map in real time. The project is designed to run as a simple browser-based site with no build tooling or backend.

This repository is intentionally small and dependency-light: it serves a single HTML page, a stylesheet, and a JavaScript file that fetches the MTA Bus Time SIRI feeds and renders the results on a Leaflet map.

Features
- Live map of bus locations using Leaflet
- Search by one or more vehicle IDs or by route ID
- Route color legend and route filtering in the sidebar
- Auto-refresh every 20 seconds
- Optional localStorage persistence for the API key
- No install step or bundler required
- Route shape overlays for selected routes when available from MTA stop-monitoring data

Project layout
- `index.html` — app shell and UI elements
- `app.js` — fetches MTA SIRI data, normalizes responses, and updates the map
- `styles.css` — layout and styling for the dashboard
- `gtfs-realtime.proto` — included as a reference file; not required by the current frontend implementation
- `LICENSE` — MIT license

Requirements
- A browser with JavaScript enabled
- An MTA Bus Time / SIRI API key
- A local HTTP server (or GitHub Pages-style static hosting)

Setup
1. Get an MTA Bus Time API key.
2. Serve this directory over HTTP(S), for example:

   ```bash
   python -m http.server 8000
   # then open http://localhost:8000
   ```

3. Open the page in your browser.
4. Enter your API key, then choose either:
   - Vehicle IDs mode, e.g. `7560, 4321`
   - Route ID mode, e.g. `B41`
5. Press Track or enable Auto-refresh.

Notes
- The app stores the API key in `localStorage` when you click Save key.
- The default key in the app is a fallback demo value, but using your own MTA key is recommended.
- The app fetches data from the MTA Bus Time SIRI endpoints (`vehicle-monitoring` and `stop-monitoring`), not from a custom backend.
- This project is designed for static hosting and light local use. It is not a production-grade multi-user service.

Deployment
This repo is suitable for GitHub Pages or any static host. Because the app is fully client-side, deployment is typically just uploading the repository contents to a static host.

License
This project is licensed under the MIT License. See `LICENSE` for details.
