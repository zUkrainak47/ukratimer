import * as db from './db.js?v=2026061501';
import {
    SETTING_SCOPE_GLOBAL,
    SETTING_SCOPE_SESSION,
    SUMMARY_STATS_SCOPE_SETTING_KEYS,
    normalizeSettingScopes,
} from './setting-scopes.js?v=2026061501';

const STORAGE_PREFIX = 'cubetimer_';
const STORAGE_VERSION = 1;
export const IMPORT_MODE_REWRITE = 'rewrite';
export const IMPORT_MODE_MERGE = 'merge';
export const TWISTY_TIMER_OTHER_TIMERS_EXPORT_MESSAGE = 'If you\'re exporting from Twisty Timer do a full "For backup" export, not "For other timers"';
const SOLVE_MATCH_MODE_ID = 'id';
const SOLVE_MATCH_MODE_ID_OR_LOGICAL_EXACT = 'id-or-logical';
const SOLVE_MATCH_MODE_LOGICAL_EXACT = 'logical';
const SOLVE_MATCH_MODE_LOGICAL_CSTIMER = 'logical-cstimer';
const SESSION_CSV_HEADERS = ['Puzzle', 'Category', 'Time(millis)', 'Date(millis)', 'Scramble', 'Penalty', 'Comment'];
const SESSION_CSV_DELIMITERS = [';', ','];
const BACKUP_LOCAL_STORAGE_KEYS = Object.freeze([
    'settings',
    'activeSessionId',
    'scrambleType',
]);
const BACKUP_LOCAL_STORAGE_KEY_SET = new Set(BACKUP_LOCAL_STORAGE_KEYS);
const IMPORT_PROGRESS_YIELD_INTERVAL = 10000;
const LOCAL_ONLY_SETTING_KEYS = new Set(['zenMode']);
const LOCAL_ONLY_SESSION_SETTING_KEYS = new Set(['zenMode']);
const beforeDataExportHooks = new Set();
const AUTO_EXPORT_EVERY_100_SOLVES_NEVER = 'n';
const AUTO_EXPORT_EVERY_100_SOLVES_REMIND = 'a';
const AUTO_EXPORT_EVERY_100_SOLVES_GOOGLE_DRIVE = 'ggl';
const AUTO_EXPORT_EVERY_100_SOLVES_FILE = 'f';
const INSPECTION_TIME_OFF = 'off';
const INSPECTION_TIME_COUNT_UP = 'ap';
const INSPECTION_TIME_COUNT_DOWN = 'a';
const LEGACY_AUTO_EXPORT_EVERY_100_SOLVES_KEY = 'googleDriveBackupReminderEvery100Solves';
const LEGACY_AUTO_EXPORT_CHECKPOINT_SOLVE_COUNT_KEY = 'googleDriveBackupCheckpointSolveCount';
const LEGACY_AUTO_EXPORT_LAST_REMINDER_SOLVE_COUNT_KEY = 'googleDriveBackupLastReminderSolveCount';
const AUTO_EXPORT_EVERY_100_SOLVES_VALUES = new Set([
    AUTO_EXPORT_EVERY_100_SOLVES_NEVER,
    AUTO_EXPORT_EVERY_100_SOLVES_REMIND,
    AUTO_EXPORT_EVERY_100_SOLVES_GOOGLE_DRIVE,
    AUTO_EXPORT_EVERY_100_SOLVES_FILE,
]);
const INSPECTION_TIME_VALUES = new Set([
    INSPECTION_TIME_OFF,
    INSPECTION_TIME_COUNT_UP,
    INSPECTION_TIME_COUNT_DOWN,
]);

export function registerBeforeDataExportHook(callback) {
    if (typeof callback !== 'function') {
        return () => { };
    }

    beforeDataExportHooks.add(callback);
    return () => {
        beforeDataExportHooks.delete(callback);
    };
}

async function _runBeforeDataExportHooks() {
    if (beforeDataExportHooks.size === 0) return;

    await Promise.all(
        Array.from(beforeDataExportHooks, (callback) => callback()),
    );
}

/**
 * Load data from localStorage.
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function load(key, defaultValue = null) {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === null) return defaultValue;
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (e) {
        console.warn(`Failed to load "${key}" from storage:`, e);
        return defaultValue;
    }
}

/**
 * Save data to localStorage.
 * @param {string} key
 * @param {*} data
 */
export function save(key, data) {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
    } catch (e) {
        console.warn(`Failed to save "${key}" to storage:`, e);
    }
}

/**
 * Remove a key from localStorage.
 * @param {string} key
 */
export function remove(key) {
    localStorage.removeItem(STORAGE_PREFIX + key);
}

function hasStoredKey(key) {
    return localStorage.getItem(STORAGE_PREFIX + key) !== null;
}

function _reportImportProgress(onProgress, snapshot) {
    if (typeof onProgress === 'function') {
        onProgress(snapshot);
    }
}

function _waitForNextFrame() {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }

        setTimeout(resolve, 0);
    });
}

function _countEmbeddedSolves(sessions) {
    return sessions.reduce((count, session) => (
        count + (Array.isArray(session.solves) ? session.solves.length : 0)
    ), 0);
}

function _normalizeImportMode(mode) {
    return mode === IMPORT_MODE_MERGE ? IMPORT_MODE_MERGE : IMPORT_MODE_REWRITE;
}

async function _replaceImportedData(
    dbSessions,
    dbSolves,
    { source = 'backup', onProgress = null, processedOffset = 0, totalWork = processedOffset + 1 + dbSessions.length + dbSolves.length } = {},
) {
    await db.replaceAllData(dbSessions, dbSolves, {
        onProgress: ({ stage, completed, total }) => {
            const processed = processedOffset + completed;
            _reportImportProgress(onProgress, {
                source,
                phase: 'writing',
                stage,
                completed,
                total,
                processed,
                totalWork,
                percent: totalWork > 0 ? (processed / totalWork) * 100 : 100,
                sessionCount: dbSessions.length,
                solveCount: dbSolves.length,
            });
        },
    });
}

function _stripLocalOnlySettingScopes(scopeMap) {
    const source = scopeMap && typeof scopeMap === 'object' ? scopeMap : {};
    const sanitized = { ...source };

    LOCAL_ONLY_SESSION_SETTING_KEYS.forEach((key) => {
        delete sanitized[key];
    });

    return sanitized;
}

function _normalizeNonNegativeInteger(value, fallback = 0) {
    const normalized = Math.floor(Number(value));
    return Number.isFinite(normalized) && normalized >= 0
        ? normalized
        : Math.max(0, Math.floor(Number(fallback)) || 0);
}

function _normalizeAutoExportEvery100Solves(
    value,
    {
        defaultValue = AUTO_EXPORT_EVERY_100_SOLVES_NEVER,
        invalidValue = AUTO_EXPORT_EVERY_100_SOLVES_REMIND,
    } = {},
) {
    if (value === true) return AUTO_EXPORT_EVERY_100_SOLVES_REMIND;
    if (value === false) return AUTO_EXPORT_EVERY_100_SOLVES_NEVER;
    if (value == null) return defaultValue;

    const normalized = typeof value === 'string'
        ? value.trim().toLowerCase()
        : String(value).trim().toLowerCase();

    // csTimer supports destinations UkraTimer does not implement (`id`, `wca`),
    // so unsupported values intentionally fall back to "Remind".
    return AUTO_EXPORT_EVERY_100_SOLVES_VALUES.has(normalized)
        ? normalized
        : invalidValue;
}

function _normalizeInspectionTime(value) {
    if (value === true) return INSPECTION_TIME_COUNT_UP;
    if (value === false || value == null) return INSPECTION_TIME_OFF;

    const normalized = typeof value === 'string'
        ? value.trim().toLowerCase()
        : String(value).trim().toLowerCase();

    if (normalized === '15s' || normalized === 'count-up' || normalized === 'counting-up') {
        return INSPECTION_TIME_COUNT_UP;
    }
    if (normalized === 'count-down' || normalized === 'counting-down') {
        return INSPECTION_TIME_COUNT_DOWN;
    }
    return INSPECTION_TIME_VALUES.has(normalized)
        ? normalized
        : INSPECTION_TIME_OFF;
}

function _isInspectionTimeEnabled(value) {
    return _normalizeInspectionTime(value) !== INSPECTION_TIME_OFF;
}

function _mapInspectionTimeToCsTimerUseIns(value) {
    const inspectionTime = _normalizeInspectionTime(value);
    return inspectionTime === INSPECTION_TIME_OFF ? 'n' : inspectionTime;
}

function _sanitizeAutoExportEvery100SolvesSetting(settingsData) {
    const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
    const sanitized = { ...source };
    sanitized.autoExportEvery100Solves = _normalizeAutoExportEvery100Solves(
        _hasOwn(source, 'autoExportEvery100Solves')
            ? source.autoExportEvery100Solves
            : source[LEGACY_AUTO_EXPORT_EVERY_100_SOLVES_KEY],
        { defaultValue: AUTO_EXPORT_EVERY_100_SOLVES_NEVER },
    );
    delete sanitized[LEGACY_AUTO_EXPORT_EVERY_100_SOLVES_KEY];
    return sanitized;
}

function _sanitizeAutoExportSequenceSettings(settingsData, { minimumSolveSequence = 0 } = {}) {
    const sanitized = _sanitizeAutoExportEvery100SolvesSetting(settingsData);
    sanitized.inspectionTime = _normalizeInspectionTime(sanitized.inspectionTime);
    const legacyCheckpointSolveSequence = _normalizeNonNegativeInteger(
        sanitized[LEGACY_AUTO_EXPORT_CHECKPOINT_SOLVE_COUNT_KEY],
        0,
    );
    const nextCheckpointSolveSequence = _normalizeNonNegativeInteger(
        _hasOwn(sanitized, 'autoExportCheckpointSolveSequence')
            ? sanitized.autoExportCheckpointSolveSequence
            : legacyCheckpointSolveSequence,
        legacyCheckpointSolveSequence,
    );
    const legacyLastReminderSolveSequence = _normalizeNonNegativeInteger(
        sanitized[LEGACY_AUTO_EXPORT_LAST_REMINDER_SOLVE_COUNT_KEY],
        nextCheckpointSolveSequence,
    );
    const nextLastReminderSolveSequence = Math.max(
        nextCheckpointSolveSequence,
        _normalizeNonNegativeInteger(
            _hasOwn(sanitized, 'autoExportLastReminderSolveSequence')
                ? sanitized.autoExportLastReminderSolveSequence
                : legacyLastReminderSolveSequence,
            legacyLastReminderSolveSequence,
        ),
    );
    const nextSolveSequence = Math.max(
        nextCheckpointSolveSequence,
        nextLastReminderSolveSequence,
        _normalizeNonNegativeInteger(
            _hasOwn(sanitized, 'autoExportSolveSequence')
                ? sanitized.autoExportSolveSequence
                : nextLastReminderSolveSequence,
            nextLastReminderSolveSequence,
        ),
        _normalizeNonNegativeInteger(minimumSolveSequence, 0),
    );

    sanitized.autoExportSolveSequence = nextSolveSequence;
    sanitized.autoExportCheckpointSolveSequence = Math.min(nextSolveSequence, nextCheckpointSolveSequence);
    sanitized.autoExportLastReminderSolveSequence = Math.min(
        nextSolveSequence,
        Math.max(sanitized.autoExportCheckpointSolveSequence, nextLastReminderSolveSequence),
    );
    delete sanitized[LEGACY_AUTO_EXPORT_CHECKPOINT_SOLVE_COUNT_KEY];
    delete sanitized[LEGACY_AUTO_EXPORT_LAST_REMINDER_SOLVE_COUNT_KEY];
    return sanitized;
}

function _sanitizeStoredSettingsForExport(settingsData, { minimumSolveSequence = 0 } = {}) {
    const sanitized = _sanitizeAutoExportSequenceSettings(settingsData, { minimumSolveSequence });

    LOCAL_ONLY_SETTING_KEYS.forEach((key) => {
        delete sanitized[key];
    });

    if (sanitized.settingScopes && typeof sanitized.settingScopes === 'object') {
        sanitized.settingScopes = _normalizeStoredSettingScopes(
            _stripLocalOnlySettingScopes(sanitized.settingScopes),
        );
    }

    return sanitized;
}

function _sanitizeStoredSettingsForImport(settingsData, { minimumSolveSequence = 0 } = {}) {
    return {
        ..._sanitizeStoredSettingsForExport(settingsData, { minimumSolveSequence }),
        zenMode: false,
    };
}

function _stampAutoExportSequenceSettings(settingsData, solveSequence = 0) {
    const normalizedSolveSequence = _normalizeNonNegativeInteger(solveSequence, 0);
    const sanitized = _sanitizeAutoExportSequenceSettings(settingsData, {
        minimumSolveSequence: normalizedSolveSequence,
    });
    return {
        ...sanitized,
        autoExportSolveSequence: normalizedSolveSequence,
        autoExportCheckpointSolveSequence: normalizedSolveSequence,
        autoExportLastReminderSolveSequence: normalizedSolveSequence,
    };
}

function _sanitizeSessionSettingsForTransport(sessionSettings) {
    const source = sessionSettings && typeof sessionSettings === 'object' ? sessionSettings : {};
    const sanitized = { ...source };

    if (_hasOwn(sanitized, 'inspectionTime')) {
        sanitized.inspectionTime = _normalizeInspectionTime(sanitized.inspectionTime);
    }

    LOCAL_ONLY_SESSION_SETTING_KEYS.forEach((key) => {
        delete sanitized[key];
    });

    return sanitized;
}

