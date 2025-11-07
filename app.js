/* ====== 設定 ====== */
const CITY_DEFAULT = "札幌市";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_EMAIL = "you@example.com"; // 連絡先(必須ではないが推奨)
const SAPPORO_VIEWBOX = "141.18,43.16,141.52,43.14"; // lon1,lat1,lon2,lat2 (おおよそ札幌中心域を囲む) ※緯度経度の順序に注意
// ↑ Nominatimのviewboxは left,top,right,bottom（lon,lat,lon,lat）です。下のfetchで &bounded=1 と併用。

/* ====== i18n（UI文言のみ） ====== */
const resources = {
  ja:{ translation:{
    title:"札幌イベントMAP",
    "cat.all":"すべて","cat.sightseeing":"観光","cat.food":"グルメ","cat.activity":"体験","cat.learn":"学び","cat.other":"その他",
    "date.today":"今日","date.weekend":"今週末","date.nextweek":"来週","date.clear":"日付解除",
    "view.toggle":"地図＋一覧",
    "search.placeholder":"施設名やイベント名で検索",
    hits:"件ヒット"
  }},
  en:{ translation:{
    title:"Sapporo Events Map",
    "cat.all":"All","cat.sightseeing":"Sightseeing","cat.food":"Food","cat.activity":"Activity","cat.learn":"Learning","cat.other":"Other",
    "date.today":"Today","date.weekend":"This weekend","date.nextweek":"Next week","date.clear":"Clear date",
    "view.toggle":"Map + List",
    "search.placeholder":"Search by venue or event",
    hits:"hits"
  }},
  es:{ translation:{
    title:"Mapa de eventos Sapporo",
    "cat.all":"Todo","cat.sightseeing":"Turismo","cat.food":"Gastronomía","cat.activity":"Actividades","cat.learn":"Aprender","cat.other":"Otros",
    "date.today":"Hoy","date.weekend":"Este finde","date.nextweek":"Próxima semana","date.clear":"Quitar fecha",
    "view.toggle":"Mapa + Lista",
    "search.placeholder":"Buscar por lugar o evento",
    hits:"resultados"
  }},
  ko:{ translation:{
    title:"삿포로 이벤트 지도",
    "cat.all":"전체","cat.sightseeing":"관광","cat.food":"맛집","cat.activity":"체험","cat.learn":"배움","cat.other":"기타",
    "date.today":"오늘","date.weekend":"이번 주말","date.nextweek":"다음 주","date.clear":"해제",
    "view.toggle":"지도 + 목록",
    "search.placeholder":"시설명/이벤트명 검색",
    hits:"건"
  }},
  zh:{ translation:{
    title:"札幌活动地图",
    "cat.all":"全部","cat.sightseeing":"观光","cat.food":"美食","cat.activity":"体验","cat.learn":"学习","cat.other":"其他",
    "date.today":"今天","date.weekend":"本周末","date.nextweek":"下周","date.clear":"清除",
    "view.toggle":"地图+列表",
    "search.placeholder":"按场馆或活动搜索",
    hits:"条"
  }},
};
i18next.init({ lng:"ja", resources }).then(appInit);

/* ====== グローバル状態 ====== */
let map, markersLayer;
let allEvents = [];
let activeCat = "all";
let activeDateFilter = null; // "today" | "weekend" | "nextweek" | null
let searchQuery = "";

/* ====== 初期化 ====== */
function appInit(){
  applyI18nTexts();
  document.getElementById("langSelect").addEventListener("change", (e)=>{
    i18next.changeLanguage(e.target.value).then(applyI18nTexts);
  });

  setupMap();
  bindUI();

  fetch("events.json")
    .then(r=>r.json())
    .then(async (data)=>{
      allEvents = data;
      await ensureCoordsForEvents(allEvents); // 施設名から自動ジオコーディング
      render();
    })
    .catch(err=>console.error(err));
}

function applyI18nTexts(){
  // data-i18n と data-i18n-placeholder でUI差し替え
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    el.textContent = i18next.t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
    el.setAttribute("placeholder", i18next.t(el.getAttribute("data-i18n-placeholder")));
  });
  document.title = i18next.t("title");
}

function setupMap(){
  map = L.map("map", { zoomControl:true }).setView([43.0618, 141.3545], 12); // 札幌中心
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function bindUI(){
  // カテゴリタブ
  document.querySelectorAll("#categoryTabs .tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#categoryTabs .tab").forEach(b=>b.classList.remove("is-active"));
      btn.classList.add("is-active");
      activeCat = btn.dataset.cat;
      render();
    });
  });
  // 日付クイック
  document.querySelectorAll(".date-filters .btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const mode = btn.dataset.date;
      activeDateFilter = (mode==="clear") ? null : mode;
      render();
    });
  });
  // 検索
  document.getElementById("searchBox").addEventListener("input", (e)=>{
    searchQuery = e.target.value.trim();
    render();
  });
  // ビューモード切替（今回は簡易：モバイルは自動で上下、PCは左右）
  document.getElementById("toggleView").addEventListener("click", ()=>{
    // ここではプレースホルダ（モード保持のみ）
    const t = e.target;
    t.dataset.mode = (t.dataset.mode==="both") ? "list" : "both";
  });
}

/* ====== レンダリング ====== */
function render(){
  const filtered = filterEvents(allEvents);
  drawMarkers(filtered);
  drawList(filtered);
  document.getElementById("hitCount").textContent =
    `${filtered.length} ${i18next.t("hits")}`;
}

