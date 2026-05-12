const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const DEFAULT_SAVE_FILENAME = 'ukratimer-save.json';
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 60 * 1000;

let accessToken = '';
let accessTokenExpiresAt = 0;
let pendingTokenRequest = null;

function getAuthWorkerUrl() {
    return document.querySelector('meta[name="google-drive-auth-worker-url"]')?.content?.trim() || '';
}

function getGoogleDriveClientId() {
    return document.querySelector('meta[name="google-drive-client-id"]')?.content?.trim() || '';
}

function getGoogleDriveSaveFilename() {
    return DEFAULT_SAVE_FILENAME;
}

export function isGoogleDriveSyncConfigured() {
    return Boolean(getAuthWorkerUrl()) && Boolean(getGoogleDriveClientId());
}

export function hasGoogleDriveSession() {
    if (accessTokenExpiresAt && Date.now() >= accessTokenExpiresAt - ACCESS_TOKEN_SAFETY_WINDOW_MS) {
        clearGoogleDriveSession();
        return false;
    }

    return Boolean(accessToken) && Date.now() < accessTokenExpiresAt - ACCESS_TOKEN_SAFETY_WINDOW_MS;
}

function clearGoogleDriveSession() {
    accessToken = '';
    accessTokenExpiresAt = 0;
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function mapDriveError(status, text) {
    if (status === 401) return 'Google session expired. Please connect again.';
    if (status === 403) return 'Google Drive access was denied for this account.';
    if (status === 404) return 'Cloud backup file was not found.';

    try {
        const parsed = JSON.parse(text);
        const apiMessage = parsed?.error?.message;
        if (apiMessage) return apiMessage;
    } catch (_) {
        // Ignore JSON parse failures and fall back to status text.
    }

    return text || `Google Drive request failed (${status}).`;
}

// Fetch a fresh access token from the auth Worker.
// The Worker reads the HttpOnly session cookie, looks up the stored
// refresh token in KV, and returns a new short-lived access token.
async function fetchAccessTokenFromWorker() {
    const workerUrl = getAuthWorkerUrl();
    if (!workerUrl) {
        throw new Error('Google Drive sync is not configured.');
    }

    const response = await fetch(`${workerUrl}/auth/token`, {
        credentials: 'include',
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorCode = data?.error || '';

        if (errorCode === 'no_session' || errorCode === 'session_expired' || errorCode === 'refresh_token_revoked') {
            clearGoogleDriveSession();
            throw new Error('no_session');
        }

        throw new Error(errorCode || 'Failed to get access token.');
    }

    const data = await response.json();
    if (!data?.access_token) {
        throw new Error('Auth worker returned an empty access token.');
    }

    return data;
}

// Get a valid access token, refreshing from the Worker if needed.
// De-duplicates concurrent calls so only one Worker request is in flight.
async function requestGoogleDriveAccessToken() {
    if (!isGoogleDriveSyncConfigured()) {
        throw new Error('Google Drive sync is not configured. Add the auth worker URL and client ID first.');
    }

    if (hasGoogleDriveSession()) {
        return accessToken;
    }

    // De-duplicate: if a token request is already in flight, wait for it.
    if (pendingTokenRequest) {
        return await pendingTokenRequest;
    }

    pendingTokenRequest = fetchAccessTokenFromWorker()
        .then((data) => {
            accessToken = data.access_token;
            accessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
            pendingTokenRequest = null;
            return accessToken;
        })
        .catch((error) => {
            pendingTokenRequest = null;
            throw error;
        });

    return await pendingTokenRequest;
}

async function driveFetch(path, { method = 'GET', headers = {}, body = null, expectJson = true } = {}) {
    const token = await requestGoogleDriveAccessToken();
    const response = await fetch(path, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...headers,
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        if (response.status === 401) {
            clearGoogleDriveSession();
        }
        throw new Error(mapDriveError(response.status, text));
    }

    if (!expectJson) {
        return await response.text();
    }

    return await response.json();
}

async function listBackupFiles() {
    const query = `name='${escapeDriveQueryValue(getGoogleDriveSaveFilename())}' and 'appDataFolder' in parents`;
    const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'files(id,name,modifiedTime,size)',
        orderBy: 'modifiedTime desc',
        q: query,
    });

    const data = await driveFetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`);
    return Array.isArray(data?.files) ? data.files : [];
}

async function deleteBackupFile(fileId) {
    await driveFetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        expectJson: false,
    });
}

async function cleanupExtraBackupFiles(files) {
    const [, ...extras] = files;
    if (!extras.length) return;

    await Promise.allSettled(extras.map((file) => deleteBackupFile(file.id)));
}

function createMultipartUploadBody(content) {
    const boundary = `ukratimer-${Date.now().toString(36)}`;
    const metadata = {
        name: getGoogleDriveSaveFilename(),
        parents: ['appDataFolder'],
        mimeType: 'application/json',
    };

    const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        content,
        `--${boundary}--`,
        '',
    ].join('\r\n');

    return { body, boundary };
}

// ─── Public API ───
// These exported functions keep the same signatures that app.js expects.

export async function connectGoogleDrive() {
    const workerUrl = getAuthWorkerUrl();
    if (!workerUrl) {
        throw new Error('Google Drive sync is not configured.');
    }

    // Navigate the user to the auth Worker's /auth/start endpoint.
    // The Worker redirects to Google's consent screen, then back to the app
    // with a session cookie set. This is a full-page redirect.
    const redirectUri = encodeURIComponent(window.location.href);
    window.location.href = `${workerUrl}/auth/start?redirect_uri=${redirectUri}`;

    // Return a never-resolving promise since the page is about to navigate away.
    return new Promise(() => {});
}

export async function signOutOfGoogleDrive() {
    const workerUrl = getAuthWorkerUrl();

    // Clear the server-side session (cookie + KV entry).
    if (workerUrl) {
        try {
            await fetch(`${workerUrl}/auth/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (_) {
            // Best-effort. If the Worker is unreachable, we still clear locally.
        }
    }

    clearGoogleDriveSession();
}

