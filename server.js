const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const TIKTOK_PIXEL_ID = 'D776I53C77U88469GFRG';

// ─────────────────────────────────────────
// PING — mantém o servidor acordado
// ─────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ alive: true, time: new Date().toISOString() });
});

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
// HELPER — dispara evento Purchase no TikTok
// ─────────────────────────────────────────
async function sendTikTokPurchase(sale) {
  if (!TIKTOK_ACCESS_TOKEN) {
    console.warn('[TikTok] TIKTOK_ACCESS_TOKEN não configurado — pulando envio');
    return;
  }

  const hashedEmail = sale.customer_email
    ? crypto.createHash('sha256').update(sale.customer_email.trim().toLowerCase()).digest('hex')
    : undefined;

  const payload = {
    pixel_code: TIKTOK_PIXEL_ID,
    event: 'Purchase',
    event_id: sale.order_id,
    timestamp: new Date().toISOString(),
    context: {
      user: {
        ...(hashedEmail && { email: hashedEmail })
      }
    },
    properties: {
      order_id: sale.order_id,
      value: sale.amount,
      currency: 'BRL',
      contents: [
        {
          content_name: sale.product_name || 'Produto',
          quantity: 1,
          price: sale.amount
        }
      ]
    }
  };

  try {
    const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/pixel/track/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': TIKTOK_ACCESS_TOKEN
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.code === 0) {
      console.log('[TikTok] ✅ Evento Purchase enviado — order_id:', sale.order_id);
    } else {
      console.error('[TikTok] ❌ Erro na API:', JSON.stringify(data));
    }
  } catch (err) {
    console.error('[TikTok] ❌ Erro ao chamar a API:', err.message);
  }
}

// ─────────────────────────────────────────
// WEBHOOK — IronPay
// ─────────────────────────────────────────
app.post('/webhook/ironpay', async (req, res) => {
  try {
    const body = req.body;
    console.log('[IronPay] Webhook recebido:', JSON.stringify(body, null, 2));

    const tracking    = body.tracking    || {};
    const transaction = body.transaction || {};
    const customer    = body.customer    || {};
    const offer       = body.offer       || {};

    // A IronPay envia os UTMs direto no objeto tracking
    // tracking.src é o sid que você passou na URL do checkout
    const sale = {
      session_id:     tracking.src          || null,
      gateway:        'ironpay',
      order_id:       transaction.id        || null,
      product_name:   offer.title           || null,
      amount:         transaction.amount ? transaction.amount / 100 : null,
      status:         transaction.status    || null,
      customer_email: customer.email        || null,
      utm_source:     tracking.utm_source   || null,
      utm_medium:     tracking.utm_medium   || null,
      utm_campaign:   tracking.utm_campaign || null,
      utm_content:    tracking.utm_content  || null,
      utm_term:       tracking.utm_term     || null
    };

    const saved = await saveSale(sale);

    if (saved) {
      console.log('[IronPay] ✅ Venda salva — order_id:', sale.order_id);
    } else {
      console.error('[IronPay] ❌ Erro ao salvar venda no Supabase');
    }

    // Dispara Purchase no TikTok apenas se pagamento aprovado
    const STATUS_APROVADOS = ['paid', 'approved', 'complete', 'completed', 'success', 'active'];
    const statusAprovado = STATUS_APROVADOS.includes((sale.status || '').toLowerCase());

    if (saved && statusAprovado) {
      await sendTikTokPurchase(sale);
    } else if (!statusAprovado) {
      console.log('[TikTok] Status não aprovado (' + sale.status + ') — evento não enviado');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[IronPay] ❌ Erro no webhook:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// ROTA DE TESTE
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'Tracker online ✅',
    endpoints: {
      ping:    'GET /ping',
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