function _applyImportedBackupValues(data, { replaceMissing = false, autoExportSolveSequence = 0 } = {}) {
    const nextValues = new Map();

    for (const [key, value] of Object.entries(data || {})) {
        if (key === 'version' || key === 'sessions' || !BACKUP_LOCAL_STORAGE_KEY_SET.has(key)) continue;
        nextValues.set(
            key,
            key === 'settings'
                ? _sanitizeStoredSettingsForImport(
                    _stampAutoExportSequenceSettings(value, autoExportSolveSequence),
                    { minimumSolveSequence: autoExportSolveSequence },
                )
                : value,
        );
    }

    if (replaceMissing) {
        BACKUP_LOCAL_STORAGE_KEYS.forEach((key) => {
            if (nextValues.has(key)) {
                save(key, nextValues.get(key));
            } else {
                remove(key);
            }
        });
        return;
    }

    nextValues.forEach((value, key) => {
        save(key, value);
    });
}

function _normalizeImportSessionName(name) {
    return String(name ?? '').trim().toLocaleLowerCase();
}

function _groupSolvesBySessionId(solves) {
    const solvesBySessionId = new Map();

    solves.forEach((solve) => {
        const sessionId = solve?.sessionId;
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;

        if (!solvesBySessionId.has(sessionId)) {
            solvesBySessionId.set(sessionId, []);
        }
        solvesBySessionId.get(sessionId).push(solve);
    });

    return solvesBySessionId;
}

function _buildSolveIdentityKey(solve, {
    roundTimestampToSecond = false,
    includeScramble = false,
} = {}) {
    if (!Number.isFinite(solve?.timestamp) || !Number.isFinite(solve?.time)) {
        return null;
    }

    const timestamp = solve.timestamp;
    const timestampKey = roundTimestampToSecond
        ? Math.floor(timestamp / 1000)
        : timestamp;
    const time = solve.time;
    const baseKey = `${timestampKey}\u0000${time}`;

    if (!includeScramble) return baseKey;

    return `${baseKey}\u0000${String(solve?.scramble ?? '').trim()}`;
}

function _isTimestampSecondAligned(timestamp) {
    return Number.isFinite(timestamp) && timestamp % 1000 === 0;
}

function _pushSolveIdentityQueue(queueMap, key, solve) {
    if (key === null) return;
    if (!queueMap.has(key)) {
        queueMap.set(key, []);
    }
    queueMap.get(key).push(solve);
}

function _getTimestampSecondFallbackQueue(solve, anySecondQueues, secondAlignedQueues, {
    includeScramble = false,
} = {}) {
    const secondKey = _buildSolveIdentityKey(solve, {
        roundTimestampToSecond: true,
        includeScramble,
    });
    if (secondKey === null) return null;

    return _isTimestampSecondAligned(solve.timestamp)
        ? anySecondQueues.get(secondKey)
        : secondAlignedQueues.get(secondKey);
}

function _mergeLogicalSessionSolves(importedSolves, existingSolves, targetSessionId, {
    roundTimestampToSecond = false,
    includeScramble = false,
} = {}) {
    const remainingExistingQueues = new Map();
    const unkeyedExistingSolves = [];
    const mergedSolves = [];

    existingSolves.forEach((solve) => {
        const key = _buildSolveIdentityKey(solve, {
            roundTimestampToSecond,
            includeScramble,
        });
        if (key === null) {
            unkeyedExistingSolves.push(solve);
            return;
        }
        if (!remainingExistingQueues.has(key)) {
            remainingExistingQueues.set(key, []);
        }
        remainingExistingQueues.get(key).push(solve);
    });

    importedSolves.forEach((solve) => {
        const key = _buildSolveIdentityKey(solve, {
            roundTimestampToSecond,
            includeScramble,
        });
        const queue = key === null ? null : remainingExistingQueues.get(key);
        const matchedSolve = Array.isArray(queue) && queue.length > 0
            ? queue.shift()
            : null;

        if (matchedSolve) {
            mergedSolves.push({
                ...matchedSolve,
                ...solve,
                id: matchedSolve.id,
                sessionId: targetSessionId,
            });
            return;
        }

        mergedSolves.push({
            ...solve,
            sessionId: targetSessionId,
        });
    });

    remainingExistingQueues.forEach((queue) => {
        queue.forEach((solve) => {
            mergedSolves.push({
                ...solve,
                sessionId: targetSessionId,
            });
        });
    });
    unkeyedExistingSolves.forEach((solve) => {
        mergedSolves.push({
            ...solve,
            sessionId: targetSessionId,
        });
    });

    return mergedSolves;
}

function _mergeIdOrLogicalSessionSolves(importedSolves, existingSolves, targetSessionId, {
    roundTimestampToSecond = false,
    includeScramble = false,
    allowTimestampSecondFallback = false,
} = {}) {
    const existingQueuesById = new Map();
    const existingQueuesByLogicalKey = new Map();
    const existingQueuesByAnySecondKey = new Map();
    const existingQueuesBySecondAlignedKey = new Map();
    const matchedExistingSolves = new Set();
    const mergedSolves = [];

    existingSolves.forEach((solve) => {
        const id = typeof solve?.id === 'string' ? solve.id : '';
        if (id) {
            _pushSolveIdentityQueue(existingQueuesById, id, solve);
        }

        const logicalKey = _buildSolveIdentityKey(solve, {
            roundTimestampToSecond,
            includeScramble,
        });
        _pushSolveIdentityQueue(existingQueuesByLogicalKey, logicalKey, solve);

        if (allowTimestampSecondFallback) {
            const secondKey = _buildSolveIdentityKey(solve, {
                roundTimestampToSecond: true,
                includeScramble,
            });
            _pushSolveIdentityQueue(existingQueuesByAnySecondKey, secondKey, solve);
            if (_isTimestampSecondAligned(solve?.timestamp)) {
                _pushSolveIdentityQueue(existingQueuesBySecondAlignedKey, secondKey, solve);
            }
        }
    });

    const takeUnmatchedSolve = (queue) => {
        if (!Array.isArray(queue)) return null;

        while (queue.length > 0) {
            const candidate = queue.shift();
            if (!matchedExistingSolves.has(candidate)) return candidate;
        }

        return null;
    };

    importedSolves.forEach((solve) => {
        const importedId = typeof solve?.id === 'string' ? solve.id : '';
        let matchedSolve = importedId
            ? takeUnmatchedSolve(existingQueuesById.get(importedId))
            : null;

        if (!matchedSolve) {
            const logicalKey = _buildSolveIdentityKey(solve, {
                roundTimestampToSecond,
                includeScramble,
            });
            matchedSolve = logicalKey === null
                ? null
                : takeUnmatchedSolve(existingQueuesByLogicalKey.get(logicalKey));
        }

        if (!matchedSolve && allowTimestampSecondFallback) {
            matchedSolve = takeUnmatchedSolve(_getTimestampSecondFallbackQueue(
                solve,
                existingQueuesByAnySecondKey,
                existingQueuesBySecondAlignedKey,
                { includeScramble },
            ));
        }

        if (matchedSolve) {
            matchedExistingSolves.add(matchedSolve);
            mergedSolves.push({
                ...matchedSolve,
                ...solve,
                id: matchedSolve.id,
                sessionId: targetSessionId,
            });
            return;
        }

        mergedSolves.push({
            ...solve,
            sessionId: targetSessionId,
        });
    });

    existingSolves.forEach((solve) => {
        if (matchedExistingSolves.has(solve)) return;

        mergedSolves.push({
            ...solve,
            sessionId: targetSessionId,
        });
    });

    return mergedSolves;
}

function _scoreSolveIdentityOverlap(importedSolves, existingSolves, {
    roundTimestampToSecond = false,
    includeScramble = false,
    allowTimestampSecondFallback = false,
} = {}) {
    const existingQueuesById = new Map();
    const existingQueuesByLogicalKey = new Map();
    const existingQueuesByAnySecondKey = new Map();
    const existingQueuesBySecondAlignedKey = new Map();
    const matchedExistingSolves = new Set();
    let idMatches = 0;
    let logicalMatches = 0;

    existingSolves.forEach((solve) => {
        const id = typeof solve?.id === 'string' ? solve.id : '';
        if (id) {
            _pushSolveIdentityQueue(existingQueuesById, id, solve);
        }

        const logicalKey = _buildSolveIdentityKey(solve, {
            roundTimestampToSecond,
            includeScramble,
        });
        _pushSolveIdentityQueue(existingQueuesByLogicalKey, logicalKey, solve);

        if (allowTimestampSecondFallback) {
            const secondKey = _buildSolveIdentityKey(solve, {
                roundTimestampToSecond: true,
                includeScramble,
            });
            _pushSolveIdentityQueue(existingQueuesByAnySecondKey, secondKey, solve);
            if (_isTimestampSecondAligned(solve?.timestamp)) {
                _pushSolveIdentityQueue(existingQueuesBySecondAlignedKey, secondKey, solve);
            }
        }
    });

    const takeUnmatchedSolve = (queue) => {
        if (!Array.isArray(queue)) return null;

        while (queue.length > 0) {
            const candidate = queue.shift();
            if (!matchedExistingSolves.has(candidate)) return candidate;
        }

        return null;
    };

    importedSolves.forEach((solve) => {
        const id = typeof solve?.id === 'string' ? solve.id : '';
        let matchedSolve = id
            ? takeUnmatchedSolve(existingQueuesById.get(id))
            : null;

        if (matchedSolve) {
            matchedExistingSolves.add(matchedSolve);
            idMatches += 1;
            return;
        }

        const logicalKey = _buildSolveIdentityKey(solve, {
            roundTimestampToSecond,
            includeScramble,
        });
        matchedSolve = logicalKey === null
            ? null
            : takeUnmatchedSolve(existingQueuesByLogicalKey.get(logicalKey));

        if (!matchedSolve && allowTimestampSecondFallback) {
            matchedSolve = takeUnmatchedSolve(_getTimestampSecondFallbackQueue(
                solve,
                existingQueuesByAnySecondKey,
                existingQueuesBySecondAlignedKey,
                { includeScramble },
            ));
        }

        if (matchedSolve) {
            matchedExistingSolves.add(matchedSolve);
            logicalMatches += 1;
        }
    });

    return {
        idMatches,
        logicalMatches,
        score: idMatches + logicalMatches,
    };
}

function _hasEnoughRenamedSessionOverlapEvidence(importedSolves, existingSolves, solveMatchOptions = {}) {
    const importedSessionSolves = Array.isArray(importedSolves) ? importedSolves : [];
    const overlap = _scoreSolveIdentityOverlap(
        importedSessionSolves,
        Array.isArray(existingSolves) ? existingSolves : [],
        solveMatchOptions,
    );

    if (overlap.idMatches > 0 || overlap.score >= 2) return true;
    return overlap.logicalMatches === 1
        && importedSessionSolves.length === 1
        && String(importedSessionSolves[0]?.scramble ?? '').trim().length > 0;
}

function _rankSessionsBySolveOverlap(importedSolves, candidateSessions, existingSolvesBySessionId, solveMatchOptions = {}) {
    return candidateSessions
        .map((session) => {
            const existingSolves = existingSolvesBySessionId.get(session.id) || [];
            return {
                session,
                existingSolveCount: existingSolves.length,
                ..._scoreSolveIdentityOverlap(
                    importedSolves,
                    existingSolves,
                    {
                        includeScramble: true,
                        ...solveMatchOptions,
                    },
                ),
            };
        })
        .sort((a, b) => (
            (b.idMatches - a.idMatches)
            || (b.logicalMatches - a.logicalMatches)
        ));
}

function _pickUnambiguousSessionBySolveOverlap(importedSolves, candidateSessions, existingSolvesBySessionId, solveMatchOptions = {}) {
    const rankedCandidates = _rankSessionsBySolveOverlap(
        importedSolves,
        candidateSessions,
        existingSolvesBySessionId,
        solveMatchOptions,
    );
    const best = rankedCandidates[0] || null;
    if (!best || best.score <= 0) return null;

    const runnerUp = rankedCandidates[1] || null;
    if (
        runnerUp
        && runnerUp.idMatches === best.idMatches
        && runnerUp.logicalMatches === best.logicalMatches
    ) {
        return null;
    }

    return best.session;
}

function _pickUnambiguousSessionByCompleteSolveOverlap(importedSolves, candidateSessions, existingSolvesBySessionId, solveMatchOptions = {}) {
    if (!Array.isArray(importedSolves) || importedSolves.length === 0) return null;

    const rankedCandidates = _rankSessionsBySolveOverlap(
        importedSolves,
        candidateSessions,
        existingSolvesBySessionId,
        solveMatchOptions,
    ).filter((candidate) => candidate.existingSolveCount > 0);
    const best = rankedCandidates[0] || null;
    if (!best || best.score <= 0) return null;

    const requiredOverlap = Math.min(importedSolves.length, best.existingSolveCount);
    if (best.score < requiredOverlap) return null;

    const runnerUp = rankedCandidates[1] || null;
    if (
        runnerUp
        && runnerUp.idMatches === best.idMatches
        && runnerUp.logicalMatches === best.logicalMatches
    ) {
        return null;
    }

    return best.session;
}

function _buildSessionMatchResult(session, { preserveExistingName = false } = {}) {
    if (!session) return null;
    return {
        session,
        preserveExistingName,
    };
}

function _normalizeSessionMatchResult(matchResult) {
    if (!matchResult) {
        return {
            session: null,
            preserveExistingName: false,
        };
    }

    if (matchResult.session && typeof matchResult.session === 'object') {
        return {
            session: matchResult.session,
            preserveExistingName: matchResult.preserveExistingName === true,
        };
    }

    return {
        session: matchResult,
        preserveExistingName: false,
    };
}

function _normalizeMergedSessionOrder(sessions) {
    return sessions.map((session, index) => ({
        ...session,
        order: index,
    }));
}

function _appendItems(target, items) {
    (Array.isArray(items) ? items : []).forEach((item) => {
        target.push(item);
    });
}

