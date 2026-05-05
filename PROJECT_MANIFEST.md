# Project Manifest

## Portable source files

- `app.py`
- `chatbot/`
- `static/`
- `data/flows.json`
- `.env.example`
- `requirements.txt`
- `scripts/`
- `cloudflare-worker/`
- `INSTALL.md`
- `OAUTH_SETUP.md`
- `README.md`

## Local/runtime files

Do not share these unless you intentionally want to move the same live installation:

- `.env`
- `data/chatflow.sqlite3`
- `__pycache__/`
- `exports/`
- `*.msi`

## Moving modes

Fresh install:

- Move portable source files only
- Create a new `.env`
- Connect Facebook Page again via `/connect-facebook`

Clone current installation:

- Move portable source files
- Also move `.env`
- Also move `data/chatflow.sqlite3`
- Update `PUBLIC_BASE_URL` if the public URL changes
