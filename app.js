"use strict";

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// Cafés open and close inside this range: under 2% open before 06:00 or close after 22:00.
const SLIDER_MIN = 360, SLIDER_MAX = 1320, STEP = 15;
const OFM = "https://tiles.openfreemap.org";
const STYLES = {
  light: { url: `${OFM}/styles/positron`, building: "#e3e4e6" },
  standard: { url: `${OFM}/styles/liberty`, building: "#e0d8d0" },
};
// Open places are filled and steaming, closed ones hollow, and places without hours grey, so all three read at a glance.
// Cups and croissants share one set of colours: only the shape tells a café from a bakery.
const STATE_STYLES = {
  open: { fill: "#6b3a1c", line: "#6b3a1c" },
  closed: { fill: "#ffffff", line: "#8c6a52" },
  unknown: { fill: "#d5d8db", line: "#7b838a" },
  selected: { fill: "#c8501a", line: "#c8501a" },
};
const ICON_STYLES = { cup: STATE_STYLES, croissant: STATE_STYLES };
const STEAM_COLOR = "#8f735e";
const ICON_PX = 128; // drawn at 2× pixel ratio, so icon-size 1 is 64 CSS pixels
const STEAM_FRAMES = 12, STEAM_FRAME_MS = 130;
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  // follow: the time tracks the clock until someone picks a day or time themselves.
  day: 0, time: 540, follow: true, styleName: "light", selected: null,
  // specialty: the main switch. Show: which kinds of place. Only: each one narrows the map further.
  toggles: { specialty: true, cafes: true, bakeries: true, outdoor: false, independent: false, withHours: false },
};
let places = [];

const $ = (selector) => document.querySelector(selector);
const timeInput = $("#at");

// ---- time helpers -----------------------------------------------------------------------
function stockholmNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const clockPastMidnight = (m) => (m > 1440 ? `${clock(m - 1440)} next day` : clock(m));

// A day's opening spans, including any that carry over from the night before.
function spansFor(place, dayIndex) {
  const today = place.hours[DAYS[dayIndex]] || [];
  const yesterday = place.hours[DAYS[(dayIndex + 6) % 7]] || [];
  const carried = yesterday.filter((s) => s[1] > 1440).map((s) => [0, s[1] - 1440]);
  return carried.concat(today);
}

function isOpen(place, dayIndex, time) {
  return spansFor(place, dayIndex).some(([opens, closes]) => opens <= time && time < closes);
}

function statusOf(place) {
  if (!place.hours) return "unknown";
  return isOpen(place, state.day, state.time) ? "open" : "closed";
}

function isVisible(place) {
  const t = state.toggles;
  if (t.specialty && !place.specialty) return false;
  if (!(place.kind === "bakery" ? t.bakeries : t.cafes)) return false;
  if (t.outdoor && !place.outdoor) return false;
  if (t.independent && place.chain) return false;
  if (t.withHours && !place.hours) return false;
  return true;
}

