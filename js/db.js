const DB_NAME = 'UkraTimerDB';
const DB_VERSION = 2;
const STORAGE_PREFIX = 'cubetimer_';
const LOCAL_STORAGE_MIGRATION_SKIPPED_KEY = STORAGE_PREFIX + 'sessions_migration_skipped_v2';
export const SOLVE_CHUNK_SIZE = 512;

const DB_BLOCKED_UPGRADE_MESSAGE = 'UkraTimer needs to upgrade local storage, but another UkraTimer tab is still open. Close the other UkraTimer tabs, then reload this page.';
const CHUNK_ID_SEPARATOR = '\u0000';
const CHUNK_ID_WIDTH = 10;

let _db = null;
let _blockedUpgradeNotified = false;

function _sessionOrderValue(session) {
    return Number.isFinite(session?.order) ? session.order : Number.POSITIVE_INFINITY;
}

function _compareSessions(a, b) {
    const orderDiff = _sessionOrderValue(a) - _sessionOrderValue(b);
    if (orderDiff !== 0) return orderDiff;

    const createdAtA = Number.isFinite(a?.createdAt) ? a.createdAt : Number.POSITIVE_INFINITY;
    const createdAtB = Number.isFinite(b?.createdAt) ? b.createdAt : Number.POSITIVE_INFINITY;
    if (createdAtA !== createdAtB) return createdAtA - createdAtB;

    return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function _normalizeSolveTimestamp(solve) {
    const timestamp = Number(solve?.timestamp);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function _compareSolvesByTimestamp(a, b) {
    const timeDiff = _normalizeSolveTimestamp(a) - _normalizeSolveTimestamp(b);
    if (timeDiff !== 0) return timeDiff;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function _generateSolveId(usedIds = null) {
    let id = '';
    do {
        id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    } while (usedIds?.has(id));
    return id;
}

function _chunkId(sessionId, chunkIndex) {
    return `${sessionId}${CHUNK_ID_SEPARATOR}${String(chunkIndex).padStart(CHUNK_ID_WIDTH, '0')}`;
}

function _chunkRange(sessionId) {
    const prefix = `${sessionId}${CHUNK_ID_SEPARATOR}`;
    return IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false);
}

function _sanitizeChunkSolves(solves, sessionId) {
    return (Array.isArray(solves) ? solves : []).map((solve) => ({
        ...solve,
        sessionId,
        ...(Array.isArray(solve?.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
    }));
}

function _sanitizeUniqueSolveForStorage(solve, sessionId, usedSolveIds) {
    const rawId = typeof solve?.id === 'string' ? solve.id : '';
    const id = rawId && !usedSolveIds.has(rawId)
        ? rawId
        : _generateSolveId(usedSolveIds);
    usedSolveIds.add(id);

    return {
        ...solve,
        id,
        sessionId,
        ...(Array.isArray(solve?.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
    };
}

function _normalizeSolvesBySessionWithUniqueIds(sessions, solves) {
    const sessionIds = new Set(
        (Array.isArray(sessions) ? sessions : [])
            .map((session) => session?.id)
            .filter((id) => typeof id === 'string' && id),
    );
    const usedSolveIds = new Set();
    const solvesBySessionId = new Map();

    (Array.isArray(solves) ? solves : []).forEach((solve) => {
        const sessionId = typeof solve?.sessionId === 'string' && solve.sessionId ? solve.sessionId : '';
        if (!sessionId || !sessionIds.has(sessionId)) return;
        if (!solvesBySessionId.has(sessionId)) solvesBySessionId.set(sessionId, []);
        solvesBySessionId.get(sessionId).push(_sanitizeUniqueSolveForStorage(solve, sessionId, usedSolveIds));
    });

    return solvesBySessionId;
}

function _normalizeSessionIdList(value) {
    const source = value instanceof Set ? Array.from(value) : (Array.isArray(value) ? value : []);
    return source.filter((sessionId) => typeof sessionId === 'string' && sessionId);
}

function _buildSessionChunks(sessionId, solves, { sort = true } = {}) {
    const normalizedSolves = _sanitizeChunkSolves(solves, sessionId);
    if (sort) normalizedSolves.sort(_compareSolvesByTimestamp);

    const chunks = [];
    for (let start = 0; start < normalizedSolves.length; start += SOLVE_CHUNK_SIZE) {
        const chunkIndex = chunks.length;
        chunks.push({
            id: _chunkId(sessionId, chunkIndex),
            sessionId,
            chunkIndex,
            solves: normalizedSolves.slice(start, start + SOLVE_CHUNK_SIZE),
        });
    }
    return chunks;
}

function _flattenSessionChunkSolves(chunks, sessionId, { sort = true } = {}) {
    const solves = (Array.isArray(chunks) ? chunks : [])
        .flatMap((chunk) => _sanitizeChunkSolves(chunk.solves, sessionId));
    if (sort) solves.sort(_compareSolvesByTimestamp);
    return solves;
}

function _normalizeSessionForStorage(session, solveCount = null) {
    const normalized = { ...(session || {}) };
    delete normalized.solves;
    delete normalized.solvesLoaded;
    delete normalized.solveById;
    delete normalized.solveIndexById;
    if (Number.isFinite(solveCount)) {
        normalized.solveCount = Math.max(0, Math.floor(solveCount));
    } else if (Number.isFinite(normalized.solveCount)) {
        normalized.solveCount = Math.max(0, Math.floor(normalized.solveCount));
    }
    return normalized;
}

function _getStoreNames(db, names) {
    return names.filter((name) => db.objectStoreNames.contains(name));
}

async function _hasExistingIndexedAppData() {
    const storeNames = _getStoreNames(_db, ['sessions', 'solveChunks', 'solves']);
    for (const storeName of storeNames) {
        if (await _countStore(_db, storeName) > 0) return true;
    }
    return false;
}

function _dispatchStorageEvent(name, detail = {}) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function _emitProgress(onProgress, snapshot) {
    if (typeof onProgress !== 'function') return;

    try {
        onProgress(snapshot);
    } catch (error) {
        console.warn('Storage progress callback failed:', error);
    }
}

function _notifyBlockedUpgrade() {
    if (_blockedUpgradeNotified) return;
    _blockedUpgradeNotified = true;
    console.warn(DB_BLOCKED_UPGRADE_MESSAGE);
    _dispatchStorageEvent('ukratimer:dbUpgradeBlocked', {
        databaseName: DB_NAME,
        version: DB_VERSION,
        message: DB_BLOCKED_UPGRADE_MESSAGE,
    });
}

function _attachDBLifecycleHandlers(db) {
    db.onversionchange = () => {
        db.close();
        if (_db === db) _db = null;
        console.warn('UkraTimer storage was closed because a newer app version requested a database upgrade.');
        _dispatchStorageEvent('ukratimer:dbVersionChange', {
            databaseName: DB_NAME,
            version: DB_VERSION,
        });
    };
}

/**
 * Open (or create/upgrade) the IndexedDB database.
 * On first run, migrates old localStorage/per-solve IndexedDB data into chunks.
 * @returns {Promise<IDBDatabase>}
 */
export async function openDB() {
    if (_db) return _db;

    _db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'id' });
            }

            // Kept for legacy v1 migration only. New writes use solveChunks.
            if (!db.objectStoreNames.contains('solves')) {
                const solveStore = db.createObjectStore('solves', { keyPath: 'id' });
                solveStore.createIndex('sessionId', 'sessionId', { unique: false });
            }

            if (!db.objectStoreNames.contains('solveChunks')) {
                const chunkStore = db.createObjectStore('solveChunks', { keyPath: 'id' });
                chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
            }
        };

        request.onblocked = _notifyBlockedUpgrade;
        request.onsuccess = (event) => {
            const db = event.target.result;
            _attachDBLifecycleHandlers(db);
            resolve(db);
        };
        request.onerror = (event) => reject(event.target.error);
    });

    await _migrateFromLocalStorage();
    await _migrateLegacySolvesStore();
    await _backfillSessionSolveCounts();

    return _db;
}

