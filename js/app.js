import { timer } from './timer.js?v=2026041801';
import { SCRAMBLE_TYPE_OPTIONS, getScramble, getCurrentScramble, getCurrentScrambleType, getPrevScramble, getNextScramble, getSelectedScrambleType, setCurrentScramble, setScrambleType, isCurrentScrambleManual, hasPrevScramble, isViewingPreviousScramble, preloadScrambleEngines, needsCubingWarmup, runCubingWarmup } from './scramble.js?v=2026041801';
import { sessionManager } from './session.js?v=2026041801';
import { settings, DEFAULTS, THEME_OPTIONS, THEME_COLOR_SECTIONS, THEME_DEFAULT_ID, THEME_OLED_ID, THEME_CUSTOM_IDS, composeThemeColor, decomposeThemeColor, getThemePresetColors, isCustomThemeId } from './settings.js?v=2026041801';
import { parseGraphStatType, parseRollingStatType, rollingStatAt, StatsCache } from './stats.js?v=2026041801';
import { formatTime, formatSolveTime, formatTimerDisplayTime, getEffectiveTime, formatDate, formatDateTime, parseTimeInputToMs, truncateTimeDisplay } from './utils.js?v=2026041801';
import { initModal, showSolveDetail, showAverageDetail, closeModal, closeMoveSessionMenus, customConfirm, customPrompt, getModalSelectionContext, setModalStatNavigator, setModalStatButtons, armModalGhostClickGuard } from './modal.js?v=2026041801';
import { applyMegaminxScramble, applyPyraminxScramble, applyScramble, applySquare1Scramble, applySkewbScramble, applyClockScramble, clearCubeDisplay, drawMegaminxFacePreview, drawSquare1, drawClock, initCubeDisplay, updateCubeDisplay, updateMegaminxDisplay, updatePyraminxDisplay, updateSquare1Display, updateSkewbDisplay, updateClockDisplay } from './cube-display.js?v=2026041801';
import { initGraph, updateGraph, updateGraphData, setLineVisibility, getLineVisibility, applyAction, graphEvents, getGraphLineDefinitions } from './graph.js?v=2026041801';
import { closeTimeDistributionModal, initTimeDistributionModal, isTimeDistributionModalOpen, refreshTimeDistributionData, refreshTimeDistributionTheme, showTimeDistributionModal } from './distribution.js?v=2026041801';
import { exportAll, importAll, isCsTimerFormat, importCsTimer, exportCsTimer, importSessionCsv } from './storage.js?v=2026041801';
import { connectGoogleDrive, exportBackupToGoogleDrive, getGoogleDriveBackupInfo, hasGoogleDriveSession, importBackupFromGoogleDrive, isGoogleDriveSyncConfigured, restoreGoogleDriveSession, signOutOfGoogleDrive } from './google-drive-sync.js?v=2026041801';
import { dailyStreakStore, normalizeDailyStreakGoal } from './streaks.js?v=2026041801';

let currentScramble = '';
let currentSortCol = null;
let currentSortDir = null; // 'asc' or 'desc'
let scrambleCopyTimeout = null;
let cubingWarmupHideTimeout = null;

// Search and selection state
let isSearchActive = false;
let searchFilters = { text: '', indexMin: '', indexMax: '', timeMin: '', timeMax: '' };
let selectedSolveIds = new Set();
let lastSelectedSolveIndex = -1;
let lastSelectedSolveId = null;
let selectionAnchorSolveIndex = -1;
let selectionAnchorSolveId = null;
let activeRangeSelectedSolveIds = new Set();
let bulkActionProgressState = {
    visible: false,
    active: false,
    status: 'idle',
    action: null,
    phase: null,
    percent: 0,
    selectedCount: 0,
    completed: 0,
    total: 0,
    targetSessionName: '',
};
let bulkActionProgressHideTimeout = null;
let importProgressState = {
    visible: false,
    active: false,
    status: 'idle',
    source: null,
    phase: null,
    stage: null,
    percent: 0,
    completed: 0,
    total: 0,
    sessionCount: 0,
    solveCount: 0,
};
let importProgressHideTimeout = null;
let dailyStreakToastHideTimeout = null;

const statsCache = new StatsCache();
let _skipSolveAddedRefresh = false; // set true when commitSolve manages the refresh itself
const DAILY_STREAKS_INTRO_STORAGE_KEY = 'ukratimer_daily_streaks_intro_v1';
const THEME_EDITOR_MODE_SIMPLE = 'simple';
const THEME_EDITOR_MODE_FULL = 'full';
const SIMPLE_THEME_COLOR_SECTIONS = Object.freeze([
    Object.freeze({
        id: 'simple-core',
        title: 'Core Colors',
        items: Object.freeze([
            Object.freeze({ key: 'bgPrimary', label: 'Page background' }),
            Object.freeze({ key: 'surface', label: 'Panel surface' }),
            Object.freeze({ key: 'textPrimary', label: 'Text' }),
            Object.freeze({ key: 'scrambleTopText', label: 'Text #2' }),
            Object.freeze({ key: 'accent', label: 'Accent' }),
            Object.freeze({ key: 'statNewBest', label: 'New best highlight' }),
            Object.freeze({ key: 'timerReady', label: 'Timer ready' }),
            Object.freeze({ key: 'timerHolding', label: 'Timer hold' }),
        ]),
    }),
]);
const SIMPLE_THEME_SEED_KEYS = Object.freeze([
    'bgPrimary',
    'surface',
    'textPrimary',
    'scrambleTopText',
    'accent',
    'timerReady',
    'timerHolding',
]);
const SIMPLE_THEME_SHARED_SECTION_IDS = new Set([
    'graph',
    'scramble-preview-cube',
    'scramble-preview-skewb',
    'scramble-preview-pyraminx',
    'scramble-preview-megaminx',
    'scramble-preview-square1',
    'scramble-preview-clock',
]);
const THEME_BACKGROUND_IMAGE_SECTION_ID = 'background-image';

function clampThemeChannel(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function parseThemeHexToRgb(value, fallback = '#000000') {
    const { hex } = decomposeThemeColor(value, fallback);
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

function rgbToThemeHex({ r, g, b }) {
    return `#${[r, g, b].map((channel) => clampThemeChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mixThemeRgb(a, b, amount) {
    const weight = Math.max(0, Math.min(1, Number(amount) || 0));
    return {
        r: clampThemeChannel(a.r + ((b.r - a.r) * weight)),
        g: clampThemeChannel(a.g + ((b.g - a.g) * weight)),
        b: clampThemeChannel(a.b + ((b.b - a.b) * weight)),
    };
}

function mixThemeColor(colorA, colorB, amount) {
    return rgbToThemeHex(mixThemeRgb(
        parseThemeHexToRgb(colorA, '#000000'),
        parseThemeHexToRgb(colorB, '#ffffff'),
        amount,
    ));
}

function withThemeAlpha(value, alpha) {
    const { hex } = decomposeThemeColor(value, '#000000');
    return composeThemeColor(hex, Math.max(0, Math.min(100, Math.round((Number(alpha) || 0) * 100))));
}

function scaleThemeAlpha(value, alphaMultiplier = 1, fallback = '#000000') {
    const { hex, alpha } = decomposeThemeColor(value, fallback);
    const multiplier = Math.max(0, Math.min(1, Number(alphaMultiplier) || 0));
    return composeThemeColor(hex, alpha * multiplier);
}

function getThemeLuminance(value) {
    const { r, g, b } = typeof value === 'string' ? parseThemeHexToRgb(value) : value;
    const channels = [r, g, b].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    });

    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function deriveSimpleThemeColors(seedColors) {
    const backgroundSeed = decomposeThemeColor(seedColors.bgPrimary, '#0d1117');
    const surfaceSeed = decomposeThemeColor(seedColors.surface, backgroundSeed.css);
    const textSeed = decomposeThemeColor(seedColors.textPrimary, '#e6edf3');
    const scrambleTopTextSeed = decomposeThemeColor(seedColors.scrambleTopText, textSeed.css);
    const accentSeed = decomposeThemeColor(seedColors.accent, '#58a6ff');
    const successSeed = decomposeThemeColor(seedColors.timerReady, '#3fb950');
    const dangerSeed = decomposeThemeColor(seedColors.timerHolding, '#f85149');
    const background = backgroundSeed.css;
    const surface = surfaceSeed.css;
    const text = textSeed.css;
    const scrambleTopText = scrambleTopTextSeed.css;
    const accent = accentSeed.css;
    const success = successSeed.css;
    const danger = dangerSeed.css;
    const simpleDangerPenalty = '#f85149';
    const backgroundAlpha = backgroundSeed.alpha / 100;
    const surfaceAlpha = surfaceSeed.alpha / 100;
    const textAlpha = textSeed.alpha / 100;
    const accentAlpha = accentSeed.alpha / 100;
    const bgRgb = parseThemeHexToRgb(background, '#0d1117');
    const surfaceRgb = parseThemeHexToRgb(surface, background);
    const textRgb = parseThemeHexToRgb(text, '#e6edf3');
    const scrambleTopTextRgb = parseThemeHexToRgb(scrambleTopText, text);
    const isDarkTheme = getThemeLuminance(bgRgb) < 0.32;
    const black = { r: 0, g: 0, b: 0 };
    const blendSurfaceToText = (amount) => rgbToThemeHex(mixThemeRgb(surfaceRgb, scrambleTopTextRgb, amount));
    const blendBackgroundToSurface = (amount) => rgbToThemeHex(mixThemeRgb(bgRgb, surfaceRgb, amount));
    const dimBackground = (amount) => rgbToThemeHex(mixThemeRgb(bgRgb, black, amount));
    const toneTextToBackground = (amount) => rgbToThemeHex(mixThemeRgb(textRgb, bgRgb, amount));
    const surfaceBorder = blendSurfaceToText(isDarkTheme ? 0.18 : 0.24);
    const textSecondary = toneTextToBackground(isDarkTheme ? 0.38 : 0.5);
    const floatingBorder = withThemeAlpha(scrambleTopText, isDarkTheme ? 0.08 : 0.14);
    const floatingBorderStrong = withThemeAlpha(scrambleTopText, isDarkTheme ? 0.14 : 0.22);
    const surfaceGhost = withThemeAlpha(scrambleTopText, isDarkTheme ? 0.05 : 0.08);
    const surfaceGhostHover = withThemeAlpha(scrambleTopText, isDarkTheme ? 0.08 : 0.12);
    const surfaceGhostActive = withThemeAlpha(scrambleTopText, isDarkTheme ? 0.12 : 0.18);
    const surfaceGhostMuted = withThemeAlpha(scrambleTopText, isDarkTheme ? 0.025 : 0.04);
    const pillBackgroundHover = blendBackgroundToSurface(isDarkTheme ? 0.7 : 0.24);

    return {
        bgPrimary: background,
        bgSecondary: scaleThemeAlpha(blendBackgroundToSurface(isDarkTheme ? 0.42 : 0.14), backgroundAlpha),
        bgTertiary: scaleThemeAlpha(blendBackgroundToSurface(isDarkTheme ? 0.7 : 0.24), backgroundAlpha),
        bgOverlay: scaleThemeAlpha(withThemeAlpha(dimBackground(isDarkTheme ? 0.78 : 0.55), isDarkTheme ? 0.68 : 0.5), backgroundAlpha),
        panelSheen: scaleThemeAlpha(withThemeAlpha(text, isDarkTheme ? 0.03 : 0.05), backgroundAlpha),
        panelSheenFade: scaleThemeAlpha(withThemeAlpha(text, 0), backgroundAlpha),
        surface,
        surfaceHover: scaleThemeAlpha(blendSurfaceToText(isDarkTheme ? 0.08 : 0.12), surfaceAlpha),
        surfaceActive: scaleThemeAlpha(blendSurfaceToText(isDarkTheme ? 0.15 : 0.2), surfaceAlpha),
        surfaceBorder: scaleThemeAlpha(surfaceBorder, surfaceAlpha),
        surfaceElevated: scaleThemeAlpha(withThemeAlpha(surface, isDarkTheme ? 0.9 : 0.96), surfaceAlpha),
        floatingSurface: scaleThemeAlpha(withThemeAlpha(blendSurfaceToText(isDarkTheme ? 0.04 : 0.08), 0.98), surfaceAlpha),
        floatingSurfaceHover: scaleThemeAlpha(withThemeAlpha(blendSurfaceToText(isDarkTheme ? 0.12 : 0.16), 0.99), surfaceAlpha),
        floatingSurfaceBorder: scaleThemeAlpha(floatingBorder, surfaceAlpha),
        floatingSurfaceBorderStrong: scaleThemeAlpha(floatingBorderStrong, surfaceAlpha),
        surfaceGhost: scaleThemeAlpha(surfaceGhost, surfaceAlpha),
        surfaceGhostHover: scaleThemeAlpha(surfaceGhostHover, surfaceAlpha),
        surfaceGhostActive: scaleThemeAlpha(surfaceGhostActive, surfaceAlpha),
        surfaceGhostMuted: scaleThemeAlpha(surfaceGhostMuted, surfaceAlpha),
        pillBorder: scaleThemeAlpha(surfaceBorder, surfaceAlpha),
        pillBackgroundHover: scaleThemeAlpha(pillBackgroundHover, surfaceAlpha),
        pillBorderHover: scaleThemeAlpha(blendSurfaceToText(isDarkTheme ? 0.28 : 0.34), surfaceAlpha),
        tooltipSurface: scaleThemeAlpha(withThemeAlpha(surface, isDarkTheme ? 0.96 : 0.94), surfaceAlpha),
        mobileTabsSurface: scaleThemeAlpha(withThemeAlpha(blendBackgroundToSurface(isDarkTheme ? 0.42 : 0.14), isDarkTheme ? 0.86 : 0.93), surfaceAlpha),
        newBestPopupSurface: scaleThemeAlpha(withThemeAlpha(background, isDarkTheme ? 0.94 : 0.9), backgroundAlpha),
        dividerSubtle: scaleThemeAlpha(withThemeAlpha(text, isDarkTheme ? 0.08 : 0.12), textAlpha),
        textPrimary: text,
        scrambleTopText,
        textSecondary: scaleThemeAlpha(textSecondary, textAlpha),
        textTertiary: scaleThemeAlpha(toneTextToBackground(isDarkTheme ? 0.56 : 0.68), textAlpha),
        textMuted: scaleThemeAlpha(toneTextToBackground(isDarkTheme ? 0.72 : 0.82), textAlpha),
        accent,
        accentHover: scaleThemeAlpha(mixThemeColor(accent, text, 0.16), accentAlpha),
        accentSubtle: scaleThemeAlpha(withThemeAlpha(accent, isDarkTheme ? 0.15 : 0.22), accentAlpha),
        timerIdle: scrambleTopText,
        timerHolding: danger,
        timerReady: success,
        timerRunning: text,
        newBestPopup: success,
        dangerPenalty: simpleDangerPenalty,
    };
}

async function registerServiceWorker() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (window.location?.protocol === 'file:') return;

    try {
        const serviceWorkerUrl = new URL('../sw.js?v=2026041801', import.meta.url);
        await navigator.serviceWorker.register(serviceWorkerUrl);
    } catch (error) {
        console.warn('Service worker registration failed:', error);
    }
}

// ──── Solves table virtualization state ────
const TABLE_ROW_HEIGHT = 27; // px per row, matches CSS
let _tableScrollHandler = null;
let _tableSortedIndices = null; // cached sorted index order
let _pendingSolvesTableViewportReset = false;
let _tableSolves = null; // reference to current solves array
const popupState = {
    inspection: { elementId: 'inspection-alert', hideTimeout: null, clearTimeout: null },
    newBest: { elementId: 'new-best-alert', hideTimeout: null, clearTimeout: null },
    penaltyShortcut: { elementId: 'penalty-shortcut-alert', hideTimeout: null, clearTimeout: null },
};
const TIMER_POPUP_ACTIVE_CLASS = 'timer-popup-active';
const TIMER_POPUP_ELEMENT_IDS = [
    'inspection-alert',
    'new-best-alert',
    'penalty-shortcut-alert',
    'cubing-warmup-alert',
    'import-progress',
];

function syncTimerPopupStacking() {
    const hasVisiblePopup = TIMER_POPUP_ELEMENT_IDS.some((elementId) =>
        document.getElementById(elementId)?.classList.contains('visible'),
    );
    document.getElementById('center-panel')?.classList.toggle(TIMER_POPUP_ACTIVE_CLASS, hasVisiblePopup);
    document.getElementById('timer-display-wrapper')?.classList.toggle(TIMER_POPUP_ACTIVE_CLASS, hasVisiblePopup);
}
const SUMMARY_STAT_PRESETS = {
    basic: ['mo3', 'ao5', 'ao12', 'ao100'],
    extended: ['mo3', 'ao5', 'ao12', 'ao25', 'ao50', 'ao100'],
    full: ['mo3', 'ao5', 'ao12', 'ao25', 'ao50', 'ao100', 'ao200', 'ao500', 'ao1000', 'ao2000', 'ao5000', 'ao10000'],
};
const MAX_CUSTOM_SUMMARY_STATS = 12;
const MAX_ROLLING_STAT_INPUT_LENGTH = 7;
const MAX_DELTA_REFERENCE_INPUT_LENGTH = 7;
const SOLVES_TABLE_STAT_SETTING_KEYS = ['solvesTableStat1', 'solvesTableStat2'];
const DELTA_REFERENCE_SINGLE_TOKENS = new Set(['single', 'prev', 'last']);
const DELTA_REFERENCE_MEAN_TOKENS = new Set(['mean', 'session']);
const SHIFT_STAT_SHORTCUT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
const SHIFT_STAT_SHORTCUT_DISPLAY = {
    Digit1: '1',
    Digit2: '2',
    Digit3: '3',
    Digit4: '4',
    Digit5: '5',
    Digit6: '6',
    Digit7: '7',
    Digit8: '8',
    Digit9: '9',
    Digit0: '0',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
};

function waitForNextPaint() {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }

        setTimeout(resolve, 0);
    });
}

function formatBulkActionProgressText(snapshot = bulkActionProgressState) {
    const actionVerb = snapshot.action === 'move' ? 'Moving' : 'Deleting';
    const count = Number.isFinite(snapshot.selectedCount) ? snapshot.selectedCount : 0;
    const countLabel = `${count.toLocaleString()} solve${count === 1 ? '' : 's'}`;

    if (snapshot.status === 'complete') {
        return snapshot.action === 'move'
            ? `Moved ${countLabel}`
            : `Deleted ${countLabel}`;
    }

    if (snapshot.status === 'error') {
        return snapshot.action === 'move'
            ? `Couldn't move ${countLabel}`
            : `Couldn't delete ${countLabel}`;
    }

    switch (snapshot.phase) {
        case 'scanning':
            return `${actionVerb} ${countLabel}: scanning session`;
        case 'merging':
            return `${actionVerb} ${countLabel}: updating ${snapshot.targetSessionName || 'target session'}`;
        case 'writing':
            return snapshot.action === 'move'
                ? `${actionVerb} ${countLabel}: writing ${snapshot.completed.toLocaleString()}/${snapshot.total.toLocaleString()}`
                : `${actionVerb} ${countLabel}: removing ${snapshot.completed.toLocaleString()}/${snapshot.total.toLocaleString()}`;
        case 'starting':
        default:
            return `${actionVerb} ${countLabel}...`;
    }
}

function formatImportProgressText(snapshot = importProgressState) {
    const sourceLabel = snapshot.source === 'cstimer'
        ? 'csTimer'
        : snapshot.source === 'csv'
            ? 'CSV'
            : 'backup';

    if (snapshot.status === 'complete') {
        return `Imported ${snapshot.solveCount.toLocaleString()} solve${snapshot.solveCount === 1 ? '' : 's'}`;
    }

    if (snapshot.status === 'error') {
        return `Import failed`;
    }

    switch (snapshot.phase) {
        case 'parsing':
            return `Importing ${sourceLabel}: parsing data`;
        case 'writing':
            if (snapshot.stage === 'clearing') return `Importing ${sourceLabel}: replacing existing data`;
            if (snapshot.stage === 'sessions') return `Importing ${sourceLabel}: saving sessions`;
            return `Importing ${sourceLabel}: saving solves`;
        default:
            return `Importing ${sourceLabel}...`;
    }
}

function updateOperationProgressUI({ baseId, state, formatter }) {
    const container = document.getElementById(baseId);
    const textEl = document.getElementById(`${baseId}-text`);
    const percentEl = document.getElementById(`${baseId}-percent`);
    const trackEl = document.getElementById(`${baseId}-track`);
    const fillEl = document.getElementById(`${baseId}-fill`);
    if (!container || !textEl || !percentEl || !trackEl || !fillEl) return;

    if (!state.visible) {
        container.hidden = true;
        container.classList.remove('visible');
        container.classList.remove('is-active');
        container.classList.remove('is-complete', 'is-error');
        trackEl.setAttribute('aria-valuenow', '0');
        fillEl.style.transition = 'none';
        fillEl.style.transform = 'translateZ(0) scaleX(0)';
        if (container.classList.contains('timer-popup')) {
            syncTimerPopupStacking();
        }
        return;
    }

    const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
    const isActive = !!state.active && state.status === 'running';
    container.hidden = false;
    container.classList.add('visible');
    container.classList.toggle('is-active', isActive);
    container.classList.toggle('is-complete', state.status === 'complete');
    container.classList.toggle('is-error', state.status === 'error');
    textEl.textContent = formatter(state);
    percentEl.textContent = `${Math.round(percent)}%`;
    trackEl.setAttribute('aria-valuenow', String(Math.round(percent)));
    fillEl.style.transition = isActive ? 'none' : 'transform 120ms linear';
    fillEl.style.transform = `translateZ(0) scaleX(${percent / 100})`;
    if (container.classList.contains('timer-popup')) {
        syncTimerPopupStacking();
    }
}

function updateBulkActionProgressUI() {
    updateOperationProgressUI({
        baseId: 'search-bulk-progress',
        state: bulkActionProgressState,
        formatter: formatBulkActionProgressText,
    });
}

function updateImportProgressUI() {
    updateOperationProgressUI({
        baseId: 'import-progress',
        state: importProgressState,
        formatter: formatImportProgressText,
    });
}

function setBulkActionProgressState(nextState) {
    if (bulkActionProgressHideTimeout) {
        clearTimeout(bulkActionProgressHideTimeout);
        bulkActionProgressHideTimeout = null;
    }

    bulkActionProgressState = {
        ...bulkActionProgressState,
        ...nextState,
    };

    updateBulkActionProgressUI();
    updateSearchBulkActionUI();
}

function hideBulkActionProgress({ delayMs = 0 } = {}) {
    const applyHide = () => {
        bulkActionProgressState = {
            visible: false,
            active: false,
            status: 'idle',
            action: null,
            phase: null,
            percent: 0,
            selectedCount: 0,
            completed: 0,
            total: 0,
            targetSessionName: '',
        };
        updateBulkActionProgressUI();
        updateSearchBulkActionUI();
    };

    if (bulkActionProgressHideTimeout) {
        clearTimeout(bulkActionProgressHideTimeout);
        bulkActionProgressHideTimeout = null;
    }

    if (delayMs > 0) {
        bulkActionProgressHideTimeout = setTimeout(() => {
            bulkActionProgressHideTimeout = null;
            applyHide();
        }, delayMs);
        return;
    }

    applyHide();
}

function setImportProgressState(nextState) {
    if (importProgressHideTimeout) {
        clearTimeout(importProgressHideTimeout);
        importProgressHideTimeout = null;
    }

    importProgressState = {
        ...importProgressState,
        ...nextState,
    };

    updateImportProgressUI();
}

function hideImportProgress({ delayMs = 0 } = {}) {
    const applyHide = () => {
        importProgressState = {
            visible: false,
            active: false,
            status: 'idle',
            source: null,
            phase: null,
            stage: null,
            percent: 0,
            completed: 0,
            total: 0,
            sessionCount: 0,
            solveCount: 0,
        };
        updateImportProgressUI();
    };

    if (importProgressHideTimeout) {
        clearTimeout(importProgressHideTimeout);
        importProgressHideTimeout = null;
    }

    if (delayMs > 0) {
        importProgressHideTimeout = setTimeout(() => {
            importProgressHideTimeout = null;
            applyHide();
        }, delayMs);
        return;
    }

    applyHide();
}

async function beginImportProgress(source = 'backup') {
    if (mobileViewportQuery.matches) {
        setActiveMobilePanel('timer');
    }

    setImportProgressState({
        visible: true,
        active: true,
        status: 'running',
        source,
        phase: 'starting',
        stage: 'starting',
        percent: 0,
        completed: 0,
        total: 0,
        sessionCount: 0,
        solveCount: 0,
    });

    await waitForNextPaint();
}

function applyImportProgress(snapshot) {
    setImportProgressState({
        visible: true,
        active: snapshot.phase !== 'complete',
        status: snapshot.phase === 'complete' ? 'complete' : 'running',
        source: snapshot.source,
        phase: snapshot.phase,
        stage: snapshot.stage,
        percent: snapshot.percent,
        completed: snapshot.completed,
        total: snapshot.total,
        sessionCount: snapshot.sessionCount ?? 0,
        solveCount: snapshot.solveCount ?? 0,
    });
}

function failImportProgress(source = importProgressState.source) {
    setImportProgressState({
        visible: true,
        active: false,
        status: 'error',
        source,
        phase: 'complete',
        stage: 'complete',
        percent: 100,
    });
    hideImportProgress({ delayMs: 2200 });
}
const buttonShortcutTooltipBindings = [
    { selector: '#btn-settings', binding: ['/'], placement: 'right' },
    { selector: '#scramble-text', binding: ['C'] },
    { selector: '#btn-copy-scramble', binding: ['C'] },
    { selector: '#btn-prev-scramble', binding: [','] },
    { selector: '#btn-next-scramble', binding: ['.'] },
    { selector: '#btn-scramble-preview', binding: ['S'] },
    { selector: '#btn-zen', binding: ['Z'] },
    { selector: '#btn-graph-distribution', binding: ['T'] },
    { selector: 'button[data-action="last25"]', binding: ['Shift', 'Enter'] },
    { selector: 'button[data-action="reset"]', binding: ['Enter'] },
    { selector: 'button[data-action="zoom-x-in"]', binding: ['Shift', 'ArrowLeft'] },
    { selector: 'button[data-action="zoom-x-out"]', binding: ['Shift', 'ArrowRight'] },
    { selector: 'button[data-action="pan-left"]', binding: ['ArrowLeft'] },
    { selector: 'button[data-action="pan-right"]', binding: ['ArrowRight'] },
    { selector: 'button[data-action="zoom-y-in"]', binding: ['Shift', 'ArrowUp'] },
    { selector: 'button[data-action="zoom-y-out"]', binding: ['Shift', 'ArrowDown'] },
    { selector: 'button[data-action="pan-up"]', binding: ['ArrowUp'] },
    { selector: 'button[data-action="pan-down"]', binding: ['ArrowDown'] },
    { selector: '#modal-btn-dnf', binding: ['-'] },
    { selector: '#modal-btn-plus2', binding: ['+'] },
    { selector: '#modal-btn-delete', binding: ['Backspace'] },
];
const keyboardShortcutGroups = [
    {
        title: 'Settings',
        items: [
            {
                action: 'Open keyboard shortcuts',
                bindings: [['Ctrl', '/']],
            },
            {
                action: 'Open settings',
                bindings: [['/']],
            },
        ],
    },
    {
        title: 'Timer',
        items: [
            {
                action: 'Start timer',
                bindings: [['Space']],
            },
            {
                action: 'Stackmat-style start',
                // detail: 'Press both hands together',
                bindings: [['Left Ctrl', 'Right Ctrl']],
            },
            {
                action: 'Stop timer',
                bindings: [['Any key']],
            },
            {
                action: 'Stop timer and mark as DNF',
                // detail: 'While the timer is running',
                bindings: [['Esc'], ['Backspace']],
            },

        ],
    },
    {
        title: 'Solves',
        items: [
            {
                action: 'Comment on last solve',
                bindings: [['Tab']],
            },
            {
                action: 'Delete solve',
                detail: 'Deletes last solve or selected solve',
                bindings: [['Backspace']],
            },
            {
                action: 'Add or remove +2',
                // detail: 'Affects the last solve or selected solve',
                bindings: [['='], ['+']],
            },
            {
                action: 'Add or remove DNF',
                // detail: 'Affects the last solve or selected solve',
                bindings: [['-']],
            },
            {
                action: 'Select all solves',
                // detail: 'Search mode selects all matches',
                bindings: [['Ctrl', 'A']],
            },
            {
                action: 'Open search',
                bindings: [['Ctrl', 'F']],
            },
            {
                action: 'Open single details',
                bindings: [['Shift', '`']],
            },
            {
                action: 'Open configured summary stats',
                detail: 'Shift + 1..0, -, = (based on Summary rows setting)',
                bindings: [['Shift', '1'], ['Shift', '2'], ['Shift', '3'], ['Shift', '4'], ['Shift', '5'], ['Shift', '6'], ['Shift', '7'], ['Shift', '8'], ['Shift', '9'], ['Shift', '0'], ['Shift', '-'], ['Shift', '=']],
            },
        ],
    },
    {
        title: 'Sessions',
        items: [
            {
                action: 'Previous session',
                bindings: [['Alt', 'Up']],
            },
            {
                action: 'Next session',
                bindings: [['Alt', 'Down']],
            },
        ],
    },
    {
        title: 'Scramble and layout',
        items: [
            {
                action: 'Switch to 2x2 through 7x7',
                bindings: [['Alt', '2~7']],
            },
            {
                action: 'Switch to Pyra, Mega, Clock, Skewb, Sq-1',
                bindings: [['Alt', ['P/M/C/S/1']]],
            },
            {
                action: 'Toggle zen mode',
                bindings: [['Z']],
            },
            {
                action: 'Toggle delta display',
                bindings: [['D']],
            },
            {
                action: 'Copy current scramble',
                bindings: [['C']],
            },
            {
                action: 'Previous scramble',
                bindings: [[',']],
            },
            {
                action: 'Next scramble',
                bindings: [['.']],
            },
            {
                action: 'Open scramble preview',
                bindings: [['S']],
            },
            {
                action: 'Open time distribution',
                bindings: [['T']],
            },
        ],
    },
    {
        title: 'Graph',
        items: [
            {
                action: 'Pan graph',
                bindings: [['Arrow keys']],
            },
            {
                action: 'Zoom graph',
                bindings: [['Shift', 'Arrow keys']],
            },
            {
                action: 'Reset graph view',
                bindings: [['Enter']],
            },
            {
                action: 'Show last 25 solves',
                bindings: [['Shift', 'Enter']],
            },
        ],
    },
];
const ALT_SESSION_SHORTCUT_OFFSETS = new Map([
    ['ArrowUp', -1],
    ['ArrowDown', 1],
]);
const ALT_SCRAMBLE_TYPE_SHORTCUTS = new Map([
    ['Digit1', 'sq1'],
    ['Digit2', '222'],
    ['Digit3', '333'],
    ['Digit4', '444'],
    ['Digit5', '555'],
    ['Digit6', '666'],
    ['Digit7', '777'],
    ['KeyP', 'pyram'],
    ['KeyM', 'minx'],
    ['KeyC', 'clock'],
    ['KeyS', 'skewb'],
]);
const blockingOverlayIds = ['modal-overlay', 'distribution-overlay', 'scramble-preview-overlay', 'confirm-overlay', 'prompt-overlay', 'shortcuts-overlay', 'chart-image-overlay', 'theme-customization-overlay'];
const THEME_OPTION_LABELS = new Map(THEME_OPTIONS.map(({ value, label }) => [value, label]));
let settingsOverlayEl = null;
let shortcutsOverlayEl = null;
let themeCustomizationOverlayEl = null;
let scramblePreviewOverlayEl = null;
let scramblePreviewModalCanvas = null;
let scramblePreviewModalSizeFrame = 0;
let scramblePreviewThemeRefreshTimeout = 0;
let themeCustomizationCloseCleanupTimer = 0;
let syncSettingsRowSeparators = () => { };
let shortcutTooltipEl = null;
let viewportLayoutFrame = null;
let instantTimerTabLayoutCleanupFrame = null;
let desktopScrambleTransitionSyncFrame = null;
let summaryRowsCache = { signature: '', rows: [] };
const rollingStatSummaryCache = new Map();
const domCache = new Map();
const customSelectControllers = new Map();
const viewportLayoutState = {
    timerTransform: null,
    scrambleTransform: null,
    modeKey: null,
};
const mobileScrambleFreezeState = {
    hasSnapshot: false,
    locked: false,
    transform: '',
    fontSize: '',
    maxWidth: '',
    whiteSpace: '',
};
const desktopScrambleTransitionProperties = new Set();
const quickActionsState = {
    visible: false,
    pinned: false,
    swipeVisibilityOverride: false,
    manualEntryActive: false,
    manualEntryHistoryManaged: false,
    manualDigits: '',
    restoreVisibleAfterManual: false,
    restorePinnedAfterManual: false,
    swipePointerId: null,
    swipeStartTimerState: null,
    swipeStartTime: 0,
    swipeStartX: 0,
    swipeStartY: 0,
    swipeHandled: false,
};
const mobilePanelIds = new Set(['timer', 'stats', 'trend']);
const mobileViewportQuery = window.matchMedia('(max-width: 1100px), (pointer: coarse)');
const shortMobileLandscapeQuery = window.matchMedia('(max-width: 1100px) and (orientation: landscape) and (max-height: 650px), (pointer: coarse) and (orientation: landscape) and (max-height: 650px)');
const mobileLandscapeQuery = window.matchMedia('(max-width: 1100px) and (orientation: landscape), (pointer: coarse) and (orientation: landscape)');
const touchPrimaryQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const finePointerQuery = window.matchMedia('(pointer: fine)');
const inspectionSpeechUnlockState = {
    required: false,
    unlocked: false,
    inFlight: false,
    dismissed: false,
};
const cubeFaceColors = ['#FFF', '#F00', '#33CD32', '#FFFF05', '#FFA503', '#00F'];
const pyraminxFaceColors = ['#FFFF05', '#33CD32', '#F00', '#00F'];
const INITIAL_NON_333_STARTUP_SCRAMBLE_DELAY_MS = 220;
const STANDARD_CUBE_PREVIEW_SIZES = new Map([
    ['222', 2],
    ['222cll', 2],
    ['222eg1', 2],
    ['222eg2', 2],
    ['333', 3],
    ['444', 4],
    ['555', 5],
    ['666', 6],
    ['777', 7],
]);
const YELLOW_TOP_PREVIEW_TYPES = new Set(['ll', 'pll', 'zbll', 'lsll', 'cmll']);
const CUBE_PREVIEW_SCRAMBLE_TYPES = new Set([
    ...STANDARD_CUBE_PREVIEW_SIZES.keys(),
    ...YELLOW_TOP_PREVIEW_TYPES,
]);
const MEGAMINX_PREVIEW_SCRAMBLE_TYPES = new Set(['minx']);
const PYRAMINX_PREVIEW_SCRAMBLE_TYPES = new Set(['pyram', 'pyrl4e']);
const SKEWB_PREVIEW_SCRAMBLE_TYPES = new Set(['skewb']);
const SQUARE1_PREVIEW_SCRAMBLE_TYPES = new Set(['sq1']);
const CLOCK_PREVIEW_SCRAMBLE_TYPES = new Set(['clock']);
const SCRAMBLE_PREVIEW_TYPES = new Set([
    ...CUBE_PREVIEW_SCRAMBLE_TYPES,
    ...MEGAMINX_PREVIEW_SCRAMBLE_TYPES,
    ...PYRAMINX_PREVIEW_SCRAMBLE_TYPES,
    ...SKEWB_PREVIEW_SCRAMBLE_TYPES,
    ...SQUARE1_PREVIEW_SCRAMBLE_TYPES,
    ...CLOCK_PREVIEW_SCRAMBLE_TYPES,
]);
const PYRAMINX_PREVIEW_BUTTON_FACE_INDEX = 1;
const SCRAMBLE_PREVIEW_BUTTON_PLACEHOLDER_SIZE = 3;
const SCRAMBLE_PREVIEW_BUTTON_STICKER_GAP_RATIO = 0.12;
const SCRAMBLE_PREVIEW_BUTTON_STICKER_RADIUS_RATIO = 0.18;
const SCRAMBLE_PREVIEW_BUTTON_OUTLINE = 'rgba(0, 0, 0, 0.35)';
const PYRAMINX_PREVIEW_BUTTON_FACE_SIZE = 3;
const PYRAMINX_PREVIEW_BUTTON_TRIANGLE_HEIGHT_RATIO = Math.sqrt(3) / 2;
const PYRAMINX_PREVIEW_BUTTON_ROTATION_RAD = (2 * Math.PI) / 3;
const yellowTopPreviewFaceMap = Object.freeze({
    U: 'D',
    D: 'U',
    R: 'L',
    L: 'R',
    F: 'F',
    B: 'B',
});
const PYRAMINX_PREVIEW_BUTTON_TRIANGLE_DEFINITIONS = Object.freeze(createPreviewPyraminxTriangleDefinitions());

// ──── History & Back Button ────

function pushHistoryState() {
    // Only push if we're not already in a pushed state to avoid nested pushes for simple overlays
    if (window.history.state?.isBackIntercepted) return;
    window.history.pushState({ isBackIntercepted: true }, '');
}

function backToDismiss() {
    if (window.history.state?.isBackIntercepted) {
        window.history.back();
    }
}

function handlePopState(event) {
    if (event.state?.isBackIntercepted) return;

    // Check overlays in order of priority (most specific/blocking first)
    if (document.getElementById('confirm-overlay').classList.contains('active')) {
        // Custom confirm usually needs explicit action, but we can treat back as cancel
        const cancelBtn = document.getElementById('confirm-btn-cancel');
        cancelBtn?.click();
        return;
    }

    if (document.getElementById('prompt-overlay').classList.contains('active')) {
        const cancelBtn = document.getElementById('prompt-btn-cancel');
        cancelBtn?.click();
        return;
    }

    if (isShortcutsOverlayOpen()) {
        closeKeyboardShortcutsOverlay({ isPopState: true });
        return;
    }

    if (settingsOverlayEl?.classList.contains('active')) {
        closeSettingsPanel({ isPopState: true });
        return;
    }

    if (scramblePreviewOverlayEl?.classList.contains('active')) {
        closeScramblePreviewModal({ isPopState: true });
        return;
    }

    if (isTimeDistributionModalOpen()) {
        closeTimeDistributionModal({ isPopState: true });
        return;
    }

    if (document.getElementById('modal-overlay').classList.contains('active')) {
        closeModal({ isPopState: true });
        return;
    }

    if (isManualTimeEntryActive() && !isDesktopTypingEntryModeEnabled()) {
        closeManualTimeEntry({
            restoreQuickActions: isMobileTimerPanelActive(),
            pinned: quickActionsState.restorePinnedAfterManual,
            isPopState: true,
        });
        return;
    }

    // Special case: Timer running
    if (timer.getState() === 'running') {
        // Stop timer without penalty (no DNF)
        timer.stop();
        return;
    }

    // Special case: Timer primed/holding/ready
    const state = timer.getState();
    if (state === 'holding' || state === 'ready' || isInspectionState(state)) {
        timer.cancelPendingStart();
    }
}

window.addEventListener('popstate', handlePopState);

function isTouchPrimaryInput() {
    return touchPrimaryQuery.matches;
}

function isLikelyIOSDevice() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafariBrowser() {
    const ua = navigator.userAgent || '';
    const isSafari = /Safari\//.test(ua) && /Version\//.test(ua);
    const isOtherBrowserOnWebKit = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Firefox|Edg|OPR/.test(ua);
    return isSafari && !isOtherBrowserOnWebKit;
}

function initInspectionSpeechUnlockState() {
    const speechSupported = 'speechSynthesis' in window;
    const requiresUnlock = speechSupported && isLikelyIOSDevice();
    inspectionSpeechUnlockState.required = requiresUnlock;
    inspectionSpeechUnlockState.unlocked = !requiresUnlock;
    inspectionSpeechUnlockState.inFlight = false;
    inspectionSpeechUnlockState.dismissed = false;
}

function shouldShowInspectionSpeechUnlockPrompt() {
    if (!inspectionSpeechUnlockState.required) return false;
    if (!isTouchPrimaryInput()) return false;
    if (inspectionSpeechUnlockState.unlocked) return false;
    if (inspectionSpeechUnlockState.dismissed) return false;
    const timerState = timer.getState();
    if (timerState !== 'idle' && timerState !== 'stopped') return false;
    if (settings.get('inspectionTime') !== '15s') return false;

    const alertMode = settings.get('inspectionAlerts');
    return alertMode === 'voice' || alertMode === 'both';
}

function syncInspectionSpeechUnlockPromptVisibility() {
    const promptWrap = getEl('inspection-voice-unlock-wrap');
    if (!promptWrap) return;
    promptWrap.hidden = !shouldShowInspectionSpeechUnlockPrompt();
}

function syncInspectionCancelControl(state = timer.getState()) {
    const cancelWrap = getEl('inspection-cancel-wrap');
    if (!cancelWrap) return;

    const shouldShow = mobileViewportQuery.matches
        && document.body.dataset.mobilePanel === 'timer'
        && isInspectionState(state);

    cancelWrap.hidden = !shouldShow;
}

function initInspectionCancelControl() {
    const cancelBtn = getEl('inspection-cancel-btn');
    if (!cancelBtn) return;

    cancelBtn.addEventListener('click', (event) => {
        event.preventDefault();
        timer.cancelInspection();
    });

    syncInspectionCancelControl();
}

function initInspectionSpeechUnlockPrompt() {
    const promptBtn = getEl('inspection-voice-unlock-btn');
    if (!promptBtn) return;

    syncInspectionSpeechUnlockPromptVisibility();

    promptBtn.onclick = async () => {
        inspectionSpeechUnlockState.dismissed = true;
        syncInspectionSpeechUnlockPromptVisibility();
        await unlockInspectionSpeechFromGesture();
    };
}

function unlockInspectionSpeechFromGesture() {
    if (!('speechSynthesis' in window)) return Promise.resolve(false);
    if (!inspectionSpeechUnlockState.required) {
        inspectionSpeechUnlockState.unlocked = true;
        return Promise.resolve(true);
    }
    if (inspectionSpeechUnlockState.unlocked) return Promise.resolve(true);
    if (inspectionSpeechUnlockState.inFlight) return Promise.resolve(false);

    inspectionSpeechUnlockState.inFlight = true;

    return new Promise((resolve) => {
        let settled = false;

        const finish = (ok) => {
            if (settled) return;
            settled = true;
            inspectionSpeechUnlockState.inFlight = false;
            if (ok) inspectionSpeechUnlockState.unlocked = true;
            resolve(ok);
        };

        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance('Voice alerts enabled');
            utterance.volume = 0;
            utterance.rate = 1;
            utterance.onstart = () => finish(true);
            utterance.onend = () => finish(true);
            utterance.onerror = () => finish(false);
            window.speechSynthesis.speak(utterance);

            setTimeout(() => {
                finish(inspectionSpeechUnlockState.unlocked);
            }, 900);
        } catch (error) {
            finish(false);
        }
    });
}

function areShortcutTooltipsAvailable() {
    return !coarsePointerQuery.matches;
}

function getEl(id) {
    if (!domCache.has(id)) {
        domCache.set(id, document.getElementById(id));
    }
    return domCache.get(id);
}

function isMobileTimerPanelActive() {
    return mobileViewportQuery.matches && document.body.dataset.mobilePanel === 'timer';
}

function isQuickActionsSwipeOpenState(state) {
    return state === 'idle'
        || state === 'stopped';
}

function isDesktopTypingEntryModeEnabled() {
    return settings.get('timeEntryMode') === 'typing' && !coarsePointerQuery.matches;
}

function isManualTimeEntryActive() {
    return quickActionsState.manualEntryActive;
}

function isManualTimeInputFocused() {
    const hiddenInput = getEl('manual-time-hidden-input');
    return Boolean(hiddenInput) && document.activeElement === hiddenInput;
}

function syncManualTimeInputFocusState() {
    document.body.classList.toggle('manual-time-input-focused', isManualTimeInputFocused());
}

function sanitizeManualDigits(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 7);
}

function getManualTimeParts(digits) {
    const sanitized = sanitizeManualDigits(digits);
    const fractionSource = sanitized.slice(-2);
    const fractionText = fractionSource.padStart(2, '0') || '00';

    if (sanitized.length > 6) {
        const hourSource = sanitized.slice(0, -6);
        const minuteSource = sanitized.slice(-6, -4);
        const secondSource = sanitized.slice(-4, -2);

        return {
            sanitized,
            hasHours: true,
            hasMinutes: true,
            hourText: hourSource,
            minuteText: minuteSource,
            secondText: secondSource,
            fractionText,
            hourTypedCount: hourSource.length,
            minuteTypedCount: minuteSource.length,
            secondTypedCount: secondSource.length,
            fractionTypedCount: fractionSource.length,
        };
    }

    if (sanitized.length > 4) {
        const minuteSource = sanitized.slice(0, -4);
        const secondSource = sanitized.slice(-4, -2);

        return {
            sanitized,
            hasHours: false,
            hasMinutes: true,
            minuteText: minuteSource,
            secondText: secondSource,
            fractionText,
            minuteTypedCount: minuteSource.length,
            secondTypedCount: secondSource.length,
            fractionTypedCount: fractionSource.length,
        };
    }

    const integerSource = sanitized.slice(0, -2);

    return {
        sanitized,
        hasHours: false,
        hasMinutes: false,
        integerText: integerSource || '0',
        fractionText,
        integerTypedCount: integerSource.length,
        fractionTypedCount: fractionSource.length,
    };
}

function getManualElapsedMs(digits) {
    const sanitized = sanitizeManualDigits(digits);
    if (!sanitized) return 0;
    if (sanitized.length <= 4) return Number(sanitized) * 10;
    if (sanitized.length <= 6) {
        const minutes = Number(sanitized.slice(0, -4));
        const seconds = Number(sanitized.slice(-4, -2));
        const centiseconds = Number(sanitized.slice(-2));

        return (minutes * 60 * 1000) + (seconds * 1000) + (centiseconds * 10);
    }

    const hours = Number(sanitized.slice(0, -6));
    const minutes = Number(sanitized.slice(-6, -4));
    const seconds = Number(sanitized.slice(-4, -2));
    const centiseconds = Number(sanitized.slice(-2));

    return (hours * 60 * 60 * 1000)
        + (minutes * 60 * 1000)
        + (seconds * 1000)
        + (centiseconds * 10);
}

function formatManualTimeDigits(digits) {
    const parts = getManualTimeParts(digits);

    if (parts.hasHours) {
        return `${parts.hourText}:${parts.minuteText}:${parts.secondText}.${parts.fractionText}`;
    }

    if (parts.hasMinutes) {
        return `${parts.minuteText}:${parts.secondText}.${parts.fractionText}`;
    }

    return `${parts.integerText}.${parts.fractionText}`;
}

function renderManualTimeMarkup(digits) {
    const parts = getManualTimeParts(digits);
    const fractionTypedStart = Math.max(0, parts.fractionText.length - parts.fractionTypedCount);
    const fractionMarkup = Array.from(parts.fractionText, (char, index) => (
        `<span class="manual-time-char${index >= fractionTypedStart ? ' is-typed' : ''}">${char}</span>`
    )).join('');

    if (parts.hasHours) {
        const hourMarkup = Array.from(parts.hourText, (char) => (
            '<span class="manual-time-char is-typed">' + char + '</span>'
        )).join('');
        const firstColonMarkup = '<span class="manual-time-char is-typed">:</span>';
        const minuteMarkup = Array.from(parts.minuteText, (char) => (
            '<span class="manual-time-char is-typed">' + char + '</span>'
        )).join('');
        const secondColonMarkup = '<span class="manual-time-char is-typed">:</span>';
        const secondMarkup = Array.from(parts.secondText, (char) => (
            '<span class="manual-time-char is-typed">' + char + '</span>'
        )).join('');
        const dotMarkup = '<span class="manual-time-char is-typed">.</span>';

        return `${hourMarkup}${firstColonMarkup}${minuteMarkup}${secondColonMarkup}${secondMarkup}${dotMarkup}${fractionMarkup}`;
    }

    if (parts.hasMinutes) {
        const minuteMarkup = Array.from(parts.minuteText, (char) => (
            '<span class="manual-time-char is-typed">' + char + '</span>'
        )).join('');
        const colonMarkup = '<span class="manual-time-char is-typed">:</span>';
        const secondMarkup = Array.from(parts.secondText, (char) => (
            '<span class="manual-time-char is-typed">' + char + '</span>'
        )).join('');
        const dotMarkup = '<span class="manual-time-char is-typed">.</span>';

        return `${minuteMarkup}${colonMarkup}${secondMarkup}${dotMarkup}${fractionMarkup}`;
    }

    const integerTypedStart = Math.max(0, parts.integerText.length - parts.integerTypedCount);
    const integerMarkup = Array.from(parts.integerText, (char, index) => (
        `<span class="manual-time-char${index >= integerTypedStart ? ' is-typed' : ''}">${char}</span>`
    )).join('');
    const dotIsTyped = parts.integerTypedCount > 0 && parts.fractionTypedCount > 0;
    const dotMarkup = `<span class="manual-time-char${dotIsTyped ? ' is-typed' : ''}">.</span>`;

    return `${integerMarkup}${dotMarkup}${fractionMarkup}`;
}

function getLastSessionSolve() {
    const session = sessionManager.getActiveSession();
    if (!session || session.solves.length === 0) return null;
    return session.solves[session.solves.length - 1];
}

function promptForSolveComment(solve, title = 'Comment on last solve') {
    if (!solve) return Promise.resolve();

    return customPrompt('', solve.comment || '', 1000, title, 'Type a comment and press Enter...').then(comment => {
        if (comment !== null && comment !== (solve.comment || '')) {
            sessionManager.setSolveComment(solve.id, comment);
        }
    });
}

function toggleLastSolvePenaltyFromMainTimerShortcut(penalty) {
    const session = sessionManager.getActiveSession();
    if (!session || session.solves.length === 0) return;

    const lastSolve = session.solves[session.solves.length - 1];
    const solveNumber = session.solves.length;

    const previousPenalty = lastSolve.penalty;
    const updatedSolve = sessionManager.togglePenalty(lastSolve.id, penalty);
    if (!updatedSolve) return;

    if (mobileViewportQuery.matches) return;

    if (updatedSolve.penalty === penalty) {
        showPenaltyShortcutAlert('applied', penalty, solveNumber);
        return;
    }

    if (previousPenalty === penalty && updatedSolve.penalty == null) {
        showPenaltyShortcutAlert('cleared', null, solveNumber);
    }
}

function ensurePanelExpanded(panelId) {
    const panel = getEl(panelId);
    const body = panel?.querySelector('.collapsible-body');
    const header = panel?.querySelector('.panel-header');
    if (!panel?.classList.contains('collapsed')) return;

    if (panel.id === 'graph-panel' && mobileViewportQuery.matches && body) {
        panel.classList.remove('collapsed');
        body.style.maxHeight = 'none';
        settings.set('graphCollapsed', false);
        return;
    }

    if (header) {
        header.click();
    }
}

function hideMobileScrambleActions() {
    getEl('scramble-container')?.classList.remove('scramble-actions-visible');
}

function getSessionSelects() {
    return Array.from(document.querySelectorAll('#session-select, #mobile-session-select'));
}

function getLayoutRect(el) {
    if (!el) return null;

    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (!width && !height) return el.getBoundingClientRect();

    let left = 0;
    let top = 0;
    let node = el;
    while (node) {
        left += node.offsetLeft || 0;
        top += node.offsetTop || 0;
        node = node.offsetParent;
    }

    left -= window.scrollX;
    top -= window.scrollY;

    return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
    };
}

function combineLayoutRects(...rects) {
    const validRects = rects.filter(Boolean);
    if (!validRects.length) return null;

    const left = Math.min(...validRects.map((rect) => rect.left));
    const top = Math.min(...validRects.map((rect) => rect.top));
    const right = Math.max(...validRects.map((rect) => rect.right));
    const bottom = Math.max(...validRects.map((rect) => rect.bottom));

    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
        right,
        bottom,
    };
}

function getProjectedMobileTimerTop() {
    if (!mobileViewportQuery.matches || document.body.dataset.mobilePanel !== 'timer') return null;

    const timerDisplayWrapper = getEl('timer-display-wrapper');
    const timerDisplay = getEl('timer-display');
    const timerAnchor = timerDisplay || timerDisplayWrapper;
    const timerRect = getLayoutRect(timerAnchor);
    const timerVisualRect = timerDisplay?.getBoundingClientRect()
        || timerDisplayWrapper?.getBoundingClientRect();

    if (!timerRect?.height) return timerVisualRect?.top ?? null;

    const state = timer.getState();
    const isZen = document.body.classList.contains('zen');
    const centerTimerEnabled = settings.get('centerTimer');
    const shouldFocusTimer = state === 'running' || state === 'ready' || isInspectionState(state);
    const shouldApplyMobileTimerPositioning = centerTimerEnabled || isZen;
    const shouldViewportCenterTimer = shouldFocusTimer && (centerTimerEnabled || isZen);
    const shouldPositionIdleMobileTimer = shouldApplyMobileTimerPositioning && !shouldFocusTimer;
    let targetTimerCenterY = null;
    let sourcePositioningRect = timerRect;

    if (shouldViewportCenterTimer) {
        targetTimerCenterY = window.innerHeight / 2;
    } else if (!shouldPositionIdleMobileTimer) {
        return timerVisualRect?.top ?? timerRect.top;
    } else if (isZen) {
        targetTimerCenterY = window.innerHeight / 2;
    } else {
        const rightPanelRect = getEl('right-panel')?.getBoundingClientRect();
        const zenRect = getEl('btn-zen')?.getBoundingClientRect();
        const scrambleRect = getMobileScrambleTextLayoutRect();
        const quickActions = getEl('timer-quick-actions');
        const quickActionsRect = quickActions && !quickActions.hidden
            ? getLayoutRect(quickActions)
            : null;
        const duetRect = combineLayoutRects(timerRect, quickActionsRect);
        const freeBottom = rightPanelRect?.top ?? window.innerHeight;
        sourcePositioningRect = duetRect || timerRect;

        const zenCenterY = zenRect ? zenRect.top + (zenRect.height / 2) : 0;
        const preservedScrambleCenterY = scrambleRect
            ? ((3 * zenCenterY) + (freeBottom - 12)) / 4
            : zenCenterY;
        const scrambleBottom = scrambleRect
            ? preservedScrambleCenterY + (scrambleRect.height / 2)
            : zenCenterY;
        targetTimerCenterY = (scrambleBottom + freeBottom) / 2;
    }

    // Mirror the real mobile timer transform so scramble fitting uses the timer display's
    // actual projected top edge, not the taller timer-plus-actions block.
    if (shortMobileLandscapeQuery.matches && (state === 'idle' || state === 'stopped' || state === 'holding')) {
        targetTimerCenterY += 30;
    }

    const sourceCenterY = sourcePositioningRect.top + (sourcePositioningRect.height / 2);
    const offsetY = targetTimerCenterY - sourceCenterY;
    return timerRect.top + offsetY;
}

function getMobileScrambleTextLayoutRect() {
    const scrambleText = getEl('scramble-text');
    const scrambleTextWrapper = getEl('scramble-text-wrapper');
    return getLayoutRect(scrambleText && scrambleText.style.display !== 'none'
        ? scrambleText
        : scrambleTextWrapper);
}

function resetMobileScrambleLayoutFreeze({ clearSnapshot = false } = {}) {
    mobileScrambleFreezeState.locked = false;

    if (!clearSnapshot) return;

    mobileScrambleFreezeState.hasSnapshot = false;
    mobileScrambleFreezeState.transform = '';
    mobileScrambleFreezeState.fontSize = '';
    mobileScrambleFreezeState.maxWidth = '';
    mobileScrambleFreezeState.whiteSpace = '';
}

function lockMobileScrambleLayoutFreeze() {
    if (!mobileScrambleFreezeState.hasSnapshot) return;
    mobileScrambleFreezeState.locked = true;
}

function shouldApplyFrozenMobileScrambleLayout() {
    return mobileViewportQuery.matches
        && document.body.dataset.mobilePanel === 'timer'
        && mobileScrambleFreezeState.locked
        && mobileScrambleFreezeState.hasSnapshot;
}

function applyFrozenMobileScrambleTextLayout() {
    const scrambleText = getEl('scramble-text');
    if (!scrambleText || !mobileScrambleFreezeState.hasSnapshot) return false;

    scrambleText.style.fontSize = mobileScrambleFreezeState.fontSize;

    if (mobileScrambleFreezeState.maxWidth) {
        scrambleText.style.maxWidth = mobileScrambleFreezeState.maxWidth;
    } else {
        scrambleText.style.removeProperty('max-width');
    }

    if (mobileScrambleFreezeState.whiteSpace) {
        scrambleText.style.whiteSpace = mobileScrambleFreezeState.whiteSpace;
    } else {
        scrambleText.style.removeProperty('white-space');
    }

    return true;
}

function captureMobileScrambleLayoutSnapshot() {
    const scrambleContainer = getEl('scramble-container');
    const scrambleText = getEl('scramble-text');
    if (!scrambleContainer || !scrambleText) return;

    mobileScrambleFreezeState.transform = scrambleContainer.style.transform || '';
    mobileScrambleFreezeState.fontSize = scrambleText.style.fontSize || '';
    mobileScrambleFreezeState.maxWidth = scrambleText.style.maxWidth || '';
    mobileScrambleFreezeState.whiteSpace = scrambleText.style.whiteSpace || '';
    mobileScrambleFreezeState.hasSnapshot = true;
}

function getMobileScrambleVerticalBounds() {
    const scrambleText = getEl('scramble-text');
    const topRowRect = getEl('scramble-top-row')?.getBoundingClientRect();
    const rightPanelRect = getEl('right-panel')?.getBoundingClientRect();
    const isLandscapeMegaminx = mobileLandscapeQuery.matches
        && scrambleText?.dataset.scrambleLayout === 'megaminx-rows';
    const topGap = isLandscapeMegaminx ? -6 : 8;
    const timerGap = 8;
    const panelGap = 12;
    const projectedTimerTop = getProjectedMobileTimerTop();
    const currentTimerTop = getEl('timer-display')?.getBoundingClientRect()?.top
        ?? getEl('timer-display-wrapper')?.getBoundingClientRect()?.top
        ?? null;
    const timerTop = [projectedTimerTop, currentTimerTop]
        .filter((value) => Number.isFinite(value))
        .reduce((smallest, value) => Math.min(smallest, value), Number.POSITIVE_INFINITY);
    const topLimit = (topRowRect?.bottom ?? 0) + topGap;
    let bottomLimit = (rightPanelRect?.top ?? window.innerHeight) - panelGap;

    if (Number.isFinite(timerTop)) {
        bottomLimit = Math.min(bottomLimit, timerTop - timerGap);
    }

    return {
        topLimit,
        bottomLimit,
        availableHeight: bottomLimit - topLimit,
    };
}

function updateManualTimeEntryUI() {
    const hiddenInput = getEl('manual-time-hidden-input');
    const formattedEl = getEl('manual-time-formatted');
    const submitBtn = getEl('manual-time-submit');
    const hasValue = Number(quickActionsState.manualDigits || 0) > 0;

    if (hiddenInput) hiddenInput.value = quickActionsState.manualDigits;
    if (formattedEl) formattedEl.innerHTML = renderManualTimeMarkup(quickActionsState.manualDigits);
    if (submitBtn) submitBtn.disabled = !hasValue;
}

function updateQuickActionButtons() {
    const lastSolve = getLastSessionSolve();
    const plus2Btn = getEl('timer-action-plus2');
    const dnfBtn = getEl('timer-action-dnf');
    const deleteBtn = getEl('timer-action-delete');
    const commentBtn = getEl('timer-action-comment');
    const addBtn = getEl('timer-action-add');

    if (plus2Btn) {
        plus2Btn.disabled = !lastSolve;
        plus2Btn.classList.toggle('is-active', lastSolve?.penalty === '+2');
    }

    if (dnfBtn) {
        dnfBtn.disabled = !lastSolve;
        dnfBtn.classList.toggle('is-active', lastSolve?.penalty === 'DNF');
    }

    if (deleteBtn) {
        deleteBtn.disabled = !lastSolve;
        deleteBtn.classList.remove('is-active');
    }

    if (commentBtn) {
        commentBtn.disabled = !lastSolve;
        commentBtn.classList.toggle('is-active', Boolean(lastSolve?.comment?.trim()));
    }

    if (addBtn) {
        addBtn.classList.toggle('is-active', quickActionsState.manualEntryActive);
    }
}

function syncQuickActionsUI() {
    const quickActionsEl = getEl('timer-quick-actions');
    if (!quickActionsEl) return;

    const shouldReserveMobileQuickActionsSpace = isMobileTimerPanelActive();
    const shouldShow = quickActionsState.visible
        && coarsePointerQuery.matches
        && shouldReserveMobileQuickActionsSpace
        && !quickActionsState.manualEntryActive;
    quickActionsEl.hidden = !shouldReserveMobileQuickActionsSpace;
    quickActionsEl.classList.toggle('is-visible', shouldShow);
    quickActionsEl.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    document.body.classList.toggle('timer-quick-actions-visible', shouldShow);
    updateQuickActionButtons();
    scheduleViewportLayoutSync();
}

function setQuickActionsVisible(visible, { pinned = quickActionsState.pinned } = {}) {
    quickActionsState.visible = Boolean(visible);
    quickActionsState.pinned = quickActionsState.visible ? Boolean(pinned) : false;
    if (!quickActionsState.visible) quickActionsState.swipeVisibilityOverride = false;
    syncQuickActionsUI();
}

function syncManualTimeInputMode() {
    const hiddenInput = getEl('manual-time-hidden-input');
    if (!hiddenInput) return;
    hiddenInput.tabIndex = isDesktopTypingEntryModeEnabled() ? -1 : 0;
    syncManualTimeInputFocusState();
}

function focusManualTimeInput() {
    const hiddenInput = getEl('manual-time-hidden-input');
    if (!hiddenInput) return;
    hiddenInput.focus({ preventScroll: true });
    if (typeof hiddenInput.setSelectionRange === 'function') {
        const len = hiddenInput.value.length;
        hiddenInput.setSelectionRange(len, len);
    }
    syncManualTimeInputFocusState();
}

function blurManualTimeInput() {
    const hiddenInput = getEl('manual-time-hidden-input');
    if (!hiddenInput) return;
    if (document.activeElement === hiddenInput) hiddenInput.blur();
    syncManualTimeInputFocusState();
}

function openManualTimeEntry({ initialDigits = '', focusStrategy = 'deferred' } = {}) {
    if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

    const manualEntryEl = getEl('manual-time-entry');
    if (!manualEntryEl) return;

    const shouldManageHistory = !isDesktopTypingEntryModeEnabled();

    if (!quickActionsState.manualEntryActive && shouldManageHistory) {
        pushHistoryState();
    }

    if (!quickActionsState.manualEntryActive) {
        quickActionsState.restoreVisibleAfterManual = quickActionsState.visible;
        quickActionsState.restorePinnedAfterManual = quickActionsState.pinned;
    }

    quickActionsState.manualEntryActive = true;
    quickActionsState.manualEntryHistoryManaged = shouldManageHistory;
    quickActionsState.manualDigits = sanitizeManualDigits(initialDigits || quickActionsState.manualDigits);
    manualEntryEl.hidden = false;
    document.body.classList.add('manual-time-entry-active');
    syncManualTimeInputMode();
    updateManualTimeEntryUI();
    syncQuickActionsUI();
    syncManualTimeInputFocusState();

    if (focusStrategy === 'immediate') {
        focusManualTimeInput();
        return;
    }

    window.requestAnimationFrame(() => {
        if (!isManualTimeInputFocused()) focusManualTimeInput();
    });
}

function closeManualTimeEntry({ restoreQuickActions = quickActionsState.restoreVisibleAfterManual, pinned = quickActionsState.restorePinnedAfterManual, resetDigits = true, isPopState = false } = {}) {
    if (!isPopState && quickActionsState.manualEntryHistoryManaged) {
        backToDismiss();
    }

    const manualEntryEl = getEl('manual-time-entry');
    const hiddenInput = getEl('manual-time-hidden-input');

    quickActionsState.manualEntryActive = false;
    quickActionsState.manualEntryHistoryManaged = false;
    document.body.classList.remove('manual-time-entry-active');

    if (manualEntryEl) manualEntryEl.hidden = true;
    if (hiddenInput && document.activeElement === hiddenInput) hiddenInput.blur();

    if (resetDigits) quickActionsState.manualDigits = '';
    syncManualTimeInputMode();
    syncManualTimeInputFocusState();
    updateManualTimeEntryUI();

    if (restoreQuickActions && isMobileTimerPanelActive()) {
        setQuickActionsVisible(true, { pinned });
    } else {
        setQuickActionsVisible(false);
    }
}

function syncPersistentManualEntryMode() {
    syncManualTimeInputMode();

    if (isDesktopTypingEntryModeEnabled()) {
        openManualTimeEntry();
        return;
    }

    // Close the persistent desktop typing UI immediately when typing mode is turned off,
    // but keep mobile quick-action manual entry flows intact.
    if (quickActionsState.manualEntryActive && !quickActionsState.manualEntryHistoryManaged) {
        closeManualTimeEntry({ restoreQuickActions: false });
    }
}

async function commitSolve(elapsed, penalty = null, { isManual = false } = {}) {
    syncStatsCacheWithFilteredSolves();
    const previousStats = statsCache.getStats();
    _skipSolveAddedRefresh = true;
    const solve = sessionManager.addSolve(elapsed, currentScramble, isManual, penalty);
    _skipSolveAddedRefresh = false;
    statsCache.append(solve);
    syncStatsCacheWithFilteredSolves();
    const currentStats = statsCache.getStats();
    maybeShowNewBestAlert(previousStats, currentStats);
    refreshUI();
    await loadNewScramble();
}

async function submitManualTimeEntry({ closeEntry = false } = {}) {
    const digits = quickActionsState.manualDigits;
    if (Number(digits || 0) <= 0) return;

    if (isDesktopTypingEntryModeEnabled()) {
        const elapsed = getManualElapsedMs(digits);
        quickActionsState.manualDigits = '';
        updateManualTimeEntryUI();
        await commitSolve(elapsed, null, { isManual: true });
        return;
    }

    if (closeEntry) {
        closeManualTimeEntry({
            restoreQuickActions: isMobileTimerPanelActive(),
            pinned: true,
        });
    } else {
        // Keep open and clear digits for rapid entry
        quickActionsState.manualDigits = '';
        updateManualTimeEntryUI();
    }

    await commitSolve(getManualElapsedMs(digits), null, { isManual: true });

    if (isMobileTimerPanelActive() && closeEntry) {
        setQuickActionsVisible(true, { pinned: true });
    }
}

function applyCachedTransform(el, stateKey, transform) {
    const normalizedTransform = transform || '';
    if (!el || viewportLayoutState[stateKey] === normalizedTransform) return;
    el.style.transform = normalizedTransform;
    viewportLayoutState[stateKey] = normalizedTransform;
}

function getViewportLayoutModeKey() {
    if (!mobileViewportQuery.matches) return 'desktop';
    return mobileLandscapeQuery.matches ? 'mobile-landscape' : 'mobile-portrait';
}

function syncViewportLayoutModeState() {
    const nextModeKey = getViewportLayoutModeKey();
    const previousModeKey = viewportLayoutState.modeKey;

    viewportLayoutState.modeKey = nextModeKey;

    if (previousModeKey == null || previousModeKey === nextModeKey) return;

    resetMobileScrambleLayoutFreeze({ clearSnapshot: true });
}

function scheduleViewportLayoutSync() {
    if (viewportLayoutFrame != null) return;
    viewportLayoutFrame = window.requestAnimationFrame(() => {
        viewportLayoutFrame = null;
        syncViewportLayout();
    });
}

function isDesktopScrambleWidthTransitionProperty(propertyName) {
    return propertyName === 'width' || propertyName === 'max-width';
}

function queueDesktopScrambleTransitionSync() {
    if (desktopScrambleTransitionSyncFrame != null) return;

    desktopScrambleTransitionSyncFrame = window.requestAnimationFrame(() => {
        desktopScrambleTransitionSyncFrame = null;
        if (!mobileViewportQuery.matches) {
            syncDesktopLargeScrambleTextFit();
        }

        if (desktopScrambleTransitionProperties.size > 0) {
            queueDesktopScrambleTransitionSync();
        }
    });
}

function startDesktopScrambleTransitionSync(propertyName) {
    if (!isDesktopScrambleWidthTransitionProperty(propertyName)) return;
    desktopScrambleTransitionProperties.add(propertyName);
    scheduleViewportLayoutSync();
    queueDesktopScrambleTransitionSync();
}

function stopDesktopScrambleTransitionSync(propertyName) {
    if (!isDesktopScrambleWidthTransitionProperty(propertyName)) return;
    desktopScrambleTransitionProperties.delete(propertyName);
    scheduleViewportLayoutSync();
}

function syncTimerTabLayoutWithoutAnimation() {
    if (instantTimerTabLayoutCleanupFrame != null) {
        window.cancelAnimationFrame(instantTimerTabLayoutCleanupFrame);
        instantTimerTabLayoutCleanupFrame = null;
    }

    document.body.classList.add('instant-mobile-timer-layout');
    syncViewportLayout();

    instantTimerTabLayoutCleanupFrame = window.requestAnimationFrame(() => {
        syncViewportLayout();
        document.body.classList.remove('instant-mobile-timer-layout');
        instantTimerTabLayoutCleanupFrame = null;
    });
}

function syncDesktopPanelScale() {
    const root = document.documentElement;
    if (!root) return;

    if (mobileViewportQuery.matches) {
        root.style.setProperty('--desktop-panel-scale', '1');
        return;
    }

    const minViewportHeight = 250;
    const maxViewportHeight = 850;
    const minScale = 0.25;
    const maxScale = 1;
    const viewportHeight = window.innerHeight;
    const ratio = (viewportHeight - minViewportHeight) / (maxViewportHeight - minViewportHeight);
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const scale = minScale + ((maxScale - minScale) * clampedRatio);

    root.style.setProperty('--desktop-panel-scale', scale.toFixed(4));
}

function syncDesktopScrambleBounds() {
    const scrambleContainer = getEl('scramble-container');
    const scrambleBar = getEl('scramble-bar');
    if (!scrambleContainer || !scrambleBar) return;

    if (mobileViewportQuery.matches) {
        scrambleContainer.style.removeProperty('--desktop-scramble-text-width');
        scrambleContainer.style.removeProperty('--desktop-scramble-text-half-width');
        return;
    }

    const scrambleBarStyles = getComputedStyle(scrambleBar);
    const paddingLeft = parseFloat(scrambleBarStyles.paddingLeft) || 0;
    const paddingRight = parseFloat(scrambleBarStyles.paddingRight) || 0;
    const scrambleBarInnerWidth = Math.max(0, scrambleBar.clientWidth - paddingLeft - paddingRight);
    const isZen = document.body.classList.contains('zen');
    let nextWidth = Math.min(scrambleBarInnerWidth, Math.round(window.innerWidth * 0.8));

    if (!isZen) {
        const leftRect = getEl('left-panel')?.getBoundingClientRect();
        const rightRect = getEl('right-panel')?.getBoundingClientRect();
        const panelMargin = 24;

        nextWidth = scrambleBarInnerWidth;
        if (leftRect && rightRect) {
            nextWidth = Math.min(
                scrambleBarInnerWidth,
                Math.max(0, rightRect.left - leftRect.right - (panelMargin * 2)),
            );
        }
    }

    const nextWidthPx = Math.round(nextWidth);
    scrambleContainer.style.setProperty('--desktop-scramble-text-width', `${nextWidthPx}px`);
    scrambleContainer.style.setProperty('--desktop-scramble-text-half-width', `${Math.round(nextWidthPx / 2)}px`);
}

function syncDesktopInlineScrambleInputHeight(scrambleInput = getEl('scramble-input'), scrambleTextWrapper = getEl('scramble-text-wrapper')) {
    if (mobileViewportQuery.matches) {
        scrambleTextWrapper?.style.removeProperty('--desktop-scramble-input-offset-y');
        return;
    }

    if (!scrambleInput || scrambleInput.style.display === 'none') {
        scrambleTextWrapper?.style.removeProperty('--desktop-scramble-input-offset-y');
        return;
    }

    scrambleInput.style.height = 'auto';
    scrambleInput.style.height = `${scrambleInput.scrollHeight}px`;

    const rowHeight = parseFloat(getComputedStyle(scrambleTextWrapper).getPropertyValue('--desktop-scramble-row-height')) || 32;
    const inputStyles = getComputedStyle(scrambleInput);
    const lineHeight = parseFloat(inputStyles.lineHeight) || parseFloat(getComputedStyle(scrambleTextWrapper).getPropertyValue('--desktop-scramble-line-height')) || rowHeight;
    const topInset = (parseFloat(inputStyles.borderTopWidth) || 0) + (parseFloat(inputStyles.paddingTop) || 0);
    const firstLineOffset = Math.round(((((rowHeight - lineHeight) / 2) - topInset) * 10)) / 10;
    scrambleTextWrapper?.style.setProperty('--desktop-scramble-input-offset-y', `${firstLineOffset}px`);
}

function setDesktopLargeScrambleFontSize(fontSizePx, scrambleText = getEl('scramble-text'), scrambleInput = getEl('scramble-input'), scrambleTextWrapper = getEl('scramble-text-wrapper')) {
    if (mobileViewportQuery.matches) return;
    const fontSizeValue = typeof fontSizePx === 'number' ? `${fontSizePx}px` : '';

    if (scrambleText) {
        if (fontSizeValue) scrambleText.style.fontSize = fontSizeValue;
        else scrambleText.style.removeProperty('font-size');
    }

    if (scrambleInput) {
        if (fontSizeValue) scrambleInput.style.fontSize = fontSizeValue;
        else scrambleInput.style.removeProperty('font-size');
    }

    if (scrambleTextWrapper) {
        if (fontSizeValue) scrambleTextWrapper.style.setProperty('--desktop-scramble-font-size', fontSizeValue);
        else scrambleTextWrapper.style.removeProperty('--desktop-scramble-font-size');
    }

    syncDesktopInlineScrambleInputHeight(scrambleInput, scrambleTextWrapper);
}

function clearDesktopLargeScrambleTextFit(scrambleText = getEl('scramble-text'), scrambleInput = getEl('scramble-input')) {
    if (mobileViewportQuery.matches) return;
    setDesktopLargeScrambleFontSize(null, scrambleText, scrambleInput);
}

function getTransformTranslate(transformValue) {
    if (!transformValue || transformValue === 'none') {
        return { x: 0, y: 0 };
    }

    if (typeof DOMMatrixReadOnly === 'function') {
        const matrix = new DOMMatrixReadOnly(transformValue);
        return { x: matrix.m41, y: matrix.m42 };
    }

    const matrix3dMatch = transformValue.match(/^matrix3d\((.+)\)$/);
    if (matrix3dMatch) {
        const values = matrix3dMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
        return {
            x: values[12] || 0,
            y: values[13] || 0,
        };
    }

    const matrixMatch = transformValue.match(/^matrix\((.+)\)$/);
    if (matrixMatch) {
        const values = matrixMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
        return {
            x: values[4] || 0,
            y: values[5] || 0,
        };
    }

    return { x: 0, y: 0 };
}

function doesDesktopLargeScrambleTextFit(scrambleText, timerDisplay, timerDisplayWrapper = getEl('timer-display-wrapper')) {
    if (!scrambleText || !timerDisplay) return true;

    const scrambleRect = scrambleText.getBoundingClientRect();
    const timerRect = timerDisplay.getBoundingClientRect();
    const wrapperTransform = timerDisplayWrapper ? getComputedStyle(timerDisplayWrapper).transform : 'none';
    const timerTransform = getComputedStyle(timerDisplay).transform;
    const { y: wrapperTranslateY } = getTransformTranslate(wrapperTransform);
    const { y: timerTranslateY } = getTransformTranslate(timerTransform);
    const baselineTimerTop = timerRect.top - wrapperTranslateY - timerTranslateY;

    let fits = scrambleRect.bottom <= baselineTimerTop + 0.5;

    if (fits && scrambleText.dataset.scrambleLayout === 'megaminx-rows') {
        fits = scrambleText.scrollWidth <= scrambleText.clientWidth + 1;
    }

    return fits;
}

function syncDesktopLargeScrambleTextFit() {
    const scrambleText = getEl('scramble-text');
    const scrambleInput = getEl('scramble-input');
    const timerDisplay = getEl('timer-display');
    const timerDisplayWrapper = getEl('timer-display-wrapper');
    if (!scrambleText || !scrambleInput || !timerDisplay) return;

    if (mobileViewportQuery.matches) {
        clearDesktopLargeScrambleTextFit(scrambleText, scrambleInput);
        return;
    }

    if (scrambleInput.style.display !== 'none') {
        const currentFontSizePx = parseFloat(scrambleText.style.fontSize) || parseFloat(getComputedStyle(scrambleText).fontSize) || 0;
        if (currentFontSizePx > 0) {
            setDesktopLargeScrambleFontSize(currentFontSizePx, scrambleText, scrambleInput);
        } else {
            clearDesktopLargeScrambleTextFit(scrambleText, scrambleInput);
        }
        return;
    }

    if (scrambleText.style.display === 'none') {
        clearDesktopLargeScrambleTextFit(scrambleText, scrambleInput);
        return;
    }

    clearDesktopLargeScrambleTextFit(scrambleText, scrambleInput);

    const defaultFontSizePx = parseFloat(getComputedStyle(scrambleText).fontSize) || 0;
    if (defaultFontSizePx <= 0) return;

    const largeScrambleTextEnabled = settings.get('largeScrambleText');
    const minFontSizePx = 1;
    const maxFontSizePx = largeScrambleTextEnabled ? (defaultFontSizePx * 2) : defaultFontSizePx;
    let low = minFontSizePx;
    let high = maxFontSizePx;
    let bestFontSizePx = minFontSizePx;

    for (let iteration = 0; iteration < 14; iteration += 1) {
        const mid = (low + high) / 2;
        setDesktopLargeScrambleFontSize(mid, scrambleText, scrambleInput);

        if (doesDesktopLargeScrambleTextFit(scrambleText, timerDisplay, timerDisplayWrapper)) {
            bestFontSizePx = mid;
            low = mid;
        } else {
            high = mid;
        }
    }

    const resolvedFontSizePx = Math.max(minFontSizePx, Math.min(maxFontSizePx, Math.floor(bestFontSizePx * 100) / 100));
    if (Math.abs(resolvedFontSizePx - defaultFontSizePx) <= 0.05) {
        clearDesktopLargeScrambleTextFit(scrambleText, scrambleInput);
        return;
    }

    setDesktopLargeScrambleFontSize(resolvedFontSizePx, scrambleText, scrambleInput);
}

function syncLandscapeMobileScrambleSingleLineFit() {
    const scrambleText = getEl('scramble-text');
    const scrambleTextWrapper = getEl('scramble-text-wrapper');
    const appLayout = getEl('app-layout');
    if (!scrambleText || !scrambleTextWrapper) return;

    const isStructuredMegaminx = scrambleText.dataset.scrambleLayout === 'megaminx-rows'
        && scrambleText.style.display !== 'none';
    const isMobileTimerView = mobileViewportQuery.matches && document.body.dataset.mobilePanel === 'timer';

    if (shouldApplyFrozenMobileScrambleLayout() && applyFrozenMobileScrambleTextLayout()) {
        return;
    }

    scrambleText.style.fontSize = '';
    scrambleText.style.removeProperty('max-width');
    scrambleText.style.removeProperty('white-space');

    const shouldForceLandscapeSingleLine = mobileLandscapeQuery.matches
        && mobileViewportQuery.matches
        && !isStructuredMegaminx
        && scrambleText.style.display !== 'none';

    if (shouldForceLandscapeSingleLine) {
        let appLayoutContentWidth = 0;
        if (appLayout) {
            const appLayoutStyles = getComputedStyle(appLayout);
            const paddingLeft = parseFloat(appLayoutStyles.paddingLeft) || 0;
            const paddingRight = parseFloat(appLayoutStyles.paddingRight) || 0;
            appLayoutContentWidth = Math.max(0, appLayout.clientWidth - paddingLeft - paddingRight);
        }

        const widthBasis = appLayoutContentWidth > 0 ? appLayoutContentWidth : window.innerWidth;
        const designatedWidthPx = Math.floor(widthBasis * 0.86);
        const availableWidth = Math.max(0, Math.min(scrambleTextWrapper.clientWidth, designatedWidthPx, widthBasis));
        if (availableWidth > 0) {
            scrambleText.style.maxWidth = `${availableWidth}px`;
            scrambleText.style.whiteSpace = 'nowrap';

            if (scrambleText.scrollWidth > scrambleText.clientWidth + 0.5) {
                const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
                const minFontSizePx = rootFontSize * 0.72;
                let currentFontSizePx = parseFloat(getComputedStyle(scrambleText).fontSize) || rootFontSize;

                while (currentFontSizePx > minFontSizePx && scrambleText.scrollWidth > scrambleText.clientWidth + 0.5) {
                    currentFontSizePx -= 0.25;
                    scrambleText.style.fontSize = `${currentFontSizePx}px`;
                }

                if (scrambleText.scrollWidth > scrambleText.clientWidth + 0.5) {
                    scrambleText.style.whiteSpace = 'normal';
                }
            }
        }
    }

    if (!isMobileTimerView || scrambleText.style.display === 'none') return;

    const { availableHeight } = getMobileScrambleVerticalBounds();
    if (availableHeight <= 0) return;

    const measuredHeightEl = scrambleText;
    const measuredHeight = measuredHeightEl.offsetHeight;
    if (!measuredHeight || measuredHeight <= availableHeight + 0.5) return;

    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const minFontSizePx = Math.max(6, Math.min(window.innerWidth, window.innerHeight) * 0.018);
    let currentFontSizePx = parseFloat(getComputedStyle(scrambleText).fontSize) || rootFontSize;
    const proportionalFontSizePx = currentFontSizePx * (availableHeight / measuredHeight);
    currentFontSizePx = Math.max(minFontSizePx, Math.floor(proportionalFontSizePx * 100) / 100);
    scrambleText.style.fontSize = `${currentFontSizePx}px`;

    while (currentFontSizePx > minFontSizePx && measuredHeightEl.offsetHeight > availableHeight + 0.5) {
        currentFontSizePx -= 0.25;
        scrambleText.style.fontSize = `${currentFontSizePx}px`;
    }
}

function syncViewportLayout() {
    syncViewportLayoutModeState();
    syncDesktopPanelScale();
    syncDesktopScrambleBounds();
    syncLandscapeMobileScrambleSingleLineFit();

    const timerDisplayWrapper = getEl('timer-display-wrapper');
    const timerDisplay = getEl('timer-display');
    const scrambleContainer = getEl('scramble-container');
    const scrambleText = getEl('scramble-text');
    const scrambleTextWrapper = getEl('scramble-text-wrapper');
    const quickActions = getEl('timer-quick-actions');
    const rightPanel = getEl('right-panel');
    const zenButton = getEl('btn-zen');

    if (!timerDisplayWrapper) return;

    const state = timer.getState();
    const isZen = document.body.classList.contains('zen');
    const isSolving = document.body.classList.contains('solving');
    const isMobileTimerView = mobileViewportQuery.matches && document.body.dataset.mobilePanel === 'timer';
    const centerTimerEnabled = settings.get('centerTimer');
    const hideUIWhileSolving = settings.get('hideUIWhileSolving');
    const effectiveCenterTimer = mobileViewportQuery.matches ? centerTimerEnabled : (centerTimerEnabled && hideUIWhileSolving);
    const shouldApplyMobileTimerPositioning = isMobileTimerView && (centerTimerEnabled || isZen);
    const shouldFocusTimer = state === 'running' || state === 'ready' || isInspectionState(state);
    const shouldViewportCenterTimer = shouldFocusTimer && (effectiveCenterTimer || (isMobileTimerView && isZen));
    const shouldPositionIdleMobileTimer = shouldApplyMobileTimerPositioning && !shouldFocusTimer;
    const shouldPositionMobileScramble = isMobileTimerView
        && !isSolving
        && scrambleContainer
        && scrambleTextWrapper
        && zenButton;
    const shouldFreezeMobileManualEntryLayout = isMobileTimerView && quickActionsState.manualEntryActive;

    let targetTimerCenterY = null;
    let targetTimerCenterX = null;
    let targetTimerRect = null;
    let targetScrambleCenterY = null;

    if (shouldFreezeMobileManualEntryLayout) return;

    if (shouldViewportCenterTimer) {
        if (isMobileTimerView) targetTimerCenterX = window.innerWidth / 2;
        targetTimerCenterY = window.innerHeight / 2;
    } else if (isMobileTimerView && !shouldFocusTimer) {
        const rightRect = rightPanel?.getBoundingClientRect();
        const zenRect = zenButton?.getBoundingClientRect();
        const scrambleRect = getLayoutRect(scrambleText || scrambleTextWrapper);
        const timerRect = getLayoutRect(timerDisplay || timerDisplayWrapper);
        const quickActionsRect = quickActions && !quickActions.hidden
            ? getLayoutRect(quickActions)
            : null;
        const duetRect = combineLayoutRects(timerRect, quickActionsRect);
        const zenCenterY = zenRect ? zenRect.top + zenRect.height / 2 : 0;
        const freeBottom = rightRect?.top ?? window.innerHeight;
        const preservedScrambleCenterY = scrambleRect
            ? ((3 * zenCenterY) + (freeBottom - 12)) / 4
            : zenCenterY;
        if (isZen) {
            if (mobileLandscapeQuery.matches) {
                targetScrambleCenterY = preservedScrambleCenterY;
            }
            if (shouldPositionIdleMobileTimer) {
                targetTimerCenterX = window.innerWidth / 2;
                targetTimerCenterY = window.innerHeight / 2;
            }
        } else {
            targetScrambleCenterY = preservedScrambleCenterY;
            if (shouldPositionIdleMobileTimer) {
                const scrambleBottom = scrambleRect
                    ? preservedScrambleCenterY + (scrambleRect.height / 2)
                    : zenCenterY;
                targetTimerCenterY = (scrambleBottom + freeBottom) / 2;
                targetTimerRect = duetRect || timerRect;
            }
        }
    }

    if (targetTimerCenterY != null) {
        if (isMobileTimerView && shortMobileLandscapeQuery.matches && (state === 'idle' || state === 'stopped' || state === 'holding')) {
            targetTimerCenterY += 30;
        }
        const targetRect = targetTimerRect || getLayoutRect(timerDisplay || timerDisplayWrapper);
        const timerCenterX = targetRect.left + targetRect.width / 2;
        const timerCenterY = targetRect.top + targetRect.height / 2;
        const offsetX = targetTimerCenterX != null && targetRect.width < window.innerWidth - 24
            ? targetTimerCenterX - timerCenterX
            : 0;
        const offsetY = targetTimerCenterY - timerCenterY;
        applyCachedTransform(
            timerDisplayWrapper,
            'timerTransform',
            `translate(${Math.round(offsetX * 10) / 10}px, ${Math.round(offsetY * 10) / 10}px)`,
        );
    } else {
        applyCachedTransform(timerDisplayWrapper, 'timerTransform', '');
    }

    syncDesktopLargeScrambleTextFit();

    if (shouldApplyFrozenMobileScrambleLayout()) {
        applyCachedTransform(scrambleContainer, 'scrambleTransform', mobileScrambleFreezeState.transform);
        return;
    }

    if (!shouldPositionMobileScramble || (targetScrambleCenterY == null && targetTimerCenterY == null)) {
        if (!isSolving) applyCachedTransform(scrambleContainer, 'scrambleTransform', '');
        if (isMobileTimerView && !mobileScrambleFreezeState.locked && (state === 'idle' || state === 'stopped')) {
            captureMobileScrambleLayoutSnapshot();
        }
        return;
    }

    const zenRect = zenButton.getBoundingClientRect();
    const scrambleRect = getLayoutRect(scrambleTextWrapper);
    const resolvedScrambleCenterY = targetScrambleCenterY ?? (((zenRect.top + zenRect.height / 2) + targetTimerCenterY) / 2);
    let scrambleOffsetY = resolvedScrambleCenterY - (scrambleRect.top + scrambleRect.height / 2);
    if (isMobileTimerView) {
        const { topLimit, bottomLimit } = getMobileScrambleVerticalBounds();
        const scrambleCollisionRect = getMobileScrambleTextLayoutRect() || scrambleRect;
        const minOffsetY = topLimit - scrambleRect.top;
        const maxOffsetY = bottomLimit - scrambleCollisionRect.bottom;
        scrambleOffsetY = maxOffsetY < minOffsetY
            ? minOffsetY
            : Math.min(Math.max(scrambleOffsetY, minOffsetY), maxOffsetY);
    }
    applyCachedTransform(
        scrambleContainer,
        'scrambleTransform',
        `translateY(${Math.round(scrambleOffsetY * 10) / 10}px)`,
    );

    if (isMobileTimerView && !mobileScrambleFreezeState.locked && (state === 'idle' || state === 'stopped')) {
        captureMobileScrambleLayoutSnapshot();
    }
}

function setActiveMobilePanel(panel) {
    if (!mobilePanelIds.has(panel)) return;
    const previousPanel = document.body.dataset.mobilePanel;

    if (panel !== 'timer' && quickActionsState.manualEntryActive) {
        closeManualTimeEntry({ restoreQuickActions: false });
    }

    document.body.dataset.mobilePanel = panel;
    document.querySelectorAll('.mobile-panel-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mobilePanel === panel);
    });
    hideMobileScrambleActions();
    closeDailyStreakMobilePopup();
    syncQuickActionsUI();
    syncInspectionCancelControl();

    if (mobileViewportQuery.matches) {
        if (panel === 'timer') ensurePanelExpanded('cube-panel');
        if (panel === 'trend') ensurePanelExpanded('graph-panel');
    }

    if (mobileViewportQuery.matches && panel === 'timer' && previousPanel && previousPanel !== 'timer') {
        syncTimerTabLayoutWithoutAnimation();
        return;
    }

    scheduleViewportLayoutSync();
}

function syncMobilePanelState() {
    const isMobileViewport = mobileViewportQuery.matches;
    const isCoarsePointer = coarsePointerQuery.matches;
    hideShortcutTooltip();
    document.body.classList.toggle('coarse-pointer', isCoarsePointer);
    document.body.classList.toggle('mobile-viewport', isMobileViewport);
    syncManualTimeInputMode();

    if (!isMobileViewport) {
        if (quickActionsState.manualEntryActive) {
            closeManualTimeEntry({ restoreQuickActions: false });
        }
        delete document.body.dataset.mobilePanel;
        document.querySelectorAll('.mobile-panel-tab').forEach((btn) => btn.classList.remove('active'));
        hideMobileScrambleActions();
        closeDailyStreakMobilePopup();
        syncQuickActionsUI();
        syncInspectionCancelControl();
        syncPersistentManualEntryMode();
        return;
    }

    const activePanel = mobilePanelIds.has(document.body.dataset.mobilePanel)
        ? document.body.dataset.mobilePanel
        : 'timer';
    setActiveMobilePanel(activePanel);
    syncInspectionCancelControl();

    if (!isCoarsePointer && quickActionsState.manualEntryActive && settings.get('timeEntryMode') !== 'typing') {
        closeManualTimeEntry({ restoreQuickActions: false });
        return;
    }

    if (isCoarsePointer && settings.get('timeEntryMode') === 'typing' && quickActionsState.manualEntryActive) {
        closeManualTimeEntry({ restoreQuickActions: false });
    }
}

function isScramblePreviewModalOpen() {
    return Boolean(scramblePreviewOverlayEl?.classList.contains('active'));
}

function getScramblePreviewOrientation(type = getCurrentScrambleType()) {
    return YELLOW_TOP_PREVIEW_TYPES.has(type) ? 'yellow-top' : 'standard';
}

function getScramblePreviewSize(type = getCurrentScrambleType()) {
    return STANDARD_CUBE_PREVIEW_SIZES.get(type) || 3;
}

function supportsCubePreview(type = getCurrentScrambleType()) {
    return CUBE_PREVIEW_SCRAMBLE_TYPES.has(type);
}

function supportsMegaminxPreview(type = getCurrentScrambleType()) {
    return MEGAMINX_PREVIEW_SCRAMBLE_TYPES.has(type);
}

function supportsPyraminxPreview(type = getCurrentScrambleType()) {
    return PYRAMINX_PREVIEW_SCRAMBLE_TYPES.has(type);
}

function supportsSkewbPreview(type = getCurrentScrambleType()) {
    return SKEWB_PREVIEW_SCRAMBLE_TYPES.has(type);
}

function supportsSquare1Preview(type = getCurrentScrambleType()) {
    return SQUARE1_PREVIEW_SCRAMBLE_TYPES.has(type);
}

function supportsClockPreview(type = getCurrentScrambleType()) {
    return CLOCK_PREVIEW_SCRAMBLE_TYPES.has(type);
}

function supportsScramblePreview(type = getCurrentScrambleType()) {
    return SCRAMBLE_PREVIEW_TYPES.has(type);
}

function getScramblePreviewModalCanvasContainer() {
    const container = getEl('scramble-preview-modal-canvas-container');
    return container instanceof HTMLElement ? container : null;
}

function getScramblePreviewModalBox() {
    const box = scramblePreviewOverlayEl?.querySelector('.scramble-preview-modal-box');
    return box instanceof HTMLElement ? box : null;
}

function syncScramblePreviewModalSize() {
    const box = getScramblePreviewModalBox();
    const container = getScramblePreviewModalCanvasContainer();
    const body = box?.querySelector('.scramble-preview-modal-body');
    if (!box || !container || !(body instanceof HTMLElement)) return;

    box.style.removeProperty('width');
    container.style.removeProperty('width');

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const maxBoxHeight = viewportHeight * 0.95;
    const preferredBoxWidth = box.getBoundingClientRect().width;
    const boxStyles = window.getComputedStyle(box);
    const bodyStyles = window.getComputedStyle(body);
    const horizontalInsets = (parseFloat(bodyStyles.paddingLeft) || 0)
        + (parseFloat(bodyStyles.paddingRight) || 0)
        + (parseFloat(boxStyles.borderLeftWidth) || 0)
        + (parseFloat(boxStyles.borderRightWidth) || 0);
    const verticalInsets = (parseFloat(bodyStyles.paddingTop) || 0)
        + (parseFloat(bodyStyles.paddingBottom) || 0)
        + (parseFloat(boxStyles.borderTopWidth) || 0)
        + (parseFloat(boxStyles.borderBottomWidth) || 0);
    const aspectRatio = parseFloat(
        window.getComputedStyle(container).getPropertyValue('--scramble-preview-modal-aspect-ratio'),
    );

    if (
        !Number.isFinite(preferredBoxWidth)
        || preferredBoxWidth <= 0
        || !Number.isFinite(maxBoxHeight)
        || maxBoxHeight <= 0
        || !Number.isFinite(aspectRatio)
        || aspectRatio <= 0
    ) {
        return;
    }

    const preferredContentWidth = Math.max(0, preferredBoxWidth - horizontalInsets);
    const preferredBoxHeight = (preferredContentWidth / aspectRatio) + verticalInsets;

    if (preferredBoxHeight > maxBoxHeight) {
        const resolvedContentHeight = Math.max(0, maxBoxHeight - verticalInsets);
        const resolvedBoxWidth = (resolvedContentHeight * aspectRatio) + horizontalInsets;
        box.style.width = `${resolvedBoxWidth}px`;
    }
}

function scheduleScramblePreviewModalSizeSync() {
    if (scramblePreviewModalSizeFrame) return;

    scramblePreviewModalSizeFrame = window.requestAnimationFrame(() => {
        scramblePreviewModalSizeFrame = 0;
        syncScramblePreviewModalSize();
    });
}

function syncScramblePreviewCanvasLayout(type = getCurrentScrambleType()) {
    const useMegaminxLayout = supportsMegaminxPreview(type);
    const usePyraminxLayout = supportsPyraminxPreview(type);
    const useSkewbLayout = supportsSkewbPreview(type);
    const useSquare1Layout = supportsSquare1Preview(type);
    const useClockLayout = supportsClockPreview(type);

    const panelCanvasContainer = getEl('cube-canvas-container');
    panelCanvasContainer?.classList.toggle('megaminx-preview-layout', useMegaminxLayout);
    panelCanvasContainer?.classList.toggle('pyraminx-preview-layout', usePyraminxLayout);
    panelCanvasContainer?.classList.toggle('skewb-preview-layout', useSkewbLayout);
    panelCanvasContainer?.classList.toggle('square1-preview-layout', useSquare1Layout);
    panelCanvasContainer?.classList.toggle('clock-preview-layout', useClockLayout);

    const modalCanvasContainer = getScramblePreviewModalCanvasContainer();
    modalCanvasContainer?.classList.toggle('megaminx-preview-layout', useMegaminxLayout);
    modalCanvasContainer?.classList.toggle('pyraminx-preview-layout', usePyraminxLayout);
    modalCanvasContainer?.classList.toggle('skewb-preview-layout', useSkewbLayout);
    modalCanvasContainer?.classList.toggle('square1-preview-layout', useSquare1Layout);
    modalCanvasContainer?.classList.toggle('clock-preview-layout', useClockLayout);

    const promptCanvasContainer = getEl('prompt-scramble-preview-container');
    promptCanvasContainer?.classList.toggle('megaminx-preview-layout', useMegaminxLayout);
    promptCanvasContainer?.classList.toggle('pyraminx-preview-layout', usePyraminxLayout);
    promptCanvasContainer?.classList.toggle('skewb-preview-layout', useSkewbLayout);
    promptCanvasContainer?.classList.toggle('square1-preview-layout', useSquare1Layout);

    scheduleScramblePreviewModalSizeSync();
}

function mapScrambleForPreview(scramble, type = getCurrentScrambleType()) {
    const normalizedScramble = String(scramble ?? '').trim().replace(/\s+/g, ' ');
    if (!normalizedScramble) return normalizedScramble;
    if (!supportsCubePreview(type)) return normalizedScramble;
    if (!YELLOW_TOP_PREVIEW_TYPES.has(type)) return normalizedScramble;

    return normalizedScramble
        .split(' ')
        .map((token) => {
            const mappedFace = yellowTopPreviewFaceMap[token[0]];
            if (!mappedFace) return token;
            return mappedFace + token.slice(1);
        })
        .join(' ');
}

function getScramblePreviewButtonCanvas() {
    const canvas = getEl('btn-scramble-preview')?.querySelector('.scramble-preview-face-icon');
    return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function prepareScramblePreviewButtonCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) return null;

    const pixelRatio = window.devicePixelRatio || 1;
    const styles = window.getComputedStyle(canvas);
    const cssWidth = Math.max(parseFloat(styles.width) || canvas.clientWidth || 18, 1);
    const cssHeight = Math.max(parseFloat(styles.height) || canvas.clientHeight || cssWidth, 1);
    const pixelWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    return {
        ctx,
        width: cssWidth,
        height: cssHeight,
    };
}

function traceCanvasPolygon(ctx, points) {
    if (!Array.isArray(points) || points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index][0], points[index][1]);
    }

    ctx.closePath();
}

function drawScramblePreviewButtonSticker(ctx, x, y, size, color) {
    const radius = Math.max(0.35, size * SCRAMBLE_PREVIEW_BUTTON_STICKER_RADIUS_RATIO);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + size, y, x + size, y + size, radius);
    ctx.arcTo(x + size, y + size, x, y + size, radius);
    ctx.arcTo(x, y + size, x, y, radius);
    ctx.arcTo(x, y, x + size, y, radius);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = SCRAMBLE_PREVIEW_BUTTON_OUTLINE;
    ctx.lineWidth = Math.max(0.35, Math.min(0.75, size * 0.08));
    ctx.stroke();
}

function drawCubePreviewButtonFace(face, faceSize) {
    const canvas = getScramblePreviewButtonCanvas();
    const prepared = prepareScramblePreviewButtonCanvas(canvas);
    if (!prepared) return;

    const { ctx, width, height } = prepared;
    const resolvedFaceSize = Math.max(2, Math.round(faceSize) || SCRAMBLE_PREVIEW_BUTTON_PLACEHOLDER_SIZE);
    const padding = Math.max(0.6, Math.min(width, height) * 0.04);
    const gridSize = Math.max(0, Math.min(width, height) - (padding * 2));
    const cellSize = gridSize / resolvedFaceSize;
    const stickerGap = Math.min(0.9, Math.max(0.12, cellSize * SCRAMBLE_PREVIEW_BUTTON_STICKER_GAP_RATIO));
    const stickerInset = stickerGap / 2;
    const resolvedGridSize = cellSize * resolvedFaceSize;
    const offsetX = (width - resolvedGridSize) / 2;
    const offsetY = (height - resolvedGridSize) / 2;

    for (let row = 0; row < resolvedFaceSize; row += 1) {
        for (let col = 0; col < resolvedFaceSize; col += 1) {
            const faceIndex = face[(row * resolvedFaceSize) + col];
            const x = offsetX + (col * cellSize) + stickerInset;
            const y = offsetY + (row * cellSize) + stickerInset;
            const size = Math.max(0.4, cellSize - stickerGap);
            drawScramblePreviewButtonSticker(
                ctx,
                x,
                y,
                size,
                cubeFaceColors[faceIndex] || cubeFaceColors[0],
            );
        }
    }
}

function drawSkewbPreviewButtonFace(face) {
    const canvas = getScramblePreviewButtonCanvas();
    const prepared = prepareScramblePreviewButtonCanvas(canvas);
    if (!prepared) return;

    const { ctx, width, height } = prepared;
    const padding = Math.max(0.6, Math.min(width, height) * 0.04);
    const gridSize = Math.max(0, Math.min(width, height) - (padding * 2));
    const cellSize = gridSize / 2;
    const stickerGap = Math.min(0.9, Math.max(0.12, cellSize * SCRAMBLE_PREVIEW_BUTTON_STICKER_GAP_RATIO));
    const offsetX = (width - gridSize) / 2;
    const offsetY = (height - gridSize) / 2;

    const S = gridSize;

    const tl = [offsetX, offsetY];
    const tr = [offsetX + S, offsetY];
    const br = [offsetX + S, offsetY + S];
    const bl = [offsetX, offsetY + S];
    const midTop = [offsetX + S / 2, offsetY];
    const midRight = [offsetX + S, offsetY + S / 2];
    const midBottom = [offsetX + S / 2, offsetY + S];
    const midLeft = [offsetX, offsetY + S / 2];

    const polygons = [
        [midTop, midRight, midBottom, midLeft], // 0: Center
        [tl, midTop, midLeft],                  // 1: Top-Left
        [tr, midRight, midTop],                 // 2: Top-Right
        [br, midBottom, midRight],              // 3: Bottom-Right
        [bl, midLeft, midBottom],               // 4: Bottom-Left
    ];

    const outlineWidth = Math.max(0.35, Math.min(0.75, cellSize * 0.08));

    polygons.forEach((points, index) => {
        const centroid = average2DPoints(points);
        const maxDist = Math.max(...points.map(p => Math.hypot(p[0] - centroid[0], p[1] - centroid[1])));
        const scale = maxDist > 0 ? Math.max(0, 1 - ((stickerGap / 2) / maxDist)) : 1;

        const insetPoints = points.map(p => [
            centroid[0] + (p[0] - centroid[0]) * scale,
            centroid[1] + (p[1] - centroid[1]) * scale
        ]);

        ctx.fillStyle = cubeFaceColors[face[index]] || cubeFaceColors[0];

        ctx.beginPath();
        ctx.moveTo(insetPoints[0][0], insetPoints[0][1]);
        for (let i = 1; i < insetPoints.length; i++) {
            ctx.lineTo(insetPoints[i][0], insetPoints[i][1]);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = SCRAMBLE_PREVIEW_BUTTON_OUTLINE;
        ctx.lineWidth = outlineWidth;
        ctx.stroke();
    });
}

function average2DPoints(points) {
    if (!Array.isArray(points) || points.length === 0) return [0, 0];

    const sums = points.reduce(
        (acc, [x, y]) => [acc[0] + x, acc[1] + y],
        [0, 0],
    );

    return [sums[0] / points.length, sums[1] / points.length];
}

function rotatePoint2D(point, center, angle) {
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return [
        center[0] + (dx * cos) - (dy * sin),
        center[1] + (dx * sin) + (dy * cos),
    ];
}

function interpolateTrianglePoint2D(a, b, c, u, v, size = PYRAMINX_PREVIEW_BUTTON_FACE_SIZE) {
    const uRatio = u / size;
    const vRatio = v / size;

    return [
        a[0] + ((b[0] - a[0]) * uRatio) + ((c[0] - a[0]) * vRatio),
        a[1] + ((b[1] - a[1]) * uRatio) + ((c[1] - a[1]) * vRatio),
    ];
}

function createPreviewPyraminxTriangleDefinitions(size = PYRAMINX_PREVIEW_BUTTON_FACE_SIZE) {
    const referenceA = [0, 0];
    const referenceB = [1, 0];
    const referenceC = [0.5, PYRAMINX_PREVIEW_BUTTON_TRIANGLE_HEIGHT_RATIO];
    const definitions = [];

    const pushTriangle = (gridPoints) => {
        const centroid = average2DPoints(
            gridPoints.map(([u, v]) => interpolateTrianglePoint2D(referenceA, referenceB, referenceC, u, v, size)),
        );
        definitions.push({ gridPoints, centroid });
    };

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size - row; col += 1) {
            pushTriangle([
                [row, col],
                [row + 1, col],
                [row, col + 1],
            ]);
        }
    }

    for (let row = 0; row < size - 1; row += 1) {
        for (let col = 0; col < size - 1 - row; col += 1) {
            pushTriangle([
                [row + 1, col],
                [row + 1, col + 1],
                [row, col + 1],
            ]);
        }
    }

    return definitions
        .sort((a, b) => {
            const verticalDelta = a.centroid[1] - b.centroid[1];
            if (Math.abs(verticalDelta) > 1e-9) return verticalDelta;
            return a.centroid[0] - b.centroid[0];
        })
        .map(({ gridPoints }) => gridPoints);
}

function distanceBetweenPoints(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function insetTriangle(points, insetDistance) {
    const centroid = average2DPoints(points);
    const sideLength = distanceBetweenPoints(points[0], points[1]);
    const inradius = (sideLength * Math.sqrt(3)) / 6;
    const scale = inradius > 0 ? Math.max(0, 1 - (insetDistance / inradius)) : 1;

    return points.map((point) => [
        centroid[0] + ((point[0] - centroid[0]) * scale),
        centroid[1] + ((point[1] - centroid[1]) * scale),
    ]);
}

function drawPyraminxPreviewButtonFace(face) {
    const canvas = getScramblePreviewButtonCanvas();
    const prepared = prepareScramblePreviewButtonCanvas(canvas);
    if (!prepared) return;

    const { ctx, width, height } = prepared;
    const padding = Math.max(0.75, Math.min(width, height) * 0.05);
    const maxTriangleHeight = (height / 2 - padding) / 0.59;
    const sideLength = Math.max(
        0,
        Math.min(
            width - (padding * 2),
            maxTriangleHeight / PYRAMINX_PREVIEW_BUTTON_TRIANGLE_HEIGHT_RATIO,
        ),
    );
    const triangleHeight = sideLength * PYRAMINX_PREVIEW_BUTTON_TRIANGLE_HEIGHT_RATIO;
    const originX = (width - sideLength) / 2;
    const originY = (height / 2) - (triangleHeight * 0.59);
    const a = [originX, originY + triangleHeight];
    const b = [originX + sideLength, originY + triangleHeight];
    const c = [originX + (sideLength / 2), originY];
    const stickerInset = Math.min(0.5, Math.max(0.14, sideLength * 0.018)) * 0.5;
    const outlineWidth = Math.max(0.32, Math.min(0.65, sideLength * 0.03));
    const triangleCenter = average2DPoints([a, b, c]);

    PYRAMINX_PREVIEW_BUTTON_TRIANGLE_DEFINITIONS.forEach((triangle, index) => {
        const stickerPoints = insetTriangle(
            triangle.map(([u, v]) => interpolateTrianglePoint2D(a, b, c, u, v)),
            stickerInset,
        ).map((point) => rotatePoint2D(point, triangleCenter, PYRAMINX_PREVIEW_BUTTON_ROTATION_RAD));

        ctx.fillStyle = pyraminxFaceColors[face[index]] || pyraminxFaceColors[0];
        traceCanvasPolygon(ctx, stickerPoints);
        ctx.fill();

        ctx.strokeStyle = SCRAMBLE_PREVIEW_BUTTON_OUTLINE;
        ctx.lineWidth = outlineWidth;
        ctx.stroke();
    });
}

function drawMegaminxPreviewButtonFace(face) {
    const canvas = getScramblePreviewButtonCanvas();
    const prepared = prepareScramblePreviewButtonCanvas(canvas);
    if (!prepared || !(canvas instanceof HTMLCanvasElement)) return;

    drawMegaminxFacePreview(canvas, face);
}

function drawPlaceholderPreviewButtonFace() {
    drawCubePreviewButtonFace(
        new Array(SCRAMBLE_PREVIEW_BUTTON_PLACEHOLDER_SIZE ** 2).fill(0),
        SCRAMBLE_PREVIEW_BUTTON_PLACEHOLDER_SIZE,
    );
}

function updateScramblePreviewButtonFace(scramble, type = getCurrentScrambleType()) {
    _updateScramblePreviewButtonFace(scramble, type);
    requestAnimationFrame(updateFaviconFromScramblePreviewButton);
}

function updateFaviconFromScramblePreviewButton() {
    const canvas = getScramblePreviewButtonCanvas();
    if (!canvas) return;
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
        favicon.href = canvas.toDataURL('image/png');
    }
}

function _updateScramblePreviewButtonFace(scramble, type) {
    if (!supportsScramblePreview(type)) {
        drawPlaceholderPreviewButtonFace();
        return;
    }

    if (supportsMegaminxPreview(type)) {
        const megaminx = applyMegaminxScramble(scramble);
        const previewFace = megaminx?.[0];
        if (!Array.isArray(previewFace) || previewFace.length !== 11) {
            drawPlaceholderPreviewButtonFace();
            return;
        }

        drawMegaminxPreviewButtonFace(previewFace);
        return;
    }

    if (supportsPyraminxPreview(type)) {
        const pyraminx = applyPyraminxScramble(scramble);
        const previewFace = pyraminx?.[PYRAMINX_PREVIEW_BUTTON_FACE_INDEX];
        if (!Array.isArray(previewFace) || previewFace.length !== (PYRAMINX_PREVIEW_BUTTON_FACE_SIZE ** 2)) {
            drawPlaceholderPreviewButtonFace();
            return;
        }

        drawPyraminxPreviewButtonFace(previewFace);
        return;
    }

    if (supportsSkewbPreview(type)) {
        const skewb = applySkewbScramble(scramble);
        const upFace = skewb?.[0];
        if (!Array.isArray(upFace) || upFace.length !== 5) {
            drawPlaceholderPreviewButtonFace();
            return;
        }

        drawSkewbPreviewButtonFace(upFace);
        return;
    }

    if (supportsSquare1Preview(type)) {
        const canvas = getScramblePreviewButtonCanvas();
        if (!(canvas instanceof HTMLCanvasElement)) return;
        if (!prepareScramblePreviewButtonCanvas(canvas)) return;

        drawSquare1(
            canvas,
            applySquare1Scramble(scramble),
            { topOnly: true },
        );
        return;
    }

    if (supportsClockPreview(type)) {
        const canvas = getScramblePreviewButtonCanvas();
        if (!(canvas instanceof HTMLCanvasElement)) return;
        if (!prepareScramblePreviewButtonCanvas(canvas)) return;

        drawClock(
            canvas,
            applyClockScramble(scramble),
            { previewOnly: true },
        );
        return;
    }

    const previewScramble = mapScrambleForPreview(scramble, type);
    const cube = applyScramble(
        previewScramble,
        getScramblePreviewOrientation(type),
        getScramblePreviewSize(type),
    );
    const upFace = cube?.[0];
    if (!Array.isArray(upFace) || upFace.length === 0) {
        drawPlaceholderPreviewButtonFace();
        return;
    }

    const faceSize = Math.max(2, Math.round(Math.sqrt(upFace.length)));
    drawCubePreviewButtonFace(upFace, faceSize);
}

function renderScramblePreviewDisplays(scramble, type = getCurrentScrambleType()) {
    const normalizedScramble = String(scramble ?? '');
    const mainCanvas = getEl('cube-canvas');
    const promptCanvas = getEl('prompt-scramble-canvas');
    syncScramblePreviewCanvasLayout(type);

    if (!supportsScramblePreview(type)) {
        if (mainCanvas) clearCubeDisplay(mainCanvas);
        if (scramblePreviewModalCanvas) clearCubeDisplay(scramblePreviewModalCanvas);
        if (promptCanvas && promptCanvas.offsetParent !== null) clearCubeDisplay(promptCanvas);
        updateScramblePreviewButtonFace(normalizedScramble, type);
        return;
    }

    if (supportsMegaminxPreview(type)) {
        if (mainCanvas) updateMegaminxDisplay(mainCanvas, normalizedScramble);
        if (scramblePreviewModalCanvas) updateMegaminxDisplay(scramblePreviewModalCanvas, normalizedScramble);
        if (promptCanvas && promptCanvas.offsetParent !== null) updateMegaminxDisplay(promptCanvas, normalizedScramble);
        updateScramblePreviewButtonFace(normalizedScramble, type);
        return;
    }

    if (supportsPyraminxPreview(type)) {
        if (mainCanvas) updatePyraminxDisplay(mainCanvas, normalizedScramble);
        if (scramblePreviewModalCanvas) updatePyraminxDisplay(scramblePreviewModalCanvas, normalizedScramble);
        if (promptCanvas && promptCanvas.offsetParent !== null) updatePyraminxDisplay(promptCanvas, normalizedScramble);
        updateScramblePreviewButtonFace(normalizedScramble, type);
        return;
    }

    if (supportsSkewbPreview(type)) {
        if (mainCanvas) updateSkewbDisplay(mainCanvas, normalizedScramble);
        if (scramblePreviewModalCanvas) updateSkewbDisplay(scramblePreviewModalCanvas, normalizedScramble);
        if (promptCanvas && promptCanvas.offsetParent !== null) updateSkewbDisplay(promptCanvas, normalizedScramble);
        updateScramblePreviewButtonFace(normalizedScramble, type);
        return;
    }

    if (supportsSquare1Preview(type)) {
        if (mainCanvas) updateSquare1Display(mainCanvas, normalizedScramble);
        if (scramblePreviewModalCanvas) updateSquare1Display(scramblePreviewModalCanvas, normalizedScramble);
        if (promptCanvas && promptCanvas.offsetParent !== null) updateSquare1Display(promptCanvas, normalizedScramble);
        updateScramblePreviewButtonFace(normalizedScramble, type);
        return;
    }

    if (supportsClockPreview(type)) {
        if (mainCanvas) updateClockDisplay(mainCanvas, normalizedScramble);
        if (scramblePreviewModalCanvas) updateClockDisplay(scramblePreviewModalCanvas, normalizedScramble);
        if (promptCanvas && promptCanvas.offsetParent !== null) updateClockDisplay(promptCanvas, normalizedScramble);
        updateScramblePreviewButtonFace(normalizedScramble, type);
        return;
    }

    const previewScramble = mapScrambleForPreview(normalizedScramble, type);
    const orientation = getScramblePreviewOrientation(type);
    const previewSize = getScramblePreviewSize(type);
    if (mainCanvas) updateCubeDisplay(mainCanvas, previewScramble, orientation, previewSize);
    if (scramblePreviewModalCanvas) updateCubeDisplay(scramblePreviewModalCanvas, previewScramble, orientation, previewSize);
    if (promptCanvas && promptCanvas.offsetParent !== null) updateCubeDisplay(promptCanvas, previewScramble, orientation, previewSize);
    updateScramblePreviewButtonFace(normalizedScramble, type);
}

function scheduleScramblePreviewThemeRefresh() {
    if (scramblePreviewThemeRefreshTimeout) {
        window.clearTimeout(scramblePreviewThemeRefreshTimeout);
    }

    scramblePreviewThemeRefreshTimeout = window.setTimeout(() => {
        scramblePreviewThemeRefreshTimeout = 0;
        renderScramblePreviewDisplays(currentScramble, getCurrentScrambleType());
    }, 24);
}

function openScramblePreviewModal() {
    if (!scramblePreviewOverlayEl || isScramblePreviewModalOpen()) return;
    pushHistoryState();
    scramblePreviewOverlayEl.classList.add('active');
    blurManualTimeInput();
    scheduleScramblePreviewModalSizeSync();
    renderScramblePreviewDisplays(currentScramble);
}

function closeScramblePreviewModal({ isPopState = false } = {}) {
    if (!scramblePreviewOverlayEl || !isScramblePreviewModalOpen()) return;
    if (!isPopState) backToDismiss();
    scramblePreviewOverlayEl.classList.remove('active');
}

function initScramblePreviewModal() {
    scramblePreviewOverlayEl = getEl('scramble-preview-overlay');
    scramblePreviewModalCanvas = getEl('scramble-preview-modal-canvas');

    if (!scramblePreviewOverlayEl || !scramblePreviewModalCanvas) return;

    initCubeDisplay(scramblePreviewModalCanvas);

    const openBtn = getEl('btn-scramble-preview');
    const panelPreviewTrigger = getEl('cube-canvas-container');
    const closeBtn = getEl('scramble-preview-close');

    openBtn?.addEventListener('click', () => {
        openScramblePreviewModal();
        openBtn.blur();
    });

    panelPreviewTrigger?.addEventListener('click', () => {
        openScramblePreviewModal();
    });

    closeBtn?.addEventListener('click', () => {
        closeScramblePreviewModal();
    });

    let _scramblePreviewMouseDownTarget = null;
    let _scramblePreviewMouseUpTarget = null;
    scramblePreviewOverlayEl.addEventListener('mousedown', (event) => {
        _scramblePreviewMouseDownTarget = event.target;
    });
    scramblePreviewOverlayEl.addEventListener('mouseup', (event) => {
        _scramblePreviewMouseUpTarget = event.target;
    });
    scramblePreviewOverlayEl.addEventListener('click', (event) => {
        if (_scramblePreviewMouseDownTarget === scramblePreviewOverlayEl && _scramblePreviewMouseUpTarget === scramblePreviewOverlayEl) closeScramblePreviewModal();
        _scramblePreviewMouseDownTarget = null;
        _scramblePreviewMouseUpTarget = null;
    });

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return;
        if (!isScramblePreviewModalOpen()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeScramblePreviewModal();
    });

    const syncPreviewButtonFace = () => {
        scheduleScramblePreviewModalSizeSync();
        window.requestAnimationFrame(() => {
            updateScramblePreviewButtonFace(currentScramble, getCurrentScrambleType());
        });
    };

    window.addEventListener('resize', syncPreviewButtonFace);
    window.addEventListener('orientationchange', syncPreviewButtonFace);
    window.visualViewport?.addEventListener('resize', syncPreviewButtonFace);
    syncPreviewButtonFace();
}

// ──── Bootstrap ────
async function init() {
    initInspectionSpeechUnlockState();
    void registerServiceWorker();
    const sessionInitPromise = sessionManager.init();
    initCubeDisplay(document.getElementById('cube-canvas'));
    initScramblePreviewModal();
    populateScrambleTypeMenus();
    void preloadScrambleEngines();
    await sessionInitPromise;
    await dailyStreakStore.init();
    await syncScrambleTypeWithActiveSession();
    const shouldLoadInitialScramble = !syncInitialScrambleUI();
    initModal();
    initTimeDistributionModal();
    setModalStatNavigator(openShortcutStatDetail);
    initShortcutTooltips();
    syncModalStatNavigation();
    timer.init(
        document.getElementById('timer-display'),
        [
            document.getElementById('timer-display'),
            document.getElementById('center-panel'),
            document.getElementById('scramble-bar'),
        ],
    );
    initGraph(document.getElementById('graph-canvas'));
    syncScrambleTypeMenus();

    // Wire events
    timer.on('stopped', onSolveComplete);
    timer.on('started', onTimerStarted);
    timer.on('started', closeDailyStreakMobilePopup);
    timer.on('stateChange', onTimerStateChange);
    timer.on('inspectionAlert', onInspectionAlert);
    timer.on('typingInspectionDone', () => {
        if (isDesktopTypingEntryModeEnabled()) {
            syncPersistentManualEntryMode();
        }
    });

    sessionManager.on('solveAdded', (solve) => {
        dailyStreakStore.upsertSolve(solve);
        refreshSessionList();
        if (!_skipSolveAddedRefresh) refreshUI();
    });
    sessionManager.on('solveUpdated', (solve) => {
        dailyStreakStore.upsertSolve(solve);
        rebuildStatsCache();
        refreshUI();
    });
    sessionManager.on('solveDeleted', (solveIdOrIds) => {
        dailyStreakStore.deleteSolve(solveIdOrIds);
        if (window._isBulkAction) return;
        refreshSessionList();
        rebuildStatsCache();
        refreshUI();
    });
    sessionManager.on('solveMoved', ({ solve } = {}) => {
        dailyStreakStore.upsertSolve(solve);
        if (window._isBulkAction) return;
        refreshSessionList();
        rebuildStatsCache();
        refreshUI();
    });
    sessionManager.on('sessionChanged', onSessionChanged);
    sessionManager.on('sessionDeleted', ({ solveIds } = {}) => {
        if (Array.isArray(solveIds) && solveIds.length > 0) {
            dailyStreakStore.deleteSolve(solveIds);
        }
        refreshSessionList();
        rebuildStatsCache();
        refreshUI();
    });

    settings.on('change', (key) => {
        if (key === 'inspectionAlerts') clearInspectionAlert();
        if (key === 'inspectionAlerts' || key === 'inspectionTime') {
            syncInspectionSpeechUnlockPromptVisibility();
        }
        if (key === 'newBestPopupEnabled' && !settings.get('newBestPopupEnabled')) clearNewBestAlert();
        if (key === 'statsFilter' || key === 'customFilterDuration' || key === 'showDelta' || key === 'deltaReference' || key === 'theme' || key === 'customThemes' || key.startsWith('graphColor') || key.startsWith('graphLine') || key === 'graphTooltipDateEnabled' || key === 'newBestColor' || key === 'summaryStatsList' || key.startsWith('solvesTableStat') || key === 'dailyStreakGoal') {
            if (key === 'statsFilter' || key === 'customFilterDuration') rebuildStatsCache();
            if (key === 'summaryStatsList') {
                syncModalStatNavigation();
                renderKeyboardShortcuts();
            }
            if (key.startsWith('graphLine')) {
                syncGraphLineLabels();
            }
            refreshUI();
        }
        if (key === 'timeEntryMode') {
            clearPenaltyShortcutAlert();
            syncPersistentManualEntryMode();
        }
        if (key === 'centerTimer' || key === 'displayFont' || key === 'pillSize' || key === 'largeScrambleText') {
            scheduleViewportLayoutSync();
            if (key === 'pillSize') syncDesktopTimerInfoPills();
        }
    });

    // Init UI
    initCustomSelectMenus();
    refreshSessionList();
    rebuildStatsCache();
    refreshUI();
    initSettingsPanel();
    initInspectionSpeechUnlockPrompt();
    initInspectionCancelControl();
    initShortcutsOverlay();
    initSessionControls();
    initFilterControls();
    initSearchMenu();
    initCollapsiblePanels();
    initZenMode();
    initScrambleControls();
    initDailyStreakMobileControl();
    initTimerInfoControls();
    initTableSorting();
    initGraphLineToggles();
    initGraphDistributionButton();
    initMobilePanels();
    initTimerQuickActions();
    syncPersistentManualEntryMode();
    initKeyboardShortcuts();
    initTimerClick();
    window.addEventListener('resize', scheduleViewportLayoutSync);
    window.addEventListener('resize', syncMobileSummaryDisplays);
    window.addEventListener('resize', syncDesktopTimerInfoPills);
    window.addEventListener('resize', () => renderSolvesTable());
    window.addEventListener('orientationchange', scheduleViewportLayoutSync);
    window.addEventListener('orientationchange', syncMobileSummaryDisplays);
    window.addEventListener('orientationchange', syncDesktopTimerInfoPills);
    window.addEventListener('online', startCubingWarmupIfNeeded);
    scheduleViewportLayoutSync();
    window.requestAnimationFrame(() => {
        void maybeShowDailyStreakIntro();
    });

    if (shouldLoadInitialScramble) {
        const startInitialScrambleLoad = () => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    void loadNewScramble().finally(() => {
                        startCubingWarmupIfNeeded();
                    });
                });
            });
        };

        if (getSelectedScrambleType() === '333') {
            startInitialScrambleLoad();
        } else {
            window.setTimeout(startInitialScrambleLoad, INITIAL_NON_333_STARTUP_SCRAMBLE_DELAY_MS);
        }
    } else {
        window.requestAnimationFrame(() => {
            startCubingWarmupIfNeeded();
        });
    }

    graphEvents.on('nodeClick', (payload) => {
        const interaction = typeof payload === 'number' ? { idx: payload } : payload;
        const solves = sessionManager.getFilteredSolves();
        const stats = statsCache.getStats();
        let idx = interaction?.idx;
        if (interaction?.solveId) {
            const resolvedIndex = solves.findIndex((solve) => solve.id === interaction.solveId);
            if (resolvedIndex >= 0) {
                idx = resolvedIndex;
            }
        }
        if (idx >= 0 && idx < solves.length) {
            if (interaction?.source === 'touch') {
                armModalGhostClickGuard({
                    x: interaction.clientX,
                    y: interaction.clientY,
                });
            }
            const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
            showSolveDetail(solves[idx], idx, isBest);
        }
    });
}

function initMobilePanels() {
    document.querySelectorAll('.mobile-panel-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            setActiveMobilePanel(btn.dataset.mobilePanel);
        });
    });

    document.querySelectorAll('#mobile-summary-card [data-mobile-summary-action]').forEach((cell) => {
        cell.addEventListener('click', () => {
            if (!mobileViewportQuery.matches) return;

            const action = cell.dataset.mobileSummaryAction;
            if (action === 'stats') {
                setActiveMobilePanel('stats');
                return;
            }

            const solves = sessionManager.getFilteredSolves();
            if (solves.length === 0) return;

            const stats = statsCache.getStats();
            openStatDetailAtIndex(action, solves, stats, solves.length - 1);
        });
    });

    const handleViewportChange = () => syncMobilePanelState();
    if (typeof mobileViewportQuery.addEventListener === 'function') {
        mobileViewportQuery.addEventListener('change', handleViewportChange);
    } else {
        mobileViewportQuery.addListener(handleViewportChange);
    }

    if (typeof coarsePointerQuery.addEventListener === 'function') {
        coarsePointerQuery.addEventListener('change', handleViewportChange);
    } else {
        coarsePointerQuery.addListener(handleViewportChange);
    }

    syncMobilePanelState();
}

// ──── Graph Line Toggles ────
function syncGraphLineLabels() {
    const lineDefs = getGraphLineDefinitions();
    lineDefs.forEach(({ id, statType }) => {
        const legendLabelEl = document.getElementById(`graph-legend-${id}-label`);
        if (legendLabelEl) legendLabelEl.textContent = statType;

        const toggleBtn = document.getElementById(`graph-line-toggle-${id}`);
        if (!toggleBtn) return;
        toggleBtn.dataset.mobileLabel = statType.toUpperCase();
        toggleBtn.title = `Toggle ${statType} line`;
    });
}

function initGraphLineToggles() {
    const vis = getLineVisibility();
    document.querySelectorAll('.graph-line-toggle').forEach(btn => {
        const line = btn.dataset.line;
        // Restore persisted state
        if (!vis[line]) btn.classList.remove('active');

        btn.addEventListener('click', () => {
            const isActive = btn.classList.toggle('active');
            setLineVisibility(line, isActive);
        });
    });

    syncGraphLineLabels();
}

function initGraphDistributionButton() {
    const button = document.getElementById('btn-graph-distribution');
    if (!button) return;

    button.addEventListener('click', () => {
        showTimeDistributionModal(getSearchScopedSolves(), {
            sessionName: sessionManager.getActiveSession()?.name || 'Session',
        });
    });
}

// ──── Timer Info Click ────
function initTimerInfoControls() {
    const ao5Box = document.getElementById('info-ao5-box');
    const ao12Box = document.getElementById('info-ao12-box');

    ao5Box.addEventListener('click', () => {
        const solves = sessionManager.getFilteredSolves();
        if (solves.length === 0) return;
        const stats = statsCache.getStats();
        openStatDetailAtIndex('ao5', solves, stats, solves.length - 1);
    });

    ao12Box.addEventListener('click', () => {
        const solves = sessionManager.getFilteredSolves();
        if (solves.length === 0) return;
        const stats = statsCache.getStats();
        openStatDetailAtIndex('ao12', solves, stats, solves.length - 1);
    });
}

// ──── Timer Click ────
function initTimerClick() {
    const timerDisplay = document.getElementById('timer-display');
    if (!timerDisplay) return;

    timerDisplay.addEventListener('click', () => {
        if (mobileViewportQuery.matches) return;
        if (settings.get('backgroundSpacebarEnabled')) return;
        const state = timer.getState();
        // Open modal when timer is not actively solving.
        if (state === 'idle' || state === 'stopped') {
            const solves = sessionManager.getFilteredSolves();
            if (solves.length > 0) {
                // Open the most recent solve (at the end of the array)
                const idx = solves.length - 1;
                const stats = statsCache.getStats();
                const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
                showSolveDetail(solves[idx], idx, isBest);
            }
        }
    });
}

function initTimerQuickActions() {
    const centerPanel = getEl('center-panel');
    const manualEntryEl = getEl('manual-time-entry');
    const hiddenInput = getEl('manual-time-hidden-input');
    const submitBtn = getEl('manual-time-submit');
    const plus2Btn = getEl('timer-action-plus2');
    const dnfBtn = getEl('timer-action-dnf');
    const deleteBtn = getEl('timer-action-delete');
    const commentBtn = getEl('timer-action-comment');
    const addBtn = getEl('timer-action-add');

    if (!centerPanel || !manualEntryEl || !hiddenInput) return;

    plus2Btn?.addEventListener('click', () => {
        const lastSolve = getLastSessionSolve();
        if (!lastSolve) return;
        sessionManager.togglePenalty(lastSolve.id, '+2');
        updateQuickActionButtons();
    });

    dnfBtn?.addEventListener('click', () => {
        const lastSolve = getLastSessionSolve();
        if (!lastSolve) return;
        sessionManager.togglePenalty(lastSolve.id, 'DNF');
        updateQuickActionButtons();
    });

    deleteBtn?.addEventListener('click', async () => {
        const lastSolve = getLastSessionSolve();
        if (!lastSolve) return;
        const confirmed = await customConfirm('Are you sure you want to delete the last solve?');
        if (!confirmed) return;
        sessionManager.deleteSolve(lastSolve.id);
        updateQuickActionButtons();
    });

    commentBtn?.addEventListener('click', () => {
        promptForSolveComment(getLastSessionSolve());
    });

    addBtn?.addEventListener('click', () => {
        openManualTimeEntry({ focusStrategy: 'immediate' });
    });

    manualEntryEl.addEventListener('click', (event) => {
        if (!quickActionsState.manualEntryActive) return;
        if (isSettingsPanelBlocking() || hasBlockingOverlayOpen()) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        focusManualTimeInput();
    });

    hiddenInput.addEventListener('focus', () => {
        syncManualTimeInputFocusState();
    });

    hiddenInput.addEventListener('blur', () => {
        syncManualTimeInputFocusState();
    });

    hiddenInput.addEventListener('input', (event) => {
        quickActionsState.manualDigits = sanitizeManualDigits(event.target.value);
        updateManualTimeEntryUI();
    });

    hiddenInput.addEventListener('keydown', (event) => {
        if (event.key === '.' || event.key === ',') {
            event.preventDefault();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            submitManualTimeEntry({ closeEntry: false });
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            if (isDesktopTypingEntryModeEnabled()) {
                hiddenInput.blur();
                return;
            }
            closeManualTimeEntry({
                restoreQuickActions: isMobileTimerPanelActive(),
                pinned: quickActionsState.restorePinnedAfterManual,
            });
        }
    });

    submitBtn?.addEventListener('click', () => {
        submitManualTimeEntry({ closeEntry: true });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isDesktopTypingEntryModeEnabled()) return;
        if (!isManualTimeEntryActive() || !isManualTimeInputFocused()) return;
        if (!(event.target instanceof Node)) return;
        if (manualEntryEl.contains(event.target)) return;
        hiddenInput.blur();
    });

    const isQuickActionsSwipeIgnoredTarget = (target) => target instanceof Element
        && Boolean(target.closest('.scramble-type-menu, .custom-select-menu'));

    const handleQuickActionsSwipeStart = (event) => {
        if (!isMobileTimerPanelActive()) return;
        if (hasBlockingOverlayOpen() || isSettingsPanelBlocking()) return;
        if (quickActionsState.manualEntryActive) return;
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        if (isQuickActionsSwipeIgnoredTarget(event.target)) return;
        if (event.target instanceof Element && event.target.closest('input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="url"], input[type="tel"], textarea, [contenteditable="true"]')) return;
        if (!quickActionsState.visible && !settings.get('swipeDownGestureEnabled')) return;

        quickActionsState.swipeVisibilityOverride = false;

        const swipeStartTimerState = timer.getState();
        if (!quickActionsState.visible && !isQuickActionsSwipeOpenState(swipeStartTimerState)) return;

        quickActionsState.swipePointerId = event.pointerId;
        quickActionsState.swipeStartTimerState = swipeStartTimerState;
        quickActionsState.swipeStartTime = performance.now();
        quickActionsState.swipeStartX = event.clientX;
        quickActionsState.swipeStartY = event.clientY;
        quickActionsState.swipeHandled = false;
    };

    document.addEventListener('pointerdown', handleQuickActionsSwipeStart, { capture: true });

    document.addEventListener('pointermove', (event) => {
        if (!isMobileTimerPanelActive()) return;
        if (quickActionsState.swipePointerId !== event.pointerId) return;
        if (quickActionsState.swipeHandled) return;

        const deltaX = event.clientX - quickActionsState.swipeStartX;
        const deltaY = event.clientY - quickActionsState.swipeStartY;

        if (performance.now() - quickActionsState.swipeStartTime > 300) return;

        const canOpenQuickActions = isQuickActionsSwipeOpenState(quickActionsState.swipeStartTimerState);

        if (Math.abs(deltaY) < 18 || Math.abs(deltaY) < Math.abs(deltaX) + 6) return;

        if (deltaY > 0) {
            if (!canOpenQuickActions) return;
            quickActionsState.swipeHandled = true;
            quickActionsState.swipeVisibilityOverride = true;
            timer.cancelPendingStart();
            setQuickActionsVisible(true, { pinned: true });
            return;
        }

        if (deltaY < 0 && quickActionsState.visible) {
            quickActionsState.swipeHandled = true;
            timer.cancelPendingStart();
            setQuickActionsVisible(false);
        }
    }, { capture: true });

    const resetSwipeState = (event) => {
        if (event && quickActionsState.swipePointerId !== event.pointerId) return;
        quickActionsState.swipePointerId = null;
        quickActionsState.swipeStartTimerState = null;
        quickActionsState.swipeHandled = false;
    };

    document.addEventListener('pointerup', resetSwipeState, { capture: true });
    document.addEventListener('pointercancel', resetSwipeState, { capture: true });

    document.addEventListener('pointerdown', (event) => {
        if (!quickActionsState.manualEntryActive) return;
        if (isDesktopTypingEntryModeEnabled()) return;
        if (manualEntryEl.contains(event.target)) return;

        closeManualTimeEntry({
            restoreQuickActions: isMobileTimerPanelActive(),
            pinned: quickActionsState.restorePinnedAfterManual || quickActionsState.pinned,
        });
    });

    updateManualTimeEntryUI();
    syncQuickActionsUI();
}

// ──── Collapsible Panels ────
function initCollapsiblePanels() {
    document.querySelectorAll('.panel.collapsible').forEach(panel => {
        const header = panel.querySelector('.panel-header');
        const body = panel.querySelector('.collapsible-body');
        if (!body || !header) return;

        // Load persisted state
        let isCollapsed = false;
        if (panel.id === 'cube-panel') {
            isCollapsed = settings.get('cubeCollapsed');
        } else if (panel.id === 'graph-panel') {
            isCollapsed = settings.get('graphCollapsed');
        } else {
            isCollapsed = panel.classList.contains('collapsed');
        }

        if (panel.id === 'graph-panel' && mobileViewportQuery.matches) {
            isCollapsed = false;
        }

        if (isCollapsed) panel.classList.add('collapsed');
        else panel.classList.remove('collapsed');

        // Set initial state
        if (isCollapsed) {
            body.style.maxHeight = '0px';
        } else {
            body.style.maxHeight = 'none';
        }

        // After expand transition completes, remove max-height constraint
        body.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'max-height' && !panel.classList.contains('collapsed')) {
                body.style.maxHeight = 'none';
            }
        });

        header.addEventListener('click', () => {
            if (panel.id === 'graph-panel' && mobileViewportQuery.matches) return;

            if (panel.classList.contains('collapsed')) {
                // EXPAND: 0 → scrollHeight → (transitionend) → none
                panel.classList.remove('collapsed');
                // Start from 0
                body.style.maxHeight = '0px';
                // Force reflow so browser sees the 0
                body.offsetHeight;
                // Now animate to full height
                body.style.maxHeight = body.scrollHeight + 'px';

                if (panel.id === 'cube-panel') settings.set('cubeCollapsed', false);
                if (panel.id === 'graph-panel') settings.set('graphCollapsed', false);
            } else {
                // COLLAPSE: none → scrollHeight → 0
                // First set to explicit value (can't transition from 'none')
                body.style.maxHeight = body.scrollHeight + 'px';
                // Force reflow
                body.offsetHeight;
                // Now collapse
                panel.classList.add('collapsed');
                body.style.maxHeight = '0px';

                if (panel.id === 'cube-panel') settings.set('cubeCollapsed', true);
                if (panel.id === 'graph-panel') {
                    settings.set('graphCollapsed', true);
                    const toggleBtn = document.getElementById('btn-graph-tools');
                    const drawer = document.getElementById('graph-tools-drawer');
                    if (toggleBtn && drawer && !drawer.classList.contains('collapsed')) {
                        toggleBtn.click();
                    }
                }
            }
        });
    });
}

// ──── Zen Mode ────
function syncZenButtonState() {
    const btn = getEl('btn-zen');
    if (!btn) return;

    const isZen = document.body.classList.contains('zen');
    btn.textContent = isZen ? '✕' : '✦';
    btn.removeAttribute('title');
    btn.setAttribute('aria-label', isZen ? 'Exit zen mode' : 'Zen mode (hide panels)');
    btn.classList.toggle('is-active', isZen);
}

function setZenMode(isZen) {
    const nextZen = Boolean(isZen);
    const didChange = document.body.classList.contains('zen') !== nextZen;
    document.body.classList.toggle('zen', nextZen);
    if (nextZen) {
        closeDailyStreakMobilePopup();
    }
    settings.set('zenMode', nextZen);
    syncZenButtonState();
    if (didChange) {
        resetMobileScrambleLayoutFreeze({ clearSnapshot: true });
        if (typeof timer.refreshDisplayRules === 'function') {
            timer.refreshDisplayRules();
        }
    }
    scheduleViewportLayoutSync();
}

function toggleZenMode() {
    setZenMode(!document.body.classList.contains('zen'));
}

function initZenMode() {
    const btn = getEl('btn-zen');
    document.body.classList.toggle('zen', Boolean(settings.get('zenMode')));
    syncZenButtonState();
    scheduleViewportLayoutSync();

    btn?.addEventListener('click', () => {
        toggleZenMode();
        btn.blur();
    });
}

// ──── Scramble ────
const SCRAMBLE_SUBSET_PARENT_BY_TYPE = new Map([
    ['ll', '333'],
    ['cmll', '333'],
    ['pll', '333'],
    ['zbll', '333'],
    ['lsll', '333'],
    ['222cll', '222'],
    ['222eg1', '222'],
    ['222eg2', '222'],
    ['pyrl4e', 'pyram'],
]);
const SCRAMBLE_SUBSET_OPTIONS_BY_PUZZLE = Object.freeze({
    333: Object.freeze([
        Object.freeze({ id: 'll', menuLabel: 'OLL' }),
        Object.freeze({ id: 'pll', menuLabel: 'PLL' }),
        Object.freeze({ id: 'zbll', menuLabel: 'ZBLL' }),
        Object.freeze({ id: 'lsll', menuLabel: 'LSLL' }),
        Object.freeze({ id: 'cmll', menuLabel: 'CMLL' }),
    ]),
    222: Object.freeze([
        Object.freeze({ id: '222cll', menuLabel: 'CLL' }),
        Object.freeze({ id: '222eg1', menuLabel: 'EG1' }),
        Object.freeze({ id: '222eg2', menuLabel: 'EG2' }),
    ]),
    pyram: Object.freeze([
        Object.freeze({ id: 'pyrl4e', menuLabel: 'L4E' }),
    ]),
});
const SCRAMBLE_PUZZLE_OPTIONS = Object.freeze(
    SCRAMBLE_TYPE_OPTIONS.filter((option) => !SCRAMBLE_SUBSET_PARENT_BY_TYPE.has(option.id)),
);
const EMPTY_SCRAMBLE_SUBSET_OPTIONS = Object.freeze([]);

function getScrambleTypeMeta(type = getSelectedScrambleType()) {
    return SCRAMBLE_TYPE_OPTIONS.find((option) => option.id === type) || SCRAMBLE_TYPE_OPTIONS[0];
}

function getScramblePuzzleId(type = getSelectedScrambleType()) {
    const activeType = getScrambleTypeMeta(type).id;
    return SCRAMBLE_SUBSET_PARENT_BY_TYPE.get(activeType) || activeType;
}

function getScramblePuzzleMeta(type = getSelectedScrambleType()) {
    const puzzleId = getScramblePuzzleId(type);
    return SCRAMBLE_PUZZLE_OPTIONS.find((option) => option.id === puzzleId) || SCRAMBLE_PUZZLE_OPTIONS[0];
}

function getScrambleSubsetOptions(puzzleId) {
    return SCRAMBLE_SUBSET_OPTIONS_BY_PUZZLE[puzzleId] || EMPTY_SCRAMBLE_SUBSET_OPTIONS;
}

function puzzleHasScrambleSubsets(puzzleId) {
    return getScrambleSubsetOptions(puzzleId).length > 0;
}

function getScrambleTypeButtonLabel(type = getSelectedScrambleType()) {
    return getScrambleTypeMeta(type).buttonLabel;
}

function getScrambleTypeButtonDescription(type = getSelectedScrambleType()) {
    return getScrambleTypeMeta(type).menuLabel;
}

function ensureDropdownScrollContainer(dropdownEl, className) {
    if (!(dropdownEl instanceof HTMLElement)) return null;

    let scrollEl = Array.from(dropdownEl.children).find((child) => child.classList.contains(className));

    if (!(scrollEl instanceof HTMLElement)) {
        scrollEl = document.createElement('div');
        scrollEl.className = className;
        scrollEl.append(...Array.from(dropdownEl.childNodes));
        dropdownEl.replaceChildren(scrollEl);
    }

    return scrollEl;
}

function ensureScrambleTypeDropdownPanels(dropdownEl) {
    if (!(dropdownEl instanceof HTMLElement)) return null;

    let mainPanel = Array.from(dropdownEl.children)
        .find((child) => child.classList.contains('scramble-type-dropdown-main'));
    let subsetPanel = Array.from(dropdownEl.children)
        .find((child) => child.classList.contains('scramble-type-subset-dropdown'));

    const looseNodes = Array.from(dropdownEl.childNodes).filter((node) =>
        !(node instanceof HTMLElement
            && (node.classList.contains('scramble-type-dropdown-main')
                || node.classList.contains('scramble-type-subset-dropdown'))),
    );

    if (!(mainPanel instanceof HTMLElement)) {
        mainPanel = document.createElement('div');
        mainPanel.className = 'scramble-type-dropdown-panel scramble-type-dropdown-main';
        dropdownEl.prepend(mainPanel);
    }

    if (looseNodes.length > 0) {
        mainPanel.append(...looseNodes);
    }

    if (!(subsetPanel instanceof HTMLElement)) {
        subsetPanel = document.createElement('div');
        subsetPanel.className = 'scramble-type-dropdown-panel scramble-type-subset-dropdown';
        dropdownEl.append(subsetPanel);
    }

    const mainScrollEl = ensureDropdownScrollContainer(mainPanel, 'scramble-type-dropdown-scroll');
    const subsetScrollEl = ensureDropdownScrollContainer(subsetPanel, 'scramble-type-dropdown-scroll');

    if (!(mainScrollEl instanceof HTMLElement) || !(subsetScrollEl instanceof HTMLElement)) {
        return null;
    }

    return {
        mainPanel,
        subsetPanel,
        mainScrollEl,
        subsetScrollEl,
    };
}

function renderScrambleSubsetOptions(menuEl, puzzleId = '') {
    const dropdownEl = menuEl?.querySelector('.scramble-type-dropdown');
    const panels = ensureScrambleTypeDropdownPanels(dropdownEl);
    if (!panels) return null;

    const { subsetPanel, subsetScrollEl } = panels;
    const subsetOptions = getScrambleSubsetOptions(puzzleId);

    subsetPanel.dataset.scramblePuzzle = puzzleId;
    subsetPanel.setAttribute(
        'aria-label',
        puzzleId ? `${getScramblePuzzleMeta(puzzleId).menuLabel} subset options` : 'Scramble subset options',
    );

    if (subsetOptions.length === 0) {
        subsetScrollEl.replaceChildren();
        return panels;
    }

    const fragment = document.createDocumentFragment();

    subsetOptions.forEach((option) => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'scramble-type-option scramble-type-subset-option';
        optionButton.dataset.scrambleType = option.id;
        optionButton.dataset.scramblePuzzle = puzzleId;
        optionButton.setAttribute('role', 'menuitemradio');
        optionButton.setAttribute('aria-checked', 'false');
        optionButton.textContent = option.menuLabel;
        fragment.appendChild(optionButton);
    });

    subsetScrollEl.replaceChildren(fragment);
    return panels;
}

function showScrambleSubsetDropdown(menuEl, puzzleId, { ensureActiveVisible = false } = {}) {
    if (!menuEl) return;

    const subsetOptions = getScrambleSubsetOptions(puzzleId);
    if (subsetOptions.length === 0) {
        hideScrambleSubsetDropdown(menuEl);
        return;
    }

    if (menuEl.classList.contains('subset-open') && menuEl.dataset.subsetPuzzleId === puzzleId) {
        if (!ensureActiveVisible) return;

        const activeOptionEl = menuEl.querySelector('.scramble-type-subset-option.active');
        if (activeOptionEl instanceof HTMLElement) {
            activeOptionEl.scrollIntoView({ block: 'nearest' });
        }
        return;
    }

    renderScrambleSubsetOptions(menuEl, puzzleId);
    menuEl.dataset.subsetPuzzleId = puzzleId;
    menuEl.dataset.subsetAnchorPuzzleId = puzzleId;
    menuEl.classList.add('subset-open');

    syncScrambleTypeMenus();

    if (!ensureActiveVisible) return;

    const activeOptionEl = menuEl.querySelector('.scramble-type-subset-option.active');
    if (activeOptionEl instanceof HTMLElement) {
        activeOptionEl.scrollIntoView({ block: 'nearest' });
    }
}

function hideScrambleSubsetDropdown(menuEl) {
    if (!menuEl) return;
    if (!menuEl.classList.contains('subset-open') && !menuEl.dataset.subsetPuzzleId) return;

    menuEl.classList.remove('subset-open');
    delete menuEl.dataset.subsetPuzzleId;
}

function populateScrambleTypeMenus() {
    document.querySelectorAll('.scramble-type-menu').forEach((menuEl) => {
        const dropdownEl = menuEl.querySelector('.scramble-type-dropdown');
        const panels = ensureScrambleTypeDropdownPanels(dropdownEl);
        if (!panels) return;
        const fragment = document.createDocumentFragment();

        SCRAMBLE_PUZZLE_OPTIONS.forEach((option) => {
            const optionButton = document.createElement('button');
            optionButton.type = 'button';
            optionButton.className = 'scramble-type-option scramble-type-puzzle-option';
            optionButton.dataset.scrambleType = option.id;
            optionButton.dataset.scramblePuzzle = option.id;
            const hasSubsets = puzzleHasScrambleSubsets(option.id);

            optionButton.setAttribute('role', 'menuitemradio');
            optionButton.setAttribute('aria-checked', 'false');
            if (hasSubsets) {
                optionButton.classList.add('has-subsets');
                optionButton.setAttribute('aria-haspopup', 'menu');
            }

            const labelEl = document.createElement('span');
            labelEl.className = 'scramble-type-option-label';
            labelEl.textContent = option.menuLabel;
            optionButton.append(labelEl);

            if (hasSubsets) {
                const indicatorEl = document.createElement('span');
                indicatorEl.className = 'scramble-type-option-indicator';
                indicatorEl.setAttribute('aria-hidden', 'true');
                indicatorEl.textContent = '▸';
                optionButton.append(indicatorEl);
            }

            fragment.appendChild(optionButton);
        });

        panels.mainScrollEl.replaceChildren(fragment);
        renderScrambleSubsetOptions(menuEl, '');
    });
}

function closeScrambleTypeMenus() {
    document.querySelectorAll('.scramble-type-menu').forEach((menuEl) => {
        menuEl.classList.remove('open');
        menuEl.classList.remove('dropdown-up');
        hideScrambleSubsetDropdown(menuEl);
        menuEl.querySelector('.scramble-type-btn')?.setAttribute('aria-expanded', 'false');
        menuEl.querySelector('.scramble-type-dropdown')?.style.removeProperty('--scramble-type-dropdown-max-height');
    });
}

function positionScrambleTypeMenu(menuEl, { ensureActiveVisible = false } = {}) {
    const buttonEl = menuEl?.querySelector('.scramble-type-btn');
    const dropdownEl = menuEl?.querySelector('.scramble-type-dropdown');
    const panels = ensureScrambleTypeDropdownPanels(dropdownEl);

    if (!(buttonEl instanceof HTMLElement) || !(dropdownEl instanceof HTMLElement) || !panels) return;

    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const buttonRect = buttonEl.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(menuEl).getPropertyValue('--scramble-type-dropdown-gap')) || 8;
    const submenuGap = parseFloat(getComputedStyle(menuEl).getPropertyValue('--scramble-type-submenu-gap')) || gap;
    const viewportPadding = 12;
    const preferredMaxHeight = 360;
    const availableAbove = Math.max(0, Math.floor(buttonRect.top - viewportTop - gap - viewportPadding));
    const availableBelow = Math.max(0, Math.floor(viewportBottom - buttonRect.bottom - gap - viewportPadding));
    const shouldOpenUp = availableBelow < preferredMaxHeight && availableAbove > availableBelow;
    const availableSpace = shouldOpenUp ? availableAbove : availableBelow;
    const maxHeight = availableSpace > 0 ? Math.min(preferredMaxHeight, availableSpace) : null;

    menuEl.classList.toggle('dropdown-up', shouldOpenUp && availableAbove > 0);

    if (typeof maxHeight === 'number') {
        dropdownEl.style.setProperty('--scramble-type-dropdown-max-height', `${maxHeight}px`);
    } else {
        dropdownEl.style.removeProperty('--scramble-type-dropdown-max-height');
    }

    const activeOptionEl = panels.mainPanel.querySelector('.scramble-type-puzzle-option.active');
    if (ensureActiveVisible && activeOptionEl instanceof HTMLElement) {
        activeOptionEl.scrollIntoView({ block: 'nearest' });
    }

    if (!menuEl.classList.contains('subset-open')) {
        return;
    }

    const subsetWidth = Math.max(
        panels.subsetPanel.offsetWidth,
        panels.subsetPanel.scrollWidth,
        panels.subsetPanel.getBoundingClientRect().width,
    );
    const dropdownRect = dropdownEl.getBoundingClientRect();
    const mainRect = panels.mainPanel.getBoundingClientRect();
    const availableRight = Math.max(0, Math.floor(viewportRight - mainRect.right - submenuGap - viewportPadding));
    const availableLeft = Math.max(0, Math.floor(mainRect.left - viewportLeft - submenuGap - viewportPadding));
    const shouldOpenLeft = subsetWidth > availableRight && availableLeft > availableRight;
    const anchorPuzzleId = menuEl.dataset.subsetAnchorPuzzleId || menuEl.dataset.subsetPuzzleId || '';
    const anchorOptionEl = anchorPuzzleId
        ? panels.mainPanel.querySelector(`.scramble-type-puzzle-option[data-scramble-puzzle="${anchorPuzzleId}"]`)
        : null;

    if (anchorOptionEl instanceof HTMLElement) {
        const anchorRect = anchorOptionEl.getBoundingClientRect();
        const desiredTop = anchorRect.top - dropdownRect.top;
        const maxTop = Math.max(0, dropdownEl.offsetHeight - panels.subsetPanel.offsetHeight);
        const resolvedTop = Math.max(0, Math.min(desiredTop, maxTop));
        panels.subsetPanel.style.top = `${resolvedTop}px`;
    }

    dropdownEl.classList.toggle('subset-left', shouldOpenLeft && availableLeft > 0);

    const activeSubsetOptionEl = panels.subsetPanel.querySelector('.scramble-type-subset-option.active');
    if (ensureActiveVisible && activeSubsetOptionEl instanceof HTMLElement) {
        activeSubsetOptionEl.scrollIntoView({ block: 'nearest' });
    }
}


function closeCustomSelectMenus() {
    document.querySelectorAll('.custom-select-menu').forEach((menuEl) => {
        menuEl.classList.remove('open');
        menuEl.querySelector('.custom-select-btn')?.setAttribute('aria-expanded', 'false');
    });
    closeMoveSessionMenus();
    syncCustomSelectOverflowState();
}

function syncCustomSelectMenu(selectId) {
    customSelectControllers.get(selectId)?.sync();
}

function syncCustomSelectOverflowState() {
    const hasOpenCustomSelect = Boolean(document.querySelector('.custom-select-menu.open'));
    getEl('left-panel')?.classList.toggle('custom-select-open', hasOpenCustomSelect);
    getEl('stats-panel')?.classList.toggle('custom-select-open', hasOpenCustomSelect);
}

function registerCustomSelectMenu({ selectId, menuId, buttonId, dropdownId, ariaLabel }) {
    const selectEl = getEl(selectId);
    const menuEl = getEl(menuId);
    const buttonEl = getEl(buttonId);
    const dropdownEl = getEl(dropdownId);
    const labelEl = buttonEl?.querySelector('.custom-select-label');

    if (!selectEl || !menuEl || !buttonEl || !dropdownEl || !labelEl) return;

    const sync = () => {
        const options = Array.from(selectEl.options);
        const selectedOption = options.find((option) => option.value === selectEl.value) || options[0] || null;
        const interactiveOptions = options.filter((option) => !option.hidden && !option.disabled);
        const scrollEl = ensureDropdownScrollContainer(dropdownEl, 'custom-select-dropdown-scroll');

        if (!(scrollEl instanceof HTMLElement)) return;

        labelEl.textContent = selectedOption?.textContent || '';
        buttonEl.title = selectedOption?.textContent || '';
        buttonEl.setAttribute('aria-label', selectedOption ? `${ariaLabel}: ${selectedOption.textContent}` : ariaLabel);
        buttonEl.disabled = selectEl.disabled || interactiveOptions.length === 0;

        const fragment = document.createDocumentFragment();
        options.forEach((option) => {
            if (option.hidden) return;
            const optionButton = document.createElement('button');
            optionButton.type = 'button';
            optionButton.className = 'custom-select-option';
            optionButton.dataset.value = option.value;
            optionButton.setAttribute('role', 'option');
            optionButton.disabled = option.disabled;

            const isActive = option.value === selectEl.value;
            optionButton.classList.toggle('active', isActive);
            optionButton.setAttribute('aria-selected', String(isActive));
            optionButton.textContent = option.textContent;
            fragment.appendChild(optionButton);
        });

        scrollEl.replaceChildren(fragment);
    };

    buttonEl.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = !menuEl.classList.contains('open');
        closeScrambleTypeMenus();
        closeCustomSelectMenus();
        if (!shouldOpen || buttonEl.disabled) return;
        menuEl.classList.add('open');
        buttonEl.setAttribute('aria-expanded', 'true');
        syncCustomSelectOverflowState();
    });

    dropdownEl.addEventListener('click', (event) => {
        const optionButton = event.target instanceof Element
            ? event.target.closest('.custom-select-option')
            : null;
        if (!(optionButton instanceof HTMLButtonElement)) return;

        const nextValue = optionButton.dataset.value || '';
        closeCustomSelectMenus();

        if (selectEl.value !== nextValue) {
            selectEl.value = nextValue;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            sync();
        }

        buttonEl.blur();
    });

    selectEl.addEventListener('change', sync);
    customSelectControllers.set(selectId, { sync });
    sync();
}

function initCustomSelectMenus() {
    registerCustomSelectMenu({
        selectId: 'mobile-session-select',
        menuId: 'mobile-session-select-menu',
        buttonId: 'btn-mobile-session-select',
        dropdownId: 'mobile-session-select-dropdown',
        ariaLabel: 'Session',
    });

    registerCustomSelectMenu({
        selectId: 'session-select',
        menuId: 'session-select-menu',
        buttonId: 'btn-session-select',
        dropdownId: 'session-select-dropdown',
        ariaLabel: 'Session',
    });

    registerCustomSelectMenu({
        selectId: 'stats-filter-select',
        menuId: 'stats-filter-menu',
        buttonId: 'btn-stats-filter-select',
        dropdownId: 'stats-filter-dropdown',
        ariaLabel: 'Stats filter',
    });

    registerCustomSelectMenu({
        selectId: 'search-bulk-move-select',
        menuId: 'search-bulk-move-menu',
        buttonId: 'btn-search-bulk-move',
        dropdownId: 'search-bulk-move-dropdown',
        ariaLabel: 'Move selected solves',
    });

    document.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && (event.target.closest('.custom-select-menu') || event.target.closest('.floating-move-session-dropdown'))) return;
        closeCustomSelectMenus();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return;
        closeCustomSelectMenus();
        closeScrambleTypeMenus();
    });
}

function syncScrambleTypeMenus(type = getSelectedScrambleType()) {
    const activeType = getScrambleTypeMeta(type).id;
    const activePuzzleMeta = getScramblePuzzleMeta(activeType);
    const previewButton = getEl('btn-scramble-preview');
    const buttonLabel = getScrambleTypeButtonLabel(activeType);
    const buttonDescription = getScrambleTypeButtonDescription(activeType);

    document.querySelectorAll('.scramble-type-menu').forEach((menuEl) => {
        const visibleSubsetPuzzleId = menuEl.dataset.subsetPuzzleId || '';
        if (visibleSubsetPuzzleId) {
            renderScrambleSubsetOptions(menuEl, visibleSubsetPuzzleId);
        }
    });

    document.querySelectorAll('.scramble-type-btn').forEach((buttonEl) => {
        buttonEl.textContent = buttonLabel;
        buttonEl.setAttribute('aria-label', `Scramble type: ${buttonDescription}`);
    });

    document.querySelectorAll('.scramble-type-puzzle-option').forEach((optionEl) => {
        const isActive = optionEl.dataset.scramblePuzzle === activePuzzleMeta.id;
        optionEl.classList.toggle('active', isActive);
        optionEl.setAttribute('aria-checked', String(isActive));
    });

    document.querySelectorAll('.scramble-type-subset-option').forEach((optionEl) => {
        const isActive = optionEl.dataset.scrambleType === activeType;
        optionEl.classList.toggle('active', isActive);
        optionEl.setAttribute('aria-checked', String(isActive));
    });

    previewButton?.classList.toggle('square1-preview-type', activePuzzleMeta.id === 'sq1');
    previewButton?.classList.toggle('pyraminx-preview-type', activePuzzleMeta.id === 'pyram');
    previewButton?.classList.toggle('clock-preview-type', activePuzzleMeta.id === 'clock');
    previewButton?.classList.toggle('megaminx-preview-type', activePuzzleMeta.id === 'minx');
}

async function reloadScrambleForSelectedType() {
    const textEl = document.getElementById('scramble-text');
    const prevBtn = document.getElementById('btn-prev-scramble');

    currentScramble = '';
    clearStructuredScrambleLayout(textEl);
    if (textEl) {
        textEl.textContent = '';
        textEl.classList.add('loading');
    }
    renderScramblePreviewDisplays('');
    if (prevBtn) prevBtn.disabled = true;
    scheduleViewportLayoutSync();
    await loadNewScramble();
}

async function applyActiveSessionScrambleType(nextType, { loadScramble = true } = {}) {
    if (document.getElementById('scramble-text')?.classList.contains('loading')) return false;

    const activeSessionId = sessionManager.getActiveSessionId();
    if (activeSessionId) {
        await sessionManager.setSessionScrambleType(activeSessionId, nextType);
    }

    const changed = setScrambleType(nextType);
    syncScrambleTypeMenus(nextType);

    if (loadScramble && changed) {
        await reloadScrambleForSelectedType();
    }

    return changed;
}

async function syncScrambleTypeWithActiveSession({ loadScramble = false } = {}) {
    const nextType = sessionManager.getActiveSessionScrambleType();
    const changed = setScrambleType(nextType);
    syncScrambleTypeMenus(nextType);

    if (loadScramble && changed) {
        await reloadScrambleForSelectedType();
    }

    return changed;
}

async function loadNewScramble() {
    const el = document.getElementById('scramble-text');
    let loadingTimer = window.setTimeout(() => {
        clearStructuredScrambleLayout(el);
        el.textContent = 'Generating...';
        el.classList.add('loading');
    }, 120);

    try {
        currentScramble = await getScramble();
        updateScrambleUI(currentScramble);
    } catch (error) {
        console.error('Failed to load scramble:', error);
        clearStructuredScrambleLayout(el);
        el.textContent = 'Scrambler unavailable';
        el.classList.remove('loading');
    } finally {
        window.clearTimeout(loadingTimer);
    }
}

function syncInitialScrambleUI() {
    const initialScramble = getCurrentScramble();
    if (!initialScramble) return false;

    updateScrambleUI(initialScramble);
    return true;
}

function clearStructuredScrambleLayout(el) {
    if (!el) return;
    delete el.dataset.scrambleLayout;
}

function isStandardMegaminxScramble(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length % 11 !== 0) return false;

    for (let index = 0; index < tokens.length; index += 11) {
        const rowTokens = tokens.slice(index, index + 11);
        if (rowTokens.length !== 11) return false;

        const rowMoves = rowTokens.slice(0, 10);
        if (!rowMoves.every((token) => /^[RD](?:\+\+|--)$/i.test(token))) return false;
        if (!/^U'?$/i.test(rowTokens[10])) return false;
    }

    return true;
}

function renderScrambleText(scrambleStr, type = getCurrentScrambleType()) {
    const el = document.getElementById('scramble-text');
    if (!el) return;

    clearStructuredScrambleLayout(el);

    const normalizedScramble = String(scrambleStr ?? '').trim();

    if (!normalizedScramble) {
        const emptyMessages = [
            "Such empty...",
            "Nothing but crickets...",
            "It's quiet in here...",
            "You found 💥Easter Egg💥",
            "Don't quit your day job",
            "Wait. That's illegal.",
            "The Vault Keeper's name is 'Spooky'...",
            "Try Ctrl+/",
            "Ping @zukrainak47 on discord to suggest more quotes to put here"
        ];
        const randomMsg = emptyMessages[Math.floor(Math.random() * emptyMessages.length)];
        el.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">${randomMsg}</span>`;
        return;
    }

    if (type !== 'sq1' && type !== 'minx') {
        el.textContent = scrambleStr;
        return;
    }

    const tokens = normalizedScramble.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        el.textContent = normalizedScramble;
        return;
    }

    if (type === 'minx' && isStandardMegaminxScramble(tokens)) {
        el.dataset.scrambleLayout = 'megaminx-rows';

        const fragment = document.createDocumentFragment();
        const blockEl = document.createElement('span');
        blockEl.className = 'megaminx-scramble-block';

        for (let index = 0; index < tokens.length; index += 11) {
            const rowEl = document.createElement('span');
            rowEl.className = 'megaminx-scramble-row';
            rowEl.textContent = tokens.slice(index, index + 11).join(' ');
            blockEl.append(rowEl);
        }

        fragment.append(blockEl);
        el.replaceChildren(fragment);
        return;
    }

    if (type !== 'sq1') {
        el.textContent = normalizedScramble;
        return;
    }

    const fragment = document.createDocumentFragment();
    const slashSegments = normalizedScramble.split('/');

    slashSegments.forEach((segment, index) => {
        const isLastSegment = index === slashSegments.length - 1;
        const chunkText = isLastSegment ? segment : `${segment}/`;
        if (chunkText) {
            const chunkEl = document.createElement('span');
            chunkEl.className = 'sq1-scramble-chunk';
            chunkEl.textContent = chunkText;
            fragment.append(chunkEl);
        }

        if (!isLastSegment) {
            fragment.append(document.createElement('wbr'));
        }
    });

    el.replaceChildren(fragment);
}

function updateScrambleUI(scrambleStr) {
    resetMobileScrambleLayoutFreeze({ clearSnapshot: true });
    currentScramble = scrambleStr;
    renderScrambleText(currentScramble, getCurrentScrambleType());
    const el = document.getElementById('scramble-text');
    el.classList.remove('loading');
    el.classList.toggle('is-previous-selected', isViewingPreviousScramble());
    renderScramblePreviewDisplays(currentScramble);
    syncScrambleTypeMenus(getCurrentScrambleType());

    // Update nav button states
    document.getElementById('btn-prev-scramble').disabled = !hasPrevScramble();
    scheduleViewportLayoutSync();
}

function copyCurrentScrambleToClipboard() {
    const textEl = getEl('scramble-text');
    if (!textEl || textEl.classList.contains('loading')) return;

    navigator.clipboard.writeText(currentScramble);
    textEl.style.color = '#3fb950';
    if (scrambleCopyTimeout) clearTimeout(scrambleCopyTimeout);
    scrambleCopyTimeout = setTimeout(() => {
        textEl.style.color = '';
        scrambleCopyTimeout = null;
    }, 500);
}

function initScrambleControls() {
    const textEl = document.getElementById('scramble-text');
    const inputEl = document.getElementById('scramble-input');
    const copyBtn = document.getElementById('btn-copy-scramble');
    const editBtn = document.getElementById('btn-edit-scramble');
    const prevBtn = document.getElementById('btn-prev-scramble');
    const nextBtn = document.getElementById('btn-next-scramble');
    const containerEl = document.getElementById('scramble-container');
    const textWrapperEl = document.getElementById('scramble-text-wrapper');
    const scrambleTypeMenus = Array.from(document.querySelectorAll('.scramble-type-menu'));
    const repositionOpenScrambleTypeMenus = () => {
        scrambleTypeMenus
            .filter((menuEl) => menuEl.classList.contains('open'))
            .forEach((menuEl) => positionScrambleTypeMenu(menuEl));
    };

    function setScrambleActionsVisible(visible) {
        if (!mobileViewportQuery.matches) return;
        containerEl.classList.toggle('scramble-actions-visible', visible);
    }

    textWrapperEl?.addEventListener('transitionstart', (event) => {
        if (mobileViewportQuery.matches) return;
        if (event.target !== textWrapperEl) return;
        startDesktopScrambleTransitionSync(event.propertyName);
    });

    textWrapperEl?.addEventListener('transitionend', (event) => {
        if (mobileViewportQuery.matches) return;
        if (event.target !== textWrapperEl) return;
        stopDesktopScrambleTransitionSync(event.propertyName);
    });

    textWrapperEl?.addEventListener('transitioncancel', (event) => {
        if (mobileViewportQuery.matches) return;
        if (event.target !== textWrapperEl) return;
        stopDesktopScrambleTransitionSync(event.propertyName);
    });

    async function handleScrambleTypeSelection(nextType, {
        closeAfterSelect = true,
        keepSubsetOpen = false,
        menuEl = null,
    } = {}) {
        const changed = await applyActiveSessionScrambleType(nextType, { loadScramble: false });
        if (closeAfterSelect) {
            closeScrambleTypeMenus();
        }

        if (!closeAfterSelect && menuEl instanceof HTMLElement) {
            menuEl.classList.add('open');
            menuEl.querySelector('.scramble-type-btn')?.setAttribute('aria-expanded', 'true');

            const puzzleId = getScramblePuzzleId(nextType);
            if (keepSubsetOpen && puzzleHasScrambleSubsets(puzzleId)) {
                showScrambleSubsetDropdown(menuEl, puzzleId, { ensureActiveVisible: true });
            } else {
                hideScrambleSubsetDropdown(menuEl);
            }

            positionScrambleTypeMenu(menuEl, { ensureActiveVisible: true });
        }

        if (!changed) return;

        setScrambleActionsVisible(false);
        await reloadScrambleForSelectedType();

        if (!closeAfterSelect && menuEl instanceof HTMLElement) {
            positionScrambleTypeMenu(menuEl, { ensureActiveVisible: true });
        }
    }

    // 1. Copy
    textEl.addEventListener('click', () => {
        if (textEl.classList.contains('loading')) return;
        closeScrambleTypeMenus();
        if (mobileViewportQuery.matches) {
            clearNewBestAlert();
            containerEl.classList.toggle('scramble-actions-visible');
        } else {
            copyCurrentScrambleToClipboard();
        }
    });

    copyBtn?.addEventListener('click', () => {
        closeScrambleTypeMenus();
        copyCurrentScrambleToClipboard();
        setScrambleActionsVisible(false);
    });

    scrambleTypeMenus.forEach((menuEl) => {
        const buttonEl = menuEl.querySelector('.scramble-type-btn');
        const dropdownEl = menuEl.querySelector('.scramble-type-dropdown');

        buttonEl?.addEventListener('click', (event) => {
            event.stopPropagation();
            if (textEl.classList.contains('loading')) return;
            const shouldOpen = !menuEl.classList.contains('open');
            closeCustomSelectMenus();
            closeScrambleTypeMenus();
            if (!shouldOpen) return;
            menuEl.classList.add('open');
            buttonEl.setAttribute('aria-expanded', 'true');
            const activePuzzleId = getScramblePuzzleId();
            if (puzzleHasScrambleSubsets(activePuzzleId)) {
                showScrambleSubsetDropdown(menuEl, activePuzzleId);
            }
            positionScrambleTypeMenu(menuEl, { ensureActiveVisible: true });
        });

        dropdownEl?.addEventListener('pointerover', (event) => {
            if (coarsePointerQuery.matches || (event instanceof PointerEvent && event.pointerType !== 'mouse')) return;
            if (!menuEl.classList.contains('open')) return;

            const optionEl = event.target instanceof Element
                ? event.target.closest('.scramble-type-puzzle-option')
                : null;
            if (!(optionEl instanceof HTMLButtonElement) || !dropdownEl.contains(optionEl)) return;

            const puzzleId = optionEl.dataset.scramblePuzzle || optionEl.dataset.scrambleType || '333';
            if (puzzleHasScrambleSubsets(puzzleId)) {
                showScrambleSubsetDropdown(menuEl, puzzleId);
                positionScrambleTypeMenu(menuEl);
                return;
            }

            hideScrambleSubsetDropdown(menuEl);
            positionScrambleTypeMenu(menuEl);
        });

        dropdownEl?.addEventListener('focusin', (event) => {
            if (coarsePointerQuery.matches) return;
            if (!menuEl.classList.contains('open')) return;

            const optionEl = event.target instanceof Element
                ? event.target.closest('.scramble-type-puzzle-option')
                : null;
            if (!(optionEl instanceof HTMLButtonElement) || !dropdownEl.contains(optionEl)) return;

            const puzzleId = optionEl.dataset.scramblePuzzle || optionEl.dataset.scrambleType || '333';
            if (!puzzleHasScrambleSubsets(puzzleId)) return;

            showScrambleSubsetDropdown(menuEl, puzzleId, { ensureActiveVisible: true });
            positionScrambleTypeMenu(menuEl, { ensureActiveVisible: true });
        });

        dropdownEl?.addEventListener('click', async (event) => {
            const puzzleOptionEl = event.target instanceof Element
                ? event.target.closest('.scramble-type-puzzle-option')
                : null;
            if (puzzleOptionEl instanceof HTMLButtonElement && dropdownEl.contains(puzzleOptionEl)) {
                const puzzleId = puzzleOptionEl.dataset.scramblePuzzle || puzzleOptionEl.dataset.scrambleType || '333';
                if (puzzleHasScrambleSubsets(puzzleId)) {
                    const shouldCloseAfterSelect = !coarsePointerQuery.matches;
                    await handleScrambleTypeSelection(puzzleOptionEl.dataset.scrambleType || '333', {
                        closeAfterSelect: shouldCloseAfterSelect,
                        keepSubsetOpen: coarsePointerQuery.matches,
                        menuEl,
                    });
                    return;
                }

                await handleScrambleTypeSelection(puzzleOptionEl.dataset.scrambleType || '333');
                return;
            }

            const subsetOptionEl = event.target instanceof Element
                ? event.target.closest('.scramble-type-subset-option')
                : null;
            if (!(subsetOptionEl instanceof HTMLButtonElement) || !dropdownEl.contains(subsetOptionEl)) return;

            await handleScrambleTypeSelection(subsetOptionEl.dataset.scrambleType || '333');
        });
    });

    // 2. Edit
    function startEdit() {
        if (textEl.classList.contains('loading')) return;
        setScrambleActionsVisible(false);
        closeScrambleTypeMenus();

        if (mobileViewportQuery.matches) {
            const previewContainer = getEl('prompt-scramble-preview-container');
            if (previewContainer) previewContainer.style.display = 'flex';

            const promptInput = getEl('prompt-input');
            if (promptInput) promptInput.classList.add('scramble-font');

            // Render initially so it's populated when modal opens
            renderScramblePreviewDisplays(currentScramble);

            customPrompt('', currentScramble, 1000, 'Edit scramble', 'Enter scramble...', (val) => {
                renderScramblePreviewDisplays(val);
            }).then((val) => {
                setTimeout(() => {
                    if (previewContainer) previewContainer.style.display = 'none';
                    if (promptInput) promptInput.classList.remove('scramble-font');
                }, 300);

                if (val === null) {
                    renderScramblePreviewDisplays(currentScramble);
                    return;
                }
                const trimmed = val.trim();
                if (trimmed !== currentScramble) {
                    setCurrentScramble(trimmed);
                    updateScrambleUI(trimmed);
                } else {
                    renderScramblePreviewDisplays(currentScramble);
                }
            });
            return;
        }

        textEl.style.display = 'none';
        inputEl.style.display = 'block';
        inputEl.value = currentScramble;
        inputEl.style.height = 'auto';
        inputEl.style.height = inputEl.scrollHeight + 'px';
        syncDesktopLargeScrambleTextFit();
        inputEl.focus();
        // Pause timer keys optionally, but timer.js ignores input tags.
    }

    function commitEdit() {
        if (inputEl.style.display === 'none') return;

        const val = inputEl.value.trim();
        textEl.style.display = 'block';
        inputEl.style.display = 'none';

        if (val !== currentScramble) {
            setCurrentScramble(val);
            updateScrambleUI(val);
        } else {
            // Restore visualizer if it was changed during input
            renderScramblePreviewDisplays(currentScramble);
        }

        scheduleViewportLayoutSync();
    }

    editBtn.addEventListener('click', startEdit);
    inputEl.addEventListener('blur', commitEdit);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitEdit();
        }
        if (e.key === 'Escape') {
            textEl.style.display = 'block';
            inputEl.style.display = 'none';
            inputEl.blur();
            scheduleViewportLayoutSync();
        }
    });
    inputEl.addEventListener('input', (e) => {
        inputEl.style.height = 'auto';
        inputEl.style.height = inputEl.scrollHeight + 'px';
        renderScramblePreviewDisplays(e.target.value);
    });

    // 3. Navigation
    prevBtn.addEventListener('click', () => {
        if (textEl.classList.contains('loading')) return;
        closeScrambleTypeMenus();
        const s = getPrevScramble();
        if (s) updateScrambleUI(s);
    });

    nextBtn.addEventListener('click', async () => {
        if (textEl.classList.contains('loading')) return;
        closeScrambleTypeMenus();
        let loadingTimer = window.setTimeout(() => {
            clearStructuredScrambleLayout(textEl);
            textEl.textContent = 'Generating...';
            textEl.classList.add('loading');
        }, 120);

        try {
            const s = await getNextScramble();
            updateScrambleUI(s);
        } catch (error) {
            console.error('Failed to load next scramble:', error);
            clearStructuredScrambleLayout(textEl);
            textEl.textContent = 'Scrambler unavailable';
            textEl.classList.remove('loading');
        } finally {
            window.clearTimeout(loadingTimer);
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && event.target.closest('.scramble-type-menu')) return;
        closeScrambleTypeMenus();
        if (!mobileViewportQuery.matches) return;
        if (containerEl.contains(event.target)) return;
        setScrambleActionsVisible(false);
    }, true);

    window.addEventListener('resize', repositionOpenScrambleTypeMenus);
    window.visualViewport?.addEventListener('resize', repositionOpenScrambleTypeMenus);
    window.visualViewport?.addEventListener('scroll', repositionOpenScrambleTypeMenus);

    syncScrambleTypeMenus(getSelectedScrambleType());
}

// ──── Table Sorting ────
function initTableSorting() {
    const table = document.getElementById('solves-table');
    if (!table) return;

    table.addEventListener('click', (event) => {
        const th = event.target instanceof Element ? event.target.closest('th[data-sort]') : null;
        if (!th || !table.contains(th)) return;

        const col = th.dataset.sort;
        if (!col) return;

        if (col === 'search') {
            toggleSearchMenu();
            return;
        } else if (currentSortCol === col) {
            if (currentSortDir === 'asc') {
                currentSortDir = 'desc';
            } else {
                currentSortCol = null;
                currentSortDir = null;
            }
        } else {
            currentSortCol = col;
            currentSortDir = 'asc';
        }

        refreshUI();
    });
}

function hasBlockingOverlayOpen() {
    return blockingOverlayIds.some((id) => {
        if (id === 'theme-customization-overlay' && isThemeCustomizationDocked()) {
            return false;
        }
        return document.getElementById(id)?.classList.contains('active');
    });
}

function isSlashShortcut(event) {
    return event.code === 'Slash' || event.key === '/' || event.key === '?';
}

function formatShortcutTooltip(binding) {
    const tokenMap = {
        Shift: '⇧',
        Backspace: '⌫',
        Delete: '⌫',
        Enter: '⏎',
        ArrowLeft: '←',
        ArrowRight: '→',
        ArrowUp: '↑',
        ArrowDown: '↓',
        Control: 'Ctrl',
        Ctrl: 'Ctrl',
        Meta: 'Ctrl',
        Alt: 'Ctrl',
        Option: 'Ctrl',
        Equal: '+',
        NumpadAdd: '+',
        Minus: '-',
        NumpadSubtract: '-',
    };

    return binding.map(token => tokenMap[token] || token).join('');
}

function isNarrowFinePointerLayout() {
    return mobileViewportQuery.matches && !coarsePointerQuery.matches;
}

function getShortcutTooltipPlacement(target) {
    if (isNarrowFinePointerLayout()) {
        if (target?.id === 'btn-settings') return 'top';
        if (target instanceof Element && target.matches('#modal-stat-nav button[data-stat-type]')) return 'top';
    }

    return target?.dataset.shortcutTooltipPlacement || 'bottom';
}

function positionShortcutTooltip(target) {
    if (!shortcutTooltipEl) return;

    const rect = target.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const placement = getShortcutTooltipPlacement(target);

    if (placement === 'right') {
        shortcutTooltipEl.style.left = `${rect.right + gap}px`;
        shortcutTooltipEl.style.top = `${rect.top + rect.height / 2}px`;

        const tooltipRect = shortcutTooltipEl.getBoundingClientRect();
        const minLeft = margin;
        const maxLeft = window.innerWidth - margin - tooltipRect.width;
        const preferredLeft = rect.right + gap;
        const centeredTop = rect.top + rect.height / 2;
        const minTop = margin + tooltipRect.height / 2;
        const maxTop = window.innerHeight - margin - tooltipRect.height / 2;
        const clampedLeft = Math.min(Math.max(preferredLeft, minLeft), maxLeft);
        const clampedTop = Math.min(Math.max(centeredTop, minTop), maxTop);

        shortcutTooltipEl.style.left = `${clampedLeft}px`;
        shortcutTooltipEl.style.top = `${clampedTop}px`;
        return;
    }

    if (placement === 'top') {
        shortcutTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
        shortcutTooltipEl.style.top = `${rect.top - gap}px`;

        const tooltipRect = shortcutTooltipEl.getBoundingClientRect();
        const minLeft = margin + tooltipRect.width / 2;
        const maxLeft = window.innerWidth - margin - tooltipRect.width / 2;
        const centeredLeft = rect.left + rect.width / 2;
        const clampedLeft = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
        const minTop = margin;
        const preferredTop = rect.top - gap - tooltipRect.height;

        shortcutTooltipEl.style.left = `${clampedLeft}px`;
        shortcutTooltipEl.style.top = `${Math.max(preferredTop, minTop)}px`;
        return;
    }

    shortcutTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
    shortcutTooltipEl.style.top = `${rect.bottom + gap}px`;

    const tooltipRect = shortcutTooltipEl.getBoundingClientRect();
    const minLeft = margin + tooltipRect.width / 2;
    const maxLeft = window.innerWidth - margin - tooltipRect.width / 2;
    const centeredLeft = rect.left + rect.width / 2;
    const clampedLeft = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const maxTop = window.innerHeight - margin - tooltipRect.height;
    const preferredTop = rect.bottom + gap;

    shortcutTooltipEl.style.left = `${clampedLeft}px`;
    shortcutTooltipEl.style.top = `${Math.min(preferredTop, maxTop)}px`;
}

function showShortcutTooltip(target) {
    if (!areShortcutTooltipsAvailable()) return;
    if (!shortcutTooltipEl || !target?.dataset.shortcutTooltip) return;

    const wasActive = shortcutTooltipEl.classList.contains('active');
    shortcutTooltipEl.classList.toggle('shortcut-tooltip-below-pills', target?.id === 'scramble-text');
    shortcutTooltipEl.dataset.placement = getShortcutTooltipPlacement(target);
    shortcutTooltipEl.textContent = target.dataset.shortcutTooltip;

    if (!wasActive) {
        shortcutTooltipEl.classList.add('no-transition');
        positionShortcutTooltip(target);
        shortcutTooltipEl.getBoundingClientRect();
        shortcutTooltipEl.classList.remove('no-transition');
    }

    shortcutTooltipEl.classList.add('active');
    positionShortcutTooltip(target);
}

function hideShortcutTooltip() {
    if (!shortcutTooltipEl) return;
    shortcutTooltipEl.classList.remove('active');
}

function registerShortcutTooltip(element, binding, placement = 'bottom') {
    if (!element) return;

    const shortcut = formatShortcutTooltip(binding);
    if (!shortcut) return;

    if (element.title && !element.getAttribute('aria-label')) {
        element.setAttribute('aria-label', element.title);
    }

    element.dataset.shortcutTooltip = shortcut;
    element.dataset.shortcutTooltipPlacement = placement;
    element.removeAttribute('title');
    element.addEventListener('mouseenter', () => showShortcutTooltip(element));
    element.addEventListener('mouseleave', hideShortcutTooltip);
    element.addEventListener('focus', () => showShortcutTooltip(element));
    element.addEventListener('blur', hideShortcutTooltip);
}

function initShortcutTooltips() {
    shortcutTooltipEl = document.getElementById('shortcut-tooltip');
    if (!shortcutTooltipEl) {
        shortcutTooltipEl = document.createElement('div');
        shortcutTooltipEl.id = 'shortcut-tooltip';
        shortcutTooltipEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(shortcutTooltipEl);
    }

    buttonShortcutTooltipBindings.forEach(({ selector, binding, placement }) => {
        document.querySelectorAll(selector).forEach(element => {
            registerShortcutTooltip(element, binding, placement);
        });
    });

    window.addEventListener('resize', hideShortcutTooltip);
    document.addEventListener('scroll', hideShortcutTooltip, true);
    document.addEventListener('pointerdown', hideShortcutTooltip, true);
}

function normalizeSummaryStatToken(token) {
    return String(token ?? '').trim().toLowerCase();
}

function parseGraphLineStatInput(rawInput) {
    const token = normalizeSummaryStatToken(rawInput);
    const parsed = parseGraphStatType(token);
    if (!parsed) {
        return {
            ok: false,
            token,
            message: token
                ? `Invalid stat: ${token}`
                : `Enter a stat like mean, mo3, or ao12`,
        };
    }

    return {
        ok: true,
        token: parsed.type,
        message: '',
    };
}

function getDeltaReferenceLabel(token) {
    if (token === 'mean') return 'session mean';
    return token;
}

function parseDeltaReferenceInput(rawInput) {
    const token = normalizeSummaryStatToken(rawInput);
    if (!token) {
        return {
            ok: true,
            token: '',
            resolvedToken: 'single',
            label: getDeltaReferenceLabel('single'),
            empty: true,
            message: '',
        };
    }

    if (DELTA_REFERENCE_SINGLE_TOKENS.has(token)) {
        return {
            ok: true,
            token: 'single',
            resolvedToken: 'single',
            label: getDeltaReferenceLabel('single'),
            empty: false,
            message: '',
        };
    }

    const normalizedToken = DELTA_REFERENCE_MEAN_TOKENS.has(token) ? 'mean' : token;
    const parsed = parseGraphStatType(normalizedToken);
    if (!parsed) {
        return {
            ok: false,
            token,
            resolvedToken: null,
            label: '',
            empty: false,
            message: `Invalid target: ${token}`,
        };
    }

    return {
        ok: true,
        token: parsed.type,
        resolvedToken: parsed.type,
        label: getDeltaReferenceLabel(parsed.type),
        empty: false,
        message: '',
    };
}

function getConfiguredDeltaReferenceToken() {
    const parsed = parseDeltaReferenceInput(settings.get('deltaReference'));
    return parsed.ok ? parsed.resolvedToken : 'single';
}

function parseSummaryStatInput(rawInput, { truncate = true } = {}) {
    const source = String(rawInput ?? '');
    const parts = source.split(/[\s,]+/).map(normalizeSummaryStatToken).filter(Boolean);
    const tokens = [];
    const seen = new Set();

    for (const part of parts) {
        const config = parseRollingStatType(part);
        if (!config) {
            return {
                ok: false,
                message: `Invalid token: ${part}`,
                tokens,
                truncated: false,
            };
        }

        if (seen.has(config.type)) continue;
        seen.add(config.type);
        tokens.push(config.type);
    }

    // if (tokens.length === 0) {
    //     return {
    //         ok: false,
    //         message: 'Enter at least one stat token (e.g. mo3 ao12)',
    //         tokens: [],
    //         truncated: false,
    //     };
    // }

    if (tokens.length > MAX_CUSTOM_SUMMARY_STATS && !truncate) {
        return {
            ok: false,
            message: `Maximum ${MAX_CUSTOM_SUMMARY_STATS} summary rows.`,
            tokens: tokens.slice(0, MAX_CUSTOM_SUMMARY_STATS),
            truncated: true,
        };
    }

    return {
        ok: true,
        message: '',
        tokens: truncate ? tokens.slice(0, MAX_CUSTOM_SUMMARY_STATS) : tokens,
        truncated: tokens.length > MAX_CUSTOM_SUMMARY_STATS,
    };
}

function parseSolvesTableStatInput(rawInput) {
    const token = normalizeSummaryStatToken(rawInput);
    if (!token) {
        return {
            ok: true,
            token: '',
            empty: true,
            message: '',
        };
    }

    const config = parseRollingStatType(token);
    if (!config) {
        return {
            ok: false,
            token,
            empty: false,
            message: `Invalid stat: ${token}`,
        };
    }

    return {
        ok: true,
        token: config.type,
        empty: false,
        message: '',
    };
}

function getPresetSummaryTokens(preset) {
    const key = String(preset ?? '').toLowerCase();
    const list = SUMMARY_STAT_PRESETS[key] || SUMMARY_STAT_PRESETS.basic;
    return list.slice(0, MAX_CUSTOM_SUMMARY_STATS);
}

function getConfiguredSummaryStatTokens() {
    const stored = settings.get('summaryStatsList');
    if (Array.isArray(stored) && stored.length) {
        const parsed = parseSummaryStatInput(stored.join(' '));
        if (parsed.ok) return parsed.tokens;
    }

    const preset = settings.get('summaryStatsPreset');
    if (preset && preset !== 'custom') {
        return getPresetSummaryTokens(preset);
    }

    const custom = parseSummaryStatInput(settings.get('summaryStatsCustom'));
    if (custom.ok) return custom.tokens;

    return [...SUMMARY_STAT_PRESETS.basic];
}

function getConfiguredSolvesTableStatTokens() {
    const tokens = [];
    const seen = new Set();

    SOLVES_TABLE_STAT_SETTING_KEYS.forEach((key, index) => {
        const fallback = DEFAULTS[key] || '';
        const rawValue = settings.get(key);
        const parsed = parseSolvesTableStatInput(rawValue == null ? fallback : rawValue);
        if (!parsed.ok || parsed.empty || seen.has(parsed.token)) return;
        seen.add(parsed.token);
        tokens.push({
            type: parsed.token,
            label: parsed.token,
            settingKey: key,
            slot: index,
        });
    });

    return tokens;
}

function getShiftStatShortcutSlots() {
    return getConfiguredSummaryStatTokens()
        .slice(0, SHIFT_STAT_SHORTCUT_CODES.length)
        .map((statType, index) => {
            const code = SHIFT_STAT_SHORTCUT_CODES[index];
            return {
                statType,
                code,
                shortcutDisplay: SHIFT_STAT_SHORTCUT_DISPLAY[code] || '?',
            };
        });
}

function getStatWindowLabel(statType) {
    const parsed = parseRollingStatType(statType);
    return parsed ? String(parsed.windowSize) : statType;
}

function syncModalStatNavigation() {
    const slots = getShiftStatShortcutSlots();
    const timeButton = {
        statType: 'time',
        minIndex: 0,
        label: '1',
        title: 'Single (Shift+`)'
    };

    const statButtons = slots.map(({ statType, shortcutDisplay }) => {
        const parsed = parseRollingStatType(statType);
        return {
            statType,
            minIndex: parsed ? parsed.windowSize - 1 : 0,
            label: getStatWindowLabel(statType),
            title: `${statType} (Shift+${shortcutDisplay})`,
        };
    });

    setModalStatButtons([timeButton, ...statButtons]);

    document.querySelectorAll('#modal-stat-nav button[data-stat-type]').forEach((button) => {
        const type = button.dataset.statType;
        if (type === 'time') {
            registerShortcutTooltip(button, ['Shift', '`']);
            return;
        }

        const slot = slots.find((entry) => entry.statType === type);
        if (!slot) return;
        registerShortcutTooltip(button, ['Shift', slot.shortcutDisplay]);
    });
}

function getShiftStatShortcutType(event) {
    if (!event.shiftKey) return null;
    if (event.code === 'Backquote') return 'time';

    const slotIndex = SHIFT_STAT_SHORTCUT_CODES.indexOf(event.code);
    if (slotIndex < 0) return null;
    const slots = getShiftStatShortcutSlots();
    return slots[slotIndex]?.statType || null;
}

function canOpenSettingsPanel() {
    const state = timer.getState();
    return state === 'idle' || state === 'stopped';
}

function toggleDeltaDisplayShortcut() {
    const nextShowDelta = !settings.get('showDelta');
    settings.set('showDelta', nextShowDelta);

    const deltaToggle = document.getElementById('setting-show-delta');
    if (deltaToggle) deltaToggle.checked = nextShowDelta;
}

function isShortcutsOverlayOpen() {
    return shortcutsOverlayEl?.classList.contains('active');
}

function isThemeCustomizationOpen() {
    return themeCustomizationOverlayEl?.classList.contains('active');
}

function getThemeCustomizationDockPosition() {
    if (!themeCustomizationOverlayEl?.classList.contains('theme-customization-overlay-docked')) {
        return '';
    }

    return themeCustomizationOverlayEl.classList.contains('theme-customization-overlay-docked-bottom-left')
        ? 'bottom-left'
        : 'top-right';
}

function isThemeCustomizationDocked() {
    return Boolean(getThemeCustomizationDockPosition());
}

function isSettingsPanelBlocking() {
    return Boolean(
        settingsOverlayEl?.classList.contains('active')
        && (!isThemeCustomizationDocked() || !settingsOverlayEl.classList.contains('theme-customization-host-docked'))
    );
}

function closeThemeCustomizationModal() {
    if (!themeCustomizationOverlayEl) return;
    const wasDocked = isThemeCustomizationDocked();
    if (themeCustomizationCloseCleanupTimer) {
        window.clearTimeout(themeCustomizationCloseCleanupTimer);
        themeCustomizationCloseCleanupTimer = 0;
    }
    themeCustomizationOverlayEl.classList.remove('active');
    if (wasDocked) {
        themeCustomizationCloseCleanupTimer = window.setTimeout(() => {
            themeCustomizationOverlayEl?.classList.remove('theme-customization-overlay-docked');
            themeCustomizationOverlayEl?.classList.remove('theme-customization-overlay-docked-bottom-left');
            settingsOverlayEl?.classList.remove('theme-customization-host-docked');
            document.body.classList.remove('theme-customization-docked');
            themeCustomizationCloseCleanupTimer = 0;
        }, 220);
    } else {
        themeCustomizationOverlayEl.classList.remove('theme-customization-overlay-docked');
        themeCustomizationOverlayEl.classList.remove('theme-customization-overlay-docked-bottom-left');
        settingsOverlayEl?.classList.remove('theme-customization-host-docked');
        document.body.classList.remove('theme-customization-docked');
    }
    if (document.activeElement) document.activeElement.blur();
}

function showSettingsPanelAlongsideThemeCustomization() {
    if (!settingsOverlayEl) return false;
    settingsOverlayEl.classList.add('active');
    settingsOverlayEl.classList.remove('theme-customization-host-docked');
    window.requestAnimationFrame(() => syncSettingsRowSeparators());
    blurManualTimeInput();
    return true;
}

function openSettingsPanel({ isSwitching = false } = {}) {
    if (!settingsOverlayEl) return false;
    if (!settingsOverlayEl.classList.contains('active') && !canOpenSettingsPanel()) return false;

    if (!isSwitching) pushHistoryState();
    settingsOverlayEl.classList.add('active');
    window.requestAnimationFrame(() => syncSettingsRowSeparators());
    blurManualTimeInput();
    return true;
}

function closeSettingsPanel({ isPopState = false, isSwitching = false } = {}) {
    if (!settingsOverlayEl) return;
    if (!isPopState && !isSwitching) backToDismiss();

    const shouldKeepDockedThemeOpen = Boolean(
        isThemeCustomizationOpen()
        && isThemeCustomizationDocked()
        && !settingsOverlayEl.classList.contains('theme-customization-host-docked')
    );

    if (shouldKeepDockedThemeOpen) {
        settingsOverlayEl.classList.remove('active');
    } else {
        closeThemeCustomizationModal();
        settingsOverlayEl.classList.remove('active');
    }
    if (document.activeElement) document.activeElement.blur();
}

function openKeyboardShortcutsOverlay({ closeSettings = false, isSwitching = false } = {}) {
    if (!shortcutsOverlayEl) return false;
    if (!shortcutsOverlayEl.classList.contains('active') && !canOpenSettingsPanel()) return false;

    if (closeSettings) closeSettingsPanel({ isSwitching: true });
    if (!isSwitching) pushHistoryState();
    shortcutsOverlayEl.classList.add('active');
    blurManualTimeInput();
    return true;
}

function closeKeyboardShortcutsOverlay({ isPopState = false, isSwitching = false } = {}) {
    if (!shortcutsOverlayEl) return;
    if (!isPopState && !isSwitching) backToDismiss();

    shortcutsOverlayEl.classList.remove('active');
    if (document.activeElement) document.activeElement.blur();
}

function renderShortcutBinding(binding) {
    return `<span class="shortcut-binding">${binding.map(key => `<kbd>${key}</kbd>`).join('<span class="shortcut-plus">+</span>')}</span>`;
}

function getKeyboardShortcutGroups() {
    const dynamicStatItems = getShiftStatShortcutSlots().map(({ statType, shortcutDisplay }) => ({
        action: `Open ${statType} details`,
        bindings: [['Shift', shortcutDisplay]],
    }));

    return keyboardShortcutGroups.map((group) => {
        if (group.title !== 'Solves') return group;

        const preservedItems = group.items.filter((item) => item.action !== 'Open configured summary stats');
        return {
            ...group,
            items: [...preservedItems, ...dynamicStatItems],
        };
    });
}

function renderKeyboardShortcuts() {
    const container = document.getElementById('shortcut-groups');
    if (!container) return;

    const groups = getKeyboardShortcutGroups();

    container.innerHTML = groups.map(group => `
        <section class="shortcut-group">
            <div class="shortcut-group-title">${group.title}</div>
            ${group.items.map(item => `
                <div class="shortcut-row">
                    <div class="shortcut-label">
                        ${item.action}
                        ${item.detail ? `<small>${item.detail}</small>` : ''}
                    </div>
                    <div class="shortcut-bindings">
                        ${item.bindings.map(renderShortcutBinding).join('<span class="shortcut-binding-separator">or</span>')}
                    </div>
                </div>
            `).join('')}
        </section>
    `).join('');
}

function getAltSessionShortcutOffset(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
    return ALT_SESSION_SHORTCUT_OFFSETS.get(event.code) || 0;
}

function getAltScrambleTypeShortcut(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    return ALT_SCRAMBLE_TYPE_SHORTCUTS.get(event.code) || null;
}

async function switchActiveSessionByOffset(offset) {
    if (!Number.isFinite(offset) || offset === 0) return false;

    const sessions = sessionManager.getSessions();
    if (sessions.length <= 1) return false;

    const activeSessionId = sessionManager.getActiveSessionId();
    const currentIndex = sessions.findIndex((session) => session.id === activeSessionId);
    if (currentIndex === -1) return false;

    const nextIndex = (currentIndex + offset + sessions.length) % sessions.length;
    if (nextIndex === currentIndex) return false;

    await sessionManager.setActiveSession(sessions[nextIndex].id);
    return true;
}

// ──── Keyboard Shortcuts ────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;
        if (e.key !== 'Escape') return;
        if (!isDesktopTypingEntryModeEnabled() || isManualTimeInputFocused()) return;
        if (hasBlockingOverlayOpen() || isSettingsPanelBlocking()) return;
        if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

        e.preventDefault();
        if (!isManualTimeEntryActive()) {
            openManualTimeEntry({ focusStrategy: 'immediate' });
            return;
        }

        focusManualTimeInput();
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;

        const slashShortcutPressed = isSlashShortcut(e);
        const isShortcutHelpKey = slashShortcutPressed && (e.ctrlKey || e.metaKey);
        const normalizedKey = String(e.key).toLowerCase();
        const isSelectAllShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && normalizedKey === 'a';
        const isSearchShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && normalizedKey === 'f';
        if (isShortcutHelpKey) {
            e.preventDefault();

            if (isShortcutsOverlayOpen()) {
                closeKeyboardShortcutsOverlay();
                return;
            }

            if (document.getElementById('modal-overlay').classList.contains('active') ||
                document.getElementById('scramble-preview-overlay').classList.contains('active') ||
                document.getElementById('confirm-overlay').classList.contains('active') ||
                document.getElementById('prompt-overlay').classList.contains('active')) return;

            openKeyboardShortcutsOverlay({ closeSettings: isSettingsPanelBlocking(), isSwitching: isSettingsPanelBlocking() });

            e.stopPropagation();
            return;
        }

        if (isSearchShortcut) {
            if (hasBlockingOverlayOpen() || isSettingsPanelBlocking()) return;
            if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

            e.preventDefault();
            closeCustomSelectMenus();
            closeScrambleTypeMenus();
            toggleSearchMenu(true);
            e.stopPropagation();
            return;
        }

        // Ignore input fields, unless they are one of the explicit shortcut passthrough cases.
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            const isManualTimeInput = e.target.id === 'manual-time-hidden-input';
            const isModalTextarea = e.target.id === 'modal-textarea';
            const isShortcutKey = ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Backspace', 'Delete'].includes(e.code);
            const isShiftStatShortcut = Boolean(getShiftStatShortcutType(e));
            const isSlashInSettings = slashShortcutPressed && isSettingsPanelBlocking();
            const isGraphShortcut = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.code);
            const isManualInputEditingKey = isManualTimeInput && (
                /^\d$/.test(e.key)
                || e.key === 'Backspace'
                || e.key === 'Delete'
                || e.key === 'Enter'
                || e.key === 'Escape'
                || e.key === '.'
                || e.key === ','
            );
            const isManualInputPassthrough = isManualTimeInput && (
                (isDesktopTypingEntryModeEnabled() && !isManualInputEditingKey)
                || e.ctrlKey
                || e.metaKey
                || e.altKey
                || isGraphShortcut
            );

            if (!(isModalTextarea && (isShortcutKey || isShiftStatShortcut))
                && !isSlashInSettings
                && !isManualInputPassthrough) {
                return;
            }
        }

        if (slashShortcutPressed) {
            if (isShortcutsOverlayOpen()) {
                e.preventDefault();
                closeKeyboardShortcutsOverlay({ isSwitching: true });
                openSettingsPanel({ isSwitching: true });
                return;
            }

            if (hasBlockingOverlayOpen()) return;

            e.preventDefault();
            if (isSettingsPanelBlocking()) {
                closeSettingsPanel();
                return;
            }
            if (isThemeCustomizationOpen() && isThemeCustomizationDocked()) {
                showSettingsPanelAlongsideThemeCustomization();
                return;
            }

            openSettingsPanel();
            return;
        }

        if (isSelectAllShortcut) {
            if (hasBlockingOverlayOpen() || isSettingsPanelBlocking()) return;
            if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

            e.preventDefault();
            selectAllCurrentTableSolves();
            return;
        }

        // Ignore if confirm or settings modal is active
        if (document.getElementById('confirm-overlay').classList.contains('active') ||
            isSettingsPanelBlocking() ||
            isShortcutsOverlayOpen()) return;

        // Ignore if Ctrl or Cmd is pressed (e.g. browser zoom Ctrl+/-)
        if (e.ctrlKey || e.metaKey) return;

        const isSolveModalActive = document.getElementById('modal-overlay').classList.contains('active')
            || document.getElementById('distribution-overlay').classList.contains('active')
            || document.getElementById('scramble-preview-overlay').classList.contains('active');
        const altSessionShortcutOffset = getAltSessionShortcutOffset(e);
        const altScrambleTypeShortcut = getAltScrambleTypeShortcut(e);

        if (isManualTimeInputFocused() && (e.code === 'Period' || e.code === 'Comma')) return;

        // Ignore if timer is running or holding
        if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

        if (altSessionShortcutOffset || altScrambleTypeShortcut) {
            if (isSolveModalActive) return;

            e.preventDefault();
            closeCustomSelectMenus();
            closeScrambleTypeMenus();

            if (altSessionShortcutOffset) {
                void switchActiveSessionByOffset(altSessionShortcutOffset);
                return;
            }

            if (altScrambleTypeShortcut) {
                void applyActiveSessionScrambleType(altScrambleTypeShortcut);
                return;
            }
        }

        if (isDesktopTypingEntryModeEnabled() && !isSolveModalActive && !isManualTimeInputFocused()) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (!isManualTimeEntryActive()) {
                    openManualTimeEntry({ focusStrategy: 'immediate' });
                    return;
                }

                focusManualTimeInput();
                return;
            }

            if (/^\d$/.test(e.key)) {
                e.preventDefault();
                if (!isManualTimeEntryActive()) {
                    openManualTimeEntry({ initialDigits: e.key, focusStrategy: 'immediate' });
                    return;
                }

                focusManualTimeInput();
                quickActionsState.manualDigits = sanitizeManualDigits(`${quickActionsState.manualDigits}${e.key}`);
                updateManualTimeEntryUI();
                return;
            }
        }

        const shortcutStatType = getShiftStatShortcutType(e);
        if (shortcutStatType) {
            e.preventDefault();
            openShortcutStatDetail(shortcutStatType);
            return;
        }

        switch (e.code) {
            case 'Tab':
                e.preventDefault();
                if (isSolveModalActive || isSettingsPanelBlocking()) return;

                const lastSolve = getMostRecentSummarySolve();
                if (!lastSolve) break;

                promptForSolveComment(lastSolve);
                break;
            case 'KeyC':
                e.preventDefault();
                closeScrambleTypeMenus();
                copyCurrentScrambleToClipboard();
                break;
            case 'Backspace':
            case 'Delete':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-delete');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    const session = sessionManager.getActiveSession();
                    if (session && session.solves.length > 0) {
                        const targetId = session.solves[session.solves.length - 1].id;
                        customConfirm('Are you sure you want to delete the last solve?').then(confirmed => {
                            if (confirmed) sessionManager.deleteSolve(targetId);
                        });
                    }
                }
                break;
            case 'KeyD':
                if (isSolveModalActive) return;
                e.preventDefault();
                toggleDeltaDisplayShortcut();
                break;
            case 'Equal':
            case 'NumpadAdd':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-plus2');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    toggleLastSolvePenaltyFromMainTimerShortcut('+2');
                }
                break;
            case 'Minus':
            case 'NumpadSubtract':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-dnf');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    toggleLastSolvePenaltyFromMainTimerShortcut('DNF');
                }
                break;
            case 'KeyZ':
                if (isSolveModalActive) return;
                if (mobileViewportQuery.matches && !isMobileTimerPanelActive()) return;
                toggleZenMode();
                break;
            case 'KeyT':
                e.preventDefault();
                if (isTimeDistributionModalOpen()) {
                    closeTimeDistributionModal();
                    break;
                }
                if (isSolveModalActive) return;
                showTimeDistributionModal(getSearchScopedSolves(), {
                    sessionName: sessionManager.getActiveSession()?.name || 'Session',
                });
                break;
            case 'KeyS':
                e.preventDefault();
                if (isScramblePreviewModalOpen()) {
                    closeScramblePreviewModal();
                    break;
                }
                if (isSolveModalActive) return;
                openScramblePreviewModal();
                break;
            case 'Period':
                if (isSolveModalActive) return;
                document.getElementById('btn-next-scramble').click();
                break;
            case 'Comma':
                if (isSolveModalActive) return;
                if (!document.getElementById('btn-prev-scramble').disabled) {
                    document.getElementById('btn-prev-scramble').click();
                }
                break;
            case 'ArrowLeft':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-x-in');
                else applyAction('pan-left');
                break;
            case 'ArrowRight':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-x-out');
                else applyAction('pan-right');
                break;
            case 'ArrowUp':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-y-in');
                else applyAction('pan-up');
                break;
            case 'ArrowDown':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-y-out');
                else applyAction('pan-down');
                break;
            case 'Enter':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('last25');
                else applyAction('reset');
                break;
        }
    });
}

// ──── Timer Events ────
async function onSolveComplete(elapsed, penalty = null) {
    backToDismiss();
    await commitSolve(elapsed, penalty, { isManual: isCurrentScrambleManual() });
}

function onTimerStarted() {
    pushHistoryState();
    // Info hidden via onTimerStateChange
}

function isInspectionState(state) {
    return state === 'inspection-primed'
        || state === 'inspecting'
        || state === 'inspection-holding'
        || state === 'inspection-ready';
}

function clearInspectionAlert() {
    clearPopup('inspection');
}

function clearNewBestAlert() {
    clearPopup('newBest');
}

function clearPenaltyShortcutAlert() {
    clearPopup('penaltyShortcut');
}

function setCubingWarmupAlert(text, { isSuccess = false, isError = false, autoHideMs = 0 } = {}) {
    const alertEl = document.getElementById('cubing-warmup-alert');
    if (!alertEl) return;

    if (cubingWarmupHideTimeout) {
        clearTimeout(cubingWarmupHideTimeout);
        cubingWarmupHideTimeout = null;
    }

    alertEl.classList.toggle('timer-popup-success', isSuccess);
    alertEl.classList.toggle('timer-popup-danger', isError);

    if (!text) {
        alertEl.classList.remove('visible');
        syncTimerPopupStacking();
        alertEl.textContent = '';
        alertEl.classList.remove('timer-popup-success', 'timer-popup-danger');
        return;
    }

    alertEl.textContent = text;
    alertEl.classList.add('visible');
    syncTimerPopupStacking();

    if (autoHideMs > 0) {
        cubingWarmupHideTimeout = setTimeout(() => {
            alertEl.classList.remove('visible');
            syncTimerPopupStacking();
            cubingWarmupHideTimeout = setTimeout(() => {
                if (!alertEl.classList.contains('visible')) {
                    alertEl.textContent = '';
                    alertEl.classList.remove('timer-popup-success', 'timer-popup-danger');
                }
                cubingWarmupHideTimeout = null;
            }, 220);
        }, autoHideMs);
    }
}

function formatCubingWarmupProgress(snapshot) {
    if (snapshot.status === 'complete') {
        return 'Offline scramblers ready';
    }

    if (snapshot.status === 'failed') {
        return 'Offline scramble setup paused';
    }

    const typeMeta = snapshot.currentType
        ? SCRAMBLE_TYPE_OPTIONS.find((option) => option.id === snapshot.currentType)
        : null;
    const completed = Math.max(0, Math.min(snapshot.total, snapshot.completed));

    if (typeMeta) {
        return `Caching offline scramblers ${completed}/${snapshot.total}: ${typeMeta.menuLabel}`;
    }

    return `Caching offline scramblers ${completed}/${snapshot.total}`;
}

function startCubingWarmupIfNeeded() {
    if (!needsCubingWarmup()) {
        setCubingWarmupAlert('');
        return;
    }

    const totalCubingTypes = SCRAMBLE_TYPE_OPTIONS.filter((option) => option.generator === 'cubing').length;
    setCubingWarmupAlert(formatCubingWarmupProgress({
        status: 'starting',
        completed: 0,
        total: totalCubingTypes,
        currentType: null,
    }));

    void runCubingWarmup((snapshot) => {
        if (snapshot.status === 'complete') {
            setCubingWarmupAlert(formatCubingWarmupProgress(snapshot), { isSuccess: true, autoHideMs: 1800 });
            return;
        }

        if (snapshot.status === 'failed') {
            setCubingWarmupAlert(formatCubingWarmupProgress(snapshot), { isError: true, autoHideMs: 2600 });
            return;
        }

        setCubingWarmupAlert(formatCubingWarmupProgress(snapshot));
    });
}

function clearPopup(kind) {
    const popup = popupState[kind];
    if (!popup) return;

    const alertEl = document.getElementById(popup.elementId);
    if (!alertEl) return;

    if (popup.hideTimeout) {
        clearTimeout(popup.hideTimeout);
        popup.hideTimeout = null;
    }

    if (popup.clearTimeout) {
        clearTimeout(popup.clearTimeout);
        popup.clearTimeout = null;
    }

    alertEl.classList.remove('visible');
    syncTimerPopupStacking();
    popup.clearTimeout = setTimeout(() => {
        if (!alertEl.classList.contains('visible')) {
            alertEl.textContent = '';
        }
        popup.clearTimeout = null;
    }, 220);
}

function showInspectionAlert(text) {
    showPopup('inspection', text);
}

function showNewBestAlert(text) {
    if (!settings.get('newBestPopupEnabled')) return;
    showPopup('newBest', text, 4500);
}

function showPenaltyShortcutAlert(state, penalty = null, solveNumber = null) {
    const alertEl = document.getElementById(popupState.penaltyShortcut.elementId);
    if (!alertEl) return;

    const isApplied = state === 'applied' && (penalty === '+2' || penalty === 'DNF');
    const isCleared = state === 'cleared';
    if (!isApplied && !isCleared) return;

    alertEl.classList.toggle('timer-popup-danger', isApplied);
    alertEl.classList.toggle('timer-popup-success', isCleared);
    clearNewBestAlert();

    showPopup(
        'penaltyShortcut',
        isCleared ? `#${solveNumber}: OK` : `#${solveNumber}: ${penalty} applied`,
        1700,
    );
}

function showPopup(kind, text, duration = 1500) {
    const popup = popupState[kind];
    if (!popup) return;

    const alertEl = document.getElementById(popup.elementId);
    if (!alertEl) return;

    if (popup.hideTimeout) {
        clearTimeout(popup.hideTimeout);
        popup.hideTimeout = null;
    }

    if (popup.clearTimeout) {
        clearTimeout(popup.clearTimeout);
        popup.clearTimeout = null;
    }

    alertEl.textContent = text;
    alertEl.classList.add('visible');
    syncTimerPopupStacking();
    popup.hideTimeout = setTimeout(() => {
        alertEl.classList.remove('visible');
        syncTimerPopupStacking();
        popup.clearTimeout = setTimeout(() => {
            if (!alertEl.classList.contains('visible')) {
                alertEl.textContent = '';
            }
            popup.clearTimeout = null;
        }, 220);
        popup.hideTimeout = null;
    }, duration);
}

function speakInspectionAlert(seconds) {
    if (!('speechSynthesis' in window)) return;
    if (inspectionSpeechUnlockState.required && !inspectionSpeechUnlockState.unlocked) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${seconds} seconds`);
    utterance.rate = isSafariBrowser() ? 1.2 : 1.5;
    window.speechSynthesis.speak(utterance);
}

function onInspectionAlert(seconds) {
    const alertMode = settings.get('inspectionAlerts');
    if (alertMode === 'screen' || alertMode === 'both') {
        showInspectionAlert(`${seconds}s`);
    }
    if (alertMode === 'voice' || alertMode === 'both') {
        speakInspectionAlert(seconds);
    }
}

function onTimerStateChange(state) {
    syncInspectionSpeechUnlockPromptVisibility();
    syncInspectionCancelControl(state);

    const infoEl = document.getElementById('timer-info');
    const deltaEl = document.getElementById('timer-delta');
    const timerDisplayWrapper = document.getElementById('timer-display-wrapper');
    const shouldFocusTimer = state === 'running' || state === 'ready' || isInspectionState(state);
    const shouldLockMobileScramble = state !== 'idle' && state !== 'stopped';

    if (mobileViewportQuery.matches && shouldLockMobileScramble) {
        lockMobileScrambleLayoutFreeze();
    }

    if (mobileViewportQuery.matches && shouldFocusTimer) {
        setActiveMobilePanel('timer');
    }

    const isPreSolveState = state === 'holding' || state === 'ready' || isInspectionState(state);

    if (state !== 'idle' && state !== 'stopped') {
        if (quickActionsState.manualEntryActive) {
            closeManualTimeEntry({ restoreQuickActions: false });
        } else if (quickActionsState.visible) {
            const shouldKeepQuickActionsVisible = quickActionsState.swipeVisibilityOverride && isPreSolveState;
            if (!shouldKeepQuickActionsVisible) {
                setQuickActionsVisible(false);
            }
        }
    } else {
        quickActionsState.swipeVisibilityOverride = false;
    }

    // Toggle solving class for focus mode
    const hideUIWhileSolving = settings.get('hideUIWhileSolving');
    const actualShouldHideUI = mobileViewportQuery.matches ? shouldFocusTimer : (shouldFocusTimer && hideUIWhileSolving);
    document.body.classList.toggle('solving', actualShouldHideUI);

    if (timerDisplayWrapper) scheduleViewportLayoutSync();

    if (infoEl) {
        infoEl.style.visibility = '';
        infoEl.style.opacity = '';
    }

    if (state === 'inspection-primed' || !isInspectionState(state)) {
        clearInspectionAlert();
    }

    if (state !== 'idle' && state !== 'stopped') {
        clearNewBestAlert();
        clearPenaltyShortcutAlert();
    }

    // Hide delta when timer is ready, running, or in inspection
    if (deltaEl) {
        if (state === 'running' || state === 'ready' || isInspectionState(state)) {
            deltaEl.classList.remove('visible');
        } else if (state === 'idle' || state === 'stopped') {
            updateDelta(sessionManager.getFilteredSolves());
        }
    }


}

function didSetNewBest(previousBest, currentBest) {
    if (currentBest == null || currentBest === Infinity) return false;
    if (previousBest == null || previousBest === Infinity) return true;
    return currentBest < previousBest;
}

function maybeShowNewBestAlert(previousStats, currentStats) {
    const labels = [];

    if (didSetNewBest(previousStats.best.time, currentStats.best.time)) {
        labels.push('single');
    }

    const times = statsCache.getTimes();
    const lastIndex = times.length - 1;
    const configuredRows = getConfiguredSummaryStatTokens();

    configuredRows.forEach((statType) => {
        const config = getRollingStatConfig(statType);
        if (!config || lastIndex < config.windowSize - 1) return;

        const summary = getRollingStatSummary(times, statType);
        if (summary.value == null || summary.value === Infinity) return;
        if (summary.current == null || summary.current === Infinity) return;

        if (summary.index === lastIndex && summary.current === summary.value) {
            labels.push(statType);
        }
    });

    if (labels.length === 0) return;
    showNewBestAlert(`Best ${labels.join(', ')}`);
}

// ──── UI Refresh ────
function syncStatsCacheWithFilteredSolves(solves = sessionManager.getFilteredSolves(), { force = false } = {}) {
    if (force || !statsCache.matchesSolves(solves)) {
        statsCache.rebuild(solves);
        summaryRowsCache = { signature: '', rows: [] };
        rollingStatSummaryCache.clear();
    }

    return solves;
}

function parseSearchTimeBoundary(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    return parseTimeInputToMs(normalized);
}

function solveMatchesSearchFilters(solve, index, filters = searchFilters) {
    const { text, indexMin, indexMax, timeMin, timeMax } = filters;
    const displayIndex = index + 1;

    if (indexMin !== '' && displayIndex < Number(indexMin)) return false;
    if (indexMax !== '' && displayIndex > Number(indexMax)) return false;

    const minTimeMs = parseSearchTimeBoundary(timeMin);
    const maxTimeMs = parseSearchTimeBoundary(timeMax);
    const hasTimeFilter = minTimeMs != null || maxTimeMs != null;

    if (hasTimeFilter) {
        const effectiveTime = getEffectiveTime(solve);
        if (!Number.isFinite(effectiveTime)) return false;
        if (minTimeMs != null && effectiveTime < minTimeMs) return false;
        if (maxTimeMs != null && effectiveTime > maxTimeMs) return false;
    }

    const textLower = text.toLowerCase();
    if (!textLower) return true;

    const timeText = formatSolveTime(solve).toLowerCase();
    const commentText = (solve.comment || '').toLowerCase();
    const scrambleText = (solve.scramble || '').toLowerCase();
    return timeText.includes(textLower)
        || commentText.includes(textLower)
        || scrambleText.includes(textLower);
}

function getSearchMatchedSolveIndices(solves, filters = searchFilters) {
    if (!isSearchActive) return solves.map((_, index) => index);

    const hasTextFilter = Boolean(filters.text?.trim());
    const hasTimeFilter = filters.timeMin !== '' || filters.timeMax !== '';
    const hasIndexFilter = filters.indexMin !== '' || filters.indexMax !== '';

    if (hasIndexFilter && !hasTextFilter && !hasTimeFilter) {
        const minIndex = filters.indexMin !== '' ? Math.max(1, Math.floor(Number(filters.indexMin))) : 1;
        const maxIndex = filters.indexMax !== '' ? Math.min(solves.length, Math.floor(Number(filters.indexMax))) : solves.length;

        if (!Number.isFinite(minIndex) || !Number.isFinite(maxIndex) || minIndex > maxIndex) {
            return [];
        }

        const matched = [];
        for (let index = minIndex - 1; index < maxIndex; index += 1) {
            matched.push(index);
        }
        return matched;
    }

    return solves
        .map((_, index) => index)
        .filter((index) => solveMatchesSearchFilters(solves[index], index, filters));
}

function getSearchScopedSolves(solves = sessionManager.getFilteredSolves()) {
    if (!isSearchActive) return solves;
    const matchedIndices = getSearchMatchedSolveIndices(solves);
    return matchedIndices.map((index) => ({
        ...solves[index],
        graphDisplayIndex: index + 1,
    }));
}

function buildStatsCacheForSolves(solves) {
    const cache = new StatsCache();
    cache.rebuild(solves);
    return cache;
}

function reconcileSelectedSolveState(solves = sessionManager.getFilteredSolves()) {
    const validSolveIds = new Set(solves.map((solve) => solve.id));
    let changed = false;

    selectedSolveIds.forEach((solveId) => {
        if (validSolveIds.has(solveId)) return;
        selectedSolveIds.delete(solveId);
        changed = true;
    });

    activeRangeSelectedSolveIds.forEach((solveId) => {
        if (validSolveIds.has(solveId) && selectedSolveIds.has(solveId)) return;
        activeRangeSelectedSolveIds.delete(solveId);
        changed = true;
    });

    if (selectedSolveIds.size === 0) {
        if (lastSelectedSolveIndex !== -1) changed = true;
        if (lastSelectedSolveId != null) changed = true;
        if (selectionAnchorSolveIndex !== -1) changed = true;
        if (selectionAnchorSolveId != null) changed = true;
        if (activeRangeSelectedSolveIds.size > 0) changed = true;

        lastSelectedSolveIndex = -1;
        lastSelectedSolveId = null;
        selectionAnchorSolveIndex = -1;
        selectionAnchorSolveId = null;
        activeRangeSelectedSolveIds.clear();
        return changed;
    }

    if (!selectionAnchorSolveId || !selectedSolveIds.has(selectionAnchorSolveId) || !validSolveIds.has(selectionAnchorSolveId)) {
        if (selectionAnchorSolveIndex !== -1 || selectionAnchorSolveId != null || activeRangeSelectedSolveIds.size > 0) {
            changed = true;
        }
        selectionAnchorSolveIndex = -1;
        selectionAnchorSolveId = null;
        activeRangeSelectedSolveIds.clear();
    } else {
        const nextAnchorIndex = solves.findIndex((solve) => solve.id === selectionAnchorSolveId);
        if (selectionAnchorSolveIndex !== nextAnchorIndex) {
            selectionAnchorSolveIndex = nextAnchorIndex;
            changed = true;
        }
    }

    if (!lastSelectedSolveId || !selectedSolveIds.has(lastSelectedSolveId) || !validSolveIds.has(lastSelectedSolveId)) {
        if (lastSelectedSolveIndex !== -1 || lastSelectedSolveId != null) {
            changed = true;
        }
        lastSelectedSolveIndex = -1;
        lastSelectedSolveId = null;
    } else {
        const nextLastSelectedIndex = solves.findIndex((solve) => solve.id === lastSelectedSolveId);
        if (lastSelectedSolveIndex !== nextLastSelectedIndex) {
            lastSelectedSolveIndex = nextLastSelectedIndex;
            changed = true;
        }
    }

    return changed;
}

/**
 * Rebuild the stats cache from scratch for the current filtered solves.
 * Called on session switch, filter change, import, delete, penalty toggle.
 */
function rebuildStatsCache() {
    syncStatsCacheWithFilteredSolves(undefined, { force: true });
}

function refreshUI() {
    const solves = syncStatsCacheWithFilteredSolves();
    reconcileSelectedSolveState(solves);
    const stats = statsCache.getStats();
    const graphAndDistributionSolves = getSearchScopedSolves(solves);
    const graphStatsCache = graphAndDistributionSolves === solves
        ? statsCache
        : buildStatsCacheForSolves(graphAndDistributionSolves);

    renderSummaryStats(stats, solves);
    renderSolvesTable(solves, stats);
    updateGraphData(graphAndDistributionSolves, graphStatsCache);
    if (isTimeDistributionModalOpen()) {
        refreshTimeDistributionData(graphAndDistributionSolves, {
            sessionName: sessionManager.getActiveSession()?.name || 'Session',
        });
    }
    updateTimerInfo(stats, solves);
    refreshSessionList();

    // Sync timer display with last solve if not running
    const state = timer.getState();
    if (state === 'idle' || state === 'stopped') {
        const lastSolve = solves[solves.length - 1];
        if (lastSolve) {
            timer.setDisplay(formatTimerDisplayTime(lastSolve));
        } else {
            timer.resetDisplay();
        }
    }

    // Update delta display
    updateDailyStreakUI();
    updateDelta(solves);
    updateQuickActionButtons();
    scheduleViewportLayoutSync();
}

function hasSeenDailyStreakIntro() {
    try {
        return localStorage.getItem(DAILY_STREAKS_INTRO_STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function markDailyStreakIntroSeen() {
    try {
        localStorage.setItem(DAILY_STREAKS_INTRO_STORAGE_KEY, '1');
    } catch (_) {
    }
}

function showDailyStreakIntroToast() {
    const toastEl = document.getElementById('daily-streak-toast');
    if (!toastEl) return;

    if (dailyStreakToastHideTimeout) {
        clearTimeout(dailyStreakToastHideTimeout);
        dailyStreakToastHideTimeout = null;
    }

    toastEl.textContent = 'Daily streaks are here. Settings > Stats';
    toastEl.hidden = false;
    window.requestAnimationFrame(() => {
        toastEl.classList.add('visible');
    });

    dailyStreakToastHideTimeout = window.setTimeout(() => {
        toastEl.classList.remove('visible');
        dailyStreakToastHideTimeout = window.setTimeout(() => {
            toastEl.hidden = true;
            dailyStreakToastHideTimeout = null;
        }, 220);
    }, 3800);
}

function maybeShowDailyStreakIntro() {
    if (hasSeenDailyStreakIntro()) return;

    markDailyStreakIntroSeen();
    showDailyStreakIntroToast();
}

function formatDailyStreakMobileProgressText(streakState) {
    if (!streakState || streakState.disabled) return '';

    return `${streakState.todayCount} / ${streakState.goal}`;
}

function closeDailyStreakMobilePopup() {
    const popupEl = getEl('daily-streak-mobile-popup');
    const buttonEl = getEl('btn-daily-streak-mobile');

    if (popupEl) popupEl.hidden = true;
    if (buttonEl) buttonEl.setAttribute('aria-expanded', 'false');
}

function setDailyStreakMobilePopupOpen(isOpen) {
    const controlEl = getEl('daily-streak-mobile-control');
    const popupEl = getEl('daily-streak-mobile-popup');
    const buttonEl = getEl('btn-daily-streak-mobile');

    if (!controlEl || !popupEl || !buttonEl || controlEl.hidden || !isMobileTimerPanelActive()) {
        closeDailyStreakMobilePopup();
        return;
    }

    popupEl.hidden = !isOpen;
    buttonEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function initDailyStreakMobileControl() {
    const controlEl = getEl('daily-streak-mobile-control');
    const buttonEl = getEl('btn-daily-streak-mobile');
    if (!controlEl || !buttonEl) return;

    buttonEl.addEventListener('click', (event) => {
        event.preventDefault();
        if (controlEl.hidden) return;

        const popupEl = getEl('daily-streak-mobile-popup');
        setDailyStreakMobilePopupOpen(popupEl?.hidden ?? true);
    });

    document.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof Node)) return;
        if (controlEl.contains(event.target)) return;
        closeDailyStreakMobilePopup();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return;
        closeDailyStreakMobilePopup();
    });

    window.addEventListener('resize', closeDailyStreakMobilePopup);
    window.addEventListener('orientationchange', closeDailyStreakMobilePopup);
}

let lastSummaryValues = { ao5: null, ao12: null, ao100: null, meanStr: '-' };

function syncMobileSummaryDisplays() {
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    let maxSummaryChars = null;
    if (height > width && width < 630) {
        maxSummaryChars = 6;
    }

    const fmt = (val) => maxSummaryChars ? truncateTimeDisplay(formatTime(val), maxSummaryChars) : formatTime(val);

    const ao5El = document.getElementById('mobile-summary-ao5');
    const ao12El = document.getElementById('mobile-summary-ao12');
    const ao100El = document.getElementById('mobile-summary-ao100');
    const meanEl = document.getElementById('mobile-summary-mean');

    if (ao5El) ao5El.textContent = lastSummaryValues.ao5 != null ? fmt(lastSummaryValues.ao5) : '-';
    if (ao12El) ao12El.textContent = lastSummaryValues.ao12 != null ? fmt(lastSummaryValues.ao12) : '-';
    if (ao100El) ao100El.textContent = lastSummaryValues.ao100 != null ? fmt(lastSummaryValues.ao100) : '-';
    if (meanEl) meanEl.textContent = maxSummaryChars ? truncateTimeDisplay(lastSummaryValues.meanStr, maxSummaryChars) : lastSummaryValues.meanStr;
}

function syncDesktopTimerInfoPills() {
    const width = window.innerWidth || document.documentElement.clientWidth;
    const isMobile = width <= 1100 || mobileViewportQuery.matches;
    const desktopTruncated = !isMobile && width < 1200;
    const isMediumPill = settings.get('pillSize') === 'medium';
    const mediumTruncated = !isMobile && isMediumPill && width < 1150;

    let maxPillChars = 0;
    if (mediumTruncated) {
        maxPillChars = 6;
    } else if (desktopTruncated) {
        maxPillChars = 7;
    } else if (!isMobile && width < 1250) {
        maxPillChars = 8;
    }

    const infoAo5El = document.getElementById('info-ao5');
    const infoAo12El = document.getElementById('info-ao12');

    if (infoAo5El) {
        let ao5Str = lastSummaryValues.ao5 != null ? formatTime(lastSummaryValues.ao5) : '-';
        if (maxPillChars) ao5Str = truncateTimeDisplay(ao5Str, maxPillChars);
        infoAo5El.textContent = ao5Str;
    }
    if (infoAo12El) {
        let ao12Str = lastSummaryValues.ao12 != null ? formatTime(lastSummaryValues.ao12) : '-';
        if (maxPillChars) ao12Str = truncateTimeDisplay(ao12Str, maxPillChars);
        infoAo12El.textContent = ao12Str;
    }
}

function updateTimerInfo(stats, solves) {
    const infoEl = document.getElementById('timer-info');

    infoEl.style.visibility = '';
    infoEl.style.opacity = '';

    const validTimes = solves.map(s => getEffectiveTime(s)).filter(t => t !== Infinity);
    const meanStr = validTimes.length > 0
        ? formatTime(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
        : '-';

    lastSummaryValues = {
        ao5: stats.current.ao5,
        ao12: stats.current.ao12,
        ao100: stats.current.ao100,
        meanStr: meanStr
    };
    syncMobileSummaryDisplays();
    syncDesktopTimerInfoPills();

    document.querySelectorAll('#mobile-summary-card [data-mobile-summary-action]').forEach((cell) => {
        const action = cell.dataset.mobileSummaryAction;
        cell.disabled = action !== 'stats' && stats.current[action] == null;
    });
}

function updateDailyStreakUI() {
    const cardEls = document.querySelectorAll('[data-daily-streak-card]');
    const mobileControlEl = getEl('daily-streak-mobile-control');
    const mobileButtonEl = getEl('btn-daily-streak-mobile');
    const mobileCountEl = document.querySelector('[data-daily-streak-mobile-count]');
    const mobileProgressEl = document.querySelector('[data-daily-streak-mobile-progress]');
    if (!cardEls.length && !mobileControlEl) return;

    const streakState = dailyStreakStore.getState(settings.get('dailyStreakGoal'));
    if (streakState.disabled) {
        cardEls.forEach((cardEl) => {
            cardEl.hidden = true;
        });
        if (mobileControlEl) mobileControlEl.hidden = true;
        closeDailyStreakMobilePopup();
        return;
    }

    cardEls.forEach((cardEl) => {
        cardEl.hidden = false;

        const countEl = cardEl.querySelector('[data-daily-streak-count]');
        const countLabelEl = cardEl.querySelector('[data-daily-streak-count-label]');
        const progressCountEl = cardEl.querySelector('[data-daily-streak-progress-count]');
        const fireEl = cardEl.querySelector('[data-daily-streak-fire]');

        if (countEl) countEl.textContent = String(streakState.currentStreak);
        if (countLabelEl) countLabelEl.textContent = streakState.currentStreak === 1 ? 'day' : 'days';
        if (progressCountEl) progressCountEl.textContent = `${streakState.todayCount} / ${streakState.goal}`;
        fireEl?.classList.toggle('is-active', streakState.goalMetToday);
    });

    if (mobileControlEl) {
        mobileControlEl.hidden = false;
    }
    if (mobileCountEl) {
        mobileCountEl.textContent = String(streakState.currentStreak);
    }
    if (mobileProgressEl) {
        mobileProgressEl.textContent = formatDailyStreakMobileProgressText(streakState);
    }
    if (mobileButtonEl) {
        mobileButtonEl.classList.toggle('is-active', streakState.goalMetToday);
        mobileButtonEl.setAttribute(
            'aria-label',
            `Daily streak: ${streakState.currentStreak} ${streakState.currentStreak === 1 ? 'active day' : 'active days'}. ${formatDailyStreakMobileProgressText(streakState)}.`,
        );
    }

    if (!isMobileTimerPanelActive()) {
        closeDailyStreakMobilePopup();
    }
}

function updateDelta(solves) {
    const deltaEl = document.getElementById('timer-delta');
    if (!deltaEl) return;

    const state = timer.getState();
    const showDelta = settings.get('showDelta');
    const isTimerActive = state === 'running' || state === 'ready' || isInspectionState(state);
    const times = solves.map((solve) => getEffectiveTime(solve));
    const currentIndex = times.length - 1;

    // Clear if disabled, there are no solves, or the timer is active.
    if (!showDelta || solves.length === 0 || isTimerActive) {
        // However, if the current solve is a DNF, we still want to show (DNF) regardless of showDelta
        if (solves.length > 0 && solves[solves.length - 1].penalty === 'DNF' && !isTimerActive) {
            deltaEl.textContent = '(DNF)';
            deltaEl.classList.remove('delta-negative', 'delta-zero');
            deltaEl.classList.add('delta-positive', 'visible');
            return;
        }

        deltaEl.classList.remove('visible');
        return;
    }

    const current = solves[solves.length - 1];
    const curTime = times[currentIndex];

    // If delta is enabled, we still first check if current is DNF.
    if (current.penalty === 'DNF') {
        deltaEl.textContent = '(DNF)';
        deltaEl.classList.remove('delta-negative', 'delta-zero');
        deltaEl.classList.add('delta-positive', 'visible');
        return;
    }

    const deltaReferenceToken = getConfiguredDeltaReferenceToken();
    let referenceTime = null;
    const referenceIndex = currentIndex - 1;

    if (deltaReferenceToken === 'single') {
        referenceTime = referenceIndex >= 0 ? times[referenceIndex] : null;
    } else if (deltaReferenceToken === 'mean') {
        const validTimes = times.slice(0, currentIndex).filter((time) => time !== Infinity);
        referenceTime = validTimes.length
            ? validTimes.reduce((sum, time) => sum + time, 0) / validTimes.length
            : null;
    } else {
        referenceTime = referenceIndex >= 0
            ? rollingStatAt(times, referenceIndex, deltaReferenceToken)
            : null;
    }

    // Hide if either side is unavailable or DNF.
    if (curTime === Infinity || referenceTime == null || referenceTime === Infinity) {
        deltaEl.classList.remove('visible');
        return;
    }

    const diff = curTime - referenceTime;
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    const formatted = formatTime(Math.abs(diff));
    deltaEl.textContent = `(${sign}${formatted})`;

    deltaEl.classList.remove('delta-negative', 'delta-positive', 'delta-zero');
    if (diff < 0) deltaEl.classList.add('delta-negative');
    else if (diff > 0) deltaEl.classList.add('delta-positive');
    else deltaEl.classList.add('delta-zero');

    deltaEl.classList.add('visible');
}

function getRollingStatConfig(type) {
    const parsed = parseRollingStatType(type);
    if (!parsed) return null;
    return {
        type: parsed.type,
        kind: parsed.kind,
        windowSize: parsed.windowSize,
        trim: parsed.trim,
        getValue: (times, index) => rollingStatAt(times, index, parsed.type),
    };
}

function getSelectedStatSolveIndex(solves) {
    const selection = getModalSelectionContext();
    if (!selection) return solves.length - 1;

    if (selection.endSolveId) {
        const solveIndex = solves.findIndex(solve => solve.id === selection.endSolveId);
        if (solveIndex >= 0) return solveIndex;
    }

    if (Number.isInteger(selection.endIndex) && selection.endIndex >= 0 && selection.endIndex < solves.length) {
        return selection.endIndex;
    }

    return solves.length - 1;
}

function openStatDetailAtIndex(type, solves, stats, index, options = {}) {
    if (index < 0 || index >= solves.length) return false;
    const targetLayer = options.targetLayer || 'primary';

    if (type === 'time') {
        const isBest = options.isBest ?? (stats.best.time != null && getEffectiveTime(solves[index]) === stats.best.time);
        showSolveDetail(solves[index], index, isBest, { targetLayer });
        return true;
    }

    const config = getRollingStatConfig(type);
    if (!config || index < config.windowSize - 1) return false;

    const times = Array.isArray(options.times) ? options.times : statsCache.getTimes();
    const value = config.getValue(times, index);
    if (value == null) return false;

    const window = solves.slice(index - config.windowSize + 1, index + 1);
    showAverageDetail(options.label || type, value, window, config.trim, {
        statType: type,
        sessionId: solves[index].sessionId,
        endIndex: index,
        endSolveId: solves[index].id,
    }, { targetLayer });
    return true;
}

function openShortcutStatDetail(type) {
    const selection = getModalSelectionContext();
    const sessionId = selection?.sessionId ?? sessionManager.getActiveSessionId();
    const solves = sessionManager.getFilteredSolvesForSessionId(sessionId);
    if (solves.length === 0) return false;

    const times = solves.map((solve) => getEffectiveTime(solve));
    let bestTime = Infinity;
    for (const time of times) {
        if (time < bestTime) bestTime = time;
    }
    const stats = {
        best: {
            time: bestTime === Infinity ? null : bestTime,
        },
    };
    const index = getSelectedStatSolveIndex(solves);
    return openStatDetailAtIndex(type, solves, stats, index, {
        times,
        targetLayer: selection?.layer === 'secondary' ? 'secondary' : 'primary',
    });
}

function getMostRecentSummarySolve() {
    const solves = sessionManager.getFilteredSolves();
    if (solves.length === 0) return null;
    return solves[solves.length - 1];
}

// ──── Summary Stats ────
class FenwickTree {
    constructor(size) {
        this.size = size;
        this.tree = new Float64Array(size + 1);
    }

    add(index, delta) {
        for (let i = index; i <= this.size; i += i & -i) {
            this.tree[i] += delta;
        }
    }
}

function sumOfSmallestK(countTree, sumTree, indexToValue, k, totalCount, totalSum) {
    if (k <= 0) return 0;
    if (k >= totalCount) return totalSum;

    let idx = 0;
    let bit = 1;
    while ((bit << 1) <= countTree.size) bit <<= 1;

    let countSoFar = 0;
    let sumSoFar = 0;

    while (bit > 0) {
        const next = idx + bit;
        if (next <= countTree.size && (countSoFar + countTree.tree[next]) < k) {
            idx = next;
            countSoFar += countTree.tree[next];
            sumSoFar += sumTree.tree[next];
        }
        bit >>= 1;
    }

    const targetIndex = idx + 1;
    const remaining = k - countSoFar;
    const pivotValue = indexToValue[targetIndex - 1] ?? 0;
    return sumSoFar + (remaining * pivotValue);
}

function computeBestMeanWindow(times, windowSize) {
    if (times.length < windowSize) return { value: null, index: -1 };

    let sum = 0;
    let dnfCount = 0;
    let bestVal = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        if (t === Infinity) dnfCount++; else sum += t;

        if (i >= windowSize) {
            const old = times[i - windowSize];
            if (old === Infinity) dnfCount--; else sum -= old;
        }

        if (i < windowSize - 1) continue;
        if (dnfCount > 0) continue;

        const value = sum / windowSize;
        if (value < bestVal) {
            bestVal = value;
            bestIdx = i;
        }
    }

    return bestIdx >= 0 ? { value: bestVal, index: bestIdx } : { value: null, index: -1 };
}

function computeBestAverageWindow(times, windowSize, trim) {
    if (times.length < windowSize) return { value: null, index: -1 };

    const finiteValues = times.filter(t => t !== Infinity);
    if (finiteValues.length === 0) return { value: null, index: -1 };

    const indexToValue = Array.from(new Set(finiteValues)).sort((a, b) => a - b);
    const valueToIndex = new Map(indexToValue.map((value, idx) => [value, idx + 1]));

    const countTree = new FenwickTree(indexToValue.length);
    const sumTree = new FenwickTree(indexToValue.length);

    let dnfCount = 0;
    let finiteCount = 0;
    let finiteSum = 0;
    let bestVal = Infinity;
    let bestIdx = -1;

    const addTime = (t) => {
        if (t === Infinity) {
            dnfCount++;
            return;
        }
        const index = valueToIndex.get(t);
        if (!index) return;
        countTree.add(index, 1);
        sumTree.add(index, t);
        finiteCount++;
        finiteSum += t;
    };

    const removeTime = (t) => {
        if (t === Infinity) {
            dnfCount--;
            return;
        }
        const index = valueToIndex.get(t);
        if (!index) return;
        countTree.add(index, -1);
        sumTree.add(index, -t);
        finiteCount--;
        finiteSum -= t;
    };

    for (let i = 0; i < times.length; i++) {
        addTime(times[i]);

        if (i >= windowSize) {
            removeTime(times[i - windowSize]);
        }

        if (i < windowSize - 1) continue;
        if (dnfCount > trim) continue;

        const lowTrim = trim;
        const highTrim = trim - dnfCount;
        const rightRank = finiteCount - highTrim;
        const leftRankMinusOne = lowTrim;
        if (rightRank <= leftRankMinusOne) continue;

        const rightSum = sumOfSmallestK(countTree, sumTree, indexToValue, rightRank, finiteCount, finiteSum);
        const leftSum = sumOfSmallestK(countTree, sumTree, indexToValue, leftRankMinusOne, finiteCount, finiteSum);
        const value = (rightSum - leftSum) / (windowSize - (trim * 2));

        if (value < bestVal) {
            bestVal = value;
            bestIdx = i;
        }
    }

    return bestIdx >= 0 ? { value: bestVal, index: bestIdx } : { value: null, index: -1 };
}

function getRollingStatSummary(times, statType) {
    const config = getRollingStatConfig(statType);
    if (!config) return { current: null, value: null, index: -1 };
    if (times.length < config.windowSize) return { current: null, value: null, index: -1 };

    const current = config.getValue(times, times.length - 1);
    const cached = rollingStatSummaryCache.get(statType);

    if (cached && cached.timesRef === times && cached.lengthComputed === times.length) {
        return { current, value: cached.best, index: cached.bestIndex };
    }

    if (cached && cached.timesRef === times && cached.lengthComputed === (times.length - 1)) {
        const nextBest = (current != null && current !== Infinity && (cached.best == null || current < cached.best))
            ? current
            : cached.best;
        const nextBestIndex = (current != null && current !== Infinity && (cached.best == null || current < cached.best))
            ? (times.length - 1)
            : cached.bestIndex;

        rollingStatSummaryCache.set(statType, {
            timesRef: times,
            lengthComputed: times.length,
            best: nextBest,
            bestIndex: nextBestIndex,
        });
        return { current, value: nextBest, index: nextBestIndex };
    }

    const full = config.kind === 'mo'
        ? computeBestMeanWindow(times, config.windowSize)
        : computeBestAverageWindow(times, config.windowSize, config.trim);

    rollingStatSummaryCache.set(statType, {
        timesRef: times,
        lengthComputed: times.length,
        best: full.value,
        bestIndex: full.index,
    });

    return { current, value: full.value, index: full.index };
}

function findBestRollingStat(times, statType) {
    const summary = getRollingStatSummary(times, statType);
    return { value: summary.value, index: summary.index };
}

function renderSummaryStats(stats, solves) {
    const summaryEl = document.getElementById('stats-summary');
    const tbody = document.getElementById('stats-summary-body');
    const times = statsCache.getTimes();
    const configuredRows = getConfiguredSummaryStatTokens();
    const cacheSignature = [
        solves.length,
        solves[solves.length - 1]?.id || '',
        stats.current.time ?? 'none',
        configuredRows.join(','),
    ].join('|');

    let rows;
    if (summaryRowsCache.signature === cacheSignature) {
        rows = summaryRowsCache.rows;
    } else {
        rows = [
            { label: 'time', current: stats.current.time, best: stats.best.time, type: 'time' },
        ];

        configuredRows.forEach((statType) => {
            const config = getRollingStatConfig(statType);
            if (!config) return;
            if (times.length < config.windowSize) return;

            const summary = getRollingStatSummary(times, statType);
            const current = summary.current;
            const best = summary.value;
            rows.push({ label: statType, current, best, type: statType });
        });

        summaryRowsCache = { signature: cacheSignature, rows };
    }

    summaryEl?.classList.toggle('compact-summary-rows', rows.length > 5);

    tbody.innerHTML = rows.map(r => {
        const currentStr = r.current != null ? formatTime(r.current) : '-';
        const bestStr = r.best != null ? formatTime(r.best) : '-';
        const isBest = r.current != null && r.best != null && r.current === r.best && r.current !== Infinity;
        return `<tr>
      <td>${r.label}</td>
      <td class="${isBest ? 'best-value' : ''}" data-stat-type="${r.type}" data-stat-which="current">${currentStr}</td>
      <td data-stat-type="${r.type}" data-stat-which="best">${bestStr}</td>
    </tr>`;
    }).join('');

    // Session info
    const solveCount = stats.count;
    const validCount = solves.filter(s => s.penalty !== 'DNF').length;
    const meanStr = stats.sessionMean != null ? formatTime(stats.sessionMean) : '-';
    document.getElementById('solve-count').textContent = `solve: ${validCount}/${solveCount}`;
    document.getElementById('session-mean').textContent = `mean: ${meanStr}`;

    // Click handlers for summary stats
    tbody.querySelectorAll('td[data-stat-type]').forEach(td => {
        td.onclick = () => {
            const type = td.dataset.statType;
            const which = td.dataset.statWhich;
            handleStatClick(type, which, solves, stats);
        };
    });
}

function handleStatClick(type, which, solves, stats) {
    if (type === 'time') {
        // Show the single solve
        if (which === 'current' && solves.length > 0) {
            openStatDetailAtIndex(type, solves, stats, solves.length - 1);
        } else if (which === 'best') {
            const times = solves.map(s => getEffectiveTime(s));
            const bestTime = stats.best.time;
            const idx = times.indexOf(bestTime);
            if (idx >= 0) showSolveDetail(solves[idx], idx, true);
        }
        return;
    }

    const config = getRollingStatConfig(type);
    if (!config) return;

    if (which === 'current' && solves.length >= config.windowSize) {
        openStatDetailAtIndex(type, solves, stats, solves.length - 1);
    } else if (which === 'best') {
        const bestMatch = findBestRollingStat(statsCache.getTimes(), type);
        if (bestMatch.index >= 0) {
            openStatDetailAtIndex(type, solves, stats, bestMatch.index, { label: `Best ${type}` });
        }
    }
}

let _lastTableParams = null;
let _lastTableIndexFilterKey = '';

function getSolvesTableHeaderState(columnKey) {
    let label = columnKey;
    if (columnKey === 'search') {
        label = '<span class="icon-mask icon-mask-search" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></span>';
    }

    let sortIndicator = '';
    if (columnKey === currentSortCol) {
        sortIndicator = currentSortDir === 'asc' ? '▴' : '▾';
    }

    return { label, sortIndicator };
}

function ensureValidSolvesTableSort(configuredColumns) {
    if (!currentSortCol) return;
    if (currentSortCol === 'time') return;

    const allowed = new Set(configuredColumns.map((column) => column.type));
    if (allowed.has(currentSortCol)) return;

    currentSortCol = null;
    currentSortDir = null;
}

function syncSolvesTableHeader(configuredColumns) {
    const table = document.getElementById('solves-table');
    const headerRow = table?.querySelector('thead tr');
    if (!table || !headerRow) return;

    const statCount = configuredColumns.length;
    const isMobile = window.innerWidth <= 1100 || mobileViewportQuery.matches;
    const longestStatLabelLength = configuredColumns.reduce((max, column) => Math.max(max, column.label.length), 0);
    let indexWidth;
    let timeWidth;
    let statWidth = 0;
    let headerFontSize = isMobile ? '0.62rem' : 'var(--text-xs)';

    if (statCount === 0) {
        indexWidth = isMobile ? 14 : 18;
        timeWidth = 100 - indexWidth;
    } else if (isMobile && statCount === 2) {
        indexWidth = 18;
        timeWidth = 22;
        statWidth = 30;
        if (longestStatLabelLength >= 7) {
            headerFontSize = '0.54rem';
        } else if (longestStatLabelLength >= 6) {
            headerFontSize = '0.58rem';
        }
    } else {
        const indexWeight = isMobile ? 1 : 2;
        const statWeight = longestStatLabelLength >= 7
            ? (isMobile ? 3.45 : 3.25)
            : longestStatLabelLength >= 6
                ? (isMobile ? 3.2 : 3.1)
                : 3;
        const timeWeight = longestStatLabelLength >= 7
            ? (isMobile ? 2.55 : 2.75)
            : longestStatLabelLength >= 6
                ? (isMobile ? 2.8 : 2.9)
                : 3;
        const totalWeight = indexWeight + timeWeight + (statCount * statWeight);
        indexWidth = (indexWeight / totalWeight) * 100;
        timeWidth = (timeWeight / totalWeight) * 100;
        statWidth = (statWeight / totalWeight) * 100;
        if (longestStatLabelLength >= 7) {
            headerFontSize = isMobile ? '0.54rem' : '0.68rem';
        } else if (longestStatLabelLength >= 6) {
            headerFontSize = isMobile ? '0.58rem' : '0.72rem';
        }
    }

    table.style.setProperty('--solves-table-index-width', `${indexWidth.toFixed(3)}%`);
    table.style.setProperty('--solves-table-time-width', `${timeWidth.toFixed(3)}%`);
    table.style.setProperty('--solves-table-stat-width', `${statWidth.toFixed(3)}%`);
    table.style.setProperty('--solves-table-header-font-size', headerFontSize);

    const renderHeaderCell = (columnKey, extraAttributes = '') => {
        const { label, sortIndicator } = getSolvesTableHeaderState(columnKey);
        const activeClass = columnKey === 'search' && isSearchActive ? 'search-mode-active' : '';
        return `<th data-sort="${columnKey}" class="${activeClass}" ${extraAttributes} style="cursor: pointer;">
            <span class="solves-table-header-content">
                <span class="solves-table-header-label">${label}</span>
                <span class="solves-table-header-sort" aria-hidden="true">${sortIndicator}</span>
            </span>
        </th>`;
    };

    headerRow.innerHTML = [
        renderHeaderCell('search'),
        renderHeaderCell('time'),
        ...configuredColumns.map((column) => renderHeaderCell(column.type, 'data-stat-column="true"')),
    ].join('');
}

function getVisibleSolveViewportInfo(indices, tbody) {
    if (!Array.isArray(indices) || indices.length === 0 || !tbody) return null;

    const scrollTop = tbody.scrollTop;
    const viewportHeight = tbody.clientHeight;
    const topVisibleRow = Math.max(0, Math.floor(scrollTop / TABLE_ROW_HEIGHT));
    const rowOffset = scrollTop - (topVisibleRow * TABLE_ROW_HEIGHT);
    const visibleRows = Math.ceil(viewportHeight / TABLE_ROW_HEIGHT) + 1;
    const endRow = Math.min(indices.length, topVisibleRow + visibleRows);

    if (endRow <= topVisibleRow) return null;

    let minDisplayIndex = Number.POSITIVE_INFINITY;
    let maxDisplayIndex = Number.NEGATIVE_INFINITY;
    const visibleDisplayIndices = [];

    for (let row = topVisibleRow; row < endRow; row += 1) {
        const displayIndex = indices[row] + 1;
        visibleDisplayIndices.push(displayIndex);
        if (displayIndex < minDisplayIndex) minDisplayIndex = displayIndex;
        if (displayIndex > maxDisplayIndex) maxDisplayIndex = displayIndex;
    }

    if (!Number.isFinite(minDisplayIndex) || !Number.isFinite(maxDisplayIndex)) return null;

    return {
        min: minDisplayIndex,
        max: maxDisplayIndex,
        anchorRowOffset: rowOffset,
        visibleDisplayIndices,
    };
}

function getSolveDisplayRange(indices) {
    if (!Array.isArray(indices) || indices.length === 0) return null;

    let minDisplayIndex = Number.POSITIVE_INFINITY;
    let maxDisplayIndex = Number.NEGATIVE_INFINITY;

    for (const index of indices) {
        const displayIndex = index + 1;
        if (displayIndex < minDisplayIndex) minDisplayIndex = displayIndex;
        if (displayIndex > maxDisplayIndex) maxDisplayIndex = displayIndex;
    }

    if (!Number.isFinite(minDisplayIndex) || !Number.isFinite(maxDisplayIndex)) return null;

    return {
        min: minDisplayIndex,
        max: maxDisplayIndex,
    };
}

function getIndexFilterViewportKey() {
    return JSON.stringify({
        sessionId: sessionManager.getActiveSessionId(),
        searchActive: isSearchActive,
        indexMin: searchFilters.indexMin,
        indexMax: searchFilters.indexMax,
    });
}

function resolveIndexFilterViewportAdjustment(previousViewportInfo, previousIndexFilterKey, nextIndexFilterKey, nextIndices) {
    if (previousIndexFilterKey === nextIndexFilterKey) {
        return { jump: null, scrollTop: null };
    }

    const nextDisplayRange = getSolveDisplayRange(nextIndices);
    if (!previousViewportInfo || !nextDisplayRange) {
        return { jump: null, scrollTop: null };
    }

    if (nextDisplayRange.min > previousViewportInfo.max) {
        return { jump: 'bottom', scrollTop: null };
    }

    if (nextDisplayRange.max < previousViewportInfo.min) {
        return { jump: 'top', scrollTop: null };
    }

    const nextDisplayIndexSet = new Set(nextIndices.map((index) => index + 1));
    const retainedViewportIndex = previousViewportInfo.visibleDisplayIndices.findIndex((displayIndex) =>
        nextDisplayIndexSet.has(displayIndex),
    );

    if (retainedViewportIndex === -1) {
        return { jump: null, scrollTop: null };
    }

    const retainedDisplayIndex = previousViewportInfo.visibleDisplayIndices[retainedViewportIndex];
    const anchorRowIndex = nextIndices.findIndex((index) => (index + 1) === retainedDisplayIndex);
    if (anchorRowIndex === -1) {
        return { jump: null, scrollTop: null };
    }

    const retainedOffset = previousViewportInfo.anchorRowOffset + (retainedViewportIndex * TABLE_ROW_HEIGHT);
    return {
        jump: null,
        scrollTop: Math.max(0, (anchorRowIndex * TABLE_ROW_HEIGHT) - retainedOffset),
    };
}

// ──── Solves Table ────
function renderSolvesTable(solves, stats) {
    if (solves && stats) {
        _lastTableParams = { solves, stats };
    } else if (_lastTableParams) {
        solves = _lastTableParams.solves;
        stats = _lastTableParams.stats;
    } else {
        return;
    }

    const tbody = document.getElementById('solves-tbody');
    const shouldResetViewportToTop = _pendingSolvesTableViewportReset;
    _pendingSolvesTableViewportReset = false;
    const previousViewportInfo = shouldResetViewportToTop
        ? null
        : getVisibleSolveViewportInfo(_tableSortedIndices, tbody);
    const previousIndexFilterKey = shouldResetViewportToTop ? '' : _lastTableIndexFilterKey;
    const configuredColumns = getConfiguredSolvesTableStatTokens();
    const visibleColumnCount = 2 + configuredColumns.length;
    ensureValidSolvesTableSort(configuredColumns);
    syncSolvesTableHeader(configuredColumns);

    const rollingStatValues = new Map();
    const rollingStatBestFlags = new Map();
    configuredColumns.forEach(({ type }) => {
        rollingStatValues.set(type, statsCache.getRollingStatValues(type));
        rollingStatBestFlags.set(type, statsCache.getRollingStatNewBestFlags(type));
    });

    // Build sorted index order
    let indices = [];
    if (isSearchActive) {
        indices = getSearchMatchedSolveIndices(solves);
    } else {
        indices = solves.map((_, i) => i);
    }

    if (currentSortCol) {
        indices.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'time') {
                valA = getEffectiveTime(solves[a]);
                valB = getEffectiveTime(solves[b]);
            } else {
                const sortValues = rollingStatValues.get(currentSortCol) || statsCache.getRollingStatValues(currentSortCol);
                valA = sortValues[a];
                valB = sortValues[b];
                valA = valA != null ? valA : Infinity;
                valB = valB != null ? valB : Infinity;
            }

            if (valA === valB) {
                return currentSortDir === 'asc' ? b - a : a - b;
            }
            if (valA === Infinity && valB !== Infinity) return 1;
            if (valB === Infinity && valA !== Infinity) return -1;
            if (currentSortDir === 'asc') return valA - valB;
            return valB - valA;
        });
    } else {
        indices.reverse(); // Default: newest first
    }

    // Cache for virtualized rendering
    _tableSortedIndices = indices;
    _tableSolves = solves;
    
    updateSearchBulkActionUI();

    // ── Virtual scroll: only render visible rows ──
    const totalRows = indices.length;
    const totalHeight = totalRows * TABLE_ROW_HEIGHT;
    const indexFilterKey = getIndexFilterViewportKey();
    const { jump: pendingViewportJump, scrollTop: pendingScrollTop } = shouldResetViewportToTop
        ? { jump: 'top', scrollTop: null }
        : resolveIndexFilterViewportAdjustment(
            previousViewportInfo,
            previousIndexFilterKey,
            indexFilterKey,
            indices,
        );
    _lastTableIndexFilterKey = indexFilterKey;

    // Remove old scroll listener
    if (_tableScrollHandler) {
        tbody.removeEventListener('scroll', _tableScrollHandler);
    }

    function renderVisibleRows() {
        const scrollTop = tbody.scrollTop;
        const viewportHeight = tbody.clientHeight;
        const visibleRows = Math.ceil(viewportHeight / TABLE_ROW_HEIGHT) + 15;
        const maxStartRow = Math.max(0, totalRows - visibleRows);
        const startRow = Math.min(
            maxStartRow,
            Math.max(0, Math.floor(scrollTop / TABLE_ROW_HEIGHT) - 5),
        );
        const endRow = Math.min(totalRows, startRow + visibleRows);

        const topPad = startRow * TABLE_ROW_HEIGHT;
        const bottomPad = Math.max(0, (totalRows - endRow) * TABLE_ROW_HEIGHT);

        let html = '';
        if (topPad > 0) {
            html += `<tr style="height:${topPad}px"><td colspan="${visibleColumnCount}"></td></tr>`;
        }

        const isMobile = window.innerWidth <= 1100 || mobileViewportQuery.matches;
        for (let row = startRow; row < endRow; row++) {
            const i = _tableSortedIndices[row];
            const solve = solves[i];
            const timeStr = isMobile ? formatSolveTime(solve) : truncateTimeDisplay(formatSolveTime(solve), 7);

            const isBestTime = statsCache.isNewBestAt(i);
            const statCells = configuredColumns.map(({ type }) => {
                const value = rollingStatValues.get(type)?.[i] ?? null;
                const isBestStat = !!rollingStatBestFlags.get(type)?.[i];
                const display = value != null
                    ? (isMobile ? formatTime(value) : truncateTimeDisplay(formatTime(value), 7))
                    : '';
                return `<td class="rolling-stat-cell ${isBestStat ? 'new-best-cell' : ''}" data-stat-type="${type}">${display}</td>`;
            }).join('');

            let indicator = '';
            if (solve.comment) indicator += '*';

            const selectedClass = selectedSolveIds.has(solve.id) ? 'selected-solve' : '';

            html += `<tr data-solve-id="${solve.id}" data-solve-index="${i}" class="${selectedClass}">
      <td class="solve-index-td"><span class="solve-index-content">
          <input type="checkbox" class="solve-index-checkbox" ${selectedClass ? 'checked' : ''} aria-hidden="true" tabindex="-1">
          <span class="solve-index-number">${i + 1}${indicator ? `<span class="solve-index-indicator">${indicator}</span>` : ''}</span>
      </span></td>
      <td class="solve-time-cell ${solve.penalty === 'DNF' ? 'dnf-time' : ''} ${isBestTime ? 'new-best-cell' : ''}">
        ${timeStr}
      </td>
      ${statCells}
    </tr>`;
        }

        if (bottomPad > 0) {
            html += `<tr style="height:${bottomPad}px"><td colspan="${visibleColumnCount}"></td></tr>`;
        }

        tbody.innerHTML = html;
    }

    renderVisibleRows();

    if (pendingScrollTop != null) {
        tbody.scrollTop = pendingScrollTop;
        renderVisibleRows();
    } else if (pendingViewportJump === 'top') {
        tbody.scrollTop = 0;
        renderVisibleRows();
    } else if (pendingViewportJump === 'bottom') {
        tbody.scrollTop = totalHeight;
        renderVisibleRows();
    }

    // Scroll handler with rAF debounce
    let rafPending = false;
    _tableScrollHandler = () => {
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
                renderVisibleRows();
                rafPending = false;
            });
        }
    };
    tbody.addEventListener('scroll', _tableScrollHandler, { passive: true });

    // Click delegation on tbody for all cell types
    tbody.onclick = (e) => {
        const td = e.target.closest('td');
        if (!td) return;
        const tr = td.closest('tr');
        if (!tr || !tr.dataset.solveIndex) return;
        const idx = parseInt(tr.dataset.solveIndex);
        const solveId = tr.dataset.solveId;
        const isIndexSelectionClick = td.classList.contains('solve-index-td') || Boolean(e.target.closest('.solve-index-content'));
        const shouldSelectSolve = isIndexSelectionClick || e.shiftKey;

        if (shouldSelectSolve) {
            if (!isSearchActive) openSearchMenuForSelection();

            if (e.shiftKey && selectionAnchorSolveIndex !== -1) {
                const anchorVisualIndex = _tableSortedIndices.indexOf(selectionAnchorSolveIndex);
                const currVisualIndex = _tableSortedIndices.indexOf(idx);
                if (anchorVisualIndex !== -1 && currVisualIndex !== -1) {
                    activeRangeSelectedSolveIds.forEach((id) => selectedSolveIds.delete(id));
                    activeRangeSelectedSolveIds.clear();

                    const start = Math.min(anchorVisualIndex, currVisualIndex);
                    const end = Math.max(anchorVisualIndex, currVisualIndex);
                    for (let i = start; i <= end; i++) {
                        const rowIdx = _tableSortedIndices[i];
                        const rangeSolveId = solves[rowIdx].id;
                        selectedSolveIds.add(rangeSolveId);
                        activeRangeSelectedSolveIds.add(rangeSolveId);
                    }
                    lastSelectedSolveIndex = idx;
                    lastSelectedSolveId = solveId;
                }
            } else {
                activeRangeSelectedSolveIds.clear();
                if (selectedSolveIds.has(solveId)) {
                    selectedSolveIds.delete(solveId);
                } else {
                    selectedSolveIds.add(solveId);
                }
                lastSelectedSolveIndex = idx;
                lastSelectedSolveId = selectedSolveIds.has(solveId) ? solveId : null;
                selectionAnchorSolveIndex = selectedSolveIds.has(solveId) ? idx : -1;
                selectionAnchorSolveId = selectedSolveIds.has(solveId) ? solveId : null;
            }
            updateSearchBulkActionUI();
            
            // Re-render
            const tbodyInstance = document.getElementById('solves-tbody');
            const scrollBefore = tbodyInstance.scrollTop;
            renderVisibleRows();
            tbodyInstance.scrollTop = scrollBefore;
            return;
        }

        if (td.classList.contains('solve-time-cell')) {
            openStatDetailAtIndex('time', solves, stats, idx);
        } else if (td.dataset.statType) {
            openStatDetailAtIndex(td.dataset.statType, solves, stats, idx);
        }
    };
}

// ──── Session Controls ────
function initSessionControls() {
    getSessionSelects().forEach((select) => {
        select.onchange = async (e) => {
            await sessionManager.setActiveSession(e.target.value);
        };
    });

    document.getElementById('btn-new-session').onclick = async () => {
        await sessionManager.createSession();
        refreshSessionList();
    };

    document.getElementById('btn-rename-session').onclick = async () => {
        const session = sessionManager.getActiveSession();
        const name = await customPrompt('', session.name, 50, 'Session name', 'Enter session name...');
        if (name && name.trim()) {
            await sessionManager.renameSession(session.id, name.trim());
            refreshSessionList();
        }
    };

    document.getElementById('btn-delete-session').onclick = async () => {
        if (await customConfirm('Delete this session and all its solves?')) {
            await sessionManager.deleteSession(sessionManager.getActiveSessionId());
            refreshSessionList();
        }
    };
}

function refreshSessionList() {
    const sessions = sessionManager.getSessions();
    const activeId = sessionManager.getActiveSessionId();
    const optionsMarkup = sessions.map(s =>
        `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>${s.name} (${s.solveCount})</option>`
    ).join('');

    getSessionSelects().forEach((select) => {
        select.innerHTML = optionsMarkup;
        select.value = activeId;
    });

    syncCustomSelectMenu('session-select');
    syncCustomSelectMenu('mobile-session-select');
    syncSearchBulkMoveOptions();
}

function onSessionChanged() {
    _pendingSolvesTableViewportReset = true;
    refreshSessionList();
    rebuildStatsCache();
    refreshUI();
    void syncScrambleTypeWithActiveSession({ loadScramble: true }).then((didChange) => {
        if (didChange) return;

        const scramble = getCurrentScramble();
        if (scramble) {
            renderScramblePreviewDisplays(scramble);
        }
    });
}

// ──── Filter Controls ────
function initFilterControls() {
    const filterSelect = document.getElementById('stats-filter-select');
    const customInput = document.getElementById('custom-filter-input');
    if (!filterSelect || !customInput) return;

    const syncCustomInputVisibility = ({ focus = false } = {}) => {
        const isCustom = filterSelect.value === 'custom';

        if (!isCustom && document.activeElement === customInput) {
            customInput.blur();
        }

        customInput.style.display = isCustom ? 'block' : 'none';
        customInput.hidden = !isCustom;
        customInput.disabled = !isCustom;
        customInput.setAttribute('aria-hidden', String(!isCustom));

        if (!isCustom || !focus) return;

        window.requestAnimationFrame(() => {
            if (filterSelect.value !== 'custom') return;
            customInput.focus({ preventScroll: true });
            if (typeof customInput.setSelectionRange === 'function') {
                const len = customInput.value.length;
                customInput.setSelectionRange(len, len);
            }
        });
    };

    const syncFilterControlsFromSettings = () => {
        const isEditingCustomInput = document.activeElement === customInput;
        const nextCustomFilterDuration = settings.get('customFilterDuration');
        filterSelect.value = settings.get('statsFilter');
        if (!isEditingCustomInput || customInput.value !== nextCustomFilterDuration) {
            customInput.value = nextCustomFilterDuration;
        }
        syncCustomInputVisibility();
        syncCustomSelectMenu('stats-filter-select');
    };

    const commitCustomFilterDuration = () => {
        const nextValue = customInput.value.trim();
        if (filterSelect.value !== 'custom') {
            filterSelect.value = 'custom';
            settings.set('statsFilter', 'custom');
        }
        settings.set('customFilterDuration', nextValue);
    };

    syncFilterControlsFromSettings();

    filterSelect.onchange = () => {
        settings.set('statsFilter', filterSelect.value);
        syncCustomInputVisibility({ focus: filterSelect.value === 'custom' });
    };

    customInput.addEventListener('input', commitCustomFilterDuration);
    customInput.addEventListener('blur', commitCustomFilterDuration);
    customInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitCustomFilterDuration();
            customInput.blur();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            customInput.value = settings.get('customFilterDuration');
            customInput.blur();
        }
    });

    settings.on('change', (key) => {
        if (key !== 'statsFilter' && key !== 'customFilterDuration') return;
        syncFilterControlsFromSettings();
    });
}

function syncSearchMenuVisibility({ focusInput = false } = {}) {
    const summaryEl = document.getElementById('stats-summary');
    const searchMenuEl = document.getElementById('stats-search-menu');
    const sessionInfoEl = document.getElementById('session-info');
    if (!summaryEl || !searchMenuEl || !sessionInfoEl) return;

    if (isSearchActive) {
        summaryEl.hidden = true;
        summaryEl.style.display = 'none';
        sessionInfoEl.hidden = true;
        sessionInfoEl.style.display = 'none';
        searchMenuEl.hidden = false;
        searchMenuEl.style.display = 'flex';
        syncSearchBulkMoveOptions();
        updateBulkActionProgressUI();
        updateSearchBulkActionUI();
        if (focusInput) {
            window.requestAnimationFrame(() => {
                document.getElementById('stats-search-input')?.focus();
            });
        }
    } else {
        summaryEl.hidden = false;
        summaryEl.style.display = '';
        sessionInfoEl.hidden = false;
        sessionInfoEl.style.display = '';
        searchMenuEl.hidden = true;
        searchMenuEl.style.display = 'none';
    }

    syncSolvesTableHeader(getConfiguredSolvesTableStatTokens());
}

function clearSearchFilters({ clearSelection = false } = {}) {
    const searchInput = document.getElementById('stats-search-input');
    const indexMin = document.getElementById('search-filter-index-min');
    const indexMax = document.getElementById('search-filter-index-max');
    const timeMin = document.getElementById('search-filter-time-min');
    const timeMax = document.getElementById('search-filter-time-max');

    if (searchInput) searchInput.value = '';
    if (indexMin) indexMin.value = '';
    if (indexMax) indexMax.value = '';
    if (timeMin) timeMin.value = '';
    if (timeMax) timeMax.value = '';

    searchFilters = {
        text: '',
        indexMin: '',
        indexMax: '',
        timeMin: '',
        timeMax: '',
    };

    if (!clearSelection) return;

    clearSelectedSolveState();
}

function clearSelectedSolveState() {
    selectedSolveIds.clear();
    lastSelectedSolveIndex = -1;
    lastSelectedSolveId = null;
    selectionAnchorSolveIndex = -1;
    selectionAnchorSolveId = null;
    activeRangeSelectedSolveIds.clear();
}

function openSearchMenuForSelection() {
    if (isSearchActive) return;
    clearSearchFilters();
    toggleSearchMenu(true);
}

function selectSolveIndices(indices, solves = _tableSolves || sessionManager.getFilteredSolves()) {
    clearSelectedSolveState();

    indices.forEach((index) => {
        const solveId = solves[index]?.id;
        if (solveId) selectedSolveIds.add(solveId);
    });

    if (indices.length === 0) return;

    const newestSelectedIndex = indices[0];
    const newestSelectedSolveId = solves[newestSelectedIndex]?.id || null;
    lastSelectedSolveIndex = newestSelectedIndex;
    lastSelectedSolveId = newestSelectedSolveId;
    selectionAnchorSolveIndex = newestSelectedIndex;
    selectionAnchorSolveId = newestSelectedSolveId;
}

function selectAllCurrentTableSolves() {
    if (bulkActionProgressState.active) return;

    if (!isSearchActive) {
        openSearchMenuForSelection();
    }

    const solves = Array.isArray(_tableSolves) ? _tableSolves : sessionManager.getFilteredSolves();
    const indices = Array.isArray(_tableSortedIndices) ? _tableSortedIndices : [];
    selectSolveIndices(indices, solves);
    updateSearchBulkActionUI();
    refreshUI();
}

function toggleSearchMenu(forceActive) {
    const nextActive = typeof forceActive === 'boolean' ? forceActive : !isSearchActive;
    if (bulkActionProgressState.active && !nextActive) {
        syncSearchMenuVisibility({ focusInput: isSearchActive });
        return;
    }
    if (isSearchActive === nextActive) {
        syncSearchMenuVisibility({ focusInput: nextActive });
        return;
    }

    isSearchActive = nextActive;

    if (!isSearchActive) {
        clearSelectedSolveState();
        currentSortCol = null;
        currentSortDir = null;
    }

    syncSearchMenuVisibility({ focusInput: isSearchActive });
    refreshUI();
}

function updateSearchBulkActionUI() {
    const countEl = document.getElementById('search-selected-count');
    const moveSelect = document.getElementById('search-bulk-move-select');
    const moveBtn = document.getElementById('btn-search-bulk-move');
    const deleteBtn = document.getElementById('btn-search-bulk-delete');
    const selectAllBtn = document.getElementById('btn-search-select-all');
    const clearFiltersBtn = document.getElementById('btn-search-clear-filters');
    const matchCount = Array.isArray(_tableSortedIndices) ? _tableSortedIndices.length : 0;
    const activeSessionId = sessionManager.getActiveSessionId();
    const hasMoveTargets = sessionManager.getSessions().some((session) => session.id !== activeSessionId);
    const bulkActionActive = bulkActionProgressState.active;
    
    if (countEl) {
        if (isSearchActive) {
            countEl.textContent = `${selectedSolveIds.size} selected, ${matchCount} matches`;
        } else {
            countEl.textContent = `${selectedSolveIds.size} selected`;
        }
    }
    
    const hasSelection = selectedSolveIds.size > 0;
    if (moveSelect instanceof HTMLSelectElement) {
        moveSelect.disabled = bulkActionActive || !hasSelection || !hasMoveTargets;
        syncCustomSelectMenu('search-bulk-move-select');
    }
    if (moveBtn) moveBtn.disabled = bulkActionActive || !hasSelection || !hasMoveTargets;
    if (deleteBtn) deleteBtn.disabled = bulkActionActive || !hasSelection;
    if (selectAllBtn) selectAllBtn.disabled = bulkActionActive;
    if (clearFiltersBtn) clearFiltersBtn.disabled = bulkActionActive;
}

function syncSearchBulkMoveOptions() {
    const moveSelect = document.getElementById('search-bulk-move-select');
    if (!(moveSelect instanceof HTMLSelectElement)) return;

    const activeId = sessionManager.getActiveSessionId();
    const sessions = sessionManager.getSessions().filter((session) => session.id !== activeId);
    const previousValue = moveSelect.value;

    moveSelect.innerHTML = '<option value="" hidden disabled>Move to...</option>';
    sessions.forEach((session) => {
        const opt = document.createElement('option');
        opt.value = session.id;
        opt.textContent = `${session.name} (${session.solveCount})`;
        moveSelect.appendChild(opt);
    });

    moveSelect.value = sessions.some((session) => session.id === previousValue) ? previousValue : '';
    syncCustomSelectMenu('search-bulk-move-select');
}

function initSearchMenu() {
    const searchInput = document.getElementById('stats-search-input');
    const indexMin = document.getElementById('search-filter-index-min');
    const indexMax = document.getElementById('search-filter-index-max');
    const timeMin = document.getElementById('search-filter-time-min');
    const timeMax = document.getElementById('search-filter-time-max');

    let debounceTimer;
    const triggerSearchUpdate = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchFilters = {
                text: searchInput?.value || '',
                indexMin: indexMin?.value || '',
                indexMax: indexMax?.value || '',
                timeMin: timeMin?.value || '',
                timeMax: timeMax?.value || ''
            };
            refreshUI();
        }, 150);
    };

    [searchInput, indexMin, indexMax, timeMin, timeMax].forEach(input => {
        if (!input) return;
        input.addEventListener('input', triggerSearchUpdate);
    });

    const selectAllBtn = document.getElementById('btn-search-select-all');
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            if (bulkActionProgressState.active) return;
            const solves = sessionManager.getFilteredSolves();
            const allMatchesSelected = _tableSortedIndices.length > 0
                && _tableSortedIndices.every((idx) => selectedSolveIds.has(solves[idx].id));
            if (allMatchesSelected) {
                _tableSortedIndices.forEach((idx) => {
                    selectedSolveIds.delete(solves[idx].id);
                });
                activeRangeSelectedSolveIds.clear();
                if (selectedSolveIds.size === 0) {
                    lastSelectedSolveIndex = -1;
                    lastSelectedSolveId = null;
                    selectionAnchorSolveIndex = -1;
                    selectionAnchorSolveId = null;
                }
            } else {
                _tableSortedIndices.forEach(idx => {
                    selectedSolveIds.add(solves[idx].id);
                });
                activeRangeSelectedSolveIds.clear();
                if (_tableSortedIndices.length > 0) {
                    const newestSelectedIndex = _tableSortedIndices[0];
                    lastSelectedSolveIndex = newestSelectedIndex;
                    lastSelectedSolveId = solves[newestSelectedIndex]?.id || null;
                    if (selectionAnchorSolveIndex === -1) {
                        selectionAnchorSolveIndex = newestSelectedIndex;
                        selectionAnchorSolveId = solves[newestSelectedIndex]?.id || null;
                    }
                }
            }
            updateSearchBulkActionUI();
            _lastTableParams = null; // force re-render
            refreshUI();
        };
    }

    const clearFiltersBtn = document.getElementById('btn-search-clear-filters');
    if (clearFiltersBtn) {
        clearFiltersBtn.onclick = () => {
            if (bulkActionProgressState.active) return;
            clearSearchFilters({ clearSelection: true });
            refreshUI();
        };
    }

    const deleteBtn = document.getElementById('btn-search-bulk-delete');
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            if (bulkActionProgressState.active || selectedSolveIds.size === 0) return;
            if (await customConfirm(`Delete ${selectedSolveIds.size} selected solves?`)) {
                const solveIds = Array.from(selectedSolveIds);
                setBulkActionProgressState({
                    visible: true,
                    active: true,
                    status: 'running',
                    action: 'delete',
                    phase: 'starting',
                    percent: 0,
                    selectedCount: solveIds.length,
                    completed: 0,
                    total: solveIds.length,
                    targetSessionName: '',
                });
                await waitForNextPaint();
                window._isBulkAction = true;

                try {
                    const deletedCount = await sessionManager.bulkDeleteSolves(solveIds, {
                        onProgress: (snapshot) => {
                            setBulkActionProgressState({
                                visible: true,
                                active: snapshot.phase !== 'complete',
                                status: snapshot.phase === 'complete' ? 'complete' : 'running',
                                action: snapshot.action,
                                phase: snapshot.phase,
                                percent: snapshot.percent,
                                selectedCount: snapshot.selectedCount,
                                completed: snapshot.completed,
                                total: snapshot.total,
                                targetSessionName: snapshot.targetSessionName || '',
                            });
                        },
                    });

                    setBulkActionProgressState({
                        visible: true,
                        active: false,
                        status: 'complete',
                        action: 'delete',
                        phase: 'complete',
                        percent: 100,
                        selectedCount: deletedCount,
                        completed: deletedCount,
                        total: deletedCount,
                        targetSessionName: '',
                    });
                } catch (error) {
                    setBulkActionProgressState({
                        visible: true,
                        active: false,
                        status: 'error',
                        action: 'delete',
                        phase: 'complete',
                        percent: 100,
                        selectedCount: solveIds.length,
                        completed: 0,
                        total: solveIds.length,
                        targetSessionName: '',
                    });
                    hideBulkActionProgress({ delayMs: 2200 });
                    console.error('Bulk delete failed:', error);
                    return;
                } finally {
                    window._isBulkAction = false;
                }

                selectedSolveIds.clear();
                lastSelectedSolveIndex = -1;
                lastSelectedSolveId = null;
                selectionAnchorSolveIndex = -1;
                selectionAnchorSolveId = null;
                activeRangeSelectedSolveIds.clear();
                updateSearchBulkActionUI();
                rebuildStatsCache();
                refreshUI();
                hideBulkActionProgress({ delayMs: 1200 });
            }
        };
    }
    
    // Bulk move setup
    const moveSelect = document.getElementById('search-bulk-move-select');
    
    if (moveSelect) {
        syncSearchBulkMoveOptions();

        moveSelect.onchange = async () => {
            const targetSessionId = moveSelect.value;
            if (bulkActionProgressState.active || !targetSessionId || selectedSolveIds.size === 0) return;
            moveSelect.value = ''; // Reset
            syncCustomSelectMenu('search-bulk-move-select');

            const solveIds = Array.from(selectedSolveIds);
            const targetSessionName = sessionManager.getSessions().find((session) => session.id === targetSessionId)?.name || '';
            setBulkActionProgressState({
                visible: true,
                active: true,
                status: 'running',
                action: 'move',
                phase: 'starting',
                percent: 0,
                selectedCount: solveIds.length,
                completed: 0,
                total: solveIds.length,
                targetSessionName,
            });
            await waitForNextPaint();
            window._isBulkAction = true;

            try {
                const movedCount = await sessionManager.bulkMoveSolves(solveIds, targetSessionId, {
                    onProgress: (snapshot) => {
                        setBulkActionProgressState({
                            visible: true,
                            active: snapshot.phase !== 'complete',
                            status: snapshot.phase === 'complete' ? 'complete' : 'running',
                            action: snapshot.action,
                            phase: snapshot.phase,
                            percent: snapshot.percent,
                            selectedCount: snapshot.selectedCount,
                            completed: snapshot.completed,
                            total: snapshot.total,
                            targetSessionName: snapshot.targetSessionName || targetSessionName,
                        });
                    },
                });

                setBulkActionProgressState({
                    visible: true,
                    active: false,
                    status: 'complete',
                    action: 'move',
                    phase: 'complete',
                    percent: 100,
                    selectedCount: movedCount,
                    completed: movedCount,
                    total: movedCount,
                    targetSessionName,
                });
            } catch (error) {
                setBulkActionProgressState({
                    visible: true,
                    active: false,
                    status: 'error',
                    action: 'move',
                    phase: 'complete',
                    percent: 100,
                    selectedCount: solveIds.length,
                    completed: 0,
                    total: solveIds.length,
                    targetSessionName,
                });
                hideBulkActionProgress({ delayMs: 2200 });
                console.error('Bulk move failed:', error);
                return;
            } finally {
                window._isBulkAction = false;
            }

            selectedSolveIds.clear();
            lastSelectedSolveIndex = -1;
            lastSelectedSolveId = null;
            selectionAnchorSolveIndex = -1;
            selectionAnchorSolveId = null;
            activeRangeSelectedSolveIds.clear();
            syncSearchBulkMoveOptions();
            updateSearchBulkActionUI();
            rebuildStatsCache();
            refreshUI();
            hideBulkActionProgress({ delayMs: 1200 });
        };
    }

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape' || !isSearchActive) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleSearchMenu(false);
    });
}

// ──── Settings Panel ────
function initSettingsPanel() {
    settingsOverlayEl = document.getElementById('settings-overlay');
    themeCustomizationOverlayEl = document.getElementById('theme-customization-overlay');
    const btn = document.getElementById('btn-settings');
    const themeCustomizationTitleEl = document.getElementById('theme-customization-title');
    const themeCustomizationSimpleSectionEl = document.getElementById('theme-customization-simple-section');
    const themeCustomizationSectionsEl = document.getElementById('theme-customization-sections');
    const themeCustomizationUndoBtn = document.getElementById('theme-customization-undo');
    const themeCustomizationRedoBtn = document.getElementById('theme-customization-redo');
    const themeCustomizationCloseBtn = document.getElementById('theme-customization-close');
    const themeCustomizationDockTopRightBtn = document.getElementById('theme-customization-dock-top-right');
    const themeCustomizationDockBottomLeftBtn = document.getElementById('theme-customization-dock-bottom-left');
    const themeModeSimpleBtn = document.getElementById('btn-theme-mode-simple');
    const themeModeFullBtn = document.getElementById('btn-theme-mode-full');
    const themeCopyDefaultBtn = document.getElementById('btn-theme-copy-default');
    const themeCopyOledBtn = document.getElementById('btn-theme-copy-oled');
    const themeExportFileBtn = document.getElementById('btn-theme-export-file');
    const themeExportTextBtn = document.getElementById('btn-theme-export-text');
    const themeImportFileBtn = document.getElementById('btn-theme-import-file');
    const themeImportTextBtn = document.getElementById('btn-theme-import-text');
    const themeBackgroundImageToggleBtn = document.getElementById('theme-background-image-toggle');
    const themeBackgroundImageModeSelect = document.getElementById('theme-background-image-mode');
    const themeBackgroundImageLinkRow = document.getElementById('theme-background-image-link-row');
    const themeBackgroundImageUploadRow = document.getElementById('theme-background-image-upload-row');
    const themeBackgroundImageUrlInput = document.getElementById('theme-background-image-url');
    const themeBackgroundImageStatusEl = document.getElementById('theme-background-image-status');
    const themeBackgroundImageUploadBtn = document.getElementById('btn-theme-background-upload');
    const themeBackgroundImageClearUploadBtn = document.getElementById('btn-theme-background-clear-upload');
    const themeBackgroundImageOverlayRow = document.getElementById('theme-background-image-overlay-row');
    const themeBackgroundOverlayColorInput = document.getElementById('theme-background-overlay-color');
    const themeBackgroundOverlayAlphaInput = document.getElementById('theme-background-overlay-alpha');
    const themeBackgroundOverlayAlphaValue = document.getElementById('theme-background-overlay-alpha-value');
    const themeBackgroundOverlayValue = document.getElementById('theme-background-overlay-value');
    const themeBackgroundOverlayResetBtn = document.getElementById('btn-theme-background-overlay-reset');
    const themeColorControls = new Map();
    const simpleThemeColorControls = new Map();
    const themeColorKeys = THEME_COLOR_SECTIONS.flatMap((section) => section.items.map(({ key }) => key));
    const THEME_UNDO_LIMIT = 50;
    const THEME_EDIT_COMMIT_DELAY_MS = 220;
    const THEME_LIVE_EDIT_DEBOUNCE_MS = 42;
    const USER_ASSET_CACHE_NAME = 'ukratimer-user-assets-v1';
    const THEME_BACKGROUND_UPLOAD_PATH_PREFIX = './cached-assets/theme-background-upload-';
    let themeUndoThemeId = null;
    let themeUndoStack = [];
    let themeRedoStack = [];
    let themeEditTransaction = null;
    let themeEditCommitTimer = 0;
    let isApplyingThemeUndo = false;
    let themeBackgroundImageModeOverride = '';
    let hasCachedBackgroundUpload = false;
    let liveBackgroundUploadPreviewUrl = '';
    let liveBackgroundUploadPreviewThemeId = '';
    const themeColorDebounceTimers = new Map();
    const simpleThemeColorDebounceTimers = new Map();
    let themeBackgroundOverlayDebounceTimer = 0;
    let themeCustomizationColorMode = settings.get('themeCustomizationMode') === THEME_EDITOR_MODE_FULL
        ? THEME_EDITOR_MODE_FULL
        : THEME_EDITOR_MODE_SIMPLE;
    const THEME_DOCK_TOP_RIGHT = 'top-right';
    const THEME_DOCK_BOTTOM_LEFT = 'bottom-left';
    const getThemeCustomizationHistoryState = (themeId = settings.get('theme')) => {
        if (!isCustomThemeId(themeId)) {
            return { canUndo: false, canRedo: false };
        }

        const canUndoCurrentEdit = Boolean(
            themeEditTransaction
            && themeEditTransaction.themeId === themeId
            && !themeSnapshotsMatch(themeEditTransaction.beforeSnapshot, cloneThemeSnapshot(themeId))
        );

        return {
            canUndo: canUndoCurrentEdit || (themeUndoThemeId === themeId && themeUndoStack.length > 0),
            canRedo: themeUndoThemeId === themeId && themeRedoStack.length > 0,
        };
    };
    const syncThemeCustomizationHistoryButtons = (themeId = settings.get('theme')) => {
        const { canUndo, canRedo } = getThemeCustomizationHistoryState(themeId);

        if (themeCustomizationUndoBtn) {
            themeCustomizationUndoBtn.disabled = !canUndo;
        }
        if (themeCustomizationRedoBtn) {
            themeCustomizationRedoBtn.disabled = !canRedo;
        }
    };
    const canDockThemeCustomization = () => true;
    const canShowThemeDockButtons = () => true;
    const syncThemeCustomizationDockButtons = () => {
        const currentPosition = getThemeCustomizationDockPosition();
        const shouldShow = canShowThemeDockButtons();
        [
            [themeCustomizationDockTopRightBtn, THEME_DOCK_TOP_RIGHT],
            [themeCustomizationDockBottomLeftBtn, THEME_DOCK_BOTTOM_LEFT],
        ].forEach(([button, position]) => {
            if (!button) return;
            button.hidden = !shouldShow;
            const isActive = currentPosition === position;
            button.classList.toggle('active-toggle', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };
    const setThemeCustomizationDockPosition = (position = '') => {
        const nextPosition = (position === THEME_DOCK_TOP_RIGHT || position === THEME_DOCK_BOTTOM_LEFT)
            && canDockThemeCustomization()
            && isThemeCustomizationOpen()
            ? position
            : '';
        const nextDocked = Boolean(nextPosition);
        themeCustomizationOverlayEl?.classList.toggle('theme-customization-overlay-docked', nextDocked);
        themeCustomizationOverlayEl?.classList.toggle(
            'theme-customization-overlay-docked-bottom-left',
            nextPosition === THEME_DOCK_BOTTOM_LEFT,
        );
        settingsOverlayEl?.classList.toggle('theme-customization-host-docked', nextDocked);
        document.body.classList.toggle('theme-customization-docked', nextDocked);
        syncThemeCustomizationDockButtons();
    };
    btn.onclick = () => {
        if (isThemeCustomizationOpen() && isThemeCustomizationDocked()) {
            showSettingsPanelAlongsideThemeCustomization();
            btn.blur();
            return;
        }
        openSettingsPanel();
        btn.blur();
    };
    document.getElementById('btn-show-shortcuts').onclick = () => {
        openKeyboardShortcutsOverlay({ closeSettings: true, isSwitching: true });
    };
    document.getElementById('settings-close').onclick = closeSettingsPanel;
    let _settingsMouseDownTarget = null;
    let _settingsMouseUpTarget = null;
    settingsOverlayEl.addEventListener('mousedown', (e) => {
        _settingsMouseDownTarget = e.target;
    });
    settingsOverlayEl.addEventListener('mouseup', (e) => {
        _settingsMouseUpTarget = e.target;
    });
    settingsOverlayEl.addEventListener('click', (e) => {
        if (_settingsMouseDownTarget === settingsOverlayEl && _settingsMouseUpTarget === settingsOverlayEl) closeSettingsPanel();
        _settingsMouseDownTarget = null;
        _settingsMouseUpTarget = null;
    });
    themeCustomizationCloseBtn?.addEventListener('click', () => {
        if (isThemeCustomizationDocked()) {
            const settingsVisibleAlongsideTheme = Boolean(
                settingsOverlayEl?.classList.contains('active')
                && !settingsOverlayEl.classList.contains('theme-customization-host-docked')
            );
            if (settingsVisibleAlongsideTheme) {
                closeThemeCustomizationModal();
                return;
            }
            closeThemeCustomizationModal();
            if (window.history.state?.isBackIntercepted) {
                backToDismiss();
            }
            return;
        }
        closeThemeCustomizationModal();
    });
    themeCustomizationDockTopRightBtn?.addEventListener('click', async () => {
        const nextPosition = getThemeCustomizationDockPosition() === THEME_DOCK_TOP_RIGHT ? '' : THEME_DOCK_TOP_RIGHT;
        setThemeCustomizationDockPosition(nextPosition);
        themeCustomizationDockTopRightBtn.blur();
    });
    themeCustomizationDockBottomLeftBtn?.addEventListener('click', async () => {
        const nextPosition = getThemeCustomizationDockPosition() === THEME_DOCK_BOTTOM_LEFT ? '' : THEME_DOCK_BOTTOM_LEFT;
        setThemeCustomizationDockPosition(nextPosition);
        themeCustomizationDockBottomLeftBtn.blur();
    });
    let _themeMouseDownTarget = null;
    let _themeMouseUpTarget = null;
    themeCustomizationOverlayEl?.addEventListener('mousedown', (e) => {
        _themeMouseDownTarget = e.target;
    });
    themeCustomizationOverlayEl?.addEventListener('mouseup', (e) => {
        _themeMouseUpTarget = e.target;
    });
    themeCustomizationOverlayEl?.addEventListener('click', (e) => {
        if (_themeMouseDownTarget === themeCustomizationOverlayEl && _themeMouseUpTarget === themeCustomizationOverlayEl && !isThemeCustomizationDocked()) {
            closeThemeCustomizationModal();
        }
        _themeMouseDownTarget = null;
        _themeMouseUpTarget = null;
    });
    window.addEventListener('resize', () => {
        if (isThemeCustomizationDocked() && !canDockThemeCustomization()) {
            setThemeCustomizationDockPosition('');
            return;
        }
        syncThemeCustomizationDockButtons();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (document.getElementById('prompt-overlay')?.classList.contains('active')) {
            return;
        }

        const normalizedKey = String(e.key).toLowerCase();
        const isUndoShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && normalizedKey === 'z';
        const isRedoShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && normalizedKey === 'z';
        const activeElement = document.activeElement;
        const activeTag = activeElement?.tagName?.toLowerCase();
        const activeInputType = activeElement instanceof HTMLInputElement ? activeElement.type : '';
        const themeCustomizationHasFocus = Boolean(
            themeCustomizationOverlayEl
            && (
                (e.target instanceof Node && themeCustomizationOverlayEl.contains(e.target))
                || (activeElement instanceof Node && themeCustomizationOverlayEl.contains(activeElement))
            )
        );
        const allowNativeTextUndo = activeTag === 'textarea'
            || (activeTag === 'input' && !['color', 'range', 'button', 'submit', 'checkbox'].includes(activeInputType));

        if (isUndoShortcut && isThemeCustomizationOpen() && !allowNativeTextUndo) {
            if (undoThemeCustomizationChange()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }

        if (isRedoShortcut && isThemeCustomizationOpen() && !allowNativeTextUndo) {
            if (redoThemeCustomizationChange()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }

        if (e.code === 'Escape' && (settingsOverlayEl.classList.contains('active') || isThemeCustomizationOpen())) {
            if (isSettingsPanelBlocking()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                closeSettingsPanel();
                return;
            }
            if (isThemeCustomizationOpen() && isThemeCustomizationDocked()) {
                if (themeCustomizationHasFocus) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isThemeCustomizationOpen()) {
                closeThemeCustomizationModal();
                return;
            }
            closeSettingsPanel();
        }
    });

    // WCA inspection toggle
    const inspectionTimeToggle = document.getElementById('setting-inspection-time');
    inspectionTimeToggle.checked = settings.get('inspectionTime') === '15s';
    inspectionTimeToggle.onchange = () => {
        settings.set('inspectionTime', inspectionTimeToggle.checked ? '15s' : 'off');
        inspectionTimeToggle.blur();
    };

    const inspectionAlertsSelect = document.getElementById('setting-inspection-alerts');
    inspectionAlertsSelect.value = settings.get('inspectionAlerts');
    inspectionAlertsSelect.onchange = () => {
        settings.set('inspectionAlerts', inspectionAlertsSelect.value);
        inspectionAlertsSelect.blur();
    };

    const timerUpdateSelect = document.getElementById('setting-timer-update');
    timerUpdateSelect.value = settings.get('timerUpdate');
    timerUpdateSelect.onchange = () => {
        settings.set('timerUpdate', timerUpdateSelect.value);
        timerUpdateSelect.blur();
    };

    const timeEntryModeSelect = document.getElementById('setting-time-entry-mode');
    if (timeEntryModeSelect) {
        timeEntryModeSelect.value = settings.get('timeEntryMode');
        timeEntryModeSelect.onchange = () => {
            settings.set('timeEntryMode', timeEntryModeSelect.value);
            timeEntryModeSelect.blur();
        };
    }

    // Animations mode
    const animSelect = document.getElementById('setting-animations');
    if (animSelect) {
        animSelect.value = settings.get('animationMode');
        if (!animSelect.value) {
            animSelect.value = DEFAULTS.animationMode;
        }
        animSelect.onchange = () => {
            settings.set('animationMode', animSelect.value);
            animSelect.blur();
        };
    }

    const themeSelect = document.getElementById('setting-theme');
    const themeCustomizeRow = document.getElementById('setting-theme-customize-row');
    const customizeThemeBtn = document.getElementById('btn-customize-theme');
    const simpleModeSections = [
        ...SIMPLE_THEME_COLOR_SECTIONS,
        ...THEME_COLOR_SECTIONS.filter((section) => SIMPLE_THEME_SHARED_SECTION_IDS.has(section.id)),
    ];

    const renderThemeColorSections = (container, sections, controlMap, { includeAlpha = true } = {}) => {
        if (!container) return;

        const collapsedSections = settings.get('themeCustomizationCollapsedSections') || {};
        container.innerHTML = sections.map((section) => `
            <section
              class="theme-customization-section${collapsedSections[section.id] ? ' collapsed' : ''}"
              data-theme-section-id="${section.id}"
            >
              <button
                class="theme-customization-section-toggle"
                type="button"
                aria-expanded="${collapsedSections[section.id] ? 'false' : 'true'}"
                data-theme-section-toggle="${section.id}"
              >
                <span class="theme-customization-section-chevron" aria-hidden="true"></span>
                <span class="theme-customization-section-title">${section.title}</span>
              </button>
              <div class="theme-customization-section-content" data-theme-section-content="${section.id}">
                <div class="theme-customization-grid">
                ${section.items.filter((item) => !item.hidden).map((item) => `
                  <div class="theme-color-card" data-theme-color-key="${item.key}">
                    <div class="theme-color-header">
                      <span class="theme-color-label">${item.label}</span>
                      <span class="theme-color-preview" data-theme-color-preview="${item.key}"></span>
                    </div>
                    <div class="theme-color-controls">
                      <input type="color" data-theme-color-input="${item.key}">
                      <button class="btn-action theme-color-reset" type="button" data-theme-color-reset="${item.key}">Reset</button>
                    </div>
                    ${includeAlpha ? `
                      <div class="theme-color-alpha">
                        <input type="range" min="0" max="100" step="1" value="100" data-theme-color-alpha="${item.key}">
                        <span class="theme-color-alpha-value" data-theme-color-alpha-value="${item.key}">100%</span>
                      </div>
                    ` : ''}
                    <div class="theme-color-value" data-theme-color-value="${item.key}"></div>
                  </div>
                `).join('')}
                </div>
              </div>
            </section>
        `).join('');

        attachThemeSectionToggleHandlers(container);

        container.querySelectorAll('[data-theme-color-key]').forEach((card) => {
            const key = card.getAttribute('data-theme-color-key');
            const colorInput = card.querySelector(`[data-theme-color-input="${key}"]`);
            const alphaInput = card.querySelector(`[data-theme-color-alpha="${key}"]`);
            const alphaValue = card.querySelector(`[data-theme-color-alpha-value="${key}"]`);
            const preview = card.querySelector(`[data-theme-color-preview="${key}"]`);
            const valueLabel = card.querySelector(`[data-theme-color-value="${key}"]`);
            const resetBtn = card.querySelector(`[data-theme-color-reset="${key}"]`);
            if (!key || !colorInput || !preview || !valueLabel) return;

            controlMap.set(key, { colorInput, alphaInput, alphaValue, preview, valueLabel, resetBtn });
        });
    };

    const attachThemeSectionToggleHandlers = (root) => {
        if (!root) return;

        root.querySelectorAll('[data-theme-section-toggle], #theme-background-image-toggle').forEach((toggleBtn) => {
            if (toggleBtn.dataset.toggleBound === 'true') return;
            toggleBtn.dataset.toggleBound = 'true';
            toggleBtn.addEventListener('click', () => {
                const sectionEl = toggleBtn.closest('.theme-customization-section');
                if (!sectionEl) return;
                const sectionId = sectionEl.dataset.themeSectionId || THEME_BACKGROUND_IMAGE_SECTION_ID;

                const isExpanded = toggleBtn.getAttribute('aria-expanded') !== 'false';
                const nextExpanded = !isExpanded;
                toggleBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
                sectionEl.classList.toggle('collapsed', !nextExpanded);
                settings.set('themeCustomizationCollapsedSections', {
                    ...settings.get('themeCustomizationCollapsedSections'),
                    [sectionId]: !nextExpanded,
                });
            });
        });
    };

    renderThemeColorSections(themeCustomizationSimpleSectionEl, simpleModeSections, simpleThemeColorControls);
    renderThemeColorSections(themeCustomizationSectionsEl, THEME_COLOR_SECTIONS, themeColorControls);
    attachThemeSectionToggleHandlers(themeBackgroundImageToggleBtn?.parentElement);
    const backgroundImageSectionCollapsed = Boolean(
        settings.get('themeCustomizationCollapsedSections')?.[THEME_BACKGROUND_IMAGE_SECTION_ID],
    );
    if (themeBackgroundImageToggleBtn) {
        themeBackgroundImageToggleBtn.setAttribute('aria-expanded', backgroundImageSectionCollapsed ? 'false' : 'true');
        themeBackgroundImageToggleBtn.closest('.theme-customization-section')?.classList.toggle('collapsed', backgroundImageSectionCollapsed);
    }

    const syncThemeCustomizationModeButtons = () => {
        [
            [themeModeSimpleBtn, THEME_EDITOR_MODE_SIMPLE],
            [themeModeFullBtn, THEME_EDITOR_MODE_FULL],
        ].forEach(([button, mode]) => {
            if (!button) return;
            const isActive = themeCustomizationColorMode === mode;
            button.classList.toggle('active-toggle', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    const syncThemeCustomizationModeUI = () => {
        if (themeCustomizationSimpleSectionEl) {
            themeCustomizationSimpleSectionEl.hidden = themeCustomizationColorMode !== THEME_EDITOR_MODE_SIMPLE;
            themeCustomizationSimpleSectionEl.style.display = themeCustomizationColorMode === THEME_EDITOR_MODE_SIMPLE ? '' : 'none';
        }
        if (themeCustomizationSectionsEl) {
            themeCustomizationSectionsEl.hidden = themeCustomizationColorMode !== THEME_EDITOR_MODE_FULL;
            themeCustomizationSectionsEl.style.display = themeCustomizationColorMode === THEME_EDITOR_MODE_FULL ? '' : 'none';
        }
        syncThemeCustomizationModeButtons();
    };

    const setThemeCustomizationColorMode = (mode) => {
        themeCustomizationColorMode = mode === THEME_EDITOR_MODE_FULL ? THEME_EDITOR_MODE_FULL : THEME_EDITOR_MODE_SIMPLE;
        settings.set('themeCustomizationMode', themeCustomizationColorMode);
        syncThemeCustomizationModeUI();
    };

    const getCustomThemeBaseId = (themeId = settings.get('theme')) => {
        if (!isCustomThemeId(themeId)) return THEME_DEFAULT_ID;
        const customThemeBases = settings.get('customThemeBases');
        return customThemeBases[themeId] === THEME_OLED_ID ? THEME_OLED_ID : THEME_DEFAULT_ID;
    };

    const normalizeBackgroundImageSource = (value) => (
        value === 'upload' || value === 'link' || value === 'none' ? value : 'none'
    );

    const normalizeThemeBackgroundSettings = (value) => {
        const url = typeof value?.url === 'string' ? value.url.trim() : '';
        const source = normalizeBackgroundImageSource(value?.source || (url ? 'link' : 'none'));
        return {
            source: source === 'link' && !url ? 'none' : source,
            url,
            overlayColor: decomposeThemeColor(value?.overlayColor, DEFAULTS.backgroundImageOverlayColor).css,
        };
    };

    const createDefaultThemeBackgroundSettings = () => ({
        source: 'none',
        url: '',
        overlayColor: DEFAULTS.backgroundImageOverlayColor,
    });

    const getThemeUploadCacheUrl = (themeId) => new URL(`${THEME_BACKGROUND_UPLOAD_PATH_PREFIX}${themeId}`, window.location.href).toString();

    const getThemeBackgroundSettings = (themeId = settings.get('theme')) => {
        if (!isCustomThemeId(themeId)) return createDefaultThemeBackgroundSettings();
        const customThemeBackgrounds = settings.get('customThemeBackgrounds');
        return normalizeThemeBackgroundSettings(customThemeBackgrounds[themeId]);
    };

    const getBackgroundImageSource = (themeId = settings.get('theme')) => getThemeBackgroundSettings(themeId).source;

    const getSavedBackgroundImageUrl = (themeId = settings.get('theme')) => getThemeBackgroundSettings(themeId).url;

    const getBackgroundImageOverlayColor = (themeId = settings.get('theme')) => getThemeBackgroundSettings(themeId).overlayColor;

    const hasAvailableBackgroundUpload = (themeId = settings.get('theme')) => (
        (liveBackgroundUploadPreviewThemeId === themeId && Boolean(liveBackgroundUploadPreviewUrl))
        || hasCachedBackgroundUpload
    );

    const openUserAssetCache = async () => {
        if (!('caches' in window)) return null;
        try {
            return await caches.open(USER_ASSET_CACHE_NAME);
        } catch (error) {
            console.warn('Could not open user asset cache:', error);
            return null;
        }
    };

    const refreshCachedBackgroundUploadState = async (themeId = settings.get('theme')) => {
        if (!isCustomThemeId(themeId)) {
            hasCachedBackgroundUpload = false;
            return false;
        }
        const cache = await openUserAssetCache();
        hasCachedBackgroundUpload = cache ? Boolean(await cache.match(getThemeUploadCacheUrl(themeId))) : false;
        return hasCachedBackgroundUpload;
    };

    const cacheUploadedBackgroundImage = async (themeId, file) => {
        const cache = await openUserAssetCache();
        if (!cache || !isCustomThemeId(themeId)) return false;

        const headers = new Headers();
        if (file.type) {
            headers.set('Content-Type', file.type);
        }
        await cache.put(getThemeUploadCacheUrl(themeId), new Response(file, { headers }));
        hasCachedBackgroundUpload = true;
        return true;
    };

    const clearLiveBackgroundUploadPreview = () => {
        if (!liveBackgroundUploadPreviewUrl) return;
        URL.revokeObjectURL(liveBackgroundUploadPreviewUrl);
        liveBackgroundUploadPreviewUrl = '';
        liveBackgroundUploadPreviewThemeId = '';
    };

    const clearCachedBackgroundUpload = async (themeId) => {
        if (liveBackgroundUploadPreviewThemeId === themeId) {
            clearLiveBackgroundUploadPreview();
        }
        const cache = await openUserAssetCache();
        if (!cache || !isCustomThemeId(themeId)) {
            hasCachedBackgroundUpload = false;
            return false;
        }

        await cache.delete(getThemeUploadCacheUrl(themeId));
        hasCachedBackgroundUpload = false;
        return true;
    };

    const restoreCachedBackgroundUploadPreview = async (themeId) => {
        const cache = await openUserAssetCache();
        if (!cache || !isCustomThemeId(themeId)) return false;

        const response = await cache.match(getThemeUploadCacheUrl(themeId));
        if (!response) return false;

        const blob = await response.blob();
        if (!blob || !blob.size) return false;

        if (liveBackgroundUploadPreviewThemeId === themeId && liveBackgroundUploadPreviewUrl) {
            return true;
        }

        clearLiveBackgroundUploadPreview();
        liveBackgroundUploadPreviewUrl = URL.createObjectURL(blob);
        liveBackgroundUploadPreviewThemeId = themeId;
        return true;
    };

    const cacheLinkedBackgroundImage = async (url) => {
        const cache = await openUserAssetCache();
        if (!cache) return false;

        const request = new Request(url, { mode: 'no-cors' });
        const response = await fetch(request);
        if (!response || (!response.ok && response.type !== 'opaque')) {
            throw new Error('background-image-fetch-failed');
        }

        await cache.put(request, response.clone());
        return true;
    };

    const getEffectiveBackgroundImageUrl = (themeId = settings.get('theme')) => {
        const source = getBackgroundImageSource(themeId);
        if (source === 'upload') {
            if (liveBackgroundUploadPreviewThemeId === themeId && liveBackgroundUploadPreviewUrl) {
                return liveBackgroundUploadPreviewUrl;
            }
            return getThemeUploadCacheUrl(themeId);
        }
        if (source === 'link') return getSavedBackgroundImageUrl(themeId);
        return '';
    };

    const applyBackgroundImage = () => {
        const effectiveUrl = getEffectiveBackgroundImageUrl();
        const overlayColor = getBackgroundImageOverlayColor();
        document.documentElement.style.setProperty(
            '--app-background-image',
            effectiveUrl ? `url(${JSON.stringify(effectiveUrl)})` : 'none',
        );
        document.documentElement.style.setProperty(
            '--app-background-overlay-layer',
            effectiveUrl ? `linear-gradient(${overlayColor}, ${overlayColor})` : 'none',
        );
    };

    const syncBackgroundImageOverlayUI = () => {
        const currentTheme = settings.get('theme');
        const shouldShow = Boolean(getEffectiveBackgroundImageUrl(currentTheme));
        const { hex, alpha, css } = decomposeThemeColor(
            getBackgroundImageOverlayColor(currentTheme),
            DEFAULTS.backgroundImageOverlayColor,
        );

        if (themeBackgroundImageOverlayRow) {
            themeBackgroundImageOverlayRow.style.display = shouldShow ? '' : 'none';
        }
        if (themeBackgroundOverlayColorInput) {
            themeBackgroundOverlayColorInput.value = hex;
        }
        if (themeBackgroundOverlayAlphaInput) {
            themeBackgroundOverlayAlphaInput.value = String(alpha);
        }
        if (themeBackgroundOverlayAlphaValue) {
            themeBackgroundOverlayAlphaValue.textContent = `${alpha}%`;
        }
        if (themeBackgroundOverlayValue) {
            themeBackgroundOverlayValue.textContent = css;
        }
        if (themeBackgroundOverlayResetBtn) {
            themeBackgroundOverlayResetBtn.disabled = css === DEFAULTS.backgroundImageOverlayColor;
        }
    };

    const syncThemeBackgroundImageUI = () => {
        if (!themeBackgroundImageModeSelect) return;

        const currentTheme = settings.get('theme');
        const savedUrl = getSavedBackgroundImageUrl(currentTheme);
        const source = getBackgroundImageSource(currentTheme);
        const hasUpload = hasAvailableBackgroundUpload(currentTheme);
        const mode = themeBackgroundImageModeOverride
            || (source === 'upload'
                ? 'upload'
                : source === 'link' && savedUrl
                    ? 'link'
                    : 'none');

        themeBackgroundImageModeSelect.value = mode;
        if (themeBackgroundImageLinkRow) {
            themeBackgroundImageLinkRow.style.display = mode === 'link' ? '' : 'none';
        }
        if (themeBackgroundImageUploadRow) {
            themeBackgroundImageUploadRow.style.display = mode === 'upload' ? '' : 'none';
        }
        if (themeBackgroundImageUrlInput) {
            themeBackgroundImageUrlInput.value = savedUrl;
        }
        syncBackgroundImageOverlayUI();
        if (themeBackgroundImageStatusEl) {
            themeBackgroundImageStatusEl.textContent = source === 'upload' && hasCachedBackgroundUpload
                ? 'Uploaded image is active.'
                : mode === 'upload' && hasUpload
                    ? 'Uploaded image is saved on this device.'
                    : mode === 'upload'
                        ? 'Choose an image.'
                        : source === 'link' && savedUrl
                            ? 'Linked image is active.'
                            : mode === 'link' && savedUrl
                                ? 'Image link is saved.'
                                : 'No custom background image is active.';
        }
    };

    const reconcileBackgroundImageState = async () => {
        const currentTheme = settings.get('theme');
        await refreshCachedBackgroundUploadState(currentTheme);

        const backgroundSettings = getThemeBackgroundSettings(currentTheme);
        if (backgroundSettings.source !== 'upload' || liveBackgroundUploadPreviewThemeId !== currentTheme) {
            clearLiveBackgroundUploadPreview();
        }
        if (!isCustomThemeId(currentTheme)) {
            applyBackgroundImage();
            syncThemeBackgroundImageUI();
            return;
        }

        if (backgroundSettings.source === 'upload' && !hasCachedBackgroundUpload) {
            const nextCustomThemeBackgrounds = settings.get('customThemeBackgrounds');
            nextCustomThemeBackgrounds[currentTheme] = {
                ...backgroundSettings,
                source: 'none',
            };
            settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
            return;
        }

        if (backgroundSettings.source === 'upload' && hasCachedBackgroundUpload) {
            await restoreCachedBackgroundUploadPreview(currentTheme);
        }

        if (backgroundSettings.source === 'link' && !backgroundSettings.url) {
            const nextCustomThemeBackgrounds = settings.get('customThemeBackgrounds');
            nextCustomThemeBackgrounds[currentTheme] = {
                ...backgroundSettings,
                source: 'none',
            };
            settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
            return;
        }

        applyBackgroundImage();
        syncThemeBackgroundImageUI();
    };

    const pickThemeImageFile = async () => {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Image files',
                    accept: {
                        'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'],
                    },
                }],
                multiple: false,
            });
            return handle.getFile();
        }

        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            document.body.appendChild(input);

            input.addEventListener('change', () => {
                const file = input.files?.[0];
                document.body.removeChild(input);
                if (!file) {
                    reject(new Error('no-file'));
                    return;
                }
                resolve(file);
            }, { once: true });

            input.addEventListener('cancel', () => {
                document.body.removeChild(input);
                reject(new Error('cancelled'));
            }, { once: true });

            input.click();
        });
    };

    const getSimpleThemeSeedColors = (themeColors = settings.getActiveThemeColors()) => (
        Object.fromEntries(SIMPLE_THEME_SEED_KEYS.map((key) => [key, themeColors[key]]))
    );

    const getMatchingSimpleThemePresetId = (seedColors) => {
        const normalizedSeedColors = JSON.stringify(seedColors);
        return [THEME_DEFAULT_ID, THEME_OLED_ID].find((presetThemeId) => {
            const presetSeedColors = getSimpleThemeSeedColors(getThemePresetColors(presetThemeId));
            return JSON.stringify(presetSeedColors) === normalizedSeedColors;
        }) || null;
    };

    const applySimpleThemeSeedChange = (seedChanges) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;

        const currentThemeColors = settings.getActiveThemeColors();
        const nextSeedColors = {
            ...getSimpleThemeSeedColors(currentThemeColors),
            ...Object.fromEntries(Object.entries(seedChanges || {}).filter(([, value]) => Boolean(value))),
        };
        const matchingPresetThemeId = getMatchingSimpleThemePresetId(nextSeedColors);
        if (matchingPresetThemeId) {
            applyPresetToCurrentCustomTheme(matchingPresetThemeId);
            return;
        }
        const derivedColors = deriveSimpleThemeColors(nextSeedColors);
        const nextCustomThemes = settings.get('customThemes');
        const nextThemeColors = {
            ...nextCustomThemes[currentTheme],
            ...derivedColors,
        };

        if (JSON.stringify(nextCustomThemes[currentTheme]) === JSON.stringify(nextThemeColors)) {
            return;
        }

        beginThemeEditTransaction(currentTheme);
        nextCustomThemes[currentTheme] = nextThemeColors;
        settings.set('customThemes', nextCustomThemes);
    };

    const flushSimpleThemeColorSave = (key) => {
        const controls = simpleThemeColorControls.get(key);
        if (!controls) return;

        const pendingTimer = simpleThemeColorDebounceTimers.get(key);
        if (pendingTimer) {
            window.clearTimeout(pendingTimer);
            simpleThemeColorDebounceTimers.delete(key);
        }

        applySimpleThemeSeedChange({
            [key]: composeThemeColor(
                controls.colorInput.value,
                controls.alphaInput ? controls.alphaInput.value : 100,
            ),
        });
    };

    const scheduleSimpleThemeColorSave = (key) => {
        const existingTimer = simpleThemeColorDebounceTimers.get(key);
        if (existingTimer) {
            window.clearTimeout(existingTimer);
        }

        simpleThemeColorDebounceTimers.set(key, window.setTimeout(() => {
            simpleThemeColorDebounceTimers.delete(key);
            flushSimpleThemeColorSave(key);
        }, THEME_LIVE_EDIT_DEBOUNCE_MS));
    };

    const resetSimpleThemeColor = (key) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;

        const baseThemeColors = getThemePresetColors(getCustomThemeBaseId(currentTheme));
        applySimpleThemeSeedChange({ [key]: baseThemeColors[key] });
    };

    const syncColorControl = (controlMap, key, value) => {
        const controls = controlMap.get(key);
        if (!controls) return;

        const { hex, alpha, css } = decomposeThemeColor(value);
        controls.colorInput.value = hex;
        if (controls.alphaInput) {
            controls.alphaInput.value = String(alpha);
        }
        if (controls.alphaValue) {
            controls.alphaValue.textContent = `${alpha}%`;
        }
        controls.preview.style.background = css;
        controls.valueLabel.textContent = css;
        if (controls.resetBtn) {
            const baseThemeId = getCustomThemeBaseId();
            controls.resetBtn.title = `Reset to ${THEME_OPTION_LABELS.get(baseThemeId) || 'base theme'}`;
        }
    };

    const syncThemeColorControl = (key, value) => {
        syncColorControl(themeColorControls, key, value);
    };

    const syncThemeCustomizationModal = () => {
        const currentTheme = settings.get('theme');
        const currentThemeColors = settings.getActiveThemeColors();

        themeCustomizationTitleEl.textContent = `${THEME_OPTION_LABELS.get(currentTheme) || 'Theme'}`;
        simpleThemeColorControls.forEach((_, key) => {
            syncColorControl(simpleThemeColorControls, key, currentThemeColors[key]);
        });
        THEME_COLOR_SECTIONS.forEach((section) => {
            section.items.forEach(({ key }) => {
                syncThemeColorControl(key, currentThemeColors[key]);
            });
        });
        syncThemeBackgroundImageUI();
        syncThemeCustomizationModeUI();
        syncThemeCustomizationHistoryButtons(currentTheme);
    };

    const setThemeActionFeedback = (button, label) => {
        if (!button) return;

        const originalLabel = button.dataset.originalLabel || button.textContent;
        if (!button.dataset.originalLabel) {
            button.dataset.originalLabel = originalLabel;
        }

        button.textContent = label;
        window.clearTimeout(button._feedbackTimeout);
        button._feedbackTimeout = window.setTimeout(() => {
            button.textContent = button.dataset.originalLabel || originalLabel;
        }, 1200);
    };

    const cloneThemeSnapshot = (themeId = settings.get('theme')) => {
        if (!isCustomThemeId(themeId)) return null;
        const customThemes = settings.get('customThemes');
        const customThemeBackgrounds = settings.get('customThemeBackgrounds');
        return {
            baseThemeId: getCustomThemeBaseId(themeId),
            colors: JSON.parse(JSON.stringify(customThemes[themeId] || {})),
            background: normalizeThemeBackgroundSettings(customThemeBackgrounds[themeId]),
        };
    };

    const themeSnapshotsMatch = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

    const clearThemeEditCommitTimer = () => {
        if (!themeEditCommitTimer) return;
        window.clearTimeout(themeEditCommitTimer);
        themeEditCommitTimer = 0;
    };

    const ensureThemeUndoContext = (themeId) => {
        if (!isCustomThemeId(themeId)) {
            themeUndoThemeId = null;
            themeUndoStack = [];
            themeRedoStack = [];
            themeEditTransaction = null;
            clearThemeEditCommitTimer();
            syncThemeCustomizationHistoryButtons(themeId);
            return;
        }

        if (themeUndoThemeId === themeId) {
            syncThemeCustomizationHistoryButtons(themeId);
            return;
        }

        themeUndoThemeId = themeId;
        themeUndoStack = [];
        themeRedoStack = [];
        themeEditTransaction = null;
        clearThemeEditCommitTimer();
        syncThemeCustomizationHistoryButtons(themeId);
    };

    const pushThemeHistorySnapshot = (historyStack, themeId, snapshot) => {
        if (!isCustomThemeId(themeId) || !snapshot) return;

        ensureThemeUndoContext(themeId);
        if (historyStack.length > 0 && themeSnapshotsMatch(historyStack[historyStack.length - 1], snapshot)) {
            return;
        }

        historyStack.push(JSON.parse(JSON.stringify(snapshot)));
        if (historyStack.length > THEME_UNDO_LIMIT) {
            historyStack.shift();
        }
    };

    const pushThemeUndoSnapshot = (themeId, snapshot) => {
        pushThemeHistorySnapshot(themeUndoStack, themeId, snapshot);
    };

    const pushThemeRedoSnapshot = (themeId, snapshot) => {
        pushThemeHistorySnapshot(themeRedoStack, themeId, snapshot);
    };

    const clearThemeRedoStack = (themeId) => {
        if (!isCustomThemeId(themeId)) return;
        ensureThemeUndoContext(themeId);
        themeRedoStack = [];
        syncThemeCustomizationHistoryButtons(themeId);
    };

    const flushThemeEditTransaction = () => {
        if (!themeEditTransaction) {
            syncThemeCustomizationHistoryButtons();
            return;
        }

        clearThemeEditCommitTimer();
        const { themeId, beforeSnapshot } = themeEditTransaction;
        themeEditTransaction = null;

        const currentSnapshot = cloneThemeSnapshot(themeId);
        if (!themeSnapshotsMatch(beforeSnapshot, currentSnapshot)) {
            pushThemeUndoSnapshot(themeId, beforeSnapshot);
        }
        syncThemeCustomizationHistoryButtons(themeId);
    };

    const beginThemeEditTransaction = (themeId) => {
        if (isApplyingThemeUndo || !isCustomThemeId(themeId)) return;

        ensureThemeUndoContext(themeId);
        if (!themeEditTransaction) {
            themeEditTransaction = {
                themeId,
                beforeSnapshot: cloneThemeSnapshot(themeId),
            };
            clearThemeRedoStack(themeId);
        }

        clearThemeEditCommitTimer();
        themeEditCommitTimer = window.setTimeout(() => {
            flushThemeEditTransaction();
        }, THEME_EDIT_COMMIT_DELAY_MS);
        syncThemeCustomizationHistoryButtons(themeId);
    };

    const applyThemeSnapshot = (themeId, snapshot) => {
        if (!isCustomThemeId(themeId) || !snapshot) return false;

        clearThemeEditCommitTimer();
        themeEditTransaction = null;
        ensureThemeUndoContext(themeId);

        const nextCustomThemes = settings.get('customThemes');
        const nextCustomThemeBases = settings.get('customThemeBases');
        const nextCustomThemeBackgrounds = settings.get('customThemeBackgrounds');
        nextCustomThemes[themeId] = JSON.parse(JSON.stringify(snapshot.colors || {}));
        nextCustomThemeBases[themeId] = snapshot.baseThemeId === THEME_OLED_ID ? THEME_OLED_ID : THEME_DEFAULT_ID;
        nextCustomThemeBackgrounds[themeId] = normalizeThemeBackgroundSettings(snapshot.background);

        isApplyingThemeUndo = true;
        settings.set('customThemes', nextCustomThemes);
        settings.set('customThemeBases', nextCustomThemeBases);
        settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
        isApplyingThemeUndo = false;
        syncThemeCustomizationHistoryButtons(themeId);
        return true;
    };

    const undoThemeCustomizationChange = () => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return false;

        ensureThemeUndoContext(currentTheme);

        if (themeEditTransaction && themeEditTransaction.themeId === currentTheme) {
            const { beforeSnapshot } = themeEditTransaction;
            const currentSnapshot = cloneThemeSnapshot(currentTheme);
            if (themeSnapshotsMatch(beforeSnapshot, cloneThemeSnapshot(currentTheme))) {
                themeEditTransaction = null;
                clearThemeEditCommitTimer();
                syncThemeCustomizationHistoryButtons(currentTheme);
                return false;
            }
            pushThemeRedoSnapshot(currentTheme, currentSnapshot);
            return applyThemeSnapshot(currentTheme, beforeSnapshot);
        }

        const previousSnapshot = themeUndoStack.pop();
        if (!previousSnapshot) return false;
        pushThemeRedoSnapshot(currentTheme, cloneThemeSnapshot(currentTheme));
        return applyThemeSnapshot(currentTheme, previousSnapshot);
    };

    const redoThemeCustomizationChange = () => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return false;

        ensureThemeUndoContext(currentTheme);
        const nextSnapshot = themeRedoStack.pop();
        if (!nextSnapshot) return false;

        pushThemeUndoSnapshot(currentTheme, cloneThemeSnapshot(currentTheme));
        return applyThemeSnapshot(currentTheme, nextSnapshot);
    };

    const updateThemeSettingsUI = () => {
        if (!themeSelect || !themeCustomizeRow || !customizeThemeBtn) return;

        const currentTheme = settings.get('theme');
        const isCustomTheme = isCustomThemeId(currentTheme);

        themeSelect.value = currentTheme;
        themeCustomizeRow.style.display = isCustomTheme ? '' : 'none';
        customizeThemeBtn.textContent = isCustomTheme
            ? `Edit ${THEME_OPTION_LABELS.get(currentTheme) || 'Theme'} Colors`
            : 'Customize Theme';

        if (!isCustomTheme && isThemeCustomizationOpen()) {
            closeThemeCustomizationModal();
        } else if (isThemeCustomizationOpen()) {
            syncThemeCustomizationModal();
        }

        syncSettingsRowSeparators();
    };

    const normalizeThemeColorCss = (value, fallback = '#000000') => decomposeThemeColor(value, fallback).css;

    const encodeCompactThemeColor = (value) => {
        const { hex, alpha } = decomposeThemeColor(value);
        const rgbHex = hex.replace('#', '').toLowerCase();
        const alphaByte = Math.max(0, Math.min(255, Math.round((alpha / 100) * 255)));
        return alphaByte >= 255
            ? rgbHex
            : `${rgbHex}${alphaByte.toString(16).padStart(2, '0')}`;
    };

    const decodeCompactThemeColor = (value, fallback) => {
        const compact = String(value ?? '').trim().toLowerCase();
        if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(compact)) {
            return normalizeThemeColorCss(fallback, fallback);
        }

        if (compact.length === 6) {
            return `#${compact}`;
        }

        const r = parseInt(compact.slice(0, 2), 16);
        const g = parseInt(compact.slice(2, 4), 16);
        const b = parseInt(compact.slice(4, 6), 16);
        const alpha = Number((parseInt(compact.slice(6, 8), 16) / 255).toFixed(3));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const buildCompactThemeSlot = (themeColors, baseThemeId) => {
        const normalizedBaseThemeId = baseThemeId === THEME_OLED_ID ? THEME_OLED_ID : THEME_DEFAULT_ID;
        const presetColors = getThemePresetColors(normalizedBaseThemeId);
        const diffEntries = [];

        themeColorKeys.forEach((key, index) => {
            const currentColor = normalizeThemeColorCss(themeColors[key], presetColors[key]);
            const presetColor = normalizeThemeColorCss(presetColors[key], presetColors[key]);
            if (currentColor === presetColor) return;

            diffEntries.push(`${index.toString(36).padStart(2, '0')}${encodeCompactThemeColor(currentColor)}`);
        });

        return diffEntries.length > 0
            ? `${normalizedBaseThemeId === THEME_OLED_ID ? 'o' : 'd'},${diffEntries.join('.')}`
            : (normalizedBaseThemeId === THEME_OLED_ID ? 'o' : 'd');
    };

    const decodeCompactThemeSlot = (slotText) => {
        const slot = String(slotText ?? '').trim();
        const separatorIndex = slot.indexOf(',');
        const presetCode = separatorIndex === -1 ? slot : slot.slice(0, separatorIndex);
        const diffString = separatorIndex === -1 ? '' : slot.slice(separatorIndex + 1);
        const presetThemeId = presetCode === 'o' ? THEME_OLED_ID : THEME_DEFAULT_ID;
        const nextThemeColors = getThemePresetColors(presetThemeId);

        if (!diffString) {
            return {
                baseThemeId: presetThemeId,
                colors: nextThemeColors,
            };
        }

        diffString.split('.').forEach((entry) => {
            if (entry.length < 8) return;

            const index = parseInt(entry.slice(0, 2), 36);
            if (!Number.isInteger(index) || index < 0 || index >= themeColorKeys.length) return;

            const key = themeColorKeys[index];
            if (!key) return;

            nextThemeColors[key] = decodeCompactThemeColor(entry.slice(2), nextThemeColors[key]);
        });

        return {
            baseThemeId: presetThemeId,
            colors: nextThemeColors,
        };
    };

    const getSingleThemeTransferPayload = (themeId = settings.get('theme')) => {
        if (!isCustomThemeId(themeId)) return '';

        const customThemes = settings.get('customThemes');
        const customThemeBackgrounds = settings.get('customThemeBackgrounds');
        const payloadParts = [
            buildCompactThemeSlot(
                customThemes[themeId] || getThemePresetColors(THEME_DEFAULT_ID),
                getCustomThemeBaseId(themeId),
            ),
        ];
        const background = normalizeThemeBackgroundSettings(customThemeBackgrounds[themeId]);
        if (background.source === 'link' && background.url) {
            payloadParts.push(`bg:${encodeURIComponent(background.url)}`);
        }
        if (background.overlayColor !== DEFAULTS.backgroundImageOverlayColor) {
            payloadParts.push(`bgo:${encodeCompactThemeColor(background.overlayColor)}`);
        }
        return `ut3:${payloadParts.join('|')}`;
    };

    const applyImportedThemeToSelectedSlot = async (slotText, extraParts = []) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) {
            alert('Select a custom theme slot before importing theme text.');
            return false;
        }

        const decodedSlot = decodeCompactThemeSlot(slotText);
        const nextBackground = createDefaultThemeBackgroundSettings();
        extraParts.forEach((extraPart) => {
            if (String(extraPart).startsWith('bg:')) {
                try {
                    nextBackground.source = 'link';
                    nextBackground.url = decodeURIComponent(String(extraPart).slice(3));
                } catch (_) {
                }
                return;
            }
            if (String(extraPart).startsWith('bgo:')) {
                nextBackground.overlayColor = decodeCompactThemeColor(
                    String(extraPart).slice(4),
                    DEFAULTS.backgroundImageOverlayColor,
                );
            }
        });

        flushThemeEditTransaction();
        const previousSnapshot = cloneThemeSnapshot(currentTheme);
        const nextCustomThemes = settings.get('customThemes');
        const nextCustomThemeBases = settings.get('customThemeBases');
        const nextCustomThemeBackgrounds = settings.get('customThemeBackgrounds');
        const normalizedBackground = normalizeThemeBackgroundSettings(nextBackground);
        nextCustomThemes[currentTheme] = decodedSlot.colors;
        nextCustomThemeBases[currentTheme] = decodedSlot.baseThemeId;
        nextCustomThemeBackgrounds[currentTheme] = normalizedBackground;

        const nextSnapshot = {
            baseThemeId: decodedSlot.baseThemeId,
            colors: decodedSlot.colors,
            background: normalizedBackground,
        };
        if (!themeSnapshotsMatch(previousSnapshot, nextSnapshot)) {
            pushThemeUndoSnapshot(currentTheme, previousSnapshot);
            clearThemeRedoStack(currentTheme);
        }

        settings.set('customThemes', nextCustomThemes);
        settings.set('customThemeBases', nextCustomThemeBases);
        settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);

        if (normalizedBackground.source === 'link' && normalizedBackground.url) {
            try {
                await cacheLinkedBackgroundImage(normalizedBackground.url);
            } catch (error) {
                console.warn('Could not pre-cache imported background image link:', error);
            }
        }
        return true;
    };

    const applyImportedThemes = async (text) => {
        const compactText = String(text ?? '').trim();
        if (compactText.startsWith('ut3:')) {
            const payloadParts = compactText.slice(4).split('|').filter(Boolean);
            const [slotText = '', ...extraParts] = payloadParts;
            if (!slotText) {
                alert('Theme import is missing theme data.');
                return false;
            }
            return applyImportedThemeToSelectedSlot(slotText, extraParts);
        }

        if (compactText.startsWith('ut2:')) {
            flushThemeEditTransaction();

            const slotTexts = compactText.slice(4).split('|');
            const nextCustomThemes = settings.get('customThemes');
            const nextCustomThemeBases = settings.get('customThemeBases');
            const nextCustomThemeBackgrounds = Object.fromEntries(
                THEME_CUSTOM_IDS.map((themeId) => [themeId, createDefaultThemeBackgroundSettings()]),
            );
            const legacyBackgroundThemeId = isCustomThemeId(settings.get('theme')) ? settings.get('theme') : THEME_CUSTOM_IDS[0];
            THEME_CUSTOM_IDS.forEach((themeId, index) => {
                const slotText = slotTexts[index];
                if (!slotText) return;
                const decodedSlot = decodeCompactThemeSlot(slotText);
                nextCustomThemes[themeId] = decodedSlot.colors;
                nextCustomThemeBases[themeId] = decodedSlot.baseThemeId;
            });
            slotTexts.slice(THEME_CUSTOM_IDS.length).forEach((extraPart) => {
                const bgMatch = /^bg([1-3]):(.*)$/i.exec(String(extraPart));
                if (!bgMatch) return;
                const themeId = THEME_CUSTOM_IDS[Number(bgMatch[1]) - 1];
                if (!themeId) return;
                try {
                    nextCustomThemeBackgrounds[themeId] = normalizeThemeBackgroundSettings({
                        ...nextCustomThemeBackgrounds[themeId],
                        source: 'link',
                        url: decodeURIComponent(bgMatch[2]),
                    });
                } catch (_) {
                }
            });
            slotTexts.slice(THEME_CUSTOM_IDS.length).forEach((extraPart) => {
                if (!String(extraPart).startsWith('bg:')) return;
                try {
                    nextCustomThemeBackgrounds[legacyBackgroundThemeId] = normalizeThemeBackgroundSettings({
                        ...nextCustomThemeBackgrounds[legacyBackgroundThemeId],
                        source: 'link',
                        url: decodeURIComponent(String(extraPart).slice(3)),
                    });
                } catch (_) {
                }
            });
            slotTexts.slice(THEME_CUSTOM_IDS.length).forEach((extraPart) => {
                const overlayMatch = /^bgo([1-3]):(.*)$/i.exec(String(extraPart));
                if (!overlayMatch) return;
                const themeId = THEME_CUSTOM_IDS[Number(overlayMatch[1]) - 1];
                if (!themeId) return;
                nextCustomThemeBackgrounds[themeId] = normalizeThemeBackgroundSettings({
                    ...nextCustomThemeBackgrounds[themeId],
                    overlayColor: decodeCompactThemeColor(
                        overlayMatch[2],
                        DEFAULTS.backgroundImageOverlayColor,
                    ),
                });
            });
            slotTexts.slice(THEME_CUSTOM_IDS.length).forEach((extraPart) => {
                if (!String(extraPart).startsWith('bgo:')) return;
                nextCustomThemeBackgrounds[legacyBackgroundThemeId] = normalizeThemeBackgroundSettings({
                    ...nextCustomThemeBackgrounds[legacyBackgroundThemeId],
                    overlayColor: decodeCompactThemeColor(
                        String(extraPart).slice(4),
                        DEFAULTS.backgroundImageOverlayColor,
                    ),
                });
            });

            const currentTheme = settings.get('theme');
            const previousSnapshot = cloneThemeSnapshot(currentTheme);
            const nextSnapshot = isCustomThemeId(currentTheme)
                ? {
                    baseThemeId: nextCustomThemeBases[currentTheme],
                    colors: nextCustomThemes[currentTheme],
                    background: normalizeThemeBackgroundSettings(nextCustomThemeBackgrounds[currentTheme]),
                }
                : null;
            if (previousSnapshot && nextSnapshot && !themeSnapshotsMatch(previousSnapshot, nextSnapshot)) {
                pushThemeUndoSnapshot(currentTheme, previousSnapshot);
                clearThemeRedoStack(currentTheme);
            }

            settings.set('customThemes', nextCustomThemes);
            settings.set('customThemeBases', nextCustomThemeBases);
            settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
            await Promise.allSettled(THEME_CUSTOM_IDS.map(async (themeId) => {
                const background = nextCustomThemeBackgrounds[themeId];
                if (background.source !== 'link' || !background.url) return;
                await cacheLinkedBackgroundImage(background.url);
            }));
            return true;
        }

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (_) {
            alert('Theme import is not valid theme text or JSON.');
            return false;
        }

        if (!parsed || typeof parsed !== 'object') {
            alert('Theme import is missing theme data.');
            return false;
        }

        const currentThemes = settings.get('customThemes');
        if (parsed.type === 'ukratimer-themes' && parsed.customThemes && typeof parsed.customThemes === 'object') {
            flushThemeEditTransaction();
            const currentTheme = settings.get('theme');
            const previousSnapshot = cloneThemeSnapshot(currentTheme);
            const importedCurrentTheme = isCustomThemeId(currentTheme) ? parsed.customThemes[currentTheme] : null;
            const currentThemeBases = settings.get('customThemeBases');
            const currentThemeBackgrounds = settings.get('customThemeBackgrounds');
            const nextCustomThemeBases = parsed.customThemeBases && typeof parsed.customThemeBases === 'object'
                ? { ...currentThemeBases, ...parsed.customThemeBases }
                : currentThemeBases;
            const nextCustomThemeBackgrounds = parsed.customThemeBackgrounds && typeof parsed.customThemeBackgrounds === 'object'
                ? { ...currentThemeBackgrounds, ...parsed.customThemeBackgrounds }
                : currentThemeBackgrounds;
            const importedCurrentSnapshot = isCustomThemeId(currentTheme) && importedCurrentTheme
                ? {
                    baseThemeId: nextCustomThemeBases[currentTheme],
                    colors: importedCurrentTheme,
                    background: normalizeThemeBackgroundSettings(nextCustomThemeBackgrounds[currentTheme]),
                }
                : null;
            if (previousSnapshot && importedCurrentSnapshot && !themeSnapshotsMatch(previousSnapshot, importedCurrentSnapshot)) {
                pushThemeUndoSnapshot(currentTheme, previousSnapshot);
                clearThemeRedoStack(currentTheme);
            }
            settings.set('customThemes', { ...currentThemes, ...parsed.customThemes });
            settings.set('customThemeBases', nextCustomThemeBases);
            if (parsed.customThemeBackgrounds && typeof parsed.customThemeBackgrounds === 'object') {
                settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
                await Promise.allSettled(THEME_CUSTOM_IDS.map(async (themeId) => {
                    const background = normalizeThemeBackgroundSettings(nextCustomThemeBackgrounds[themeId]);
                    if (background.source !== 'link' || !background.url) return;
                    await cacheLinkedBackgroundImage(background.url);
                }));
            } else if (typeof parsed.backgroundImageUrl === 'string') {
                const targetThemeId = isCustomThemeId(currentTheme) ? currentTheme : THEME_CUSTOM_IDS[0];
                const nextBackgrounds = settings.get('customThemeBackgrounds');
                nextBackgrounds[targetThemeId] = normalizeThemeBackgroundSettings({
                    source: parsed.backgroundImageUrl.trim() ? 'link' : 'none',
                    url: parsed.backgroundImageUrl.trim(),
                    overlayColor: typeof parsed.backgroundImageOverlayColor === 'string'
                        ? parsed.backgroundImageOverlayColor
                        : DEFAULTS.backgroundImageOverlayColor,
                });
                settings.set('customThemeBackgrounds', nextBackgrounds);
                if (parsed.backgroundImageUrl.trim()) {
                    try {
                        await cacheLinkedBackgroundImage(parsed.backgroundImageUrl.trim());
                    } catch (error) {
                        console.warn('Could not pre-cache imported background image link:', error);
                    }
                }
            }
            return true;
        }

        const importedColors = parsed.colors && typeof parsed.colors === 'object'
            ? parsed.colors
            : parsed;
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) {
            alert('Select a custom theme slot before importing theme text.');
            return false;
        }

        flushThemeEditTransaction();
        const previousSnapshot = cloneThemeSnapshot(currentTheme);
        const currentThemeBaseId = getCustomThemeBaseId(currentTheme);
        const nextThemeColors = { ...settings.getActiveThemeColors() };
        THEME_COLOR_SECTIONS.forEach((section) => {
            section.items.forEach(({ key }) => {
                nextThemeColors[key] = decomposeThemeColor(importedColors[key], nextThemeColors[key]).css;
            });
        });

        const nextSnapshot = { baseThemeId: currentThemeBaseId, colors: nextThemeColors };
        if (!themeSnapshotsMatch(previousSnapshot, nextSnapshot)) {
            pushThemeUndoSnapshot(currentTheme, previousSnapshot);
            clearThemeRedoStack(currentTheme);
        }
        currentThemes[currentTheme] = nextThemeColors;
        settings.set('customThemes', currentThemes);
        return true;
    };

    const downloadThemeText = (text, filename) => {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const pickThemeFileText = async () => {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'UkraTimer theme files',
                    accept: {
                        'application/json': ['.json'],
                        'text/plain': ['.txt'],
                    },
                }],
                multiple: false,
            });
            const file = await handle.getFile();
            return file.text();
        }

        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,.txt';
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            document.body.appendChild(input);

            input.addEventListener('change', () => {
                const file = input.files?.[0];
                document.body.removeChild(input);
                if (!file) {
                    reject(new Error('no-file'));
                    return;
                }
                file.text().then(resolve, reject);
            }, { once: true });

            input.addEventListener('cancel', () => {
                document.body.removeChild(input);
                reject(new Error('cancelled'));
            }, { once: true });

            input.click();
        });
    };

    const applyThemeColorChange = (key, nextColor) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;
        if (!nextColor) return;

        const nextCustomThemes = settings.get('customThemes');
        const currentColor = nextCustomThemes[currentTheme]?.[key];
        if (currentColor === nextColor) return;

        beginThemeEditTransaction(currentTheme);
        syncThemeColorControl(key, nextColor);

        nextCustomThemes[currentTheme][key] = nextColor;
        settings.set('customThemes', nextCustomThemes);
    };

    const flushDirectThemeColorSave = (key, controlMap = themeColorControls, debounceTimers = themeColorDebounceTimers) => {
        const controls = controlMap.get(key);
        if (!controls) return;

        const pendingTimer = debounceTimers.get(key);
        if (pendingTimer) {
            window.clearTimeout(pendingTimer);
            debounceTimers.delete(key);
        }

        const nextColor = composeThemeColor(
            controls.colorInput.value,
            controls.alphaInput ? controls.alphaInput.value : 100,
        );
        applyThemeColorChange(key, nextColor);
    };

    const scheduleDirectThemeColorSave = (key, controlMap = themeColorControls, debounceTimers = themeColorDebounceTimers) => {
        const existingTimer = debounceTimers.get(key);
        if (existingTimer) {
            window.clearTimeout(existingTimer);
        }

        debounceTimers.set(key, window.setTimeout(() => {
            debounceTimers.delete(key);
            flushDirectThemeColorSave(key, controlMap, debounceTimers);
        }, THEME_LIVE_EDIT_DEBOUNCE_MS));
    };

    const flushThemeColorSave = (key) => {
        flushDirectThemeColorSave(key, themeColorControls, themeColorDebounceTimers);
    };

    const scheduleThemeColorSave = (key) => {
        scheduleDirectThemeColorSave(key, themeColorControls, themeColorDebounceTimers);
    };

    const applyThemeBackgroundChange = (updater) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return null;

        const nextCustomThemeBackgrounds = settings.get('customThemeBackgrounds');
        const currentBackground = normalizeThemeBackgroundSettings(nextCustomThemeBackgrounds[currentTheme]);
        const nextBackground = normalizeThemeBackgroundSettings(
            typeof updater === 'function' ? updater(currentBackground) : updater,
        );

        if (JSON.stringify(currentBackground) === JSON.stringify(nextBackground)) {
            return currentBackground;
        }

        beginThemeEditTransaction(currentTheme);
        nextCustomThemeBackgrounds[currentTheme] = nextBackground;
        settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
        return nextBackground;
    };

    const commitThemeBackgroundImageLink = async () => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return false;

        const nextUrl = String(themeBackgroundImageUrlInput?.value || '').trim();
        const currentBackground = getThemeBackgroundSettings(currentTheme);
        const nextBackground = normalizeThemeBackgroundSettings({
            ...currentBackground,
            source: nextUrl ? 'link' : 'none',
            url: nextUrl,
        });
        const hasChanged = JSON.stringify(currentBackground) !== JSON.stringify(nextBackground);

        themeBackgroundImageModeOverride = 'link';

        if (hasChanged) {
            applyThemeBackgroundChange(nextBackground);
        } else {
            applyBackgroundImage();
            syncThemeBackgroundImageUI();
        }

        if (nextUrl) {
            try {
                await cacheLinkedBackgroundImage(nextUrl);
            } catch (error) {
                console.warn('Could not pre-cache background image link:', error);
                alert('The image link was saved, but offline caching failed for that URL.');
            }
        }

        return hasChanged;
    };

    const saveThemeColor = (key) => {
        flushThemeColorSave(key);
    };

    const flushThemeBackgroundOverlaySave = () => {
        if (themeBackgroundOverlayDebounceTimer) {
            window.clearTimeout(themeBackgroundOverlayDebounceTimer);
            themeBackgroundOverlayDebounceTimer = 0;
        }

        applyThemeBackgroundChange((background) => ({
            ...background,
            overlayColor: composeThemeColor(
                themeBackgroundOverlayColorInput?.value || '#000000',
                themeBackgroundOverlayAlphaInput?.value || 100,
            ),
        }));
    };

    const scheduleThemeBackgroundOverlaySave = () => {
        if (themeBackgroundOverlayDebounceTimer) {
            window.clearTimeout(themeBackgroundOverlayDebounceTimer);
        }
        themeBackgroundOverlayDebounceTimer = window.setTimeout(() => {
            themeBackgroundOverlayDebounceTimer = 0;
            flushThemeBackgroundOverlaySave();
        }, THEME_LIVE_EDIT_DEBOUNCE_MS);
    };

    const resetThemeColor = (key) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;

        const baseThemeColors = getThemePresetColors(getCustomThemeBaseId(currentTheme));
        applyThemeColorChange(key, baseThemeColors[key]);
    };

    const openThemeCustomizationModal = () => {
        const currentTheme = settings.get('theme');
        if (!themeCustomizationOverlayEl || !isCustomThemeId(currentTheme)) return;

        if (themeCustomizationCloseCleanupTimer) {
            window.clearTimeout(themeCustomizationCloseCleanupTimer);
            themeCustomizationCloseCleanupTimer = 0;
        }
        themeCustomizationOverlayEl.classList.remove('theme-customization-overlay-docked');
        themeCustomizationOverlayEl.classList.remove('theme-customization-overlay-docked-bottom-left');
        settingsOverlayEl?.classList.remove('theme-customization-host-docked');
        document.body.classList.remove('theme-customization-docked');
        ensureThemeUndoContext(currentTheme);
        syncThemeCustomizationModal();
        themeCustomizationOverlayEl.classList.add('active');
        setThemeCustomizationDockPosition('');
        syncThemeCustomizationDockButtons();
        settingsOverlayEl?.classList.remove('theme-customization-host-docked');
        settingsOverlayEl?.classList.remove('active');
    };

    const applyPresetToCurrentCustomTheme = (presetThemeId) => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;

        flushThemeEditTransaction();
        const previousSnapshot = cloneThemeSnapshot(currentTheme);
        const nextCustomThemes = settings.get('customThemes');
        const nextCustomThemeBases = settings.get('customThemeBases');
        const nextCustomThemeBackgrounds = settings.get('customThemeBackgrounds');
        const preservedBackground = normalizeThemeBackgroundSettings(nextCustomThemeBackgrounds[currentTheme]);
        nextCustomThemes[currentTheme] = getThemePresetColors(presetThemeId);
        nextCustomThemeBases[currentTheme] = presetThemeId;
        nextCustomThemeBackgrounds[currentTheme] = preservedBackground;
        const nextSnapshot = {
            baseThemeId: presetThemeId,
            colors: nextCustomThemes[currentTheme],
            background: preservedBackground,
        };
        if (!themeSnapshotsMatch(previousSnapshot, nextSnapshot)) {
            pushThemeUndoSnapshot(currentTheme, previousSnapshot);
            clearThemeRedoStack(currentTheme);
        }
        settings.set('customThemes', nextCustomThemes);
        settings.set('customThemeBases', nextCustomThemeBases);
        settings.set('customThemeBackgrounds', nextCustomThemeBackgrounds);
    };

    themeColorControls.forEach((controls, key) => {
        controls.colorInput.addEventListener('input', () => scheduleThemeColorSave(key));
        controls.colorInput.addEventListener('change', () => saveThemeColor(key));
        controls.resetBtn?.addEventListener('click', () => resetThemeColor(key));

        if (controls.alphaInput) {
            controls.alphaInput.addEventListener('input', () => scheduleThemeColorSave(key));
            controls.alphaInput.addEventListener('change', () => saveThemeColor(key));
        }
    });

    simpleThemeColorControls.forEach((controls, key) => {
        if (SIMPLE_THEME_SEED_KEYS.includes(key)) {
            controls.colorInput.addEventListener('input', () => scheduleSimpleThemeColorSave(key));
            controls.colorInput.addEventListener('change', () => flushSimpleThemeColorSave(key));
            controls.alphaInput?.addEventListener('input', () => scheduleSimpleThemeColorSave(key));
            controls.alphaInput?.addEventListener('change', () => flushSimpleThemeColorSave(key));
            controls.resetBtn?.addEventListener('click', () => resetSimpleThemeColor(key));
            return;
        }

        controls.colorInput.addEventListener('input', () => scheduleDirectThemeColorSave(
            key,
            simpleThemeColorControls,
            simpleThemeColorDebounceTimers,
        ));
        controls.colorInput.addEventListener('change', () => flushDirectThemeColorSave(
            key,
            simpleThemeColorControls,
            simpleThemeColorDebounceTimers,
        ));
        controls.alphaInput?.addEventListener('input', () => scheduleDirectThemeColorSave(
            key,
            simpleThemeColorControls,
            simpleThemeColorDebounceTimers,
        ));
        controls.alphaInput?.addEventListener('change', () => flushDirectThemeColorSave(
            key,
            simpleThemeColorControls,
            simpleThemeColorDebounceTimers,
        ));
        controls.resetBtn?.addEventListener('click', () => resetThemeColor(key));
    });

    themeModeSimpleBtn?.addEventListener('click', () => {
        setThemeCustomizationColorMode(THEME_EDITOR_MODE_SIMPLE);
        themeModeSimpleBtn.blur();
    });
    themeModeFullBtn?.addEventListener('click', () => {
        setThemeCustomizationColorMode(THEME_EDITOR_MODE_FULL);
        themeModeFullBtn.blur();
    });
    themeCustomizationUndoBtn?.addEventListener('click', () => {
        if (themeCustomizationUndoBtn.disabled) return;
        undoThemeCustomizationChange();
        themeCustomizationUndoBtn.blur();
    });
    themeCustomizationRedoBtn?.addEventListener('click', () => {
        if (themeCustomizationRedoBtn.disabled) return;
        redoThemeCustomizationChange();
        themeCustomizationRedoBtn.blur();
    });
    registerShortcutTooltip(themeCustomizationUndoBtn, ['Ctrl', 'Z'], 'bottom');
    registerShortcutTooltip(themeCustomizationRedoBtn, ['Ctrl', 'Shift', 'Z'], 'bottom');
    syncThemeCustomizationModeUI();

    if (themeSelect) {
        themeSelect.value = settings.get('theme');
        themeSelect.onchange = () => {
            flushThemeEditTransaction();
            settings.set('theme', themeSelect.value);
            ensureThemeUndoContext(themeSelect.value);
            if (isThemeCustomizationOpen()) {
                if (isCustomThemeId(themeSelect.value)) {
                    syncThemeCustomizationModal();
                } else {
                    closeThemeCustomizationModal();
                }
            }
            themeSelect.blur();
        };
    }

    customizeThemeBtn?.addEventListener('click', openThemeCustomizationModal);
    themeCopyDefaultBtn?.addEventListener('click', () => applyPresetToCurrentCustomTheme(THEME_DEFAULT_ID));
    themeCopyOledBtn?.addEventListener('click', () => applyPresetToCurrentCustomTheme(THEME_OLED_ID));
    themeExportFileBtn?.addEventListener('click', () => {
        const text = getSingleThemeTransferPayload();
        if (!text) return;
        downloadThemeText(text, `ukratimer-theme-${formatDate(Date.now())}.txt`);
    });
    themeExportTextBtn?.addEventListener('click', async () => {
        const text = getSingleThemeTransferPayload();
        if (!text) return;
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch (_) {
        }

        if (copied) {
            setThemeActionFeedback(themeExportTextBtn, 'Copied');
            return;
        }

        await customPrompt('Clipboard copy was blocked. Copy the selected theme text below.', text, 1000000, 'Export Theme As Text');
    });
    themeImportFileBtn?.addEventListener('click', async () => {
        try {
            const text = await pickThemeFileText();
            await applyImportedThemes(text);
        } catch (error) {
            if (error?.name === 'AbortError' || error?.message === 'cancelled' || error?.message === 'no-file') return;
            alert('Could not import theme file.');
        }
    });
    themeImportTextBtn?.addEventListener('click', async () => {
        const text = await customPrompt('Paste exported theme text or JSON for the currently selected custom slot.', '', 1000000, 'Import Theme From Text', 'ut3:d');
        if (!text || !text.trim()) return;
        await applyImportedThemes(text);
    });
    themeBackgroundImageModeSelect?.addEventListener('change', async () => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;
        const nextMode = themeBackgroundImageModeSelect.value;
        if (nextMode === 'none') {
            themeBackgroundImageModeOverride = 'none';
            applyThemeBackgroundChange((background) => ({ ...background, source: 'none' }));
        } else if (nextMode === 'link') {
            themeBackgroundImageModeOverride = 'link';
            applyThemeBackgroundChange((background) => ({
                ...background,
                source: background.url ? 'link' : 'none',
            }));
        } else if (nextMode === 'upload') {
            themeBackgroundImageModeOverride = 'upload';
            if (hasAvailableBackgroundUpload(currentTheme)) {
                applyThemeBackgroundChange((background) => ({
                    ...background,
                    source: 'upload',
                }));
            }
        }
        applyBackgroundImage();
        syncThemeBackgroundImageUI();
        themeBackgroundImageModeSelect.blur();
    });
    themeBackgroundImageUploadBtn?.addEventListener('click', async () => {
        try {
            const currentTheme = settings.get('theme');
            if (!isCustomThemeId(currentTheme)) return;
            const file = await pickThemeImageFile();
            if (!await cacheUploadedBackgroundImage(currentTheme, file)) {
                throw new Error('background-upload-cache-unavailable');
            }
            liveBackgroundUploadPreviewUrl = URL.createObjectURL(file);
            liveBackgroundUploadPreviewThemeId = currentTheme;
            themeBackgroundImageModeOverride = 'upload';
            applyThemeBackgroundChange((background) => ({
                ...background,
                source: 'upload',
            }));
            applyBackgroundImage();
            syncThemeBackgroundImageUI();
            setThemeActionFeedback(themeBackgroundImageUploadBtn, 'Cached');
        } catch (error) {
            if (error?.name === 'AbortError' || error?.message === 'cancelled' || error?.message === 'no-file') return;
            if (error?.message === 'background-upload-cache-unavailable') {
                alert('This browser could not persist the uploaded background image.');
                return;
            }
            alert('Could not open that image file.');
        }
    });
    themeBackgroundImageClearUploadBtn?.addEventListener('click', async () => {
        const currentTheme = settings.get('theme');
        if (!isCustomThemeId(currentTheme)) return;
        themeBackgroundImageModeOverride = 'upload';
        await clearCachedBackgroundUpload(currentTheme);
        applyThemeBackgroundChange((background) => ({ ...background, source: 'none' }));
        applyBackgroundImage();
        syncThemeBackgroundImageUI();
    });
    themeBackgroundImageUrlInput?.addEventListener('blur', () => {
        void commitThemeBackgroundImageLink();
    });
    themeBackgroundImageUrlInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        themeBackgroundImageUrlInput.blur();
    });
    themeBackgroundOverlayColorInput?.addEventListener('input', scheduleThemeBackgroundOverlaySave);
    themeBackgroundOverlayColorInput?.addEventListener('change', flushThemeBackgroundOverlaySave);
    themeBackgroundOverlayAlphaInput?.addEventListener('input', scheduleThemeBackgroundOverlaySave);
    themeBackgroundOverlayAlphaInput?.addEventListener('change', flushThemeBackgroundOverlaySave);
    themeBackgroundOverlayResetBtn?.addEventListener('click', () => {
        applyThemeBackgroundChange((background) => ({
            ...background,
            overlayColor: DEFAULTS.backgroundImageOverlayColor,
        }));
    });
    settings.on('change', (key) => {
        if (key === 'theme') {
            themeBackgroundImageModeOverride = '';
            void reconcileBackgroundImageState();
        }
        if (key === 'customThemeBackgrounds') {
            void reconcileBackgroundImageState();
        }
        if (key !== 'theme' && key !== 'customThemes' && key !== 'customThemeBases' && key !== 'customThemeBackgrounds') return;
        updateThemeSettingsUI();
        scheduleScramblePreviewThemeRefresh();
        refreshTimeDistributionTheme();
    });
    settings.on('reset', () => {
        themeBackgroundImageModeOverride = '';
        clearLiveBackgroundUploadPreview();
        void reconcileBackgroundImageState();
        updateThemeSettingsUI();
        refreshTimeDistributionTheme();
    });
    settings.on('change', (key) => {
        if (key !== 'settingsCollapsedSections') return;
        syncSettingsGroupCollapseUI();
        syncSettingsRowSeparators();
    });
    settings.on('reset', () => {
        syncSettingsGroupCollapseUI();
        syncSettingsRowSeparators();
    });
    void reconcileBackgroundImageState();

    // Hide UI toggle
    const hideUIToggle = document.getElementById('setting-hide-ui');
    const centerTimerToggle = document.getElementById('setting-center-timer');
    const backgroundSpacebarToggle = document.getElementById('setting-background-spacebar');
    const backgroundSpacebarRow = backgroundSpacebarToggle?.closest('.setting-row') ?? null;
    const timeEntryRow = document.getElementById('setting-time-entry-row');
    const swipeDownGestureToggle = document.getElementById('setting-swipe-down-gesture');
    const swipeDownGestureRow = document.getElementById('setting-swipe-down-gesture-row');
    const settingsGroupEls = Array.from(settingsOverlayEl?.querySelectorAll('.setting-group') || []);

    const syncSettingsGroupCollapseUI = () => {
        const collapsedSections = settings.get('settingsCollapsedSections') || {};
        settingsGroupEls.forEach((group) => {
            const sectionId = group.dataset.settingsSectionId;
            const toggleBtn = group.querySelector('[data-settings-section-toggle]');
            if (!sectionId || !toggleBtn) return;

            const isCollapsed = Boolean(collapsedSections[sectionId]);
            group.classList.toggle('collapsed', isCollapsed);
            toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        });
    };

    settingsGroupEls.forEach((group) => {
        const sectionId = group.dataset.settingsSectionId;
        const toggleBtn = group.querySelector('[data-settings-section-toggle]');
        if (!sectionId || !toggleBtn) return;

        toggleBtn.addEventListener('click', () => {
            const isExpanded = toggleBtn.getAttribute('aria-expanded') !== 'false';
            const nextCollapsed = isExpanded;
            group.classList.toggle('collapsed', nextCollapsed);
            toggleBtn.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
            settings.set('settingsCollapsedSections', {
                ...settings.get('settingsCollapsedSections'),
                [sectionId]: nextCollapsed,
            });
            syncSettingsRowSeparators();
            toggleBtn.blur();
        });
    });

    syncSettingsGroupCollapseUI();

    syncSettingsRowSeparators = () => {
        const groups = settingsOverlayEl?.querySelectorAll('.setting-group');
        if (!groups) return;

        groups.forEach((group) => {
            const rows = Array.from(group.querySelectorAll('.setting-row'));
            rows.forEach((row) => row.classList.remove('setting-row-last-visible'));
            if (group.classList.contains('collapsed')) return;

            const visibleRows = rows.filter((row) => {
                if (row.hidden) return false;
                return window.getComputedStyle(row).display !== 'none';
            });

            const lastVisibleRow = visibleRows[visibleRows.length - 1];
            if (lastVisibleRow) {
                lastVisibleRow.classList.add('setting-row-last-visible');
            }
        });
    };

    const updateCenterTimerState = () => {
        if (!centerTimerToggle) return;

        const isMobile = mobileViewportQuery.matches;
        const hideUIEnabled = settings.get('hideUIWhileSolving');
        const shouldDisable = !isMobile && !hideUIEnabled;

        centerTimerToggle.disabled = shouldDisable;
        const row = centerTimerToggle.closest('.setting-row');
        if (row) {
            row.style.opacity = shouldDisable ? '0.5' : '';
            row.style.pointerEvents = shouldDisable ? 'none' : '';
        }
    };

    const updateSwipeDownGestureVisibility = () => {
        if (!swipeDownGestureRow) return;
        swipeDownGestureRow.style.display = coarsePointerQuery.matches ? '' : 'none';
        syncSettingsRowSeparators();
    };

    const updateBackgroundSpacebarVisibility = () => {
        if (!backgroundSpacebarRow) return;
        backgroundSpacebarRow.style.display = finePointerQuery.matches ? '' : 'none';
        syncSettingsRowSeparators();
    };

    const updateTimeEntryVisibility = () => {
        if (!timeEntryRow) return;
        timeEntryRow.style.display = coarsePointerQuery.matches ? 'none' : '';
        syncSettingsRowSeparators();
    };

    if (hideUIToggle) {
        hideUIToggle.checked = settings.get('hideUIWhileSolving');

        hideUIToggle.onchange = () => {
            settings.set('hideUIWhileSolving', hideUIToggle.checked);
            updateCenterTimerState();
            hideUIToggle.blur();
        };
    }

    // Initial state sync and responsive listener
    updateCenterTimerState();
    updateSwipeDownGestureVisibility();
    updateBackgroundSpacebarVisibility();
    updateTimeEntryVisibility();

    const handleSettingsViewportChange = () => {
        updateCenterTimerState();
        updateSwipeDownGestureVisibility();
        updateBackgroundSpacebarVisibility();
        updateTimeEntryVisibility();
        syncSettingsRowSeparators();
    };

    if (typeof mobileViewportQuery.addEventListener === 'function') {
        mobileViewportQuery.addEventListener('change', handleSettingsViewportChange);
    } else {
        mobileViewportQuery.addListener(handleSettingsViewportChange);
    }

    if (typeof coarsePointerQuery.addEventListener === 'function') {
        coarsePointerQuery.addEventListener('change', handleSettingsViewportChange);
    } else {
        coarsePointerQuery.addListener(handleSettingsViewportChange);
    }

    if (typeof finePointerQuery.addEventListener === 'function') {
        finePointerQuery.addEventListener('change', handleSettingsViewportChange);
    } else {
        finePointerQuery.addListener(handleSettingsViewportChange);
    }

    // Center Timer toggle
    if (centerTimerToggle) {
        centerTimerToggle.checked = settings.get('centerTimer');
        centerTimerToggle.onchange = () => settings.set('centerTimer', centerTimerToggle.checked);
    }

    if (backgroundSpacebarToggle) {
        backgroundSpacebarToggle.checked = settings.get('backgroundSpacebarEnabled');
        backgroundSpacebarToggle.onchange = () => {
            settings.set('backgroundSpacebarEnabled', backgroundSpacebarToggle.checked);
            backgroundSpacebarToggle.blur();
        };
    }

    if (swipeDownGestureToggle) {
        swipeDownGestureToggle.checked = settings.get('swipeDownGestureEnabled');
        swipeDownGestureToggle.onchange = () => settings.set('swipeDownGestureEnabled', swipeDownGestureToggle.checked);
    }

    const displayFontSelect = document.getElementById('setting-display-font');
    if (displayFontSelect) {
        displayFontSelect.value = settings.get('displayFont');
        if (!displayFontSelect.value) {
            displayFontSelect.value = DEFAULTS.displayFont;
        }
        displayFontSelect.onchange = () => {
            settings.set('displayFont', displayFontSelect.value);
            displayFontSelect.blur();
        };
    }

    const largeScrambleTextToggle = document.getElementById('setting-large-scramble-text');
    if (largeScrambleTextToggle) {
        largeScrambleTextToggle.checked = settings.get('largeScrambleText');
        largeScrambleTextToggle.onchange = () => settings.set('largeScrambleText', largeScrambleTextToggle.checked);
    }

    const summaryPresetSelect = document.getElementById('setting-summary-stats-preset');
    const summaryCustomRow = document.getElementById('setting-summary-stats-custom-row');
    const summaryCustomInput = document.getElementById('setting-summary-stats-custom');
    const summaryFeedback = document.getElementById('setting-summary-stats-feedback');

    const autoGrowSummaryCustomInput = () => {
        if (!summaryCustomInput) return;
        if (!summaryCustomInput.offsetParent) return;
        summaryCustomInput.style.height = '0px';
        summaryCustomInput.style.height = `${Math.max(summaryCustomInput.scrollHeight, 32)}px`;
    };

    const updateSummarySettingsUI = () => {
        if (!summaryPresetSelect || !summaryCustomRow || !summaryCustomInput || !summaryFeedback) return;

        const isCustom = summaryPresetSelect.value === 'custom';
        summaryCustomRow.style.display = isCustom ? 'flex' : 'none';

        if (isCustom) autoGrowSummaryCustomInput();

        if (!isCustom) {
            const presetTokens = getPresetSummaryTokens(summaryPresetSelect.value);
            summaryFeedback.classList.remove('is-error');
            summaryFeedback.textContent = `Will show: ${presetTokens.join(', ')}`;
            syncSettingsRowSeparators();
            return;
        }

        const parsed = parseSummaryStatInput(summaryCustomInput.value, { truncate: true });
        if (!parsed.ok) {
            summaryFeedback.classList.add('is-error');
            summaryFeedback.textContent = parsed.message;
            syncSettingsRowSeparators();
            return;
        }

        summaryFeedback.classList.remove('is-error');
        summaryFeedback.textContent = parsed.truncated
            ? `Will show first ${MAX_CUSTOM_SUMMARY_STATS}: ${parsed.tokens.join(', ')}`
            : parsed.tokens.length === 0
                ? 'Will show: none'
                : `Will show: ${parsed.tokens.join(', ')}`;
        syncSettingsRowSeparators();
    };

    if (summaryPresetSelect && summaryCustomRow && summaryCustomInput && summaryFeedback) {
        const savedPreset = String(settings.get('summaryStatsPreset') || 'basic').toLowerCase();
        summaryPresetSelect.value = (savedPreset in SUMMARY_STAT_PRESETS || savedPreset === 'custom') ? savedPreset : 'basic';

        const fallbackCustom = getConfiguredSummaryStatTokens().join(' ');
        summaryCustomInput.value = settings.get('summaryStatsCustom') || fallbackCustom;
        autoGrowSummaryCustomInput();
        updateSummarySettingsUI();

        summaryPresetSelect.onchange = () => {
            const preset = summaryPresetSelect.value;
            settings.set('summaryStatsPreset', preset);

            if (preset !== 'custom') {
                const tokens = getPresetSummaryTokens(preset);
                settings.set('summaryStatsList', tokens);
            } else {
                const parsed = parseSummaryStatInput(summaryCustomInput.value, { truncate: true });
                if (parsed.ok) settings.set('summaryStatsList', parsed.tokens);
            }

            updateSummarySettingsUI();
            summaryPresetSelect.blur();
        };

        summaryCustomInput.addEventListener('input', () => {
            autoGrowSummaryCustomInput();
            settings.set('summaryStatsCustom', summaryCustomInput.value);
            if (summaryPresetSelect.value !== 'custom') return;

            const parsed = parseSummaryStatInput(summaryCustomInput.value, { truncate: true });
            if (parsed.ok) {
                settings.set('summaryStatsList', parsed.tokens);
            }

            updateSummarySettingsUI();
        });
    }

    const solvesTableSettingRows = [
        { inputId: 'setting-solves-table-stat1', feedbackId: 'setting-solves-table-stat1-feedback', settingKey: 'solvesTableStat1', label: 'Column 1' },
        { inputId: 'setting-solves-table-stat2', feedbackId: 'setting-solves-table-stat2-feedback', settingKey: 'solvesTableStat2', label: 'Column 2' },
    ].map((row) => ({
        ...row,
        input: document.getElementById(row.inputId),
        feedback: document.getElementById(row.feedbackId),
    })).filter((row) => row.input && row.feedback);

    if (solvesTableSettingRows.length) {
        const readSolvesTableSettingState = () => {
            const parsedRows = solvesTableSettingRows.map((row) => ({
                ...row,
                parsed: parseSolvesTableStatInput(row.input.value),
                duplicateLabel: '',
            }));
            const seen = new Map();

            parsedRows.forEach((row) => {
                if (!row.parsed.ok || row.parsed.empty) return;
                const firstSeen = seen.get(row.parsed.token);
                if (firstSeen) {
                    row.duplicateLabel = firstSeen;
                    return;
                }
                seen.set(row.parsed.token, row.label);
            });

            return parsedRows;
        };

        const updateSolvesTableSettingsUI = () => {
            const parsedRows = readSolvesTableSettingState();

            parsedRows.forEach((row) => {
                const { feedback, parsed, duplicateLabel } = row;
                if (!feedback) return;

                if (!parsed.ok) {
                    feedback.classList.add('is-error');
                    feedback.textContent = parsed.message;
                    return;
                }

                if (parsed.empty) {
                    feedback.classList.remove('is-error');
                    feedback.textContent = 'Hidden';
                    return;
                }

                if (duplicateLabel) {
                    feedback.classList.add('is-error');
                    feedback.textContent = `Already used in ${duplicateLabel}`;
                    return;
                }

                feedback.classList.remove('is-error');
                feedback.textContent = `Using ${parsed.token}`;
            });
        };

        solvesTableSettingRows.forEach(({ input, settingKey }) => {
            input.maxLength = MAX_ROLLING_STAT_INPUT_LENGTH;
            input.value = String(settings.get(settingKey) || '').slice(0, MAX_ROLLING_STAT_INPUT_LENGTH);
        });
        updateSolvesTableSettingsUI();

        solvesTableSettingRows.forEach(({ input, settingKey }) => {
            input.addEventListener('input', () => {
                const parsedRows = readSolvesTableSettingState();
                const currentRow = parsedRows.find((row) => row.settingKey === settingKey);
                if (currentRow?.parsed.ok && !currentRow.duplicateLabel) {
                    settings.set(settingKey, currentRow.parsed.token);
                }
                updateSolvesTableSettingsUI();
            });
        });
    }

    // Pill size select
    const pillSizeSelect = document.getElementById('setting-pill-size');
    pillSizeSelect.value = settings.get('pillSize');
    pillSizeSelect.onchange = () => {
        settings.set('pillSize', pillSizeSelect.value);
        pillSizeSelect.blur();
    };

    const dailyStreakGoalInput = document.getElementById('setting-daily-streak-goal');
    if (dailyStreakGoalInput) {
        const syncDailyStreakGoalInput = () => {
            dailyStreakGoalInput.value = String(normalizeDailyStreakGoal(settings.get('dailyStreakGoal'), 0));
        };

        const commitDailyStreakGoal = () => {
            const nextGoal = normalizeDailyStreakGoal(dailyStreakGoalInput.value, settings.get('dailyStreakGoal'));
            dailyStreakGoalInput.value = String(nextGoal);
            settings.set('dailyStreakGoal', nextGoal);
        };

        syncDailyStreakGoalInput();
        dailyStreakGoalInput.addEventListener('change', commitDailyStreakGoal);
        dailyStreakGoalInput.addEventListener('blur', commitDailyStreakGoal);
        settings.on('change', (key) => {
            if (key !== 'dailyStreakGoal') return;
            syncDailyStreakGoalInput();
        });
        settings.on('reset', syncDailyStreakGoalInput);
    }

    // Show delta toggle
    const deltaToggle = document.getElementById('setting-show-delta');
    deltaToggle.checked = settings.get('showDelta');
    deltaToggle.onchange = () => settings.set('showDelta', deltaToggle.checked);

    const deltaReferenceInput = document.getElementById('setting-delta-reference');
    const deltaReferenceFeedback = document.getElementById('setting-delta-reference-feedback');
    if (deltaReferenceInput && deltaReferenceFeedback) {
        deltaReferenceInput.maxLength = MAX_DELTA_REFERENCE_INPUT_LENGTH;
        deltaReferenceInput.value = String(settings.get('deltaReference') || '').slice(0, MAX_DELTA_REFERENCE_INPUT_LENGTH);

        const updateDeltaReferenceFeedback = () => {
            const parsed = parseDeltaReferenceInput(deltaReferenceInput.value);
            if (!parsed.ok) {
                deltaReferenceFeedback.classList.add('is-error');
                deltaReferenceFeedback.textContent = parsed.message;
                return null;
            }

            deltaReferenceFeedback.classList.remove('is-error');
            deltaReferenceFeedback.textContent = `Using ${parsed.label}`;
            return parsed;
        };

        updateDeltaReferenceFeedback();

        deltaReferenceInput.addEventListener('input', () => {
            const parsed = updateDeltaReferenceFeedback();
            if (!parsed) return;
            settings.set('deltaReference', parsed.empty ? '' : parsed.token);
        });
    }

    const newBestPopupToggle = document.getElementById('setting-new-best-popup');
    newBestPopupToggle.checked = settings.get('newBestPopupEnabled');
    newBestPopupToggle.onchange = () => settings.set('newBestPopupEnabled', newBestPopupToggle.checked);

    const graphTooltipDateToggle = document.getElementById('setting-graph-tooltip-date');
    if (graphTooltipDateToggle) {
        graphTooltipDateToggle.checked = settings.get('graphTooltipDateEnabled');
        graphTooltipDateToggle.onchange = () => settings.set('graphTooltipDateEnabled', graphTooltipDateToggle.checked);
    }

    const graphLineSettingRows = [
        { inputId: 'setting-graph-line1-stat', feedbackId: 'setting-graph-line1-feedback', settingKey: 'graphLine1Stat' },
        { inputId: 'setting-graph-line2-stat', feedbackId: 'setting-graph-line2-feedback', settingKey: 'graphLine2Stat' },
        { inputId: 'setting-graph-line3-stat', feedbackId: 'setting-graph-line3-feedback', settingKey: 'graphLine3Stat' },
    ];

    graphLineSettingRows.forEach(({ inputId, feedbackId, settingKey }) => {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        if (!input || !feedback) return;

        input.maxLength = MAX_ROLLING_STAT_INPUT_LENGTH;
        input.value = String(settings.get(settingKey) || DEFAULTS[settingKey]).slice(0, MAX_ROLLING_STAT_INPUT_LENGTH);

        const updateFeedback = () => {
            const parsed = parseGraphLineStatInput(input.value);
            if (!parsed.ok) {
                feedback.classList.add('is-error');
                feedback.textContent = parsed.message;
                return false;
            }

            feedback.classList.remove('is-error');
            feedback.textContent = `Using ${parsed.token}`;
            return parsed.token;
        };

        updateFeedback();

        input.addEventListener('input', () => {
            const parsedToken = updateFeedback();
            if (!parsedToken) return;
            settings.set(settingKey, parsedToken);
        });
    });

    updateThemeSettingsUI();
    syncSettingsRowSeparators();

    const googleDriveStatus = document.getElementById('google-drive-status');
    const googleDriveAccountBtn = document.getElementById('btn-google-drive-account');
    const googleDriveExportBtn = document.getElementById('btn-google-drive-export');
    const googleDriveImportBtn = document.getElementById('btn-google-drive-import');
    let googleDriveBusy = false;

    const setGoogleDriveStatus = (message, tone = '') => {
        if (!googleDriveStatus) return;
        googleDriveStatus.textContent = message;
        googleDriveStatus.classList.toggle('is-error', tone === 'error');
        googleDriveStatus.classList.toggle('is-success', tone === 'success');
    };

    const reportGoogleDriveError = (message) => {
        if (isSettingsPanelBlocking()) {
            setGoogleDriveStatus(message, 'error');
            return;
        }

        alert(message);
    };

    const ensureGoogleDriveSession = async () => {
        if (hasGoogleDriveSession()) return true;

        const restored = await restoreGoogleDriveSession();
        if (restored) return true;

        setGoogleDriveStatus('Google Drive needs permission again. Reconnect your account to continue.');
        return false;
    };

    const syncGoogleDriveAccountButton = () => {
        if (!googleDriveAccountBtn) return;

        const configured = isGoogleDriveSyncConfigured();
        const connected = hasGoogleDriveSession();

        googleDriveAccountBtn.disabled = !configured || googleDriveBusy;
        googleDriveAccountBtn.textContent = connected
            ? 'Google Account Connected'
            : 'Connect Google Account';
        googleDriveAccountBtn.title = '';
    };

    const syncGoogleDriveButtons = () => {
        const configured = isGoogleDriveSyncConfigured();
        const connected = hasGoogleDriveSession();

        syncGoogleDriveAccountButton();

        if (googleDriveExportBtn) {
            googleDriveExportBtn.disabled = !configured || googleDriveBusy || !connected;
        }

        if (googleDriveImportBtn) {
            googleDriveImportBtn.disabled = !configured || googleDriveBusy || !connected;
        }
    };

    const refreshGoogleDriveStatus = async () => {
        syncGoogleDriveButtons();

        if (!isGoogleDriveSyncConfigured()) {
            setGoogleDriveStatus('Add a Google OAuth client ID in index.html to enable cloud backup.', 'error');
            return;
        }

        if (!hasGoogleDriveSession()) {
            setGoogleDriveStatus('Connect Google Drive to sync a backup file across your devices.');
            return;
        }

        try {
            const info = await getGoogleDriveBackupInfo();
            const modifiedAt = info?.file?.modifiedTime ? Date.parse(info.file.modifiedTime) : NaN;
            const accountPrefix = 'Connected. ';

            if (!info?.file) {
                setGoogleDriveStatus(`${accountPrefix}No cloud backup found yet.`, 'success');
            } else if (Number.isFinite(modifiedAt)) {
                setGoogleDriveStatus(`${accountPrefix}Cloud backup last updated ${formatDateTime(modifiedAt)}.`, 'success');
            } else {
                setGoogleDriveStatus(`${accountPrefix}Cloud backup is available.`, 'success');
            }
        } catch (error) {
            setGoogleDriveStatus(error?.message || 'Could not read Google Drive backup status.', 'error');
        } finally {
            syncGoogleDriveButtons();
        }
    };

    if (googleDriveAccountBtn) {
        googleDriveAccountBtn.onclick = async () => {
            if (hasGoogleDriveSession()) {
                const confirmed = await customConfirm('Sign out of Google Drive?');
                if (!confirmed) return;

                googleDriveBusy = true;
                syncGoogleDriveButtons();
                setGoogleDriveStatus('Signing out of Google Drive...');

                try {
                    await signOutOfGoogleDrive();
                    setGoogleDriveStatus('Signed out of Google Drive.');
                } catch (error) {
                    setGoogleDriveStatus(error?.message || 'Could not sign out of Google Drive.', 'error');
                } finally {
                    googleDriveBusy = false;
                    syncGoogleDriveButtons();
                }
                return;
            }

            googleDriveBusy = true;
            syncGoogleDriveButtons();
            setGoogleDriveStatus('Opening Google sign-in...');

            try {
                await connectGoogleDrive();
                await refreshGoogleDriveStatus();
            } catch (error) {
                setGoogleDriveStatus(error?.message || 'Google Drive connection failed.', 'error');
            } finally {
                googleDriveBusy = false;
                syncGoogleDriveButtons();
            }
        };
    }

    if (googleDriveExportBtn) {
        googleDriveExportBtn.onclick = async () => {
            const confirmed = await customConfirm('This will overwrite the existing Google Drive cloud save. Continue?');
            if (!confirmed) return;

            googleDriveBusy = true;
            syncGoogleDriveButtons();
            setGoogleDriveStatus('Exporting backup to Google Drive...');

            try {
                if (!(await ensureGoogleDriveSession())) return;
                const data = await exportAll();
                const savedFile = await exportBackupToGoogleDrive(data);
                const modifiedAt = savedFile?.modifiedTime ? Date.parse(savedFile.modifiedTime) : Date.now();
                setGoogleDriveStatus(`Cloud backup updated ${formatDateTime(modifiedAt)}.`, 'success');
            } catch (error) {
                setGoogleDriveStatus(error?.message || 'Cloud export failed.', 'error');
            } finally {
                googleDriveBusy = false;
                syncGoogleDriveButtons();
            }
        };
    }

    if (googleDriveImportBtn) {
        googleDriveImportBtn.onclick = async () => {
            googleDriveBusy = true;
            syncGoogleDriveButtons();
            setGoogleDriveStatus('Checking Google Drive backup...');
            let didBeginImport = false;

            try {
                if (!(await ensureGoogleDriveSession())) return;
                const { text } = await importBackupFromGoogleDrive();
                let data = null;

                try {
                    data = JSON.parse(text);
                } catch (_) {
                    throw new Error('Google Drive backup is not valid JSON.');
                }

                if (!data || typeof data !== 'object') {
                    throw new Error('Google Drive backup is missing timer data.');
                }

                closeSettingsPanel({ isPopState: true });

                if (await customConfirm('This will replace all your current data with the Google Drive backup. Continue?')) {
                    await beginImportProgress('backup');
                    didBeginImport = true;
                    await importAll(data, {
                        onProgress: applyImportProgress,
                    });
                    await waitForNextPaint();
                    location.reload();
                    return;
                }
            } catch (error) {
                if (didBeginImport) {
                    failImportProgress('backup');
                }
                reportGoogleDriveError(error?.message || 'Cloud import failed.');
            } finally {
                googleDriveBusy = false;
                syncGoogleDriveButtons();
            }
        };
    }

    void refreshGoogleDriveStatus();

    // // Export
    // document.getElementById('btn-export').onclick = async () => {
    //     const data = await exportAll();
    //     const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    //     const url = URL.createObjectURL(blob);
    //     const a = document.createElement('a');
    //     a.href = url;
    //     a.download = `ukratimer-backup-${formatDate(Date.now())}.json`;
    //     a.click();
    //     URL.revokeObjectURL(url);
    // };

    // Export as csTimer
    document.getElementById('btn-export-cstimer').onclick = async () => {
        const data = await exportCsTimer();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const secondsPassedToday = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
        a.href = url;
        a.download = `ukratimer-${year}-${month}-${day}_${secondsPassedToday}-cstimer-format.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Import — uses modern File System Access API (Chrome/Edge) to avoid
    // the <input type="file"> change-event bugs entirely. Falls back to
    // a one-shot file input for Firefox/Safari.
    document.getElementById('btn-import').onclick = async () => {
        let text = '';
        try {
            if (window.showOpenFilePicker) {
                // Promise-based: no change events, no re-firing
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Timer backup files',
                        accept: {
                            'application/json': ['.json'],
                            'text/plain': ['.txt'],
                            'text/csv': ['.csv'],
                        },
                    }],
                    multiple: false,
                });
                const file = await handle.getFile();
                text = await file.text();
            } else {
                // Fallback for browsers without showOpenFilePicker
                text = await new Promise((resolve, reject) => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = '.json,.txt,.csv';
                    inp.style.position = 'fixed';
                    inp.style.left = '-9999px';
                    document.body.appendChild(inp);

                    inp.addEventListener('change', () => {
                        const f = inp.files[0];
                        document.body.removeChild(inp);
                        if (!f) { reject(new Error('no-file')); return; }
                        f.text().then(resolve, reject);
                    }, { once: true });

                    inp.addEventListener('cancel', () => {
                        document.body.removeChild(inp);
                        reject(new Error('cancelled'));
                    }, { once: true });

                    inp.click();
                });
            }

            let data = null;
            let isJsonImport = false;
            try {
                data = JSON.parse(text);
                isJsonImport = true;
            } catch (_) {
                data = null;
            }
            // Close UI without popping history to avoid back-navigation race condition
            // and ensure confirmation is visible (history state is reused by customConfirm)
            closeSettingsPanel({ isPopState: true });

            if (await customConfirm('This will replace all your current data. Continue?')) {
                const importSource = isJsonImport && isCsTimerFormat(data)
                    ? 'cstimer'
                    : isJsonImport && data && typeof data === 'object'
                        ? 'backup'
                        : 'csv';
                await beginImportProgress(importSource);

                if (isJsonImport && isCsTimerFormat(data)) {
                    await importCsTimer(data, {
                        onProgress: applyImportProgress,
                    });
                } else if (isJsonImport && data && typeof data === 'object') {
                    await importAll(data, {
                        onProgress: applyImportProgress,
                    });
                } else {
                    await importSessionCsv(text, {
                        onProgress: applyImportProgress,
                    });
                }
                await waitForNextPaint();
                location.reload();
            }
        } catch (e) {
            // Silently ignore user-cancelled or AbortError
            if (e.name === 'AbortError') return;
            if (e.message === 'cancelled' || e.message === 'no-file') return;
            failImportProgress();
            console.error('Import failed:', {
                message: e?.message || String(e),
                stack: e?.stack || null,
                preview: text.slice(0, 500),
            });
            alert('Invalid file format.');
        }
    };
}

function initShortcutsOverlay() {
    shortcutsOverlayEl = document.getElementById('shortcuts-overlay');
    renderKeyboardShortcuts();

    document.getElementById('shortcuts-close').onclick = closeKeyboardShortcutsOverlay;
    let _shortcutsMouseDownTarget = null;
    let _shortcutsMouseUpTarget = null;
    shortcutsOverlayEl.addEventListener('mousedown', (e) => {
        _shortcutsMouseDownTarget = e.target;
    });
    shortcutsOverlayEl.addEventListener('mouseup', (e) => {
        _shortcutsMouseUpTarget = e.target;
    });
    shortcutsOverlayEl.addEventListener('click', (e) => {
        if (_shortcutsMouseDownTarget === shortcutsOverlayEl && _shortcutsMouseUpTarget === shortcutsOverlayEl) closeKeyboardShortcutsOverlay();
        _shortcutsMouseDownTarget = null;
        _shortcutsMouseUpTarget = null;
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && shortcutsOverlayEl.classList.contains('active')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeKeyboardShortcutsOverlay();
        }
    });
}

// ──── Init ────
init();