// ---- icons ------------------------------------------------------------------------------
function drawCup(ctx, { fill, line }, size) {
  const s = size / 48;
  ctx.save();
  ctx.scale(s, s);
  const shape = () => {
    ctx.beginPath();
    // cup body
    ctx.moveTo(9, 15);
    ctx.lineTo(33, 15);
    ctx.lineTo(33, 27);
    ctx.quadraticCurveTo(33, 36, 24, 36);
    ctx.lineTo(18, 36);
    ctx.quadraticCurveTo(9, 36, 9, 27);
    ctx.closePath();
    // saucer
    ctx.moveTo(7, 39);
    ctx.lineTo(35, 39);
  };
  const handle = () => {
    ctx.beginPath();
    ctx.moveTo(33, 19);
    ctx.lineTo(36, 19);
    ctx.quadraticCurveTo(42, 19, 42, 24);
    ctx.quadraticCurveTo(42, 29, 36, 29);
    ctx.lineTo(33, 29);
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // white outline keeps the cup readable on any map background
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 8;
  shape(); ctx.stroke();
  handle(); ctx.stroke();
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = 3.5;
  shape(); ctx.fill(); ctx.stroke();
  handle(); ctx.stroke();
  ctx.restore();
}

// A croissant: five rolled lobes along a crescent, small at the horns and largest in the middle.
const CROISSANT_LOBES = [
  // [angle on the crescent in degrees, radius across the croissant, radius along it]
  [-170, 3.4, 6.4], [-131, 7.4, 6.2], [-90, 9.2, 7.2], [-49, 7.4, 6.2], [-10, 3.4, 6.4],
];
function drawCroissant(ctx, { fill, line }, size) {
  const s = size / 48;
  ctx.save();
  ctx.scale(s, s);
  const cx = 24, cy = 40, bend = 15;
  const lobe = ([deg, across, along]) => {
    const a = (deg * Math.PI) / 180;
    ctx.beginPath();
    ctx.ellipse(cx + bend * Math.cos(a), cy + bend * Math.sin(a), across, along, a, 0, Math.PI * 2);
  };
  // Horns first and the middle last, so each lobe overlaps the one outside it.
  const order = [0, 4, 1, 3, 2].map((k) => CROISSANT_LOBES[k]);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  order.forEach((l) => { lobe(l); ctx.stroke(); });
  // A thin white ring around each lobe keeps the lobes apart even when the croissant is one solid colour.
  ctx.fillStyle = fill;
  order.forEach((l) => {
    lobe(l);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 5.2; ctx.stroke();
    ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2.8; ctx.stroke();
  });
  ctx.restore();
}

// Three wisps of steam rising from the top of the cup or croissant. phase runs 0..1 and loops.
const STEAM_AT = { cup: { cx: 21, base: 13 }, croissant: { cx: 24, base: 15 } };
function drawSteam(ctx, shape, phase, size) {
  const { cx, base } = STEAM_AT[shape];
  const s = size / 48;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineCap = "round";
  [-6, 0, 6].forEach((dx, i) => {
    const progress = (phase + i / 3) % 1;
    const bottom = base - progress * 5, top = bottom - 7;
    const points = [];
    for (let y = bottom; y >= top; y -= 0.5) points.push([cx + dx + 1.6 * Math.sin((y + progress * 12) / 2.2), y]);
    const wisp = () => { ctx.beginPath(); points.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
    ctx.globalAlpha = 0.2 + 0.8 * Math.sin(Math.PI * progress);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 5.6; wisp(); ctx.stroke();
    ctx.strokeStyle = STEAM_COLOR; ctx.lineWidth = 3; wisp(); ctx.stroke();
  });
  ctx.restore();
}

const DRAW = { cup: drawCup, croissant: drawCroissant };
// steam: a phase from 0 to 1 for open places, or null for no steam.
function drawIcon(ctx, shape, status, size, steam = null) {
  ctx.clearRect(0, 0, size, size);
  DRAW[shape](ctx, ICON_STYLES[shape][status], size);
  if (steam !== null) drawSteam(ctx, shape, steam, size);
}
const scratch = document.createElement("canvas");
scratch.width = scratch.height = ICON_PX;
function iconImage(shape, status, steam = null) {
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  drawIcon(ctx, shape, status, ICON_PX, steam);
  return ctx.getImageData(0, 0, ICON_PX, ICON_PX);
}
// Every frame of the steam is drawn once up front; the animation only swaps them.
const steamFrames = Object.fromEntries(Object.keys(DRAW).map((shape) =>
  [shape, Array.from({ length: STEAM_FRAMES }, (_, k) => iconImage(shape, "open", k / STEAM_FRAMES))]));

// ---- map --------------------------------------------------------------------------------
const probe = document.createElement("canvas");
if (!probe.getContext("webgl2") && !probe.getContext("webgl")) {
  showFatal("This map needs WebGL, which your browser has turned off or doesn't support.");
  throw new Error("WebGL unavailable");
}

const isPhone = matchMedia("(max-width: 720px)").matches;
// The inner city, from Kristineberg to Djurgården and Vasastan to Hammarby sjöstad, centred on Slussen.
const SLUSSEN = [18.0718, 59.3197];
const HOME_BOUNDS = [[SLUSSEN[0] - 0.081, SLUSSEN[1] - 0.0305], [SLUSSEN[0] + 0.081, SLUSSEN[1] + 0.0305]];
// Fit it into the part of the map the panels leave free.
function homePadding() {
  const panel = $("#panel").getBoundingClientRect(), time = $("#time").getBoundingClientRect();
  const fit = (value, room) => Math.max(8, Math.min(value, room / 3));
  return isPhone
    ? { top: fit(panel.bottom + 8, innerHeight), bottom: fit(innerHeight - time.top + 8, innerHeight), left: 8, right: 8 }
    : { top: 20, bottom: fit(innerHeight - time.top + 8, innerHeight), left: fit(panel.right + 8, innerWidth), right: 60 };
}
const map = new maplibregl.Map({
  container: "map",
  style: STYLES.light.url,
  bounds: HOME_BOUNDS,
  fitBoundsOptions: { padding: homePadding() },
  pitch: 0,
  maxPitch: 70,
  attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
// The credit line would run under the time panel on narrower screens, so there it starts folded behind its (i) button.
const foldCredit = innerWidth < 1200;
map.addControl(new maplibregl.AttributionControl({ compact: foldCredit }), "bottom-right");
map.once("load", () => {
  const credit = document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
  if (credit && foldCredit) {
    credit.removeAttribute("open");
    credit.classList.remove("maplibregl-compact-show");
  }
});

// Icons grow as you zoom in (64 CSS px × size): about 15 px over the whole city, about 43 px at street level.
// Specialty coffee places are a quarter larger and drawn on top of their neighbours.
const SIZE_STOPS = [[11, 0.24], [13, 0.36], [15, 0.5], [18, 0.68]];
const SPECIALTY_SCALE = 1.25;
const iconSize = (factor = 1) => ["interpolate", ["linear"], ["zoom"],
  ...SIZE_STOPS.flatMap(([zoom, size]) => [zoom, ["case", ["get", "specialty"], size * factor * SPECIALTY_SCALE, size * factor]])];
const iconFor = (status) => ["case", ["==", ["get", "kind"], "bakery"], `croissant-${status}`, `cup-${status}`];
const NOTHING = ["in", ["get", "i"], ["literal", []]];

function addOwnLayers() {
  for (const [shape, styles] of Object.entries(ICON_STYLES)) {
    for (const status of Object.keys(styles)) {
      const image = status === "open" ? steamFrames[shape][steamFrame] : iconImage(shape, status);
      if (!map.hasImage(`${shape}-${status}`)) map.addImage(`${shape}-${status}`, image, { pixelRatio: 2 });
    }
  }
  // The huge city name lands on top of the cups in Gamla stan.
  for (const id of ["label_city", "label_city_capital"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  // Softer light keeps building walls pale, otherwise they read as dark specks when zoomed out.
  map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.22, position: [1.15, 210, 30] });
  // Same buildings on both maps. Liberty's own 3D layer is replaced so they behave alike.
  if (map.getLayer("building-3d")) map.removeLayer("building-3d");
  if (!map.getLayer("buildings-3d")) {
    map.addLayer({
      id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": STYLES[state.styleName].building,
        "fill-extrusion-opacity": 0.85,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      },
    });
  }
  if (!map.getSource("places")) {
    map.addSource("places", { type: "geojson", data: placesGeoJson() });
    const cupLayer = (id, status) => map.addLayer({
      id, type: "symbol", source: "places", filter: NOTHING,
      layout: {
        "icon-image": iconFor(status), "icon-size": iconSize(), "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["case", ["get", "specialty"], 1, 0],
      },
    });
    cupLayer("cups-unknown", "unknown");
    cupLayer("cups-closed", "closed");
    cupLayer("cups-open", "open");
    map.addLayer({
      id: "cups-labels", type: "symbol", source: "places", filter: NOTHING, minzoom: 15,
      layout: {
        "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12,
        "text-offset": [0, 1.7], "text-anchor": "top", "text-optional": true, "text-max-width": 9,
      },
      paint: { "text-color": "#2b211a", "text-halo-color": "#fff", "text-halo-width": 1.4 },
    });
    map.addLayer({
      id: "cups-selected", type: "symbol", source: "places", filter: NOTHING,
      layout: {
        "icon-image": iconFor("selected"), "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-size": iconSize(1.35),
      },
    });
  }
  applyFilters();
}

function placesGeoJson() {
  return {
    type: "FeatureCollection",
    features: places.map((p, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { i, kind: p.kind, name: p.name, specialty: p.specialty },
    })),
  };
}

// ---- steam ------------------------------------------------------------------------------
// One timer swaps the open icons' image about eight times a second, so the map redraws at that
// rate rather than every frame. Off when the system asks for less motion or the tab is hidden.
let steamFrame = 0;
// Every steam step redraws the whole map. That is a few milliseconds with a graphics card, but can be
// a second on a slow device, so each step measures its frame and waits long enough that the steam never
// takes more than about a quarter of the drawing time. It also pauses while the map is being moved.
let nextStep = 0;
const steamingCanvases = [];
function stepSteam() {
  const now = performance.now();
  if (calm.matches || document.hidden || now < nextStep) return;
  if (styleReady && dataReady && map.isMoving()) return;
  steamFrame = (steamFrame + 1) % STEAM_FRAMES;
  if (styleReady && dataReady) {
    for (const shape of Object.keys(DRAW)) {
      if (map.hasImage(`${shape}-open`)) map.updateImage(`${shape}-open`, steamFrames[shape][steamFrame]);
    }
    // updateImage only swaps the picture; the map draws it on its next repaint, which nothing else asks for.
    nextStep = Infinity;
    map.once("render", () => {
      const took = performance.now() - now;
      nextStep = performance.now() + Math.max(0, took * 3 - STEAM_FRAME_MS);
    });
    map.triggerRepaint();
  }
  for (const { canvas, shape } of steamingCanvases) {
    drawIcon(canvas.getContext("2d"), shape, "open", canvas.width, steamFrame / STEAM_FRAMES);
  }
}
setInterval(stepSteam, STEAM_FRAME_MS);

let dataReady = false, styleReady = false;
function startIfReady() { if (dataReady && styleReady) addOwnLayers(); }
map.on("style.load", () => { styleReady = true; startIfReady(); });
map.on("error", (e) => console.warn("Map error:", e.error && e.error.message));

// ---- filtering --------------------------------------------------------------------------
let filterQueued = false;
function requestFilters() {
  if (filterQueued) return;
  filterQueued = true;
  requestAnimationFrame(() => { filterQueued = false; applyFilters(); });
}

function applyFilters() {
  const groups = { open: [], closed: [], unknown: [] };
  let cafesShown = 0, bakeriesShown = 0;
  places.forEach((p, i) => {
    if (!isVisible(p)) return;
    groups[statusOf(p)].push(i);
    if (p.kind === "bakery") bakeriesShown++; else cafesShown++;
  });
  const inGroup = (ids) => ["in", ["get", "i"], ["literal", ids]];
  if (map.getLayer("cups-open")) {
    map.setFilter("cups-open", inGroup(groups.open));
    map.setFilter("cups-closed", inGroup(groups.closed));
    map.setFilter("cups-unknown", inGroup(groups.unknown));
    map.setFilter("cups-labels", inGroup(groups.open));
    map.setFilter("cups-selected", inGroup(state.selected === null ? [] : [state.selected]));
  }
  // Say exactly what is being counted: cafés, bakeries, or both ("places").
  const t = state.toggles;
  const kind = t.cafes && !t.bakeries ? "cafés" : t.bakeries && !t.cafes ? "bakeries" : "places";
  const noun = t.specialty ? `specialty coffee ${kind}` : kind;
  const count = $("#count");
  count.textContent = "";
  const open = document.createElement("b");
  open.textContent = groups.open.length;
  count.append(open, ` of ${cafesShown + bakeriesShown} ${noun} open`);
  count.title = `${cafesShown} cafés and ${bakeriesShown} bakeries shown: ${groups.open.length} open, `
    + `${groups.closed.length} closed, ${groups.unknown.length} without hours`;
  if (state.selected !== null) renderDetail();
}

// ---- controls ---------------------------------------------------------------------------
function renderTime() {
  timeInput.value = state.time;
  const day = DAY_NAMES[state.day];
  const actual = stockholmNow().minutes;
  $("#window").textContent = !state.follow
    ? `Open ${day} at ${clock(state.time)}`
    : actual === state.time
      ? `Open now: ${day} ${clock(state.time)}`
      : `Open ${day} at ${clock(state.time)} (it's ${clock(actual)} now)`;
  $("#now").setAttribute("aria-pressed", String(state.follow));
  document.querySelectorAll("#days button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === state.day)));
}

function changed() { renderTime(); requestFilters(); }

// Outside the slider's hours the nearest end is shown, and the label says what time it really is.
function setNow() {
  const now = stockholmNow();
  state.day = now.day;
  state.time = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, now.minutes));
}

function setupControls() {
  const days = $("#days");
  DAY_NAMES.forEach((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name.slice(0, 3);
    b.setAttribute("aria-label", name);
    b.addEventListener("click", () => { state.day = i; state.follow = false; changed(); });
    days.append(b);
  });
  timeInput.min = SLIDER_MIN;
  timeInput.max = SLIDER_MAX;
  timeInput.step = STEP;
  timeInput.addEventListener("input", () => { state.time = Number(timeInput.value); state.follow = false; changed(); });
  $("#now").addEventListener("click", () => { state.follow = true; setNow(); changed(); });
  // While following the clock, keep up with it.
  setInterval(() => { if (state.follow) { setNow(); changed(); } }, 30000);

  document.querySelectorAll("[data-toggle]").forEach((input) => {
    input.checked = state.toggles[input.dataset.toggle];
    input.addEventListener("change", () => { state.toggles[input.dataset.toggle] = input.checked; applyFilters(); });
  });
  document.querySelectorAll("[data-style]").forEach((button) => {
    button.addEventListener("click", () => switchStyle(button.dataset.style));
  });
  const tilt = $("#tilt");
  tilt.addEventListener("click", () => map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, bearing: map.getPitch() > 5 ? 0 : map.getBearing(), duration: 800 }));
  map.on("pitch", () => { tilt.textContent = map.getPitch() > 5 ? "Flat" : "Tilt"; });
  $("#filters").open = !isPhone;

  document.querySelectorAll("canvas[data-icon]").forEach((canvas) => {
    const [shape, status] = canvas.dataset.icon.split("-");
    const steams = "steam" in canvas.dataset;
    drawIcon(canvas.getContext("2d"), shape, status, canvas.width, steams ? 0 : null);
    if (steams) steamingCanvases.push({ canvas, shape });
  });

  const time = $("#time");
  const syncHeight = () => document.documentElement.style.setProperty("--time-h", `${time.offsetHeight}px`);
  new ResizeObserver(syncHeight).observe(time);
  syncHeight();
}

