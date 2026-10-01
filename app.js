// app.js (module) - Browser-friendly webapp for MTA GTFS-RT vehicle positions
// Uses Leaflet and protobufjs (loaded from CDN in index.html)

const PROTO_URL = 'https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto';
const DEFAULT_REFRESH_MS = 20000;

// DOM
const el = {
  apiKey: document.getElementById('apiKey'),
  saveKey: document.getElementById('saveKey'),
  clearKey: document.getElementById('clearKey'),
  mode: document.getElementById('mode'),
  query: document.getElementById('query'),
  trackBtn: document.getElementById('track'),
  auto: document.getElementById('auto'),
  status: document.getElementById('status'),
  last: document.getElementById('last'),
  error: document.getElementById('error')
};

let map, markers = {}, rootPromise, intervalId = null;

function setStatus(s){ el.status.textContent = s; }
function setError(msg){ el.error.textContent = msg || ''; }
function setLast(ts){ el.last.textContent = ts ? `Last update: ${new Date(ts).toLocaleTimeString()}` : 'Last update: never'; }

function saveKeyToStorage(key){ if(!key) { localStorage.removeItem('gtfs_key'); return; } localStorage.setItem('gtfs_key', key); }
function loadKeyFromStorage(){ return localStorage.getItem('gtfs_key') || ''; }

function getApiKey(){ return el.apiKey.value.trim() || loadKeyFromStorage(); }

async function loadProto(){
  if(window.protobuf && window.protobuf.parse) {
    const resp = await fetch(PROTO_URL);
    if(!resp.ok) throw new Error(`Failed to load proto: ${resp.status}`);
    const protoText = await resp.text();
    return protobuf.parse(protoText).root;
  }
  throw new Error('protobufjs not loaded');
}

async function init(){
  // initialize map
  map = L.map('map', {preferCanvas:true}).setView([40.7128, -74.0060], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  // load proto
  setStatus('Loading proto...');
  rootPromise = loadProto();
  try{
    await rootPromise;
    setStatus('Proto loaded. Ready');
  }catch(err){
    setError(err.message);
    setStatus('Error loading proto');
    console.error(err);
  }

  // wire events
  el.saveKey.addEventListener('click', ()=>{
    const k = el.apiKey.value.trim();
    if(!k){ setError('API key is empty'); return; }
    saveKeyToStorage(k);
    setError('');
    setStatus('API key saved');
  });

  el.clearKey.addEventListener('click', ()=>{
    saveKeyToStorage('');
    el.apiKey.value = '';
    setStatus('Saved key cleared');
  });

  el.trackBtn.addEventListener('click', ()=>{ runOnce(); });

  el.auto.addEventListener('change', ()=>{
    if(el.auto.checked) startAuto(); else stopAuto();
  });

  // load saved key into field (masked)
  const saved = loadKeyFromStorage();
  if(saved) el.apiKey.value = saved;
}

function buildFeedUrl(key){
  if(!key) throw new Error('No API key provided');
  return `https://gtfsrt.prod.obanyc.com/vehiclePositions?key=${encodeURIComponent(key)}`;
}

async function fetchFeed(key){
  const url = buildFeedUrl(key);
  const resp = await fetch(url);
  if(!resp.ok) throw new Error(`Feed fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

async function parseFeed(bytes){
  const root = await rootPromise;
  const FeedMessage = root.lookupType('transit_realtime.FeedMessage');
  const decoded = FeedMessage.decode(bytes);
  const obj = FeedMessage.toObject(decoded, { longs: Number, enums: String, defaults: false, arrays: true, objects: true });
  return obj;
}

function clearMarkersNotIn(ids){
  for(const id in markers){ if(!ids.has(id)){ map.removeLayer(markers[id]); delete markers[id]; } }
}

function updateMarkers(matches){
  const present = new Set();
  matches.forEach(m=>{
    if(m.lat == null || m.lon == null) return;
    present.add(m.id);
    if(!markers[m.id]) markers[m.id] = L.marker([m.lat,m.lon]).addTo(map);
    else markers[m.id].setLatLng([m.lat,m.lon]);

    markers[m.id].bindPopup(`<b>Vehicle ${m.id}</b><br/>Route: ${m.route||'N/A'}<br/>Trip: ${m.trip||'N/A'}<br/>Updated: ${m.timestamp?new Date(m.timestamp*1000).toLocaleTimeString():'N/A'}`);
  });
  clearMarkersNotIn(present);
}

async function runOnce(){
  setError('');
  setStatus('Fetching feed...');
  const key = getApiKey();
  if(!key){ setError('Missing API key. Enter it above or save it.'); setStatus('No API key'); return; }

  try{
    const bytes = await fetchFeed(key);
    const feedObj = await parseFeed(bytes);

    const mode = el.mode.value;
    const q = el.query.value.trim();
    const userVehicles = mode === 'vehicle' ? q.split(',').map(x=>x.trim()).filter(x=>x.length>0) : null;

    const matches = [];
    if(feedObj && Array.isArray(feedObj.entity)){
      feedObj.entity.forEach(ent => {
        const v = ent.vehicle || ent.vehicle_position || ent.vehiclePosition || ent.vehicle || null;
        // support both shapes: ent.vehicle.vehicle.id or ent.vehicle.vehicle.label
        if(!ent.vehicle) return;
        const veh = ent.vehicle.vehicle || ent.vehicle.vehicle || ent.vehicle;
        const id = ent.vehicle?.vehicle?.id || ent.vehicle?.vehicle?.label || ent.id || (veh && veh.id) || null;
        const lat = ent.vehicle?.position?.latitude ?? ent.vehicle?.position?.lat ?? null;
        const lon = ent.vehicle?.position?.longitude ?? ent.vehicle?.position?.lon ?? null;
        const route = ent.vehicle?.trip?.routeId || ent.vehicle?.trip?.route || null;
        const trip = ent.vehicle?.trip?.tripId || ent.vehicle?.trip?.trip || null;
        const timestamp = ent.vehicle?.timestamp || ent.vehicle?.current_stop_sequence || null;

        if(!id) return;

        if(mode === 'vehicle'){
          if(userVehicles && userVehicles.includes(String(id))) matches.push({id:String(id),lat,lon,route,trip,timestamp});
        }else{
          // route mode: match by route id (case-insensitive)
          if(q && route && String(route).toLowerCase() === q.toLowerCase()) matches.push({id:String(id),lat,lon,route,trip,timestamp});
        }
      });
    }

    updateMarkers(matches);
    setStatus(`Found ${matches.length} matching vehicle(s)`);
    setLast(Date.now());
  }catch(err){
    console.error(err);
    setError(err.message);
    setStatus('Error');
  }
}

function startAuto(){
  if(intervalId) return;
  runOnce();
  intervalId = setInterval(runOnce, DEFAULT_REFRESH_MS);
  setStatus('Auto-refresh started');
}
function stopAuto(){ if(intervalId){ clearInterval(intervalId); intervalId = null; setStatus('Auto-refresh stopped'); } }

function setLast(ts){ document.getElementById('last').textContent = ts ? `Last update: ${new Date(ts).toLocaleTimeString()}` : 'Last update: never'; }

// initialize app on DOM ready
window.addEventListener('DOMContentLoaded', ()=>{ init(); });
