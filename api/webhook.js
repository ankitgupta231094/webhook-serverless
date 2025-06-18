// File: api/webhook.js

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const data = req.body;

    console.log("🔔 Webhook Received:", data);

    // Do something with the data (like trigger a trade)
    return res.status(200).json({ message: 'Webhook received successfully!' });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