function switchStyle(name) {
  if (name === state.styleName) return;
  state.styleName = name;
  document.querySelectorAll("[data-style]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.style === name)));
  styleReady = false;
  map.setStyle(STYLES[name].url, { diff: false });
}

// ---- selecting a café -------------------------------------------------------------------
map.on("click", (e) => {
  const reach = 16;
  const box = [[e.point.x - reach, e.point.y - reach], [e.point.x + reach, e.point.y + reach]];
  const layers = ["cups-selected", "cups-open", "cups-closed", "cups-unknown"].filter((id) => map.getLayer(id));
  const hits = map.queryRenderedFeatures(box, { layers });
  if (!hits.length) { closeDetail(); return; }
  const rank = { "cups-open": 0, "cups-selected": 1, "cups-closed": 2, "cups-unknown": 2 };
  const distance = (f) => {
    const p = map.project(f.geometry.coordinates);
    return Math.hypot(p.x - e.point.x, p.y - e.point.y);
  };
  hits.sort((a, b) => (rank[a.layer.id] - rank[b.layer.id]) || (distance(a) - distance(b)));
  select(hits[0].properties.i);
});
map.on("mousemove", (e) => {
  const layers = ["cups-open", "cups-closed", "cups-unknown"].filter((id) => map.getLayer(id));
  const hit = layers.length && map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers }).length;
  map.getCanvas().style.cursor = hit ? "pointer" : "";
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

function select(index) {
  state.selected = index;
  const place = places[index];
  applyFilters();
  const detail = $("#detail");
  detail.hidden = false;
  detail.scrollTop = 0;
  // Put the cup in the clear part of the map, between the panels.
  const card = detail.getBoundingClientRect(), panel = $("#panel").getBoundingClientRect();
  const offset = matchMedia("(max-width: 720px)").matches
    ? [0, (panel.bottom + card.top) / 2 - innerHeight / 2]
    : [(panel.right + card.left) / 2 - innerWidth / 2, -40];
  map.easeTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 16), pitch: 55, offset, duration: 900 });
}