export async function restoreGoogleDriveSession() {
    if (!isGoogleDriveSyncConfigured()) return false;
    if (hasGoogleDriveSession()) return true;

    try {
        await requestGoogleDriveAccessToken();
        return true;
    } catch (_) {
        return false;
    }
}

export async function getGoogleDriveBackupInfo() {
    if (!isGoogleDriveSyncConfigured()) {
        return {
            configured: false,
            connected: false,
            file: null,
        };
    }

    if (!hasGoogleDriveSession()) {
        return {
            configured: true,
            connected: false,
            file: null,
        };
    }

    const files = await listBackupFiles();
    await cleanupExtraBackupFiles(files);

    return {
        configured: true,
        connected: true,
        file: files[0] || null,
    };
}

export async function exportBackupToGoogleDrive(data) {
    const content = JSON.stringify(data, null, 2);
    const files = await listBackupFiles();
    const primaryFile = files[0] || null;

    let savedFile = null;

    if (primaryFile) {
        savedFile = await driveFetch(`${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(primaryFile.id)}?uploadType=media&fields=id,name,modifiedTime,size`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: content,
        });
    } else {
        const { body, boundary } = createMultipartUploadBody(content);
        savedFile = await driveFetch(`${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,modifiedTime,size`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
        });
    }

    await cleanupExtraBackupFiles(savedFile?.id ? [savedFile, ...files.filter((file) => file.id !== savedFile.id)] : files);

    return savedFile;
}

export async function importBackupFromGoogleDrive() {
    const files = await listBackupFiles();
    const [file] = files;

    if (!file) {
        throw new Error('No Google Drive backup was found for this account yet.');
    }

    await cleanupExtraBackupFiles(files);

    const text = await driveFetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}?alt=media`, {
        expectJson: false,
    });

    return { file, text };
}
