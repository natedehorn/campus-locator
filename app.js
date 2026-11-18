"use strict";

// ---------- Config ----------
const ROUNDS = 5;
const MAX_POINTS = 5000;
const STORE_KEY = "campus-locator:v1";
const MODE_KEY = "campus-locator:mode";

// scale = km at which points fall to ~37% of max (smaller = harsher).
const MODES = {
  "global":        { label: "Global",        scale: 3000, zoom: 2, view: [20, 0],   filter: () => true },
  "usa":           { label: "United States", scale: 800,  zoom: 4, view: [39, -98],  filter: s => s.country === "US" },
  "north-america": { label: "North America", scale: 1500, zoom: 3, view: [45, -100], filter: s => s.region === "na" },
  "europe":        { label: "Europe",        scale: 1000, zoom: 4, view: [53, 15],   filter: s => s.region === "eu" },
  "asia":          { label: "Asia",          scale: 1500, zoom: 3, view: [30, 100],  filter: s => s.region === "as" },
  "africa":        { label: "Africa",        scale: 2000, zoom: 3, view: [2, 20],    filter: s => s.region === "af" },
  "south-america": { label: "South America", scale: 1500, zoom: 3, view: [-15, -60], filter: s => s.region === "sa" },
  "oceania":       { label: "Oceania",       scale: 1500, zoom: 3, view: [-25, 140], filter: s => s.region === "oc" },
};

const SCHOOLS = SCHOOL_DATA.map(([name, country, region, lat, lng]) => ({ name, country, region, lat, lng }));

const GUESS_STYLE = { radius: 9, color: "#ffffff", weight: 2, fillColor: "#e4572e", fillOpacity: 1 };
const ANSWER_STYLE = { radius: 9, color: "#ffffff", weight: 2, fillColor: "#2a9d8f", fillOpacity: 1 };

const $ = id => document.getElementById(id);

// ---------- Pure helpers ----------
function todayKey() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small seeded PRNG so every player gets the same daily schools.
function seededRandom(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyPicks(modeKey, dateKey) {
  const pool = SCHOOLS.filter(MODES[modeKey].filter);
  const rand = seededRandom(hashString(`${dateKey}|${modeKey}`));
  const order = pool.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, ROUNDS);
}

function distanceKm(a, b) {
  const R = 6371;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function scoreFor(km, scale) {
  return Math.round(MAX_POINTS * Math.exp(-km / scale));
}

function totalOf(results) {
  return results.reduce((sum, r) => sum + r.pts, 0);
}

function timeUntilMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const mins = Math.floor((next - now) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ---------- Storage (per browser) ----------
// store[YYYY-MM-DD][modeKey] = [{ name, country, km, pts }, ...]
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function persistStore() {
  const keys = Object.keys(store).sort();
  while (keys.length > 60) delete store[keys.shift()];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* play without saving */ }
}

function loadMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return MODES[m] ? m : "global";
  } catch { return "global"; }
}

function saveMode(m) {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
}

// ---------- State ----------
const store = loadStore();
let mode = loadMode();
let pending = null;    // current unlocked guess {lat, lng}
let revealed = false;  // true while showing the result of the last lock-in

function currentResults() {
  return store[todayKey()]?.[mode] ?? [];
}

function saveResult(result) {
  const dk = todayKey();
  store[dk] = store[dk] || {};
  store[dk][mode] = store[dk][mode] || [];
  store[dk][mode].push(result);
  persistStore();
}

// ---------- Map ----------
const map = L.map("map", { minZoom: 2, worldCopyJump: true });
// Esri World Imagery (satellite): no country borders, city dots or labels.
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 12,
  attribution: "Tiles &copy; Esri",
}).addTo(map);

const markers = L.layerGroup().addTo(map);
let guessMarker = null;

function clearMarkers() {
  markers.clearLayers();
  guessMarker = null;
}

function drawGuess() {
  if (guessMarker) guessMarker.setLatLng(pending);
  else guessMarker = L.circleMarker(pending, GUESS_STYLE).addTo(markers);
}

function reveal(school, guess) {
  clearMarkers();
  const guessPt = L.latLng(guess.lat, guess.lng);
  const answerPt = L.latLng(school.lat, school.lng);
  L.circleMarker(guessPt, GUESS_STYLE).addTo(markers);
  L.circleMarker(answerPt, ANSWER_STYLE).bindTooltip(school.name).addTo(markers);
  L.polyline([guessPt, answerPt], { color: "#333", weight: 3, dashArray: "6 6" }).addTo(markers);
  map.fitBounds(L.latLngBounds([guessPt, answerPt]).pad(0.35), { maxZoom: 8 });
}

map.on("click", e => {
  if (revealed || currentResults().length >= ROUNDS) return;
  pending = e.latlng;
  drawGuess();
  updateControls();
});

