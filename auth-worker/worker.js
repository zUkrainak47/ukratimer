const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SESSION_COOKIE_NAME = 'ukratimer_auth_session';
const SESSION_TTL_SECONDS = 400 * 24 * 60 * 60; // 400 days

function getAllowedOrigins(env) {
    const raw = String(env.ALLOWED_ORIGINS || '');
    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
    if (!origin) return false;
    return getAllowedOrigins(env).includes(origin);
}

function getCorsOrigin(request, env) {
    const origin = request.headers.get('Origin') || '';
    return isAllowedOrigin(origin, env) ? origin : '';
}

function corsHeaders(request, env) {
    const origin = getCorsOrigin(request, env);
    if (!origin) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function jsonResponse(body, status, request, env) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders(request, env),
        },
    });
}

function getCallbackUrl(env, request) {
    const url = new URL(request.url);
    return `${url.origin}/auth/callback`;
}

function buildSessionCookie(sessionId, { clear = false } = {}) {
    const maxAge = clear ? 0 : SESSION_TTL_SECONDS;
    const value = clear ? '' : sessionId;
    return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

function getSessionIdFromCookie(request) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`)
    );
    return match ? match[1].trim() : '';
}

// Read session ID from Authorization header first, fall back to cookie
// for backward compatibility with existing sessions.
function getSessionId(request) {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) return token;
    }
    return getSessionIdFromCookie(request);
}

// ─── /auth/start ───
// Redirects to Google's OAuth consent screen.
async function handleAuthStart(request, env) {
    const url = new URL(request.url);
    const appRedirect = url.searchParams.get('redirect_uri') || env.APP_URL || '';

    const state = btoa(JSON.stringify({ redirect: appRedirect }));
    const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: getCallbackUrl(env, request),
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
    });

    return Response.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
}

// ─── /auth/callback ───
// Exchanges the authorization code for tokens, stores the refresh token in KV,
// sets a session cookie, and redirects back to the app.
async function handleAuthCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';
    const stateRaw = url.searchParams.get('state') || '';
    const error = url.searchParams.get('error') || '';

    // Parse redirect from state, but only allow origins on the allowlist.
    let appRedirect = env.APP_URL || '';
    try {
        const stateData = JSON.parse(atob(stateRaw));
        if (stateData.redirect) {
            const redirectOrigin = new URL(stateData.redirect).origin;
            if (isAllowedOrigin(redirectOrigin, env)) {
                appRedirect = stateData.redirect;
            }
        }
    } catch (_) {
        // Fall back to default APP_URL.
    }

    if (error) {
        const errorUrl = new URL(appRedirect);
        errorUrl.searchParams.set('auth_error', error);
        return Response.redirect(errorUrl.toString(), 302);
    }

    if (!code) {
        const errorUrl = new URL(appRedirect);
        errorUrl.searchParams.set('auth_error', 'missing_code');
        return Response.redirect(errorUrl.toString(), 302);
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: getCallbackUrl(env, request),
            grant_type: 'authorization_code',
        }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.refresh_token) {
        console.error('[auth-worker] Token exchange failed.', {
            status: tokenResponse.status,
            error: tokenData.error || '',
            description: tokenData.error_description || '',
        });
        const errorUrl = new URL(appRedirect);
        errorUrl.searchParams.set(
            'auth_error',
            tokenData.error || 'token_exchange_failed'
        );
        return Response.redirect(errorUrl.toString(), 302);
    }

    // Store refresh token in KV
    const sessionId = crypto.randomUUID();
    await env.AUTH_SESSIONS.put(sessionId, tokenData.refresh_token, {
        expirationTtl: SESSION_TTL_SECONDS,
    });

    // Redirect back to the app with the session ID in the URL hash.
    // Using a fragment (not a query param) so it never appears in
    // server logs, Referer headers, or browser history entries.
    const redirectUrl = new URL(appRedirect);
    redirectUrl.searchParams.set('auth_success', '1');

    const locationWithHash = `${redirectUrl.toString()}#auth_session=${sessionId}`;

    return new Response(null, {
        status: 302,
        headers: {
            Location: locationWithHash,
            // Also set a cookie for backward compatibility.
            'Set-Cookie': buildSessionCookie(sessionId),
        },
    });
}

// ─── /auth/token ───
// Returns a fresh access token by refreshing via the stored refresh token.
async function handleAuthToken(request, env) {
    const sessionId = getSessionId(request);
    if (!sessionId) {
        return jsonResponse({ error: 'no_session' }, 401, request, env);
    }

    const refreshToken = await env.AUTH_SESSIONS.get(sessionId);
    if (!refreshToken) {
        // Session expired or was deleted. Clear the stale cookie.
        return new Response(
            JSON.stringify({ error: 'session_expired' }),
            {
                status: 401,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Set-Cookie': buildSessionCookie('', { clear: true }),
                    ...corsHeaders(request, env),
                },
            }
        );
    }

    // Refresh the access token
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
        console.error('[auth-worker] Token refresh failed.', {
            status: tokenResponse.status,
            error: tokenData.error || '',
            description: tokenData.error_description || '',
        });

        // If the refresh token is revoked/expired, clean up
        if (tokenData.error === 'invalid_grant') {
            await env.AUTH_SESSIONS.delete(sessionId);
            return new Response(
                JSON.stringify({ error: 'refresh_token_revoked' }),
                {
                    status: 401,
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Set-Cookie': buildSessionCookie('', { clear: true }),
                        ...corsHeaders(request, env),
                    },
                }
            );
        }

        return jsonResponse(
            { error: tokenData.error || 'token_refresh_failed' },
            502,
            request,
            env
        );
    }

    return jsonResponse(
        {
            access_token: tokenData.access_token,
            expires_in: tokenData.expires_in || 3600,
        },
        200,
        request,
        env
    );
}

// ─── /auth/logout ───
// Clears the session cookie and deletes the KV entry.
async function handleAuthLogout(request, env) {
    const sessionId = getSessionId(request);

    if (sessionId) {
        await env.AUTH_SESSIONS.delete(sessionId);
    }

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': buildSessionCookie('', { clear: true }),
            ...corsHeaders(request, env),
        },
    });
}

// ─── OPTIONS (CORS preflight) ───
function handleOptions(request, env) {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
    });
}

// ─── Main fetch handler ───
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return handleOptions(request, env);
        }

        try {
            if (path === '/auth/start' && request.method === 'GET') {
                return await handleAuthStart(request, env);
            }

            if (path === '/auth/callback' && request.method === 'GET') {
                return await handleAuthCallback(request, env);
            }

            if (path === '/auth/token' && request.method === 'GET') {
                return await handleAuthToken(request, env);
            }

            if (path === '/auth/logout' && request.method === 'POST') {
                return await handleAuthLogout(request, env);
            }

            return new Response('Not found.', { status: 404 });
        } catch (error) {
            console.error('[auth-worker] Unhandled error.', {
                path,
                message: error?.message || String(error),
            });
            return jsonResponse(
                { error: 'internal_error' },
                500,
                request,
                env
            );
        }
    },
};
