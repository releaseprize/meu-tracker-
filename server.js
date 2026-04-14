const express = require('express');
const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ─────────────────────────────────────────
// PING — mantém o servidor acordado
// ─────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ alive: true, time: new Date().toISOString() });
});

// ─────────────────────────────────────────
// HELPER — salva visitante no Supabase
// ─────────────────────────────────────────
async function upsertVisitor(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/visitors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

// ─────────────────────────────────────────
// HELPER — busca UTMs pelo session_id
// ─────────────────────────────────────────
async function getUtmsBySessionId(sessionId) {
  if (!sessionId) return {};
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/visitors?session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  const data = await res.json();
  return data && data[0] ? data[0] : {};
}

// ─────────────────────────────────────────
// HELPER — salva venda no Supabase
// ─────────────────────────────────────────
async function saveSale(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

// ─────────────────────────────────────────
// WEBHOOK — IronPay
// ─────────────────────────────────────────
app.post('/webhook/ironpay', async (req, res) => {
  try {
    const body = req.body;
    console.log('[IronPay] Webhook recebido:', JSON.stringify(body, null, 2));

    // IronPay envia o session_id que você passou na URL do checkout como tracker ou campo extra
    // Ex: checkout URL = https://checkout.ironpay.com.br/SEU_PRODUTO?sid=SESSION_ID
    const sessionId =
      body.sid ||
      body.tracker ||
      body.metadata?.sid ||
      body.custom?.sid ||
      null;

    // Busca UTMs pelo session_id
    const utms = await getUtmsBySessionId(sessionId);

    // Monta payload da venda
    const sale = {
      session_id: sessionId,
      gateway: 'ironpay',
      order_id: body.id || body.order_id || body.transaction_id || null,
      product_name: body.product?.name || body.plan?.name || body.description || null,
      amount: body.amount
        ? body.amount / 100  // IronPay envia em centavos
        : body.total || null,
      status: body.status || body.event || null,
      customer_email: body.customer?.email || body.email || null,
      utm_source: utms.utm_source || null,
      utm_medium: utms.utm_medium || null,
      utm_campaign: utms.utm_campaign || null,
      utm_content: utms.utm_content || null,
      utm_term: utms.utm_term || null
    };

    const saved = await saveSale(sale);

    if (saved) {
      console.log('[IronPay] Venda salva com sucesso:', sale.order_id);
    } else {
      console.error('[IronPay] Erro ao salvar venda');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[IronPay] Erro no webhook:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// ROTA DE TESTE — verifica se está online
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'Tracker online ✅',
    endpoints: {
      ping: 'GET /ping',
      ironpay: 'POST /webhook/ironpay'
    }
  });
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tracker rodando na porta ${PORT}`);
});
