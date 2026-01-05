// API key yang Anda berikan (akan terekspos jika dipakai langsung di browser)
const API_KEY = 'CG-stoyH3P91DcyTCpd8kwRKsML';
const PUBLIC_BASE = 'https://api.coingecko.com/api/v3';
const PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
let BASE = PUBLIC_BASE; // use public root by default (demo keys)
// Asset abstraction: change these via window.* before loading app.js
let ASSET_ID = window.ASSET_ID || 'bitcoin'; // CoinGecko coin id
let ASSET_LABEL = window.ASSET_LABEL || 'BTC'; // short label for display
let ASSET_PAIR = window.ASSET_PAIR || 'BTC / USD'; // display pair

const ctx = document.getElementById('btcChart').getContext('2d');
const noteEl = document.getElementById('note');
const rangeSelect = document.getElementById('rangeSelect');
const refreshBtn = document.getElementById('refreshBtn');
const priceBox = document.getElementById('priceBox');
const predToggleBtn = document.getElementById('predToggleBtn');
const analysisResultsEl = document.getElementById('analysisResults');
const indicatorCtx = document.getElementById('indicatorChart') && document.getElementById('indicatorChart').getContext('2d');
const assetToggleBtn = document.getElementById('assetToggleBtn');
const pageTitle = document.getElementById('pageTitle');
const predCountdownEl = document.getElementById('predCountdown');

let btcChart = null;
// Price polling control
let pricePollId = null;
let pricePollActive = false;
const PRICE_POLL_MS = 5 * 1000; // poll price every 5 seconds
let autoRefreshId = null;
let autoRefreshActive = false;
// Auto refresh interval (5 seconds)
const AUTO_REFRESH_MS = 5 * 1000;
// If true, suppress non-error status messages in `noteEl` during automatic polling
const SILENT_FETCH = true;
// Fast chart-only polling (updates chart only, no analysis/prediction)
let chartPollId = null;
let chartPollActive = false;
const CHART_POLL_MS = 5 * 1000; // chart refresh every 5s (tune for mobile)
// Prediction toggle
let predActive = false;

function msToLabel(ms){
  const d = new Date(ms);
  return d.toLocaleString();
}

