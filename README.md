# MTA Bus Tracker

This repository is a small webapp to track MTA buses using the GTFS-RT vehicle positions feed.

Features
- Map powered by Leaflet
- Search by vehicle ID(s) or by route ID
- Auto-refresh (20s)
- Uses protobufjs to parse GTFS-RT protobufs in the browser

Setup
1. Get a GTFS-RT API key from MTA (the app expects the `vehiclePositions` feed key).
2. Serve this directory over HTTP(S). Example:

   ```bash
   python -m http.server 8000
   # open http://localhost:8000
   ```

3. Open the page, enter your GTFS-RT API key (you can save it to localStorage), then enter vehicle IDs or a route ID and press Track.

Notes
- The app loads the GTFS-RT proto from the official Google Transit repo. If you prefer to store the proto in this repo, add `gtfs-realtime.proto` in the root.
- Keep your API key secret. The app stores it in localStorage if you click "Save key".

Advanced
If you'd like I can:
- Convert this to a single-page app using a build tool
- Add clustering for many vehicle markers
- Add real-time paths/trailers
