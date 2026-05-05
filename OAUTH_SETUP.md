# Facebook Page OAuth Setup

This lets a Page owner connect their Facebook Page without manually creating a Page Access Token in Graph API Explorer.

## 1. Configure `.env`

Add these values:

```text
FACEBOOK_APP_ID=Meta App ID
FACEBOOK_APP_SECRET=Meta App Secret
PUBLIC_BASE_URL=https://your-current-tunnel.trycloudflare.com
```

`PUBLIC_BASE_URL` must be the current public Cloudflare URL without a trailing slash.

## 2. Configure Meta OAuth

In Meta Developer, add this Valid OAuth Redirect URI:

```text
https://your-current-tunnel.trycloudflare.com/auth/facebook/callback
```

If the Cloudflare quick tunnel URL changes, update both `.env` and the Meta redirect URI.

## 3. Send Connect Link

Send this URL to the Page owner:

```text
https://your-current-tunnel.trycloudflare.com/connect-facebook
```

After the owner authorizes the app, the system stores the Page Access Token and subscribes the Page to:

```text
messages,messaging_postbacks
```
