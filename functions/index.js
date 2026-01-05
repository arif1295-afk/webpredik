const functions = require('firebase-functions');
const admin = require('firebase-admin');
const tf = require('@tensorflow/tfjs');
const fetch = require('node-fetch');

admin.initializeApp();

// simple helper to convert prices to arrays and train/predict
async function trainAndPredictServer(pricesRaw, lookback = 8, predictSteps = 6){
  // pricesRaw: [[ts, price], ...]
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

  // train quickly
  await model.fit(tensorX, tensorY, { epochs: 30, batchSize: 16, verbose: 0 });

  // evaluate MAPE on test
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

  // recursive predict
  let seed = norm.slice(-lookback);
  const preds = [];
  for(let s=0;s<predictSteps;s++){
    const out = model.predict(tf.tensor2d([seed])).arraySync()[0][0];
    preds.push(out * maxVal);
    seed = seed.slice(1).concat([out]);
  }

  return { preds, mape };
}

// Run on schedule (every 5 minutes). Note: scheduled functions require billing (Blaze).
exports.scheduledPredict = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {
  const db = admin.database();

  // check control flag
  const snap = await db.ref('control/predEnabled').once('value');
  const enabled = !!snap.val();
  if(!enabled){
    console.log('Prediction disabled (control flag false)');
    return null;
  }

  try{
    const days = 30; // you may adjust
    const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if(!res.ok){
      console.error('CoinGecko fetch failed', res.status);
      return null;
    }
    const data = await res.json();
    if(!data || !data.prices || !data.prices.length){
      console.warn('No price data from CoinGecko');
      return null;
    }

    const lookback = 8;
    const predictSteps = Math.min(12, Math.max(3, Math.floor(data.prices.length / 6)));

    const result = await trainAndPredictServer(data.prices, lookback, predictSteps);
    if(!result){
      console.warn('Prediction returned null');
      return null;
    }

    const lastTs = data.prices[data.prices.length-1][0];
    const prevTs = data.prices[data.prices.length-2][0];
    const step = lastTs - prevTs || 86400000;
    const predLabels = [];
    for(let i=1;i<=predictSteps;i++) predLabels.push(new Date(lastTs + step * i).toISOString());

    const record = {
      timestamp: (new Date()).toISOString(),
      lookback, predictSteps,
      accuracy_mape: result.mape,
      predictions: result.preds,
      labels: predLabels
    };

    await db.ref('predictions').push(record);
    console.log('Prediction saved', record.timestamp);
  }catch(err){
    console.error('scheduledPredict error', err);
  }

  return null;
});