// ──── Migration ────

async function _migrateFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_PREFIX + 'sessions');
    if (!raw) return;

    if (await _hasExistingIndexedAppData()) {
        if (localStorage.getItem(LOCAL_STORAGE_MIGRATION_SKIPPED_KEY) !== 'true') {
            console.warn('Skipping embedded localStorage migration because IndexedDB already contains timer data. Keeping localStorage sessions as a backup.');
            localStorage.setItem(LOCAL_STORAGE_MIGRATION_SKIPPED_KEY, 'true');
        }
        return;
    }

    localStorage.removeItem(LOCAL_STORAGE_MIGRATION_SKIPPED_KEY);

    let oldSessions;
    try {
        oldSessions = JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to parse old sessions for migration:', e);
        return;
    }

    if (!Array.isArray(oldSessions) || oldSessions.length === 0) return;
    if (!oldSessions.some((session) => Array.isArray(session.solves))) return;

    console.log('Migrating embedded localStorage sessions to chunked IndexedDB...');

    const tx = _db.transaction(_getStoreNames(_db, ['sessions', 'solveChunks', 'solves']), 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const chunkStore = tx.objectStore('solveChunks');
    const solveStore = tx.objectStoreNames.contains('solves') ? tx.objectStore('solves') : null;

    sessionStore.clear();
    chunkStore.clear();
    solveStore?.clear();

    const usedSolveIds = new Set();
    oldSessions.forEach((session, index) => {
        const sessionId = typeof session?.id === 'string' && session.id ? session.id : `legacy-${index + 1}`;
        const solves = Array.isArray(session.solves) ? session.solves : [];
        const sanitizedSolves = solves.map((solve) => _sanitizeUniqueSolveForStorage(solve, sessionId, usedSolveIds));
        sessionStore.put(_normalizeSessionForStorage({
            id: sessionId,
            name: session.name,
            createdAt: session.createdAt,
            order: Number.isFinite(session.order) ? session.order : index,
            ...(typeof session.scrambleType === 'string' ? { scrambleType: session.scrambleType } : {}),
            ...(session.settings && typeof session.settings === 'object' ? { settings: session.settings } : {}),
        }, sanitizedSolves.length));
        _buildSessionChunks(sessionId, sanitizedSolves).forEach((chunk) => chunkStore.put(chunk));
    });

    await _txComplete(tx);
    localStorage.removeItem(STORAGE_PREFIX + 'sessions');
    localStorage.removeItem(LOCAL_STORAGE_MIGRATION_SKIPPED_KEY);
    console.log('Chunked localStorage migration complete.');
}

