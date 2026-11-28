/**
 * ALRIS — Servidor Produção Node.js (Render / Cloud)
 * Zero dependências externas: serve o portal ALRIS + Validação GET/POST Webhook Meta WhatsApp + Rotas Voz WebRTC.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ROOT_DIR = __dirname;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'alris_meta_webhook_2026';
const WA_ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const WA_PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MP_ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://alris-call-center.onrender.com').replace(/\/$/, '');
const approvedPayments = new Map();
// Tabela de roteamento Multi-Atendente (1 número oficial -> N funcionários identificados por agent_id)
const leadRoutingTable = new Map();

async function mpRequest(method, endpoint, bodyObj, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const resp = await fetch(`https://api.mercadopago.com${endpoint}`, {
    method,
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // ------------------------------------------------------------------
  // 1. GET Validação do Webhook da Meta (WhatsApp Business Cloud API)
  // ------------------------------------------------------------------
  if (req.method === 'GET' && ['/api/whatsapp/webhook', '/webhook/whatsapp', '/webhook'].includes(pathname)) {
    const mode = parsed.searchParams.get('hub.mode');
    const token = parsed.searchParams.get('hub.verify_token');
    const challenge = parsed.searchParams.get('hub.challenge') || '';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[ALRIS META WEBHOOK] Verificação GET aprovada!');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(challenge);
    }
    return sendJson(res, 403, { error: 'Verify token inválido.' });
  }

  // ------------------------------------------------------------------
  // 2. POST Recebimento de Eventos do Webhook da Meta
  // ------------------------------------------------------------------
  if (req.method === 'POST' && ['/api/whatsapp/webhook', '/webhook/whatsapp', '/webhook'].includes(pathname)) {
    const body = await readBody(req);
    console.log('[ALRIS META WEBHOOK] Evento recebido:', JSON.stringify(body).slice(0, 300));
    return sendJson(res, 200, { status: 'EVENT_RECEIVED' });
  }

  // ------------------------------------------------------------------
  // 2.5. POST Envio Oficial via Meta WhatsApp Business Cloud API (v25.0)
  //      com Roteamento por ID de Atendente ("*Fulano:* mensagem")
  // ------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/whatsapp/send') {
    const body = await readBody(req);
    const to = String(body.to || body.phone || '').replace(/\D/g, '');
    const rawMessage = String(body.message || body.text || '').trim();
    const agentId = String(body.agent_id || 'admin_default').trim();
    const agentName = String(body.agent_name || '').trim();
    const organizationId = String(body.organization_id || 'org_default').trim();

    if (!to || !rawMessage) {
      return sendJson(res, 400, { ok: false, error: 'Número de destino e mensagem são obrigatórios.' });
    }

    // Associa o número do cliente ao funcionário responsável (roteamento 1 número -> N atendentes)
    leadRoutingTable.set(to, {
      agent_id: agentId,
      agent_name: agentName || 'Atendimento ALRIS',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });

    const formattedMessage = agentName ? `*${agentName}:*\n${rawMessage}` : rawMessage;

    if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) {
      return sendJson(res, 200, {
        ok: false,
        configured: false,
        provider: 'meta_cloud_api_official',
        routed_to: leadRoutingTable.get(to),
        error: 'Configure WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID no Render para envio oficial em nuvem.',
      });
    }

    try {
      const resp = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(WA_PHONE_NUMBER_ID)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: formattedMessage },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return sendJson(res, resp.status, {
          ok: false,
          configured: true,
          provider: 'meta_cloud_api_official',
          error: data?.error?.message || 'Erro na Meta Cloud API.',
        });
      }
      return sendJson(res, 200, {
        ok: true,
        configured: true,
        provider: 'meta_cloud_api_official',
        routed_to: leadRoutingTable.get(to),
        message_id: data?.messages?.[0]?.id || '',
      });
    } catch (err) {
      return sendJson(res, 502, { ok: false, provider: 'meta_cloud_api_official', error: 'Falha de conexão com a Meta Cloud API.' });
    }
  }

  // ------------------------------------------------------------------
  // 2.6. POST Sugestões Dinâmicas em Tempo Real (Gemini Flash + Memória Mental)
  // ------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/ai/suggest') {
    const body = await readBody(req);
    const speech = String(body.speech || '').trim();
    const clientName = String(body.clientName || 'Cliente').trim();
    const clientContext = String(body.clientContext || '').trim();
    const tone = String(body.tone || 'Consultivo').trim();
    const count = Math.max(3, Math.min(6, parseInt(body.count || '5', 10) || 5));
    const memoryPatterns = Array.isArray(body.memoryPatterns) ? body.memoryPatterns.slice(0, 6) : [];

    if (!GEMINI_API_KEY) {
      return sendJson(res, 200, { configured: false, suggestions: [] });
    }

    const memoryHint = memoryPatterns.length
      ? `Padrões de resposta que mais funcionam para este operador (use o estilo deles como referência): ${memoryPatterns.map((m, i) => `${i + 1}) "${m.text}" (${m.uses || 1}x)`).join(' | ')}`
      : '';

    const prompt = [
      `Você é um Copiloto de Vendas em tempo real (baixa latência) em português do Brasil.`,
      `Tom desejado: ${tone}. Lead: ${clientName}. Contexto: ${clientContext || 'Atendimento comercial'}.`,
      memoryHint,
      `Última fala do cliente: "${speech || 'Cliente entrou na ligação aguardando proposta.'}"`,
      `Retorne APENAS um JSON válido com o formato exato: {"status_curto":"...","tom_cliente":"...","probabilidade":75,"suggestions":[{"label":"Título curto (max 3 palavras)","text":"Fala pronta persuasiva e natural para o operador ler agora"}]}`,
      `Gere exatamente ${count} itens em "suggestions" com abordagens diferentes (ex: ROI/Valor, Parcelamento, Prova Social, Urgência, Fechamento Direto). Sem markdown.`,
    ].join('\n');

    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
          },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsedAi = JSON.parse(rawText);
      return sendJson(res, 200, {
        configured: true,
        model: 'gemini-2.5-flash',
        status_curto: parsedAi.status_curto || 'ANÁLISE AO VIVO',
        tom_cliente: parsedAi.tom_cliente || 'Engajado',
        probabilidade: Number(parsedAi.probabilidade) || 72,
        suggestions: Array.isArray(parsedAi.suggestions) ? parsedAi.suggestions.slice(0, count) : [],
      });
    } catch (err) {
      return sendJson(res, 200, { configured: true, fallback: true, suggestions: [] });
    }
  }

  // ------------------------------------------------------------------
  // 3. Health & Status da API
  // ------------------------------------------------------------------
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/api/status' || pathname === '/health')) {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'ALRIS Call Center & Meta Webhook Server',
      webhook_ready: true,
      whatsapp_official_configured: Boolean(WA_ACCESS_TOKEN && WA_PHONE_NUMBER_ID),
      gemini_configured: Boolean(GEMINI_API_KEY),
      mercadopago_configured: Boolean(MP_ACCESS_TOKEN),
      webrtc_mode: process.env.VOICE_ACCOUNT_SID ? 'live_provider' : 'sandbox_mock',
    });
  }

  // ------------------------------------------------------------------
  // 3.5. Pagamentos Reais — Mercado Pago (Pix + Checkout Pro + Webhook)
  // ------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/payments/pix') {
    if (!MP_ACCESS_TOKEN) {
      return sendJson(res, 200, {
        configured: false,
        error: 'MP_ACCESS_TOKEN não configurado nas variáveis de ambiente do Render.',
      });
    }
    const body = await readBody(req);
    const amount = Number(String(body.amount || '299').replace(/\./g, '').replace(',', '.'));
    const planName = String(body.planName || 'Plano ALRIS').slice(0, 120);
    const payerEmail = String(body.payerEmail || 'cliente@alris.com.br').trim();
    const payerName = String(body.payerName || 'Cliente ALRIS').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, { configured: true, error: 'Valor do plano inválido.' });
    }

    try {
      const idempKey = crypto.randomUUID();
      const mp = await mpRequest('POST', '/v1/payments', {
        transaction_amount: Number(amount.toFixed(2)),
        description: `Assinatura ${planName} — ALRIS`,
        payment_method_id: 'pix',
        notification_url: `${PUBLIC_BASE_URL}/api/payments/webhook`,
        payer: {
          email: payerEmail,
          first_name: payerName.split(' ')[0] || 'Cliente',
        },
      }, idempKey);

      if (!mp.ok) {
        console.error('[ALRIS MP PIX] Erro:', mp.status, JSON.stringify(mp.data).slice(0, 300));
        return sendJson(res, mp.status || 502, {
          configured: true,
          error: mp.data?.message || 'Erro ao gerar cobrança Pix no Mercado Pago.',
        });
      }

      const txData = mp.data?.point_of_interaction?.transaction_data || {};
      return sendJson(res, 200, {
        configured: true,
        payment_id: String(mp.data.id),
        status: mp.data.status || 'pending',
        qr_code: txData.qr_code || '',
        qr_code_base64: txData.qr_code_base64 || '',
        ticket_url: txData.ticket_url || '',
      });
    } catch (err) {
      console.error('[ALRIS MP PIX] Falha de rede:', err.message);
      return sendJson(res, 502, { configured: true, error: 'Falha ao conectar com o Mercado Pago.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/payments/checkout') {
    if (!MP_ACCESS_TOKEN) {
      return sendJson(res, 200, {
        configured: false,
        error: 'MP_ACCESS_TOKEN não configurado nas variáveis de ambiente do Render.',
      });
    }
    const body = await readBody(req);
    const amount = Number(String(body.amount || '299').replace(/\./g, '').replace(',', '.'));
    const planName = String(body.planName || 'Plano ALRIS').slice(0, 120);

    try {
      const mp = await mpRequest('POST', '/checkout/preferences', {
        items: [{
          title: `Assinatura ${planName} — ALRIS`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number(amount.toFixed(2)),
        }],
        back_urls: {
          success: `${PUBLIC_BASE_URL}/?payment=approved`,
          pending: `${PUBLIC_BASE_URL}/?payment=pending`,
          failure: `${PUBLIC_BASE_URL}/?payment=failure`,
        },
        auto_return: 'approved',
        notification_url: `${PUBLIC_BASE_URL}/api/payments/webhook`,
      });

      if (!mp.ok) {
        return sendJson(res, mp.status || 502, {
          configured: true,
          error: mp.data?.message || 'Erro ao criar Checkout Pro no Mercado Pago.',
        });
      }

      return sendJson(res, 200, {
        configured: true,
        preference_id: mp.data.id,
        init_point: mp.data.init_point || mp.data.sandbox_init_point || '',
      });
    } catch (err) {
      return sendJson(res, 502, { configured: true, error: 'Falha ao conectar com o Mercado Pago.' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/payments/status') {
    const paymentId = parsed.searchParams.get('id') || '';
    if (!paymentId) return sendJson(res, 400, { error: 'Parâmetro id obrigatório.' });
    if (approvedPayments.has(paymentId)) {
      return sendJson(res, 200, { payment_id: paymentId, status: 'approved', source: 'webhook_cache' });
    }
    if (!MP_ACCESS_TOKEN) {
      return sendJson(res, 200, { configured: false, payment_id: paymentId, status: 'unconfigured' });
    }
    try {
      const mp = await mpRequest('GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
      if (!mp.ok) return sendJson(res, mp.status || 502, { error: 'Não foi possível consultar pagamento.' });
      if (mp.data.status === 'approved') {
        approvedPayments.set(paymentId, { approved_at: new Date().toISOString(), amount: mp.data.transaction_amount });
      }
      return sendJson(res, 200, {
        configured: true,
        payment_id: paymentId,
        status: mp.data.status || 'pending',
        status_detail: mp.data.status_detail || '',
      });
    } catch {
      return sendJson(res, 502, { error: 'Falha ao consultar status no Mercado Pago.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/payments/webhook') {
    const body = await readBody(req);
    const paymentId = String(body?.data?.id || parsed.searchParams.get('data.id') || parsed.searchParams.get('id') || '');
    console.log('[ALRIS MP WEBHOOK] Notificação recebida:', JSON.stringify(body).slice(0, 300));
    if (paymentId && MP_ACCESS_TOKEN) {
      mpRequest('GET', `/v1/payments/${encodeURIComponent(paymentId)}`)
        .then((mp) => {
          if (mp.ok && mp.data?.status === 'approved') {
            approvedPayments.set(paymentId, {
              approved_at: new Date().toISOString(),
              amount: mp.data.transaction_amount,
              description: mp.data.description,
            });
            console.log(`[ALRIS MP WEBHOOK] Pagamento ${paymentId} APROVADO!`);
          }
        })
        .catch(() => {});
    }
    return sendJson(res, 200, { received: true });
  }

  // ------------------------------------------------------------------
  // 4. Rotas WebRTC Token / Outbound / Webhook
  // ------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/voice/token') {
    const token = crypto.randomBytes(24).toString('hex');
    return sendJson(res, 200, {
      success: true,
      token,
      mode: process.env.VOICE_ACCOUNT_SID ? 'live_provider' : 'sandbox_mock',
      caller_id: process.env.VOICE_CALLER_ID || '+17372508034',
    });
  }

  if (req.method === 'POST' && pathname === '/api/voice/outbound') {
    const data = await readBody(req);
    return sendJson(res, 200, {
      success: true,
      mode: process.env.VOICE_ACCOUNT_SID ? 'live_provider' : 'sandbox_mock',
      call: {
        external_call_sid: `CA${crypto.randomBytes(12).toString('hex')}`,
        phone_number: data.phone_number || '',
        status: 'ringing',
      },
    });
  }

  if (req.method === 'POST' && pathname === '/api/voice/webhook') {
    return sendJson(res, 200, { success: true });
  }

  // ------------------------------------------------------------------
  // 5. Arquivos Estáticos do Portal ALRIS (bloqueando .env e backend/)
  // ------------------------------------------------------------------
  if (req.method === 'GET') {
    const safeRel = pathname === '/' ? '/index.html' : pathname;
    if (safeRel.includes('..') || safeRel.startsWith('/.env') || safeRel.startsWith('/backend')) {
      return sendJson(res, 403, { error: 'Acesso negado.' });
    }
    const filePath = path.join(ROOT_DIR, safeRel);
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        const fallback = path.join(ROOT_DIR, 'index.html');
        fs.readFile(fallback, (fErr, content) => {
          if (fErr) return sendJson(res, 404, { error: 'Não encontrado.' });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  sendJson(res, 404, { error: 'Endpoint não encontrado.' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ALRIS Node Production Server rodando na porta ${PORT}`);
});
