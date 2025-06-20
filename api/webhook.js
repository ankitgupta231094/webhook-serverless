import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { secret, signal, symbol } = req.body;

  if (secret !== process.env.SECRET_CODE) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  // Determine option type
  const option_type = signal === 'BUY' ? 'CE' : 'PE';

  // Fetch ATM strike price from Dhan
  const niftySpot = async () => {
    const r = await fetch('https://api.dhan.co/market/live/quotes', {
      method: 'POST',
      headers: {
        'access-token': process.env.DHAN_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        exchangeSegment: 'NSE_EQ',
        instrument: 'NIFTY 50'
      })
    });
    const js = await r.json();
    return Math.round(parseFloat(js.lastPrice) / 50) * 50;
  };

  const strike_price = await niftySpot();

  const payload = {
    secret: process.env.SECRET_CODE,
    alertType: 'multi_leg_order',
    order_legs: [
      {
        transactionType: 'B',
        orderType: 'MKT',
        quantity: '1',
        exchange: 'NFO',
        symbol: symbol,
        instrument: 'OPT',
        productType: 'I',
        sort_order: '1',
        price: '0',
        option_type,
        strike_price,
        expiry_date: process.env.EXPIRY_DATE
      }
    ],
    target: {
      points: 45,
      trail: 5
    },
    stoploss: {
      points: 15,
      trail: 5
    }
  };

  const r = await fetch('https://api.dhan.co/smartorders/v1/placeMultiLegOrder', {
    method: 'POST',
    headers: {
      'access-token': process.env.DHAN_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const resp = await r.json();

  console.log('Sent to Dhan', payload, 'Resp', resp);

  res.status(200).json({ ok: true, forwarded: true, dh: resp });
}