function filterEvents(events){
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay()); // 日曜基準
  const nextWeekStart = new Date(startOfWeek); nextWeekStart.setDate(startOfWeek.getDate()+7);
  const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekStart.getDate()+6);

  return events.filter(ev=>{
    // カテゴリ
    if (activeCat!=="all" && ev.category!==activeCat) return false;
    // 日付
    if (activeDateFilter){
      const s = new Date(ev.start), e = new Date(ev.end || ev.start);
      if (activeDateFilter==="today"){
        const sameDay = (d)=> d.toDateString()===today.toDateString();
        if (!(sameDay(s) || sameDay(e) || (s<=today && today<=e))) return false;
      } else if (activeDateFilter==="weekend"){
        // 金(5)〜日(0)の間にかかるか
        const weekendDays = [5,6,0];
        const coversWeekend = (d)=> weekendDays.includes(new Date(d).getDay());
        if (!(coversWeekend(s) || coversWeekend(e))) return false;
      } else if (activeDateFilter==="nextweek"){
        // 翌週の月〜日と交差するか
        const overlap = !(e < nextWeekStart || s > nextWeekEnd);
        if (!overlap) return false;
      }
    }
    // 検索（イベント名・施設名・住所）
    if (searchQuery){
      const q = searchQuery.toLowerCase();
      const hay = `${ev.name||""} ${ev.place||""} ${ev.address||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function drawMarkers(events){
  markersLayer.clearLayers();
  if (!events.length) return;

  const bounds = [];
  events.forEach(ev=>{
    if (ev.lat && ev.lng){
      const m = L.marker([ev.lat, ev.lng]).addTo(markersLayer)
        .bindPopup(`
          <strong>${escapeHtml(ev.name)}</strong><br/>
          ${formatDate(ev.start, ev.end)}<br/>
          ${ev.place ? escapeHtml(ev.place) : ""}<br/>
          ${ev.address ? escapeHtml(ev.address) : ""}
        `);
      bounds.push([ev.lat, ev.lng]);
      // リストクリックと同期のため id を保持
      m._eventId = ev.id;
    }
  });
  if (bounds.length){
    map.fitBounds(bounds, { padding:[20,20] });
  }
}

function drawList(events){
  const ul = document.getElementById("eventList");
  ul.innerHTML = "";
  const frag = document.createDocumentFragment();
  events.forEach(ev=>{
    const li = document.createElement("li");
    li.className = "event-card";
    li.innerHTML = `
      <div class="event-title">${escapeHtml(ev.name)}</div>
      <div class="event-meta">
        <span class="badge">${ev.category}</span>
        <span>${formatDate(ev.start, ev.end)}</span><br/>
        <span>${ev.place ? escapeHtml(ev.place) : ""}</span>
      </div>
    `;
    li.addEventListener("click", ()=>{
      if (ev.lat && ev.lng){
        map.setView([ev.lat, ev.lng], 16);
      }
    });
    frag.appendChild(li);
  });
  ul.appendChild(frag);
}

function formatDate(start, end){
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const fmt = (d)=> `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  return e ? `${fmt(s)} - ${fmt(e)}` : fmt(s);
}

function escapeHtml(str=""){
  return str.replace(/[&<>'"]/g, s=>({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[s]));
}

/* ====== 施設名 → 座標 自動取得（Nominatim） ======
   - events.jsonで lat/lng が欠けている場合に実行
   - 札幌の範囲(viewbox)を優先、結果を localStorage にキャッシュ
   - レート制限を考慮し1000ms間隔で呼び出し
================================================= */
async function ensureCoordsForEvents(events){
  const cache = loadGeoCache();
  const pending = [];
  for (const ev of events){
    if (ev.lat && ev.lng) continue;
    const key = geoCacheKey(ev);
    if (cache[key]){
      ev.lat = cache[key].lat; ev.lng = cache[key].lng;
      continue;
    }
    // 後でまとめて叩く
    pending.push({ ev, key });
  }
  for (const item of pending){
    const { ev, key } = item;
    const q = buildQuery(ev);
    if (!q) continue;
    try{
      const result = await geocodeByNominatim(q);
      if (result){
        ev.lat = parseFloat(result.lat);
        ev.lng = parseFloat(result.lon);
        cache[key] = { lat: ev.lat, lng: ev.lng };
        saveGeoCache(cache);
      }
    }catch(e){ console.warn("geocode failed", e); }
    await wait(1000); // マナー：1秒間隔
  }
}

function buildQuery(ev){
  const parts = [];
  if (ev.place) parts.push(ev.place);
  else if (ev.name) parts.push(ev.name);
  if (ev.address) parts.push(ev.address);
  // 市区町村を補強（施設名だけでも札幌を優先）
  parts.push(CITY_DEFAULT);
  return parts.join(" ");
}

async function geocodeByNominatim(query){
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "ja");
  // 札幌市の範囲を優先（left,top,right,bottom）
  url.searchParams.set("viewbox", "141.18,43.16,141.52,43.00");
  url.searchParams.set("bounded", "1");

  const headers = { "User-Agent": `SapporoEventsMap/1.0 (${NOMINATIM_EMAIL})` };
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const arr = await res.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function geoCacheKey(ev){
  return (ev.place || ev.name || "") + "|" + (ev.address || "") + "|" + CITY_DEFAULT;
}
function loadGeoCache(){
  try{ return JSON.parse(localStorage.getItem("geoCache")||"{}"); }catch{ return {}; }
}
function saveGeoCache(obj){
  localStorage.setI
