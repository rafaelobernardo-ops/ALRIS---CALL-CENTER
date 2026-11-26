#!/usr/bin/env python3
"""
ALRIS — Canal de Atendimento
Servidor Backend & API Local (Python)
Inclui simulador SMTP e geração de tokens seguros de confirmação de e-mail.
"""
import json
import os
import secrets
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verifications.json")

# Banco local em memória / JSON persistido
def load_db():
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"users": {}, "tokens": {}}
    return {"users": {}, "tokens": {}}

def save_db(db):
    try:
        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[ALRIS Backend] Erro ao salvar banco local: {e}")

class AlrisHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def _send_json(self, status_code, payload):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            return self._send_json(200, {
                "status": "ok",
                "service": "ALRIS Call Center Backend",
                "engine": "Carbon.ai / Gemini Core"
            })

        if parsed.path == "/api/plans":
            plans = [
                {"id": "starter", "name": "Plano Starter", "price": 149, "seats": 1},
                {"id": "pro", "name": "Plano Pro Growth", "price": 299, "seats": 5},
                {"id": "enterprise", "name": "Plano Enterprise Scale", "price": 699, "seats": 99},
            ]
            return self._send_json(200, plans)

        # Endpoint de validação de token de e-mail
        if parsed.path == "/api/verify-email":
            query_params = parse_qs(parsed.query)
            token = query_params.get("token", [None])[0]
            if not token:
                return self._send_json(400, {"success": False, "error": "Token não fornecido."})

            db = load_db()
            token_data = db.get("tokens", {}).get(token)
            if not token_data:
                return self._send_json(404, {"success": False, "error": "Token de confirmação inválido ou já utilizado."})

            if token_data.get("expires_at", 0) < time.time():
                return self._send_json(410, {"success": False, "error": "Token de confirmação expirado. Solicite novo cadastro."})

            email = token_data["email"]
            if email in db["users"]:
                db["users"][email]["verified"] = True
                db["users"][email]["verified_at"] = int(time.time())

            # Remove token após uso
            del db["tokens"][token]
            save_db(db)

            # Redireciona para o portal com flag de verificado
            self.send_response(302)
            self.send_header("Location", f"/?verified=1&email={email}")
            self.end_headers()
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/register-admin":
            length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(length)
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                return self._send_json(400, {"success": False, "error": "JSON inválido."})

            company = data.get("company", "").strip()
            name = data.get("name", "").strip()
            email = data.get("email", "").strip().lower()
            phone = data.get("phone", "").strip()
            password = data.get("password", "")

            if not email or not name:
                return self._send_json(400, {"success": False, "error": "Nome e e-mail corporativo são obrigatórios."})

            # Gera token criptográfico seguro de 32 bytes (URL-safe)
            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + (24 * 3600)  # Válido por 24 horas

            host_header = self.headers.get("Host", "localhost:8080")
            verify_url = f"http://{host_header}/api/verify-email?token={token}"

            db = load_db()
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
                "created_at": int(time.time())
            }
            save_db(db)

            # Simulador SMTP / Envio Real caso variáveis SMTP existam
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

                    html_content = f"""
                    <div style="font-family: 'Plus Jakarta Sans', sans-serif; background: #0e1014; color: #ffffff; padding: 24px; border-radius: 12px;">
                        <h2 style="color: #ffffff;">Bem-vindo à ALRIS, {name}!</h2>
                        <p style="color: #94a3b8;">Sua empresa <strong>{company}</strong> foi pré-cadastrada no canal de atendimento.</p>
                        <p style="color: #94a3b8;">Clique no botão abaixo para confirmar seu e-mail corporativo e ativar seu código de equipe:</p>
                        <a href="{verify_url}" style="display: inline-block; background: #ffffff; color: #0e1014; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">Confirmar E-mail</a>
                        <p style="font-size: 11px; color: #64748b;">Link válido por 24 horas: {verify_url}</p>
                    </div>
                    """
                    msg.attach(MIMEText(html_content, "html"))

                    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                        server.starttls()
                        if smtp_user and smtp_pass:
                            server.login(smtp_user, smtp_pass)
                        server.sendmail(msg["From"], [email], msg.as_string())
                    email_sent_real = True
                except Exception as e:
                    print(f"[ALRIS SMTP] Falha no envio SMTP real, usando simulador local: {e}")

            print("=" * 60)
            print(f"[ALRIS SIMULADOR SMTP] E-mail de confirmação gerado para: {email}")
            print(f"[ALRIS SIMULADOR SMTP] Link de Verificação: {verify_url}")
            print(f"[ALRIS SIMULADOR SMTP] Token Seguro: {token}")
            print(f"[ALRIS SIMULADOR SMTP] Status: {'Enviado via SMTP' if email_sent_real else 'Simulado no Console Local'}")
            print("=" * 60)

            return self._send_json(200, {
                "success": True,
                "message": f"Link de confirmação enviado para {email}.",
                "verification_url": verify_url,
                "token": token,
                "simulated": not email_sent_real,
                "info": "Token seguro registrado. Acesse o link para validar a conta."
            })

        self._send_json(404, {"error": "Endpoint não encontrado."})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"ALRIS Backend rodando em http://localhost:{port}/")
    ThreadingHTTPServer(("0.0.0.0", port), AlrisHandler).serve_forever()
