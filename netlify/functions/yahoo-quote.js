const fetch = globalThis.fetch || require('node-fetch');

exports.handler = async function(event){
  const params = event.queryStringParameters || {};
  const symbols = params.symbols;
  if(!symbols) return { statusCode: 400, body: JSON.stringify({error: 'missing symbols'}) };

  const yahoo = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
  try{
    const res = await fetch(yahoo, { headers: { 'User-Agent': 'sahamme-netlify' } });
    const json = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET'
      },
      body: JSON.stringify(json)
    };
  }catch(err){
    return { statusCode: 502, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({error: err.message}) };
  }
}