function _mergeImportedDataset(
    importedSessions,
    importedSolves,
    {
        existingData = null,
        findExistingSessionMatch = null,
        solveMatchMode = SOLVE_MATCH_MODE_ID,
        solveMatchOptions = {},
    } = {},
) {
    if (!existingData) {
        return {
            dbSessions: importedSessions,
            dbSolves: importedSolves,
            sessionIdMap: new Map(importedSessions.map((session) => [session.id, session.id])),
        };
    }

    const existingSessions = Array.isArray(existingData.sessions) ? existingData.sessions : [];
    const existingSolves = Array.isArray(existingData.solves) ? existingData.solves : [];
    const existingSessionsById = new Map(
        existingSessions.map((session) => [session.id, session]),
    );
    const importedSolvesBySessionId = _groupSolvesBySessionId(importedSolves);
    const existingSolvesBySessionId = _groupSolvesBySessionId(existingSolves);
    const importedSessionEntries = [];
    const matchedExistingSessionIds = new Set();
    const finalSessionIdSet = new Set();
    const sessionIdMap = new Map();

    importedSessions.forEach((importedSession) => {
        const rawSessionMatch = typeof findExistingSessionMatch === 'function'
            ? findExistingSessionMatch(importedSession)
            : (existingSessionsById.get(importedSession.id) || null);
        const {
            session: matchedExistingSession,
            preserveExistingName,
        } = _normalizeSessionMatchResult(rawSessionMatch);
        const targetSessionId = matchedExistingSession?.id || importedSession.id;
        const mergedSession = {
            ...importedSession,
            id: targetSessionId,
            ...(preserveExistingName && typeof matchedExistingSession?.name === 'string'
                ? { name: matchedExistingSession.name }
                : {}),
        };

        if (matchedExistingSession) {
            matchedExistingSessionIds.add(matchedExistingSession.id);
        }

        importedSessionEntries.push({
            importedSession,
            matchedExistingSession,
            mergedSession,
        });
        sessionIdMap.set(importedSession.id, targetSessionId);
        finalSessionIdSet.add(targetSessionId);
    });

    const remainingExistingSessions = existingSessions.filter((session) => (
        !matchedExistingSessionIds.has(session.id)
        && !finalSessionIdSet.has(session.id)
    ));
    const finalSessions = _normalizeMergedSessionOrder([
        ...importedSessionEntries.map(({ mergedSession }) => mergedSession),
        ...remainingExistingSessions,
    ]);
    const finalSolves = [];

    importedSessionEntries.forEach(({ importedSession, matchedExistingSession, mergedSession }) => {
        const importedSessionSolves = importedSolvesBySessionId.get(importedSession.id) || [];
        const existingSessionSolves = matchedExistingSession
            ? (existingSolvesBySessionId.get(matchedExistingSession.id) || [])
            : [];

        if (existingSessionSolves.length === 0) {
            importedSessionSolves.forEach((solve) => {
                finalSolves.push({
                    ...solve,
                    sessionId: mergedSession.id,
                });
            });
            return;
        }

        if (solveMatchMode === SOLVE_MATCH_MODE_LOGICAL_EXACT) {
            _appendItems(
                finalSolves,
                _mergeLogicalSessionSolves(
                    importedSessionSolves,
                    existingSessionSolves,
                    mergedSession.id,
                    solveMatchOptions,
                ),
            );
            return;
        }

        if (solveMatchMode === SOLVE_MATCH_MODE_ID_OR_LOGICAL_EXACT) {
            _appendItems(
                finalSolves,
                _mergeIdOrLogicalSessionSolves(
                    importedSessionSolves,
                    existingSessionSolves,
                    mergedSession.id,
                    solveMatchOptions,
                ),
            );
            return;
        }

        if (solveMatchMode === SOLVE_MATCH_MODE_LOGICAL_CSTIMER) {
            _appendItems(
                finalSolves,
                _mergeLogicalSessionSolves(importedSessionSolves, existingSessionSolves, mergedSession.id, {
                    ...solveMatchOptions,
                    roundTimestampToSecond: true,
                    includeScramble: true,
                }),
            );
            return;
        }

        const importedSolveIds = new Set(importedSessionSolves.map((solve) => solve.id));
        importedSessionSolves.forEach((solve) => {
            finalSolves.push({
                ...solve,
                sessionId: mergedSession.id,
            });
        });
        existingSessionSolves.forEach((solve) => {
            if (importedSolveIds.has(solve.id)) return;
            finalSolves.push({
                ...solve,
                sessionId: mergedSession.id,
            });
        });
    });

    remainingExistingSessions.forEach((session) => {
        const sessionSolves = existingSolvesBySessionId.get(session.id) || [];
        sessionSolves.forEach((solve) => {
            finalSolves.push(solve);
        });
    });

    return {
        dbSessions: finalSessions,
        dbSolves: finalSolves,
        sessionIdMap,
    };
}

function _buildBackupSessionMergeResolver(existingSessions, existingSolves = [], importedSolves = [], solveMatchOptions = {}) {
    const existingSessionsById = new Map(
        existingSessions.map((session) => [session.id, session]),
    );
    const existingSolvesBySessionId = _groupSolvesBySessionId(existingSolves);
    const importedSolvesBySessionId = _groupSolvesBySessionId(importedSolves);
    const sessionsByName = new Map();
    const usedSessionIds = new Set();

    const getScrambleType = (session) => (
        typeof session?.scrambleType === 'string' && session.scrambleType
            ? session.scrambleType
            : ''
    );
    const pushSessionQueue = (map, key, session) => {
        if (!key) return;
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(session);
    };
    const getUnusedSessions = (queue) => {
        if (!Array.isArray(queue)) return null;
        return queue.filter((candidate) => !usedSessionIds.has(candidate.id));
    };
    const chooseCandidate = (candidates, importedSession) => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        return _pickUnambiguousSessionBySolveOverlap(
            importedSolvesBySessionId.get(importedSession.id) || [],
            candidates,
            existingSolvesBySessionId,
            solveMatchOptions,
        );
    };
    const chooseRenamedCandidate = (importedSession) => {
        const importedSessionSolves = importedSolvesBySessionId.get(importedSession.id) || [];
        if (importedSessionSolves.length === 0) return null;

        const unusedSessions = existingSessions.filter((session) => !usedSessionIds.has(session.id));
        const importedScrambleType = getScrambleType(importedSession);
        const candidateGroups = importedScrambleType
            ? [
                unusedSessions.filter((session) => getScrambleType(session) === importedScrambleType),
                unusedSessions.filter((session) => getScrambleType(session) === ''),
            ]
            : [unusedSessions];

        for (const candidates of candidateGroups) {
            const matchedSession = _pickUnambiguousSessionByCompleteSolveOverlap(
                importedSessionSolves,
                candidates,
                existingSolvesBySessionId,
                solveMatchOptions,
            );
            if (
                matchedSession
                && _hasEnoughRenamedSessionOverlapEvidence(
                    importedSessionSolves,
                    existingSolvesBySessionId.get(matchedSession.id) || [],
                    solveMatchOptions,
                )
            ) {
                return matchedSession;
            }
        }

        return null;
    };

    existingSessions.forEach((session) => {
        const normalizedName = _normalizeImportSessionName(session?.name);
        if (!normalizedName) return;

        pushSessionQueue(sessionsByName, normalizedName, session);
    });

    return (importedSession) => {
        const importedSessionId = typeof importedSession?.id === 'string' ? importedSession.id : '';
        if (importedSessionId && existingSessionsById.has(importedSessionId) && !usedSessionIds.has(importedSessionId)) {
            usedSessionIds.add(importedSessionId);
            return existingSessionsById.get(importedSessionId) || null;
        }

        const normalizedName = _normalizeImportSessionName(importedSession?.name);

        const importedScrambleType = getScrambleType(importedSession);
        const sameNameSessions = normalizedName
            ? (getUnusedSessions(sessionsByName.get(normalizedName)) || [])
            : [];
        let matchedSession = null;

        if (importedScrambleType) {
            const exactTypeCandidates = sameNameSessions.filter(
                (session) => getScrambleType(session) === importedScrambleType,
            );
            matchedSession = chooseCandidate(exactTypeCandidates, importedSession);

            if (!matchedSession && exactTypeCandidates.length === 0) {
                matchedSession = chooseCandidate(
                    sameNameSessions.filter((session) => getScrambleType(session) === ''),
                    importedSession,
                );
            }
        } else {
            matchedSession = chooseCandidate(sameNameSessions, importedSession);
        }

        if (!matchedSession) {
            matchedSession = chooseRenamedCandidate(importedSession);
            if (matchedSession) {
                matchedSession = _buildSessionMatchResult(matchedSession, {
                    preserveExistingName: true,
                });
            }
        }

        const { session } = _normalizeSessionMatchResult(matchedSession);
        if (!session) return null;
        usedSessionIds.add(session.id);
        return matchedSession;
    };
}

function _buildCsTimerSessionMergeResolver(
    existingSessions,
    sessionMatchHints = new Map(),
    existingSolves = [],
    importedSolves = [],
    solveMatchOptions = {},
) {
    const existingSessionsById = new Map(
        existingSessions.map((session) => [session.id, session]),
    );
    const existingSolvesBySessionId = _groupSolvesBySessionId(existingSolves);
    const importedSolvesBySessionId = _groupSolvesBySessionId(importedSolves);
    const sessionsByName = new Map();
    const usedSessionIds = new Set();

    const getScrambleType = (session) => (
        typeof session?.scrambleType === 'string' && session.scrambleType
            ? session.scrambleType
            : ''
    );
    const pushSessionQueue = (map, key, session) => {
        if (!key) return;
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(session);
    };
    const getUnusedSessions = (queue) => {
        if (!Array.isArray(queue)) return null;
        return queue.filter((candidate) => !usedSessionIds.has(candidate.id));
    };
    const chooseCandidate = (candidates, importedSession) => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        return _pickUnambiguousSessionBySolveOverlap(
            importedSolvesBySessionId.get(importedSession.id) || [],
            candidates,
            existingSolvesBySessionId,
            solveMatchOptions,
        );
    };
    const chooseNameCandidate = (importedSession) => {
        const normalizedName = _normalizeImportSessionName(importedSession?.name);
        const sameNameSessions = normalizedName
            ? (getUnusedSessions(sessionsByName.get(normalizedName)) || [])
            : [];
        const importedScrambleType = getScrambleType(importedSession);

        if (importedScrambleType) {
            const exactTypeCandidates = sameNameSessions.filter(
                (session) => getScrambleType(session) === importedScrambleType,
            );
            const matchedSession = chooseCandidate(exactTypeCandidates, importedSession);
            if (matchedSession) return matchedSession;

            if (exactTypeCandidates.length === 0) {
                return chooseCandidate(
                    sameNameSessions.filter((session) => getScrambleType(session) === ''),
                    importedSession,
                );
            }

            return null;
        }

        return chooseCandidate(sameNameSessions, importedSession);
    };
    const chooseRenamedCandidate = (importedSession) => {
        const importedSessionSolves = importedSolvesBySessionId.get(importedSession.id) || [];
        if (importedSessionSolves.length === 0) return null;

        const unusedSessions = existingSessions.filter((session) => !usedSessionIds.has(session.id));
        const importedScrambleType = getScrambleType(importedSession);
        const candidateGroups = importedScrambleType
            ? [
                unusedSessions.filter((session) => getScrambleType(session) === importedScrambleType),
                unusedSessions.filter((session) => getScrambleType(session) === ''),
            ]
            : [unusedSessions];

        for (const candidates of candidateGroups) {
            const matchedSession = _pickUnambiguousSessionByCompleteSolveOverlap(
                importedSessionSolves,
                candidates,
                existingSolvesBySessionId,
                solveMatchOptions,
            );
            if (
                matchedSession
                && _hasEnoughRenamedSessionOverlapEvidence(
                    importedSessionSolves,
                    existingSolvesBySessionId.get(matchedSession.id) || [],
                    solveMatchOptions,
                )
            ) {
                return matchedSession;
            }
        }

        return null;
    };

    existingSessions.forEach((session) => {
        const normalizedName = _normalizeImportSessionName(session?.name);
        if (!normalizedName) return;

        pushSessionQueue(sessionsByName, normalizedName, session);
    });

    return (importedSession) => {
        const hintedSessionId = sessionMatchHints.get(importedSession.id) || '';
        if (hintedSessionId && existingSessionsById.has(hintedSessionId) && !usedSessionIds.has(hintedSessionId)) {
            usedSessionIds.add(hintedSessionId);
            return existingSessionsById.get(hintedSessionId) || null;
        }

        let matchedSession = chooseNameCandidate(importedSession);

        if (!matchedSession) {
            matchedSession = chooseRenamedCandidate(importedSession);
            if (matchedSession) {
                matchedSession = _buildSessionMatchResult(matchedSession, {
                    preserveExistingName: true,
                });
            }
        }

        const { session } = _normalizeSessionMatchResult(matchedSession);
        if (!session) return null;
        usedSessionIds.add(session.id);
        return matchedSession;
    };
}

/**
 * Export all timer data as a single JSON object.
 * Reads sessions + solves from IndexedDB, settings from localStorage.
 * @returns {Promise<object>}
 */
export async function exportAll() {
    await _runBeforeDataExportHooks();
    const { sessions, solves } = await db.getAllData();
    const solvesBySessionId = _groupSolvesBySessionId(solves);

    // Reconstruct the old embedded format for export compatibility
    const sessionsWithSolves = sessions.map(session => ({
        ...session,
        ...(session.settings && typeof session.settings === 'object'
            ? { settings: _sanitizeSessionSettingsForTransport(session.settings) }
            : {}),
        solves: (solvesBySessionId.get(session.id) || [])
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(({ sessionId, ...rest }) => rest), // strip sessionId from export
    }));

    const data = { version: STORAGE_VERSION, sessions: sessionsWithSolves };

    BACKUP_LOCAL_STORAGE_KEYS.forEach((key) => {
        if (hasStoredKey(key)) {
            data[key] = key === 'settings'
                ? _sanitizeStoredSettingsForExport(load(key))
                : load(key);
        }
    });

    return data;
}

/**
 * Import data from a JSON object, overwriting existing data.
 * @param {object} data
 */
