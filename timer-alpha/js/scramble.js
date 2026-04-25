import { load, save } from './storage.js?v=2026042504';
import { createSubsetScramble } from './subset-scramblers.js?v=2026042504';

let randomScrambleForEvent;
let _cubingInitPromise = null;
let _cubingUnavailable = false;
let _cubingFallbackWarned = false;
let _scrambowCtor = null;
let _scrambowInitPromise = null;
const _queueFillPromises = new Map();
const _bootstrapQueueFillScheduled = new Set();
const _queueFillScheduled = new Set();

const LEGACY_SCRAMBLE_QUEUE_STORAGE_KEY = 'scrambleQueue333';
const SCRAMBLE_QUEUES_STORAGE_KEY = 'scrambleQueues';
const SCRAMBLE_TYPE_STORAGE_KEY = 'scrambleType';
const CUBING_WARMUP_STATE_STORAGE_KEY = 'cubingWarmupState';
const SCRAMBLE_QUEUE_TARGET = 6;
const SCRAMBLE_QUEUE_MAX = 12;
const SUBSET_REDRAW_LIMIT = 24;
const CUBING_SCRAMBLE_MODULE_SRC = 'https://cdn.cubing.net/v0/js/cubing/scramble';
const SCRAMBOW_SCRIPT_SRC = 'https://unpkg.com/scrambow@1.8.1/dist/scrambow.js';
const SUBSET_BOOTSTRAP_QUEUE_FILL_DELAY_MS = 280;
const CUBING_WARMUP_VERSION = '2026-04-01';

export const SCRAMBLE_TYPE_OPTIONS = Object.freeze([
    { id: '333', menuLabel: '3x3x3', buttonLabel: '3x3x3', generator: 'cubing', eventId: '333' },
    { id: '222', menuLabel: '2x2x2', buttonLabel: '2x2x2', generator: 'cubing', eventId: '222' },
    { id: '444', menuLabel: '4x4x4', buttonLabel: '4x4x4', generator: 'cubing', eventId: '444' },
    { id: '555', menuLabel: '5x5x5', buttonLabel: '5x5x5', generator: 'cubing', eventId: '555' },
    { id: '666', menuLabel: '6x6x6', buttonLabel: '6x6x6', generator: 'cubing', eventId: '666' },
    { id: '777', menuLabel: '7x7x7', buttonLabel: '7x7x7', generator: 'cubing', eventId: '777' },
    { id: 'pyram', menuLabel: 'Pyraminx', buttonLabel: 'Pyra', generator: 'cubing', eventId: 'pyram' },
    { id: 'minx', menuLabel: 'Megaminx', buttonLabel: 'Mega', generator: 'cubing', eventId: 'minx' },
    { id: 'skewb', menuLabel: 'Skewb', buttonLabel: 'Skewb', generator: 'cubing', eventId: 'skewb' },
    { id: 'sq1', menuLabel: 'Square-1', buttonLabel: 'Sq-1', generator: 'cubing', eventId: 'sq1' },
    { id: 'clock', menuLabel: 'Clock', buttonLabel: 'Clock', generator: 'cubing', eventId: 'clock' },
    { id: 'll', menuLabel: 'OLL', buttonLabel: 'OLL', generator: 'scrambow' },
    { id: 'cmll', menuLabel: 'CMLL', buttonLabel: 'CMLL', generator: 'scrambow' },
    { id: 'pll', menuLabel: 'PLL', buttonLabel: 'PLL', generator: 'scrambow' },
    { id: 'zbll', menuLabel: 'ZBLL', buttonLabel: 'ZBLL', generator: 'scrambow' },
    { id: 'lsll', menuLabel: 'LSLL', buttonLabel: 'LSLL', generator: 'scrambow' },
    { id: '222cll', menuLabel: 'CLL', buttonLabel: 'CLL', generator: 'custom' },
    { id: '222eg1', menuLabel: 'EG1', buttonLabel: 'EG1', generator: 'custom' },
    { id: '222eg2', menuLabel: 'EG2', buttonLabel: 'EG2', generator: 'custom' },
    { id: 'pyrl4e', menuLabel: 'L4E', buttonLabel: 'L4E', generator: 'custom' },
]);

