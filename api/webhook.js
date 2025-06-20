// api/webhook.js  – FINAL patch (good spot fetch)
// -------------------------------------------------------------
// Receives: { secret , signal , symbol? , quantity? }
// Adds ATM strike & weekly expiry, builds Dhan multi_leg_order JSON
// Forwards to DHAN_WEBHOOK_URL (your /tv/alert/... link)
// Logs Dhan status + full body for easy debugging.

const SECRET   = process.env.DHAN_SECRET;          // U7SQS
const DHAN_URL = process.env.DHAN_WEBHOOK_URL;     // /tv/alert/... link
const TOKEN    = process.env.DHAN_ACCESS_TOKEN;    // Dhan API token

// helper: nearest multiple of 50
const nearest50 = p => Math.round(p / 50) * 50;

// helper: next Thursday expiry (weekly)
function weeklyExpiry () {
  const ist = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
  const diff = (4 - ist.getDay() + 7) % 7; // days to Thu
  const thu  = new Date(ist); thu.setDate(ist.getDate()+diff); thu.setHours(0,0,0,0);
  const cutoff = new Date(thu); cutoff.setHours(15,30,0,0);
  if (ist > cutoff) thu.setDate(thu.getDate()+7);
  return thu.toISOString().split('T')[0];
}

// helper: live NIFTY spot via /feed/ltp endpoint (works off‑market too)
async function fetchSpot () {
  const url = 'https://api.dhan.co/market/feed/ltp?securityId=' +
              encodeURIComponent('NSE_INDEX|NIFTY 50');
  const r = await fetch(url, { headers:{ 'access-token': TOKEN }});
  const js = await r.json();
  return parseFloat(js.ltp);
}

export default async function handler (req,res){
  if(req.method!=='POST') return res.status(405).send('POST only');
  const { secret, signal, symbol='NIFTY', quantity=1 } = req.body||{};
  if(secret!==SECRET) return res.status(401).json({ok:false,msg:'bad secret'});
  if(!['BUY','SELL'].includes(signal))
    return res.status(400).json({ok:false,msg:'signal must be BUY or SELL'});

  try{
    // 1. ATM strike
    const spot   = await fetchSpot();
    const strike = nearest50(spot);
    const option_type = signal==='BUY'?'CE':'PE';

    // 2. Dhan payload
    const payload={
      secret:SECRET,
      alertType:'multi_leg_order',
      order_legs:[{
        transactionType:'B', orderType:'MKT', quantity:quantity.toString(),
        exchange:'NSE', symbol:symbol.toUpperCase(), instrument:'OPT', productType:'I',
        sort_order:'1', price:'0', option_type, strike_price:strike.toString(),
        expiry_date:weeklyExpiry()
      }],
      target:{points:45,trail:5}, stoploss:{points:15,trail:5}
    };

    // 3. forward to Dhan
    const dhResp = await fetch(DHAN_URL,{method:'POST',
      headers:{'access-token':TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify(payload)});
    const status = dhResp.status; const dhText=await dhResp.text();
    console.log('Dhan status:',status); console.log('Sent payload:',JSON.stringify(payload));
    console.log('Dhan resp:',dhText);

    let dhJson={}; try{dhJson=JSON.parse(dhText);}catch{dhJson={raw:dhText};}
    return res.status(200).json({ok:true,forwarded:true,dh:dhJson});
  }catch(err){
    console.error('Webhook error',err);
    return res.status(500).json({ok:false,error:err.toString()});
  }
}