export async function importAll(data, { mode = IMPORT_MODE_REWRITE, onProgress = null } = {}) {
    if (!data || typeof data !== 'object') return;

    const importMode = _normalizeImportMode(mode);
    const existingData = importMode === IMPORT_MODE_MERGE
        ? await db.getAllData()
        : null;

    // Separate sessions from other data
    const sessions = data.sessions || [];
    const totalSolveCount = _countEmbeddedSolves(sessions);
    const dbSessions = [];
    const dbSolves = [];
    const parseTotal = sessions.length + totalSolveCount;
    const estimatedWriteTotal = 1 + sessions.length + totalSolveCount + (
        importMode === IMPORT_MODE_MERGE
            ? ((existingData?.sessions?.length || 0) + (existingData?.solves?.length || 0))
            : 0
    );
    const estimatedTotalWork = parseTotal + estimatedWriteTotal;
    let parseCompleted = 0;

    _reportImportProgress(onProgress, {
        source: 'backup',
        phase: 'parsing',
        stage: 'sessions',
        completed: 0,
        total: parseTotal,
        processed: 0,
        totalWork: estimatedTotalWork,
        percent: estimatedTotalWork > 0 ? 0 : 100,
        sessionCount: sessions.length,
        solveCount: totalSolveCount,
    });

    for (const session of sessions) {
        dbSessions.push({
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            order: Number.isFinite(session.order) ? session.order : dbSessions.length,
            ...(typeof session.scrambleType === 'string' ? { scrambleType: session.scrambleType } : {}),
            ...(session.settings && typeof session.settings === 'object'
                ? { settings: _sanitizeSessionSettingsForTransport(session.settings) }
                : {}),
        });
        parseCompleted += 1;

        if (Array.isArray(session.solves)) {
            for (const solve of session.solves) {
                dbSolves.push({
                    ...solve,
                    sessionId: session.id,
                });
                parseCompleted += 1;

                if (parseCompleted % IMPORT_PROGRESS_YIELD_INTERVAL === 0 || parseCompleted === parseTotal) {
                    _reportImportProgress(onProgress, {
                        source: 'backup',
                        phase: 'parsing',
                        stage: 'solves',
                        completed: parseCompleted,
                        total: parseTotal,
                        processed: parseCompleted,
                        totalWork: estimatedTotalWork,
                        percent: estimatedTotalWork > 0 ? (parseCompleted / estimatedTotalWork) * 100 : 100,
                        sessionCount: sessions.length,
                        solveCount: totalSolveCount,
                    });

                    if (parseCompleted < parseTotal) {
                        await _waitForNextFrame();
                    }
                }
            }
        }
    }

    let finalSessions = dbSessions;
    let finalSolves = dbSolves;
    let importedBackupValues = data;

    if (importMode === IMPORT_MODE_MERGE) {
        _reportImportProgress(onProgress, {
            source: 'backup',
            phase: 'merging',
            stage: 'solves',
            completed: parseCompleted,
            total: parseTotal,
            processed: parseCompleted,
            totalWork: estimatedTotalWork,
            percent: estimatedTotalWork > 0 ? (parseCompleted / estimatedTotalWork) * 100 : 100,
            sessionCount: dbSessions.length,
            solveCount: dbSolves.length,
        });

        const mergedData = _mergeImportedDataset(dbSessions, dbSolves, {
            existingData,
            findExistingSessionMatch: _buildBackupSessionMergeResolver(
                existingData.sessions || [],
                existingData.solves || [],
                dbSolves,
                {
                    includeScramble: true,
                    allowTimestampSecondFallback: true,
                },
            ),
            solveMatchMode: SOLVE_MATCH_MODE_ID_OR_LOGICAL_EXACT,
            solveMatchOptions: {
                includeScramble: true,
                allowTimestampSecondFallback: true,
            },
        });
        finalSessions = mergedData.dbSessions;
        finalSolves = mergedData.dbSolves;
        importedBackupValues = { ...data };
        if (_hasOwn(data, 'activeSessionId')) {
            importedBackupValues.activeSessionId = mergedData.sessionIdMap.get(data.activeSessionId) || data.activeSessionId;
        }
    }

    const totalWork = parseTotal + 1 + finalSessions.length + finalSolves.length;

    await _replaceImportedData(finalSessions, finalSolves, {
        source: 'backup',
        onProgress,
        processedOffset: parseTotal,
        totalWork,
    });

    // Write remaining import-backed localStorage keys (settings, active session,
    // selected scramble type). Cache/runtime keys stay device-local.
    _applyImportedBackupValues(importedBackupValues, {
        replaceMissing: true,
        autoExportSolveSequence: finalSolves.length,
    });

    _reportImportProgress(onProgress, {
        source: 'backup',
        phase: 'complete',
        stage: 'complete',
        completed: totalWork,
        total: totalWork,
        processed: totalWork,
        totalWork,
        percent: 100,
        sessionCount: finalSessions.length,
        solveCount: finalSolves.length,
    });
}

function _parseDelimitedRecords(text, delimiter = ';') {
    const records = [];
    let currentRecord = [];
    let currentField = '';
    let inQuotes = false;
    let lineNumber = 1;

    const pushRecord = () => {
        currentRecord.push(currentField);
        const hasContent = currentRecord.some(field => field.length > 0);
        if (hasContent) {
            records.push(currentRecord);
        }
        currentRecord = [];
        currentField = '';
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                currentField += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            currentRecord.push(currentField);
            currentField = '';
            continue;
        }

        if (char === '\n' && !inQuotes) {
            pushRecord();
            lineNumber += 1;
            continue;
        }

        currentField += char;

        if (char === '\n') {
            lineNumber += 1;
        }
    }

    if (inQuotes) {
        throw new Error(`Unterminated quoted field near line ${lineNumber}.`);
    }

    if (currentField.length > 0 || currentRecord.length > 0) {
        pushRecord();
    }

    return records;
}

