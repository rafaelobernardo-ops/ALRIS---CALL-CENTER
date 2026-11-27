# 📋 Resumo Executivo & Técnico de Handoff — ALRIS Call Center & Omnichannel

> **Data de Atualização:** 27 de Novembro de 2026  
> **Status do Projeto:** Em Produção (Render + GitHub) com Telefonia Twilio, Meta WhatsApp Cloud API e Pagamentos Mercado Pago integrados  
> **Workspace Principal:** `/home/rafael/.gemini/antigravity/scratch/agency-portal`  
> **Espelho Local (VS Code):** `/home/rafael/ALRIS-Call-Center`  
> **Servidor Produção (Render):** `https://alris-call-center.onrender.com`  
> **Preview Estático (Netlify):** `https://alris-call-center.netlify.app`  
> **Ambiente Local:** `http://localhost:8080/` (Portal) e `http://localhost:8081/` (Gateway Externo Voz/WhatsApp)

---

## 1. Visão Geral & Arquitetura

O **ALRIS** é uma plataforma SaaS de Call Center & Atendimento Omnichannel com CRM Kanban, Copiloto IA em tempo real, Softphone WebRTC integrado, envio/recebimento via Meta WhatsApp Cloud API e checkout de planos via Mercado Pago.

### Fluxo de Infraestrutura
- **Frontend SPA:** `index.html`, `css/styles.css`, `js/app.js`, `js/scroll-3d.js`
- **Servidor Produção (Node.js zero-dependências):** `server.js` (hospedado no **Render**, auto-deploy via branch `main` do GitHub)
- **Servidor Local + Gateway:** `backend/server.py` (porta `8080`) e `backend/voice_gateway.py` (porta `8081`)

---

## 2. Entregas Concluídas

### 🔹 2.1 Interface, Kanban & Performance (Frontend)
- **Otimização de Performance & GPU:**
  - Transição pós-login (*"Bem-vindo"*) reduzida de ~2,5s para **~0,7s**, removendo `filter: blur()` pesado em tela cheia.
  - Entrada em cascata do Kanban otimizada para `0.32s` 100% acelerada por GPU (`transform` + `opacity`).
  - Cards `.pipefy-card` otimizados (`backdrop-filter: blur(6px)`, `will-change: transform`) e botões globais com resposta tátil rápida (`140ms`, `active:scale(0.975)`).
  - Fundo 3D (`js/scroll-3d.js`) com cache de contexto 2D e throttle de ~30fps no movimento do mouse para manter cliques fluidos.
- **Kanban & Chamados:**
  - Campo de busca de clientes no cabeçalho do Kanban com fundo transparente.
  - Modal de **Novo Chamado** com campo de telefone limpo (sem número pré-preenchido).
  - Ícone do WhatsApp no card do cliente ativa o modo de mensagem direta no painel central (`sendDirectWhatsAppFromPad`).

### 🔹 2.2 Softphone WebRTC & Telefonia (Twilio)
- **Modal Softphone (`#voipDialerModal`):** Teclado DTMF com síntese de áudio via Web Audio API, botão Mute/Unmute, visualizador de ondas, cronômetro em tempo real, campo de Caller ID e seletor de canal (`Voz WebRTC` vs `Ligação WhatsApp`, travado durante chamadas ativas).
- **Cápsula de Chamada no Topo (`callToolbarIsland`):** Sincronizada com botões `Discador` e `Encerrar` (enviando encerramento remoto `Status=completed` na Twilio).
- **Gateway Externo (`backend/voice_gateway.py`):** Rotas `/voice/status`, `/voice/dial`, `/voice/hangup` e `/voice/caller-id` integradas à Twilio.

### 🔹 2.3 Meta WhatsApp Cloud API & Webhook Oficial
- **Envio de Mensagens:** `POST /whatsapp/send` no gateway local integrado à Graph API da Meta (`v25.0`).
- **Webhook em Produção no Render:**
  - `GET /api/whatsapp/webhook` — Validação do desafio `hub.challenge` da Meta com `WHATSAPP_VERIFY_TOKEN` (verificado com HTTP 200 em produção).
  - `POST /api/whatsapp/webhook` — Recebimento de eventos e mensagens recebidas.