const SCRAMBLE_TYPE_SET = new Set(SCRAMBLE_TYPE_OPTIONS.map((option) => option.id));
const SCRAMBOW_SUBSET_TYPES = new Set(
    SCRAMBLE_TYPE_OPTIONS
        .filter((option) => option.generator === 'scrambow')
        .map((option) => option.id),
);
const SCRAMBOW_SUPPORTED_TYPES = new Set([
    '222',
    '333',
    '444',
    '555',
    '666',
    '777',
    'clock',
    'minx',
    'pyram',
    'skewb',
    'sq1',
    ...SCRAMBOW_SUBSET_TYPES,
]);
const CUBING_SCRAMBLE_EVENTS = new Map(
    SCRAMBLE_TYPE_OPTIONS
        .filter((option) => option.generator === 'cubing')
        .map((option) => [option.id, option.eventId]),
);
const SCRAMBLE_QUEUE_TYPES = Object.freeze(SCRAMBLE_TYPE_OPTIONS.map((option) => option.id));
const SCRAMBLE_QUEUE_TYPE_SET = new Set(SCRAMBLE_QUEUE_TYPES);
const DEFERRED_QUEUE_FILL_TYPES = new Set(SCRAMBLE_QUEUE_TYPES.filter((type) => type !== '333'));
const CUSTOM_SUBSET_SCRAMBLE_TYPES = new Set(
    SCRAMBLE_TYPE_OPTIONS
        .filter((option) => option.generator === 'custom')
        .map((option) => option.id),
);

const _scrambowInstances = new Map();
const _legacy333ScrambleQueue = sanitizeScrambleQueue(load(LEGACY_SCRAMBLE_QUEUE_STORAGE_KEY, []));
const _scrambleQueues = sanitizeScrambleQueues(load(SCRAMBLE_QUEUES_STORAGE_KEY, null), _legacy333ScrambleQueue);
let _scrambleType = sanitizeScrambleType(load(SCRAMBLE_TYPE_STORAGE_KEY, '333'));

let _currentScramble = null;
let _prevScramble = null;
let _isViewingPrev = false;
let _cubingWarmupPromise = null;

function sanitizeScrambleQueue(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => normalizeScrambleText(entry))
        .slice(0, SCRAMBLE_QUEUE_MAX);
}

function sanitizeScrambleQueues(value, legacy333Queue = []) {
    const queues = Object.fromEntries(SCRAMBLE_QUEUE_TYPES.map((type) => [type, []]));

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        SCRAMBLE_QUEUE_TYPES.forEach((type) => {
            queues[type] = sanitizeScrambleQueue(value[type]);
        });
    }

    if (queues['333'].length === 0 && legacy333Queue.length > 0) {
        queues['333'] = [...legacy333Queue];
    }

    return queues;
}

function sanitizeScrambleType(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SCRAMBLE_TYPE_SET.has(normalized) ? normalized : '333';
}

function normalizeScrambleText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isLocalDevelopmentRuntime() {
    if (typeof window === 'undefined') return false;

    const hostname = window.location?.hostname ?? '';
    return window.location?.protocol === 'file:'
        || hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '0.0.0.0'
        || hostname === '::1'
        || hostname === '[::1]';
}

function warnCubingFallback(message, error = null) {
    if (_cubingFallbackWarned) return;

    if (error) {
        console.warn(message, error);
    } else {
        console.warn(message);
    }

    _cubingFallbackWarned = true;
}

function isOnlyUpperFaceTurnsScramble(scramble) {
    const tokens = normalizeScrambleText(scramble).split(' ').filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => /^U(?:2|'|)?$/.test(token));
}

function getScrambleQueue(type) {
    const normalizedType = sanitizeScrambleType(type);
    return SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType) ? _scrambleQueues[normalizedType] : [];
}

function persistScrambleQueues() {
    const queuesToSave = {};

    SCRAMBLE_QUEUE_TYPES.forEach((type) => {
        queuesToSave[type] = getScrambleQueue(type).slice(0, SCRAMBLE_QUEUE_MAX);
    });

    save(SCRAMBLE_QUEUES_STORAGE_KEY, queuesToSave);
    save(LEGACY_SCRAMBLE_QUEUE_STORAGE_KEY, queuesToSave['333']);
}