async function fetchMarketChart(days = 30){
  if(!SILENT_FETCH) noteEl.textContent = 'Meminta data dari CoinGecko...';
  const url = `${BASE}/coins/${ASSET_ID}/market_chart?vs_currency=usd&days=${days}`;
  try{
    const headers = BASE === PRO_BASE && API_KEY ? { 'x-cg-pro-api-key': API_KEY } : {};
    const res = await fetch(url, { headers });
    const text = await res.text();
    if(!res.ok){
      let detail = text;
      try{ const j = JSON.parse(text); detail = j.error || JSON.stringify(j); }catch(e){}
      noteEl.textContent = `Gagal mengambil data: HTTP ${res.status} — ${detail}`;
      console.error('CoinGecko error response:', res.status, detail);
      // If server suggests switching to pro root, attempt one retry with PRO_BASE
      const lower = detail.toLowerCase();
      if(lower.includes('pro-api.coingecko.com') && BASE !== PRO_BASE && API_KEY){
        BASE = PRO_BASE;
        return await fetchMarketChart(days);
      }
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    const data = JSON.parse(text);
    return data;
  }catch(err){
    // suppress noisy network errors like 'Failed to fetch' during continuous polling
    if(!/failed to fetch/i.test(err.message || '')){
      noteEl.textContent = `Gagal mengambil data: ${err.message}`;
    } else {
      console.warn('fetchMarketChart network error suppressed:', err.message);
    }
    throw err;
  }
}

// Fetch current BTC price (simple endpoint) and update priceBox
// Fetch current BTC price once (do not update dynamically to avoid interfering with chart)
async function fetchCurrentPrice(){
  if(!priceBox) return;
  const url = `${BASE}/simple/price?ids=${ASSET_ID}&vs_currencies=usd`;
  try{
    const headers = BASE === PRO_BASE && API_KEY ? { 'x-cg-pro-api-key': API_KEY } : {};
    // avoid cache so we get the freshest price
    const res = await fetch(url, { headers, cache: 'no-store' });
    if(!res.ok){
      priceBox.textContent = '—';
      return;
    }
    const data = await res.json();
    const price = data && data[ASSET_ID] && data[ASSET_ID].usd;
    if(typeof price === 'number'){
      const formatted = `$${price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      priceBox.textContent = formatted;
    }else{
      priceBox.textContent = '—';
    }
  }catch(err){
    console.error('Failed to fetch price', err);
    priceBox.textContent = '—';
  }
}

function startPricePoll(){
  if(pricePollActive) return;
  pricePollActive = true;
  const run = async () => {
    try{
      await fetchCurrentPrice();
    }catch(e){
      // already logged in fetchCurrentPrice
    }
    if(pricePollActive){
      pricePollId = setTimeout(run, PRICE_POLL_MS);
    }
  };
  // run immediately
  run();
}

function stopPricePoll(){
  pricePollActive = false;
  if(pricePollId) clearTimeout(pricePollId);
}

function prepareDataset(prices){
  // prices: [[timestamp, price], ...]
  const labels = prices.map(p => msToLabel(p[0]));
  const values = prices.map(p => p[1]);
  return {labels, values};
}

// ----- Technical indicators -----
function computeSMA(values, period){
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for(let i=0;i<values.length;i++){
    sum += values[i];
    if(i>=period) sum -= values[i-period];
    if(i>=period-1) out[i] = sum/period;
  }
  return out;
}

function computeEMA(values, period){
  const out = new Array(values.length).fill(null);
  const k = 2/(period+1);
  let ema = null;
  for(let i=0;i<values.length;i++){
    const v = values[i];
    if(ema === null){ ema = v; out[i] = ema; }
    else { ema = v * k + ema * (1-k); out[i] = ema; }
  }
  return out;
}

function computeRSI(values, period = 14){
  const out = new Array(values.length).fill(null);
  let gains=0, losses=0;
  for(let i=1;i<values.length;i++){
    const change = values[i]-values[i-1];
    if(i<=period){ if(change>0) gains+=change; else losses += Math.abs(change); if(i===period){ const avgG=gains/period, avgL=losses/period; const rs = avgL===0?100:avgG/avgL; out[i]=100-(100/(1+rs)); }}
    else{
      const changePrev = values[i]-values[i-1];
      const gain = Math.max(0,changePrev), loss = Math.max(0,-changePrev);
      gains = (gains*(period-1)+gain)/period;
      losses = (losses*(period-1)+loss)/period;
      const rs = losses===0?100:gains/losses;
      out[i] = 100-(100/(1+rs));
    }
  }
  return out;
}

function computeMACD(values, short=12, long=26, signal=9){
  const emaShort = computeEMA(values, short);
  const emaLong = computeEMA(values, long);
  const macd = values.map((v,i)=> (emaShort[i]!==null && emaLong[i]!==null)? emaShort[i]-emaLong[i] : null);
  // compute signal line
  const signalLine = computeEMA(macd.map(v=>v===null?0:v), signal);
  const hist = macd.map((v,i)=> (v!==null && signalLine[i]!==null)? v - signalLine[i] : null);
  return { macd, signalLine, hist };
}

function clearIndicatorDatasets(){
  if(!btcChart) return;
  btcChart.data.datasets = btcChart.data.datasets.filter(ds => !ds._isIndicator);
}

function renderIndicatorChart(labels, series){
  if(!indicatorCtx) return;
  // simple line chart for RSI or MACD histogram
  if(window._indicatorChart){ window._indicatorChart.data.labels = labels; window._indicatorChart.data.datasets = series; window._indicatorChart.update(); return; }
  window._indicatorChart = new Chart(indicatorCtx, { type: 'line', data:{ labels, datasets: series }, options:{ responsive:false, maintainAspectRatio:false } });
}

async function performTechnicalAnalysis(pricesRaw){
  if(!pricesRaw || !pricesRaw.length) return;
  const labels = pricesRaw.map(p=>msToLabel(p[0]));
  const values = pricesRaw.map(p=>p[1]);

  // compute indicators
  const sma50 = computeSMA(values, 50);
  const ema20 = computeEMA(values, 20);
  const rsi14 = computeRSI(values, 14);
  const macdRes = computeMACD(values);

  // render BTC + indicators on lower indicator chart (replace previous)
  const btcValues = values; // reuse computed values and labels
  renderPredictionChart(labels, btcValues, new Array(btcValues.length).fill(null));
  // add SMA and EMA as extra datasets on indicator chart
  if(_indicatorChart){
    _indicatorChart.data.datasets.push({ label: 'SMA(50)', data: sma50, borderColor:'#FFD700', pointRadius:0, tension:0.15 });
    _indicatorChart.data.datasets.push({ label: 'EMA(20)', data: ema20, borderColor:'#DAA520', pointRadius:0, tension:0.15 });
    _indicatorChart.update();
  }

  // render RSI in text summary and show textual summary
  const latestPrice = values[values.length-1];
  const latestRSI = rsi14[rsi14.length-1];
  const latestMACD = macdRes.macd[macdRes.macd.length-1];
  const latestHist = macdRes.hist[macdRes.hist.length-1];

  const signalParts = [];
  if(latestRSI !== null){ if(latestRSI > 70) signalParts.push('RSI: Overbought'); else if(latestRSI < 30) signalParts.push('RSI: Oversold'); else signalParts.push('RSI: Neutral'); }
  if(latestMACD !== null){ signalParts.push(latestHist>0? 'MACD: Bullish' : 'MACD: Bearish'); }

  analysisResultsEl.innerHTML = `Harga terakhir: $${latestPrice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}<br>SMA(50): ${sma50[sma50.length-1] ? '$'+sma50[sma50.length-1].toFixed(2) : '—'}<br>EMA(20): ${ema20[ema20.length-1] ? '$'+ema20[ema20.length-1].toFixed(2) : '—'}<br>RSI(14): ${latestRSI? latestRSI.toFixed(2) : '—'}<br>MACD hist: ${latestHist? latestHist.toFixed(4) : '—'}<br><b>Sinyal:</b> ${signalParts.join(', ')}`;

  renderIndicatorChart(labels, [ { label:'RSI(14)', data: rsi14, borderColor:'#34d399', backgroundColor:'rgba(52,211,153,0.06)', pointRadius:0 } ]);
}

function updatePageTitleAndButtons(){
  if(pageTitle) pageTitle.textContent = `Grafik Harga ${ASSET_PAIR}`;
  if(assetToggleBtn){
    const other = ASSET_ID === 'bitcoin' ? 'XAU/USD' : 'BTC/USD';
    assetToggleBtn.textContent = `Ganti ke ${other}`;
  }
}

// asset toggle handler
if(assetToggleBtn){
  assetToggleBtn.addEventListener('click', async ()=>{
    // toggle between bitcoin and tether-gold
    if(ASSET_ID === 'bitcoin'){
      ASSET_ID = 'tether-gold'; ASSET_LABEL = 'XAU'; ASSET_PAIR = 'XAU / USD';
    }else{
      ASSET_ID = 'bitcoin'; ASSET_LABEL = 'BTC'; ASSET_PAIR = 'BTC / USD';
    }
    updatePageTitleAndButtons();
    // clear charts and reload
    if(btcChart){ btcChart.data.labels = []; btcChart.data.datasets.forEach(ds=>ds.data=[]); btcChart.update(); }
    if(_indicatorChart){ _indicatorChart.data.labels = []; _indicatorChart.data.datasets.forEach(ds=>ds.data=[]); _indicatorChart.update(); }
    try{ await loadAndRender(rangeSelect.value); }catch(e){ console.warn('Failed to reload after asset switch', e); }
  });
}

// initialize UI
updatePageTitleAndButtons();

// ----- Fundamental analysis -----
async function performFundamentalAnalysis(){
  try{
    if(!SILENT_FETCH) analysisResultsEl.textContent = 'Meminta data fundamental...';
    const url = `${BASE}/coins/${ASSET_ID}?localization=false&tickers=false&market_data=true`;
    const headers = BASE === PRO_BASE && API_KEY ? { 'x-cg-pro-api-key': API_KEY } : {};
    const res = await fetch(url, { headers });
    if(!res.ok){ if(!SILENT_FETCH) analysisResultsEl.textContent = 'Gagal mengambil data fundamental.'; return; }
    const j = await res.json();
    const md = j.market_data || {};
    const mc = md.market_cap && md.market_cap.usd ? md.market_cap.usd : null;
    const vol = md.total_volume && md.total_volume.usd ? md.total_volume.usd : null;
    const change24 = md.price_change_percentage_24h;
    const circ = md.circulating_supply;
    const supply = md.total_supply;

    const scoreParts = [];
    if(change24 != null) scoreParts.push(`24h change: ${change24.toFixed(2)}%`);
    if(mc) scoreParts.push(`Market Cap: $${Number(mc).toLocaleString()}`);
    if(vol) scoreParts.push(`24h Volume: $${Number(vol).toLocaleString()}`);
    if(circ) scoreParts.push(`Circulating: ${Number(circ).toLocaleString()}`);

    analysisResultsEl.innerHTML = `<b>Fundamental (CoinGecko)</b><br>${scoreParts.join('<br>')}`;
    // small indicator: market cap rank if available
    if(j.market_cap_rank) analysisResultsEl.innerHTML += `<br>Rank pasar: ${j.market_cap_rank}`;
  }catch(e){
    console.error(e); if(!SILENT_FETCH) analysisResultsEl.textContent = 'Kesalahan saat mengambil data fundamental.';
  }
}

// fetch fundamentals (lightweight) without updating UI
async function fetchFundamentals(){
  try{
    const url = `${BASE}/coins/${ASSET_ID}?localization=false&tickers=false&market_data=true`;
    const headers = BASE === PRO_BASE && API_KEY ? { 'x-cg-pro-api-key': API_KEY } : {};
    const res = await fetch(url, { headers });
    if(!res.ok) return null;
    const j = await res.json();
    const md = j.market_data || {};
    return {
      market_cap: md.market_cap && md.market_cap.usd ? md.market_cap.usd : null,
      volume_24h: md.total_volume && md.total_volume.usd ? md.total_volume.usd : null,
      change_24h: md.price_change_percentage_24h || null,
      rank: j.market_cap_rank || null
    };
  }catch(e){ console.warn('fetchFundamentals failed', e); return null; }
}

// Convert fundamentals into a blending multiplier (simple heuristic)
function fundamentalBlendScore(fund){
  if(!fund) return 1.0;
  // base score from 24h change: map -10%..+10% -> 0.9..1.1
  const c = Math.max(-20, Math.min(20, (fund.change_24h || 0)));
  const changeScore = 1 + (c / 100) * 0.5; // scale down influence

  // volume influence: higher recent volume -> slightly increase trust
  const volScore = fund.volume_24h ? 1 + Math.min(1, Math.log10(fund.volume_24h+1) / 10) * 0.02 : 1;

  // market cap rank: lower rank (1 is biggest) -> slightly more stable
  const rankScore = fund.rank ? 1 + (fund.rank <= 10 ? 0.01 : 0) : 1;

  // final multiplier clipped reasonably
  let mult = changeScore * volScore * rankScore;
  mult = Math.max(0.8, Math.min(1.2, mult));
  return mult;
}

// Compute a numeric position signal and TP/SL suggestions using MC results + fundamentals
function computePositionSignal(mc, fund, lastPrice){
  // mc.percentUp is percentage 0..100, mc.avgAccuracy is percent
  const upProb = (mc && typeof mc.percentUp === 'number') ? (mc.percentUp/100) : 0.5;
  const acc = (mc && typeof mc.avgAccuracy === 'number') ? (mc.avgAccuracy/100) : 0.5;
  const blend = fundamentalBlendScore(fund || null) || 1.0;

  // score in range -1..1 (positive favors Buy)
  let score = (upProb - 0.5) * 2; // -1..1
  score = score * acc * blend;

  // determine position
  let position = 'Neutral';
  if(score > 0.12) position = 'Buy';
  else if(score < -0.12) position = 'Sell';

  // TP/SL using MC median and std if available
  const median = (mc && typeof mc.median === 'number') ? mc.median : lastPrice;
  const std = (mc && typeof mc.std === 'number') ? mc.std : Math.abs(lastPrice*0.01);
  let tp=null, sl=null;
  if(position === 'Buy'){
    tp = median + std * 1.5;
    sl = lastPrice - std * 1.5;
  }else if(position === 'Sell'){
    tp = median - std * 1.5;
    sl = lastPrice + std * 1.5;
  }

  return { position, score: Math.round(score*1000)/1000, tp, sl };
}

function renderChart(labels, values){
  if(btcChart){
    btcChart.data.labels = labels;
    btcChart.data.datasets[0].data = values;
    btcChart.update();
    return;
  }

  btcChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: ASSET_PAIR,
        data: values,
        borderColor: '#D4AF37',
        backgroundColor: 'rgba(212,175,55,0.08)',
        pointRadius: 0,
        tension: 0.15,
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      scales: {
        x: {display:true},
        y: {display:true}
      },
      plugins: {
        legend: {display:true}
      }
    }
  });
}

async function loadAndRender(days){
  try{
    const data = await fetchMarketChart(days);
    if(!data || !data.prices){
      if(!SILENT_FETCH) noteEl.textContent = 'Respons tidak berisi data harga.';
      return;
    }
    const {labels, values} = prepareDataset(data.prices);
    // Update chart
    renderChart(labels, values);

    // Update price box to match latest value from the chart data
    try{
      if(priceBox && Array.isArray(data.prices) && data.prices.length){
        const lastPrice = data.prices[data.prices.length - 1][1];
        if(typeof lastPrice === 'number'){
          priceBox.textContent = `$${lastPrice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        }
      }
    }catch(e){
      console.error('Failed to update price box from chart data', e);
    }

    if(!SILENT_FETCH) noteEl.textContent = `Terakhir dimuat: ${new Date().toLocaleString()} — rentang ${days} hari`;
    // NOTE: removed automatic background prediction here so predictions
    // do not run during auto-refresh. Prediction should be triggered
    // explicitly (e.g. when the user enables the toggle).
    return data;
  }catch(e){
    console.error(e);
    throw e;
  }
}

