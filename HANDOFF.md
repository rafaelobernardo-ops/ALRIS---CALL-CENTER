# 📋 Resumo Executivo & Técnico de Handoff — ALRIS Call Center & Omnichannel

> **Data de Atualização:** 26 de Novembro de 2026  
> **Status do Projeto:** Em desenvolvimento / Transição para Discador WebRTC Integrado  
> **Workspace Ativo:** `/home/rafael/.gemini/antigravity/scratch/agency-portal`  
> **Espelho do Repositório:** `/home/rafael/ALRIS-Call-Center`  
> **Porta de Execução Local:** `http://localhost:8080/`

---

## 1. Visão Geral & Escopo

O **ALRIS** é uma plataforma SaaS de Call Center & Atendimento Omnichannel projetada para alta performance operacional, com visual refinado dark/tech executivo, suporte a CRM Kanban, IA de argumentação em tempo real (Google Gemini) e agora a incorporação de **Telefonia WebRTC Click-to-Call** no navegador.

### Principais Objetivos da Fase Atual
1. **Discador WebRTC (Click-to-Call):** Permitir que os operadores realizem e recebam chamadas de voz diretamente pelo navegador, sem necessidade de telefone celular, aparelhos SIP físicos ou abertura de programas externos.
2. **Softphone com Teclado DTMF:** Interface virtual na tela com teclado numérico (0–9, `*`, `#`) para navegação em URAs de atendimento, medidor de ondas sonoras, mute/unmute e cronômetro em tempo real.
3. **Persistência & Multi-Tenant no Supabase:** Armazenamento seguro de logs de chamadas, durações, gravações e status operacionais via Row Level Security (RLS).
4. **Resolução de Regressões de UI:** Unificação de cabeçalho em branco pérola translúcido, eliminação de sobreposição de elementos na tela inicial e animação cinematográfica de transição pós-login.

---

## 2. Entregas Realizadas

### 🔹 2.1 Backend & Telefonia (`backend/server.py`)
- **Geração Segura de Token:** `POST /api/voice/token`
  - Cria tokens efêmeros assinados com HMAC-SHA256 para autenticação segura do operador WebRTC.
  - Não expõe `API_SECRET` ou `AUTH_TOKEN` no frontend.
- **Disparo de Chamadas:** `POST /api/voice/outbound`
  - Valida o payload e o número de destino em padrão E.164 (`^\+[1-9]\d{7,14}$`).
  - Suporte a múltiplos canais: `webrtc_voice` (PSTN/VoIP) e `whatsapp_call`.
  - Modo híbrido com fallback automático para `sandbox_mock` caso credenciais de produção estejam ausentes.
- **Webhook de Eventos:** `POST /api/voice/webhook`
  - Recepção de status em tempo real (`ringing`, `connected`, `completed`, `failed`), cálculo de duração e URLs de gravação.
- **Histórico & Logs:** `GET /api/voice/logs`
  - Persistência imediata em `backend/call_logs.json` e sincronização assíncrona com Supabase.

### 🔹 2.2 Banco de Dados Supabase (`supabase/migrations/20261126_create_call_logs.sql`)
- Criação da tabela `call_logs` com schema completo:
  - `id` (UUID, Chave Primária)
  - `organization_id` (UUID, isolamento multi-empresa)
  - `agent_id` (UUID, identificação do operador)
  - `contact_name` (Texto)
  - `phone_number` (Texto, formato E.164)
  - `channel` (`'webrtc_voice'` ou `'whatsapp_call'`)
  - `direction` (`'outbound'` ou `'inbound'`)
  - `status` (`'initiated'`, `'ringing'`, `'connected'`, `'completed'`, `'failed'`)
  - `duration_seconds` (Inteiro, padrão 0)
  - `external_call_sid` (Texto, ID da operadora Twilio/Telnyx)
  - `recording_url` (Texto, opcional)
  - `created_at` e `ended_at` (Timestamps com timezone)
- **Segurança:** Políticas de RLS (Row Level Security) ativas por organização e agente.

