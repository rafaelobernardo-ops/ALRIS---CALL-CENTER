#!/usr/bin/env python3
"""
ALRIS — Canal de Atendimento
Servidor Backend & API Local (Python)
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class AlrisHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "ALRIS Call Center"}).encode("utf-8"))
            return
        if self.path == "/api/plans":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            plans = [
                {"id": "starter", "name": "Plano Starter", "price": 149, "seats": 1},
                {"id": "pro", "name": "Plano Pro Growth", "price": 299, "seats": 5},
                {"id": "enterprise", "name": "Plano Enterprise Scale", "price": 699, "seats": 99},
            ]
            self.wfile.write(json.dumps(plans, ensure_ascii=False).encode("utf-8"))
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"ALRIS Backend rodando em http://localhost:{port}/")
    ThreadingHTTPServer(("0.0.0.0", port), AlrisHandler).serve_forever()
