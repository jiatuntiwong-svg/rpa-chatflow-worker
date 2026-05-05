# Install RPA Chatflow on another machine

## Requirements

- Python 3.11+
- Optional: `cloudflared` for public HTTPS during testing

The app uses only the Python standard library.

For Cloudflare Workers deployment, use the separate Worker project in `cloudflare-worker/`.

## 1. Copy the project

Use the export script on the source machine:

```powershell
.\scripts\export-project.ps1
```

Move the generated zip from `exports/` to the target machine and extract it.

## 2. Configure environment

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```text
HOST=127.0.0.1
PORT=8000
VERIFY_TOKEN=your-verify-token
PAGE_ACCESS_TOKEN=
GRAPH_API_VERSION=v19.0
FACEBOOK_APP_ID=your-app-id
FACEBOOK_APP_SECRET=your-app-secret
PUBLIC_BASE_URL=https://your-public-host
DATA_DIR=data
FLOW_PATH=data/flows.json
```

`PAGE_ACCESS_TOKEN` can stay empty if pages are connected through `/connect-facebook`.

## 3. Run

```powershell
python app.py
```

or:

```powershell
.\scripts\run.ps1
```

Open:

```text
http://127.0.0.1:8000
```

## 4. Public HTTPS

For temporary testing:

```powershell
cloudflared tunnel --url http://127.0.0.1:8000
```

Use the generated URL as `PUBLIC_BASE_URL`, update Meta redirect URLs, and restart `python app.py`.

## 5. Meta settings

Webhook callback:

```text
https://your-public-host/webhook
```

OAuth redirect URI:

```text
https://your-public-host/auth/facebook/callback
```

Connect page URL:

```text
https://your-public-host/connect-facebook
```

## 6. Move existing data

To move existing connected pages, subscribers, and logs, copy:

```text
data/chatflow.sqlite3
```

To move only the flow, copy:

```text
data/flows.json
```

## 7. Deploy to Cloudflare Workers

Use the Worker/D1/R2 version in:

```text
cloudflare-worker/
```

Read `cloudflare-worker/README.md` for the exact Wrangler commands. The deployed Worker replaces the local tunnel URL with permanent endpoints:

```text
https://your-worker-url/webhook
https://your-worker-url/connect-facebook
https://your-worker-url/auth/facebook/callback
```
