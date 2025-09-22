// ====== Config ======
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_URL = "https://geocoding-api.open-meteo.com/v1/reverse";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

// ====== DOM ======
const searchInput = document.getElementById("searchInput");
const suggestions = document.getElementById("suggestions");
const geoBtn = document.getElementById("geoBtn");
const unitToggle = document.getElementById("unitToggle");
const unitLabel = document.getElementById("unitLabel");
const unitInline = document.getElementById("unitInline");

const statusBar = document.getElementById("statusBar");
const placeNameEl = document.getElementById("placeName");
const coordsEl = document.getElementById("coords");
const updatedEl = document.getElementById("updated");

const currentIcon = document.getElementById("currentIcon");
const currentTemp = document.getElementById("currentTemp");
const currentDesc = document.getElementById("currentDesc");
const feelsLike = document.getElementById("feelsLike");
const humidity = document.getElementById("humidity");
const wind = document.getElementById("wind");
const precip = document.getElementById("precip");
const forecastGrid = document.getElementById("forecastGrid");
const forecastItemTemplate = document.getElementById("forecastItemTemplate");

// ====== State ======
let lastAbort = null;
let lastGeoAbort = null;
let lastReverseAbort = null;

const state = {
  coords: null,  // { lat, lon }
  place: null,   // "City, Country"
  unit: localStorage.getItem("unit") || "c", // "c" or "f"
  lastQuery: "",
};

