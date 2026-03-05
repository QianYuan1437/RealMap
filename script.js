const WORLD_GEOJSON_URL = "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";
const COUNTRY_AREA_URL = "https://restcountries.com/v3.1/all?fields=name,cca3,area";
const EARTH_RADIUS_M = 6371008.8;
const STORAGE_THEME_KEY = "realmap-theme";
const SUN_ICON_PATH = "M12 4a1 1 0 0 1 1 1v1.3a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1zm0 12.7a1 1 0 0 1 1 1V19a1 1 0 1 1-2 0v-1.3a1 1 0 0 1 1-1zm8-4.7a1 1 0 0 1 0 2h-1.3a1 1 0 1 1 0-2H20zM6.3 12a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2h1.3zm10.18-5.59a1 1 0 0 1 1.41 1.41l-.92.92a1 1 0 0 1-1.42-1.41l.93-.92zm-8.45 8.45a1 1 0 0 1 1.41 1.42l-.92.92a1 1 0 1 1-1.42-1.41l.93-.93zm8.45 1.42a1 1 0 0 1 0-1.42 1 1 0 0 1 1.41 0l.93.93a1 1 0 0 1-1.42 1.41l-.92-.92zM8.03 6.41l.93.92a1 1 0 0 1-1.42 1.41l-.92-.92a1 1 0 1 1 1.41-1.41zM12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z";
const MOON_ICON_PATH = "M15.6 3.2a1 1 0 0 1 .9 1.58A6.8 6.8 0 1 0 19.2 15a1 1 0 0 1 1.26 1.36A8.8 8.8 0 1 1 14.64 2.3a1 1 0 0 1 .96.9z";

const projectionBuilders = {
  EqualEarth: () => d3.geoEqualEarth(),
  Mercator: () => d3.geoMercator(),
  NaturalEarth1: () => d3.geoNaturalEarth1()
};