### 🔹 2.3 Refinamento de Interface & Experiência do Usuário (Frontend)
- **Correção da Hierarquia HTML (`index.html`):** Estrutura revalidada com `assert depth == 0`, corrigindo falha de layout onde o Kanban vazava na tela de login/home.
- **Header Pérola Translúcido (`css/styles.css`):** Cabeçalho unificado com efeito de vidro suave (`backdrop-blur-2xl`, borda clara sutil), garantindo consistência visual entre as visões de Kanban e Atendimento.
- **Barra de Chamada Retrátil (`callToolbarIsland`):** Pílula flutuante que expande com cronômetro, áudio e controles essenciais.
- **Animação Cinematográfica de Login:** Transição de ~2 segundos com subida da luz LED 3D até o teto, anel SVG de sincronização ALRIS e carregamento em cascata das colunas do Kanban.

---

## 3. Estado Atual & Diagnóstico do Discador

### ⚠️ Situação Encontrada
O usuário relatou: *"Eu clico e ela não retorna o discador... Ele vai fazer o quê? O teclado numérico é do celular que está usando?"*

- **Causa Raiz:** O botão "Ligar" no card de lead ainda invocava `startNormalPhoneCall()`, abrindo um modal básico de cópia/protocolo `tel:` legado, em vez do novo componente de **Softphone WebRTC na tela**.
- **Comportamento Esperado:** Um painel/modal flutuante de **Softphone Virtual** deve se abrir diretamente no navegador, permitindo:
  1. Digitar números no teclado DTMF virtual (sem usar o celular).
  2. Ver status da conexão (`Chamando...`, `Conectado`, `00:45`).
  3. Visualizar indicador dinâmico de ondas de áudio (microfone do computador).
  4. Mute/Unmute e Encerramento com gravação de histórico.

---

## 4. Estrutura de Arquivos

```
agency-portal/
├── backend/
│   ├── server.py                 # Servidor HTTP/API Python (Porta 8080)
│   ├── call_logs.json            # Histórico local de chamadas registradas
│   └── mock_data.json            # Base mock de leads e métricas
├── css/
│   └── styles.css                # Estilos globais, Glassmorphism, temas e animações
├── js/
│   └── app.js                    # Lógica da aplicação, áudio WebRTC, transições e Kanban
├── supabase/
│   └── migrations/
│       └── 20261126_create_call_logs.sql # Migration SQL da tabela call_logs
├── index.html                    # Interface principal (SPA)
├── .env.example                  # Variáveis de ambiente documentadas
└── HANDOFF.md                    # Este documento
```

---

## 5. Variáveis de Ambiente Necessárias (`.env`)

```ini
# Provedor WebRTC / Voz (Twilio, Telnyx ou SIP)
VOICE_ACCOUNT_SID=AC_mock_twilio_account_sid
VOICE_API_KEY=SK_mock_voice_api_key
VOICE_API_SECRET=mock_voice_api_secret_key
VOICE_APP_SID=AP_mock_twiml_application_sid
VOICE_CALLER_ID=+551140040001
WEBHOOK_BASE_URL=http://localhost:8080

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# Inteligência Artificial (Google Gemini)
GEMINI_API_KEY=AIzaSy...
```

---

## 6. Próximos Passos de Implementação

1. **Substituir o Modal Legado em `index.html`:**
   - Inserir o componente de **Softphone WebRTC Flutuante** com teclado DTMF completo (0-9, *, #), medidor de áudio e seletor (WebRTC PSTN vs WhatsApp).
2. **Atualizar `js/app.js`:**
   - Integrar `navigator.mediaDevices.getUserMedia({ audio: true })`.
   - Adicionar o gerenciador de Web Audio API para desenhar as ondas de fala.
   - Enviar eventos de encerramento para o backend e atualizar o Supabase.
3. **Garantir o Servidor Backend Ativo:**
   - Executar: `python3 backend/server.py` na porta `8080`.
4. **Sincronização:**
   - Espelhar alterações para `/home/rafael/ALRIS-Call-Center/`.
   - Realizar commit no Git.
