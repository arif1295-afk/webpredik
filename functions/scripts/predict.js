const admin = require('firebase-admin');
const tf = require('@tensorflow/tfjs');
const fetch = require('node-fetch');

async function fetchFundamentalsServer(){
  try{
    const asset = process.env.ASSET_ID || 'bitcoin';
    const url = `https://api.coingecko.com/api/v3/coins/${asset}?localization=false&tickers=false&market_data=true`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const j = await res.json();
    const md = j.market_data || {};
    return {
      market_cap: md.market_cap && md.market_cap.usd ? md.market_cap.usd : null,
      volume_24h: md.total_volume && md.total_volume.usd ? md.total_volume.usd : null,
      change_24h: md.price_change_percentage_24h || null,
      rank: j.market_cap_rank || null
    };
  }catch(e){ console.warn('fetchFundamentalsServer failed', e); return null; }
}

function fundamentalBlendScoreServer(fund){
  if(!fund) return 1.0;
  const c = Math.max(-20, Math.min(20, (fund.change_24h || 0)));
  const changeScore = 1 + (c / 100) * 0.5;
  const volScore = fund.volume_24h ? 1 + Math.min(1, Math.log10(fund.volume_24h+1) / 10) * 0.02 : 1;
  const rankScore = fund.rank ? 1 + (fund.rank <= 10 ? 0.01 : 0) : 1;
  let mult = changeScore * volScore * rankScore;
  mult = Math.max(0.8, Math.min(1.2, mult));
  return mult;
}

async function trainAndPredictServer(pricesRaw, lookback = 8, predictSteps = 6){
  const prices = pricesRaw.map(p => p[1]);
  if(prices.length < lookback + 2) return null;

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

  await model.fit(tensorX, tensorY, { epochs: 30, batchSize: 16, verbose: 0 });

  let mape = null;
  try{
    if(xTest.length){
      const predTest = model.predict(tf.tensor2d(xTest)).arraySync().map(r => r[0]);
      const trueTest = yTest.map(r => r[0]);
      let sum = 0; let cnt = 0;
      for(let i=0;i<trueTest.length;i++){
        if(trueTest[i] !== 0){ sum += Math.abs((trueTest[i] - predTest[i]) / trueTest[i]); cnt++; }
      }
      mape = cnt ? (sum / cnt) : null;
    }
  }catch(e){ console.warn('MAPE compute failed', e); }

  let seed = norm.slice(-lookback);
  const preds = [];
  for(let s=0;s<predictSteps;s++){
    const out = model.predict(tf.tensor2d([seed])).arraySync()[0][0];
    preds.push(out * maxVal);
    seed = seed.slice(1).concat([out]);
  }

  return { preds, mape };
}

async function main(){
  try{
    if(!process.env.FIREBASE_SERVICE_ACCOUNT){
      console.error('FIREBASE_SERVICE_ACCOUNT not set');
      process.exit(1);
    }
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    // databaseURL can be included in service account JSON under project_id (not always present)
    const dbUrl = sa.databaseURL || `https://${sa.project_id || sa.projectId}-default-rtdb.firebaseio.com`;

    admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: dbUrl });
    const db = admin.database();

    const ctrlSnap = await db.ref('control/predEnabled').once('value');
    const enabled = !!ctrlSnap.val();
    if(!enabled){
      console.log('Prediction disabled via control/predEnabled');
      return;
    }

    const days = 30;
    const asset = process.env.ASSET_ID || 'bitcoin';
    const url = `https://api.coingecko.com/api/v3/coins/${asset}/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if(!res.ok){
      console.error('Failed to fetch market data', res.status);
      return;
    }
    const data = await res.json();
    if(!data || !data.prices || !data.prices.length){
      console.warn('No price data');
      return;
    }

    const lookback = 8;
    const predictSteps = Math.min(12, Math.max(3, Math.floor(data.prices.length / 6)));
    const result = await trainAndPredictServer(data.prices, lookback, predictSteps);
    if(!result){
      console.warn('Prediction returned null');
      return;
    }

    // fetch fundamentals and blend
    const fund = await fetchFundamentalsServer();
    const blend = fundamentalBlendScoreServer(fund);
    const predsBlended = result.preds.map(p=>p * blend);

    const lastTs = data.prices[data.prices.length-1][0];
    const prevTs = data.prices[data.prices.length-2][0];
    const step = lastTs - prevTs || 86400000;
    const predLabels = [];
    for(let i=1;i<=predictSteps;i++) predLabels.push(new Date(lastTs + step * i).toISOString());

    const record = {
      timestamp: (new Date()).toISOString(),
      lookback, predictSteps,
      accuracy_mape: result.mape,
      blend,
      fundamentals: fund,
      predictions_raw: result.preds,
      predictions_blended: predsBlended,
      labels: predLabels
    };

    await db.ref('predictions').push(record);
    console.log('Prediction saved', record.timestamp, 'blend', blend);
  }catch(err){
    console.error('predict.js error', err);
    process.exit(1);
  }
}

main();
