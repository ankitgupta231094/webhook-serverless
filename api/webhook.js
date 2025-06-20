
// api/webhook.js – Smart proxy (final) – no external fetch import, uses native fetch
// Accepts: {"secret":"U7SQS","signal":"BUY"|"SELL","symbol":"NIFTY","quantity":1}
// Builds Dhan multi_leg_order JSON with ATM strike & weekly expiry and forwards it.

// === ENV VARS required ===
// DHAN_SECRET          = U7SQS
// DHAN_WEBHOOK_URL     = https://api.dhan.co/smartorders/v1/placeMultiLegOrder   (or your TV URL)
// DHAN_ACCESS_TOKEN    = <your dhan token>

const DHAN_SECRET      = process.env.DHAN_SECRET;
const DHAN_WEBHOOK_URL = process.env.DHAN_WEBHOOK_URL;
const DHAN_TOKEN       = process.env.DHAN_ACCESS_TOKEN;

// --- helper: nearest 50 ---
const nearest50 = p => Math.round(p / 50) * 50;

// --- helper: get next weekly expiry (Thu) ---
function weeklyExpiry() {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day    = istNow.getDay();           // 0=Sun … 6=Sat
  const diff   = (4 - day + 7) % 7;         // days to Thursday
  const thu    = new Date(istNow);
  thu.setDate(istNow.getDate() + diff);
  thu.setHours(0,0,0,0);
  // if already past Thu 15:30 IST, add 7 days
  const cutoff = new Date(thu); cutoff.setHours(15,30,0,0);
  if (istNow > cutoff) thu.setDate(thu.getDate() + 7);
  return thu.toISOString().split('T')[0];   // YYYY-MM-DD
}

// --- helper: fetch NIFTY spot from Dhan quotes API ---
async function fetchSpot(symbol="NIFTY 50") {
  const body = { exchangeSegment: 'NSE_EQ', instrument: symbol };
  const r = await fetch('https://api.dhan.co/market/live/quotes', {
    method:'POST',
    headers:{ 'access-token': DHAN_TOKEN, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const js = await r.json();
  return parseFloat(js.lastPrice);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');

  const { secret, signal, symbol='NIFTY', quantity=1 } = req.body || {};
  if (secret !== DHAN_SECRET) return res.status(401).json({ ok:false, msg:'bad secret' });
  if (!['BUY','SELL'].includes(signal)) return res.status(400).json({ ok:false, msg:'signal must be BUY or SELL'});

  try {
    // 1. get spot price and ATM strike
    const spot   = await fetchSpot();
    const strike = nearest50(spot);
    const option_type = signal === 'BUY' ? 'CE' : 'PE';

    // 2. build Dhan payload
    const payload = {
      secret: DHAN_SECRET,
      alertType: 'multi_leg_order',
      order_legs:[{
        transactionType: 'B',
        orderType: 'MKT',
        quantity: quantity.toString(),
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

    // 3. forward to Dhan
    const resp = await fetch(DHAN_WEBHOOK_URL, {
      method:'POST', headers:{ 'access-token': DHAN_TOKEN, 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    }).then(r=>r.json());

    console.log('Sent to Dhan', payload, 'Resp', resp);
    return res.status(200).json({ ok:true, forwarded:true, dh: resp });
  } catch(err) {
    console.error('Webhook error', err);
    return res.status(500).json({ ok:false, error: err.toString() });
  }
}