function persistScrambleType() {
    save(SCRAMBLE_TYPE_STORAGE_KEY, _scrambleType);
}

function sanitizeCubingWarmupState(value) {
    const warmedTypes = Array.isArray(value?.warmedTypes)
        ? value.warmedTypes.filter((type) => CUBING_SCRAMBLE_EVENTS.has(type))
        : [];

    if (value?.version !== CUBING_WARMUP_VERSION) {
        return {
            version: CUBING_WARMUP_VERSION,
            warmedTypes: [],
        };
    }

    return {
        version: CUBING_WARMUP_VERSION,
        warmedTypes: [...new Set(warmedTypes)],
    };
}

function loadCubingWarmupState() {
    return sanitizeCubingWarmupState(load(CUBING_WARMUP_STATE_STORAGE_KEY, null));
}

function persistCubingWarmupState(state) {
    save(CUBING_WARMUP_STATE_STORAGE_KEY, sanitizeCubingWarmupState(state));
}

function markCubingTypeWarmed(type) {
    const normalizedType = sanitizeScrambleType(type);
    if (!CUBING_SCRAMBLE_EVENTS.has(normalizedType)) return;

    const state = loadCubingWarmupState();
    if (state.warmedTypes.includes(normalizedType)) return;

    state.warmedTypes.push(normalizedType);
    persistCubingWarmupState(state);
}

function getCubingWarmupTypesRemaining() {
    const state = loadCubingWarmupState();
    return [...CUBING_SCRAMBLE_EVENTS.keys()].filter((type) => !state.warmedTypes.includes(type));
}

function getCubingWarmupSnapshot(status = 'idle', currentType = null) {
    const remainingTypes = getCubingWarmupTypesRemaining();
    const total = CUBING_SCRAMBLE_EVENTS.size;
    return {
        status,
        currentType,
        total,
        remainingTypes,
        completed: total - remainingTypes.length,
        isComplete: remainingTypes.length === 0,
    };
}

async function initCubingScrambler() {
    if (randomScrambleForEvent) return randomScrambleForEvent;
    if (_cubingUnavailable) {
        throw new Error('cubing.js scrambler is unavailable.');
    }
    if (_cubingInitPromise) return _cubingInitPromise;

    _cubingInitPromise = (async () => {
        try {
            const module = await import(CUBING_SCRAMBLE_MODULE_SRC);
            randomScrambleForEvent = module.randomScrambleForEvent;
            return randomScrambleForEvent;
        } catch (e) {
            console.error('Failed to load cubing.js scramble module:', e);
            throw e;
        } finally {
            if (!randomScrambleForEvent) {
                _cubingInitPromise = null;
            }
        }
    })();

    return _cubingInitPromise;
}

function resolveScrambowCtor() {
    if (_scrambowCtor) return _scrambowCtor;
    if (typeof window === 'undefined') return null;

    const maybeCtor = window.scrambow?.Scrambow;
    if (typeof maybeCtor === 'function') {
        _scrambowCtor = maybeCtor;
    }

    return _scrambowCtor;
}

async function initScrambow() {
    const existingCtor = resolveScrambowCtor();
    if (existingCtor) return existingCtor;
    if (_scrambowInitPromise) return _scrambowInitPromise;

    _scrambowInitPromise = new Promise((resolve, reject) => {
        let script = document.querySelector('script[data-scrambow-loader="true"]');

        if (script?.dataset.scrambowFailed === 'true') {
            script.remove();
            script = null;
        }

        const cleanup = () => {
            script?.removeEventListener('load', handleLoad);
            script?.removeEventListener('error', handleError);
        };

        const handleLoad = () => {
            cleanup();
            const ctor = resolveScrambowCtor();
            if (ctor) {
                if (script) script.dataset.scrambowLoaded = 'true';
                resolve(ctor);
                return;
            }
            reject(new Error('Scrambow loaded without exposing Scrambow.'));
        };

        const handleError = () => {
            cleanup();
            if (script) {
                script.dataset.scrambowFailed = 'true';
                script.remove();
            }
            reject(new Error('Failed to load Scrambow script.'));
        };

        if (script?.dataset.scrambowLoaded === 'true') {
            handleLoad();
            return;
        }

        if (!script) {
            script = document.createElement('script');
            script.src = SCRAMBOW_SCRIPT_SRC;
            script.async = true;
            script.dataset.scrambowLoader = 'true';
            document.head.append(script);
        }

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
    }).finally(() => {
        if (!_scrambowCtor) {
            _scrambowInitPromise = null;
        }
    });

    return _scrambowInitPromise;
}

