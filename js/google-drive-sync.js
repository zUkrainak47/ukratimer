const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DEFAULT_SAVE_FILENAME = 'ukratimer-save.json';
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 60 * 1000;
const GOOGLE_DRIVE_AUTH_STATE_KEY = 'ukratimer_google_drive_authorized';
const GOOGLE_DRIVE_TOKEN_KEY = 'ukratimer_google_drive_access_token';
const GOOGLE_DRIVE_TOKEN_EXPIRY_KEY = 'ukratimer_google_drive_access_token_expiry';

let googleIdentityScriptPromise = null;
let accessToken = '';
let accessTokenExpiresAt = 0;

function getGoogleDriveClientId() {
    return document.querySelector('meta[name="google-drive-client-id"]')?.content?.trim() || '';
}

function getGoogleDriveSaveFilename() {
    return DEFAULT_SAVE_FILENAME;
}

function persistGoogleDriveSession() {
    try {
        if (!accessToken || !accessTokenExpiresAt) {
            localStorage.removeItem(GOOGLE_DRIVE_TOKEN_KEY);
            localStorage.removeItem(GOOGLE_DRIVE_TOKEN_EXPIRY_KEY);
            return;
        }

        localStorage.setItem(GOOGLE_DRIVE_TOKEN_KEY, accessToken);
        localStorage.setItem(GOOGLE_DRIVE_TOKEN_EXPIRY_KEY, String(accessTokenExpiresAt));
    } catch (_) {
        // Ignore storage failures and continue with the in-memory token only.
    }
}

function hydrateGoogleDriveSessionFromStorage() {
    if (accessToken && accessTokenExpiresAt) return;

    try {
        const storedToken = localStorage.getItem(GOOGLE_DRIVE_TOKEN_KEY) || '';
        const storedExpiry = Number(localStorage.getItem(GOOGLE_DRIVE_TOKEN_EXPIRY_KEY) || '0');

        if (!storedToken || !Number.isFinite(storedExpiry) || storedExpiry <= Date.now()) {
            localStorage.removeItem(GOOGLE_DRIVE_TOKEN_KEY);
            localStorage.removeItem(GOOGLE_DRIVE_TOKEN_EXPIRY_KEY);
            return;
        }

        accessToken = storedToken;
        accessTokenExpiresAt = storedExpiry;
    } catch (_) {
        // Ignore storage failures and fall back to the in-memory token.
    }
}

function rememberGoogleDriveAuthorization() {
    try {
        localStorage.setItem(GOOGLE_DRIVE_AUTH_STATE_KEY, '1');
    } catch (_) {
        // Ignore storage failures and fall back to the current-page session.
    }
}

function forgetGoogleDriveAuthorization() {
    try {
        localStorage.removeItem(GOOGLE_DRIVE_AUTH_STATE_KEY);
    } catch (_) {
        // Ignore storage failures.
    }
}

function wasGoogleDrivePreviouslyAuthorized() {
    try {
        return localStorage.getItem(GOOGLE_DRIVE_AUTH_STATE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

export function isGoogleDriveSyncConfigured() {
    return Boolean(getGoogleDriveClientId());
}

export function hasGoogleDriveSession() {
    hydrateGoogleDriveSessionFromStorage();

    if (accessTokenExpiresAt && Date.now() >= accessTokenExpiresAt - ACCESS_TOKEN_SAFETY_WINDOW_MS) {
        clearGoogleDriveSession();
        return false;
    }

    return Boolean(accessToken) && Date.now() < accessTokenExpiresAt - ACCESS_TOKEN_SAFETY_WINDOW_MS;
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function loadGoogleIdentityServices() {
    if (window.google?.accounts?.oauth2) return window.google;
    if (googleIdentityScriptPromise) return googleIdentityScriptPromise;

    googleIdentityScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(window.google), { once: true });
            existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services.')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = GOOGLE_IDENTITY_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve(window.google);
        script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
        document.head.appendChild(script);
    });

    return googleIdentityScriptPromise;
}

function clearGoogleDriveSession() {
    accessToken = '';
    accessTokenExpiresAt = 0;
    persistGoogleDriveSession();
}

function mapGoogleAuthError(error) {
    const message = String(error?.message || error || '').trim();

    if (message === 'popup_closed') return 'Google sign-in was closed before it finished.';
    if (message === 'popup_failed_to_open') return 'Google sign-in popup could not be opened.';
    if (message === 'access_denied') return 'Google Drive access was denied.';
    if (message === 'invalid_client') return 'The Google OAuth client ID is invalid for this site.';
    if (message) return message;

    return 'Google authentication failed.';
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

async function requestGoogleDriveAccessToken({ selectAccount = false } = {}) {
    if (!isGoogleDriveSyncConfigured()) {
        throw new Error('Google Drive sync is not configured. Add a Google OAuth client ID first.');
    }

    if (!selectAccount && hasGoogleDriveSession()) {
        return accessToken;
    }

    await loadGoogleIdentityServices();

    return await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: getGoogleDriveClientId(),
            scope: DRIVE_SCOPE,
            callback: (response) => {
                if (!response?.access_token) {
                    reject(new Error('Google authentication failed.'));
                    return;
                }

                accessToken = response.access_token;
                accessTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
                persistGoogleDriveSession();
                rememberGoogleDriveAuthorization();
                resolve(accessToken);
            },
            error_callback: (response) => {
                reject(new Error(response?.type || response?.message || 'Google authentication failed.'));
            },
        });

        tokenClient.requestAccessToken({
            prompt: selectAccount ? 'select_account' : '',
        });
    }).catch((error) => {
        throw new Error(mapGoogleAuthError(error));
    });
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

export async function connectGoogleDrive() {
    await requestGoogleDriveAccessToken({ selectAccount: true });
    return await getGoogleDriveBackupInfo();
}

export async function signOutOfGoogleDrive() {
    // Just clear the local session data.
    // DO NOT call window.google.accounts.oauth2.revoke!
    // Revoking tells Google to delete the user's consent entirely,
    // forcing the permission screen to show up again next time.
    clearGoogleDriveSession();
    forgetGoogleDriveAuthorization();
}

export async function restoreGoogleDriveSession() {
    if (!isGoogleDriveSyncConfigured()) return false;
    if (hasGoogleDriveSession()) return true;
    if (!wasGoogleDrivePreviouslyAuthorized()) return false;

    try {
        await requestGoogleDriveAccessToken({ selectAccount: false });
        return true;
    } catch (error) {
        const message = String(error?.message || '');
        if (message === 'access_denied' || message === 'invalid_client') {
            forgetGoogleDriveAuthorization();
        }
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