async function _migrateLegacySolvesStore() {
    if (!_db.objectStoreNames.contains('solves') || !_db.objectStoreNames.contains('solveChunks')) return;

    const existingChunkCount = await _countStore(_db, 'solveChunks');
    if (existingChunkCount > 0) return;

    const legacySolveCount = await _countStore(_db, 'solves');
    if (legacySolveCount === 0) return;

    console.log('Migrating per-solve IndexedDB records to chunked storage...');

    const sessions = await _getAll(_db, 'sessions');
    const tx = _db.transaction(['sessions', 'solves', 'solveChunks'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const solveStore = tx.objectStore('solves');
    const chunkStore = tx.objectStore('solveChunks');
    const solveIndex = solveStore.index('sessionId');

    for (const session of sessions) {
        const solves = await _getAllFromIndex(solveIndex, session.id);
        solves.sort(_compareSolvesByTimestamp);
        _buildSessionChunks(session.id, solves, { sort: false }).forEach((chunk) => chunkStore.put(chunk));
        sessionStore.put(_normalizeSessionForStorage(session, solves.length));
    }

    solveStore.clear();
    await _txComplete(tx);
    console.log('Chunked IndexedDB migration complete.');
}

async function _backfillSessionSolveCounts() {
    const sessions = await _getAll(_db, 'sessions');
    const missingCountSessions = sessions.filter((session) => !Number.isFinite(session?.solveCount));
    if (missingCountSessions.length === 0) return;

    const tx = _db.transaction(['sessions', 'solveChunks'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const chunkStore = tx.objectStore('solveChunks');

    for (const session of missingCountSessions) {
        const chunks = await _getChunksFromStore(chunkStore, session.id);
        const solveCount = chunks.reduce((count, chunk) => count + (Array.isArray(chunk.solves) ? chunk.solves.length : 0), 0);
        sessionStore.put(_normalizeSessionForStorage(session, solveCount));
    }

    await _txComplete(tx);
}

// ──── Sessions ────

export async function getAllSessions() {
    const db = await openDB();
    const sessions = await _getAll(db, 'sessions');
    sessions.sort(_compareSessions);
    return sessions;
}

export async function addSession(session) {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(_normalizeSessionForStorage(session, session?.solveCount ?? 0));
    return _txComplete(tx);
}

export async function updateSession(session) {
    const db = await openDB();
    const tx = db.transaction(_getStoreNames(db, ['sessions', 'solveChunks']), 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const existingSession = session?.id
        ? await _requestToPromise(sessionStore.get(session.id))
        : null;
    let preservedSolveCount = null;

    if (Number.isFinite(existingSession?.solveCount)) {
        preservedSolveCount = existingSession.solveCount;
    } else if (session?.id && tx.objectStoreNames.contains('solveChunks')) {
        preservedSolveCount = await _countSolvesFromChunkStore(tx.objectStore('solveChunks'), session.id);
    }

    const normalizedSession = _normalizeSessionForStorage(session);
    delete normalizedSession.solveCount;
    if (Number.isFinite(preservedSolveCount)) {
        normalizedSession.solveCount = Math.max(0, Math.floor(preservedSolveCount));
    }

    sessionStore.put(normalizedSession);
    return _txComplete(tx);
}

export async function deleteSession(sessionId) {
    const db = await openDB();
    const storeNames = _getStoreNames(db, ['sessions', 'solveChunks', 'solves']);
    const tx = db.transaction(storeNames, 'readwrite');
    tx.objectStore('sessions').delete(sessionId);
    tx.objectStore('solveChunks').delete(_chunkRange(sessionId));

    if (tx.objectStoreNames.contains('solves')) {
        const solveStore = tx.objectStore('solves');
        const index = solveStore.index('sessionId');
        const cursorRequest = index.openCursor(IDBKeyRange.only(sessionId));
        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };
    }

    return _txComplete(tx);
}

// ──── Solves ────

export async function getSolvesBySession(sessionId) {
    const db = await openDB();
    const tx = db.transaction('solveChunks', 'readonly');
    const chunks = await _getChunksFromStore(tx.objectStore('solveChunks'), sessionId);
    await _txComplete(tx);
    return _flattenSessionChunkSolves(chunks, sessionId);
}

export async function getLatestSolvesBySession(sessionId, limit = SOLVE_CHUNK_SIZE) {
    const db = await openDB();
    const safeLimit = Math.max(0, Math.floor(Number(limit)) || 0);
    if (safeLimit === 0) return [];

    const tx = db.transaction('solveChunks', 'readonly');
    const chunks = await _getChunksFromStore(tx.objectStore('solveChunks'), sessionId);
    await _txComplete(tx);

    return _flattenSessionChunkSolves(chunks, sessionId).slice(-safeLimit);
}

export async function getSolveIdsBySession(sessionId) {
    const db = await openDB();
    const tx = db.transaction('solveChunks', 'readonly');
    const chunks = await _getChunksFromStore(tx.objectStore('solveChunks'), sessionId);
    await _txComplete(tx);
    return chunks.flatMap((chunk) => (
        (Array.isArray(chunk.solves) ? chunk.solves : [])
            .map((solve) => solve?.id)
            .filter(Boolean)
    ));
}

export async function streamSolvesBySession(sessionId, callback) {
    if (typeof callback !== 'function') return;

    const db = await openDB();
    const tx = db.transaction('solveChunks', 'readonly');
    const request = tx.objectStore('solveChunks').openCursor(_chunkRange(sessionId));

    await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                resolve();
                return;
            }
            const chunk = cursor.value;
            callback(_sanitizeChunkSolves(chunk.solves, sessionId), chunk);
            cursor.continue();
        };
        request.onerror = (event) => reject(event.target.error);
    });

    await _txComplete(tx);
}