async function createCubingScramble(eventId) {
    const type = sanitizeScrambleType(eventId);
    if (_cubingUnavailable) {
        warnCubingFallback('cubing.js scrambler is unavailable; falling back to Scrambow for supported events.');
        return createScrambowScramble(type);
    }

    if (isLocalDevelopmentRuntime() && SCRAMBOW_SUPPORTED_TYPES.has(type)) {
        warnCubingFallback('Local development runtime detected; bypassing cubing.js worker and using Scrambow for supported events.');
        return createScrambowScramble(type);
    }

    try {
        if (!randomScrambleForEvent) {
            await initCubingScrambler();
        }

        const alg = await randomScrambleForEvent(eventId);
        markCubingTypeWarmed(type);
        return normalizeScrambleText(alg.toString());
    } catch (error) {
        _cubingUnavailable = true;
        _cubingInitPromise = null;
        randomScrambleForEvent = null;

        warnCubingFallback('cubing.js scrambler is unavailable; falling back to Scrambow for supported events.', error);

        if (SCRAMBOW_SUPPORTED_TYPES.has(type)) {
            return createScrambowScramble(type);
        }

        throw error;
    }
}

function takeQueuedScramble(type) {
    const queue = getScrambleQueue(type);
    if (queue.length === 0) return null;

    const scramble = queue.shift();
    persistScrambleQueues();
    scheduleQueueFill(type);
    return scramble;
}

async function fillScrambleQueue(type) {
    const normalizedType = sanitizeScrambleType(type);
    if (!SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType)) return null;

    const existingPromise = _queueFillPromises.get(normalizedType);
    if (existingPromise) return existingPromise;

    const fillPromise = (async () => {
        try {
            const queue = getScrambleQueue(normalizedType);
            while (queue.length < SCRAMBLE_QUEUE_TARGET) {
                queue.push(await createScrambleForType(normalizedType));
                persistScrambleQueues();
                if (queue.length < SCRAMBLE_QUEUE_TARGET) {
                    await yieldQueueFillTurn(normalizedType);
                }
            }
        } catch (e) {
            console.error(`Failed to prefill ${normalizedType} scramble queue:`, e);
        } finally {
            _queueFillPromises.delete(normalizedType);
        }
    })();

    _queueFillPromises.set(normalizedType, fillPromise);
    return fillPromise;
}

function scheduleQueueFill(type = _scrambleType) {
    const normalizedType = sanitizeScrambleType(type);
    if (!SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType)) return;

    if (
        getScrambleQueue(normalizedType).length >= SCRAMBLE_QUEUE_TARGET
        || _queueFillPromises.has(normalizedType)
        || _queueFillScheduled.has(normalizedType)
    ) {
        return;
    }

    const run = () => {
        _queueFillScheduled.delete(normalizedType);

        if (getScrambleQueue(normalizedType).length >= SCRAMBLE_QUEUE_TARGET || _queueFillPromises.has(normalizedType)) {
            return;
        }

        void fillScrambleQueue(normalizedType);
    };

    const shouldDefer = DEFERRED_QUEUE_FILL_TYPES.has(normalizedType);
    if (!shouldDefer) {
        run();
        return;
    }

    _queueFillScheduled.add(normalizedType);
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 600 });
        return;
    }

    window.setTimeout(run, 60);
}

function yieldQueueFillTurn(type) {
    if (!DEFERRED_QUEUE_FILL_TYPES.has(type)) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: 120 });
            return;
        }

        window.setTimeout(resolve, 0);
    });
}