function closeDetail() {
  if (state.selected === null) return;
  state.selected = null;
  $("#detail").hidden = true;
  applyFilters();
}

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function externalLink(href, label) {
  return element("a", { href, target: "_blank", rel: "noopener noreferrer", textContent: label });
}

// All OSM values are set as text, never as HTML, because anyone can edit them.
function renderDetail() {
  const place = places[state.selected];
  const detail = $("#detail");
  detail.textContent = "";
  const close = element("button", { type: "button", className: "close", textContent: "×" });
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeDetail);

  const kindName = place.kind === "bakery" ? "bakery" : "café";
  const status = statusOf(place);
  const windowText = `at ${clock(state.time)}`;
  const stateText = {
    open: `Open ${windowText}, ${DAY_NAMES[state.day]}`,
    closed: `Not open ${windowText}, ${DAY_NAMES[state.day]}`,
    unknown: "Hours not known",
  }[status];
  detail.append(close, element("h2", { textContent: place.name || `Unnamed ${kindName}` }),
    element("p", { className: `state ${status}`, textContent: stateText }));

  if (place.hours) {
    const table = element("table", { className: "week" });
    DAYS.forEach((d, i) => {
      const spans = place.hours[d] || [];
      const value = spans.length
        ? spans.map(([o, c, openEnd]) => (openEnd ? `${clock(o)} until late` : `${clock(o)}–${clockPastMidnight(c)}`)).join(", ")
        : "Closed";
      const row = element("tr", {}, element("td", { textContent: DAY_NAMES[i] }), element("td", { textContent: value }));
      if (i === state.day) row.className = "selected";
      table.append(row);
    });
    detail.append(table);
  } else if (place.raw_hours) {
    detail.append(element("p", { className: "raw", textContent: `Written in OSM as: ${place.raw_hours}` }));
  }

  const chips = [];
  if (place.specialty) chips.push("Specialty coffee");
  if (place.outdoor) chips.push("Outdoor seating");
  if (place.wheelchair === "yes") chips.push("Wheelchair access");
  if (place.chain) chips.push("Chain");
  if (chips.length) detail.append(element("ul", { className: "chips" }, ...chips.map((c) => element("li", { textContent: c }))));

  const links = [];
  if (place.website) links.push(externalLink(place.website, "Website"));
  if (place.instagram) links.push(externalLink(place.instagram, "Instagram"));
  if (links.length) detail.append(element("p", { className: "links" }, ...links));

  const [type, id] = place.id.split("/");
  const checked = place.hours_checked ? `Hours last confirmed ${place.hours_checked}.` : `Record last edited ${place.edited}.`;
  detail.append(element("p", { className: "source" }, `${checked} `,
    externalLink(`https://www.openstreetmap.org/${type}/${id}`, "View on OSM"), " · ",
    externalLink(`https://www.openstreetmap.org/edit?${type}=${id}`, "Edit on OSM")));
}

function showFatal(message) {
  const fatal = $("#fatal");
  fatal.textContent = message;
  fatal.hidden = false;
}

// ---- start ------------------------------------------------------------------------------
function showCounts() {
  const counts = {
    specialty: places.filter((p) => p.specialty).length,
    cafe: places.filter((p) => p.kind !== "bakery").length,
    bakery: places.filter((p) => p.kind === "bakery").length,
    outdoor: places.filter((p) => p.outdoor).length,
    independent: places.filter((p) => !p.chain).length,
    withHours: places.filter((p) => p.hours).length,
  };
  document.querySelectorAll("[data-count]").forEach((node) => { node.textContent = counts[node.dataset.count]; });
}

setNow();
setupControls();
renderTime();

fetch("data/cafes.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((data) => {
    places = data.places;
    $("#snapshot").textContent = new Date(data.osm_timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Stockholm" });
    showCounts();
    dataReady = true;
    startIfReady();
    applyFilters();
  })
  .catch((error) => {
    console.error(error);
    showFatal("The café data couldn't be loaded. Please try reloading the page.");
  });
