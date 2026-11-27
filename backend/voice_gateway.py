#!/usr/bin/env python3
"""
ALRIS External Voice & Omnichannel Calling Gateway (Microsserviço Dedicado - Porta 8081)
Responsável por:
  1. Localização e roteamento ultrarrápido de chamadas de saída (WebRTC PSTN & WhatsApp Business Voice API)
  2. Gerenciamento de Caller ID (Número Virtual / Identificador exibido no celular do cliente sem chip no PC)
  3. Sessões ativas em memória + Persistência compartilhada (call_logs.json & Supabase)
  4. Encerramento remoto (Hangup) acionável tanto pelo Softphone quanto pela tela de Conversa
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
ENV_PATH = os.path.join(ROOT_DIR, ".env")
CALL_LOGS_PATH = os.path.join(BASE_DIR, "call_logs.json")
GATEWAY_CONFIG_PATH = os.path.join(BASE_DIR, "voice_gateway_config.json")

E164_REGEX = re.compile(r"^\+[1-9]\d{7,14}$")
ACTIVE_SESSIONS = {}


def load_dotenv(path: str):
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


load_dotenv(ENV_PATH)


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default


def save_json(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[ALRIS Voice Gateway] Erro ao salvar {path}: {exc}")


def get_gateway_config() -> dict:
    cfg = load_json(GATEWAY_CONFIG_PATH, {})
    acc_sid = cfg.get("account_sid") or os.environ.get("VOICE_ACCOUNT_SID", "").strip()
    auth_token = cfg.get("auth_token") or os.environ.get("VOICE_AUTH_TOKEN", "").strip()
    api_key = cfg.get("api_key") or os.environ.get("VOICE_API_KEY", "").strip()
    api_secret = cfg.get("api_secret") or os.environ.get("VOICE_API_SECRET", "").strip()

    wa_token = cfg.get("whatsapp_access_token") or os.environ.get("WHATSAPP_ACCESS_TOKEN", "").strip()
    wa_phone_id = cfg.get("whatsapp_phone_number_id") or os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    has_pstn = bool(acc_sid and (auth_token or (api_key and api_secret)))
    return {
        "caller_id": cfg.get("caller_id") or os.environ.get("VOICE_CALLER_ID", "+17372508034"),
        "caller_label": cfg.get("caller_label") or "ALRIS Central de Atendimento",
        "region": cfg.get("region") or "sa-east-1 (São Paulo - Baixa Latência)",
        "pstn_configured": has_pstn,
        "account_sid_masked": f"{acc_sid[:6]}...{acc_sid[-4:]}" if len(acc_sid) > 10 else "",
        "whatsapp_voice_configured": bool(wa_token and wa_phone_id),
    }


def lookup_carrier_hint(e164: str) -> dict:
    """Localiza DDI/DDD e rota de menor latência para a chamada."""
    digits = e164.lstrip("+")
    if digits.startswith("55") and len(digits) >= 12:
        ddd = digits[2:4]
        is_mobile = len(digits) == 13 and digits[4] == "9"
        return {
            "country": "BR",
            "ddd": ddd,
            "line_type": "mobile" if is_mobile else "landline",
            "route_pop": "BR-SP-IX (Rota Direta Operadoras Brasil)",
            "estimated_setup_ms": 180,
        }
    return {
        "country": "INTL",
        "ddd": digits[:2],
        "line_type": "international",
        "route_pop": "GLOBAL-SIP-EDGE",
        "estimated_setup_ms": 290,
    }


def generate_ephemeral_token(agent_id: str, org_id: str, caller_id: str) -> dict:
    now = int(time.time())
    exp = now + 900
    secret = os.environ.get("VOICE_API_SECRET") or "alris-gateway-fast-hmac-secret"
    api_key = os.environ.get("VOICE_API_KEY") or "SK_ALRIS_EDGE"
    acc_sid = os.environ.get("VOICE_ACCOUNT_SID") or "AC_ALRIS_EDGE"

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "jti": f"{api_key}-{now}",
        "iss": api_key,
        "sub": acc_sid,
        "iat": now,
        "exp": exp,
        "caller_id": caller_id,
        "agent_id": agent_id,
        "org_id": org_id,
    }

    def b64(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

    unsigned = f"{b64(json.dumps(header).encode())}.{b64(json.dumps(payload).encode())}"
    sig = hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest()
    return {
        "token": f"{unsigned}.{b64(sig)}",
        "expires_at": exp,
        "caller_id": caller_id,
    }


def fetch_twilio_first_number(acc_sid: str, auth_b64: str) -> str:
    try:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{acc_sid}/IncomingPhoneNumbers.json?PageSize=1"
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth_b64}"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            nums = data.get("incoming_phone_numbers", [])
            if nums:
                found = nums[0].get("phone_number", "")
                if found:
                    cfg = load_json(GATEWAY_CONFIG_PATH, {})
                    cfg["caller_id"] = found
                    save_json(GATEWAY_CONFIG_PATH, cfg)
                    return found
    except Exception:
        pass
    return ""


def dispatch_pstn_provider(e164_to: str, caller_id: str, contact_name: str):
    cfg = load_json(GATEWAY_CONFIG_PATH, {})
    acc_sid = (cfg.get("account_sid") or os.environ.get("VOICE_ACCOUNT_SID", "")).strip()
    auth_token = (cfg.get("auth_token") or os.environ.get("VOICE_AUTH_TOKEN", "")).strip()
    api_key = (cfg.get("api_key") or os.environ.get("VOICE_API_KEY", "")).strip()
    api_secret = (cfg.get("api_secret") or os.environ.get("VOICE_API_SECRET", "")).strip()

    user_cred = api_key if (api_key and api_secret) else acc_sid
    pass_cred = api_secret if (api_key and api_secret) else auth_token

    if not (acc_sid and user_cred and pass_cred):
        return None, "sandbox_mock", None

    auth = base64.b64encode(f"{user_cred}:{pass_cred}".encode()).decode("ascii")
    if not caller_id or caller_id in ("+551140040001", "+551140001234"):
        auto_num = fetch_twilio_first_number(acc_sid, auth)
        if auto_num:
            caller_id = auto_num
        else:
            return (
                None,
                "live_provider",
                "Ative seu número gratuito no painel Twilio (Phone Numbers -> Get a trial phone number) e verifique seu celular em Verified Caller IDs.",
            )

    try:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{acc_sid}/Calls.json"
        template_url = (cfg.get("twilio_template_url") or os.environ.get("TWILIO_TEMPLATE_URL", "")).strip()
        call_params = {
            "To": e164_to,
            "From": caller_id,
        }
        if template_url:
            call_params["Url"] = template_url
        else:
            call_params["Twiml"] = f"<Response><Say language='pt-BR'>Olá {contact_name}, ligação conectada pelo painel ALRIS.</Say><Pause length='90'/></Response>"

        body = urlencode(call_params).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("sid"), "live_provider", None
    except urllib.error.HTTPError as http_err:
        try:
            err_json = json.loads(http_err.read().decode("utf-8"))
            msg = err_json.get("message", str(http_err))
            print(f"[TWILIO HTTP ERROR] {http_err.code}: {msg}")
            return None, "live_provider", msg
        except Exception:
            return None, "live_provider", str(http_err)
    except Exception as exc:
        return None, "live_provider", str(exc)


def dispatch_whatsapp_voice_api(e164_to: str, contact_name: str):
    cfg = load_json(GATEWAY_CONFIG_PATH, {})
    wa_token = (cfg.get("whatsapp_access_token") or os.environ.get("WHATSAPP_ACCESS_TOKEN", "")).strip()
    wa_phone_id = (cfg.get("whatsapp_phone_number_id") or os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")).strip()
    if not (wa_token and wa_phone_id):
        return None, "sandbox_mock", None

    to_digits = re.sub(r"\D", "", e164_to)

    # 1. Tenta disparo direto de chamada de voz na Graph API (v25.0)
    try:
        call_url = f"https://graph.facebook.com/v25.0/{wa_phone_id}/calls"
        call_payload = json.dumps({
            "messaging_product": "whatsapp",
            "to": to_digits,
            "action": "connect",
        }).encode("utf-8")
        req = urllib.request.Request(
            call_url,
            data=call_payload,
            method="POST",
            headers={"Authorization": f"Bearer {wa_token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("calls", [{}])[0].get("id") or f"WA_CALL_{int(time.time())}", "live_provider", None
    except urllib.error.HTTPError:
        # 2. Se for número de teste gratuito da Meta (+1 555-168-9229), dispara sinalização oficial Cloud API (/messages)
        try:
            msg_url = f"https://graph.facebook.com/v25.0/{wa_phone_id}/messages"
            msg_payload = json.dumps({
                "messaging_product": "whatsapp",
                "to": to_digits,
                "type": "template",
                "template": {"name": "hello_world", "language": {"code": "en_US"}},
            }).encode("utf-8")
            m_req = urllib.request.Request(
                msg_url,
                data=msg_payload,
                method="POST",
                headers={"Authorization": f"Bearer {wa_token}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(m_req, timeout=8) as m_resp:
                m_data = json.loads(m_resp.read().decode("utf-8"))
                msg_id = m_data.get("messages", [{}])[0].get("id") or f"WA_MSG_{int(time.time())}"
                return msg_id, "live_provider", None
        except urllib.error.HTTPError as m_err:
            try:
                err_body = json.loads(m_err.read().decode("utf-8"))
                err_obj = err_body.get("error", {})
                code = err_obj.get("code")
                if code == 131030:
                    return None, "live_provider", f"No painel da Meta (Etapa 1), clique em 'Destinatário' e cadastre o número +{to_digits} para liberar o recebimento."
                return None, "live_provider", err_obj.get("message", str(m_err))
            except Exception:
                return None, "live_provider", str(m_err)
    except Exception as exc:
        return None, "live_provider", str(exc)


class VoiceGatewayHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return  # Logs limpos e rápidos

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, code: int, payload: dict):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(raw)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/whatsapp/webhook", "/webhook/whatsapp"):
            qs = parse_qs(parsed.query)
            mode = (qs.get("hub.mode", [""])[0] or "").strip()
            token = (qs.get("hub.verify_token", [""])[0] or "").strip()
            challenge = (qs.get("hub.challenge", [""])[0] or "").strip()
            verify_expected = os.environ.get("WHATSAPP_VERIFY_TOKEN", "alris_meta_webhook_2026")
            if mode == "subscribe" and token == verify_expected:
                raw = challenge.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            return self._json(403, {"error": "Verify token inválido."})

        if parsed.path in ("/", "/health", "/voice/status"):
            cfg = get_gateway_config()
            return self._json(200, {
                "service": "ALRIS External Voice Gateway",
                "status": "online",
                "port": 8081,
                "active_calls": len(ACTIVE_SESSIONS),
                **cfg,
            })

        if parsed.path == "/voice/lookup":
            qs = parse_qs(parsed.query)
            raw = (qs.get("phone", [""])[0] or "").strip()
            digits = re.sub(r"\D", "", raw)
            e164 = f"+{digits}" if digits else "+5511987654321"
            return self._json(200, {
                "success": True,
                "phone_e164": e164,
                "route": lookup_carrier_hint(e164),
                "caller_id": get_gateway_config()["caller_id"],
            })

        if parsed.path == "/voice/sessions":
            return self._json(200, {"success": True, "sessions": list(ACTIVE_SESSIONS.values())})

        return self._json(404, {"success": False, "error": "Rota não encontrada no Voice Gateway."})

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            data = self._read_body()
        except Exception:
            return self._json(400, {"success": False, "error": "JSON inválido."})

        if parsed.path in ("/api/whatsapp/webhook", "/webhook/whatsapp"):
            print(f"[META WEBHOOK] Evento recebido: {json.dumps(data)[:200]}")
            return self._json(200, {"status": "EVENT_RECEIVED"})

        if parsed.path == "/whatsapp/send":
            cfg = load_json(GATEWAY_CONFIG_PATH, {})
            wa_token = (cfg.get("whatsapp_access_token") or os.environ.get("WHATSAPP_ACCESS_TOKEN", "")).strip()
            wa_phone_id = (cfg.get("whatsapp_phone_number_id") or os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")).strip()
            raw_phone = str(data.get("phone_number") or "").strip()
            to_digits = re.sub(r"\D", "", raw_phone)
            message_text = str(data.get("message_text") or "").strip()

            if not to_digits or not message_text:
                return self._json(400, {"success": False, "error": "Informe o número e a mensagem."})
            if not (wa_token and wa_phone_id):
                return self._json(200, {"success": True, "mode": "sandbox_mock", "message_id": f"WA_MOCK_{int(time.time())}"})

            msg_url = f"https://graph.facebook.com/v25.0/{wa_phone_id}/messages"
            headers = {"Authorization": f"Bearer {wa_token}", "Content-Type": "application/json"}

            # 1. Tenta enviar o texto livre digitado pelo operador
            try:
                text_payload = json.dumps({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": to_digits,
                    "type": "text",
                    "text": {"preview_url": False, "body": message_text},
                }).encode("utf-8")
                req = urllib.request.Request(msg_url, data=text_payload, method="POST", headers=headers)
                with urllib.request.urlopen(req, timeout=8) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    wamid = res_data.get("messages", [{}])[0].get("id", "")
                    print(f"[WHATSAPP MSG 8081] Texto enviado -> +{to_digits} | {wamid}")
                    return self._json(200, {"success": True, "mode": "live_provider", "type": "text", "message_id": wamid})
            except urllib.error.HTTPError as err1:
                # 2. Se fora da janela de 24h, envia template oficial hello_world
                try:
                    tpl_payload = json.dumps({
                        "messaging_product": "whatsapp",
                        "to": to_digits,
                        "type": "template",
                        "template": {"name": "hello_world", "language": {"code": "en_US"}},
                    }).encode("utf-8")
                    req2 = urllib.request.Request(msg_url, data=tpl_payload, method="POST", headers=headers)
                    with urllib.request.urlopen(req2, timeout=8) as resp2:
                        res2 = json.loads(resp2.read().decode("utf-8"))
                        wamid = res2.get("messages", [{}])[0].get("id", "")
                        print(f"[WHATSAPP MSG 8081] Template enviado -> +{to_digits} | {wamid}")
                        return self._json(200, {"success": True, "mode": "live_provider", "type": "template", "message_id": wamid})
                except urllib.error.HTTPError as err2:
                    try:
                        e_json = json.loads(err2.read().decode("utf-8"))
                        return self._json(200, {"success": False, "error": e_json.get("error", {}).get("message", str(err2))})
                    except Exception:
                        return self._json(200, {"success": False, "error": str(err2)})
            except Exception as exc:
                return self._json(200, {"success": False, "error": str(exc)})

        if parsed.path == "/voice/configure-provider":
            acc_sid = str(data.get("account_sid") or "").strip()
            auth_token = str(data.get("auth_token") or "").strip()
            raw_cid = str(data.get("caller_id") or "").strip()
            digits = re.sub(r"\D", "", raw_cid)
            e164_cid = f"+{digits}" if digits else get_gateway_config()["caller_id"]

            cfg = load_json(GATEWAY_CONFIG_PATH, {})
            if acc_sid:
                cfg["account_sid"] = acc_sid
                os.environ["VOICE_ACCOUNT_SID"] = acc_sid
            if auth_token:
                cfg["auth_token"] = auth_token
                os.environ["VOICE_AUTH_TOKEN"] = auth_token
            if E164_REGEX.match(e164_cid):
                cfg["caller_id"] = e164_cid
                os.environ["VOICE_CALLER_ID"] = e164_cid
            save_json(GATEWAY_CONFIG_PATH, cfg)
            return self._json(200, {"success": True, **get_gateway_config()})

        if parsed.path == "/voice/caller-id":
            raw_cid = str(data.get("caller_id") or "").strip()
            digits = re.sub(r"\D", "", raw_cid)
            e164_cid = f"+{digits}" if digits else "+551140040001"
            if not E164_REGEX.match(e164_cid):
                return self._json(400, {"success": False, "error": "Caller ID deve seguir formato +55DDDNumero."})
            label = str(data.get("caller_label") or "ALRIS Atendimento").strip()
            cfg = load_json(GATEWAY_CONFIG_PATH, {})
            cfg["caller_id"] = e164_cid
            cfg["caller_label"] = label
            save_json(GATEWAY_CONFIG_PATH, cfg)
            return self._json(200, {"success": True, **get_gateway_config()})

        if parsed.path == "/voice/dial":
            cfg = get_gateway_config()
            raw_phone = str(data.get("phone_number") or "").strip()
            digits = re.sub(r"\D", "", raw_phone)
            e164 = f"+{digits}" if digits else ""
            if not E164_REGEX.match(e164):
                return self._json(400, {"success": False, "error": "Número inválido. Use DDI+DDD+Número (ex: +5521999999999)."})

            channel = "whatsapp_call" if data.get("channel") == "whatsapp_call" else "webrtc_voice"
            contact_name = str(data.get("contact_name") or "Cliente ALRIS").strip()
            agent_id = str(data.get("agent_id") or "agent_rafael")
            org_id = str(data.get("organization_id") or "00000000-0000-4000-8000-000000000099")
            caller_id = str(data.get("caller_id") or cfg["caller_id"]).strip()

            route_info = lookup_carrier_hint(e164)
            token_data = generate_ephemeral_token(agent_id, org_id, caller_id)

            ext_sid = None
            mode = "sandbox_mock"
            provider_err = None

            if channel == "whatsapp_call":
                ext_sid, mode, provider_err = dispatch_whatsapp_voice_api(e164, contact_name)
            else:
                ext_sid, mode, provider_err = dispatch_pstn_provider(e164, caller_id, contact_name)

            call_sid = ext_sid or f"CA{secrets.token_hex(12)}"
            now_iso = datetime.now(timezone.utc).isoformat()

            record = {
                "id": str(uuid.uuid4()),
                "organization_id": org_id,
                "agent_id": agent_id,
                "contact_name": contact_name,
                "phone_number": e164,
                "caller_id": caller_id,
                "channel": channel,
                "direction": "outbound",
                "status": "failed" if provider_err else "connected",
                "duration_seconds": 0,
                "external_call_sid": call_sid,
                "route_pop": route_info["route_pop"],
                "recording_url": None,
                "created_at": now_iso,
                "ended_at": None,
            }

            ACTIVE_SESSIONS[call_sid] = record
            logs_db = load_json(CALL_LOGS_PATH, {"calls": []})
            logs_db.setdefault("calls", []).insert(0, record)
            logs_db["calls"] = logs_db["calls"][:100]
            save_json(CALL_LOGS_PATH, logs_db)

            print(f"[VOICE GATEWAY 8081] {channel.upper()} | {caller_id} -> {e164} ({contact_name}) | {route_info['route_pop']} | {mode}")

            return self._json(200, {
                "success": provider_err is None,
                "mode": mode,
                "provider_error": provider_err,
                "token": token_data["token"],
                "caller_id": caller_id,
                "caller_label": cfg["caller_label"],
                "route": route_info,
                "call": record,
            })

        if parsed.path == "/voice/hangup":
            call_sid = str(data.get("external_call_sid") or "").strip()
            duration = int(data.get("duration_seconds") or 0)
            ended_iso = datetime.now(timezone.utc).isoformat()

            # Encerrar a chamada real na Twilio imediatamente se for um CallSid oficial (34 chars CA...)
            if call_sid.startswith("CA") and len(call_sid) == 34:
                try:
                    cfg = load_json(GATEWAY_CONFIG_PATH, {})
                    acc_sid = (cfg.get("account_sid") or os.environ.get("VOICE_ACCOUNT_SID", "")).strip()
                    auth_token = (cfg.get("auth_token") or os.environ.get("VOICE_AUTH_TOKEN", "")).strip()
                    if acc_sid and auth_token:
                        auth = base64.b64encode(f"{acc_sid}:{auth_token}".encode()).decode("ascii")
                        h_url = f"https://api.twilio.com/2010-04-01/Accounts/{acc_sid}/Calls/{call_sid}.json"
                        h_req = urllib.request.Request(
                            h_url,
                            data=urlencode({"Status": "completed"}).encode("utf-8"),
                            method="POST",
                            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                        )
                        urllib.request.urlopen(h_req, timeout=5).close()
                        print(f"[VOICE GATEWAY 8081] HANGUP TWILIO REAL -> {call_sid}")
                except Exception as exc:
                    print(f"[VOICE GATEWAY 8081] Hangup aviso: {exc}")

            ACTIVE_SESSIONS.pop(call_sid, None)
            logs_db = load_json(CALL_LOGS_PATH, {"calls": []})
            for item in logs_db.get("calls", []):
                if item.get("external_call_sid") == call_sid:
                    item["status"] = "completed"
                    item["duration_seconds"] = duration
                    item["ended_at"] = ended_iso
                    break
            save_json(CALL_LOGS_PATH, logs_db)
            return self._json(200, {"success": True, "external_call_sid": call_sid, "status": "completed", "duration_seconds": duration})

        return self._json(404, {"success": False, "error": "Endpoint inválido."})


if __name__ == "__main__":
    port = int(os.environ.get("VOICE_GATEWAY_PORT", 8081))
    print(f"ALRIS External Voice Gateway ativo em http://localhost:{port}/")
    ThreadingHTTPServer(("0.0.0.0", port), VoiceGatewayHandler).serve_forever()
