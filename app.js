// Browser-only app.js (no ES module imports)
// Reads GTFS_RT_KEY from window.GTFS_RT_KEY
const GTFS_RT_KEY = window.GTFS_RT_KEY || "REPLACE_WITH_YOUR_KEY";

// MTA vehicle positions API
const VEH_URL =
  `https://gtfsrt.prod.obanyc.com/vehiclePositions?key=${GTFS_RT_KEY}`;

// Ensure DOM is ready - scripts are loaded at end of body, so elements exist
let map = L.map("map").setView([40.7128, -74.0060], 12);

// Add base map
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

let markers = {}; // store markers by vehicle ID

// Load protobuf parser (uses global `protobuf` from protobufjs)
async function loadProto() {
  if (!window.protobuf) throw new Error("protobufjs (protobuf) is not loaded");
  const response = await fetch("gtfs-realtime.proto");
  const protoText = await response.text();
  return protobuf.parse(protoText).root;
}

const rootPromise = loadProto();

async function getFeed() {
  const resp = await fetch(VEH_URL);
  if (!resp.ok) throw new Error(`Feed fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();

  const root = await rootPromise;
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

  const message = FeedMessage.decode(new Uint8Array(buf));
  return FeedMessage.toObject(message);
}

function updateMap(matches) {
  // Remove markers for buses no longer present
  for (const id in markers) {
    if (!matches.find(m => m.id === id)) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  }

  // Add/update markers
  matches.forEach(m => {
    const lat = m.lat;
    const lon = m.lon;

    if (lat == null || lon == null) return; // skip incomplete positions

    if (!markers[m.id]) {
      markers[m.id] = L.marker([lat, lon]).addTo(map);
    } else {
      markers[m.id].setLatLng([lat, lon]);
    }

    markers[m.id].bindPopup(
      `Vehicle ${m.id}<br>
       Route: ${m.route || "N/A"}<br>
       Trip: ${m.trip || "N/A"}<br>
       Updated: ${m.timestamp ? new Date(m.timestamp * 1000).toLocaleTimeString() : "N/A"}`
    );
  });
}

async function track() {
  try {
    const vehInput = document.getElementById("veh").value.trim();
    if (!vehInput) return;

    const userVehicles = vehInput.split(",")
      .map(v => v.trim())
      .filter(v => v.length > 0);

    const feed = await getFeed();
    if (!feed || !feed.entity) return;

    const matches = [];

    feed.entity.forEach(e => {
      if (e.vehicle && e.vehicle.vehicle) {
        const id = e.vehicle.vehicle.id;

        if (userVehicles.includes(id)) {
          matches.push({
            id,
            lat: e.vehicle.position?.latitude,
            lon: e.vehicle.position?.longitude,
            route: e.vehicle.trip?.routeId,
            trip: e.vehicle.trip?.tripId,
            timestamp: e.vehicle.timestamp
          });
        }
      }
    });

    updateMap(matches);
  } catch (err) {
    console.error("track() error:", err);
    alert("Error fetching vehicle feed: " + err.message);
  }
}

// Expose track to the global scope so inline onclick handlers work
window.track = track;

setInterval(() => {
  try {
    if (document.getElementById("auto").checked) track();
  } catch (e) {
    // ignore if elements aren't present
  }
}, 20000);
