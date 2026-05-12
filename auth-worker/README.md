# Auth Worker — Google OAuth Refresh Token Flow

Cloudflare Worker that handles the Google OAuth authorization code flow for persistent Google Drive login in UkraTimer.

## Setup

### 1. Create the KV namespace

```bash
cd auth-worker
wrangler kv namespace create AUTH_SESSIONS
```

Copy the returned `id` and paste it into `wrangler.toml` → `[[kv_namespaces]]` → `id`.

### 2. Set the client secret

```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```

Paste your Google OAuth client secret when prompted. This is never stored in code.

### 3. Add the callback URL to Google Cloud Console

Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).

Edit your OAuth 2.0 Client ID and add this authorized redirect URI:

```
https://ukratimer-auth.zukrainak47.workers.dev/auth/callback
```

### 4. Deploy

```bash
wrangler deploy
```

The Worker will be live at `https://ukratimer-auth.zukrainak47.workers.dev`.

## Endpoints

| Method | Path             | Description                                                        |
|--------|------------------|--------------------------------------------------------------------|
| GET    | `/auth/start`    | Redirects to Google consent screen                                  |
| GET    | `/auth/callback` | Exchanges auth code for tokens, redirects with session ID in hash   |
| GET    | `/auth/token`    | Returns a fresh access token (reads session from `Authorization` header) |
| POST   | `/auth/logout`   | Deletes the KV session entry and clears the legacy cookie           |

## Environment

| Variable              | Type   | Description                                     |
|-----------------------|--------|-------------------------------------------------|
| `GOOGLE_CLIENT_ID`    | var    | OAuth client ID (in wrangler.toml)               |
| `GOOGLE_CLIENT_SECRET`| secret | OAuth client secret (via `wrangler secret put`)  |
| `ALLOWED_ORIGINS`     | var    | Comma-separated CORS origins                     |
| `APP_URL`             | var    | Default redirect URL after auth                  |
| `AUTH_SESSIONS`        | KV     | KV namespace for refresh token storage           |

## Free Plan Usage

- ~1 Worker request per page load (session restore)
- ~1 KV read per page load
- KV writes only on connect/logout (~2 per session)
- Well within 100k requests/day and 100k KV reads/day free limits
