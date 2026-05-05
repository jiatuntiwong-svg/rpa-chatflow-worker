# RPA Chatflow on Cloudflare Workers

This folder is the Cloudflare Workers version of the local Python app. It keeps the admin UI and API shape, but stores runtime data in D1 and uploaded images in R2.

## What Runs Where

- Worker: webhook, Messenger replies, admin API, Facebook OAuth callback
- D1: flow JSON, subscribers, event logs, webhook logs, connected page tokens
- R2: uploaded image assets for image message blocks
- Worker Assets: `public/index.html`, `public/static/app.js`, `public/static/styles.css`

## First Setup

Install Wrangler on the machine you deploy from:

```powershell
npm install -g wrangler
wrangler login
```

Create D1 and R2:

```powershell
wrangler d1 create rpa-chatflow-db
wrangler r2 bucket create rpa-chatflow-uploads
```

Copy the D1 `database_id` into `wrangler.jsonc`, then create the tables:

```powershell
wrangler d1 execute rpa-chatflow-db --file .\schema\schema.sql
```

Set secrets. Do not put these in git:

```powershell
wrangler secret put FACEBOOK_APP_SECRET
wrangler secret put PAGE_ACCESS_TOKEN
```

`PAGE_ACCESS_TOKEN` is optional after Facebook OAuth connect works, but useful as a fallback while testing.

Update `wrangler.jsonc`:

- `VERIFY_TOKEN`: use the same verify token in Meta Webhook settings
- `FACEBOOK_APP_ID`: your Meta app ID
- `PUBLIC_BASE_URL`: the deployed Worker URL
- `database_id`: the D1 ID from `wrangler d1 create`

Deploy:

```powershell
wrangler deploy
```

## Deploy Through GitHub

This repository includes `.github/workflows/deploy-cloudflare-worker.yml`. It deploys the Worker when changes are pushed to `main` under `cloudflare-worker/`, and it can also be run manually from the GitHub Actions tab.

Before the first run, create these Cloudflare resources once:

```powershell
wrangler d1 create rpa-chatflow-db
wrangler r2 bucket create rpa-chatflow-uploads
```

In GitHub, add these repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
D1_DATABASE_ID
FACEBOOK_APP_SECRET
PAGE_ACCESS_TOKEN
VERIFY_TOKEN
```

`PAGE_ACCESS_TOKEN` can be empty or omitted after Facebook OAuth connect works. The deploy workflow only syncs it when it has a value.

Add these repository variables:

```text
FACEBOOK_APP_ID
PUBLIC_BASE_URL
GRAPH_API_VERSION
R2_BUCKET_NAME
```

Recommended values:

```text
GRAPH_API_VERSION=v25.0
R2_BUCKET_NAME=rpa-chatflow-uploads
PUBLIC_BASE_URL=https://YOUR_WORKER_URL
```

The workflow writes the deploy-time `database_id`, R2 bucket name, and public Worker vars into `wrangler.jsonc` only inside the GitHub runner. Secrets are sent to Cloudflare with `wrangler secret put` and are not committed to git.

## Meta Settings

After deploy, use these URLs in Meta:

- Webhook callback URL: `https://YOUR_WORKER_URL/webhook`
- Verify token: value from `VERIFY_TOKEN`
- OAuth redirect URI: `https://YOUR_WORKER_URL/auth/facebook/callback`
- Connect page screen for page owner: `https://YOUR_WORKER_URL/connect-facebook`

Webhook subscribed fields:

- `messages`
- `messaging_postbacks`
- `message_echoes`
- `standby`
- `messaging_handovers`

## Local Development

Wrangler can run the Worker locally:

```powershell
wrangler dev
```

For D1 local testing:

```powershell
wrangler d1 execute rpa-chatflow-db --local --file .\schema\schema.sql
wrangler dev --local
```

## Notes

- The Python app at the repository root is left intact.
- The admin UI was copied into `cloudflare-worker/public`, so deploys do not depend on the Python server.
- Image upload endpoint is available at `POST /api/uploads`, and uploaded files are served from `/uploads/<key>`.
