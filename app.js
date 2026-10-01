const PROTO_URL = 'https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto';
const DEFAULT_REFRESH_MS = 20000;

const state = {
  map: null,
  markers: {},
  rootPromise: null,
  intervalId: null,
  activeRouteFilter: null,
  latestMatches: [],
  routeColorCache: new Map()
};

const els = {
  apiKey: document.getElementById('apiKey'),
  saveKey: document.getElementById('saveKey'),
  clearKey: document.getElementById('clearKey'),
  mode: document.getElementById('mode'),
  query: document.getElementById('query'),
  queryLabel: document.getElementById('queryLabel'),
  trackBtn: document.getElementById('track'),
  auto: document.getElementById('auto'),
  status: document.getElementById('status'),
  last: document.getElementById('last'),
  error: document.getElementById('error'),
  routeList: document.getElementById('routeList'),
  routeLegend: document.getElementById('routeLegend'),
  clearRouteFilter: document.getElementById('clearRouteFilter')
};

function setStatus(message) {
  els.status.textContent = message;
}

function setError(message) {
  els.error.textContent = message || '';
}

function getApiKey() {
  return (els.apiKey.value || localStorage.getItem('gtfs_rt_key') || '').trim();
}

function saveKeyToLocalStorage() {
  const key = (els.apiKey.value || '').trim();
  if (!key) {
    setError('Enter a GTFS-RT key first.');
    return;
  }
  localStorage.setItem('gtfs_rt_key', key);
  setError('');
  setStatus('API key saved');
}

function clearSavedKey() {
  localStorage.removeItem('gtfs_rt_key');
  els.apiKey.value = '';
  setError('');
  setStatus('Saved key cleared');
}

