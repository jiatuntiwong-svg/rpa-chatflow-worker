from __future__ import annotations

import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse as url_encode
from urllib import request as url_request
from urllib.parse import parse_qs, urlparse

from chatbot.config import Settings
from chatbot.db import Database
from chatbot.facebook_oauth import FacebookOAuth
from chatbot.flow_engine import FlowEngine
from chatbot.messenger import MessengerClient


ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"

settings = Settings.from_env()
DATA_DIR = Path(settings.data_dir)
if not DATA_DIR.is_absolute():
    DATA_DIR = ROOT / DATA_DIR
FLOW_PATH = Path(settings.flow_path)
if not FLOW_PATH.is_absolute():
    FLOW_PATH = ROOT / FLOW_PATH
db = Database(DATA_DIR / "chatflow.sqlite3")
messenger = MessengerClient(settings.page_access_token, settings.graph_api_version)
facebook_oauth = FacebookOAuth(settings.facebook_app_id, settings.facebook_app_secret, settings.graph_api_version)
flow_engine = FlowEngine(FLOW_PATH)


class ChatflowHandler(BaseHTTPRequestHandler):
    server_version = "RPAChatflow/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/webhook":
            self.record_webhook_hit(parsed, "")
            self.handle_verify(parsed.query)
            return
        if parsed.path == "/api/flows":
            self.send_json(flow_engine.reload())
            return
        if parsed.path == "/api/subscribers":
            self.send_json({"subscribers": db.list_subscribers()})
            return
        if parsed.path == "/api/events":
            self.send_json({"events": db.list_events(limit=100)})
            return
        if parsed.path == "/api/webhook-requests":
            self.send_json({"requests": db.list_webhook_requests(limit=100)})
            return
        if parsed.path == "/api/connected-pages":
            self.send_json({"pages": db.list_connected_pages()})
            return
        if parsed.path == "/api/page-conversations":
            self.handle_page_conversations(parsed.query)
            return
        if parsed.path == "/connect-facebook":
            self.handle_connect_page()
            return
        if parsed.path == "/auth/facebook/start":
            self.handle_facebook_start()
            return
        if parsed.path == "/auth/facebook/callback":
            self.handle_facebook_callback(parsed.query)
            return
        if parsed.path in ("/", "/index.html"):
            self.send_static("index.html", "text/html; charset=utf-8")
            return
        if parsed.path.startswith("/static/"):
            self.handle_static(parsed.path.removeprefix("/static/"))
            return
        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/webhook":
            raw_body = self.read_body()
            self.record_webhook_hit(parsed, raw_body)
            self.handle_webhook(raw_body)
            return
        if parsed.path == "/api/broadcast":
            self.handle_broadcast()
            return
        if parsed.path == "/api/test-send":
            self.handle_test_send()
            return
        self.send_error(404, "Not found")

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/flows":
            self.handle_save_flow()
            return
        self.send_error(404, "Not found")

    def handle_verify(self, query: str) -> None:
        params = parse_qs(query)
        mode = first(params, "hub.mode")
        token = first(params, "hub.verify_token")
        challenge = first(params, "hub.challenge")
        if mode == "subscribe" and token == settings.verify_token:
            self.send_text(challenge or "")
            return
        self.send_error(403, "Webhook verification failed")

    def handle_webhook(self, raw_body: str) -> None:
        try:
            payload = json.loads(raw_body or "{}")
        except json.JSONDecodeError as exc:
            db.record_event("unknown", "webhook_error", "Invalid JSON", {"error": str(exc), "body": raw_body})
            self.send_json({"status": "invalid_json"}, status=400)
            return

        db.record_event("webhook", "webhook_post", ",".join(event_types(payload)) or "unknown", payload)

        for event in extract_messaging_events(payload):
            sender_id = event.get("sender", {}).get("id")
            if not sender_id:
                continue

            text = event.get("message", {}).get("text")
            postback = event.get("postback", {}).get("payload")
            page_id = event.get("recipient", {}).get("id")
            message_text = text or postback or ""

            is_first_time = db.upsert_subscriber(sender_id)
            db.record_event(sender_id, "inbound", message_text, event)

            current_state = db.get_state(sender_id)
            response, next_state = flow_engine.reply(message_text, current_state, is_first_time=is_first_time)
            db.set_state(sender_id, next_state)

            for outgoing in response:
                try:
                    page_token = db.get_page_token(page_id)
                    result = messenger.send(sender_id, outgoing, page_token)
                    db.record_event(sender_id, "outbound", outgoing.get("text", ""), result)
                except Exception as exc:
                    db.record_event(
                        sender_id,
                        "outbound_error",
                        outgoing.get("text", ""),
                        {"error": str(exc), "outgoing": outgoing},
                    )

        self.send_json({"status": "ok"})

    def handle_connect_page(self) -> None:
        pages = db.list_connected_pages()
        page_items = "".join(
            f"<li><strong>{escape_html(page['name'])}</strong><br><span>{escape_html(page['page_id'])}</span></li>"
            for page in pages
        )
        if not page_items:
            page_items = "<li>ยังไม่มีเพจที่เชื่อมต่อ</li>"

        missing = []
        if not settings.facebook_app_id:
            missing.append("FACEBOOK_APP_ID")
        if not settings.facebook_app_secret:
            missing.append("FACEBOOK_APP_SECRET")
        if not settings.public_base_url:
            missing.append("PUBLIC_BASE_URL")
        warning = ""
        if missing:
            warning = f"<p class='warning'>ต้องตั้งค่าใน .env ก่อน: {', '.join(missing)}</p>"

        html = f"""
        <!doctype html>
        <html lang="th">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Connect Facebook Page</title>
            <link rel="stylesheet" href="/static/styles.css" />
          </head>
          <body>
            <main class="connect-page">
              <section class="connect-card">
                <h1>Connect Facebook Page</h1>
                <p>ให้เจ้าของเพจกดเชื่อมต่อเพื่ออนุญาตให้ระบบรับข้อความและตอบกลับผ่าน Messenger</p>
                {warning}
                <a class="primary-link" href="/auth/facebook/start">Connect Facebook</a>
                <h2>Connected Pages</h2>
                <ul class="connected-list">{page_items}</ul>
              </section>
            </main>
          </body>
        </html>
        """
        self.send_bytes(html.encode("utf-8"), "text/html; charset=utf-8")

    def handle_facebook_start(self) -> None:
        if not settings.facebook_app_id or not settings.facebook_app_secret or not settings.public_base_url:
            self.send_error(500, "FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and PUBLIC_BASE_URL are required")
            return
        state = secrets.token_urlsafe(24)
        db.save_oauth_state(state)
        self.redirect(facebook_oauth.authorization_url(settings.oauth_redirect_uri, state))

    def handle_facebook_callback(self, query: str) -> None:
        params = parse_qs(query)
        error = first(params, "error_message") or first(params, "error")
        if error:
            self.send_text(f"Facebook authorization failed: {error}", status=400)
            return

        state = first(params, "state") or ""
        code = first(params, "code") or ""
        if not code:
            self.send_error(400, "Invalid OAuth callback: missing code. Open /connect-facebook first.")
            return
        if not state:
            self.send_error(400, "Invalid OAuth callback: missing state. Open /connect-facebook first.")
            return
        if not db.consume_oauth_state(state):
            self.send_error(
                400,
                "Invalid OAuth callback: state was not found or was already used. Start again from /connect-facebook.",
            )
            return

        try:
            user_token = facebook_oauth.exchange_code(settings.oauth_redirect_uri, code)
            pages = facebook_oauth.list_pages(user_token)
            connected = []
            for page in pages:
                page_id = str(page.get("id", ""))
                page_token = str(page.get("access_token", ""))
                tasks = page.get("tasks", [])
                if not page_id or not page_token:
                    continue
                db.save_connected_page(page_id, page.get("name", "Untitled Page"), page_token, tasks)
                subscribe_result = facebook_oauth.subscribe_page(page_id, page_token)
                connected.append({**page, "subscribe_result": subscribe_result})
        except Exception as exc:
            db.record_event("oauth", "oauth_error", "Facebook OAuth failed", {"error": str(exc)})
            self.send_text(f"Facebook OAuth failed: {exc}", status=500)
            return

        items = "".join(
            f"<li><strong>{escape_html(page.get('name', 'Untitled Page'))}</strong><br><span>{escape_html(page.get('id', ''))}</span></li>"
            for page in connected
        )
        if not items:
            items = "<li>ไม่พบเพจที่มีสิทธิ์เชื่อมต่อ</li>"
        html = f"""
        <!doctype html>
        <html lang="th">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Facebook Connected</title>
            <link rel="stylesheet" href="/static/styles.css" />
          </head>
          <body>
            <main class="connect-page">
              <section class="connect-card">
                <h1>เชื่อมต่อสำเร็จ</h1>
                <p>ระบบบันทึก Page Access Token และ subscribe webhook fields ให้แล้ว</p>
                <ul class="connected-list">{items}</ul>
                <a class="primary-link" href="/">กลับหน้า Admin</a>
              </section>
            </main>
          </body>
        </html>
        """
        self.send_bytes(html.encode("utf-8"), "text/html; charset=utf-8")

    def handle_save_flow(self) -> None:
        payload = self.read_json()
        try:
            saved = flow_engine.save(payload)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
            return
        self.send_json(saved)

    def handle_broadcast(self) -> None:
        payload = self.read_json()
        message = str(payload.get("message", "")).strip()
        if not message:
            self.send_json({"error": "message is required"}, status=400)
            return

        sent = 0
        for subscriber in db.list_subscribers():
            psid = subscriber["psid"]
            result = messenger.send(psid, {"type": "text", "text": message})
            db.record_event(psid, "broadcast", message, result)
            sent += 1
        self.send_json({"status": "ok", "sent": sent})

    def handle_page_conversations(self, query: str) -> None:
        params = parse_qs(query)
        page = db.get_connected_page(first(params, "page_id"))
        if not page:
            self.send_json({"error": "No connected page"}, status=404)
            return

        limit = first(params, "limit") or "10"
        graph_params = url_encode.urlencode(
            {
                "fields": "id,updated_time,participants,snippet",
                "limit": limit,
                "access_token": page["access_token"],
            }
        )
        url = f"https://graph.facebook.com/{settings.graph_api_version}/{page['page_id']}/conversations?{graph_params}"
        try:
            data = get_graph_json(url)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=502)
            return

        conversations = []
        for item in data.get("data", []):
            participants = item.get("participants", {}).get("data", [])
            customer = next((p for p in participants if str(p.get("id")) != str(page["page_id"])), None)
            conversations.append(
                {
                    "id": item.get("id"),
                    "updated_time": item.get("updated_time"),
                    "snippet": item.get("snippet", ""),
                    "customer": {
                        "id": customer.get("id") if customer else "",
                        "name": customer.get("name") if customer else "Unknown",
                    },
                }
            )
        self.send_json({"page": {"page_id": page["page_id"], "name": page["name"]}, "conversations": conversations})

    def handle_test_send(self) -> None:
        payload = self.read_json()
        psid = str(payload.get("psid", "")).strip()
        message = str(payload.get("message", "")).strip()
        page = db.get_connected_page(str(payload.get("page_id", "")).strip() or None)
        if not page:
            self.send_json({"error": "No connected page"}, status=404)
            return
        if not psid or not message:
            self.send_json({"error": "psid and message are required"}, status=400)
            return
        try:
            result = messenger.send(psid, {"type": "text", "text": message}, page["access_token"])
        except Exception as exc:
            db.record_event(psid, "test_send_error", message, {"error": str(exc)})
            self.send_json({"error": str(exc)}, status=502)
            return
        db.record_event(psid, "test_send", message, result)
        self.send_json({"status": "ok", "result": result})

    def handle_static(self, name: str) -> None:
        content_types = {
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
        }
        path = STATIC_DIR / name
        if not path.is_file() or STATIC_DIR not in path.resolve().parents:
            self.send_error(404, "Not found")
            return
        self.send_bytes(path.read_bytes(), content_types.get(path.suffix, "application/octet-stream"))

    def send_static(self, name: str, content_type: str) -> None:
        path = STATIC_DIR / name
        self.send_bytes(path.read_bytes(), content_type)

    def record_webhook_hit(self, parsed, body: str) -> None:
        db.record_webhook_request(
            self.command,
            parsed.path,
            parsed.query,
            {key: value for key, value in self.headers.items()},
            body,
        )

    def read_body(self) -> str:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length).decode("utf-8") if length else ""

    def read_json(self) -> dict:
        raw = self.read_body() or "{}"
        return json.loads(raw or "{}")

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_bytes(body, "application/json; charset=utf-8", status)

    def send_text(self, text: str, status: int = 200) -> None:
        self.send_bytes(text.encode("utf-8"), "text/plain; charset=utf-8", status)

    def send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, url: str) -> None:
        self.send_response(302)
        self.send_header("Location", url)
        self.end_headers()


def first(params: dict[str, list[str]], key: str) -> str | None:
    values = params.get(key)
    return values[0] if values else None


def extract_messaging_events(payload: dict) -> list[dict]:
    events: list[dict] = []
    for entry in payload.get("entry", []):
        events.extend(entry.get("messaging", []))
        events.extend(entry.get("standby", []))
    return events


def event_types(payload: dict) -> list[str]:
    names = []
    for entry in payload.get("entry", []):
        for key in ("messaging", "standby", "messaging_handovers"):
            if entry.get(key):
                names.append(key)
    return names


def escape_html(value: object) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#039;")
    )


def get_graph_json(url: str) -> dict:
    with url_request.urlopen(url, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    db.initialize()
    flow_engine.ensure_seed()
    server = ThreadingHTTPServer((settings.host, settings.port), ChatflowHandler)
    print(f"RPA Chatflow running at http://{settings.host}:{settings.port}")
    print(f"Webhook endpoint: http://{settings.host}:{settings.port}/webhook")
    server.serve_forever()


if __name__ == "__main__":
    main()
