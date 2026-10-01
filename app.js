const DEFAULT_KEY = 'Bus_Infrastructure_Mapping';
const DEFAULT_REFRESH_MS = 20000;

const state = {
  map: null,
  markers: {},
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
  return (els.apiKey.value || localStorage.getItem('gtfs_rt_key') || DEFAULT_KEY).trim() || DEFAULT_KEY;
}

function saveKeyToLocalStorage() {
  const key = (els.apiKey.value || '').trim() || DEFAULT_KEY;
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

async function fetchVehicleMonitoring(key, mode, userInput) {
  const baseUrl = 'https://bustime-classic.mta.info/api/siri/vehicle-monitoring.json';

  if (mode === 'vehicle') {
    const vehicleIds = userInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!vehicleIds.length) {
      return [];
    }

    const requests = vehicleIds.map((vehicleId) => {
      const url = new URL(baseUrl);
      url.searchParams.set('key', key);
      url.searchParams.set('VehicleRef', vehicleId);
      return fetch(url.toString(), {
        headers: {
          Accept: 'application/json'
        }
      });
    });

    const responses = await Promise.all(requests);
    const badResponse = responses.find((response) => !response.ok);
    if (badResponse) {
      throw new Error(`Feed fetch failed: ${badResponse.status}`);
    }

    return Promise.all(responses.map((response) => response.json()));
  }

  const routeInput = userInput.trim();
  if (!routeInput) {
    return [];
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', key);
  url.searchParams.set('LineRef', routeInput);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Feed fetch failed: ${response.status}`);
  }

  return [await response.json()];
}

function getVehicleActivityEntries(payload) {
  return (
    payload?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.flatMap(
      (delivery) => delivery?.VehicleActivity || []
    ) || []
  );
}

function normalizeMatches(feedResponses, mode, userInput) {
  const entries = feedResponses.flatMap((payload) => getVehicleActivityEntries(payload));
  if (!entries.length) return [];

  const userVehicles = mode === 'vehicle'
    ? userInput.split(',').map((value) => value.trim()).filter(Boolean).map(String)
    : [];

  const matches = [];

  entries.forEach((entry) => {
    if (!entry) return;

    const journey = entry.MonitoredVehicleJourney || {};
    const id = journey.VehicleRef || null;
    if (!id) return;

    const route = journey.PublishedLineName || journey.LineRef || null;
    const trip = journey.DatedVehicleJourneyRef || journey.JourneyPatternRef || null;
    const lat = journey.VehicleLocation && (journey.VehicleLocation.Latitude ?? journey.VehicleLocation.latitude ?? null);
    const lon = journey.VehicleLocation && (journey.VehicleLocation.Longitude ?? journey.VehicleLocation.longitude ?? null);
    const timestamp = entry.RecordedAtTime ? new Date(entry.RecordedAtTime).getTime() / 1000 : null;

    if (mode === 'vehicle') {
      const normalizedId = String(id).split('_').pop();
      const userVehicleValues = userVehicles.map((value) => String(value).split('_').pop());
      if (!userVehicleValues.includes(normalizedId)) return;
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
  try {
    const payloads = await fetchVehicleMonitoring(key, els.mode.value, els.query.value);
    const matches = normalizeMatches(payloads, els.mode.value, els.query.value);

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
  } else {
    els.apiKey.value = DEFAULT_KEY;
  }

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

  setStatus('Ready');
}

window.addEventListener('DOMContentLoaded', init);
