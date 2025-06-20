// api/webhook.js   – FINAL version
// • Receives tiny TradingView JSON  { secret , signal , symbol? , quantity? }
// • Adds ATM strike + weekly expiry
// • Builds full Dhan multi_leg_order JSON
// • Sends it to the DHAN_WEBHOOK_URL you set in Vercel env‑vars
// • Logs the full Dhan response for easy debugging

// ---------- REQUIRED ENV‑VARS -------------
// DHAN_SECRET        = U7SQS                         (must match TradingView alert)
// DHAN_WEBHOOK_URL   = https://tv-webhook.dhan.co/tv/alert/… (copy from Dhan portal)
// DHAN_ACCESS_TOKEN  = <your Dhan API token>
//
// (nothing else is needed)

const SECRET   = process.env.DHAN_SECRET;
const DHAN_URL = process.env.DHAN_WEBHOOK_URL;   // TradingView webhook link from Dhan
const TOKEN    = process.env.DHAN_ACCESS_TOKEN;

// ---------- helper: nearest 50 ------------
const nearest50 = p => Math.round(p / 50) * 50;

// ---------- helper: next weekly expiry (Thu) ----------
function weeklyExpiry () {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day    = istNow.getDay();               // 0=Sun … 6=Sat
  const diff   = (4 - day + 7) % 7;             // days to Thursday
  const thu    = new Date(istNow);
  thu.setDate(istNow.getDate() + diff);
  thu.setHours(0,0,0,0);
  // if already past Thu 15:30 IST, roll to next week
  const cut = new Date(thu); cut.setHours(15,30,0,0);
  if (istNow > cut) thu.setDate(thu.getDate() + 7);
  return thu.toISOString().split('T')[0];       // YYYY-MM-DD
}

// ---------- helper: live NIFTY spot ----------
async function fetchSpot () {
  const body = { exchangeSegment: 'NSE_EQ', instrument: 'NIFTY 50' };
  const res  = await fetch('https://api.dhan.co/market/live/quotes', {
    method: 'POST',
    headers: { 'access-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const js = await res.json();
  return parseFloat(js.lastPrice);
}

// ---------- MAIN handler ----------
export default async function handler (req, res) {

  // allow only POST
  if (req.method !== 'POST') return res.status(405).send('POST only');

  // parse incoming JSON
  const { secret, signal, symbol = 'NIFTY', quantity = 1 } = req.body || {};

  // secret check
  if (secret !== SECRET) return res.status(401).json({ ok:false, msg:'bad secret' });
  if (!['BUY','SELL'].includes(signal))
    return res.status(400).json({ ok:false, msg:'signal must be BUY or SELL' });

  try {
    // 1) live spot & ATM strike
    const spot   = await fetchSpot();
    const strike = nearest50(spot);
    const option_type = signal === 'BUY' ? 'CE' : 'PE';

    // 2) build Dhan payload
    const payload = {
      secret: SECRET,
      alertType: 'multi_leg_order',
      order_legs: [{
        transactionType: 'B',
        orderType: 'MKT',
        quantity: quantity.toString(),   // lots, not units
        exchange: 'NSE',                 // NSE index options segment
        symbol: symbol.toUpperCase(),
        instrument: 'OPT',
        productType: 'I',
        sort_order: '1',
        price: '0',
        option_type,
        strike_price: strike.toString(),
        expiry_date: weeklyExpiry()
      }],
      target:   { points: 45, trail: 5 },
      stoploss: { points: 15, trail: 5 }
    };

    // 3) send to Dhan
    const dhResp = await fetch(DHAN_URL, {
      method: 'POST',
      headers: { 'access-token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const dhText = await dhResp.text();         // full body (success or error)
    console.log('Sent to Dhan', payload, 'Resp', dhText);

    // try to return parsed JSON, else raw text
    let dhJson = {};
    try { dhJson = JSON.parse(dhText); } catch { dhJson = { raw: dhText }; }

    return res.status(200).json({ ok:true, forwarded:true, dh: dhJson });

  } catch (err) {
    console.error('Webhook error', err);
    return res.status(500).json({ ok:false, error: err.toString() });
  }
}
