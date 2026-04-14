// server.js
const express = require('express');
const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

app.post('/webhook', async (req, res) => {
  const body = req.body;
  
  // Adapte conforme o gateway
  const sessionId = body.sid || body.utm_content || null;
  
  // Busca os UTMs pelo session_id
  let utms = {};
  if (sessionId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/visitors?session_id=eq.${sessionId}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await r.json();
    if (data[0]) utms = data[0];
  }

  // Salva a venda com os UTMs cruzados
  await fetch(`${SUPABASE_URL}/rest/v1/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({
      session_id: sessionId,
      gateway: body.gateway || 'unknown',
      order_id: body.order_id || body.id,
      product_name: body.product_name || body.product?.name,
      amount: body.amount || body.total,
      status: body.status,
      customer_email: body.customer?.email || body.email,
      utm_source: utms.utm_source,
      utm_medium: utms.utm_medium,
      utm_campaign: utms.utm_campaign,
      utm_content: utms.utm_content,
      utm_term: utms.utm_term
    })
  });

  res.json({ ok: true });
});

app.listen(3000, () => console.log('Rodando na porta 3000'));
