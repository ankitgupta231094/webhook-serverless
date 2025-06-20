// api/webhook.js  – DEBUG version
// -------------------------------------------------------------
// 1. Validates secret
// 2. Fetches NIFTY spot → rounds to ATM strike
// 3. Builds Dhan multi_leg_order JSON
// 4. Sends it to DHAN_WEBHOOK_URL  (your /tv/alert/... link)
// 5. Logs Dhan status‑code + full response text for troubleshooting
//
// Required ENV‑VAR keys on Vercel:
// DHAN_SECRET        = U7SQS
// DHAN_WEBHOOK_URL   = https://tv-webhook.dhan.co/tv/alert/....   (copy from portal)
// DHAN_ACCESS_TOKEN  = <your Dhan API token>

const SECRET   = process.env.DHAN_SECRET;
const DHAN_URL = process.env.DHAN_WEBHOOK_URL;
const TOKEN    = process.env.DHAN_ACCESS_TOKEN;

// --- helper: nearest 50
const nearest50 = p => Math.round(p / 50) * 50;

// --- helper: next Thursday expiry (weekly)
function weeklyExpiry () {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day    = istNow.getDay();        // 0‑Sun … 6‑Sat
  const diff   = (4 - day + 7) % 7;      // days to Thursday (4)
  const thu    = new Date(istNow);
  thu.setDate(istNow.getDate() + diff);
  thu.setHours(0,0,0,0);
  // roll to next week if Thurs after 15:30 IST
  const cut = new Date(thu); cut.setHours(15,30,0,0);
  if (istNow > cut) thu.setDate(thu.getDate() + 7);
  return thu.toISOString().split('T')[0];       // YYYY‑MM‑DD
}

// --- helper: live spot from Dhan quotes
async function fetchSpot () {
  const body = { exchangeSegment: 'NSE_EQ', instrument: 'NIFTY 50' };
  const r = await fetch('https://api.dhan.co/market/live/quotes', {
    method:'POST',
    headers:{ 'access-token': TOKEN, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const js = await r.json();
  return parseFloat(js.lastPrice);
}

// -------- MAIN handler ----------
export default async function handler (req, res) {

  if (req.method !== 'POST') return res.status(405).send('POST only');

  const { secret, signal, symbol='NIFTY', quantity=1 } = req.body || {};

  if (secret !== SECRET)
    return res.status(401).json({ ok:false, msg:'bad secret' });

  if (!['BUY','SELL'].includes(signal))
    return res.status(400).json({ ok:false, msg:'signal must be BUY or SELL' });

  try {
    // 1. Get ATM strike
    const spot   = await fetchSpot();
    const strike = nearest50(spot);
    const option_type = signal === 'BUY' ? 'CE' : 'PE';

    // 2. Build order
    const payload = {
      secret: SECRET,
      alertType: 'multi_leg_order',
      order_legs: [{
        transactionType: 'B',
        orderType: 'MKT',
        quantity: quantity.toString(),   // lots
        exchange: 'NSE',
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

    // 3. Send to Dhan
    const dhResp = await fetch(DHAN_URL, {
      method:'POST',
      headers:{ 'access-token': TOKEN, 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    const statusCode = dhResp.status;
    const dhText     = await dhResp.text();

    // Log EVERYTHING for debugging
    console.log('---- Dhan status:', statusCode);
    console.log('---- Sent payload:', JSON.stringify(payload));
    console.log('---- Dhan resp  :', dhText);

    // Try to parse JSON response
    let dhJson = {};
    try { dhJson = JSON.parse(dhText); } catch { dhJson = { raw: dhText }; }

    return res.status(200).json({ ok:true, forwarded:true, dh: dhJson });

  } catch (err) {
    console.error('Webhook Error', err);
    return res.status(500).json({ ok:false, error: err.toString() });
  }
}