// ====== Utilities ======
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const fmtDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function setStatus(msg, type = "") {
  statusBar.className = "status " + (type ? `status-${type}` : "");
  statusBar.textContent = msg || "";
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function makeAbortable(prev) {
  if (prev) prev.abort();
  return new AbortController();
}

function pickUnitParams() {
  const isF = state.unit === "f";
  return {
    temperature_unit: isF ? "fahrenheit" : "celsius",
    windspeed_unit: isF ? "mph" : "kmh",
    precipitation_unit: isF ? "inch" : "mm",
    unitSymbol: isF ? "°F" : "°C",
    windSymbol: isF ? "mph" : "km/h",
    precipSymbol: isF ? "in" : "mm",
  };
}

// Open-Meteo WMO weather codes → emoji + label
const WMO = {
  0: ["☀️","Clear"],
  1: ["🌤️","Mainly clear"],
  2: ["⛅","Partly cloudy"],
  3: ["☁️","Overcast"],
  45: ["🌫️","Fog"],
  48: ["🌫️","Rime fog"],
  51: ["🌦️","Light drizzle"],
  53: ["🌦️","Drizzle"],
  55: ["🌧️","Dense drizzle"],
  56: ["🌧️","Freezing drizzle"],
  57: ["🌧️","Freezing drizzle"],
  61: ["🌦️","Light rain"],
  63: ["🌧️","Rain"],
  65: ["🌧️","Heavy rain"],
  66: ["🌧️","Freezing rain"],
  67: ["🌧️","Freezing rain"],
  71: ["🌨️","Light snow"],
  73: ["🌨️","Snow"],
  75: ["❄️","Heavy snow"],
  77: ["🌨️","Snow grains"],
  80: ["🌧️","Rain showers"],
  81: ["🌧️","Rain showers"],
  82: ["🌧️","Violent rain"],
  85: ["🌨️","Snow showers"],
  86: ["🌨️","Heavy snow"],
  95: ["⛈️","Thunderstorm"],
  96: ["⛈️","Thunder + hail"],
  99: ["⛈️","Thunder + hail"],
};
function wc(code){ return WMO[code] || ["⛅","—"]; }

async function fetchJSON(url, params = {}, controller = null) {
  const qp = new URLSearchParams(params).toString();
  const full = qp ? `${url}?${qp}` : url;
  const res = await fetch(full, { signal: controller?.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setSkeleton(on = true) {
  const targets = [document.getElementById("current"), forecastGrid];
  targets.forEach(el => el && el.classList.toggle("skeleton", on));
}

function clearSuggestions() {
  suggestions.innerHTML = "";
  suggestions.classList.remove("show");
  searchInput.setAttribute("aria-expanded", "false");
}

function renderSuggestions(list){
  suggestions.innerHTML = "";
  if (!list?.length) {
    suggestions.classList.remove("show");
    searchInput.setAttribute("aria-expanded","false");
    return;
  }
  list.slice(0, 8).forEach((p, i) => {
    const li = document.createElement("li");
    li.setAttribute("role","option");
    li.setAttribute("id", `sugg-${i}`);
    li.innerHTML = `
      <span>${p.name}${p.admin1 ? ", " + p.admin1 : ""}</span>
      <span class="sub">${p.country_code || p.country || ""}${p.latitude ? ` · ${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}` : ""}</span>
    `;
    li.addEventListener("click", () => {
      selectPlace(p);
      clearSuggestions();
    });
    suggestions.appendChild(li);
  });
  suggestions.classList.add("show");
  searchInput.setAttribute("aria-expanded","true");
}

function setUnitUI(){
  const isF = state.unit === "f";
  unitToggle.checked = isF;
  unitLabel.textContent = isF ? "°F" : "°C";
  unitInline.textContent = isF ? "°F" : "°C";
}

// ====== Data Flow ======
async function searchPlaces(q) {
  if (!q || q.trim().length < 2) {
    clearSuggestions();
    return;
  }
  state.lastQuery = q;
  lastGeoAbort = makeAbortable(lastGeoAbort);
  try{
    const data = await fetchJSON(GEOCODE_URL, {
      name: q.trim(),
      count: 10,
      language: navigator.language || "en",
      format: "json"
    }, lastGeoAbort);

    const list = data?.results || [];
    renderSuggestions(list);
  } catch (e){
    // silent; common during rapid typing/aborts
  }
}

async function selectPlace(p) {
  const lat = p.latitude ?? p.lat ?? p.latitud;
  const lon = p.longitude ?? p.lon ?? p.lng;
  if (typeof lat !== "number" || typeof lon !== "number") return;

  state.coords = { lat, lon };
  state.place = `${p.name}${p.admin1 ? ", " + p.admin1 : ""}${p.country ? ", " + p.country : ""}`;
  searchInput.value = p.name;
  await loadWeather();
}

async function reverseLookup(lat, lon){
  lastReverseAbort = makeAbortable(lastReverseAbort);
  try{
    const r = await fetchJSON(REVERSE_URL, {
      latitude: lat,
      longitude: lon,
      language: navigator.language || "en",
      format: "json"
    }, lastReverseAbort);

    const top = r?.results?.[0];
    if (top){
      state.place = `${top.name}${top.admin1 ? ", " + top.admin1 : ""}${top.country ? ", " + top.country : ""}`;
    } else {
      state.place = `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
    }
  } catch(e){
    state.place = `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
  }
}

async function loadWeather() {
  if (!state.coords) return;
  setUnitUI();
  setStatus("Loading weather…");
  setSkeleton(true);

  const { lat, lon } = state.coords;
  const unit = pickUnitParams();

  // current + daily (7 days)
  const params = {
    latitude: lat,
    longitude: lon,
    current: ["temperature_2m","relative_humidity_2m","is_day","weather_code","apparent_temperature","precipitation","wind_speed_10m"].join(","),
    daily: ["weather_code","temperature_2m_max","temperature_2m_min","precipitation_sum","wind_speed_10m_max"].join(","),
    timezone: "auto",
    temperature_unit: unit.temperature_unit,
    windspeed_unit: unit.windspeed_unit,
    precipitation_unit: unit.precipitation_unit,
    forecast_days: 7,
  };

  lastAbort = makeAbortable(lastAbort);
  try{
    const data = await fetchJSON(WEATHER_URL, params, lastAbort);
    renderAll(data, unit);
    setStatus("Loaded", "ok");
  } catch (e){
    console.error(e);
    setStatus("Could not load weather. Check your connection and try again.", "warn");
  } finally {
    setSkeleton(false);
  }
}

function renderAll(data, unit){
  // Location bar
  placeNameEl.textContent = state.place || "—";
  coordsEl.textContent = state.coords ? `(${state.coords.lat.toFixed(2)}, ${state.coords.lon.toFixed(2)})` : "—";
  updatedEl.textContent = data?.current ? `Updated: ${fmtDateTime.format(new Date(data.current.time))}` : "—";

  // Current
  const c = data.current || {};
  const [emoji, label] = wc(c.weather_code);
  currentIcon.textContent = emoji;
  currentTemp.textContent = isNum(c.temperature_2m) ? Math.round(c.temperature_2m) : "—";
  currentDesc.textContent = label;

  feelsLike.textContent = isNum(c.apparent_temperature) ? `${Math.round(c.apparent_temperature)} ${unit.unitSymbol}` : "—";
  humidity.textContent = isNum(c.relative_humidity_2m) ? `${Math.round(c.relative_humidity_2m)}%` : "—";
  wind.textContent = isNum(c.wind_speed_10m) ? `${Math.round(c.wind_speed_10m)} ${unit.windSymbol}` : "—";
  precip.textContent = isNum(c.precipitation) ? `${c.precipitation.toFixed(1)} ${unit.precipSymbol}` : "—";

  // Forecast
  const d = data.daily || {};
  const days = (d.time || []).map((t, i) => ({
    date: new Date(t),
    code: d.weather_code?.[i],
    tmax: d.temperature_2m_max?.[i],
    tmin: d.temperature_2m_min?.[i],
    pr: d.precipitation_sum?.[i],
    wmax: d.wind_speed_10m_max?.[i]
  }));

  forecastGrid.innerHTML = "";
  days.forEach(day => {
    const node = forecastItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".day-name").textContent = fmtDay.format(day.date);
    const [e, lbl] = wc(day.code);
    node.querySelector(".day-icon").textContent = e;
    node.querySelector(".tmax").textContent = isNum(day.tmax) ? `${Math.round(day.tmax)}${unit.unitSymbol}` : "—";
    node.querySelector(".tmin").textContent = isNum(day.tmin) ? `${Math.round(day.tmin)}${unit.unitSymbol}` : "—";
    node.querySelector(".day-extra").textContent =
      `${isNum(day.pr) ? day.pr.toFixed(1) : "—"} ${unit.precipSymbol} · ${isNum(day.wmax) ? Math.round(day.wmax) : "—"} ${unit.windSymbol}`;
    forecastGrid.appendChild(node);
  });
}

function isNum(x){ return typeof x === "number" && !Number.isNaN(x); }

// ====== Events ======
const onType = debounce(() => searchPlaces(searchInput.value), 250);
searchInput.addEventListener("input", onType);
searchInput.addEventListener("focus", () => searchPlaces(searchInput.value));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) clearSuggestions();
});

// Keyboard navigation for suggestions
searchInput.addEventListener("keydown", (e) => {
  if (!suggestions.classList.contains("show")) return;

  const items = [...suggestions.querySelectorAll("li")];
  const activeIdx = items.findIndex(li => li.classList.contains("active"));
  if (e.key === "ArrowDown"){
    e.preventDefault();
    const next = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
    items.forEach(li => li.classList.remove("active"));
    items[next].classList.add("active");
    items[next].scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp"){
    e.preventDefault();
    const prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
    items.forEach(li => li.classList.remove("active"));
    items[prev].classList.add("active");
    items[prev].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter"){
    e.preventDefault();
    const idx = activeIdx >= 0 ? activeIdx : 0;
    items[idx]?.click();
  } else if (e.key === "Escape"){
    clearSuggestions();
  }
});

// Geolocation
geoBtn.addEventListener("click", async () => {
  if (!("geolocation" in navigator)) {
    setStatus("Geolocation is not supported by your browser.", "warn");
    return;
  }
  setStatus("Detecting your location…");
  setSkeleton(true);
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    state.coords = { lat, lon };
    await reverseLookup(lat, lon);
    await loadWeather();
  }, (err) => {
    console.error(err);
    const msg = {
      1: "Permission denied. Please allow location access or use the search.",
      2: "Position unavailable. Try again or use the search.",
      3: "Location request timed out. Try again."
    }[err.code] || "Couldn’t get your location.";
    setStatus(msg, "warn");
    setSkeleton(false);
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
});

// Unit toggle
unitToggle.addEventListener("change", async () => {
  state.unit = unitToggle.checked ? "f" : "c";
  localStorage.setItem("unit", state.unit);
  setUnitUI();
  if (state.coords) {
    await loadWeather();
  }
});

// Initial: try last searched or geolocate politely
window.addEventListener("DOMContentLoaded", async () => {
  setUnitUI();
  const lastLat = parseFloat(localStorage.getItem("lat"));
  const lastLon = parseFloat(localStorage.getItem("lon"));
  const lastPlace = localStorage.getItem("place");
  if (isFinite(lastLat) && isFinite(lastLon) && lastPlace) {
    state.coords = { lat: lastLat, lon: lastLon };
    state.place = lastPlace;
    await loadWeather();
  } else {
    // Optional: do nothing until user acts, to avoid surprise geolocation prompts
    setStatus("Search for a city or use 📍 to detect your location.");
  }
});

// Persist location when we render a valid place
const observer = new MutationObserver(() => {
  if (state.coords && state.place) {
    localStorage.setItem("lat", state.coords.lat);
    localStorage.setItem("lon", state.coords.lon);
    localStorage.setItem("place", state.place);
  }
});
observer.observe(document.getElementById("placeName"), { childList: true });

// Close suggestions with Escape globally
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearSuggestions();
});
