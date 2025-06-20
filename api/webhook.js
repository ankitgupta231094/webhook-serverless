// api/webhook.js – Smart proxy v2 (no LOT_SIZE env)
// • Accepts minimal TradingView alert: {"secret":"U7SQS","signal":"BUY","symbol":"NIFTY","quantity":1}
// • Builds Dhan multi_leg_order JSON on the fly.

// Using native fetch available in Node.js 18+ on Vercel – no need for node‑fetch

// === ENV ===
const SECRET            = process.env.DHAN_SECRET;           // "U7SQS"
const DHAN_WEBHOOK_URL  = process.env.DHAN_WEBHOOK_URL;      // Provided by Dhan
const DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN;     // Personal access token

// === helpers ===
function nearest50 (price) { return Math.round(price / 50) * 50; }

// next weekly expiry (last Thursday). If today is Thu after 15:30 IST, roll to next week
function weeklyExpiry () {
  const ist   = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const d     = new Date(ist);
  const THU   = 4;
  d.setDate(d.getDate() + ((THU + 7 - d.getDay()) % 7));
  const cutoff = new Date(d);
  cutoff.setHours(15,30,0,0); // 15:30 IST
  if (new Date(ist) > cutoff) d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

async function niftySpot () {
  const r = await fetch('https://api.dhan.co/market/feed/ltp?securityId=NIFTY%2050', {
    headers: { 'access-token': DHAN_ACCESS_TOKEN }
  });
  const js = await r.json();
  return parseFloat(js.ltp);
}

export default async function handler(req,res){
  if (req.method!=='POST') return res.status(405).send('POST only');
  const { secret, signal, symbol='NIFTY', quantity=1 } = req.body || {};
  if (secret !== SECRET)   return res.status(401).json({ ok:false, msg:'bad secret' });
  if (!['BUY','SELL'].includes(signal))
    return res.status(400).json({ ok:false, msg:'signal must be BUY or SELL'});

  try {
    const spot   = await niftySpot();
    const strike = nearest50(spot);
    const cepe   = signal === 'BUY' ? 'CE' : 'PE';

    const payload = {
      secret,
      alertType: 'multi_leg_order',
      order_legs:[{
        transactionType: 'B',
        orderType: 'MKT',
        quantity: quantity.toString(),
        exchange: 'NFO',
        symbol: symbol.toUpperCase(),
        instrument: 'OPT',
        productType: 'I',
        sort_order: '1',
        price: '0',
        option_type: cepe,
        strike_price: strike.toString(),
        expiry_date: weeklyExpiry()
      }],
      target:   { points: 45, trail: 5 },
      stoploss: { points: 15, trail: 5 }
    };

    const dh = await fetch(DHAN_WEBHOOK_URL, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    }).then(r=>r.json());

    console.log('Sent to Dhan', payload, 'Resp', dh);
    return res.status(200).json({ ok:true, forwarded:true, dh });
  } catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, error:e.toString() });
  }
}