function scheduleBootstrapQueueFill(type = _scrambleType) {
    const normalizedType = sanitizeScrambleType(type);
    if (!SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType) || _bootstrapQueueFillScheduled.has(normalizedType)) return;

    _bootstrapQueueFillScheduled.add(normalizedType);

    const run = () => {
        const flush = () => {
            _bootstrapQueueFillScheduled.delete(normalizedType);
            scheduleQueueFill(normalizedType);
        };

        if (DEFERRED_QUEUE_FILL_TYPES.has(normalizedType) && typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(flush, { timeout: 1400 });
            return;
        }

        flush();
    };

    if (DEFERRED_QUEUE_FILL_TYPES.has(normalizedType)) {
        window.setTimeout(run, SUBSET_BOOTSTRAP_QUEUE_FILL_DELAY_MS);
        return;
    }

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 800 });
        return;
    }

    window.setTimeout(run, 150);
}

async function generateNextScrambleForType(type) {
    const normalizedType = sanitizeScrambleType(type);
    const cachedScramble = takeQueuedScramble(normalizedType);
    if (cachedScramble) {
        return cachedScramble;
    }

    const scramble = await createScrambleForType(normalizedType);
    scheduleQueueFill(normalizedType);
    return scramble;
}

function extractScrambleText(result) {
    if (typeof result === 'string') return normalizeScrambleText(result);

    if (result && typeof result === 'object') {
        if (typeof result.scramble_string === 'string') return normalizeScrambleText(result.scramble_string);
        if (typeof result.scramble === 'string') return normalizeScrambleText(result.scramble);
    }

    throw new Error('Scrambler returned an unsupported scramble format.');
}

function getScrambowInstance(type) {
    if (!_scrambowCtor) {
        throw new Error('Scrambow is not initialized.');
    }

    if (!_scrambowInstances.has(type)) {
        _scrambowInstances.set(type, new _scrambowCtor(type));
    }

    return _scrambowInstances.get(type);
}

function getSingleScrambowScramble(type) {
    const scrambler = getScrambowInstance(type);
    const result = scrambler.get(1)?.[0];
    return extractScrambleText(result);
}

async function createScrambowScramble(type) {
    await initScrambow();

    if (!SCRAMBOW_SUBSET_TYPES.has(type)) {
        return getSingleScrambowScramble(type);
    }

    let lastScramble = '';

    for (let attempt = 0; attempt < SUBSET_REDRAW_LIMIT; attempt += 1) {
        const scramble = getSingleScrambowScramble(type);
        if (!isOnlyUpperFaceTurnsScramble(scramble)) {
            return scramble;
        }
        lastScramble = scramble;
    }

    console.warn(`Subset scrambler kept returning only-U moves for ${type}; using the last generated scramble.`);
    return lastScramble;
}

async function createScrambleForType(type) {
    const normalizedType = sanitizeScrambleType(type);
    const cubingEventId = CUBING_SCRAMBLE_EVENTS.get(normalizedType);
    if (cubingEventId) return createCubingScramble(cubingEventId);
    if (SCRAMBOW_SUPPORTED_TYPES.has(normalizedType)) return createScrambowScramble(normalizedType);
    if (CUSTOM_SUBSET_SCRAMBLE_TYPES.has(normalizedType)) return createSubsetScramble(normalizedType);
    throw new Error(`Unsupported scramble type: ${type}`);
}

function getActiveScrambleEntry() {
    return _isViewingPrev ? _prevScramble : _currentScramble;
}

function resetScrambleHistory() {
    _currentScramble = null;
    _prevScramble = null;
    _isViewingPrev = false;
}

function pushNewScramble(scrambleStr, type = _scrambleType, isManual = false) {
    _prevScramble = _currentScramble;
    _currentScramble = {
        text: isManual ? String(scrambleStr ?? '') : normalizeScrambleText(scrambleStr),
        isManual,
        type: sanitizeScrambleType(type),
    };
    _isViewingPrev = false;
}

export function getSelectedScrambleType() {
    return _scrambleType;
}

export function getCurrentScrambleType() {
    return getActiveScrambleEntry()?.type ?? _scrambleType;
}

export function setScrambleType(type) {
    const nextType = sanitizeScrambleType(type);
    if (nextType === _scrambleType) return false;

    _scrambleType = nextType;
    persistScrambleType();
    resetScrambleHistory();
    return true;
}

export async function getScramble() {
    const type = _scrambleType;
    const text = await generateNextScrambleForType(type);
    pushNewScramble(text, type, false);
    return text;
}

