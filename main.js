// Use TradingView Market Overview widget for realtime data
async function loadTickers(){
  try{
    const r = await fetch('tickers.json');
    if(!r.ok) throw new Error('no tickers');
    return await r.json();
  }catch(e){
    return ['BBCA.JK','TLKM.JK','ASII.JK','BMRI.JK','BBRI.JK'];
  }
}

function toTradingViewSymbol(t){
  // map common Yahoo-style tickers like BBCA.JK -> IDX:BBCA
  if(!t) return t;
  if(t.includes('.')){
    const base = t.split('.')[0];
    return `IDX:${base}`;
  }
  return `IDX:${t}`;
}

function createMarketOverview(symbols){
  const container = document.getElementById('market-overview');
  container.innerHTML = '';
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js';
  const cfg = {
    "colorTheme": "dark",
    "dateRange": "12M",
    "showChart": true,
    "locale": "id",
    "width": "100%",
    "height": 600,
    "isTransparent": true,
    "showSymbolLogo": true,
    "tabs": [
      {
        "title": "Saham ID",
        "symbols": symbols.map(s => ({ s: toTradingViewSymbol(s), d: s.replace('.JK','') }))
      }
    ]
  };
  script.innerHTML = JSON.stringify(cfg);
  container.appendChild(script);
}

async function start(){
  const defaults = await loadTickers();
  const input = document.getElementById('symbolsInput');
  const btn = document.getElementById('applyBtn');
  input.value = defaults.join(',');

  btn.addEventListener('click', ()=>{
    const s = input.value.split(',').map(x=>x.trim()).filter(Boolean);
    if(!s.length) return;
    createMarketOverview(s);
  });

  createMarketOverview(defaults);
}

start();