// Event handlers
refreshBtn.addEventListener('click', () => loadAndRender(rangeSelect.value));
rangeSelect.addEventListener('change', () => loadAndRender(rangeSelect.value));

// Inisialisasi
loadAndRender(rangeSelect.value);

// Auto-refresh loop: wait for each load to finish, then schedule next (no overlap)
function startAutoRefresh(){
  if(autoRefreshActive) return;
  autoRefreshActive = true;
  const run = async () => {
    try{
      await loadAndRender(rangeSelect.value);
    }catch(e){
      // errors already logged in loadAndRender/fetch
    }
    if(autoRefreshActive){
      autoRefreshId = setTimeout(run, AUTO_REFRESH_MS);
    }
  };
  run();
}

function stopAutoRefresh(){
  autoRefreshActive = false;
  if(autoRefreshId) clearTimeout(autoRefreshId);
}

// Chart-only refresh: fetch latest market_chart and update `btcChart` only
function startChartPoll(){
  if(chartPollActive) return;
  chartPollActive = true;
  let chartPollCounter = 0;
  const FUNDAMENTAL_INTERVAL = Math.max(1, Math.floor(60000 / CHART_POLL_MS));
  const run = async () => {
    try{
      const data = await fetchMarketChart(rangeSelect.value);
      if(data && Array.isArray(data.prices)){
        const { labels, values } = prepareDataset(data.prices);
        renderChart(labels, values);
        // update price box to match latest value
        if(priceBox && data.prices.length){
          const lastPrice = data.prices[data.prices.length - 1][1];
          if(typeof lastPrice === 'number') priceBox.textContent = `$${lastPrice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        }
        // update technical indicators continuously (lighter than running full ML prediction)
        try{ performTechnicalAnalysis(data.prices); }catch(e){ /* ignore indicator errors */ }
        // fetch fundamentals less frequently to reduce API usage
        chartPollCounter++;
        if(chartPollCounter % FUNDAMENTAL_INTERVAL === 0){
          try{ performFundamentalAnalysis(); }catch(e){ /* ignore */ }
        }
      }
    }catch(e){ /* ignore errors for periodic chart polling */ }
    if(chartPollActive) chartPollId = setTimeout(run, CHART_POLL_MS);
  };
  run();
}

function stopChartPoll(){
  chartPollActive = false;
  if(chartPollId) clearTimeout(chartPollId);
}

// Start fast chart-only polling at CHART_POLL_MS interval (keeps chart fresh without running analysis)
startChartPoll();

// --- Machine learning prediction (TF.js) + Firebase storage ---
// Firebase config placeholder: fill these values if you want to store predictions
const firebaseConfig = {
  apiKey: "AIzaSyDr4fPKXreCk9Ih2xF5X39rqx4ok1zo4lY",
  authDomain: "btcc-c1f0f.firebaseapp.com",
  databaseURL: "https://btcc-c1f0f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "btcc-c1f0f",
  storageBucket: "btcc-c1f0f.firebasestorage.app",
  messagingSenderId: "647840129712",
  appId: "1:647840129712:web:f7da02611a6412d3591175",
  measurementId: "G-5LTDCL8P9N"
};

// Use provided config or fall back to the local placeholder above.
const FIREBASE_CONFIG = window.FIREBASE_CONFIG || firebaseConfig;

// CDN locations for lazy-loading prediction libraries (try fallbacks)
const TF_CDNS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.9.0/dist/tf.min.js',
  'https://unpkg.com/@tensorflow/tfjs@4.10.0/dist/tf.min.js'
];
const FIREBASE_APP_CDN = 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js';
const FIREBASE_DB_CDN = 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database-compat.js';

// Will be initialized lazily when prediction is requested
let firebaseApp = null;
let firebaseDb = null;

const mcGridEl = document.getElementById('mcGrid');
const nextEstimateEl = document.getElementById('nextEstimate');
const adviceBtn = document.getElementById('adviceBtn');

function loadScript(url){
  return new Promise((resolve,reject)=>{
    if(document.querySelector(`script[src="${url}"]`)) return resolve();
    const s = document.createElement('script'); s.src = url; s.async = true;
    s.onload = () => resolve(); s.onerror = (e) => reject(new Error('Failed to load '+url));
    document.head.appendChild(s);
  });
}

async function ensurePredictionLibs(){
  try{
    if(!window.tf){
      let loaded = false;
      for(const url of TF_CDNS){
        try{ await loadScript(url); if(window.tf){ loaded = true; break; } }catch(e){ console.warn('TF CDN load failed', url, e); }
      }
      if(!loaded) throw new Error('Failed to load TensorFlow.js from all CDNs');
    }
    if(!window.firebase) {
      await loadScript(FIREBASE_APP_CDN);
      await loadScript(FIREBASE_DB_CDN);
    }
    if(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && !firebaseDb){
      try{
        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDb = firebase.database();
      }catch(e){
        console.warn('Firebase init failed (lazy)', e);
      }
    }
  }catch(e){
    console.warn('Failed to load prediction libraries', e);
  }
}

// Read recent historical prediction summaries from Firebase (if available)
async function fetchHistoricalMean(limit = 200){
  if(!firebaseDb) return null;
  try{
    const snap = await firebaseDb.ref('predictions').orderByChild('timestamp').limitToLast(limit).once('value');
    const vals = [];
    snap.forEach(child => {
      const v = child.val();
      if(v && v.mc){
        if(typeof v.mc.mean === 'number') vals.push(v.mc.mean);
        else if(Array.isArray(v.mc.nextPreds) && v.mc.nextPreds.length) {
          const m = v.mc.nextPreds.reduce((a,b)=>a+b,0)/v.mc.nextPreds.length; vals.push(m);
        }
      }
    });
    if(!vals.length) return null;
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    return mean;
  }catch(e){ console.warn('fetchHistoricalMean failed', e); return null; }
}

// fetch last prediction records
async function fetchLastPredictions(limit = 100){
  if(!firebaseDb) return [];
  try{
    const snap = await firebaseDb.ref('predictions').orderByChild('timestamp').limitToLast(limit).once('value');
    const out = [];
    snap.forEach(child => { const v = child.val(); if(v) out.push(v); });
    return out.reverse(); // return newest first
  }catch(e){ console.warn('fetchLastPredictions failed', e); return []; }
}

// Advice: compute average historical MC accuracy and optionally return suggestion
async function handleAdviceRequest(){
  try{
    await ensurePredictionLibs();
    if(!firebaseDb){ analysisResultsEl.innerHTML = '<b>Minta Saran:</b> Firebase tidak dikonfigurasi.'; return; }
    const recs = await fetchLastPredictions(200);
    if(!recs.length){ analysisResultsEl.innerHTML = '<b>Minta Saran:</b> Tidak ada data historis.'; return; }
    // compute mean of mc.avgAccuracy
    const accs = recs.map(r=> r.mc && typeof r.mc.avgAccuracy === 'number' ? r.mc.avgAccuracy : null).filter(x=>x!==null);
    const meanAcc = accs.length ? accs.reduce((a,b)=>a+b,0)/accs.length : 0;
    const meanAccRounded = Math.round(meanAcc*100)/100;
    if(meanAcc >= 99){
      // if very high historical accuracy, produce suggestion using latest record
      const latest = recs[0];
      const suggestion = latest.position || (latest.mc && latest.mc.suggested) || 'Neutral';
      const detail = latest.position ? `score ${latest.position.score}` : '';
      analysisResultsEl.innerHTML = `<b>Saran (berdasarkan history ${meanAccRounded}%):</b> ${suggestion} ${detail}`;
      // also render its blended sample if available
      if(latest.blendedNextsSample && latest.blendedNextsSample.length){
        renderMCGrid(latest.blendedNextsSample.concat(new Array(100-latest.blendedNextsSample.length).fill(null)), latest.finalEstimate || null);
      }
    }else{
      analysisResultsEl.innerHTML = `<b>Saran tidak diberikan</b> — rata-rata akurasi historis ${meanAccRounded}%, butuh >=99%`;
    }
  }catch(e){ console.warn('handleAdviceRequest failed', e); analysisResultsEl.innerHTML = `<b>Saran gagal:</b> ${e.message||e}`; }
}

function renderMCGrid(preds, lastPrice){
  if(!mcGridEl) return;
  mcGridEl.innerHTML = '';
  // ensure we display exactly 100 boxes: pad with nulls if needed
  const show = Array.isArray(preds) ? preds.slice(0,100) : [];
  while(show.length < 100) show.push(null);
  show.forEach((v,i)=>{
    const d = document.createElement('div');
    d.style.width = '72px'; d.style.height = '42px'; d.style.display='flex'; d.style.flexDirection='column'; d.style.alignItems='center'; d.style.justifyContent='center';
    d.style.fontSize='12px'; d.style.border='1px solid #333'; d.style.borderRadius='6px';
    d.style.color = '#f8f8f2'; d.style.padding = '4px';
    // if v is an object with advice text and percent, render that
    if(v && typeof v === 'object' && (v.text || typeof v.percent === 'number')){
      d.style.background = v.color || (v.percent >= 60 ? '#064' : (v.percent <= 40 ? '#640' : '#333'));
      const t = document.createElement('div'); t.style.fontSize='12px'; t.style.fontWeight='600'; t.textContent = v.text || '—';
      const p = document.createElement('div'); p.style.fontSize='11px'; p.style.opacity = '0.95'; p.textContent = (typeof v.percent === 'number') ? `${v.percent}%` : '—';
      d.appendChild(t); d.appendChild(p);
    }else{
      d.style.background = '#111'; d.style.opacity = 0.5; d.textContent = '—';
    }
    mcGridEl.appendChild(d);
  });
}

// Prediction chart
// Use the lower indicator canvas for prediction/analysis chart
let _indicatorChart = null;
function renderPredictionChart(labels, actualValues, predictedValues){
  // Charts disabled per user preference — predictions will be shown via the MC grid only.
  return;
}

// Helper to remove all predictions in Firebase
async function clearFirebasePredictions(){
  if(!firebaseDb) return false;
  try{
    await firebaseDb.ref('predictions').remove();
    return true;
  }catch(e){
    console.warn('Failed to remove predictions', e);
    return false;
  }
}

// Prediction toggle button behavior
if(predToggleBtn){
  const PRED_COUNTDOWN_SECONDS = 10; // countdown before running heavy prediction
  const MC_TRIALS = 100; // default Monte Carlo trials (reduced for responsiveness)
  let predCountdownTimer = null;
  let predCountdownRemaining = 0;

  async function startPredictionProcess(){
    // ensure still active
    if(!predActive) return;
    if(!SILENT_FETCH) noteEl.textContent = 'Prediksi diaktifkan';
    try{
      await ensurePredictionLibs();
      const data = await loadAndRender(rangeSelect.value);
      if(!(data && window.tf && Array.isArray(data.prices) && data.prices.length)) return;

      const lastPrice = data.prices[data.prices.length-1][1];
      const lookback = 8;
      const predictSteps = Math.min(12, Math.max(3, Math.floor(data.prices.length / 6)));
      if(!SILENT_FETCH) noteEl.textContent = 'Menjalankan prediksi berulang (ini mungkin butuh waktu)...';

      try{
        console.log('Starting Monte Carlo with trials=', MC_TRIALS);
        const mc = await runMonteCarloPredictions(data.prices, lookback, predictSteps, MC_TRIALS);
        console.log('MC result', mc);
        let fund = null;
        let blend = 1.0;
        let adjustedNext = [];
        let blendedNexts = [];
        let histMean = null;
        let finalEstimate = null;

        if(mc && Array.isArray(mc.nextPreds) && mc.nextPreds.length){
          if(!SILENT_FETCH) noteEl.textContent = `Hasil MC: trials=${mc.trials} — arah up ${mc.percentUp}% — akurasi rata-rata ${mc.avgAccuracy}% — sinyal: ${mc.suggested}`;
          fund = await fetchFundamentals();
          blend = fundamentalBlendScore(fund);
          adjustedNext = mc.nextPreds.map(p=>p * blend);
          try{ histMean = await fetchHistoricalMean(200); }catch(e){ console.warn('histMean fetch err', e); }
          blendedNexts = adjustedNext.map(p => (histMean ? (p * 0.6 + histMean * 0.4) : p));
          finalEstimate = (histMean ? (mc.mean * 0.6 + histMean * 0.4) : mc.mean);
          if(nextEstimateEl) nextEstimateEl.textContent = `Perkiraan berikutnya: $${(Math.round(finalEstimate*100)/100).toLocaleString()}`;
        }else{
          // fallback
          console.warn('MC produced no nextPreds, using fallback trainAndPredict');
          const fallback = await trainAndPredict(data.prices, lookback, predictSteps);
          let base = null;
          if(fallback && Array.isArray(fallback.preds) && fallback.preds.length){
            base = fallback.preds[0];
          } else if(mc && typeof mc.mean === 'number'){
            base = mc.mean;
          } else {
            base = lastPrice;
          }
          adjustedNext = Array.from({length:predictSteps}, (_,i)=> base * (1 + (Math.random()-0.5)*0.02));
          try{ fund = await fetchFundamentals(); blend = fundamentalBlendScore(fund); }catch(e){}
          try{ histMean = await fetchHistoricalMean(200); }catch(e){}
          blendedNexts = adjustedNext.map(p => (histMean ? (p * 0.6 + histMean * 0.4) : p));
          finalEstimate = base;
          if(nextEstimateEl) nextEstimateEl.textContent = `Perkiraan berikutnya (fallback): $${(Math.round(base*100)/100).toLocaleString()}`;
          if(firebaseDb){ try{ const rec = { timestamp:(new Date()).toISOString(), lookback, predictSteps, mc: mc||null, fallbackBase: base, fundamentals: fund }; await firebaseDb.ref('predictions').push(rec); }catch(e){console.warn('Failed to save fallback rec', e);} }
        }

        // render grid of MC small boxes
        try{ renderMCGrid(blendedNexts, lastPrice); }catch(e){ console.warn('renderMCGrid failed', e); }

        // build labels for recent + future
        const recentSlice = data.prices.slice(-predictSteps);
        const recentLabels = recentSlice.map(p=>msToLabel(p[0]));
        const recentActuals = recentSlice.map(p=>p[1]);
        const lastTs = data.prices[data.prices.length-1][0];
        const prevTs = data.prices[data.prices.length-2][0];
        const step = lastTs - prevTs || 86400000;
        const predLabels = [];
        for(let i=1;i<=predictSteps;i++) predLabels.push(msToLabel(lastTs + step * i));

        const combinedLabels = recentLabels.concat(predLabels);
        const actualSeries = recentActuals.concat(new Array(predictSteps).fill(null));
        const predictedSeries = new Array(recentActuals.length).fill(null).concat(adjustedNext.map(v=>Math.round(v*100)/100));

        // render combined chart on lower panel
        renderPredictionChart(combinedLabels, actualSeries, predictedSeries);

        // compute position signal and TP/SL
        const pos = computePositionSignal(mc, fund, lastPrice);

        // show TP/SL suggestions and blended info with numeric score
        analysisResultsEl.innerHTML = `<b>Rekomendasi:</b> ${pos.position} (score ${pos.score}) — Confidence up ${mc && mc.percentUp? mc.percentUp : '—'}% — avg acc ${mc && mc.avgAccuracy? mc.avgAccuracy : '—'}%<br><b>TP:</b> ${pos.tp? '$'+pos.tp.toFixed(2) : '—'} <b>SL:</b> ${pos.sl? '$'+pos.sl.toFixed(2) : '—'}<br>${fund? 'Blended x'+blend.toFixed(3) : ''}`;

        if(firebaseDb){
          try{
            const rec = { timestamp:(new Date()).toISOString(), lookback, predictSteps, mc, blend, fundamentals: fund, position: pos, histMean: histMean, finalEstimate: finalEstimate, blendedNextsSample: blendedNexts.slice(0, Math.min(20, blendedNexts.length)) };
            await firebaseDb.ref('predictions').push(rec);
          }catch(e){ console.warn('Failed to save MC preds', e); }
        }

      }catch(e){ console.warn('Monte Carlo prediction failed', e); analysisResultsEl.innerHTML = `<b>Prediksi gagal:</b> ${e.message || e}`; }

    }catch(e){ console.warn('Failed to trigger load for prediction', e); }
  }

  predToggleBtn.textContent = 'Prediksi: Off';
  predToggleBtn.addEventListener('click', async () => {
    predActive = !predActive;
    predToggleBtn.textContent = predActive ? 'Prediksi: On' : 'Prediksi: Off';
    // if enabling, start countdown before heavy work
    if(predActive){
      predCountdownRemaining = PRED_COUNTDOWN_SECONDS;
      if(predCountdownEl) predCountdownEl.textContent = `Mulai prediksi dalam ${predCountdownRemaining}s`;
      predCountdownTimer = setInterval(()=>{
        predCountdownRemaining -= 1;
        if(predCountdownEl) predCountdownEl.textContent = predCountdownRemaining>0 ? `Mulai prediksi dalam ${predCountdownRemaining}s` : '';
        if(predCountdownRemaining <= 0){
          clearInterval(predCountdownTimer); predCountdownTimer = null; if(predCountdownEl) predCountdownEl.textContent = '';
          // start heavy prediction
          startPredictionProcess();
        }
      }, 1000);
    }else{
      // disabling: cancel countdown or running predictions and clear UI
      if(predCountdownTimer){ clearInterval(predCountdownTimer); predCountdownTimer = null; if(predCountdownEl) predCountdownEl.textContent = ''; }
      if(!SILENT_FETCH) noteEl.textContent = 'Menghentikan prediksi...';
      // Do NOT delete historical prediction data; keep it for future learning
      if(firebaseDb){
        if(!SILENT_FETCH) noteEl.textContent = 'Prediksi dihentikan. Data prediksi disimpan untuk pembelajaran.';
      }else{
        if(!SILENT_FETCH) noteEl.textContent = 'Prediksi dihentikan (Firebase tidak dikonfigurasi).';
      }
      if(_indicatorChart){
        _indicatorChart.data.labels = [];
        _indicatorChart.data.datasets.forEach(ds => ds.data = []);
        _indicatorChart.update();
      }
    }
  });
  // advice button handler
  if(adviceBtn){
    adviceBtn.addEventListener('click', async ()=>{
      if(adviceBtn) adviceBtn.disabled = true;
      await handleAdviceRequest();
      if(adviceBtn) adviceBtn.disabled = false;
    });
  }
}

// Train a tiny TF.js model to predict next price from last N prices
async function trainAndPredict(pricesRaw, lookback = 8, predictSteps = 6){
  if(!window.tf) return null;
  // prepare data: use close prices array
  const prices = pricesRaw.map(p => p[1]);
  if(prices.length < lookback + 2) return null;

  // normalize by dividing by max to stabilize training
  const maxVal = Math.max(...prices);
  const norm = prices.map(v => v / maxVal);

  const xs = [];
  const ys = [];
  for(let i=0;i+lookback < norm.length;i++){
    xs.push(norm.slice(i,i+lookback));
    ys.push([norm[i+lookback]]);
  }

  const split = Math.floor(xs.length * 0.8);
  const xTrain = xs.slice(0,split);
  const yTrain = ys.slice(0,split);
  const xTest = xs.slice(split);
  const yTest = ys.slice(split);

  const tensorX = tf.tensor2d(xTrain);
  const tensorY = tf.tensor2d(yTrain);

  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [lookback] }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: 'meanAbsoluteError' });

  // Train briefly (small epochs to keep fast)
  await model.fit(tensorX, tensorY, { epochs: 30, batchSize: 16, verbose:0 });

  // evaluate on test set to compute accuracy (MAPE)
  let mape = null;
  try{
    if(xTest.length){
      const predTest = model.predict(tf.tensor2d(xTest)).arraySync().map(r=>r[0]);
      const trueTest = yTest.map(r=>r[0]);
      // compute MAPE
      let sum = 0; let cnt=0;
      for(let i=0;i<trueTest.length;i++){ if(trueTest[i]!==0){ sum += Math.abs((trueTest[i]-predTest[i])/trueTest[i]); cnt++; }}
      mape = cnt? (sum/cnt) : null;
    }
  }catch(e){ console.warn('mape err', e); }

  // predict next steps recursively
  let seed = norm.slice(-lookback);
  const preds = [];
  for(let s=0;s<predictSteps;s++){
    const input = tf.tensor2d([seed]);
    const out = model.predict(input).arraySync()[0][0];
    preds.push(out * maxVal);
    seed = seed.slice(1).concat([out]);
  }

  // prepare labels: timestamps after last known interval — approximate by using ms step of last two
  const lastTs = pricesRaw[pricesRaw.length-1][0];
  const prevTs = pricesRaw[pricesRaw.length-2][0];
  const step = lastTs - prevTs || 86400000;
  const predLabels = [];
  for(let i=1;i<=predictSteps;i++) predLabels.push(msToLabel(lastTs + step * i));

  // For display, use recent actual last 'predictSteps' values as actualValues labels
  const recentLabels = pricesRaw.slice(-predictSteps).map(p=>msToLabel(p[0]));
  const recentActuals = pricesRaw.slice(-predictSteps).map(p=>p[1]);

  // Render prediction chart: show recent actual and predicted future
  renderPredictionChart(predLabels.concat([]), recentActuals.concat([]), preds);

  // compute accuracy percent as (1 - mape)*100 if mape present
  const accuracyPercent = (mape===null)? null : Math.max(0, Math.round((1 - mape) * 10000)/100);

  // store to firebase if configured
  if(firebaseDb){
    try{
      const record = {
        timestamp: (new Date()).toISOString(),
        lookback, predictSteps,
        accuracy: accuracyPercent,
        predictions: preds,
      };
      const newRef = firebaseDb.ref('predictions').push();
      await newRef.set(record);
    }catch(e){ console.warn('Failed to save to firebase', e); }
  }

  return { preds, accuracyPercent };
}

// Monte Carlo repeated training to estimate prediction confidence and accuracy
async function runMonteCarloPredictions(pricesRaw, lookback=8, predictSteps=6, trials=1000){
  if(!window.tf) return null;
  const prices = pricesRaw.map(p=>p[1]);
  if(prices.length < lookback + 2) return null;

  const accuracies = [];
  const nextPreds = [];
  const trialsToRun = Math.max(1, Math.min(trials, 1000));

  for(let t=0;t<trialsToRun;t++){
    // prepare dataset with random train/test split via shifting split index
    const xs = [];
    const ys = [];
    for(let i=0;i+lookback < prices.length;i++){
      xs.push(prices.slice(i,i+lookback).map(v=>v));
      ys.push([prices[i+lookback]]);
    }
    const split = Math.floor(xs.length * 0.8);
    const xTrain = xs.slice(0,split);
    const yTrain = ys.slice(0,split);
    const xTest = xs.slice(split);
    const yTest = ys.slice(split);

    if(xTrain.length < 1 || xTest.length < 1){ accuracies.push(0); continue; }

    const tensorX = tf.tensor2d(xTrain);
    const tensorY = tf.tensor2d(yTrain);

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [lookback] }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1 }));
    model.compile({ optimizer: tf.train.adam(0.01), loss: 'meanAbsoluteError' });

    // short training for speed
    await model.fit(tensorX, tensorY, { epochs: 20, batchSize: 16, verbose:0 });

    // evaluate direction accuracy on test set
    try{
      const preds = model.predict(tf.tensor2d(xTest)).arraySync().map(r=>r[0]);
      let correct=0; let total=0;
      for(let i=0;i<preds.length;i++){
        const pDir = preds[i] - xTest[i][xTest[i].length-1];
        const trueDir = yTest[i][0] - xTest[i][xTest[i].length-1];
        if((pDir>=0 && trueDir>=0) || (pDir<0 && trueDir<0)) correct++;
        total++;
      }
      accuracies.push(total? (correct/total*100) : 0);
    }catch(e){ accuracies.push(0); }

    // predict next steps from last seed
    const seed = prices.slice(-lookback);
    const out = model.predict(tf.tensor2d([seed])).arraySync()[0][0];
    nextPreds.push(out);

    // occasionally yield to keep UI responsive
    if(t%20===0 && window.tf && tf.nextFrame) await tf.nextFrame();
  }

  // compute stats for nextPreds
  const lastPrice = prices[prices.length-1];
  const mean = nextPreds.reduce((a,b)=>a+b,0)/nextPreds.length;
  const sorted = nextPreds.slice().sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const variance = nextPreds.reduce((s,v)=>s + Math.pow(v-mean,2),0)/nextPreds.length;
  const std = Math.sqrt(variance);
  const percentUp = nextPreds.filter(p=>p>lastPrice).length/nextPreds.length;
  const avgAccuracy = accuracies.reduce((a,b)=>a+b,0)/accuracies.length;

  // suggest position
  let suggested = 'Neutral';
  if(percentUp >= 0.6) suggested = 'Long';
  else if(percentUp <= 0.4) suggested = 'Short';

  // set TP/SL heuristics
  const tp = suggested==='Long' ? median + std*1.5 : median - std*1.5;
  const sl = suggested==='Long' ? lastPrice - std*1.5 : lastPrice + std*1.5;

  return { trials: trialsToRun, avgAccuracy: Math.round(avgAccuracy*100)/100, mean, median, std, percentUp: Math.round(percentUp*10000)/100, suggested, tp, sl, nextPreds };
}

// Kick off price poll automatically and keep predictions running after each chart update
startPricePoll();

// Attach analysis button handlers (manual only)
// tech/fund buttons removed; analysis now runs inside prediction toggle

// Initialize MC grid with 100 placeholders so layout is stable before predictions
try{
  if(mcGridEl){
    const placeholders = new Array(100).fill(null);
    renderMCGrid(placeholders, null);
  }
  if(nextEstimateEl) nextEstimateEl.textContent = 'Perkiraan berikutnya: —';
}catch(e){ console.warn('Failed to init MC placeholders', e); }