// ---------- Rendering ----------
function updateControls() {
  const btn = $("primary");
  const hint = $("hint");
  if (revealed) {
    const last = currentResults().length >= ROUNDS;
    btn.textContent = last ? "See final score" : "Next school";
    btn.disabled = false;
    hint.textContent = "";
  } else {
    btn.textContent = "Lock in guess";
    btn.disabled = !pending;
    hint.textContent = pending
      ? "Click again to adjust, then lock in."
      : "Click the map where you think this school is. Closer guesses score more.";
  }
}

function renderRound() {
  const results = currentResults();
  const finished = results.length >= ROUNDS && !revealed;

  $("total").textContent = `Score: ${totalOf(results).toLocaleString()}`;

  if (finished) return renderSummary(results);

  $("summary").hidden = true;
  $("controls").hidden = false;
  $("clue").hidden = false;

  const index = revealed ? results.length - 1 : results.length;
  const school = dailyPicks(mode, todayKey())[index];
  $("round").textContent = `School ${index + 1} of ${ROUNDS}`;
  $("school").textContent = school.name;
  $("result").hidden = !revealed;
  updateControls();
}

function showResult(r) {
  $("result-dist").textContent = `${Math.round(r.km).toLocaleString()} km away`;
  $("result-pts").textContent = `+${r.pts.toLocaleString()} points`;
  $("result").hidden = false;
}

function renderSummary(results) {
  $("round").textContent = "Round complete";
  $("clue").hidden = true;
  $("result").hidden = true;
  $("controls").hidden = true;
  $("summary").hidden = false;
  $("summary-title").textContent = `${MODES[mode].label} · ${todayKey()}`;
  $("final").textContent = `${totalOf(results).toLocaleString()} / ${(ROUNDS * MAX_POINTS).toLocaleString()}`;

  const list = $("breakdown");
  list.replaceChildren();
  for (const r of results) {
    const li = document.createElement("li");
    li.textContent = `${r.name} — ${Math.round(r.km).toLocaleString()} km — ${r.pts.toLocaleString()} pts`;
    list.appendChild(li);
  }
  $("countdown").textContent = `Next set in ${timeUntilMidnight()}`;
  drawSummary(results);
}

// Shows every round on the map: orange = your guess, green = the real campus,
// dashed line = the distance you were off by.
function drawSummary(results) {
  clearMarkers();
  const points = [];
  results.forEach((r, i) => {
    if (!r.guess || r.lat == null) return; // results saved before guesses were stored
    const guessPt = L.latLng(r.guess.lat, r.guess.lng);
    const answerPt = L.latLng(r.lat, r.lng);
    L.polyline([guessPt, answerPt], { color: "#333", weight: 2, dashArray: "6 6" }).addTo(markers);
    L.circleMarker(guessPt, { ...GUESS_STYLE, radius: 8 })
      .bindTooltip(`${i + 1}. Your guess: ${Math.round(r.km).toLocaleString()} km off`)
      .addTo(markers);
    L.circleMarker(answerPt, { ...ANSWER_STYLE, radius: 8 })
      .bindTooltip(`${i + 1}. ${r.name}`)
      .addTo(markers);
    points.push(guessPt, answerPt);
  });
  if (points.length) map.fitBounds(L.latLngBounds(points).pad(0.2), { maxZoom: 6 });
}

// ---------- Events ----------
$("primary").addEventListener("click", () => {
  if (revealed) {
    revealed = false;
    pending = null;
    clearMarkers();
    map.setView(MODES[mode].view, MODES[mode].zoom);
    return renderRound();
  }

  if (!pending) return;
  const school = dailyPicks(mode, todayKey())[currentResults().length];
  const km = distanceKm(pending, school);
  const result = {
    name: school.name,
    country: school.country,
    lat: school.lat,
    lng: school.lng,
    guess: { lat: pending.lat, lng: pending.lng },
    km: Math.round(km * 10) / 10,
    pts: scoreFor(km, MODES[mode].scale),
  };

  saveResult(result);
  revealed = true;
  reveal(school, pending);
  showResult(result);
  renderRound();
});

$("mode").addEventListener("change", e => {
  mode = e.target.value;
  saveMode(mode);
  pending = null;
  revealed = false;
  clearMarkers();
  map.setView(MODES[mode].view, MODES[mode].zoom);
  renderRound();
});

$("share").addEventListener("click", async () => {
  const results = currentResults();
  const text = [
    `Campus Locator · ${MODES[mode].label} · ${todayKey()}`,
    `Score: ${totalOf(results).toLocaleString()} / ${(ROUNDS * MAX_POINTS).toLocaleString()}`,
    ...results.map((r, i) => `${i + 1}. ${Math.round(r.km).toLocaleString()} km · ${r.pts.toLocaleString()} pts`),
  ].join("\n");
  const btn = $("share");
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied!";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => { btn.textContent = "Copy result"; }, 1500);
});

// ---------- Init ----------
for (const [key, m] of Object.entries(MODES)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = m.label;
  $("mode").appendChild(opt);
}
$("mode").value = mode;
map.setView(MODES[mode].view, MODES[mode].zoom);
renderRound();
