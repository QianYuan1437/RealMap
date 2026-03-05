const WORLD_GEOJSON_URL = "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";
const COUNTRY_AREA_URL = "https://restcountries.com/v3.1/all?fields=name,cca3,area";
const EARTH_RADIUS_M = 6371008.8;

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
  meterBar: document.getElementById("meter-bar")
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