export async function getSolveCountBySession(sessionId) {
    const db = await openDB();
    const tx = db.transaction(['sessions', 'solveChunks'], 'readonly');
    const session = await _requestToPromise(tx.objectStore('sessions').get(sessionId));
    if (Number.isFinite(session?.solveCount)) {
        await _txComplete(tx);
        return Math.max(0, Math.floor(session.solveCount));
    }

    const chunks = await _getChunksFromStore(tx.objectStore('solveChunks'), sessionId);
    await _txComplete(tx);
    return chunks.reduce((count, chunk) => count + (Array.isArray(chunk.solves) ? chunk.solves.length : 0), 0);
}

export async function addSolve(solve) {
    const sessionId = typeof solve?.sessionId === 'string' && solve.sessionId ? solve.sessionId : '';
    if (!sessionId) return;

    const storedSolve = {
        ...solve,
        sessionId,
        ...(Array.isArray(solve.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
    };

    const db = await openDB();
    const tx = db.transaction(['sessions', 'solveChunks'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const chunkStore = tx.objectStore('solveChunks');
    const session = await _requestToPromise(sessionStore.get(sessionId));
    const hasStoredSolveCount = Number.isFinite(session?.solveCount);
    const currentCount = hasStoredSolveCount
        ? Math.max(0, Math.floor(session.solveCount))
        : await _countSolvesFromChunkStore(chunkStore, sessionId);
    const chunkIndex = Math.floor(currentCount / SOLVE_CHUNK_SIZE);
    const chunkId = _chunkId(sessionId, chunkIndex);
    const existingChunk = await _requestToPromise(chunkStore.get(chunkId));
    const chunk = existingChunk || {
        id: chunkId,
        sessionId,
        chunkIndex,
        solves: [],
    };

    chunk.solves = _sanitizeChunkSolves(chunk.solves, sessionId);
    const currentChunkOffset = currentCount % SOLVE_CHUNK_SIZE;
    let appendPositionMatchesStoredCount = false;
    if (existingChunk) {
        appendPositionMatchesStoredCount = chunk.solves.length === currentChunkOffset
            && chunk.solves.length < SOLVE_CHUNK_SIZE;
    } else if (!hasStoredSolveCount || currentCount === 0) {
        appendPositionMatchesStoredCount = true;
    } else if (currentChunkOffset === 0 && chunkIndex > 0) {
        const previousChunk = await _requestToPromise(chunkStore.get(_chunkId(sessionId, chunkIndex - 1)));
        appendPositionMatchesStoredCount = _sanitizeChunkSolves(previousChunk?.solves, sessionId).length === SOLVE_CHUNK_SIZE;
    }

    if (!appendPositionMatchesStoredCount) {
        const chunks = await _getChunksFromStore(chunkStore, sessionId);
        const rebuiltSolves = chunks.flatMap((entry) => _sanitizeChunkSolves(entry.solves, sessionId));
        rebuiltSolves.push(storedSolve);
        await _replaceSessionChunksInTransaction(sessionStore, chunkStore, sessionId, rebuiltSolves);
        return _txComplete(tx);
    }

    chunk.solves.push(storedSolve);
    chunkStore.put(chunk);

    if (session) {
        sessionStore.put(_normalizeSessionForStorage(session, currentCount + 1));
    }

    return _txComplete(tx);
}

export async function updateSolve(solve) {
    const sessionId = typeof solve?.sessionId === 'string' && solve.sessionId ? solve.sessionId : '';
    if (!solve?.id || !sessionId) return;

    const storedSolve = {
        ...solve,
        sessionId,
        ...(Array.isArray(solve.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
    };

    const db = await openDB();
    const tx = db.transaction('solveChunks', 'readwrite');
    const chunkStore = tx.objectStore('solveChunks');
    const chunks = await _getChunksFromStore(chunkStore, sessionId);

    for (const chunk of chunks) {
        const index = (Array.isArray(chunk.solves) ? chunk.solves : []).findIndex((entry) => entry?.id === storedSolve.id);
        if (index === -1) continue;
        chunk.solves[index] = storedSolve;
        chunkStore.put(chunk);
        await _txComplete(tx);
        return;
    }

    await _txComplete(tx);
}

export async function updateSolves(solves, { onProgress = null, sourceSessionIds = null, sessionIds = null } = {}) {
    if (!Array.isArray(solves) || solves.length === 0) return;

    const updatesById = new Map(
        solves
            .filter((solve) => solve?.id && typeof solve.sessionId === 'string' && solve.sessionId)
            .map((solve) => {
                const sessionId = solve.sessionId;
                return [solve.id, {
                    ...solve,
                    sessionId,
                    ...(Array.isArray(solve.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
                }];
            }),
    );
    if (updatesById.size === 0) return;

    const db = await openDB();
    const tx = db.transaction(['sessions', 'solveChunks'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const chunkStore = tx.objectStore('solveChunks');
    const explicitSessionIds = [
        ..._normalizeSessionIdList(sessionIds),
        ..._normalizeSessionIdList(sourceSessionIds),
    ];
    const useSessionScope = explicitSessionIds.length > 0;
    const requestedSessionIds = new Set(explicitSessionIds);
    if (useSessionScope) updatesById.forEach((solve) => requestedSessionIds.add(solve.sessionId));
    const allChunks = useSessionScope
        ? (await Promise.all(Array.from(requestedSessionIds, (sessionId) => _getChunksFromStore(chunkStore, sessionId)))).flat()
        : await _getAllFromStore(chunkStore);
    const touchedSessionIds = new Set();
    const nextSolvesBySession = new Map();
    const insertedUpdateIds = new Set();

    allChunks.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (useSessionScope) {
        requestedSessionIds.forEach((sessionId) => {
            if (!nextSolvesBySession.has(sessionId)) nextSolvesBySession.set(sessionId, []);
        });
    }
    allChunks.forEach((chunk) => {
        const sessionId = chunk.sessionId;
        if (!nextSolvesBySession.has(sessionId)) nextSolvesBySession.set(sessionId, []);

        (Array.isArray(chunk.solves) ? chunk.solves : []).forEach((solve) => {
            const updated = updatesById.get(solve?.id);
            if (!updated) {
                nextSolvesBySession.get(sessionId).push(solve);
                return;
            }

            touchedSessionIds.add(sessionId);
            touchedSessionIds.add(updated.sessionId);
            if (!nextSolvesBySession.has(updated.sessionId)) nextSolvesBySession.set(updated.sessionId, []);
            if (!insertedUpdateIds.has(updated.id)) {
                nextSolvesBySession.get(updated.sessionId).push({
                    ...updated,
                    ...(Array.isArray(updated.phaseSplits) ? { phaseSplits: [...updated.phaseSplits] } : {}),
                });
                insertedUpdateIds.add(updated.id);
            }
        });
    });

    updatesById.forEach((solve) => {
        if (insertedUpdateIds.has(solve.id)) return;
        touchedSessionIds.add(solve.sessionId);
        if (!nextSolvesBySession.has(solve.sessionId)) nextSolvesBySession.set(solve.sessionId, []);
        nextSolvesBySession.get(solve.sessionId).push({
            ...solve,
            ...(Array.isArray(solve.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
        });
    });

    const touchedSessionIdList = Array.from(touchedSessionIds);
    let completedSessions = 0;
    touchedSessionIdList.forEach((sessionId) => {
        if (!nextSolvesBySession.has(sessionId)) nextSolvesBySession.set(sessionId, []);
    });

    _emitProgress(onProgress, {
        completed: 0,
        total: updatesById.size,
    });

    for (const sessionId of touchedSessionIdList) {
        const nextSolves = nextSolvesBySession.get(sessionId) || [];
        await _replaceSessionChunksInTransaction(sessionStore, chunkStore, sessionId, nextSolves, {
            onProgress: ({ completedWork, totalWork }) => {
                const sessionRatio = totalWork > 0 ? completedWork / totalWork : 1;
                const completed = Math.min(
                    updatesById.size,
                    Math.round(updatesById.size * ((completedSessions + sessionRatio) / Math.max(1, touchedSessionIdList.length))),
                );
                _emitProgress(onProgress, {
                    completed,
                    total: updatesById.size,
                });
            },
        });
        completedSessions += 1;
    }

    _emitProgress(onProgress, {
        completed: updatesById.size,
        total: updatesById.size,
    });

    return _txComplete(tx);
}

export async function deleteSolve(solveId, options = {}) {
    return deleteSolves([solveId], options);
}

export async function deleteSolves(solveIds, { onProgress = null, sessionIds = null } = {}) {
    const idSet = new Set((Array.isArray(solveIds) ? solveIds : []).filter(Boolean));
    if (idSet.size === 0) return;

    const db = await openDB();
    const tx = db.transaction(['sessions', 'solveChunks'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const chunkStore = tx.objectStore('solveChunks');
    const scopedSessionIds = _normalizeSessionIdList(sessionIds);
    const allChunks = scopedSessionIds.length > 0
        ? (await Promise.all(scopedSessionIds.map((sessionId) => _getChunksFromStore(chunkStore, sessionId)))).flat()
        : await _getAllFromStore(chunkStore);
    const nextSolvesBySession = new Map();
    const touchedSessionIds = new Set();

    allChunks.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    allChunks.forEach((chunk) => {
        const sessionId = chunk.sessionId;
        if (!nextSolvesBySession.has(sessionId)) nextSolvesBySession.set(sessionId, []);

        (Array.isArray(chunk.solves) ? chunk.solves : []).forEach((solve) => {
            if (idSet.has(solve?.id)) {
                touchedSessionIds.add(sessionId);
                return;
            }
            nextSolvesBySession.get(sessionId).push(solve);
        });
    });

    const touchedSessionIdList = Array.from(touchedSessionIds);
    let completedSessions = 0;

    _emitProgress(onProgress, {
        completed: 0,
        total: idSet.size,
    });

    for (const sessionId of touchedSessionIdList) {
        await _replaceSessionChunksInTransaction(sessionStore, chunkStore, sessionId, nextSolvesBySession.get(sessionId) || [], {
            onProgress: ({ completedWork, totalWork }) => {
                const sessionRatio = totalWork > 0 ? completedWork / totalWork : 1;
                const completed = Math.min(
                    idSet.size,
                    Math.round(idSet.size * ((completedSessions + sessionRatio) / Math.max(1, touchedSessionIdList.length))),
                );
                _emitProgress(onProgress, {
                    completed,
                    total: idSet.size,
                });
            },
        });
        completedSessions += 1;
    }

    _emitProgress(onProgress, {
        completed: idSet.size,
        total: idSet.size,
    });

    return _txComplete(tx);
}

// ──── Bulk Operations (import/export) ────

/**
 * Get all data from the database.
 * @returns {Promise<{ sessions: object[], solves: object[] }>}
 */
export async function getAllData() {
    const db = await openDB();
    const tx = db.transaction(['sessions', 'solveChunks'], 'readonly');
    const sessions = await _getAllFromStore(tx.objectStore('sessions'));
    const chunks = await _getAllFromStore(tx.objectStore('solveChunks'));
    await _txComplete(tx);

    sessions.sort(_compareSessions);
    chunks.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const solves = [];
    chunks.forEach((chunk) => {
        solves.push(..._sanitizeChunkSolves(chunk.solves, chunk.sessionId));
    });
    // Match the old per-solve objectStore.getAll() ordering, which was by
    // primary key. Merge tie-breaks for exact duplicate logical solves can
    // depend on queue order.
    solves.sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));

    return { sessions, solves };
}

/**
 * Read trainer solves without hydrating every session in SessionManager.
 * The chunk cursor yields between chunks and only matching solves are retained.
 * @param {'oll'|'pll'} trainerId
 * @returns {Promise<object[]>}
 */
export function getTrainerCaseSolvesFromChunk(chunk, trainerId) {
    const normalizedTrainerId = String(trainerId ?? '').trim().toLowerCase();
    if (normalizedTrainerId !== 'oll' && normalizedTrainerId !== 'pll') return [];

    const matchingSolves = (Array.isArray(chunk?.solves) ? chunk.solves : [])
        .filter((solve) => solve?.trainerCase?.trainerId === normalizedTrainerId);
    return _sanitizeChunkSolves(matchingSolves, chunk?.sessionId);
}

export async function getTrainerCaseSolves(trainerId) {
    const normalizedTrainerId = String(trainerId ?? '').trim().toLowerCase();
    if (normalizedTrainerId !== 'oll' && normalizedTrainerId !== 'pll') return [];

    const db = await openDB();
    const tx = db.transaction('solveChunks', 'readonly');
    const solves = [];
    const request = tx.objectStore('solveChunks').openCursor();

    await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                resolve();
                return;
            }

            const chunk = cursor.value;
            solves.push(...getTrainerCaseSolvesFromChunk(chunk, normalizedTrainerId));
            cursor.continue();
        };
        request.onerror = (event) => reject(event.target.error);
    });

    await _txComplete(tx);
    return solves;
}

export async function getSolveDayEntries() {
    const db = await openDB();
    const tx = db.transaction('solveChunks', 'readonly');
    const entries = [];
    const request = tx.objectStore('solveChunks').openCursor();

    await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                resolve();
                return;
            }
            const chunk = cursor.value;
            (Array.isArray(chunk.solves) ? chunk.solves : []).forEach((solve) => {
                if (!solve?.id || !Number.isFinite(solve.timestamp)) return;
                entries.push({
                    id: solve.id,
                    timestamp: solve.timestamp,
                });
            });
            cursor.continue();
        };
        request.onerror = (event) => reject(event.target.error);
    });

    await _txComplete(tx);
    return entries;
}

/**
 * Replace all data in the database (for import).
 * Clears existing data first.
 * @param {object[]} sessions
 * @param {object[]} solves
 */
export async function replaceAllData(sessions, solves, { onProgress = null } = {}) {
    const db = await openDB();
    const normalizedSessions = Array.isArray(sessions) ? sessions : [];
    const normalizedSolves = Array.isArray(solves) ? solves : [];
    const solvesBySessionId = _normalizeSolvesBySessionWithUniqueIds(normalizedSessions, normalizedSolves);

    const chunks = [];
    normalizedSessions.forEach((session) => {
        chunks.push(..._buildSessionChunks(session.id, solvesBySessionId.get(session.id) || []));
    });

    const storedSolveCount = chunks.reduce((count, chunk) => (
        count + (Array.isArray(chunk.solves) ? chunk.solves.length : 0)
    ), 0);
    const total = 1 + normalizedSessions.length + storedSolveCount;
    let completed = 0;
    const tx = db.transaction(_getStoreNames(db, ['sessions', 'solveChunks', 'solves']), 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const chunkStore = tx.objectStore('solveChunks');
    const solveStore = tx.objectStoreNames.contains('solves') ? tx.objectStore('solves') : null;

    const emitProgress = (stage) => {
        if (typeof onProgress !== 'function') return;
        onProgress({
            stage,
            completed,
            total,
        });
    };

    emitProgress('clearing');
    await _requestToPromise(sessionStore.clear());
    await _requestToPromise(chunkStore.clear());
    if (solveStore) await _requestToPromise(solveStore.clear());

    completed = 1;
    emitProgress(normalizedSessions.length > 0 ? 'sessions' : 'solves');

    normalizedSessions.forEach((session) => {
        const solveCount = solvesBySessionId.get(session.id)?.length || 0;
        const request = sessionStore.put(_normalizeSessionForStorage(session, solveCount));
        request.onsuccess = () => {
            completed += 1;
            emitProgress(completed < (1 + normalizedSessions.length) ? 'sessions' : 'solves');
        };
    });

    chunks.forEach((chunk) => {
        const request = chunkStore.put(chunk);
        request.onsuccess = () => {
            completed += Array.isArray(chunk.solves) ? chunk.solves.length : 0;
            emitProgress('solves');
        };
    });

    return _txComplete(tx);
}

// ──── Helpers ────

async function _replaceSessionChunksInTransaction(sessionStore, chunkStore, sessionId, solves, { onProgress = null } = {}) {
    const sortedSolves = _sanitizeChunkSolves(solves, sessionId).sort(_compareSolvesByTimestamp);
    const oldChunks = await _getChunksFromStore(chunkStore, sessionId);
    const nextChunks = _buildSessionChunks(sessionId, sortedSolves, { sort: false });
    const nextChunkIds = new Set(nextChunks.map((chunk) => chunk.id));
    const staleChunks = oldChunks.filter((chunk) => !nextChunkIds.has(chunk?.id));
    const session = await _requestToPromise(sessionStore.get(sessionId));
    const totalWork = nextChunks.length + staleChunks.length + (session ? 1 : 0);
    let completedWork = 0;

    const trackWriteProgress = (request) => {
        if (!request || typeof onProgress !== 'function') return;
        request.onsuccess = () => {
            completedWork += 1;
            _emitProgress(onProgress, {
                completedWork,
                totalWork,
            });
        };
    };

    nextChunks.forEach((chunk) => {
        trackWriteProgress(chunkStore.put(chunk));
    });
    staleChunks.forEach((chunk) => {
        trackWriteProgress(chunkStore.delete(chunk.id));
    });

    if (session) {
        trackWriteProgress(sessionStore.put(_normalizeSessionForStorage(session, sortedSolves.length)));
    }

    if (totalWork === 0) {
        _emitProgress(onProgress, {
            completedWork: 0,
            totalWork: 0,
        });
    }
}

async function _countSolvesFromChunkStore(chunkStore, sessionId) {
    const chunks = await _getChunksFromStore(chunkStore, sessionId);
    return chunks.reduce((count, chunk) => count + (Array.isArray(chunk.solves) ? chunk.solves.length : 0), 0);
}

function _txComplete(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
        tx.onabort = (event) => reject(event.target.error || new Error('Transaction aborted'));
    });
}

function _requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function _getAll(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function _countStore(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function _getAllFromStore(store) {
    return _requestToPromise(store.getAll());
}

function _getAllFromIndex(index, key) {
    return _requestToPromise(index.getAll(key));
}

function _getChunksFromStore(chunkStore, sessionId) {
    return _requestToPromise(chunkStore.getAll(_chunkRange(sessionId))).then((chunks) => {
        chunks.sort((a, b) => (a.chunkIndex - b.chunkIndex) || String(a.id).localeCompare(String(b.id)));
        return chunks;
    });
}
