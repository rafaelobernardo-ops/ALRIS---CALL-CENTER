#!/usr/bin/env python3
"""
ALRIS — Canal de Atendimento & Discador WebRTC (Click-to-Call)
Servidor Backend & API Local (Python)
Inclui:
  - Confirmação de cadastro c/ token + Simulador SMTP (/api/register-admin, /api/verify-email)
  - Geração segura de Token WebRTC (/api/voice/token)
  - Disparo de Chamada Outbound E.164 c/ Fallback Mock (/api/voice/outbound)
  - Webhook de Status, Duração e Gravação (/api/voice/webhook)
  - Histórico Persistente de Chamadas (/api/voice/logs)
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT_DIR, ".env")
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verifications.json")
CALL_LOGS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "call_logs.json")

E164_REGEX = re.compile(r"^\+[1-9]\d{7,14}$")


def load_dotenv_file(path: str):
    """Carrega variáveis do arquivo .env local caso exista."""
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception as e:
        print(f"[ALRIS ENV] Aviso ao ler .env: {e}")


load_dotenv_file(ENV_PATH)


def load_json_file(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default


def save_json_file(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[ALRIS Backend] Erro ao salvar {path}: {e}")


def is_voice_provider_configured():
    return all(
        bool(os.environ.get(k, "").strip())
        for k in ("VOICE_ACCOUNT_SID", "VOICE_API_KEY", "VOICE_API_SECRET", "VOICE_APP_SID")
    )


def generate_short_lived_webrtc_token(agent_id: str, org_id: str, ttl_seconds: int = 900) -> dict:
    """
    Gera um JWT / Token de Sessão WebRTC de curta duração assinado via HMAC-SHA256.
    NUNCA expõe VOICE_API_SECRET ou AUTH_TOKEN no payload enviado ao frontend.
    """
    now = int(time.time())
    exp = now + ttl_seconds
    simulation_mode = not is_voice_provider_configured()
    signing_secret = os.environ.get("VOICE_API_SECRET") or "alris-local-sandbox-ephemeral-signing-key"
    api_key = os.environ.get("VOICE_API_KEY") or "SK_SANDBOX_LOCAL"
    account_sid = os.environ.get("VOICE_ACCOUNT_SID") or "AC_SANDBOX_LOCAL"
    app_sid = os.environ.get("VOICE_APP_SID") or "AP_SANDBOX_LOCAL"

    header = {"alg": "HS256", "typ": "JWT", "cty": "twilio-fpa;v=1"}
    payload = {
        "jti": f"{api_key}-{now}",
        "iss": api_key,
        "sub": account_sid,
        "iat": now,
        "exp": exp,
        "grants": {
            "identity": f"agent_{agent_id}",
            "org_id": org_id,
            "voice": {
                "incoming": {"allow": True},
                "outgoing": {"application_sid": app_sid},
            },
        },
    }

    def b64url(obj: bytes) -> str:
        return base64.urlsafe_b64encode(obj).rstrip(b"=").decode("ascii")

    unsigned = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(payload).encode())}"
    sig = hmac.new(signing_secret.encode("utf-8"), unsigned.encode("ascii"), hashlib.sha256).digest()
    jwt_token = f"{unsigned}.{b64url(sig)}"

    return {
        "token": jwt_token,
        "identity": f"agent_{agent_id}",
        "expires_in": ttl_seconds,
        "expires_at": exp,
        "mode": "sandbox_mock" if simulation_mode else "live_provider",
        "caller_id": os.environ.get("VOICE_CALLER_ID", "+551140001234"),
    }


def sync_call_log_to_supabase(record: dict, is_update: bool = False):
    """Sincroniza opcionalmente com Supabase REST caso SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY estejam definidos."""
    sb_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not sb_url or not sb_key:
        return
    try:
        endpoint = f"{sb_url}/rest/v1/call_logs"
        method = "POST"
        if is_update:
            endpoint += f"?external_call_sid=eq.{record['external_call_sid']}"
            method = "PATCH"
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(record).encode("utf-8"),
            method=method,
            headers={
                "Content-Type": "application/json",
                "apikey": sb_key,
                "Authorization": f"Bearer {sb_key}",
                "Prefer": "return=minimal",
            },
        )
        urllib.request.urlopen(req, timeout=4)
    except Exception as e:
        print(f"[ALRIS Supabase Sync] Aviso (fallback local mantido): {e}")


class AlrisHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def _send_json(self, status_code, payload):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path in ("/api/whatsapp/webhook", "/webhook/whatsapp", "/webhook"):
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
            return self._send_json(403, {"error": "Verify token inválido."})

        if parsed.path == "/api/health":
            return self._send_json(200, {
                "status": "ok",
                "service": "ALRIS Call Center & WebRTC Backend",
                "webrtc_mode": "live_provider" if is_voice_provider_configured() else "sandbox_mock",
            })

        if parsed.path == "/api/plans":
            plans = [
                {"id": "starter", "name": "Plano Starter", "price": 149, "seats": 1},
                {"id": "pro", "name": "Plano Pro Growth", "price": 299, "seats": 5},
                {"id": "enterprise", "name": "Plano Enterprise Scale", "price": 699, "seats": 99},
            ]
            return self._send_json(200, plans)

        if parsed.path == "/api/voice/logs":
            logs_db = load_json_file(CALL_LOGS_PATH, {"calls": []})
            return self._send_json(200, {"success": True, "calls": logs_db.get("calls", [])[:25]})

        if parsed.path == "/api/verify-email":
            query_params = parse_qs(parsed.query)
            token = query_params.get("token", [None])[0]
            if not token:
                return self._send_json(400, {"success": False, "error": "Token não fornecido."})

            db = load_json_file(DB_PATH, {"users": {}, "tokens": {}})
            token_data = db.get("tokens", {}).get(token)
            if not token_data:
                return self._send_json(404, {"success": False, "error": "Token inválido ou já utilizado."})

            if token_data.get("expires_at", 0) < time.time():
                return self._send_json(410, {"success": False, "error": "Token expirado."})

            email = token_data["email"]
            if email in db["users"]:
                db["users"][email]["verified"] = True
                db["users"][email]["verified_at"] = int(time.time())

            del db["tokens"][token]
            save_json_file(DB_PATH, db)

            self.send_response(302)
            self.send_header("Location", f"/?verified=1&email={email}")
            self.end_headers()
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        # ------------------------------------------------------------------
        # 1. POST /api/voice/token — Token WebRTC Efêmero (Segurança Server-Side)
        # ------------------------------------------------------------------
        if parsed.path == "/api/voice/token":
            try:
                data = self._read_json()
            except Exception:
                return self._send_json(400, {"success": False, "error": "Payload JSON inválido."})

            agent_id = str(data.get("agent_id") or "00000000-0000-4000-8000-000000000001")
            org_id = str(data.get("organization_id") or "00000000-0000-4000-8000-000000000099")
            token_bundle = generate_short_lived_webrtc_token(agent_id=agent_id, org_id=org_id)
            return self._send_json(200, {"success": True, **token_bundle})

        # ------------------------------------------------------------------
        # 2. POST /api/voice/outbound — Inicia Chamada E.164 (Real ou Sandbox)
        # ------------------------------------------------------------------
        if parsed.path == "/api/voice/outbound":
            try:
                data = self._read_json()
            except Exception:
                return self._send_json(400, {"success": False, "error": "Payload JSON inválido."})

            raw_phone = str(data.get("phone_number") or "").strip()
            digits = re.sub(r"\D", "", raw_phone)
            e164_phone = raw_phone if raw_phone.startswith("+") else f"+{digits}"

            if not E164_REGEX.match(e164_phone):
                return self._send_json(400, {
                    "success": False,
                    "error": "Número inválido. Utilize o padrão internacional E.164 (ex.: +5511987654321)."
                })

            channel = data.get("channel") if data.get("channel") in ("webrtc_voice", "whatsapp_call") else "webrtc_voice"
            contact_name = str(data.get("contact_name") or "Lead ALRIS").strip()
            org_id = str(data.get("organization_id") or "00000000-0000-4000-8000-000000000099")
            agent_id = str(data.get("agent_id") or "00000000-0000-4000-8000-000000000001")

            call_id = str(uuid.uuid4())
            call_sid = f"CA{secrets.token_hex(16)}"
            now_iso = datetime.now(timezone.utc).isoformat()
            simulation_mode = not is_voice_provider_configured()
            provider_error = None

            # Se houver credenciais reais de operadora VoIP (ex: Twilio), dispara na rede telefônica PSTN
            if not simulation_mode and channel == "webrtc_voice":
                try:
                    acc_sid = os.environ["VOICE_ACCOUNT_SID"].strip()
                    api_key = os.environ["VOICE_API_KEY"].strip()
                    api_secret = os.environ["VOICE_API_SECRET"].strip()
                    caller_id = os.environ.get("VOICE_CALLER_ID", "+551140001234").strip()
                    webhook_base = os.environ.get("WEBHOOK_BASE_URL", "").strip().rstrip("/")

                    twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{acc_sid}/Calls.json"
                    auth_b64 = base64.b64encode(f"{api_key}:{api_secret}".encode("utf-8")).decode("ascii")
                    form_payload = {
                        "To": e164_phone,
                        "From": caller_id,
                        "Twiml": f"<Response><Say language='pt-BR'>Conectando chamada do painel ALRIS com {contact_name}.</Say><Dial>{e164_phone}</Dial></Response>",
                    }
                    if webhook_base and webhook_base.startswith("https://"):
                        form_payload["StatusCallback"] = f"{webhook_base}/api/voice/webhook"

                    req = urllib.request.Request(
                        twilio_url,
                        data=urlencode(form_payload).encode("utf-8"),
                        method="POST",
                        headers={
                            "Authorization": f"Basic {auth_b64}",
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        twilio_resp = json.loads(resp.read().decode("utf-8"))
                        call_sid = twilio_resp.get("sid", call_sid)
                except Exception as exc:
                    provider_error = str(exc)
                    print(f"[ALRIS TWILIO LIVE ERROR] {exc}")

            record = {
                "id": call_id,
                "organization_id": org_id,
                "agent_id": agent_id,
                "contact_name": contact_name,
                "phone_number": e164_phone,
                "channel": channel,
                "direction": "outbound",
                "status": "failed" if provider_error else "ringing",
                "duration_seconds": 0,
                "external_call_sid": call_sid,
                "recording_url": None,
                "created_at": now_iso,
                "ended_at": None,
            }

            logs_db = load_json_file(CALL_LOGS_PATH, {"calls": []})
            logs_db.setdefault("calls", []).insert(0, record)
            logs_db["calls"] = logs_db["calls"][:100]
            save_json_file(CALL_LOGS_PATH, logs_db)
            sync_call_log_to_supabase(record, is_update=False)

            print(f"[ALRIS VOICE OUTBOUND] SID={call_sid} -> {e164_phone} ({contact_name}) [{channel}] mode={'MOCK' if simulation_mode else 'LIVE'}")

            return self._send_json(200, {
                "success": provider_error is None,
                "mode": "sandbox_mock" if simulation_mode else "live_provider",
                "provider_error": provider_error,
                "call": record,
            })

        # ------------------------------------------------------------------
        # 3. POST /api/voice/webhook — Atualiza Status, Duração e Gravação
        # ------------------------------------------------------------------
        if parsed.path == "/api/voice/webhook":
            try:
                data = self._read_json()
            except Exception:
                return self._send_json(400, {"success": False, "error": "Payload JSON inválido."})

            call_sid = str(data.get("external_call_sid") or data.get("CallSid") or "").strip()
            raw_status = str(data.get("status") or data.get("CallStatus") or "completed").lower()
            status_map = {
                "initiated": "initiated",
                "ringing": "ringing",
                "in-progress": "connected",
                "connected": "connected",
                "completed": "completed",
                "busy": "failed",
                "no-answer": "failed",
                "failed": "failed",
            }
            mapped_status = status_map.get(raw_status, "completed")
            duration = max(0, int(data.get("duration_seconds") or data.get("CallDuration") or 0))
            recording_url = data.get("recording_url") or data.get("RecordingUrl")

            logs_db = load_json_file(CALL_LOGS_PATH, {"calls": []})
            updated_record = None
            for item in logs_db.get("calls", []):
                if item.get("external_call_sid") == call_sid:
                    item["status"] = mapped_status
                    item["duration_seconds"] = duration
                    if recording_url:
                        item["recording_url"] = recording_url
                    if mapped_status in ("completed", "failed"):
                        item["ended_at"] = datetime.now(timezone.utc).isoformat()
                    updated_record = item
                    break

            save_json_file(CALL_LOGS_PATH, logs_db)
            if updated_record:
                sync_call_log_to_supabase({
                    "external_call_sid": call_sid,
                    "status": mapped_status,
                    "duration_seconds": duration,
                    "recording_url": recording_url,
                    "ended_at": updated_record.get("ended_at"),
                }, is_update=True)

            print(f"[ALRIS VOICE WEBHOOK] SID={call_sid} status={mapped_status} duration={duration}s")
            return self._send_json(200, {"success": True, "call": updated_record})

        # ------------------------------------------------------------------
        # 4. POST /api/register-admin — Cadastro + Token de E-mail
        # ------------------------------------------------------------------
        if parsed.path == "/api/register-admin":
            try:
                data = self._read_json()
            except Exception:
                return self._send_json(400, {"success": False, "error": "JSON inválido."})

            company = data.get("company", "").strip()
            name = data.get("name", "").strip()
            email = data.get("email", "").strip().lower()
            phone = data.get("phone", "").strip()

            if not email or not name:
                return self._send_json(400, {"success": False, "error": "Nome e e-mail corporativo são obrigatórios."})

            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + (24 * 3600)
            host_header = self.headers.get("Host", "localhost:8080")
            verify_url = f"http://{host_header}/api/verify-email?token={token}"

            db = load_json_file(DB_PATH, {"users": {}, "tokens": {}})
            db["users"][email] = {
                "company": company,
                "name": name,
                "email": email,
                "phone": phone,
                "verified": False,
                "created_at": int(time.time()),
            }
            db["tokens"][token] = {
                "email": email,
                "expires_at": expires_at,
                "created_at": int(time.time()),
            }
            save_json_file(DB_PATH, db)

            smtp_host = os.environ.get("SMTP_HOST")
            email_sent_real = False
            if smtp_host:
                try:
                    smtp_port = int(os.environ.get("SMTP_PORT", 587))
                    smtp_user = os.environ.get("SMTP_USER", "")
                    smtp_pass = os.environ.get("SMTP_PASS", "")
                    msg = MIMEMultipart("alternative")
                    msg["Subject"] = "Confirmação de Acesso — ALRIS Canal de Atendimento"
                    msg["From"] = smtp_user or "no-reply@alris.com.br"
                    msg["To"] = email
                    html_content = f"<p>Olá {name}, confirme seu e-mail ALRIS: <a href='{verify_url}'>{verify_url}</a></p>"
                    msg.attach(MIMEText(html_content, "html"))
                    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                        server.starttls()
                        if smtp_user and smtp_pass:
                            server.login(smtp_user, smtp_pass)
                        server.sendmail(msg["From"], [email], msg.as_string())
                    email_sent_real = True
                except Exception as e:
                    print(f"[ALRIS SMTP] Fallback simulador local: {e}")

            return self._send_json(200, {
                "success": True,
                "message": f"Link de confirmação enviado para {email}.",
                "verification_url": verify_url,
                "token": token,
                "simulated": not email_sent_real,
            })

        self._send_json(404, {"error": "Endpoint não encontrado."})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"ALRIS Backend & WebRTC Voice API rodando em http://localhost:{port}/")
    ThreadingHTTPServer(("0.0.0.0", port), AlrisHandler).serve_forever()