function _normalizeImportText(text) {
    return String(text || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n');
}

function _isSessionCsvHeader(fields) {
    return fields.length === SESSION_CSV_HEADERS.length
        && SESSION_CSV_HEADERS.every((header, index) => fields[index] === header);
}

function _hasSessionCsvHeaderAndFirstRowShape(records) {
    if (!records.length || !_isSessionCsvHeader(records[0])) return false;

    const firstDataRecord = records.find((_, index) => index > 0);
    return !firstDataRecord || firstDataRecord.length === SESSION_CSV_HEADERS.length;
}

function _splitFirstLine(text) {
    const lineBreakIndex = text.indexOf('\n');
    if (lineBreakIndex === -1) {
        return [text, ''];
    }

    return [
        text.slice(0, lineBreakIndex),
        text.slice(lineBreakIndex + 1),
    ];
}

function _parseSessionCsvRecords(text) {
    let firstParseError = null;

    for (const delimiter of SESSION_CSV_DELIMITERS) {
        try {
            const records = _parseDelimitedRecords(text, delimiter);
            if (_hasSessionCsvHeaderAndFirstRowShape(records)) {
                return records;
            }
        } catch (error) {
            firstParseError ??= error;
        }
    }

    try {
        const [headerText, bodyText] = _splitFirstLine(text);
        const [header] = _parseDelimitedRecords(headerText, ',');

        if (_isSessionCsvHeader(header || [])) {
            const bodyRecords = _parseDelimitedRecords(bodyText, ';');
            const firstDataRecord = bodyRecords[0];

            if (!firstDataRecord || firstDataRecord.length === SESSION_CSV_HEADERS.length) {
                return [header, ...bodyRecords];
            }
        }
    } catch (error) {
        firstParseError ??= error;
    }

    if (firstParseError) {
        throw firstParseError;
    }

    return null;
}

function _mapSessionCsvPenalty(value) {
    if (value === '1') return '+2';
    if (value === '2') return 'DNF';
    return null;
}

function _isTwistyTimerOtherTimersRecord(fields) {
    if (fields.length !== 3) return false;

    const time = Number(String(fields[0] || '').trim());
    const scramble = String(fields[1] || '').trim();
    const timestamp = String(fields[2] || '').trim();

    return Number.isFinite(time)
        && time >= 0
        && scramble.length > 0
        && /^\d{4}-\d{2}-\d{2}T/.test(timestamp)
        && Number.isFinite(Date.parse(timestamp));
}

export function isTwistyTimerOtherTimersCsvFormat(text) {
    try {
        const records = _parseDelimitedRecords(_normalizeImportText(text), ';');
        return records.length > 0
            && records.every(_isTwistyTimerOtherTimersRecord);
    } catch (_) {
        return false;
    }
}

export function isSessionCsvFormat(text) {
    try {
        return Boolean(_parseSessionCsvRecords(_normalizeImportText(text)));
    } catch (_) {
        return false;
    }
}

export async function convertSessionCsv(text, { onProgress = null } = {}) {
    const normalized = _normalizeImportText(text);
    const records = _parseSessionCsvRecords(normalized);

    if (!records) {
        const fallbackRecords = _parseDelimitedRecords(normalized);
        if (fallbackRecords.length === 0) {
            throw new Error('Empty import file.');
        }

        const fallbackHeader = fallbackRecords[0] || [];
        throw new Error(`Unsupported session CSV header. Expected: ${SESSION_CSV_HEADERS.join(' | ')}. Received: ${fallbackHeader.join(' | ')}`);
    }

    if (records.length === 0) {
        throw new Error('Empty import file.');
    }

    const header = records[0];
    if (!_isSessionCsvHeader(header)) {
        throw new Error(`Unsupported session CSV header. Expected: ${SESSION_CSV_HEADERS.join(' | ')}. Received: ${header.join(' | ')}`);
    }

    const sessionsByName = new Map();
    const sessionOrder = [];
    const totalRows = Math.max(0, records.length - 1);

    _reportImportProgress(onProgress, {
        source: 'csv',
        phase: 'parsing',
        stage: 'rows',
        completed: 0,
        total: totalRows,
        processed: 0,
        totalWork: totalRows,
        percent: totalRows > 0 ? 0 : 100,
    });

    for (let lineIndex = 1; lineIndex < records.length; lineIndex++) {
        const fields = records[lineIndex];
        if (fields.length !== SESSION_CSV_HEADERS.length) {
            throw new Error(`Invalid row at line ${lineIndex + 1}. Expected ${SESSION_CSV_HEADERS.length} fields, received ${fields.length}.`);
        }

        const [, rawCategory, rawTime, rawDate, rawScramble, rawPenalty, rawComment] = fields;
        const name = rawCategory.trim() || `Session ${sessionOrder.length + 1}`;
        const time = Number(rawTime);
        const timestamp = Number(rawDate);

        if (!Number.isFinite(time) || time < 0 || !Number.isFinite(timestamp) || timestamp < 0) {
            throw new Error(`Invalid time data at line ${lineIndex + 1}. Time="${rawTime}", Date="${rawDate}"`);
        }

        let session = sessionsByName.get(name);
        if (!session) {
            session = {
                id: _genId(),
                name,
                createdAt: timestamp,
                order: sessionOrder.length,
                solves: [],
            };
            sessionsByName.set(name, session);
            sessionOrder.push(session);
        } else {
            session.createdAt = Math.min(session.createdAt, timestamp);
        }

        session.solves.push({
            id: _genId(),
            time: Math.round(time),
            scramble: rawScramble || '',
            isManual: false,
            penalty: _mapSessionCsvPenalty(rawPenalty.trim()),
            timestamp,
            comment: rawComment || '',
        });

        const completed = lineIndex;
        if (completed % IMPORT_PROGRESS_YIELD_INTERVAL === 0 || completed === totalRows) {
            _reportImportProgress(onProgress, {
                source: 'csv',
                phase: 'parsing',
                stage: 'rows',
                completed,
                total: totalRows,
                processed: completed,
                totalWork: totalRows,
                percent: totalRows > 0 ? (completed / totalRows) * 100 : 100,
            });

            if (completed < totalRows) {
                await _waitForNextFrame();
            }
        }
    }

    sessionOrder.forEach(session => {
        session.solves.sort((a, b) => a.timestamp - b.timestamp);
    });

    const dbSessions = sessionOrder.map((session) => ({
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        order: session.order,
    }));
    const dbSolves = [];

    sessionOrder.forEach((session) => {
        session.solves.forEach((solve) => {
            dbSolves.push({
                ...solve,
                sessionId: session.id,
            });
        });
    });

    return {
        dbSessions,
        dbSolves,
        backupValues: {
            activeSessionId: sessionOrder[0]?.id ?? null,
        },
    };
}

export async function importSessionCsv(text, { mode = IMPORT_MODE_REWRITE, onProgress = null } = {}) {
    const importMode = _normalizeImportMode(mode);
    const PARSE_PERCENT = 45;
    const WRITE_PERCENT = 55;
    const csvParseProgress = (snapshot) => {
        const parseFraction = snapshot.total > 0 ? (snapshot.completed / snapshot.total) : 1;
        _reportImportProgress(onProgress, {
            ...snapshot,
            source: 'csv',
            percent: parseFraction * PARSE_PERCENT,
            totalWork: 100,
        });
    };
    const { dbSessions, dbSolves, backupValues } = await convertSessionCsv(text, {
        onProgress: csvParseProgress,
    });
    const writeProgress = (snapshot) => {
        const writeFraction = snapshot.total > 0 ? (snapshot.completed / snapshot.total) : 1;
        _reportImportProgress(onProgress, {
            ...snapshot,
            source: 'csv',
            percent: PARSE_PERCENT + (writeFraction * WRITE_PERCENT),
            totalWork: 100,
        });
    };

    let finalSessions = dbSessions;
    let finalSolves = dbSolves;
    let activeSessionId = backupValues.activeSessionId ?? null;

    if (importMode === IMPORT_MODE_MERGE) {
        _reportImportProgress(onProgress, {
            source: 'csv',
            phase: 'merging',
            stage: 'solves',
            completed: 0,
            total: 0,
            processed: 45,
            totalWork: 100,
            percent: PARSE_PERCENT,
            sessionCount: dbSessions.length,
            solveCount: dbSolves.length,
        });

        const existingData = await db.getAllData();
        const mergedData = _mergeImportedDataset(dbSessions, dbSolves, {
            existingData,
            findExistingSessionMatch: _buildBackupSessionMergeResolver(
                existingData.sessions || [],
                existingData.solves || [],
                dbSolves,
                { includeScramble: true },
            ),
            solveMatchMode: SOLVE_MATCH_MODE_LOGICAL_EXACT,
            solveMatchOptions: {
                includeScramble: true,
            },
        });

        finalSessions = mergedData.dbSessions;
        finalSolves = mergedData.dbSolves;
        activeSessionId = mergedData.sessionIdMap.get(activeSessionId) || activeSessionId;
    }

    await _replaceImportedData(finalSessions, finalSolves, {
        source: 'csv',
        onProgress: writeProgress,
    });

    _applyImportedBackupValues({
        ...backupValues,
        activeSessionId,
    }, {
        autoExportSolveSequence: finalSolves.length,
    });

    _reportImportProgress(onProgress, {
        source: 'csv',
        phase: 'complete',
        stage: 'complete',
        completed: 100,
        total: 100,
        processed: 100,
        totalWork: 100,
        percent: 100,
        sessionCount: finalSessions.length,
        solveCount: finalSolves.length,
    });
}

// ──── csTimer Format Conversion ────

const UKRA_TIMER_CSTIMER_META_KEY = 'ukraTimerMeta';
const UKRA_TIMER_CSTIMER_META_VERSION = 1;
const UKRA_TIMER_CSTIMER_SESSION_META_ID_KEY = 'ukraTimerSessionId';
const CSTIMER_SCRAMBLE_TYPE_TO_INTERNAL = Object.freeze({
    '222so': '222',
    '444wca': '444',
    '555wca': '555',
    '666wca': '666',
    '777wca': '777',
    sqrs: 'sq1',
    skbso: 'skewb',
    pyrso: 'pyram',
    mgmp: 'minx',
    clkwca: 'clock',
    pll: 'pll',
    oll: 'll',
    lsll2: 'lsll',
    zbll: 'zbll',
});
const INTERNAL_SCRAMBLE_TYPE_TO_CSTIMER = Object.freeze({
    '222': '222so',
    '333': null,
    '444': '444wca',
    '555': '555wca',
    '666': '666wca',
    '777': '777wca',
    sq1: 'sqrs',
    skewb: 'skbso',
    pyram: 'pyrso',
    minx: 'mgmp',
    clock: 'clkwca',
    pll: 'pll',
    ll: 'oll',
    lsll: 'lsll2',
    zbll: 'zbll',
});
const CSTIMER_IMPORT_SETTING_DEFAULTS = Object.freeze({
    inspectionTime: 'off',
    inspectionAlerts: 'voice',
    timerUpdate: '0.1s',
    timeEntryMode: 'timer',
    multiPhaseCount: 1,
    autoExportEvery100Solves: AUTO_EXPORT_EVERY_100_SOLVES_REMIND,
    hideUIWhileSolving: true,
    pillSize: 'medium',
    showDelta: true,
    backgroundImageSource: 'none',
    backgroundImageUrl: '',
    summaryStatsPreset: 'basic',
    summaryStatsCustom: 'mo3 ao5 ao12 ao100',
    mainStatsSource: 'time',
    solvesTableStat1: 'ao5',
    solvesTableStat2: 'ao12',
});
const CSTIMER_TRAINING_FILTER_LENGTHS = Object.freeze({
    pll: 21,
    oll: 58,
    lsll2: 42,
    zbll: 493,
});
const CSTIMER_EXPORT_SETTING_DEFAULTS = Object.freeze({
    inspectionTime: 'off',
    inspectionAlerts: 'off',
    timerUpdate: '0.01s',
    timeEntryMode: 'timer',
    multiPhaseCount: 1,
    autoExportEvery100Solves: AUTO_EXPORT_EVERY_100_SOLVES_NEVER,
    dailyStreakGoal: 0,
    summaryStatsPreset: 'basic',
    summaryStatsCustom: 'mo3 ao5 ao12 ao100',
    mainStatsSource: 'time',
    solvesTableStat1: 'ao5',
    solvesTableStat2: 'ao12',
    hideUIWhileSolving: true,
    pillSize: 'medium',
    showDelta: false,
    cameraBackgroundEnabled: false,
    cameraBackgroundSuspended: false,
    theme: 'default',
    backgroundImageSource: 'none',
    backgroundImageUrl: '',
    backgroundImageOverlayColor: 'rgba(0, 0, 0, 0.9)',
});
const CSTIMER_SESSION_SETTING_DEFAULTS = Object.freeze({
    inspectionTime: 'off',
    inspectionAlerts: 'voice',
    timerUpdate: '0.1s',
    timeEntryMode: 'timer',
    multiPhaseCount: 1,
    summaryStatsPreset: 'basic',
    summaryStatsCustom: 'mo3 ao5 ao12 ao100',
    mainStatsSource: 'time',
    solvesTableStat1: 'ao5',
    solvesTableStat2: 'ao12',
    hideUIWhileSolving: true,
    pillSize: 'medium',
    showDelta: true,
});
const CSTIMER_NATIVE_SETTING_KEYS = Object.freeze([
    'inspectionTime',
    'inspectionAlerts',
    'timerUpdate',
    'timeEntryMode',
    'autoExportEvery100Solves',
    'hideUIWhileSolving',
    'pillSize',
    'showDelta',
    'backgroundImageSource',
    'backgroundImageUrl',
    'summaryStatsPreset',
    'summaryStatsCustom',
    'solvesTableStat1',
    'solvesTableStat2',
]);
const CSTIMER_NATIVE_SETTING_KEY_SET = new Set(CSTIMER_NATIVE_SETTING_KEYS);
const CSTIMER_NATIVE_SETTING_PROPERTY_KEYS = Object.freeze({
    inspectionTime: Object.freeze(['useIns']),
    inspectionAlerts: Object.freeze(['voiceIns']),
    timerUpdate: Object.freeze(['timeU']),
    timeEntryMode: Object.freeze(['input']),
    autoExportEvery100Solves: Object.freeze(['atexpa']),
    hideUIWhileSolving: Object.freeze(['ahide']),
    pillSize: Object.freeze(['showAvg']),
    showDelta: Object.freeze(['showDiff']),
    backgroundImageSource: Object.freeze(['bgImgS', 'bgImgSrc']),
    backgroundImageUrl: Object.freeze(['bgImgS', 'bgImgSrc']),
    summaryStatsPreset: Object.freeze(['statal', 'statalu']),
    summaryStatsCustom: Object.freeze(['statal', 'statalu']),
    solvesTableStat1: Object.freeze(['stat1l', 'stat1t']),
    solvesTableStat2: Object.freeze(['stat2l', 'stat2t']),
});
const CSTIMER_NATIVE_PROPERTY_DEFAULTS = Object.freeze({
    useIns: 'n',
    voiceIns: '1',
    timeU: 'c',
    input: 't',
    atexpa: 'a',
    ahide: true,
    showAvg: true,
    showDiff: 'rg',
    bgImgS: 'n',
    bgImgSrc: '',
    stat1l: 5,
    stat1t: 0,
    stat2l: 12,
    stat2t: 0,
    statal: 'mo3 ao5 ao12 ao100',
    statalu: 'mo3 ao5 ao12 ao100',
});
const MAIN_STATS_SOURCE_TIME = 'time';
const MAX_PHASE_COUNT = 10;
const SUMMARY_STATS_PRESET_STRINGS = Object.freeze({
    extended: 'mo3 ao5 ao12 ao25 ao50 ao100',
    full: 'mo3 ao5 ao12 ao25 ao50 ao100 ao200 ao500 ao1000 ao2000 ao5000 ao10000',
});
const CSTIMER_SESSION_SCOPE_MAPPINGS = Object.freeze([
    Object.freeze({ settingKeys: Object.freeze(['inspectionTime']), propertyKeys: Object.freeze(['useIns']) }),
    Object.freeze({ settingKeys: Object.freeze(['inspectionAlerts']), propertyKeys: Object.freeze(['voiceIns']) }),
    Object.freeze({ settingKeys: Object.freeze(['timerUpdate']), propertyKeys: Object.freeze(['timeU']) }),
    Object.freeze({ settingKeys: Object.freeze(['timeEntryMode']), propertyKeys: Object.freeze(['input']) }),
    Object.freeze({ settingKeys: Object.freeze(['hideUIWhileSolving']), propertyKeys: Object.freeze(['ahide']) }),
    Object.freeze({ settingKeys: Object.freeze(['pillSize']), propertyKeys: Object.freeze(['showAvg']) }),
    Object.freeze({ settingKeys: Object.freeze(['showDelta']), propertyKeys: Object.freeze(['showDiff']) }),
    Object.freeze({ settingKeys: Object.freeze(['solvesTableStat1']), propertyKeys: Object.freeze(['stat1l', 'stat1t']) }),
    Object.freeze({ settingKeys: Object.freeze(['solvesTableStat2']), propertyKeys: Object.freeze(['stat2l', 'stat2t']) }),
    Object.freeze({ settingKeys: SUMMARY_STATS_SCOPE_SETTING_KEYS, propertyKeys: Object.freeze(['statal', 'statalu']) }),
]);
const CSTIMER_COMPATIBLE_SESSION_SETTING_KEYS = Object.freeze(
    CSTIMER_SESSION_SCOPE_MAPPINGS.reduce((keys, mapping) => {
        mapping.settingKeys.forEach((key) => {
            if (!keys.includes(key)) {
                keys.push(key);
            }
        });
        return keys;
    }, ['summaryStatsList']),
);
const CSTIMER_COMPATIBLE_SESSION_SETTING_KEY_SET = new Set(CSTIMER_COMPATIBLE_SESSION_SETTING_KEYS);

function _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function _parsePositiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function _normalizePhaseCount(value, fallback = 1) {
    const parsed = Math.floor(Number(value));
    const fallbackValue = Math.floor(Number(fallback));
    const safeFallback = Number.isFinite(fallbackValue)
        ? Math.min(MAX_PHASE_COUNT, Math.max(1, fallbackValue))
        : 1;

    if (!Number.isFinite(parsed)) return safeFallback;
    return Math.min(MAX_PHASE_COUNT, Math.max(1, parsed));
}

function _normalizeMainStatsSource(value) {
    if (value === MAIN_STATS_SOURCE_TIME) return MAIN_STATS_SOURCE_TIME;

    const phaseMatch = String(value ?? '').trim().toLowerCase().match(/^phase-([1-9]\d*)$/);
    if (phaseMatch) {
        return `phase-${Number(phaseMatch[1])}`;
    }

    const csTimerPhaseMatch = String(value ?? '').trim().toLowerCase().match(/^p([1-9]\d*)$/);
    if (csTimerPhaseMatch) {
        return `phase-${Number(csTimerPhaseMatch[1])}`;
    }

    return MAIN_STATS_SOURCE_TIME;
}

function _mapCsTimerStatsSourceToInternal(value) {
    return _normalizeMainStatsSource(value);
}

function _mapInternalMainStatsSourceToCsTimer(value) {
    const source = _normalizeMainStatsSource(value);
    const phaseMatch = source.match(/^phase-([1-9]\d*)$/);
    return phaseMatch ? `p${Number(phaseMatch[1])}` : '';
}

function _normalizePhaseValueList(values, limit = MAX_PHASE_COUNT) {
    return (Array.isArray(values) ? values : [])
        .map((value) => Math.round(Number(value)))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .slice(0, limit);
}

function _looksLikeCsTimerPhaseMarkers(markers, rawTime) {
    if (!Array.isArray(markers) || markers.length === 0) return false;

    let previous = Math.round(Number(rawTime));
    if (!Number.isFinite(previous) || previous < 0) return false;

    return markers.every((marker) => {
        const isValid = Number.isFinite(marker) && marker >= 0 && marker <= previous;
        previous = marker;
        return isValid;
    });
}

function _convertCsTimerPhaseDataToInternal(rawPhaseValues, rawTime, {
    declaredPhaseCount = null,
} = {}) {
    const rawValues = _normalizePhaseValueList(rawPhaseValues);
    if (rawValues.length === 0) {
        return { phaseSplits: [], phaseCount: 1 };
    }

    const normalizedDeclaredPhaseCount = declaredPhaseCount == null
        ? null
        : _normalizePhaseCount(declaredPhaseCount, rawValues.length + 1);
    const inferredPhaseCount = _normalizePhaseCount(rawValues.length + 1, rawValues.length + 1);
    const phaseCount = Math.max(normalizedDeclaredPhaseCount || 0, inferredPhaseCount);

    const markerCount = Math.min(rawValues.length, Math.max(0, phaseCount - 1), MAX_PHASE_COUNT - 1);
    const markers = rawValues.slice(0, markerCount);
    if (_looksLikeCsTimerPhaseMarkers(markers, rawTime)) {
        const phaseSplits = [];
        let previous = Math.round(Number(rawTime));
        markers.forEach((marker) => {
            phaseSplits.push(Math.max(0, previous - marker));
            previous = marker;
        });
        phaseSplits.push(Math.max(0, previous));

        // csTimer stores phase markers from the final phase backwards. Convert
        // them back to the left-to-right phase order shown in csTimer's UI.
        phaseSplits.reverse();

        return {
            phaseSplits: phaseSplits.slice(0, MAX_PHASE_COUNT),
            phaseCount: _normalizePhaseCount(phaseSplits.length, phaseCount),
        };
    }

    return {
        phaseSplits: rawValues.slice(0, MAX_PHASE_COUNT),
        phaseCount: _normalizePhaseCount(rawValues.length, phaseCount),
    };
}

function _buildCsTimerPhaseMarkersFromInternal(phaseSplits) {
    const normalizedSplits = _normalizePhaseValueList(phaseSplits);
    if (normalizedSplits.length < 2) return [];

    const csTimerOrderedSplits = normalizedSplits.slice().reverse();
    let remaining = csTimerOrderedSplits.reduce((sum, value) => sum + value, 0);
    return csTimerOrderedSplits.slice(0, -1).map((split) => {
        remaining = Math.max(0, remaining - split);
        return Math.round(remaining);
    });
}

function _normalizeTokenListString(value) {
    return String(value ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
}

function _normalizeStoredSettingScopes(scopeMap) {
    return normalizeSettingScopes(scopeMap);
}

function _parseUkraTimerCsTimerMeta(rawValue) {
    let parsed = rawValue;

    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch (_) {
            return null;
        }
    }

    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
}

function _getUkraTimerCsTimerMetaPayload(settingsData, sessionsData = []) {
    return JSON.stringify({
        version: UKRA_TIMER_CSTIMER_META_VERSION,
        settings: settingsData,
        sessions: sessionsData,
    });
}

function _mapCsTimerScrambleTypeToInternal(type) {
    const normalized = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (!normalized) return '333';
    return CSTIMER_SCRAMBLE_TYPE_TO_INTERNAL[normalized] || '333';
}

function _mapInternalScrambleTypeToCsTimer(type) {
    const normalized = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (!normalized) return null;
    return _hasOwn(INTERNAL_SCRAMBLE_TYPE_TO_CSTIMER, normalized)
        ? INTERNAL_SCRAMBLE_TYPE_TO_CSTIMER[normalized]
        : null;
}

function _buildCsTimerScrambleFilter(csType) {
    if (!csType) return null;

    const caseCount = CSTIMER_TRAINING_FILTER_LENGTHS[csType];
    if (caseCount) {
        return [csType, Array(caseCount).fill(1)];
    }

    return [csType, null];
}

function _mapRollingStatTokenToCsTimer(token) {
    const match = String(token ?? '').trim().toLowerCase().match(/^(mo|ao)([1-9]\d*)$/);
    if (!match) return null;

    const length = Number(match[2]);
    if (!Number.isInteger(length) || length <= 0) return null;

    return {
        length,
        type: match[1] === 'mo' ? '1' : null,
    };
}

function _mapCsTimerRollingStatToInternal(lengthValue, typeValue) {
    const length = _parsePositiveInteger(lengthValue);
    if (!length) return null;

    const isMean = String(typeValue ?? '') === '1';
    const token = `${isMean ? 'mo' : 'ao'}${length}`;
    if (!/^(mo|ao)([1-9]\d*)$/.test(token)) return null;

    if (token.startsWith('mo') && length < 2) return null;
    if (token.startsWith('ao') && length < 3) return null;

    return token;
}

function _deriveSummarySettingsFromCsTimerProperties(properties) {
    const hasStatal = _hasOwn(properties, 'statal');
    const hasStatalu = _hasOwn(properties, 'statalu');
    if (!hasStatal && !hasStatalu) return {};

    const statal = _normalizeTokenListString(properties?.statal);
    const statalu = _normalizeTokenListString(properties?.statalu);

    if (statal === 'u') {
        return {
            summaryStatsPreset: 'custom',
            summaryStatsCustom: statalu,
        };
    }

    if (!statal) {
        const settingsData = { summaryStatsPreset: 'basic' };
        if (statalu) settingsData.summaryStatsCustom = statalu;
        return settingsData;
    }

    if (statal === SUMMARY_STATS_PRESET_STRINGS.extended) {
        const settingsData = { summaryStatsPreset: 'extended' };
        if (statalu) settingsData.summaryStatsCustom = statalu;
        return settingsData;
    }

    if (statal === SUMMARY_STATS_PRESET_STRINGS.full) {
        const settingsData = { summaryStatsPreset: 'full' };
        if (statalu) settingsData.summaryStatsCustom = statalu;
        return settingsData;
    }

    return {
        summaryStatsPreset: 'custom',
        summaryStatsCustom: statalu || statal,
    };
}

function _buildCsTimerSummaryProperties(settingsData) {
    const preset = String(settingsData?.summaryStatsPreset || 'basic').toLowerCase();
    const custom = _normalizeTokenListString(settingsData?.summaryStatsCustom);
    const result = {};

    if (preset === 'custom') {
        result.statal = 'u';
    } else if (preset === 'extended') {
        result.statal = SUMMARY_STATS_PRESET_STRINGS.extended;
    } else if (preset === 'full') {
        result.statal = SUMMARY_STATS_PRESET_STRINGS.full;
    }

    if (custom) {
        result.statalu = custom;
    }

    return result;
}

function _getEffectiveComparableCsTimerProperties(properties) {
    const source = properties && typeof properties === 'object' ? properties : {};
    return {
        ...CSTIMER_NATIVE_PROPERTY_DEFAULTS,
        ...source,
    };
}

function _metadataSettingMatchesImportedCsTimerState(key, metadataSettings, properties, { treatMissingAsDefaults = true } = {}) {
    if (!_hasOwn(metadataSettings, key)) return false;

    const propertyKeys = CSTIMER_NATIVE_SETTING_PROPERTY_KEYS[key];
    if (!Array.isArray(propertyKeys) || propertyKeys.length === 0) return false;

    const metadataComparableProperties = _buildCsTimerCompatibleProperties(metadataSettings, {
        includeBackgroundImage: true,
    });
    const importedComparableProperties = treatMissingAsDefaults
        ? _getEffectiveComparableCsTimerProperties(properties)
        : (properties && typeof properties === 'object' ? properties : {});

    return propertyKeys.every((propertyKey) => {
        const metadataValue = _hasOwn(metadataComparableProperties, propertyKey)
            ? metadataComparableProperties[propertyKey]
            : (treatMissingAsDefaults ? CSTIMER_NATIVE_PROPERTY_DEFAULTS[propertyKey] : undefined);
        const importedValue = _hasOwn(importedComparableProperties, propertyKey)
            ? importedComparableProperties[propertyKey]
            : (treatMissingAsDefaults ? CSTIMER_NATIVE_PROPERTY_DEFAULTS[propertyKey] : undefined);
        return Object.is(importedValue, metadataValue);
    });
}

function _filterSessionScopeMap(scopeMap, predicate) {
    const source = normalizeSettingScopes(scopeMap);
    const filtered = {};

    Object.entries(source).forEach(([key, scope]) => {
        if (!predicate(key)) return;
        if (scope === SETTING_SCOPE_SESSION) {
            filtered[key] = SETTING_SCOPE_SESSION;
        } else if (scope === SETTING_SCOPE_GLOBAL) {
            filtered[key] = SETTING_SCOPE_GLOBAL;
        }
    });

    return filtered;
}

function _stripCsTimerCompatibleSettingScopes(scopeMap) {
    return _filterSessionScopeMap(scopeMap, (key) => !CSTIMER_COMPATIBLE_SESSION_SETTING_KEY_SET.has(key));
}

function _deriveSessionSettingScopesFromCsTimer(properties) {
    const scopeMap = {};

    CSTIMER_SESSION_SCOPE_MAPPINGS.forEach(({ settingKeys, propertyKeys }) => {
        const hasSessionScopeFlag = propertyKeys.some((propertyKey) => properties?.[`sr_${propertyKey}`] === true);
        if (!hasSessionScopeFlag) return;

        settingKeys.forEach((settingKey) => {
            scopeMap[settingKey] = SETTING_SCOPE_SESSION;
        });
    });

    return scopeMap;
}

function _getEffectiveCsTimerExportSettings(storedSettingsData, session = null) {
    const source = storedSettingsData && typeof storedSettingsData === 'object' ? storedSettingsData : {};
    const effectiveSettings = {
        ...CSTIMER_EXPORT_SETTING_DEFAULTS,
        ...source,
    };
    const settingScopes = normalizeSettingScopes(source.settingScopes);
    const sessionSettings = session?.settings && typeof session.settings === 'object'
        ? session.settings
        : {};

    Object.entries(sessionSettings).forEach(([key, value]) => {
        if (settingScopes[key] !== SETTING_SCOPE_SESSION) return;
        effectiveSettings[key] = value;
    });

    const activeThemeId = typeof effectiveSettings.theme === 'string' ? effectiveSettings.theme : 'default';
    const activeCustomThemeBackground = source.customThemeBackgrounds
        && typeof source.customThemeBackgrounds === 'object'
        ? source.customThemeBackgrounds[activeThemeId]
        : null;
    const activeBackgroundUrl = typeof activeCustomThemeBackground?.url === 'string'
        ? activeCustomThemeBackground.url.trim()
        : '';

    effectiveSettings.backgroundImageSource = activeCustomThemeBackground?.source === 'link' && activeBackgroundUrl
        ? 'link'
        : 'none';
    effectiveSettings.backgroundImageUrl = effectiveSettings.backgroundImageSource === 'link'
        ? activeBackgroundUrl
        : '';

    return effectiveSettings;
}

function _buildCsTimerCompatibleProperties(settingsData, { includeBackgroundImage = false } = {}) {
    const timerUpdate = settingsData?.timerUpdate || '0.01s';
    let timeU = 'u';
    if (timerUpdate === 'none') timeU = 'n';
    else if (timerUpdate === '1s') timeU = 's';
    else if (timerUpdate === '0.1s') timeU = 'c';
    else if (timerUpdate === 'inspection') timeU = 'i';

    const stat1 = _mapRollingStatTokenToCsTimer(settingsData?.solvesTableStat1);
    const stat2 = _mapRollingStatTokenToCsTimer(settingsData?.solvesTableStat2);
    const phaseCount = _normalizePhaseCount(settingsData?.multiPhaseCount, 1);
    const statsSource = _mapInternalMainStatsSourceToCsTimer(settingsData?.mainStatsSource);

    return {
        useIns: _mapInspectionTimeToCsTimerUseIns(settingsData?.inspectionTime),
        voiceIns: settingsData?.inspectionAlerts === 'voice' || settingsData?.inspectionAlerts === 'both' ? '1' : 'n',
        timeU,
        input: settingsData?.timeEntryMode === 'typing'
            ? 'i'
            : settingsData?.timeEntryMode === 'stackmat'
                ? 's'
                : settingsData?.timeEntryMode === 'bluetooth'
                    ? 'b'
                    : 't',
        atexpa: _normalizeAutoExportEvery100Solves(settingsData?.autoExportEvery100Solves, {
            defaultValue: AUTO_EXPORT_EVERY_100_SOLVES_NEVER,
        }),
        ahide: settingsData?.hideUIWhileSolving !== false,
        showAvg: settingsData?.pillSize === 'hidden' ? false : true,
        showDiff: settingsData?.showDelta === false ? 'n' : 'rg',
        ...(includeBackgroundImage
            && settingsData?.backgroundImageSource === 'link'
            && typeof settingsData?.backgroundImageUrl === 'string'
            && settingsData.backgroundImageUrl.trim()
            ? { bgImgS: 'u', bgImgSrc: settingsData.backgroundImageUrl.trim() }
            : {}),
        ...(stat1 ? { stat1l: stat1.length } : {}),
        ...(stat1?.type ? { stat1t: stat1.type } : {}),
        ...(stat2 ? { stat2l: stat2.length } : {}),
        ...(stat2?.type ? { stat2t: stat2.type } : {}),
        ...(phaseCount > 1 ? { phases: phaseCount } : {}),
        ...(statsSource ? { statsrc: statsSource } : {}),
        ..._buildCsTimerSummaryProperties(settingsData),
    };
}

function _buildCsTimerSessionScopeProperties(settingScopes) {
    const source = normalizeSettingScopes(settingScopes);
    const scopeProperties = {};

    CSTIMER_SESSION_SCOPE_MAPPINGS.forEach(({ settingKeys, propertyKeys }) => {
        if (!settingKeys.some((settingKey) => source[settingKey] === SETTING_SCOPE_SESSION)) return;
        propertyKeys.forEach((propertyKey) => {
            scopeProperties[`sr_${propertyKey}`] = true;
        });
    });

    return scopeProperties;
}

function _buildCsTimerSessionScopedOptProperties(settingScopes, settingsData) {
    const source = normalizeSettingScopes(settingScopes);
    const scopedPropertyKeys = new Set();

    CSTIMER_SESSION_SCOPE_MAPPINGS.forEach(({ settingKeys, propertyKeys }) => {
        if (!settingKeys.some((settingKey) => source[settingKey] === SETTING_SCOPE_SESSION)) return;
        propertyKeys.forEach((propertyKey) => scopedPropertyKeys.add(propertyKey));
    });

    if (scopedPropertyKeys.size === 0) return {};

    const compatibleProperties = _buildCsTimerCompatibleProperties(settingsData);
    return Object.fromEntries(
        Object.entries(compatibleProperties).filter(([propertyKey]) => scopedPropertyKeys.has(propertyKey)),
    );
}

function _buildCsTimerScopedSessionSettings(settingScopes) {
    const source = normalizeSettingScopes(settingScopes);
    const scopedSettings = {};

    CSTIMER_SESSION_SCOPE_MAPPINGS.forEach(({ settingKeys }) => {
        settingKeys.forEach((settingKey) => {
            if (source[settingKey] !== SETTING_SCOPE_SESSION) return;
            if (!_hasOwn(CSTIMER_SESSION_SETTING_DEFAULTS, settingKey)) return;
            scopedSettings[settingKey] = CSTIMER_SESSION_SETTING_DEFAULTS[settingKey];
        });
    });

    return scopedSettings;
}

function _getSessionScopedSettingKeySet(scopeMap, { compatibleOnly = false } = {}) {
    const source = normalizeSettingScopes(scopeMap);
    return new Set(
        Object.entries(source)
            .filter(([key, scope]) => (
                scope === SETTING_SCOPE_SESSION
                && (!compatibleOnly || CSTIMER_COMPATIBLE_SESSION_SETTING_KEY_SET.has(key))
            ))
            .map(([key]) => key),
    );
}

function _filterSessionSettingsByAllowedKeys(sessionSettings, allowedKeySet) {
    const source = _sanitizeSessionSettingsForTransport(sessionSettings);
    if (!(allowedKeySet instanceof Set) || allowedKeySet.size === 0) return {};

    return Object.fromEntries(
        Object.entries(source).filter(([key]) => allowedKeySet.has(key)),
    );
}

function _getSessionScopedSettings(sessionSettings, scopeMap, { compatibleOnly = false } = {}) {
    return _filterSessionSettingsByAllowedKeys(
        sessionSettings,
        _getSessionScopedSettingKeySet(scopeMap, { compatibleOnly }),
    );
}

function _buildCsTimerMetadataSettings(storedSettingsData) {
    return _sanitizeStoredSettingsForExport(storedSettingsData);
}

function _getUkraTimerCsTimerMetadataSessionId(entry) {
    if (!entry || typeof entry !== 'object') return '';

    if (typeof entry.sessionId === 'string' && entry.sessionId) return entry.sessionId;
    if (typeof entry.id === 'string' && entry.id) return entry.id;
    return '';
}

function _buildUkraTimerCsTimerMetadataSessionResolver(metadataSessions) {
    const entries = Array.isArray(metadataSessions)
        ? metadataSessions.map((entry, index) => ({
            index,
            sessionId: _getUkraTimerCsTimerMetadataSessionId(entry),
            name: entry?.name != null ? String(entry.name) : '',
            entry,
        }))
        : [];
    const usedIndexes = new Set();
    const entriesBySessionId = new Map();

    entries.forEach((entry) => {
        if (!entry.sessionId || entriesBySessionId.has(entry.sessionId)) return;
        entriesBySessionId.set(entry.sessionId, entry);
    });

    const claimEntry = (entry) => {
        if (!entry || usedIndexes.has(entry.index)) return null;
        usedIndexes.add(entry.index);
        return entry.entry;
    };

    return {
        takeBySessionId(sessionId) {
            if (typeof sessionId !== 'string' || !sessionId) return null;
            return claimEntry(entriesBySessionId.get(sessionId));
        },
        takeFallback({ slot = 0, name = '' } = {}) {
            // Some round-trips preserve ukraTimerMeta.sessions but drop the sessionData
            // session id. Fall back by slot/name even when the metadata entry still has
            // its original sessionId.
            const slotIndex = Number.isInteger(slot) ? slot - 1 : -1;
            if (slotIndex >= 0 && slotIndex < entries.length && !usedIndexes.has(entries[slotIndex].index)) {
                return claimEntry(entries[slotIndex]);
            }

            const normalizedName = name != null ? String(name) : '';
            if (normalizedName) {
                const nameMatch = entries.find((entry) => entry.name === normalizedName && !usedIndexes.has(entry.index));
                if (nameMatch) return claimEntry(nameMatch);
            }

            return null;
        },
    };
}

function _stripCsTimerNativeSettings(settingsData) {
    const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
    const stripped = { ...source };

    CSTIMER_NATIVE_SETTING_KEYS.forEach((key) => {
        delete stripped[key];
    });

    return stripped;
}

function _getMetadataSessionScrambleType(entry) {
    if (!entry || typeof entry !== 'object') return '';

    const normalized = typeof entry.scrambleType === 'string'
        ? entry.scrambleType.trim().toLowerCase()
        : '';
    if (!normalized) return '';
    if (_hasOwn(INTERNAL_SCRAMBLE_TYPE_TO_CSTIMER, normalized)) return normalized;
    if (_hasOwn(CSTIMER_SCRAMBLE_TYPE_TO_INTERNAL, normalized)) {
        return CSTIMER_SCRAMBLE_TYPE_TO_INTERNAL[normalized];
    }

    return '';
}

function _mergeImportedCsTimerSessionSettings(optProperties, metadataSessionSettings, sessionScopedSettingKeySet = new Set()) {
    const nativeSettings = _deriveSettingsFromCsTimerProperties(optProperties);
    const metadataSettings = metadataSessionSettings && typeof metadataSessionSettings === 'object'
        ? _sanitizeSessionSettingsForTransport(metadataSessionSettings)
        : {};
    const mergedSettings = {
        ..._stripCsTimerNativeSettings(metadataSettings),
        ...Object.fromEntries(
            Object.entries(nativeSettings).filter(([key]) => !CSTIMER_NATIVE_SETTING_KEY_SET.has(key)),
        ),
    };

    CSTIMER_NATIVE_SETTING_KEYS.forEach((key) => {
        const treatMissingAsDefaults = sessionScopedSettingKeySet.has(key);
        const shouldPreferMetadata = _hasOwn(metadataSettings, key)
            && _metadataSettingMatchesImportedCsTimerState(key, metadataSettings, optProperties, {
                treatMissingAsDefaults,
            });

        if (shouldPreferMetadata) {
            mergedSettings[key] = metadataSettings[key];
            return;
        }
        if (_hasOwn(nativeSettings, key)) {
            mergedSettings[key] = nativeSettings[key];
            return;
        }
    });

    return mergedSettings;
}

function _deriveSettingsFromCsTimerProperties(properties) {
    const summarySettings = _deriveSummarySettingsFromCsTimerProperties(properties);
    const stat1 = (_hasOwn(properties, 'stat1l') || _hasOwn(properties, 'stat1t'))
        ? _mapCsTimerRollingStatToInternal(properties?.stat1l, properties?.stat1t)
        : null;
    const stat2 = (_hasOwn(properties, 'stat2l') || _hasOwn(properties, 'stat2t'))
        ? _mapCsTimerRollingStatToInternal(properties?.stat2l, properties?.stat2t)
        : null;
    const settingsData = {
        ...summarySettings,
        ...(stat1 ? { solvesTableStat1: stat1 } : {}),
        ...(stat2 ? { solvesTableStat2: stat2 } : {}),
    };

    if (_hasOwn(properties, 'useIns')) {
        settingsData.inspectionTime = properties?.useIns === 'n'
            ? INSPECTION_TIME_OFF
            : (_isInspectionTimeEnabled(properties?.useIns)
                ? _normalizeInspectionTime(properties.useIns)
                : INSPECTION_TIME_COUNT_UP);
    }

    if (_hasOwn(properties, 'voiceIns')) {
        settingsData.inspectionAlerts = properties?.voiceIns === 'n' ? 'screen' : 'voice';
    }

    if (_hasOwn(properties, 'timeU')) {
        let timerUpdate = '0.1s';
        if (properties?.timeU === 'n') timerUpdate = 'none';
        else if (properties?.timeU === 's') timerUpdate = '1s';
        else if (properties?.timeU === 'u') timerUpdate = '0.01s';
        else if (properties?.timeU === 'i') timerUpdate = 'inspection';
        settingsData.timerUpdate = timerUpdate;
    }

    if (_hasOwn(properties, 'input')) {
        if (properties?.input === 'i') settingsData.timeEntryMode = 'typing';
        else if (properties?.input === 's' || properties?.input === 'm') settingsData.timeEntryMode = 'stackmat';
        else if (properties?.input === 'b') settingsData.timeEntryMode = 'bluetooth';
        else settingsData.timeEntryMode = 'timer';
    }

    if (_hasOwn(properties, 'phases')) {
        settingsData.multiPhaseCount = _normalizePhaseCount(properties?.phases, 1);
    }

    if (_hasOwn(properties, 'statsrc')) {
        settingsData.mainStatsSource = _mapCsTimerStatsSourceToInternal(properties?.statsrc);
    }

    if (_hasOwn(properties, 'atexpa')) {
        settingsData.autoExportEvery100Solves = _normalizeAutoExportEvery100Solves(
            properties?.atexpa,
            { defaultValue: AUTO_EXPORT_EVERY_100_SOLVES_REMIND },
        );
    }

    if (_hasOwn(properties, 'ahide')) {
        settingsData.hideUIWhileSolving = properties?.ahide === false ? false : true;
    }

    if (_hasOwn(properties, 'showAvg')) {
        settingsData.pillSize = properties?.showAvg === false ? 'hidden' : 'medium';
    }

    if (_hasOwn(properties, 'showDiff')) {
        settingsData.showDelta = properties?.showDiff === 'n' ? false : true;
    }

    if (properties?.bgImgS === 'u' && typeof properties?.bgImgSrc === 'string') {
        settingsData.backgroundImageSource = 'link';
        settingsData.backgroundImageUrl = String(properties.bgImgSrc).trim();
    }

    return settingsData;
}

function _isMeaningfulCsTimerSessionSlot(slot, meta, rawSolves, { isActiveSlot = false, hasGlobalSessionProperties = false } = {}) {
    if (Array.isArray(rawSolves) && rawSolves.length > 0) return true;

    if (!meta || typeof meta !== 'object') {
        return isActiveSlot && hasGlobalSessionProperties;
    }

    if (_hasOwn(meta, 'name') && String(meta.name) !== String(slot)) return true;

    const opt = meta.opt && typeof meta.opt === 'object' ? meta.opt : null;
    if (opt && Object.keys(opt).length > 0) return true;

    return isActiveSlot && hasGlobalSessionProperties;
}

/**
 * Detect whether a parsed JSON object is in csTimer format.
 */
export function isCsTimerFormat(data) {
    if (!data || typeof data !== 'object') return false;
    // csTimer files always have "session1" as a key
    return 'session1' in data;
}

/**
 * Convert csTimer JSON → internal format and import it.
 */
export async function importCsTimer(csData, { mode = IMPORT_MODE_REWRITE, onProgress = null } = {}) {
    if (!csData || typeof csData !== 'object') return;

    const importMode = _normalizeImportMode(mode);
    const existingData = importMode === IMPORT_MODE_MERGE
        ? await db.getAllData()
        : null;

    const properties = (csData.properties && typeof csData.properties === 'object')
        ? csData.properties
        : {};

    // Parse session metadata (names) from properties.sessionData
    let sessionMeta = {};
    try {
        if (properties.sessionData) {
            sessionMeta = JSON.parse(properties.sessionData);
        }
    } catch (_) { /* ignore */ }

    const sessionSlots = Object.keys(csData)
        .map((key) => key.match(/^session(\d+)$/))
        .filter(Boolean)
        .map((match) => Number(match[1]));
    const sessionMetaSlots = Object.keys(sessionMeta)
        .map((key) => _parsePositiveInteger(key))
        .filter(Boolean);
    const activeSessionSlot = _parsePositiveInteger(properties.session) || 1;
    const declaredSessionCount = _parsePositiveInteger(properties.sessionN);
    const sessionCount = Math.max(
        declaredSessionCount || 0,
        activeSessionSlot,
        ...sessionSlots,
        ...sessionMetaSlots,
    );

    if (sessionCount <= 0) return;

    const hasGlobalScrambleType = _hasOwn(properties, 'scrType');
    const globalActiveScrambleType = _mapCsTimerScrambleTypeToInternal(properties.scrType);
    const hasGlobalPhaseCount = _hasOwn(properties, 'phases');
    const globalStatsSource = _hasOwn(properties, 'statsrc')
        ? _mapCsTimerStatsSourceToInternal(properties.statsrc)
        : null;
    const metadata = _parseUkraTimerCsTimerMeta(properties[UKRA_TIMER_CSTIMER_META_KEY]);
    const hasMetadataSettings = metadata && typeof metadata.settings === 'object';
    const metadataSettings = hasMetadataSettings
        ? _sanitizeStoredSettingsForImport(metadata.settings)
        : {};
    const metadataSessionScopedSettingKeySet = _getSessionScopedSettingKeySet(
        _stripCsTimerCompatibleSettingScopes(metadataSettings.settingScopes),
    );
    const metadataSessions = Array.isArray(metadata?.sessions) ? metadata.sessions : [];
    const metadataSessionResolver = _buildUkraTimerCsTimerMetadataSessionResolver(metadataSessions);
    const importedSessions = [];

    for (let slot = 1; slot <= sessionCount; slot += 1) {
        const meta = sessionMeta[String(slot)] && typeof sessionMeta[String(slot)] === 'object'
            ? sessionMeta[String(slot)]
            : {};
        const opt = meta?.opt && typeof meta.opt === 'object' ? meta.opt : {};
        const rawSolves = Array.isArray(csData[`session${slot}`]) ? csData[`session${slot}`] : [];
        if (!_isMeaningfulCsTimerSessionSlot(slot, meta, rawSolves, {
            isActiveSlot: slot === activeSessionSlot,
            hasGlobalSessionProperties: hasGlobalScrambleType || hasGlobalPhaseCount || globalStatsSource != null,
        })) {
            continue;
        }
        const sessionId = `${_genId()}${slot}`;
        const name = meta.name != null ? String(meta.name) : `Session ${slot}`;
        const mappedScrambleType = _mapCsTimerScrambleTypeToInternal(opt.scrType);
        const nativeOpt = {
            ...(slot === activeSessionSlot && !_hasOwn(opt, 'phases') && hasGlobalPhaseCount
                ? { phases: properties.phases }
                : {}),
            ...opt,
        };
        const hasNativeScrambleType = _hasOwn(opt, 'scrType') || (slot === activeSessionSlot && hasGlobalScrambleType);
        const scrambleType = slot === activeSessionSlot && !_hasOwn(opt, 'scrType')
            ? globalActiveScrambleType
            : mappedScrambleType;
        const rank = Number.isFinite(meta?.rank) ? Number(meta.rank) : slot;

        importedSessions.push({
            slot,
            rank,
            id: sessionId,
            name,
            opt: nativeOpt,
            metadataSessionId: typeof meta?.[UKRA_TIMER_CSTIMER_SESSION_META_ID_KEY] === 'string'
                ? meta[UKRA_TIMER_CSTIMER_SESSION_META_ID_KEY]
                : '',
            hasNativeScrambleType,
            hasNativePhaseCount: _hasOwn(nativeOpt, 'phases'),
            scrambleType,
            settings: _deriveSettingsFromCsTimerProperties(nativeOpt),
            solves: rawSolves,
        });
    }

    importedSessions.sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        return left.slot - right.slot;
    });

    const compatibleScopedSettingScopes = _deriveSessionSettingScopesFromCsTimer(properties);
    const compatibleScopedSettingKeySet = new Set(Object.keys(compatibleScopedSettingScopes));
    const importedSessionScopedSettingKeySet = new Set([
        ...metadataSessionScopedSettingKeySet,
        ...compatibleScopedSettingKeySet,
    ]);

    importedSessions.forEach((session) => {
        const matchedMetadataSession = metadataSessionResolver.takeBySessionId(session.metadataSessionId)
            || metadataSessionResolver.takeFallback({ slot: session.slot, name: session.name });
        const metadataScrambleType = _getMetadataSessionScrambleType(matchedMetadataSession);

        if (!session.hasNativeScrambleType && metadataScrambleType) {
            session.scrambleType = metadataScrambleType;
        }

        const metadataSessionSettings = _filterSessionSettingsByAllowedKeys(
            matchedMetadataSession?.settings,
            importedSessionScopedSettingKeySet,
        );

        session.settings = _mergeImportedCsTimerSessionSettings(
            session.opt,
            metadataSessionSettings,
            compatibleScopedSettingKeySet,
        );

        if (!_hasOwn(metadataSessionSettings, 'mainStatsSource')
            && session.slot === activeSessionSlot
            && globalStatsSource != null
        ) {
            session.settings.mainStatsSource = globalStatsSource;
        }
    });

    const defaultScopedSessionSettings = _buildCsTimerScopedSessionSettings(compatibleScopedSettingScopes);
    importedSessions.forEach((session) => {
        session.settings = {
            ...defaultScopedSessionSettings,
            ...(session.settings && typeof session.settings === 'object' ? session.settings : {}),
        };
    });
    const activeImportedSession = importedSessions.find((session) => session.slot === activeSessionSlot) || importedSessions[0] || null;

    const dbSessions = [];
    const dbSolves = [];
    const sessionMatchHints = new Map();
    const totalRawSolveCount = importedSessions.reduce((count, session) => count + session.solves.length, 0);
    const parseTotal = importedSessions.length + totalRawSolveCount;
    const estimatedTotalWork = parseTotal + 1 + importedSessions.length + totalRawSolveCount + (
        importMode === IMPORT_MODE_MERGE
            ? ((existingData?.sessions?.length || 0) + (existingData?.solves?.length || 0))
            : 0
    );
    let parseCompleted = 0;

    _reportImportProgress(onProgress, {
        source: 'cstimer',
        phase: 'parsing',
        stage: 'sessions',
        completed: 0,
        total: parseTotal,
        processed: 0,
        totalWork: estimatedTotalWork,
        percent: 0,
        sessionCount: importedSessions.length,
        solveCount: totalRawSolveCount,
    });

    for (let index = 0; index < importedSessions.length; index += 1) {
        const session = importedSessions[index];
        let sessionCreatedAt = Date.now();
        let hasTimestamp = false;
        parseCompleted += 1;

        for (const entry of session.solves) {
            if (!Array.isArray(entry) || entry.length < 4) continue;
            const [penaltyAndTime, scramble, comment, timestampSec] = entry;
            if (!Array.isArray(penaltyAndTime) || penaltyAndTime.length < 2) continue;

            const [penaltyFlag, rawTime, ...rawPhaseSplits] = penaltyAndTime;
            let penalty = null;
            if (penaltyFlag === 2000) penalty = '+2';
            else if (penaltyFlag === -1) penalty = 'DNF';
            const phaseInfo = _convertCsTimerPhaseDataToInternal(rawPhaseSplits, rawTime, {
                declaredPhaseCount: session.hasNativePhaseCount ? session.settings?.multiPhaseCount : null,
            });

            const timestamp = Number(timestampSec) * 1000;
            if (Number.isFinite(timestamp) && timestamp >= 0 && !hasTimestamp) {
                sessionCreatedAt = timestamp;
                hasTimestamp = true;
            }

            dbSolves.push({
                id: _genId(),
                sessionId: session.id,
                time: Number(rawTime),
                scramble: scramble || '',
                isManual: false,
                penalty,
                timestamp: Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : Date.now(),
                comment: (comment && typeof comment === 'string') ? comment : '',
                ...(phaseInfo.phaseSplits.length > 1
                    ? { phaseSplits: phaseInfo.phaseSplits, phaseCount: phaseInfo.phaseCount }
                    : {}),
            });
            parseCompleted += 1;

            if (parseCompleted % IMPORT_PROGRESS_YIELD_INTERVAL === 0 || parseCompleted === parseTotal) {
                _reportImportProgress(onProgress, {
                    source: 'cstimer',
                    phase: 'parsing',
                    stage: 'solves',
                    completed: parseCompleted,
                    total: parseTotal,
                    processed: parseCompleted,
                    totalWork: estimatedTotalWork,
                    percent: estimatedTotalWork > 0 ? (parseCompleted / estimatedTotalWork) * 100 : 100,
                    sessionCount: importedSessions.length,
                    solveCount: totalRawSolveCount,
                });

                if (parseCompleted < parseTotal) {
                    await _waitForNextFrame();
                }
            }
        }

        dbSessions.push({
            id: session.id,
            name: session.name,
            createdAt: sessionCreatedAt,
            order: index,
            scrambleType: session.scrambleType,
            ...(session.settings && typeof session.settings === 'object'
                ? { settings: _sanitizeSessionSettingsForTransport(session.settings) }
                : {}),
        });
        sessionMatchHints.set(session.id, session.metadataSessionId || '');
    }

    if (importedSessions.length === 0) return;

    const existingSettings = load('settings', {});
    const nativeSettings = _deriveSettingsFromCsTimerProperties(properties);
    const mergedSettingScopes = {
        ..._stripCsTimerCompatibleSettingScopes(existingSettings.settingScopes),
        ..._stripCsTimerCompatibleSettingScopes(metadataSettings.settingScopes),
        ...compatibleScopedSettingScopes,
    };
    const metadataSettingsWithoutScopes = _stripCsTimerNativeSettings(metadataSettings);
    delete metadataSettingsWithoutScopes.settingScopes;
    const nextSettings = {
        ...existingSettings,
        ...metadataSettingsWithoutScopes,
        settingScopes: mergedSettingScopes,
    };
    const activeImportedSessionSettings = activeImportedSession?.settings && typeof activeImportedSession.settings === 'object'
        ? activeImportedSession.settings
        : {};

    CSTIMER_NATIVE_SETTING_KEYS.forEach((key) => {
        const shouldPreferMetadata = _hasOwn(metadataSettings, key)
            && _metadataSettingMatchesImportedCsTimerState(key, metadataSettings, properties);

        if (compatibleScopedSettingKeySet.has(key)) {
            if (shouldPreferMetadata) {
                nextSettings[key] = metadataSettings[key];
                return;
            }
            if (_hasOwn(activeImportedSessionSettings, key)) {
                nextSettings[key] = activeImportedSessionSettings[key];
                return;
            }
            if (_hasOwn(nativeSettings, key)) {
                nextSettings[key] = nativeSettings[key];
                return;
            }
            if (_hasOwn(CSTIMER_IMPORT_SETTING_DEFAULTS, key)) {
                nextSettings[key] = CSTIMER_IMPORT_SETTING_DEFAULTS[key];
            }
            return;
        }

        if (shouldPreferMetadata) {
            nextSettings[key] = metadataSettings[key];
            return;
        }
        if (_hasOwn(nativeSettings, key)) {
            nextSettings[key] = nativeSettings[key];
            return;
        }
        if (_hasOwn(CSTIMER_IMPORT_SETTING_DEFAULTS, key)) {
            nextSettings[key] = CSTIMER_IMPORT_SETTING_DEFAULTS[key];
        }
    });

    let activeImportedSessionId = activeImportedSession?.id || dbSessions[0]?.id || null;
    const activeImportedScrambleType = activeImportedSession?.scrambleType || '333';
    let finalSessions = dbSessions;
    let finalSolves = dbSolves;

    if (importMode === IMPORT_MODE_MERGE) {
        _reportImportProgress(onProgress, {
            source: 'cstimer',
            phase: 'merging',
            stage: 'solves',
            completed: parseCompleted,
            total: parseTotal,
            processed: parseCompleted,
            totalWork: estimatedTotalWork,
            percent: estimatedTotalWork > 0 ? (parseCompleted / estimatedTotalWork) * 100 : 100,
            sessionCount: dbSessions.length,
            solveCount: dbSolves.length,
        });

        const mergedData = _mergeImportedDataset(dbSessions, dbSolves, {
            existingData,
            findExistingSessionMatch: _buildCsTimerSessionMergeResolver(
                existingData.sessions || [],
                sessionMatchHints,
                existingData.solves || [],
                dbSolves,
                {
                    roundTimestampToSecond: true,
                    includeScramble: true,
                },
            ),
            solveMatchMode: SOLVE_MATCH_MODE_LOGICAL_CSTIMER,
        });
        finalSessions = mergedData.dbSessions;
        finalSolves = mergedData.dbSolves;
        activeImportedSessionId = mergedData.sessionIdMap.get(activeImportedSessionId) || activeImportedSessionId;
    }

    const totalWork = parseTotal + 1 + finalSessions.length + finalSolves.length;

    await _replaceImportedData(finalSessions, finalSolves, {
        source: 'cstimer',
        onProgress,
        processedOffset: parseTotal,
        totalWork,
    });

    const newSettings = _sanitizeStoredSettingsForImport(
        _stampAutoExportSequenceSettings(nextSettings, finalSolves.length),
        { minimumSolveSequence: finalSolves.length },
    );

    // Write settings to localStorage
    save('activeSessionId', activeImportedSessionId);
    save('scrambleType', activeImportedScrambleType);
    save('settings', newSettings);

    _reportImportProgress(onProgress, {
        source: 'cstimer',
        phase: 'complete',
        stage: 'complete',
        completed: totalWork,
        total: totalWork,
        processed: totalWork,
        totalWork,
        percent: 100,
        sessionCount: finalSessions.length,
        solveCount: finalSolves.length,
    });
}

