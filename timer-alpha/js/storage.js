import * as db from './db.js?v=2026042504';

const STORAGE_PREFIX = 'cubetimer_';
const STORAGE_VERSION = 1;
const SESSION_CSV_HEADERS = ['Puzzle', 'Category', 'Time(millis)', 'Date(millis)', 'Scramble', 'Penalty', 'Comment'];
const BACKUP_LOCAL_STORAGE_KEYS = Object.freeze([
    'settings',
    'activeSessionId',
    'scrambleType',
]);
const BACKUP_LOCAL_STORAGE_KEY_SET = new Set(BACKUP_LOCAL_STORAGE_KEYS);
const IMPORT_PROGRESS_YIELD_INTERVAL = 2000;

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

function _applyImportedBackupValues(data, { replaceMissing = false } = {}) {
    const nextValues = new Map();

    for (const [key, value] of Object.entries(data || {})) {
        if (key === 'version' || key === 'sessions' || !BACKUP_LOCAL_STORAGE_KEY_SET.has(key)) continue;
        nextValues.set(key, value);
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

/**
 * Export all timer data as a single JSON object.
 * Reads sessions + solves from IndexedDB, settings from localStorage.
 * @returns {Promise<object>}
 */
export async function exportAll() {
    const { sessions, solves } = await db.getAllData();

    // Reconstruct the old embedded format for export compatibility
    const sessionsWithSolves = sessions.map(session => ({
        ...session,
        solves: solves
            .filter(s => s.sessionId === session.id)
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(({ sessionId, ...rest }) => rest), // strip sessionId from export
    }));

    const data = { version: STORAGE_VERSION, sessions: sessionsWithSolves };

    BACKUP_LOCAL_STORAGE_KEYS.forEach((key) => {
        if (hasStoredKey(key)) {
            data[key] = load(key);
        }
    });

    return data;
}

/**
 * Import data from a JSON object, overwriting existing data.
 * @param {object} data
 */
export async function importAll(data, { onProgress = null } = {}) {
    if (!data || typeof data !== 'object') return;

    // Separate sessions from other data
    const sessions = data.sessions || [];
    const totalSolveCount = _countEmbeddedSolves(sessions);
    const dbSessions = [];
    const dbSolves = [];
    const parseTotal = sessions.length + totalSolveCount;
    const writeTotal = 1 + sessions.length + totalSolveCount;
    const totalWork = parseTotal + writeTotal;
    let parseCompleted = 0;

    _reportImportProgress(onProgress, {
        source: 'backup',
        phase: 'parsing',
        stage: 'sessions',
        completed: 0,
        total: parseTotal,
        processed: 0,
        totalWork,
        percent: totalWork > 0 ? 0 : 100,
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
                        totalWork,
                        percent: totalWork > 0 ? (parseCompleted / totalWork) * 100 : 100,
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

    await _replaceImportedData(dbSessions, dbSolves, {
        source: 'backup',
        onProgress,
        processedOffset: parseTotal,
        totalWork,
    });

    // Write remaining import-backed localStorage keys (settings, active session,
    // selected scramble type). Cache/runtime keys stay device-local.
    _applyImportedBackupValues(data, { replaceMissing: true });

    _reportImportProgress(onProgress, {
        source: 'backup',
        phase: 'complete',
        stage: 'complete',
        completed: totalWork,
        total: totalWork,
        processed: totalWork,
        totalWork,
        percent: 100,
        sessionCount: dbSessions.length,
        solveCount: dbSolves.length,
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

function _mapSessionCsvPenalty(value) {
    if (value === '1') return '+2';
    if (value === '2') return 'DNF';
    return null;
}

export function isSessionCsvFormat(text) {
    const normalized = _normalizeImportText(text);
    const [firstRecord] = _parseDelimitedRecords(normalized);
    if (!firstRecord) return false;

    try {
        return _isSessionCsvHeader(firstRecord);
    } catch (_) {
        return false;
    }
}

export async function convertSessionCsv(text, { onProgress = null } = {}) {
    const normalized = _normalizeImportText(text);
    const records = _parseDelimitedRecords(normalized);
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

export async function importSessionCsv(text, { onProgress = null } = {}) {
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

    await _replaceImportedData(dbSessions, dbSolves, {
        source: 'csv',
        onProgress: writeProgress,
    });

    _applyImportedBackupValues(backupValues);

    _reportImportProgress(onProgress, {
        source: 'csv',
        phase: 'complete',
        stage: 'complete',
        completed: 100,
        total: 100,
        processed: 100,
        totalWork: 100,
        percent: 100,
        sessionCount: dbSessions.length,
        solveCount: dbSolves.length,
    });
}

// ──── csTimer Format Conversion ────

const UKRA_TIMER_CSTIMER_META_KEY = 'ukraTimerMeta';
const UKRA_TIMER_CSTIMER_META_VERSION = 1;
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
    oll: 'oll',
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
    oll: 'oll',
    lsll: 'lsll2',
    zbll: 'zbll',
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
    dailyStreakGoal: 0,
    summaryStatsPreset: 'basic',
    summaryStatsCustom: 'mo3 ao5 ao12 ao100',
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
const SUMMARY_STATS_PRESET_STRINGS = Object.freeze({
    extended: 'mo3 ao5 ao12 ao25 ao50 ao100',
    full: 'mo3 ao5 ao12 ao25 ao50 ao100 ao200 ao500 ao1000 ao2000 ao5000 ao10000',
});

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

function _normalizeTokenListString(value) {
    return String(value ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
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

function _getUkraTimerCsTimerMetaPayload(settingsData) {
    return JSON.stringify({
        version: UKRA_TIMER_CSTIMER_META_VERSION,
        settings: settingsData,
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
        settingsData.inspectionTime = '15s';
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

function _isMeaningfulCsTimerSessionSlot(slot, meta, rawSolves, { isActiveSlot = false, hasGlobalScrambleType = false } = {}) {
    if (Array.isArray(rawSolves) && rawSolves.length > 0) return true;

    if (!meta || typeof meta !== 'object') {
        return isActiveSlot && hasGlobalScrambleType;
    }

    if (_hasOwn(meta, 'name') && String(meta.name) !== String(slot)) return true;

    const opt = meta.opt && typeof meta.opt === 'object' ? meta.opt : null;
    if (opt && Object.keys(opt).length > 0) return true;

    return isActiveSlot && hasGlobalScrambleType;
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
export async function importCsTimer(csData, { onProgress = null } = {}) {
    if (!csData || typeof csData !== 'object') return;

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
    const importedSessions = [];

    for (let slot = 1; slot <= sessionCount; slot += 1) {
        const meta = sessionMeta[String(slot)] && typeof sessionMeta[String(slot)] === 'object'
            ? sessionMeta[String(slot)]
            : {};
        const rawSolves = Array.isArray(csData[`session${slot}`]) ? csData[`session${slot}`] : [];
        if (!_isMeaningfulCsTimerSessionSlot(slot, meta, rawSolves, {
            isActiveSlot: slot === activeSessionSlot,
            hasGlobalScrambleType,
        })) {
            continue;
        }
        const sessionId = `${_genId()}${slot}`;
        const name = meta.name != null ? String(meta.name) : `Session ${slot}`;
        const mappedScrambleType = _mapCsTimerScrambleTypeToInternal(meta?.opt?.scrType);
        const scrambleType = slot === activeSessionSlot && !_hasOwn(meta?.opt || {}, 'scrType')
            ? globalActiveScrambleType
            : mappedScrambleType;
        const rank = Number.isFinite(meta?.rank) ? Number(meta.rank) : slot;

        importedSessions.push({
            slot,
            rank,
            id: sessionId,
            name,
            scrambleType,
            solves: rawSolves,
        });
    }

    importedSessions.sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        return left.slot - right.slot;
    });

    const dbSessions = [];
    const dbSolves = [];
    const totalRawSolveCount = importedSessions.reduce((count, session) => count + session.solves.length, 0);
    const parseTotal = importedSessions.length + totalRawSolveCount;
    const estimatedTotalWork = parseTotal + 1 + importedSessions.length + totalRawSolveCount;
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

            const [penaltyFlag, rawTime] = penaltyAndTime;
            let penalty = null;
            if (penaltyFlag === 2000) penalty = '+2';
            else if (penaltyFlag === -1) penalty = 'DNF';

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
        });
    }

    if (importedSessions.length === 0) return;

    const metadata = _parseUkraTimerCsTimerMeta(properties[UKRA_TIMER_CSTIMER_META_KEY]);
    const existingSettings = load('settings', {});
    const nativeSettings = _deriveSettingsFromCsTimerProperties(properties);
    const metadataSettings = metadata && typeof metadata.settings === 'object' ? metadata.settings : {};
    const newSettings = {
        ...existingSettings,
        ...nativeSettings,
        ...metadataSettings,
    };

    const activeImportedSession = importedSessions.find((session) => session.slot === activeSessionSlot) || importedSessions[0];
    const activeImportedSessionId = activeImportedSession?.id || dbSessions[0]?.id || null;
    const activeImportedScrambleType = activeImportedSession?.scrambleType || '333';

    const totalWork = parseTotal + 1 + dbSessions.length + dbSolves.length;

    await _replaceImportedData(dbSessions, dbSolves, {
        source: 'cstimer',
        onProgress,
        processedOffset: parseTotal,
        totalWork,
    });

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
        sessionCount: dbSessions.length,
        solveCount: dbSolves.length,
    });
}

/**
 * Export internal data → csTimer JSON format.
 */
export async function exportCsTimer() {
    const { sessions, solves } = await db.getAllData();
    const csData = {};
    const sessionMeta = {};
    const storedSettingsData = load('settings', {});
    const settingsData = {
        ...CSTIMER_EXPORT_SETTING_DEFAULTS,
        ...storedSettingsData,
    };
    const activeThemeId = typeof settingsData.theme === 'string' ? settingsData.theme : 'default';
    const activeCustomThemeBackground = storedSettingsData.customThemeBackgrounds
        && typeof storedSettingsData.customThemeBackgrounds === 'object'
        ? storedSettingsData.customThemeBackgrounds[activeThemeId]
        : null;
    const activeBackgroundUrl = typeof activeCustomThemeBackground?.url === 'string'
        ? activeCustomThemeBackground.url.trim()
        : '';
    settingsData.backgroundImageSource = activeCustomThemeBackground?.source === 'link' && activeBackgroundUrl ? 'link' : 'none';
    settingsData.backgroundImageUrl = settingsData.backgroundImageSource === 'link' ? activeBackgroundUrl : '';
    const activeSessionId = load('activeSessionId', null);
    const activeSessionIndex = Math.max(0, sessions.findIndex((session) => session.id === activeSessionId));
    const activeSession = sessions[activeSessionIndex] || sessions[0] || null;
    const activeCsScrambleType = _mapInternalScrambleTypeToCsTimer(activeSession?.scrambleType || '333');

    sessions.forEach((session, i) => {
        const num = i + 1;
        const key = `session${num}`;

        const sessionSolves = solves
            .filter(s => s.sessionId === session.id)
            .sort((a, b) => a.timestamp - b.timestamp);

        csData[key] = sessionSolves.map(solve => {
            // Map penalty: null → 0, '+2' → 2000, 'DNF' → -1
            let penaltyFlag = 0;
            let time = solve.time;
            if (solve.penalty === '+2') {
                penaltyFlag = 2000;
            } else if (solve.penalty === 'DNF') {
                penaltyFlag = -1;
            }

            return [
                [penaltyFlag, time],
                solve.scramble || '',
                solve.comment || '',
                Math.floor(solve.timestamp / 1000), // ms → seconds
            ];
        });

        sessionMeta[String(num)] = {
            name: session.name || `Session ${num}`,
            opt: activeCsScrambleType && session.id === activeSession?.id
                ? { ...(session.scrambleType === '333' ? {} : { scrType: activeCsScrambleType }) }
                : (() => {
                    const csScrambleType = _mapInternalScrambleTypeToCsTimer(session.scrambleType || '333');
                    return csScrambleType ? { scrType: csScrambleType } : {};
                })(),
            rank: num,
        };
    });

    // Map timer update frequency to csTimer
    const timerUpdate = settingsData.timerUpdate || '0.01s';
    let timeU = 'u';
    if (timerUpdate === 'none') timeU = 'n';
    else if (timerUpdate === '1s') timeU = 's';
    else if (timerUpdate === '0.1s') timeU = null; // omitted
    else if (timerUpdate === 'inspection') timeU = 'i';

    const stat1 = _mapRollingStatTokenToCsTimer(settingsData.solvesTableStat1);
    const stat2 = _mapRollingStatTokenToCsTimer(settingsData.solvesTableStat2);
    const summaryProps = _buildCsTimerSummaryProperties(storedSettingsData);
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
        timeU,
        toolsfunc: '["trend","stats","cross","distribution"]',
        session: activeSessionIndex + 1,
        ...(sessions.length !== 15 ? { sessionN: sessions.length } : {}),
        ...(_hasOwn(settingsData, 'inspectionTime') && settingsData.inspectionTime === '15s' ? { useIns: 'ap' } : {}),
        ...(settingsData.inspectionAlerts === 'screen' ? { voiceIns: 'n' } : {}),
        ...(settingsData.timeEntryMode === 'typing'
            ? { input: 'i' }
            : settingsData.timeEntryMode === 'stackmat'
                ? { input: 's' }
                : settingsData.timeEntryMode === 'bluetooth'
                    ? { input: 'b' }
                    : {}),
        ...(settingsData.hideUIWhileSolving === false ? { ahide: false } : {}),
        ...(settingsData.pillSize === 'hidden' ? { showAvg: false } : {}),
        ...(settingsData.showDelta === false ? { showDiff: 'n' } : {}),
        ...(settingsData.backgroundImageSource === 'link'
            && typeof settingsData.backgroundImageUrl === 'string'
            && settingsData.backgroundImageUrl.trim()
            ? { bgImgS: 'u', bgImgSrc: settingsData.backgroundImageUrl.trim() }
            : {}),
        ...(stat1 ? { stat1l: stat1.length } : {}),
        ...(stat1?.type ? { stat1t: stat1.type } : {}),
        ...(stat2 ? { stat2l: stat2.length } : {}),
        ...(stat2?.type ? { stat2t: stat2.type } : {}),
        ...(activeCsScrambleType ? {
            scrType: activeCsScrambleType,
            scrFlt: JSON.stringify(activeScrambleFilter),
            ...(CSTIMER_TRAINING_FILTER_LENGTHS[activeCsScrambleType] ? { isTrainScr: true } : {}),
        } : {}),
        ...summaryProps,
        [UKRA_TIMER_CSTIMER_META_KEY]: _getUkraTimerCsTimerMetaPayload({
            ...storedSettingsData,
            ...Object.fromEntries(
                Object.entries(settingsData).filter(([key]) => _hasOwn(CSTIMER_EXPORT_SETTING_DEFAULTS, key)),
            ),
        }),
    };
    if (timeU === null) delete csData.properties.timeU;

    return csData;
}