function routeColor(route) {
  if (!route) return '#6b7280';
  if (state.routeColorCache.has(route)) return state.routeColorCache.get(route);

  let hash = 0;
  for (let i = 0; i < route.length; i += 1) {
    hash = route.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  const color = `hsl(${hue} 72% 52%)`;
  state.routeColorCache.set(route, color);
  return color;
}

function updateModeLabel() {
  const isVehicleMode = els.mode.value === 'vehicle';
  els.queryLabel.textContent = isVehicleMode ? 'Vehicle IDs' : 'Route ID';
  els.query.placeholder = isVehicleMode ? 'e.g. 7560, 4321' : 'e.g. B41';
}

async function loadProto() {
  if (!window.protobuf || !window.protobuf.parse) {
    throw new Error('protobufjs failed to load');
  }

  const response = await fetch(PROTO_URL);
  if (!response.ok) {
    throw new Error(`Proto load failed: ${response.status}`);
  }

  const protoText = await response.text();
  return window.protobuf.parse(protoText).root;
}

function initLeafletMap() {
  state.map = L.map('map', { preferCanvas: true }).setView([40.7128, -74.006], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
}

function renderRouteList(matches) {
  const routeCounts = new Map();
  matches.forEach((match) => {
    if (!match.route) return;
    const normalized = String(match.route);
    routeCounts.set(normalized, (routeCounts.get(normalized) || 0) + 1);
  });

  const sortedRoutes = [...routeCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  els.routeLegend.innerHTML = '';
  els.routeList.innerHTML = '';

  if (!sortedRoutes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No active routes';
    els.routeList.appendChild(empty);
    return;
  }

  sortedRoutes.forEach(([route, count]) => {
    const chip = document.createElement('div');
    chip.className = 'legend-chip';
    chip.innerHTML = `<span class="legend-swatch" style="background:${routeColor(route)}"></span><span>${route}</span>`;
    els.routeLegend.appendChild(chip);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-pill';
    const selected = state.activeRouteFilter === route;
    if (selected) {
      button.classList.add('selected');
      button.style.color = routeColor(route);
      button.style.borderColor = routeColor(route);
    }
    button.innerHTML = `<span class="route-name">${route}</span><span class="route-count">${count}</span>`;
    button.addEventListener('click', () => {
      state.activeRouteFilter = state.activeRouteFilter === route ? null : route;
      renderRouteList(state.latestMatches);
      applyRouteFilter();
    });
    els.routeList.appendChild(button);
  });
}

function applyRouteFilter() {
  const unfiltered = state.latestMatches.slice();
  const matches = state.activeRouteFilter
    ? unfiltered.filter((match) => match.route === state.activeRouteFilter)
    : unfiltered;
  updateMap(matches);
}

function clearMarkersNotIn(ids) {
  Object.keys(state.markers).forEach((id) => {
    if (!ids.has(id)) {
      state.map.removeLayer(state.markers[id]);
      delete state.markers[id];
    }
  });
}

function updateMap(matches) {
  const present = new Set();

  matches.forEach((match) => {
    if (match.lat == null || match.lon == null) return;
    present.add(match.id);

    const color = match.route ? routeColor(match.route) : '#6b7280';

    if (!state.markers[match.id]) {
      const marker = L.circleMarker([match.lat, match.lon], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.9,
        weight: 2
      }).addTo(state.map);
      state.markers[match.id] = marker;
    } else {
      state.markers[match.id].setLatLng([match.lat, match.lon]);
      state.markers[match.id].setStyle({ color, fillColor: color });
    }

    state.markers[match.id].bindPopup(
      `<b>Vehicle ${match.id}</b><br />` +
      `Route: ${match.route || 'N/A'}<br />` +
      `Trip: ${match.trip || 'N/A'}<br />` +
      `Updated: ${match.timestamp ? new Date(match.timestamp * 1000).toLocaleTimeString() : 'N/A'}`
    );
  });

  clearMarkersNotIn(present);
}

async function fetchFeed(key) {
  const response = await fetch(`https://gtfsrt.prod.obanyc.com/vehiclePositions?key=${encodeURIComponent(key)}`);
  if (!response.ok) {
    throw new Error(`Feed fetch failed: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function parseFeed(bytes) {
  if (!state.rootPromise) {
    throw new Error('Proto not loaded');
  }

  const root = await state.rootPromise;
  const FeedMessage = root.lookupType('transit_realtime.FeedMessage');
  const decoded = FeedMessage.decode(bytes);
  return FeedMessage.toObject(decoded, {
    longs: Number,
    enums: String,
    defaults: false,
    arrays: true,
    objects: true
  });
}

function normalizeMatches(feedObj, mode, userInput) {
  if (!feedObj || !Array.isArray(feedObj.entity)) return [];

  const userVehicles = mode === 'vehicle'
    ? userInput.split(',').map((v) => v.trim()).filter(Boolean)
    : [];

  const matches = [];

  feedObj.entity.forEach((entity) => {
    if (!entity || !entity.vehicle || !entity.vehicle.vehicle) return;

    const vehicle = entity.vehicle;
    const id = vehicle.vehicle.id;
    if (!id) return;

    const route = vehicle.trip && (vehicle.trip.routeId || vehicle.trip.route);
    const trip = vehicle.trip && (vehicle.trip.tripId || vehicle.trip.trip);
    const lat = vehicle.position && (vehicle.position.latitude ?? vehicle.position.lat ?? null);
    const lon = vehicle.position && (vehicle.position.longitude ?? vehicle.position.lon ?? null);
    const timestamp = vehicle.timestamp || null;

    if (mode === 'vehicle') {
      if (!userVehicles.includes(String(id))) return;
    } else {
      const routeInput = userInput.trim();
      if (!routeInput || !route || String(route).toLowerCase() !== routeInput.toLowerCase()) return;
    }

    matches.push({
      id: String(id),
      lat,
      lon,
      route: route ? String(route) : null,
      trip: trip ? String(trip) : null,
      timestamp
    });
  });

  return matches;
}

async function runOnce() {
  setError('');
  setStatus('Fetching feed...');

  const key = getApiKey();
  if (!key) {
    setError('Missing API key. Add one above or save it.');
    setStatus('No API key');
    return;
  }

  try {
    const bytes = await fetchFeed(key);
    const feedObj = await parseFeed(bytes);
    const matches = normalizeMatches(feedObj, els.mode.value, els.query.value);

    state.latestMatches = matches;
    renderRouteList(matches);
    applyRouteFilter();

    const countText = matches.length === 1 ? '1 match' : `${matches.length} matches`;
    setStatus(`${countText} found`);
    els.last.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    console.error(error);
    setError(error.message || 'Unknown error');
    setStatus('Error');
  }
}

function startAutoRefresh() {
  if (state.intervalId) return;
  runOnce();
  state.intervalId = setInterval(runOnce, DEFAULT_REFRESH_MS);
}

function stopAutoRefresh() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

function init() {
  initLeafletMap();

  const savedKey = localStorage.getItem('gtfs_rt_key') || '';
  if (savedKey) {
    els.apiKey.value = savedKey;
  }

  state.rootPromise = loadProto().catch((error) => {
    setError(error.message);
    setStatus('Proto load failed');
    throw error;
  });

  updateModeLabel();
  els.mode.addEventListener('change', updateModeLabel);
  els.saveKey.addEventListener('click', saveKeyToLocalStorage);
  els.clearKey.addEventListener('click', clearSavedKey);
  els.trackBtn.addEventListener('click', runOnce);
  els.clearRouteFilter.addEventListener('click', () => {
    state.activeRouteFilter = null;
    renderRouteList(state.latestMatches);
    applyRouteFilter();
  });

  els.auto.addEventListener('change', () => {
    if (els.auto.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  state.rootPromise.then(() => {
    setStatus('Ready');
  }).catch(() => {
    // handled above
  });
}

window.addEventListener('DOMContentLoaded', init);