/**
 * Export internal data → csTimer JSON format.
 */
export async function exportCsTimer() {
    await _runBeforeDataExportHooks();
    const { sessions, solves } = await db.getAllData();
    const solvesBySessionId = _groupSolvesBySessionId(solves);
    const csData = {};
    const sessionMeta = {};
    const storedSettingsData = _sanitizeStoredSettingsForExport(load('settings', {}));
    const activeSessionId = load('activeSessionId', null);
    const activeSessionIndex = Math.max(0, sessions.findIndex((session) => session.id === activeSessionId));
    const activeSession = sessions[activeSessionIndex] || sessions[0] || null;
    const settingsData = _getEffectiveCsTimerExportSettings(storedSettingsData, activeSession);
    const settingScopes = storedSettingsData.settingScopes && typeof storedSettingsData.settingScopes === 'object'
        ? storedSettingsData.settingScopes
        : {};
    const metadataSettings = _buildCsTimerMetadataSettings(storedSettingsData);
    const activeCsScrambleType = _mapInternalScrambleTypeToCsTimer(activeSession?.scrambleType || '333');

    sessions.forEach((session, i) => {
        const num = i + 1;
        const key = `session${num}`;
        const sanitizedSessionSettings = _sanitizeSessionSettingsForTransport(session.settings);
        const effectiveSessionSettings = _getEffectiveCsTimerExportSettings(storedSettingsData, {
            ...session,
            settings: sanitizedSessionSettings,
        });
        const sessionPhaseCount = _normalizePhaseCount(effectiveSessionSettings.multiPhaseCount, 1);

        const sessionSolves = (solvesBySessionId.get(session.id) || [])
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp);

        csData[key] = sessionSolves.map(solve => {
            // Map penalty: null → 0, '+2' → 2000, 'DNF' → -1
            let penaltyFlag = 0;
            let time = solve.time;
            const phaseMarkers = _buildCsTimerPhaseMarkersFromInternal(solve.phaseSplits);
            if (solve.penalty === '+2') {
                penaltyFlag = 2000;
            } else if (solve.penalty === 'DNF') {
                penaltyFlag = -1;
            }

            return [
                [penaltyFlag, time, ...phaseMarkers],
                solve.scramble || '',
                solve.comment || '',
                Math.floor(solve.timestamp / 1000), // ms → seconds
            ];
        });

        sessionMeta[String(num)] = {
            name: session.name || `Session ${num}`,
            opt: {
                ...(activeCsScrambleType && session.id === activeSession?.id
                    ? { ...(session.scrambleType === '333' ? {} : { scrType: activeCsScrambleType }) }
                    : (() => {
                        const csScrambleType = _mapInternalScrambleTypeToCsTimer(session.scrambleType || '333');
                        return csScrambleType ? { scrType: csScrambleType } : {};
                    })()),
                ...(sessionPhaseCount > 1 ? { phases: sessionPhaseCount } : {}),
                ..._buildCsTimerSessionScopedOptProperties(settingScopes, effectiveSessionSettings),
            },
            rank: num,
            [UKRA_TIMER_CSTIMER_SESSION_META_ID_KEY]: session.id,
        };
    });

    const activeScrambleFilter = _buildCsTimerScrambleFilter(activeCsScrambleType);

    csData.properties = {
        sessionData: JSON.stringify(sessionMeta),
        showad: false,
        tools: true,
        color: '4',
        'col-back': '#000000',
        'col-board': '#555555',
        'col-button': '#888888',
        'col-logo': '#000000',
        'col-font': '#ffffff',
        'col-link': '#aaaaaa',
        'col-logoback': '#aaaaaa',
        toolsfunc: '["trend","stats","cross","distribution"]',
        session: activeSessionIndex + 1,
        ...(sessions.length !== 15 ? { sessionN: sessions.length } : {}),
        ..._buildCsTimerCompatibleProperties(settingsData, { includeBackgroundImage: true }),
        ..._buildCsTimerSessionScopeProperties(settingScopes),
        ...(activeCsScrambleType ? {
            scrType: activeCsScrambleType,
            scrFlt: JSON.stringify(activeScrambleFilter),
            ...(CSTIMER_TRAINING_FILTER_LENGTHS[activeCsScrambleType] ? { isTrainScr: true } : {}),
        } : {}),
        [UKRA_TIMER_CSTIMER_META_KEY]: _getUkraTimerCsTimerMetaPayload(
            metadataSettings,
            sessions.map((session) => ({
                sessionId: session.id,
                name: session.name || '',
                scrambleType: session.scrambleType || '333',
                settings: _getSessionScopedSettings(session.settings, settingScopes),
            })),
        ),
    };

    return csData;
}