- **Documentação Compartilhável:** Guia passo a passo 100% anonimizado em `DOCS_META_WHATSAPP_RENDER.md`.

### 🔹 2.4 Pagamentos Automáticos (Mercado Pago)
- **Rotas implementadas no `server.js` (zero dependências externas):**
  - `POST /api/payments/pix` — Gera cobrança Pix real via API do Mercado Pago (`/v1/payments`) retornando QR Code base64 e código Copia e Cola oficial.
  - `POST /api/payments/checkout` — Cria preferência **Checkout Pro** (`/checkout/preferences`) para pagamento seguro via Cartão de Crédito/Débito na página criptografada do Mercado Pago.
  - `GET /api/payments/status?id=<payment_id>` — Valida o status real do pagamento antes de liberar o plano no frontend.
  - `POST /api/payments/webhook` — Recebe notificações automáticas de aprovação do Mercado Pago.
- **Frontend (`index.html` + `js/app.js`):** Modal de checkout atualizado para exibir o QR Code real gerado pelo Mercado Pago, verificar pagamento real no botão Pix e abrir o Checkout Pro oficial na aba Cartão.

---

## 3. Estrutura de Arquivos

```text
agency-portal/
├── server.js                         # Servidor Node.js de produção (Render: Webhooks Meta + Mercado Pago + SPA)
├── package.json                      # Configuração de start ("npm start" -> "node server.js")
├── index.html                        # Interface principal (Landing, Login, Kanban, Softphone, Checkout)
├── css/
│   └── styles.css                    # Estilos globais, animações GPU e micro-interações dos botões
├── js/
│   ├── app.js                        # Lógica SPA, Kanban, Softphone, WhatsApp e Checkout Mercado Pago
│   └── scroll-3d.js                  # Canvas 3D otimizado com throttle e cache de contexto
├── backend/
│   ├── server.py                     # Servidor local Python (porta 8080)
│   └── voice_gateway.py              # Gateway local de Voz (Twilio) e WhatsApp Cloud API (porta 8081)
├── supabase/
│   └── migrations/
│       └── 20261126_create_call_logs.sql
├── DOCS_META_WHATSAPP_RENDER.md      # Guia público sanitizado (Meta + Render)
└── HANDOFF.md                        # Este documento
```

---

## 4. Variáveis de Ambiente (Render & `.env` Local)

> **Segurança:** Nunca versionar chaves reais no GitHub. Configure-as no painel **Environment** do Render e no `.env` local (ignorado pelo `.gitignore`).

```ini
# Meta WhatsApp Cloud API
WHATSAPP_VERIFY_TOKEN=alris_meta_webhook_2026
WHATSAPP_ACCESS_TOKEN=<seu_token_meta>
WHATSAPP_PHONE_NUMBER_ID=<seu_phone_number_id>
WHATSAPP_WABA_ID=<seu_waba_id>

# Mercado Pago (Pagamentos Reais Pix & Cartão)
MP_ACCESS_TOKEN=<seu_access_token_mercado_pago>
PUBLIC_BASE_URL=https://alris-call-center.onrender.com

# Telefonia / Voz (Twilio)
VOICE_ACCOUNT_SID=<seu_account_sid>
VOICE_AUTH_TOKEN=<seu_auth_token>
VOICE_CALLER_ID=<seu_numero_twilio>
TWILIO_TEMPLATE_URL=https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition
```

---

## 5. Próximos Passos Recomendados
1. **Ativar Pagamentos Reais:** Inserir `MP_ACCESS_TOKEN` nas variáveis de ambiente do **Render** e testar um Pix/Checkout Pro real.
2. **Persistência de Assinaturas:** Salvar os pagamentos aprovados do webhook (`/api/payments/webhook`) no banco de dados (Supabase) vinculados ao usuário/organização.
3. **Verificação Empresarial Meta (Opcional):** Quando houver CNPJ/MEI, concluir a verificação no Meta Business Manager para liberar número de produção e chamadas de voz no WhatsApp.
