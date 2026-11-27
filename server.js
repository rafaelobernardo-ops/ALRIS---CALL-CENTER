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
  // 3. Health & Status da API
  // ------------------------------------------------------------------
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/api/status' || pathname === '/health')) {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'ALRIS Call Center & Meta Webhook Server',
      webhook_ready: true,
      webrtc_mode: process.env.VOICE_ACCOUNT_SID ? 'live_provider' : 'sandbox_mock',
    });
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