export function getPrevScramble() {
    if (_prevScramble && !_isViewingPrev) {
        _isViewingPrev = true;
        return _prevScramble.text;
    }
    return null;
}

export function hasPrevScramble() {
    return _prevScramble !== null && !_isViewingPrev;
}

export function isViewingPreviousScramble() {
    return _isViewingPrev;
}

export async function getNextScramble() {
    if (_isViewingPrev && _currentScramble) {
        _isViewingPrev = false;
        return _currentScramble.text;
    }
    return getScramble();
}

export function getCurrentScramble() {
    return getActiveScrambleEntry()?.text ?? '';
}

export function setCurrentScramble(scrambleStr) {
    const nextText = String(scrambleStr ?? '');
    const active = getActiveScrambleEntry();
    const entryType = active?.type ?? _scrambleType;

    if (_isViewingPrev) {
        pushNewScramble(nextText, entryType, true);
    } else if (_currentScramble) {
        _currentScramble.text = nextText;
        _currentScramble.isManual = true;
        _currentScramble.type = entryType;
    } else {
        pushNewScramble(nextText, entryType, true);
    }
}

export function isCurrentScrambleManual() {
    const active = getActiveScrambleEntry();
    return active ? active.isManual : false;
}

export function preloadScrambleEngines() {
    const preloadTasks = [];

    if (!randomScrambleForEvent && !_cubingUnavailable) {
        preloadTasks.push(
            initCubingScrambler().catch((error) => {
                console.warn('Unable to preload cubing.js scramble module during startup.', error);
                return null;
            }),
        );
    }

    if (!resolveScrambowCtor()) {
        preloadTasks.push(
            initScrambow().catch((error) => {
                console.warn('Unable to preload Scrambow during startup.', error);
                return null;
            }),
        );
    }

    return Promise.allSettled(preloadTasks);
}

function yieldCubingWarmupTurn() {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }

        window.setTimeout(resolve, 0);
    });
}

async function warmCubingScrambleType(type) {
    const eventId = CUBING_SCRAMBLE_EVENTS.get(type);
    if (!eventId) return false;
    if (isLocalDevelopmentRuntime()) return false;

    try {
        _cubingUnavailable = false;
        if (!randomScrambleForEvent) {
            await initCubingScrambler();
        }

        await randomScrambleForEvent(eventId);
        markCubingTypeWarmed(type);
        return true;
    } catch (error) {
        _cubingInitPromise = null;
        randomScrambleForEvent = null;
        console.warn(`Unable to warm cubing.js scramble path for ${type}.`, error);
        return false;
    }
}

export function needsCubingWarmup() {
    if (isLocalDevelopmentRuntime()) return false;
    return getCubingWarmupTypesRemaining().length > 0;
}

export async function runCubingWarmup(onProgress = null) {
    if (_cubingWarmupPromise) return _cubingWarmupPromise;

    const reportProgress = (status, currentType = null) => {
        const snapshot = getCubingWarmupSnapshot(status, currentType);
        if (typeof onProgress === 'function') {
            onProgress(snapshot);
        }
        return snapshot;
    };

    if (!needsCubingWarmup()) {
        return reportProgress('complete');
    }

    _cubingWarmupPromise = (async () => {
        reportProgress('starting');
        const remainingTypes = getCubingWarmupTypesRemaining();

        for (let index = 0; index < remainingTypes.length; index += 1) {
            const type = remainingTypes[index];
            reportProgress('running', type);

            const warmed = await warmCubingScrambleType(type);
            if (!warmed) {
                return reportProgress('failed', type);
            }

            reportProgress('running', type);
            if (index < remainingTypes.length - 1) {
                await yieldCubingWarmupTurn();
            }
        }

        return reportProgress('complete');
    })().finally(() => {
        _cubingWarmupPromise = null;
    });

    return _cubingWarmupPromise;
}

function bootstrapInitialScrambleFromCache() {
    const queue = getScrambleQueue(_scrambleType);
    if (queue.length === 0) {
        return;
    }

    const cachedScramble = queue.shift();
    persistScrambleQueues();
    pushNewScramble(cachedScramble, _scrambleType, false);
    scheduleBootstrapQueueFill(_scrambleType);
}

bootstrapInitialScrambleFromCache();