const elements = {
  countrySelect: document.getElementById("country-select"),
  leftProjectionSelect: document.getElementById("projection-select"),
  rightProjectionSelect: document.getElementById("compare-select"),
  leftTitle: document.getElementById("left-title"),
  rightTitle: document.getElementById("right-title"),
  realArea: document.getElementById("real-area"),
  rankArea: document.getElementById("rank-area"),
  rankHint: document.getElementById("rank-hint"),
  distortion: document.getElementById("distortion"),
  distortionHint: document.getElementById("distortion-hint"),
  meterValue: document.getElementById("meter-value"),
  meterBar: document.getElementById("meter-bar"),
  utc8Time: document.getElementById("utc8-time"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon")
};

const state = {
  features: [],
  areaByIso: new Map(),
  selectedIso: null,
  ranked: []
};

init().catch((error) => {
  console.error(error);
  elements.realArea.textContent = "加载失败";
  elements.realArea.classList.add("hint");
});

async function init() {
  initTheme();
  initClock();

  const [worldData, countriesArea] = await Promise.all([
    fetchJson(WORLD_GEOJSON_URL),
    fetchJson(COUNTRY_AREA_URL)
  ]);

  state.features = (worldData.features || []).filter((f) => f.id && f.geometry);
  buildAreaMap(countriesArea);
  buildRanking();
  fillCountrySelect();
  bindEvents();

  state.selectedIso = "CHN";
  elements.countrySelect.value = state.selectedIso;
  elements.countrySelect.disabled = false;
  renderAll();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载失败: ${url}`);
  }
  return response.json();
}

function buildAreaMap(countryItems) {
  for (const item of countryItems) {
    if (!item.cca3) continue;
    if (typeof item.area === "number" && item.area > 0) {
      state.areaByIso.set(item.cca3, item.area);
    }
  }

  for (const feature of state.features) {
    if (state.areaByIso.has(feature.id)) continue;
    const derived = deriveGeoAreaKm2(feature);
    if (derived > 0) {
      state.areaByIso.set(feature.id, derived);
    }
  }
}

function deriveGeoAreaKm2(feature) {
  const steradians = d3.geoArea(feature);
  const m2 = steradians * EARTH_RADIUS_M * EARTH_RADIUS_M;
  return m2 / 1e6;
}

function buildRanking() {
  state.ranked = state.features
    .map((f) => ({
      iso: f.id,
      area: state.areaByIso.get(f.id) || 0
    }))
    .filter((x) => x.area > 0)
    .sort((a, b) => b.area - a.area);
}

function fillCountrySelect() {
  const options = state.features
    .map((f) => ({
      iso: f.id,
      name: f.properties?.name || f.id
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  elements.countrySelect.innerHTML = options
    .map((o) => `<option value="${o.iso}">${o.name} (${o.iso})</option>`)
    .join("");
}

function bindEvents() {
  elements.countrySelect.addEventListener("change", (e) => {
    state.selectedIso = e.target.value;
    renderAll();
  });

  elements.leftProjectionSelect.addEventListener("change", () => {
    renderAll();
  });

  elements.rightProjectionSelect.addEventListener("change", () => {
    renderAll();
  });

  elements.themeToggle.addEventListener("click", toggleTheme);
}

function renderAll() {
  const leftProjectionName = elements.leftProjectionSelect.value;
  const rightProjectionName = elements.rightProjectionSelect.value;

  elements.leftTitle.textContent = leftProjectionName;
  elements.rightTitle.textContent = rightProjectionName;

  const leftArea = renderMap("#map-left", leftProjectionName);
  const rightArea = renderMap("#map-right", rightProjectionName);
  updateStats(leftArea, rightArea);
}

function renderMap(selector, projectionName) {
  const svg = d3.select(selector);
  const width = 840;
  const height = 420;
  svg.selectAll("*").remove();

  const projection = projectionBuilders[projectionName]()
    .fitExtent([[10, 10], [width - 10, height - 10]], {
      type: "FeatureCollection",
      features: state.features
    });
  const path = d3.geoPath(projection);
  const graticule = d3.geoGraticule10();

  svg.append("path")
    .datum(graticule)
    .attr("class", "graticule")
    .attr("d", path);

  const selected = state.features.find((f) => f.id === state.selectedIso);

  svg.selectAll(".country")
    .data(state.features)
    .join("path")
    .attr("class", (d) => d.id === state.selectedIso ? "country country-active" : "country country-other")
    .attr("d", path)
    .append("title")
    .text((d) => `${d.properties?.name || d.id}`);

  if (!selected) return 0;
  return path.area(selected);
}

function updateStats(leftProjectedArea, rightProjectedArea) {
  const feature = state.features.find((f) => f.id === state.selectedIso);
  if (!feature) return;

  const realArea = state.areaByIso.get(state.selectedIso) || 0;
  const areaText = formatArea(realArea);
  elements.realArea.textContent = areaText;

  const index = state.ranked.findIndex((x) => x.iso === state.selectedIso);
  const rank = index >= 0 ? index + 1 : "--";
  elements.rankArea.textContent = `#${rank}`;
  elements.rankHint.textContent = `${feature.properties?.name || state.selectedIso} 在已收录国家中的面积排名`;

  const ratio = leftProjectedArea > 0 ? rightProjectedArea / leftProjectedArea : 0;
  elements.distortion.textContent = ratio > 0 ? `${ratio.toFixed(2)}x` : "--";

  if (ratio > 1.03) {
    elements.distortionHint.textContent = "右侧投影下该国视觉面积更大（被放大）";
  } else if (ratio < 0.97 && ratio > 0) {
    elements.distortionHint.textContent = "右侧投影下该国视觉面积更小（被压缩）";
  } else {
    elements.distortionHint.textContent = "两侧投影视觉面积接近";
  }

  const maxArea = state.ranked[0]?.area || 1;
  const ratioToMax = realArea / maxArea;
  elements.meterValue.textContent = `${(ratioToMax * 100).toFixed(2)}% of max`;
  elements.meterBar.style.width = `${Math.max(1, ratioToMax * 100)}%`;
}

function formatArea(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `${Math.round(value).toLocaleString("en-US")}`;
}

function initClock() {
  updateUtc8Time();
  setInterval(updateUtc8Time, 1000);
}

function updateUtc8Time() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const utc8 = new Date(utc + 8 * 3600000);
  const y = utc8.getUTCFullYear();
  const m = String(utc8.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc8.getUTCDate()).padStart(2, "0");
  const hh = String(utc8.getUTCHours()).padStart(2, "0");
  const mm = String(utc8.getUTCMinutes()).padStart(2, "0");
  const ss = String(utc8.getUTCSeconds()).padStart(2, "0");
  elements.utc8Time.textContent = `${y}-${m}-${d} ${hh}:${mm}:${ss} UTC+8`;
}

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_THEME_KEY);
  const theme = savedTheme === "light" ? "light" : "dark";
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.body.dataset.theme === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem(STORAGE_THEME_KEY, next);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const pathNode = elements.themeIcon.querySelector("path");
  if (!pathNode) return;
  pathNode.setAttribute("d", theme === "light" ? MOON_ICON_PATH : SUN_ICON_PATH);
}
