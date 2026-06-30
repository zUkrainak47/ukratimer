import { load, registerBeforeDataExportHook, save } from './storage.js?v=2026063003';
import { normalizeTimeEntryMode, TIME_ENTRY_MODE_TIMER, TIME_ENTRY_MODE_TYPING } from './time-entry.js?v=2026063003';
import { EventEmitter, normalizePhaseCount } from './utils.js?v=2026063003';
import {
    SETTING_SCOPE_GLOBAL,
    SETTING_SCOPE_SESSION,
    SESSION_SCOPABLE_SETTING_KEYS,
    canScopeSetting as canScopeSessionSetting,
    getLinkedSessionScopeKeys,
    getSessionScopedSettingKeys,
    isDefaultSessionScopedSetting,
    normalizeSettingScopes,
} from './setting-scopes.js?v=2026063003';

export {
    SETTING_SCOPE_GLOBAL,
    SETTING_SCOPE_SESSION,
    SESSION_SCOPABLE_SETTING_KEYS,
    getLinkedSessionScopeKeys,
};

export const THEME_DEFAULT_ID = 'default';
export const THEME_OLED_ID = 'oled';
export const THEME_CUSTOM_IDS = Object.freeze(['custom1', 'custom2', 'custom3']);
export const AUTO_EXPORT_EVERY_100_SOLVES_NEVER = 'n';
export const AUTO_EXPORT_EVERY_100_SOLVES_REMIND = 'a';
export const AUTO_EXPORT_EVERY_100_SOLVES_GOOGLE_DRIVE = 'ggl';
export const AUTO_EXPORT_EVERY_100_SOLVES_FILE = 'f';
export const INSPECTION_TIME_OFF = 'off';
export const INSPECTION_TIME_COUNT_UP = 'ap';
export const INSPECTION_TIME_COUNT_DOWN = 'a';
export const TIME_TABLE_VERTICAL_GRID_LINES_OFF = 'off';
export const TIME_TABLE_VERTICAL_GRID_LINES_MULTI_PHASE_ONLY = 'multi-phase-only';
export const TIME_TABLE_VERTICAL_GRID_LINES_ON = 'on';
const THEME_BASE_IDS = Object.freeze([THEME_DEFAULT_ID, THEME_OLED_ID]);
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
const TIME_TABLE_VERTICAL_GRID_LINE_VALUES = new Set([
    TIME_TABLE_VERTICAL_GRID_LINES_OFF,
    TIME_TABLE_VERTICAL_GRID_LINES_MULTI_PHASE_ONLY,
    TIME_TABLE_VERTICAL_GRID_LINES_ON,
]);
const MAIN_STATS_SOURCE_TIME = 'time';

const THEME_ID_SET = new Set([THEME_DEFAULT_ID, THEME_OLED_ID, ...THEME_CUSTOM_IDS]);

export const THEME_OPTIONS = Object.freeze([
    { value: THEME_DEFAULT_ID, label: 'Default' },
    { value: THEME_OLED_ID, label: 'OLED' },
    { value: 'custom1', label: 'Custom 1' },
    { value: 'custom2', label: 'Custom 2' },
    { value: 'custom3', label: 'Custom 3' },
]);

export const THEME_COLOR_SECTIONS = Object.freeze([
    Object.freeze({
        id: 'backgrounds',
        title: 'Backgrounds',
        items: Object.freeze([
            Object.freeze({ key: 'bgPrimary', variable: '--bg-primary', label: 'Page background' }),
            Object.freeze({ key: 'bgSecondary', variable: '--bg-secondary', label: 'Secondary background' }),
            Object.freeze({ key: 'bgTertiary', variable: '--bg-tertiary', label: 'Tertiary background' }),
            Object.freeze({ key: 'bgOverlay', variable: '--bg-overlay', label: 'Overlay backdrop', alpha: true }),
            Object.freeze({ key: 'panelSheen', variable: '--panel-sheen', label: 'Panel sheen', alpha: true }),
            Object.freeze({ key: 'panelSheenFade', variable: '--panel-sheen-fade', label: 'Panel sheen fade', alpha: true }),
        ]),
    }),
    Object.freeze({
        id: 'surfaces',
        title: 'Surfaces',
        items: Object.freeze([
            Object.freeze({ key: 'surface', variable: '--surface', label: 'Surface' }),
            Object.freeze({ key: 'surfaceHover', variable: '--surface-hover', label: 'Surface hover' }),
            Object.freeze({ key: 'surfaceActive', variable: '--surface-active', label: 'Surface active' }),
            Object.freeze({ key: 'surfaceBorder', variable: '--surface-border', label: 'Surface border' }),
            Object.freeze({ key: 'surfaceElevated', variable: '--surface-elevated', label: 'Elevated surface', alpha: true }),
            Object.freeze({ key: 'floatingSurface', variable: '--floating-surface', label: 'Floating surface', alpha: true }),
            Object.freeze({ key: 'floatingSurfaceHover', variable: '--floating-surface-hover', label: 'Floating hover', alpha: true }),
            Object.freeze({ key: 'floatingSurfaceBorder', variable: '--floating-surface-border', label: 'Floating border', alpha: true }),
            Object.freeze({ key: 'floatingSurfaceBorderStrong', variable: '--floating-surface-border-strong', label: 'Strong floating border', alpha: true }),
            Object.freeze({ key: 'surfaceGhost', variable: '--surface-ghost', label: 'Ghost surface', alpha: true }),
            Object.freeze({ key: 'surfaceGhostHover', variable: '--surface-ghost-hover', label: 'Ghost hover', alpha: true }),
            Object.freeze({ key: 'surfaceGhostActive', variable: '--surface-ghost-active', label: 'Ghost active', alpha: true }),
            Object.freeze({ key: 'surfaceGhostMuted', variable: '--surface-ghost-muted', label: 'Ghost muted', alpha: true }),
            Object.freeze({ key: 'pillBorder', variable: '--pill-border', label: 'Pill border' }),
            Object.freeze({ key: 'pillBackgroundHover', variable: '--pill-background-hover', label: 'Pill background hover', alpha: true }),
            Object.freeze({ key: 'pillBorderHover', variable: '--pill-border-hover', label: 'Pill border hover' }),
            Object.freeze({ key: 'tooltipSurface', variable: '--tooltip-surface', label: 'Tooltip surface', alpha: true }),
            Object.freeze({ key: 'mobileTabsSurface', variable: '--mobile-tabs-surface', label: 'Mobile tabs surface', alpha: true }),
            Object.freeze({ key: 'newBestPopupSurface', variable: '--new-best-popup-surface', label: 'New best popup surface', alpha: true }),
            Object.freeze({ key: 'dividerSubtle', variable: '--divider-subtle', label: 'Subtle divider', alpha: true }),
        ]),
    }),
    Object.freeze({
        id: 'text',
        title: 'Text And Accent',
        items: Object.freeze([
            Object.freeze({ key: 'textPrimary', variable: '--text-primary', label: 'Primary text' }),
            Object.freeze({ key: 'scrambleTopText', variable: '--scramble-top-text', label: 'Text #2' }),
            Object.freeze({ key: 'textSecondary', variable: '--text-secondary', label: 'Secondary text' }),
            Object.freeze({ key: 'textTertiary', variable: '--text-tertiary', label: 'Tertiary text' }),
            Object.freeze({ key: 'textMuted', variable: '--text-muted', label: 'Muted text' }),
            Object.freeze({ key: 'accent', variable: '--accent', label: 'Accent' }),
            Object.freeze({ key: 'accentHover', variable: '--accent-hover', label: 'Accent hover' }),
            Object.freeze({ key: 'accentSubtle', variable: '--accent-subtle', label: 'Accent subtle', alpha: true }),
            Object.freeze({ key: 'dangerPenalty', variable: '--danger-penalty', label: 'Danger / penalty' }),
        ]),
    }),
    Object.freeze({
        id: 'timer-stats',
        title: 'Timer And Stats',
        items: Object.freeze([
            Object.freeze({ key: 'timerIdle', variable: '--timer-idle', label: 'Timer idle' }),
            Object.freeze({ key: 'timerHolding', variable: '--timer-holding', label: 'Timer holding' }),
            Object.freeze({ key: 'timerReady', variable: '--timer-ready', label: 'Timer ready' }),
            Object.freeze({ key: 'timerRunning', variable: '--timer-running', label: 'Timer running' }),
            Object.freeze({ key: 'newBestPopup', variable: '--new-best-popup-color', label: 'New best popup' }),
            Object.freeze({ key: 'statNewBest', variable: '--stat-new-best', label: 'New best highlight' }),
        ]),
    }),
    Object.freeze({
        id: 'graph',
        title: 'Graph And Distribution',
        items: Object.freeze([
            Object.freeze({ key: 'graphColorTime', variable: '--graph-color-time', label: 'Time line' }),
            Object.freeze({ key: 'graphColorLine1', variable: '--graph-color-line1', label: 'Line 1' }),
            Object.freeze({ key: 'graphColorLine2', variable: '--graph-color-line2', label: 'Line 2' }),
            Object.freeze({ key: 'graphColorLine3', variable: '--graph-color-line3', label: 'Line 3' }),
            Object.freeze({ key: 'graphGrid', variable: '--graph-grid', label: 'Grid' }),
            Object.freeze({ key: 'statBest', variable: '--stat-best', label: 'Distribution left bars' }),
            Object.freeze({ key: 'statAo5', variable: '--stat-ao5', label: 'Distribution right bars' }),
            Object.freeze({ key: 'distributionMedian', variable: '--distribution-median', label: 'Distribution median line' }),
            Object.freeze({ key: 'statAo12', variable: '--stat-ao12', label: 'Distribution accent 1', hidden: true }),
            Object.freeze({ key: 'statAo100', variable: '--stat-ao100', label: 'Distribution accent 2', hidden: true }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-cube',
        title: 'NxN Cubes',
        items: Object.freeze([
            Object.freeze({ key: 'previewCubeWhite', variable: '--preview-cube-white', label: 'White face' }),
            Object.freeze({ key: 'previewCubeRed', variable: '--preview-cube-red', label: 'Red face' }),
            Object.freeze({ key: 'previewCubeGreen', variable: '--preview-cube-green', label: 'Green face' }),
            Object.freeze({ key: 'previewCubeYellow', variable: '--preview-cube-yellow', label: 'Yellow face' }),
            Object.freeze({ key: 'previewCubeOrange', variable: '--preview-cube-orange', label: 'Orange face' }),
            Object.freeze({ key: 'previewCubeBlue', variable: '--preview-cube-blue', label: 'Blue face' }),
            Object.freeze({ key: 'previewCubeOutline', variable: '--preview-cube-outline', label: 'Outline' }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-skewb',
        title: 'Skewb',
        items: Object.freeze([
            Object.freeze({ key: 'previewSkewbWhite', variable: '--preview-skewb-white', label: 'White face' }),
            Object.freeze({ key: 'previewSkewbRed', variable: '--preview-skewb-red', label: 'Red face' }),
            Object.freeze({ key: 'previewSkewbGreen', variable: '--preview-skewb-green', label: 'Green face' }),
            Object.freeze({ key: 'previewSkewbYellow', variable: '--preview-skewb-yellow', label: 'Yellow face' }),
            Object.freeze({ key: 'previewSkewbOrange', variable: '--preview-skewb-orange', label: 'Orange face' }),
            Object.freeze({ key: 'previewSkewbBlue', variable: '--preview-skewb-blue', label: 'Blue face' }),
            Object.freeze({ key: 'previewSkewbOutline', variable: '--preview-skewb-outline', label: 'Outline' }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-fto',
        title: 'FTO',
        items: Object.freeze([
            Object.freeze({ key: 'previewFtoUp', variable: '--preview-fto-up', label: 'Up face' }),
            Object.freeze({ key: 'previewFtoLeft', variable: '--preview-fto-left', label: 'Left face' }),
            Object.freeze({ key: 'previewFtoFront', variable: '--preview-fto-front', label: 'Front face' }),
            Object.freeze({ key: 'previewFtoRight', variable: '--preview-fto-right', label: 'Right face' }),
            Object.freeze({ key: 'previewFtoBack', variable: '--preview-fto-back', label: 'Back face' }),
            Object.freeze({ key: 'previewFtoBackRight', variable: '--preview-fto-back-right', label: 'Back-right face' }),
            Object.freeze({ key: 'previewFtoDown', variable: '--preview-fto-down', label: 'Down face' }),
            Object.freeze({ key: 'previewFtoBackLeft', variable: '--preview-fto-back-left', label: 'Back-left face' }),
            Object.freeze({ key: 'previewFtoOutline', variable: '--preview-fto-outline', label: 'Outline' }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-pyraminx',
        title: 'Pyraminx',
        items: Object.freeze([
            Object.freeze({ key: 'previewPyraminxYellow', variable: '--preview-pyraminx-yellow', label: 'Yellow face' }),
            Object.freeze({ key: 'previewPyraminxGreen', variable: '--preview-pyraminx-green', label: 'Green face' }),
            Object.freeze({ key: 'previewPyraminxRed', variable: '--preview-pyraminx-red', label: 'Red face' }),
            Object.freeze({ key: 'previewPyraminxBlue', variable: '--preview-pyraminx-blue', label: 'Blue face' }),
            Object.freeze({ key: 'previewPyraminxOutline', variable: '--preview-pyraminx-outline', label: 'Outline' }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-megaminx',
        title: 'Megaminx',
        items: Object.freeze([
            Object.freeze({ key: 'previewMegaminxFace1', variable: '--preview-megaminx-face-1', label: 'White face' }),
            Object.freeze({ key: 'previewMegaminxFace2', variable: '--preview-megaminx-face-2', label: 'Yellow face' }),
            Object.freeze({ key: 'previewMegaminxFace3', variable: '--preview-megaminx-face-3', label: 'Pale yellow face' }),
            Object.freeze({ key: 'previewMegaminxFace4', variable: '--preview-megaminx-face-4', label: 'Gray face' }),
            Object.freeze({ key: 'previewMegaminxFace5', variable: '--preview-megaminx-face-5', label: 'Red face' }),
            Object.freeze({ key: 'previewMegaminxFace6', variable: '--preview-megaminx-face-6', label: 'Dark green face' }),
            Object.freeze({ key: 'previewMegaminxFace7', variable: '--preview-megaminx-face-7', label: 'Lime face' }),
            Object.freeze({ key: 'previewMegaminxFace8', variable: '--preview-megaminx-face-8', label: 'Orange face' }),
            Object.freeze({ key: 'previewMegaminxFace9', variable: '--preview-megaminx-face-9', label: 'Blue face' }),
            Object.freeze({ key: 'previewMegaminxFace10', variable: '--preview-megaminx-face-10', label: 'Purple face' }),
            Object.freeze({ key: 'previewMegaminxFace11', variable: '--preview-megaminx-face-11', label: 'Pink face' }),
            Object.freeze({ key: 'previewMegaminxFace12', variable: '--preview-megaminx-face-12', label: 'Light blue face' }),
            Object.freeze({ key: 'previewMegaminxOutline', variable: '--preview-megaminx-outline', label: 'Outline' }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-square1',
        title: 'Square-1',
        items: Object.freeze([
            Object.freeze({ key: 'previewSquare1Up', variable: '--preview-square1-up', label: 'Up face' }),
            Object.freeze({ key: 'previewSquare1Down', variable: '--preview-square1-down', label: 'Down face' }),
            Object.freeze({ key: 'previewSquare1Front', variable: '--preview-square1-front', label: 'Front face' }),
            Object.freeze({ key: 'previewSquare1Back', variable: '--preview-square1-back', label: 'Back face' }),
            Object.freeze({ key: 'previewSquare1Left', variable: '--preview-square1-left', label: 'Left face' }),
            Object.freeze({ key: 'previewSquare1Right', variable: '--preview-square1-right', label: 'Right face' }),
            Object.freeze({ key: 'previewSquare1Outline', variable: '--preview-square1-outline', label: 'Outline' }),
        ]),
    }),
    Object.freeze({
        id: 'scramble-preview-clock',
        title: 'Clock',
        items: Object.freeze([
            Object.freeze({ key: 'previewClockBody', variable: '--preview-clock-body', label: 'Body' }),
            Object.freeze({ key: 'previewClockFrontFace', variable: '--preview-clock-front-face', label: 'Front face' }),
            Object.freeze({ key: 'previewClockBackFace', variable: '--preview-clock-back-face', label: 'Back face' }),
            Object.freeze({ key: 'previewClockFrontDial', variable: '--preview-clock-front-dial', label: 'Front dials' }),
            Object.freeze({ key: 'previewClockBackDial', variable: '--preview-clock-back-dial', label: 'Back dials' }),
            Object.freeze({ key: 'previewClockHandFill', variable: '--preview-clock-hand-fill', label: 'Hand fill' }),
            Object.freeze({ key: 'previewClockHandStroke', variable: '--preview-clock-hand-stroke', label: 'Hand stroke' }),
            Object.freeze({ key: 'previewClockPinUp', variable: '--preview-clock-pin-up', label: 'Pin up' }),
            Object.freeze({ key: 'previewClockPinDown', variable: '--preview-clock-pin-down', label: 'Pin down' }),
        ]),
    }),
]);

const THEME_COLOR_ITEMS = Object.freeze(THEME_COLOR_SECTIONS.flatMap((section) => section.items));
const THEME_COLOR_KEYS = Object.freeze(THEME_COLOR_ITEMS.map((item) => item.key));

const LEGACY_THEME_FIELD_TO_TOKEN = Object.freeze({
    newBestColor: 'newBestPopup',
    graphColorTime: 'graphColorTime',
    graphColorLine1: 'graphColorLine1',
    graphColorLine2: 'graphColorLine2',
    graphColorLine3: 'graphColorLine3',
    graphColorAo5: 'graphColorLine1',
    graphColorAo12: 'graphColorLine2',
    graphColorAo100: 'graphColorLine3',
});

const LEGACY_THEME_COLOR_KEY_FALLBACKS = Object.freeze({
    newBestPopup: ['newBestPopup', 'statBest'],
    statNewBest: ['statNewBest'],
    distributionMedian: ['distributionMedian', 'statWorst'],
    dangerPenalty: ['dangerPenalty', 'statWorst'],
});

const DEFAULT_THEME_COLORS = Object.freeze({
    bgPrimary: '#0d1117',
    bgSecondary: '#161b22',
    bgTertiary: '#21262d',
    bgOverlay: 'rgba(0, 0, 0, 0.6)',
    bgGlow1: 'rgba(88, 166, 255, 0.18)',
    bgGlow2: 'rgba(240, 136, 62, 0.18)',
    bgGlow3: 'rgba(63, 185, 80, 0.12)',
    panelSheen: 'rgba(255, 255, 255, 0.02)',
    panelSheenFade: 'rgba(255, 255, 255, 0)',
    surface: '#1c2128',
    surfaceHover: '#262c36',
    surfaceActive: '#2d333b',
    surfaceBorder: '#30363d',
    surfaceElevated: 'rgba(28, 33, 40, 0.88)',
    floatingSurface: 'rgba(24, 29, 35, 0.99)',
    floatingSurfaceHover: 'rgba(32, 38, 45, 0.99)',
    floatingSurfaceBorder: 'rgba(255, 255, 255, 0.08)',
    floatingSurfaceBorderStrong: 'rgba(255, 255, 255, 0.12)',
    surfaceGhost: 'rgba(255, 255, 255, 0.05)',
    surfaceGhostHover: 'rgba(255, 255, 255, 0.06)',
    surfaceGhostActive: 'rgba(255, 255, 255, 0.08)',
    surfaceGhostMuted: 'rgba(255, 255, 255, 0.025)',
    pillBorder: '#3a4048',
    pillBackgroundHover: '#21262d',
    pillBorderHover: '#505863',
    tooltipSurface: 'rgba(28, 33, 40, 0.96)',
    mobileTabsSurface: 'rgba(13, 17, 23, 0.86)',
    newBestPopupSurface: 'rgba(13, 17, 23, 0.94)',
    dividerSubtle: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#e6edf3',
    scrambleTopText: '#e6edf3',
    textSecondary: '#8b949e',
    textTertiary: '#6e7681',
    textMuted: '#484f58',
    accent: '#58a6ff',
    accentHover: '#79c0ff',
    accentSubtle: 'rgba(56, 139, 253, 0.15)',
    timerIdle: '#e6edf3',
    timerHolding: '#f85149',
    timerReady: '#3fb950',
    timerRunning: '#e6edf3',
    statBest: '#3fb950',
    statAo5: '#f0883e',
    distributionMedian: '#f85149',
    dangerPenalty: '#f85149',
    statAo12: '#a371f7',
    statAo100: '#58a6ff',
    newBestPopup: '#3fb950',
    statNewBest: '#fe2b2b',
    graphColorTime: '#8b949e',
    graphColorLine1: '#ff2020',
    graphColorLine2: '#2b91ff',
    graphColorLine3: '#a371f7',
    graphGrid: '#3c4552',
    previewCubeWhite: '#ffffff',
    previewCubeRed: '#ff0000',
    previewCubeGreen: '#33cd32',
    previewCubeYellow: '#ffff05',
    previewCubeOrange: '#ffa503',
    previewCubeBlue: '#0000ff',
    previewCubeOutline: 'rgba(0, 0, 0, 0.4)',
    previewSkewbWhite: '#ffffff',
    previewSkewbRed: '#ff0000',
    previewSkewbGreen: '#33cd32',
    previewSkewbYellow: '#ffff05',
    previewSkewbOrange: '#ffa503',
    previewSkewbBlue: '#0000ff',
    previewSkewbOutline: '#000000',
    previewFtoUp: '#ffffff',
    previewFtoLeft: '#880088',
    previewFtoFront: '#00dd00',
    previewFtoRight: '#ff0000',
    previewFtoBack: '#0000ff',
    previewFtoBackRight: '#bbbbbb',
    previewFtoDown: '#ffff00',
    previewFtoBackLeft: '#ffaa00',
    previewFtoOutline: '#000000',
    previewPyraminxYellow: '#ffff05',
    previewPyraminxGreen: '#33cd32',
    previewPyraminxRed: '#ff0000',
    previewPyraminxBlue: '#0000ff',
    previewPyraminxOutline: '#000000',
    previewMegaminxFace1: '#f8f8f5',
    previewMegaminxFace2: '#f9c91c',
    previewMegaminxFace3: '#fff6b4',
    previewMegaminxFace4: '#9c9c9c',
    previewMegaminxFace5: '#ec1111',
    previewMegaminxFace6: '#0a7f12',
    previewMegaminxFace7: '#74fb00',
    previewMegaminxFace8: '#ff9136',
    previewMegaminxFace9: '#1223c8',
    previewMegaminxFace10: '#8a28ff',
    previewMegaminxFace11: '#e28dee',
    previewMegaminxFace12: '#8bd6f8',
    previewMegaminxOutline: 'rgba(0, 0, 0, 0.45)',
    previewSquare1Up: '#ffff00',
    previewSquare1Down: '#ffffff',
    previewSquare1Front: '#ff0000',
    previewSquare1Back: '#ff8800',
    previewSquare1Left: '#0000ff',
    previewSquare1Right: '#00ff00',
    previewSquare1Outline: '#000000',
    previewClockBody: '#000000',
    previewClockFrontFace: '#57c5f8',
    previewClockBackFace: '#315f9b',
    previewClockFrontDial: '#315f9b',
    previewClockBackDial: '#57c5f8',
    previewClockHandFill: '#ffd700',
    previewClockHandStroke: '#ff0000',
    previewClockPinUp: '#ffeb3b',
    previewClockPinDown: '#7b4c20',
});

const OLED_THEME_COLORS = Object.freeze({
    ...DEFAULT_THEME_COLORS,
    bgPrimary: '#000000',
    bgSecondary: '#0a0a0a',
    bgTertiary: '#0a0a0a',
    bgOverlay: 'rgba(0, 0, 0, 0.78)',
    panelSheen: 'rgba(255, 255, 255, 0)',
    panelSheenFade: 'rgba(255, 255, 255, 0)',
    surface: '#0a0a0a',
    surfaceHover: '#1b1b1b',
    surfaceActive: '#232323',
    surfaceBorder: '#3d434b',
    surfaceElevated: 'rgba(10, 10, 10, 0.96)',
    floatingSurface: 'rgba(10, 10, 10, 0.98)',
    floatingSurfaceHover: 'rgba(10, 10, 10, 0.98)',
    floatingSurfaceBorder: '#3d434b',
    floatingSurfaceBorderStrong: '#78818b',
    surfaceGhost: '#0a0a0a',
    surfaceGhostHover: '#0d0d0d',
    surfaceGhostActive: '#141414',
    surfaceGhostMuted: '#0a0a0a',
    pillBorder: '#3d434b',
    pillBackgroundHover: '#0a0a0a',
    pillBorderHover: '#78818b',
    tooltipSurface: 'rgba(10, 10, 10, 0.96)',
    mobileTabsSurface: 'rgba(10, 10, 10, 0.96)',
    newBestPopupSurface: 'rgba(0, 0, 0, 0.94)',
    dividerSubtle: 'rgba(255, 255, 255, 0.06)',
    textSecondary: '#a2abb5',
    textTertiary: '#78818b',
    textMuted: '#3d434b',
});

const THEME_PRESETS = Object.freeze({
    [THEME_DEFAULT_ID]: DEFAULT_THEME_COLORS,
    [THEME_OLED_ID]: OLED_THEME_COLORS,
});

const DEFAULT_BACKGROUND_IMAGE_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.9)';
const DEFAULT_THEME_BACKGROUND = Object.freeze({
    source: 'none',
    url: '',
    overlayColor: DEFAULT_BACKGROUND_IMAGE_OVERLAY_COLOR,
});

function createDefaultThemeCustomizationCollapsedSections() {
    return Object.fromEntries([
        ['simple-core', false],
        ...THEME_COLOR_SECTIONS.map((section) => [section.id, section.id.startsWith('scramble-preview')]),
        ['background-image', false],
    ]);
}

function normalizeThemeCustomizationCollapsedSections(value) {
    const source = value && typeof value === 'object' ? value : {};
    const defaults = createDefaultThemeCustomizationCollapsedSections();
    return Object.fromEntries(
        Object.entries(defaults).map(([sectionId, defaultValue]) => [sectionId, typeof source[sectionId] === 'boolean' ? source[sectionId] : defaultValue]),
    );
}

function createDefaultSettingsCollapsedSections() {
    return Object.freeze({
        tools: false,
        timer: false,
        inspection: false,
        interface: false,
        stats: false,
        graph: false,
        data: false,
        app: false,
    });
}

function normalizeSettingsCollapsedSections(value) {
    const source = value && typeof value === 'object' ? value : {};
    const defaults = createDefaultSettingsCollapsedSections();
    return Object.fromEntries(
        Object.entries(defaults).map(([sectionId, defaultValue]) => [sectionId, typeof source[sectionId] === 'boolean' ? source[sectionId] : defaultValue]),
    );
}

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeNonNegativeInteger(value, fallback = 0) {
    const normalized = Math.floor(Number(value));
    return Number.isFinite(normalized) && normalized >= 0
        ? normalized
        : Math.max(0, Math.floor(Number(fallback)) || 0);
}

export function normalizeAutoExportEvery100Solves(
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

    return AUTO_EXPORT_EVERY_100_SOLVES_VALUES.has(normalized)
        ? normalized
        : invalidValue;
}

export function normalizeInspectionTime(value) {
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

export function isInspectionTimeEnabled(value) {
    return normalizeInspectionTime(value) !== INSPECTION_TIME_OFF;
}

export function isInspectionTimeCountingDown(value) {
    return normalizeInspectionTime(value) === INSPECTION_TIME_COUNT_DOWN;
}

function normalizeTimeTableVerticalGridLines(value) {
    const normalized = typeof value === 'string'
        ? value.trim().toLowerCase()
        : String(value ?? '').trim().toLowerCase();

    return TIME_TABLE_VERTICAL_GRID_LINE_VALUES.has(normalized)
        ? normalized
        : DEFAULTS.timeTableVerticalGridLines;
}

const DEFAULTS = {
    inspectionTime: INSPECTION_TIME_OFF,  // 'off', 'ap' counting up, 'a' counting down
    inspectionAlerts: 'off', // 'off', 'voice', 'screen', 'both'
    timerUpdate: '0.01s',   // 'none', 'inspection', '1s', '0.1s', '0.01s'
    timeEntryMode: TIME_ENTRY_MODE_TIMER, // 'timer', 'typing', 'stackmat', 'bluetooth'
    multiPhaseCount: 1,
    multiPhaseHideSplitsWhileSolving: false,
    multiPhaseSoundEnabled: true,
    stackmatInputDeviceId: '',
    holdDuration: 300,       // ms
    animationMode: 'auto',   // 'auto', 'on', 'off'
    animationsEnabled: true, // Legacy effective boolean kept for backwards compatibility.
    highContrastMode: false,
    theme: THEME_DEFAULT_ID,
    customThemes: createDefaultCustomThemes(),
    customThemeBases: createDefaultCustomThemeBases(),
    customThemeBackgrounds: createDefaultCustomThemeBackgrounds(),
    settingsCollapsedSections: createDefaultSettingsCollapsedSections(),
    settingScopes: {},
    themeCustomizationMode: 'simple',
    themeCustomizationCollapsedSections: createDefaultThemeCustomizationCollapsedSections(),
    displayFont: 'jetbrains-mono',
    largeScrambleText: false,
    pillSize: 'medium',       // 'small', 'medium', 'large', 'hidden'
    dailyStreakGoal: 0,
    statsFilter: 'all',     // 'all', 'today', 'week', 'month', 'custom'
    customFilterDuration: '', // e.g. '3d', '2h', '100', '100 solves'
    summaryStatsPreset: 'basic', // 'basic', 'extended', 'full', 'custom'
    summaryStatsCustom: 'mo3 ao5 ao12 ao100',
    summaryStatsList: ['mo3', 'ao5', 'ao12', 'ao100'],
    mainStatsSource: MAIN_STATS_SOURCE_TIME,
    sessionStatsMetricMode: 'sigma',
    solvesTableStat1: 'ao5',
    solvesTableStat2: 'ao12',
    timeTableVerticalGridLines: TIME_TABLE_VERTICAL_GRID_LINES_MULTI_PHASE_ONLY,
    zenMode: false,
    cubeCollapsed: false,
    graphCollapsed: false,
    solvesPanelWidthConstrained: false,
    cameraRightPanelSecondary: 'graph',
    battleRightPanelSecondary: 'graph',
    graphView: { visibleCount: 0, yZoom: 1, xPan: 1, yPan: 0 },
    showDelta: false,
    deltaReference: '',
    newBestPopupEnabled: true,
    doubleClickPreventionEnabled: true,
    newBestColor: DEFAULT_THEME_COLORS.newBestPopup,
    graphColorTime: DEFAULT_THEME_COLORS.graphColorTime,
    graphLine1Stat: 'ao5',
    graphLine2Stat: 'ao12',
    graphLine3Stat: 'ao100',
    graphColorLine1: DEFAULT_THEME_COLORS.graphColorLine1,
    graphColorLine2: DEFAULT_THEME_COLORS.graphColorLine2,
    graphColorLine3: DEFAULT_THEME_COLORS.graphColorLine3,
    // Legacy keys kept for backwards compatibility with older exports/imports.
    graphColorAo5: DEFAULT_THEME_COLORS.graphColorLine1,
    graphColorAo12: DEFAULT_THEME_COLORS.graphColorLine2,
    graphColorAo100: DEFAULT_THEME_COLORS.graphColorLine3,
    graphTooltipDateEnabled: true,
    centerTimer: true,
    hideUIWhileSolving: true,
    backgroundSpacebarEnabled: false,
    autoExportEvery100Solves: AUTO_EXPORT_EVERY_100_SOLVES_NEVER,
    autoExportSolveSequence: 0,
    autoExportCheckpointSolveSequence: 0,
    autoExportLastReminderSolveSequence: 0,
    cameraBackgroundEnabled: false,
    cameraBackgroundSuspended: false,
    // Legacy global background fields kept for migration and older imports.
    backgroundImageSource: 'none',
    backgroundImageUrl: '',
    backgroundImageOverlayColor: DEFAULT_BACKGROUND_IMAGE_OVERLAY_COLOR,
    swipeDownGestureEnabled: true,
};

export { DEFAULTS };

const ANIMATION_MODES = new Set(['auto', 'on', 'off']);
const BACKGROUND_IMAGE_SOURCES = new Set(['none', 'link', 'upload']);
const SESSION_SCOPABLE_SETTING_KEY_SET = new Set(SESSION_SCOPABLE_SETTING_KEYS);

const DISPLAY_FONT_STACKS = {
    arial: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
    'jetbrains-mono': "'JetBrains Mono', 'Consolas', monospace",
    'roboto-mono': "'Roboto Mono', 'JetBrains Mono', 'Consolas', monospace",
    monospace: 'monospace',
};

export function isCustomThemeId(value) {
    return THEME_CUSTOM_IDS.includes(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeChannel(value) {
    return clamp(Math.round(Number(value) || 0), 0, 255);
}

function normalizeAlpha(value) {
    return clamp(Number(value) || 0, 0, 1);
}

function normalizeBackgroundImageSource(value) {
    return BACKGROUND_IMAGE_SOURCES.has(value) ? value : 'none';
}

function normalizeThemeBackground(value, fallback = DEFAULT_THEME_BACKGROUND) {
    const sourceValue = value && typeof value === 'object' ? value.source : value?.source;
    const urlValue = value && typeof value === 'object' ? value.url : value?.url;
    const overlayValue = value && typeof value === 'object' ? value.overlayColor : value?.overlayColor;
    const normalizedUrl = typeof urlValue === 'string' ? urlValue.trim() : '';
    const normalizedOverlayColor = normalizeThemeColorValue(overlayValue, fallback.overlayColor);
    const normalizedSource = normalizeBackgroundImageSource(sourceValue || (normalizedUrl ? 'link' : 'none'));

    return {
        source: normalizedSource === 'link' && !normalizedUrl ? 'none' : normalizedSource,
        url: normalizedUrl,
        overlayColor: normalizedOverlayColor,
    };
}

function componentToHex(value) {
    return normalizeChannel(value).toString(16).padStart(2, '0');
}

function trimAlpha(value) {
    return value.toFixed(2).replace(/\.?0+$/, '');
}

function parseHexThemeColor(value) {
    const match = /^#([0-9a-f]{3,8})$/i.exec(String(value || '').trim());
    if (!match) return null;

    const hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
        const [r, g, b, a = 'f'] = hex.split('').map((token) => token + token);
        return {
            r: Number.parseInt(r, 16),
            g: Number.parseInt(g, 16),
            b: Number.parseInt(b, 16),
            a: Number.parseInt(a, 16) / 255,
        };
    }

    if (hex.length === 6 || hex.length === 8) {
        return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
            a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
        };
    }

    return null;
}

function parseRgbThemeColor(value) {
    const match = /^rgba?\((.+)\)$/i.exec(String(value || '').trim());
    if (!match) return null;

    const parts = match[1].split(',').map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;

    const channels = parts.slice(0, 3).map((part) => {
        if (!/^-?\d+(\.\d+)?$/.test(part)) return null;
        return normalizeChannel(part);
    });

    if (channels.some((channel) => channel === null)) return null;

    let alpha = 1;
    if (parts.length === 4) {
        if (!/^-?\d+(\.\d+)?$/.test(parts[3])) return null;
        alpha = normalizeAlpha(parts[3]);
    }

    return {
        r: channels[0],
        g: channels[1],
        b: channels[2],
        a: alpha,
    };
}

function parseThemeColorValue(value) {
    return parseHexThemeColor(value) || parseRgbThemeColor(value);
}

export function composeThemeColor(hex, alphaPercent = 100) {
    const parsed = parseHexThemeColor(hex);
    if (!parsed) return null;

    const alpha = clamp(Math.round(Number(alphaPercent) || 0), 0, 100) / 100;
    const normalizedHex = `#${componentToHex(parsed.r)}${componentToHex(parsed.g)}${componentToHex(parsed.b)}`;
    if (alpha >= 1) return normalizedHex;
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${trimAlpha(alpha)})`;
}

function normalizeThemeColorValue(value, fallback = null) {
    const parsed = parseThemeColorValue(value);
    if (!parsed) return fallback;

    const normalizedHex = `#${componentToHex(parsed.r)}${componentToHex(parsed.g)}${componentToHex(parsed.b)}`;
    if (parsed.a >= 1) return normalizedHex;
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${trimAlpha(parsed.a)})`;
}

export function decomposeThemeColor(value, fallback = '#000000') {
    const normalized = normalizeThemeColorValue(value, fallback) || fallback;
    const parsed = parseThemeColorValue(normalized) || parseThemeColorValue(fallback) || { r: 0, g: 0, b: 0, a: 1 };
    return {
        hex: `#${componentToHex(parsed.r)}${componentToHex(parsed.g)}${componentToHex(parsed.b)}`,
        alpha: clamp(Math.round(parsed.a * 100), 0, 100),
        css: composeThemeColor(`#${componentToHex(parsed.r)}${componentToHex(parsed.g)}${componentToHex(parsed.b)}`, parsed.a * 100),
    };
}

function withAlpha(value, alpha, fallback = 'rgba(0, 0, 0, 1)') {
    const parsed = parseThemeColorValue(value);
    if (!parsed) return fallback;
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${trimAlpha(normalizeAlpha(alpha))})`;
}

function mixThemeColors(baseValue, accentValue, accentAmount, alpha = 1, fallback = 'rgba(0, 0, 0, 1)') {
    const base = parseThemeColorValue(baseValue);
    const accent = parseThemeColorValue(accentValue);
    if (!base || !accent) return fallback;

    const amount = clamp(Number(accentAmount) || 0, 0, 1);
    const mixChannel = (start, end) => Math.round(start + ((end - start) * amount));

    return `rgba(${mixChannel(base.r, accent.r)}, ${mixChannel(base.g, accent.g)}, ${mixChannel(base.b, accent.b)}, ${trimAlpha(normalizeAlpha(alpha))})`;
}

function normalizeThemeId(value) {
    return THEME_ID_SET.has(value) ? value : THEME_DEFAULT_ID;
}

function normalizeThemeBaseId(value) {
    return THEME_BASE_IDS.includes(value) ? value : THEME_DEFAULT_ID;
}

function normalizeThemeColors(themeColors, fallback = DEFAULT_THEME_COLORS) {
    const source = themeColors && typeof themeColors === 'object' ? themeColors : {};
    const normalized = {};

    THEME_COLOR_KEYS.forEach((key) => {
        const candidateKeys = LEGACY_THEME_COLOR_KEY_FALLBACKS[key] || [key];
        const matchedKey = candidateKeys.find((candidateKey) => source[candidateKey] != null && source[candidateKey] !== '');
        const sourceValue = matchedKey ? source[matchedKey] : undefined;
        normalized[key] = normalizeThemeColorValue(sourceValue, fallback[key]);
    });

    return normalized;
}

function createDefaultCustomThemes() {
    return Object.fromEntries(THEME_CUSTOM_IDS.map((themeId) => [themeId, normalizeThemeColors(DEFAULT_THEME_COLORS)]));
}

function createDefaultCustomThemeBases() {
    return Object.fromEntries(THEME_CUSTOM_IDS.map((themeId) => [themeId, THEME_DEFAULT_ID]));
}

function createDefaultCustomThemeBackgrounds() {
    return Object.fromEntries(THEME_CUSTOM_IDS.map((themeId) => [themeId, { ...DEFAULT_THEME_BACKGROUND }]));
}

function normalizeCustomThemes(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(THEME_CUSTOM_IDS.map((themeId) => {
        return [themeId, normalizeThemeColors(source[themeId], DEFAULT_THEME_COLORS)];
    }));
}

function normalizeCustomThemeBases(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(THEME_CUSTOM_IDS.map((themeId) => {
        return [themeId, normalizeThemeBaseId(source[themeId])];
    }));
}

function normalizeCustomThemeBackgrounds(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(THEME_CUSTOM_IDS.map((themeId) => {
        return [themeId, normalizeThemeBackground(source[themeId], DEFAULT_THEME_BACKGROUND)];
    }));
}

export function getThemePresetColors(themeId) {
    return normalizeThemeColors(THEME_PRESETS[normalizeThemeId(themeId)] || DEFAULT_THEME_COLORS);
}

function buildThemeStateFromLoadedSettings(loaded) {
    const explicitTheme = normalizeThemeId(loaded.theme);
    const customThemes = normalizeCustomThemes(loaded.customThemes);
    const customThemeBases = normalizeCustomThemeBases(loaded.customThemeBases);
    const hasCustomThemeBackgrounds = loaded.customThemeBackgrounds && typeof loaded.customThemeBackgrounds === 'object';
    const customThemeBackgrounds = normalizeCustomThemeBackgrounds(loaded.customThemeBackgrounds);
    const legacyBackground = normalizeThemeBackground({
        source: loaded.backgroundImageSource,
        url: loaded.backgroundImageUrl,
        overlayColor: loaded.backgroundImageOverlayColor,
    }, DEFAULT_THEME_BACKGROUND);
    const hasLegacyBackground = legacyBackground.source !== 'none'
        || legacyBackground.url !== ''
        || legacyBackground.overlayColor !== DEFAULT_THEME_BACKGROUND.overlayColor;
    const legacyBackgroundThemeId = isCustomThemeId(explicitTheme) ? explicitTheme : THEME_CUSTOM_IDS[0];
    const migratedThemeBackgrounds = (!hasCustomThemeBackgrounds && hasLegacyBackground)
        ? normalizeCustomThemeBackgrounds({
            ...customThemeBackgrounds,
            [legacyBackgroundThemeId]: legacyBackground,
        })
        : customThemeBackgrounds;

    if (typeof loaded.theme === 'string' && THEME_ID_SET.has(loaded.theme)) {
        return {
            theme: (!hasCustomThemeBackgrounds && hasLegacyBackground && !isCustomThemeId(explicitTheme))
                ? legacyBackgroundThemeId
                : explicitTheme,
            customThemes,
            customThemeBases,
            customThemeBackgrounds: migratedThemeBackgrounds,
        };
    }

    const baseThemeId = loaded.highContrastMode ? THEME_OLED_ID : THEME_DEFAULT_ID;
    const baseThemeColors = getThemePresetColors(baseThemeId);
    const migratedCustomTheme = { ...baseThemeColors };
    let hasLegacyColorOverride = false;

    Object.entries(LEGACY_THEME_FIELD_TO_TOKEN).forEach(([legacyKey, themeKey]) => {
        if (themeKey in migratedCustomTheme && normalizeThemeColorValue(loaded[legacyKey])) {
            migratedCustomTheme[themeKey] = normalizeThemeColorValue(loaded[legacyKey], migratedCustomTheme[themeKey]);
        }
    });

    ['newBestPopup', 'statNewBest', 'graphColorTime', 'graphColorLine1', 'graphColorLine2', 'graphColorLine3'].forEach((key) => {
        if (migratedCustomTheme[key] !== baseThemeColors[key]) {
            hasLegacyColorOverride = true;
        }
    });

    if (!hasLegacyColorOverride) {
        return {
            theme: baseThemeId,
            customThemes,
            customThemeBases,
            customThemeBackgrounds: migratedThemeBackgrounds,
        };
    }

    const migratedThemeBases = normalizeCustomThemeBases({
        ...customThemeBases,
        [THEME_CUSTOM_IDS[0]]: baseThemeId,
    });

    return {
        theme: THEME_CUSTOM_IDS[0],
        customThemes: normalizeCustomThemes({
            ...customThemes,
            [THEME_CUSTOM_IDS[0]]: migratedCustomTheme,
        }),
        customThemeBases: migratedThemeBases,
        customThemeBackgrounds: migratedThemeBackgrounds,
    };
}

function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function cloneSettingValue(value) {
    if (typeof value === 'object' && value !== null) {
        return JSON.parse(JSON.stringify(value));
    }
    return value;
}

function normalizeSessionSettingValue(key, value) {
    if (!SESSION_SCOPABLE_SETTING_KEY_SET.has(key)) return undefined;

    if (key === 'inspectionTime') {
        return normalizeInspectionTime(value);
    }

    if (key === 'timeEntryMode') {
        return normalizeTimeEntryMode(value);
    }

    if (key === 'multiPhaseCount') {
        return normalizePhaseCount(value, DEFAULTS.multiPhaseCount);
    }

    if (key === 'multiPhaseSoundEnabled') {
        return value !== false;
    }

    if (key === 'multiPhaseHideSplitsWhileSolving') {
        return value === true;
    }

    if (key === 'doubleClickPreventionEnabled') {
        return value !== false;
    }

    if (key === 'timeTableVerticalGridLines') {
        return normalizeTimeTableVerticalGridLines(value);
    }

    if (key === 'mainStatsSource') {
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

    if (key === 'animationMode') {
        if (value === true) return 'on';
        if (value === false) return 'off';
        return ANIMATION_MODES.has(value) ? value : DEFAULTS.animationMode;
    }

    if (key === 'theme') {
        return normalizeThemeId(value);
    }

    return cloneSettingValue(value);
}

export function normalizeSessionSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = {};

    Object.entries(source).forEach(([key, rawValue]) => {
        const nextValue = normalizeSessionSettingValue(key, rawValue);
        if (nextValue === undefined) return;
        normalized[key] = nextValue;
    });

    return normalized;
}

export function filterSessionSettingsByScopes(value, scopeMap = {}) {
    const normalizedSettings = normalizeSessionSettings(value);
    const normalizedScopes = normalizeSettingScopes(scopeMap);

    return Object.fromEntries(
        Object.entries(normalizedSettings).filter(([key]) => normalizedScopes[key] === SETTING_SCOPE_SESSION),
    );
}

class Settings extends EventEmitter {
    constructor() {
        super();
        this._motionPreferenceQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this._activeSessionId = null;
        this._storedActiveSessionSettings = {};
        this._activeSessionSettings = {};
        this._persistSessionSettings = null;
        this._persistSessionScopePersistence = null;
        this._pendingSessionPersistence = new Set();
        registerBeforeDataExportHook(() => this.waitForPendingSessionSettingsPersistence());
        const loaded = load('settings', {});
        this._settings = {
            ...DEFAULTS,
            ...loaded,
            graphView: loaded.graphView && typeof loaded.graphView === 'object'
                ? loaded.graphView
                : DEFAULTS.graphView,
            customThemes: createDefaultCustomThemes(),
            customThemeBases: createDefaultCustomThemeBases(),
            customThemeBackgrounds: createDefaultCustomThemeBackgrounds(),
            settingsCollapsedSections: loaded.settingsCollapsedSections,
            settingScopes: loaded.settingScopes,
            themeCustomizationCollapsedSections: loaded.themeCustomizationCollapsedSections,
        };
        this._settings.autoExportEvery100Solves = normalizeAutoExportEvery100Solves(
            hasOwn(loaded, 'autoExportEvery100Solves')
                ? loaded.autoExportEvery100Solves
                : loaded.googleDriveBackupReminderEvery100Solves,
            { defaultValue: DEFAULTS.autoExportEvery100Solves },
        );
        this._settings.inspectionTime = normalizeInspectionTime(this._settings.inspectionTime);
        this._settings.multiPhaseCount = normalizePhaseCount(
            this._settings.multiPhaseCount,
            DEFAULTS.multiPhaseCount,
        );
        this._settings.mainStatsSource = normalizeSessionSettingValue(
            'mainStatsSource',
            this._settings.mainStatsSource,
        );
        this._settings.timeTableVerticalGridLines = normalizeTimeTableVerticalGridLines(
            this._settings.timeTableVerticalGridLines,
        );
        this._settings.multiPhaseSoundEnabled = this._settings.multiPhaseSoundEnabled !== false;
        this._settings.multiPhaseHideSplitsWhileSolving = this._settings.multiPhaseHideSplitsWhileSolving === true;
        this._settings.doubleClickPreventionEnabled = this._settings.doubleClickPreventionEnabled !== false;
        this._settings.solvesPanelWidthConstrained = this._settings.solvesPanelWidthConstrained === true;
        const nextAutoExportCheckpointSolveSequence = normalizeNonNegativeInteger(
            hasOwn(loaded, 'autoExportCheckpointSolveSequence')
                ? loaded.autoExportCheckpointSolveSequence
                : loaded.googleDriveBackupCheckpointSolveCount,
            0,
        );
        const nextAutoExportLastReminderSolveSequence = Math.max(
            nextAutoExportCheckpointSolveSequence,
            normalizeNonNegativeInteger(
                hasOwn(loaded, 'autoExportLastReminderSolveSequence')
                    ? loaded.autoExportLastReminderSolveSequence
                    : loaded.googleDriveBackupLastReminderSolveCount,
                nextAutoExportCheckpointSolveSequence,
            ),
        );
        this._settings.autoExportSolveSequence = Math.max(
            nextAutoExportCheckpointSolveSequence,
            nextAutoExportLastReminderSolveSequence,
            normalizeNonNegativeInteger(
                hasOwn(loaded, 'autoExportSolveSequence')
                    ? loaded.autoExportSolveSequence
                    : nextAutoExportLastReminderSolveSequence,
                nextAutoExportLastReminderSolveSequence,
            ),
        );
        this._settings.autoExportCheckpointSolveSequence = nextAutoExportCheckpointSolveSequence;
        this._settings.autoExportLastReminderSolveSequence = nextAutoExportLastReminderSolveSequence;
        delete this._settings.googleDriveBackupReminderEvery100Solves;
        delete this._settings.googleDriveBackupCheckpointSolveCount;
        delete this._settings.googleDriveBackupLastReminderSolveCount;

        if (!ANIMATION_MODES.has(this._settings.animationMode)) {
            if (typeof loaded.animationsEnabled === 'boolean') {
                this._settings.animationMode = loaded.animationsEnabled ? 'on' : 'off';
            } else {
                this._settings.animationMode = DEFAULTS.animationMode;
            }
        }

        if (loaded.graphLines && typeof loaded.graphLines === 'object') {
            const nextGraphLines = { ...loaded.graphLines };
            if (!('line1' in nextGraphLines) && 'ao5' in nextGraphLines) nextGraphLines.line1 = !!nextGraphLines.ao5;
            if (!('line2' in nextGraphLines) && 'ao12' in nextGraphLines) nextGraphLines.line2 = !!nextGraphLines.ao12;
            if (!('line3' in nextGraphLines) && 'ao100' in nextGraphLines) nextGraphLines.line3 = !!nextGraphLines.ao100;
            this._settings.graphLines = nextGraphLines;
        }

        const themeState = buildThemeStateFromLoadedSettings(loaded);
        this._settings.theme = themeState.theme;
        this._settings.customThemes = themeState.customThemes;
        this._settings.customThemeBases = themeState.customThemeBases;
        this._settings.customThemeBackgrounds = themeState.customThemeBackgrounds;
        this._settings.settingsCollapsedSections = normalizeSettingsCollapsedSections(
            this._settings.settingsCollapsedSections,
        );
        this._settings.settingScopes = normalizeSettingScopes(this._settings.settingScopes);
        this._settings.themeCustomizationCollapsedSections = normalizeThemeCustomizationCollapsedSections(
            this._settings.themeCustomizationCollapsedSections,
        );

        this._syncAnimationSettings();
        this._syncThemeSettings();
        this._bindMotionPreferenceListener();
        this._apply();
    }

    get(key) {
        const val = this._getEffectiveValue(key);
        return cloneSettingValue(val);
    }

    getAll() {
        return JSON.parse(JSON.stringify(this._settings));
    }

    getActiveThemeColors() {
        return this._getActiveThemeColors();
    }

    getSettingScope(key) {
        if (!SESSION_SCOPABLE_SETTING_KEY_SET.has(key)) return SETTING_SCOPE_GLOBAL;
        return this._settings.settingScopes?.[key] === SETTING_SCOPE_SESSION
            ? SETTING_SCOPE_SESSION
            : SETTING_SCOPE_GLOBAL;
    }

    isSessionScoped(key) {
        return this.getSettingScope(key) === SETTING_SCOPE_SESSION;
    }

    canScopeSetting(key) {
        return canScopeSessionSetting(key);
    }

    getSessionOverride(key) {
        if (!SESSION_SCOPABLE_SETTING_KEY_SET.has(key)) return undefined;
        if (!Object.prototype.hasOwnProperty.call(this._activeSessionSettings, key)) return undefined;
        return cloneSettingValue(this._activeSessionSettings[key]);
    }

    configureSessionSettingsPersistence(callback) {
        this._persistSessionSettings = typeof callback === 'function' ? callback : null;
    }

    configureSessionScopePersistence(callback) {
        this._persistSessionScopePersistence = typeof callback === 'function' ? callback : null;
    }

    async waitForPendingSessionSettingsPersistence() {
        while (this._pendingSessionPersistence.size > 0) {
            await Promise.allSettled(Array.from(this._pendingSessionPersistence));
        }
    }

    normalizeSessionSettings(value) {
        return normalizeSessionSettings(value);
    }

    filterSessionSettingsByActiveScopes(value) {
        return filterSessionSettingsByScopes(value, this._settings.settingScopes);
    }

    getSessionSettingsForNewSession() {
        const nextSettings = {};
        SESSION_SCOPABLE_SETTING_KEYS.forEach((key) => {
            if (!this.isSessionScoped(key)) return;
            nextSettings[key] = this.get(key);
        });
        return normalizeSessionSettings(nextSettings);
    }

    setActiveSessionContext(sessionId, sessionSettings = {}) {
        const before = this._getEffectiveSnapshot();
        const normalizedSessionSettings = normalizeSessionSettings(sessionSettings);
        this._activeSessionId = sessionId || null;
        this._storedActiveSessionSettings = normalizedSessionSettings;
        this._activeSessionSettings = filterSessionSettingsByScopes(normalizedSessionSettings, this._settings.settingScopes);
        this._apply();
        this._emitEffectiveSettingChanges(before, this._getEffectiveSnapshot(), 'session');
        this.emit('sessionContextChange', this._activeSessionId);
    }

    setSettingScope(key, scope) {
        if (!SESSION_SCOPABLE_SETTING_KEY_SET.has(key)) return false;

        const nextScope = scope === SETTING_SCOPE_SESSION ? SETTING_SCOPE_SESSION : SETTING_SCOPE_GLOBAL;
        const linkedKeys = getLinkedSessionScopeKeys(key);
        const keysNeedingScopeChange = linkedKeys.filter((linkedKey) => this.getSettingScope(linkedKey) !== nextScope);
        if (keysNeedingScopeChange.length === 0) return false;

        const before = this._getEffectiveSnapshot();
        const previousEffectiveValues = Object.fromEntries(
            linkedKeys.map((linkedKey) => [linkedKey, this.get(linkedKey)]),
        );
        const nextScopes = normalizeSettingScopes({
            ...this._settings.settingScopes,
            ...Object.fromEntries(linkedKeys.map((linkedKey) => [linkedKey, nextScope])),
        });
        let shouldPersistSessionSettings = false;

        if (nextScope === SETTING_SCOPE_GLOBAL) {
            const nextActiveSessionSettings = { ...this._activeSessionSettings };
            const nextStoredActiveSessionSettings = { ...this._storedActiveSessionSettings };
            linkedKeys.forEach((linkedKey) => {
                if (isDefaultSessionScopedSetting(linkedKey)) {
                    nextScopes[linkedKey] = SETTING_SCOPE_GLOBAL;
                } else {
                    delete nextScopes[linkedKey];
                }
                const promotedValue = normalizeSessionSettingValue(linkedKey, previousEffectiveValues[linkedKey]);
                if (promotedValue !== undefined) {
                    this._settings[linkedKey] = promotedValue;
                }
                delete nextStoredActiveSessionSettings[linkedKey];
                if (Object.prototype.hasOwnProperty.call(nextActiveSessionSettings, linkedKey)) {
                    delete nextActiveSessionSettings[linkedKey];
                    shouldPersistSessionSettings = true;
                }
            });
            if (shouldPersistSessionSettings) {
                this._activeSessionSettings = normalizeSessionSettings(nextActiveSessionSettings);
            }
            this._storedActiveSessionSettings = normalizeSessionSettings(nextStoredActiveSessionSettings);
        } else if (this._activeSessionId) {
            linkedKeys.forEach((linkedKey) => {
                if (Object.prototype.hasOwnProperty.call(this._activeSessionSettings, linkedKey)) return;
                const restoredValue = Object.prototype.hasOwnProperty.call(this._storedActiveSessionSettings, linkedKey)
                    ? this._storedActiveSessionSettings[linkedKey]
                    : previousEffectiveValues[linkedKey];
                this._activeSessionSettings[linkedKey] = normalizeSessionSettingValue(linkedKey, restoredValue);
                this._storedActiveSessionSettings[linkedKey] = this._activeSessionSettings[linkedKey];
                shouldPersistSessionSettings = true;
            });
        }

        this._settings.settingScopes = nextScopes;
        if (shouldPersistSessionSettings) {
            this._persistActiveSessionSettings({ reconcileKeys: linkedKeys });
        }
        if (nextScope === SETTING_SCOPE_GLOBAL) {
            this._persistSessionScopeChange(linkedKeys, nextScope);
        }
        this._saveAndApply();
        linkedKeys.forEach((linkedKey) => {
            this.emit('scopeChange', linkedKey, nextScope);
        });
        this.emit('change', 'settingScopes', this.get('settingScopes'));
        this._emitEffectiveSettingChanges(before, this._getEffectiveSnapshot(), 'scope');
        return true;
    }

    _normalizeAnimationMode(value) {
        if (value === true) return 'on';
        if (value === false) return 'off';
        return ANIMATION_MODES.has(value) ? value : DEFAULTS.animationMode;
    }

    _areAnimationsEnabled(animationModeValue = this._settings.animationMode) {
        const animationMode = this._normalizeAnimationMode(animationModeValue);
        if (animationMode === 'on') return true;
        if (animationMode === 'off') return false;
        return !Boolean(this._motionPreferenceQuery?.matches);
    }

    _syncAnimationSettings() {
        this._settings.animationMode = this._normalizeAnimationMode(this._settings.animationMode);
        this._settings.animationsEnabled = this._areAnimationsEnabled();
    }

    _syncThemeSettings() {
        this._settings.theme = normalizeThemeId(this._settings.theme);
        this._settings.customThemes = normalizeCustomThemes(this._settings.customThemes);
        this._settings.customThemeBases = normalizeCustomThemeBases(this._settings.customThemeBases);
        this._settings.customThemeBackgrounds = normalizeCustomThemeBackgrounds(this._settings.customThemeBackgrounds);
        this._settings.settingsCollapsedSections = normalizeSettingsCollapsedSections(this._settings.settingsCollapsedSections);
        this._settings.settingScopes = normalizeSettingScopes(this._settings.settingScopes);
        this._settings.themeCustomizationCollapsedSections = normalizeThemeCustomizationCollapsedSections(
            this._settings.themeCustomizationCollapsedSections,
        );

        const activeTheme = this._getActiveThemeColors();
        this._settings.highContrastMode = this._settings.theme === THEME_OLED_ID;
        this._settings.newBestColor = activeTheme.newBestPopup;
        this._settings.graphColorTime = activeTheme.graphColorTime;
        this._settings.graphColorLine1 = activeTheme.graphColorLine1;
        this._settings.graphColorLine2 = activeTheme.graphColorLine2;
        this._settings.graphColorLine3 = activeTheme.graphColorLine3;
        this._settings.graphColorAo5 = activeTheme.graphColorLine1;
        this._settings.graphColorAo12 = activeTheme.graphColorLine2;
        this._settings.graphColorAo100 = activeTheme.graphColorLine3;
    }

    _getActiveThemeColors() {
        const themeId = normalizeThemeId(this._getEffectiveValue('theme'));
        if (isCustomThemeId(themeId)) {
            return normalizeThemeColors(this._settings.customThemes[themeId], DEFAULT_THEME_COLORS);
        }
        return getThemePresetColors(themeId);
    }

    _getEffectiveValue(key) {
        if (key === 'animationsEnabled') {
            return this._areAnimationsEnabled(this._getEffectiveValue('animationMode'));
        }

        if (key === 'highContrastMode') {
            return this._getEffectiveValue('theme') === THEME_OLED_ID;
        }

        if (this.isSessionScoped(key) && Object.prototype.hasOwnProperty.call(this._activeSessionSettings, key)) {
            return this._activeSessionSettings[key];
        }

        return this._settings[key];
    }

    _getEffectiveSnapshot() {
        const snapshot = {};
        SESSION_SCOPABLE_SETTING_KEYS.forEach((key) => {
            snapshot[key] = this.get(key);
        });
        snapshot.animationsEnabled = this.get('animationsEnabled');
        snapshot.highContrastMode = this.get('highContrastMode');
        return snapshot;
    }

    _emitEffectiveSettingChanges(before, after, signalType = 'modify') {
        const changedKeys = new Set();
        Object.keys(after).forEach((key) => {
            if (!deepEqual(before?.[key], after[key])) {
                changedKeys.add(key);
            }
        });

        changedKeys.forEach((key) => {
            this.emit('change', key, cloneSettingValue(after[key]), signalType);
        });
    }

    _trackPendingSessionPersistence(taskFactory, errorLabel = 'Failed to save session settings:') {
        let taskResult;
        try {
            // Run immediately so the session manager updates in-memory session state
            // before other writes serialize the same session record.
            taskResult = taskFactory();
        } catch (error) {
            console.warn(errorLabel, error);
            return Promise.resolve();
        }

        const persistTask = Promise.resolve(taskResult)
            .catch((error) => {
                console.warn(errorLabel, error);
            })
            .finally(() => {
                this._pendingSessionPersistence.delete(persistTask);
            });
        this._pendingSessionPersistence.add(persistTask);
        return persistTask;
    }

    _persistActiveSessionSettings({ reconcileKeys = null } = {}) {
        if (!this._activeSessionId || typeof this._persistSessionSettings !== 'function') return Promise.resolve();

        const sessionId = this._activeSessionId;
        const sessionSettings = filterSessionSettingsByScopes(this._activeSessionSettings, this._settings.settingScopes);
        const normalizedReconcileKeys = Array.from(new Set(
            (Array.isArray(reconcileKeys) && reconcileKeys.length > 0
                ? reconcileKeys
                : getSessionScopedSettingKeys(this._settings.settingScopes))
                .filter((key) => SESSION_SCOPABLE_SETTING_KEY_SET.has(key)),
        ));
        return this._trackPendingSessionPersistence(
            () => this._persistSessionSettings(sessionId, sessionSettings, {
                reconcileKeys: normalizedReconcileKeys,
            }),
            'Failed to save session settings:',
        );
    }

    _persistSessionScopeChange(keys, scope) {
        if (typeof this._persistSessionScopePersistence !== 'function') return Promise.resolve();

        const uniqueKeys = Array.from(new Set(
            (Array.isArray(keys) ? keys : []).filter((key) => SESSION_SCOPABLE_SETTING_KEY_SET.has(key)),
        ));
        if (uniqueKeys.length === 0) return Promise.resolve();

        return this._trackPendingSessionPersistence(
            () => this._persistSessionScopePersistence(uniqueKeys, scope, { activeSessionId: this._activeSessionId }),
            'Failed to update session scope persistence:',
        );
    }

    _setSessionSetting(key, value) {
        if (!SESSION_SCOPABLE_SETTING_KEY_SET.has(key) || !this._activeSessionId) {
            this.setSettingScope(key, SETTING_SCOPE_GLOBAL);
            this.set(key, value);
            return;
        }

        const nextVal = normalizeSessionSettingValue(key, value);
        if (nextVal === undefined) return;

        if (deepEqual(this._activeSessionSettings[key], nextVal)) return;

        this._activeSessionSettings = {
            ...this._activeSessionSettings,
            [key]: nextVal,
        };
        this._storedActiveSessionSettings = {
            ...this._storedActiveSessionSettings,
            [key]: nextVal,
        };
        this._persistActiveSessionSettings();
        this._apply();
        this.emit('change', key, cloneSettingValue(nextVal));

        if (key === 'animationMode') {
            this.emit('change', 'animationsEnabled', this.get('animationsEnabled'));
        }

        if (key === 'theme') {
            this.emit('change', 'highContrastMode', this.get('highContrastMode'));
        }
    }

    _bindMotionPreferenceListener() {
        if (!this._motionPreferenceQuery) return;

        const handleMotionPreferenceChange = () => {
            if (this.get('animationMode') !== 'auto') return;

            const previousEnabled = this.get('animationsEnabled');
            this._syncAnimationSettings();

            if (previousEnabled === this.get('animationsEnabled')) return;

            this._syncThemeSettings();
            save('settings', this._settings);
            this._apply();
        };

        if (typeof this._motionPreferenceQuery.addEventListener === 'function') {
            this._motionPreferenceQuery.addEventListener('change', handleMotionPreferenceChange);
        } else if (typeof this._motionPreferenceQuery.addListener === 'function') {
            this._motionPreferenceQuery.addListener(handleMotionPreferenceChange);
        }
    }

    _saveAndApply() {
        this._syncAnimationSettings();
        this._syncThemeSettings();
        save('settings', this._settings);
        this._apply();
    }

    set(key, value) {
        if (key === 'animationsEnabled') {
            key = 'animationMode';
            value = value ? 'on' : 'off';
        }

        if (key === 'highContrastMode') {
            this.set('theme', value ? THEME_OLED_ID : THEME_DEFAULT_ID);
            return;
        }

        if (this.isSessionScoped(key)) {
            this._setSessionSetting(key, value);
            return;
        }

        if (key in LEGACY_THEME_FIELD_TO_TOKEN) {
            const nextColor = normalizeThemeColorValue(value);
            if (!nextColor) return;

            const themeToken = LEGACY_THEME_FIELD_TO_TOKEN[key];
            const targetThemeId = isCustomThemeId(this._settings.theme) ? this._settings.theme : THEME_CUSTOM_IDS[0];
            const nextCustomThemes = normalizeCustomThemes(this._settings.customThemes);
            if (nextCustomThemes[targetThemeId][themeToken] === nextColor && this._settings.theme === targetThemeId) return;

            const previousThemeId = this._settings.theme;
            nextCustomThemes[targetThemeId][themeToken] = nextColor;
            this._settings.theme = targetThemeId;
            this._settings.customThemes = nextCustomThemes;
            this._saveAndApply();

            if (previousThemeId !== targetThemeId) {
                this.emit('change', 'theme', targetThemeId);
                this.emit('change', 'highContrastMode', this._settings.highContrastMode);
            }

            this.emit('change', 'customThemes', this.get('customThemes'));
            this.emit('change', key, nextColor);
            return;
        }

        if (key === 'timeEntryMode') {
            const nextTimeEntryMode = normalizeTimeEntryMode(value);
            if (this._settings.timeEntryMode === nextTimeEntryMode) return;

            this._settings.timeEntryMode = nextTimeEntryMode;
            this._saveAndApply();
            this.emit('change', 'timeEntryMode', nextTimeEntryMode);
            return;
        }

        if (key === 'inspectionTime') {
            const nextInspectionTime = normalizeInspectionTime(value);
            if (this._settings.inspectionTime === nextInspectionTime) return;

            this._settings.inspectionTime = nextInspectionTime;
            this._saveAndApply();
            this.emit('change', 'inspectionTime', nextInspectionTime);
            return;
        }

        if (key === 'multiPhaseCount') {
            const nextPhaseCount = normalizePhaseCount(value, DEFAULTS.multiPhaseCount);
            if (this._settings.multiPhaseCount === nextPhaseCount) return;

            this._settings.multiPhaseCount = nextPhaseCount;
            this._saveAndApply();
            this.emit('change', 'multiPhaseCount', nextPhaseCount);
            return;
        }

        if (key === 'multiPhaseSoundEnabled') {
            const nextEnabled = value !== false;
            if (this._settings.multiPhaseSoundEnabled === nextEnabled) return;

            this._settings.multiPhaseSoundEnabled = nextEnabled;
            this._saveAndApply();
            this.emit('change', 'multiPhaseSoundEnabled', nextEnabled);
            return;
        }

        if (key === 'multiPhaseHideSplitsWhileSolving') {
            const nextEnabled = value === true;
            if (this._settings.multiPhaseHideSplitsWhileSolving === nextEnabled) return;

            this._settings.multiPhaseHideSplitsWhileSolving = nextEnabled;
            this._saveAndApply();
            this.emit('change', 'multiPhaseHideSplitsWhileSolving', nextEnabled);
            return;
        }

        if (key === 'doubleClickPreventionEnabled') {
            const nextEnabled = value !== false;
            if (this._settings.doubleClickPreventionEnabled === nextEnabled) return;

            this._settings.doubleClickPreventionEnabled = nextEnabled;
            this._saveAndApply();
            this.emit('change', 'doubleClickPreventionEnabled', nextEnabled);
            return;
        }

        if (key === 'timeTableVerticalGridLines') {
            const nextMode = normalizeTimeTableVerticalGridLines(value);
            if (this._settings.timeTableVerticalGridLines === nextMode) return;

            this._settings.timeTableVerticalGridLines = nextMode;
            this._saveAndApply();
            this.emit('change', 'timeTableVerticalGridLines', nextMode);
            return;
        }

        if (key === 'mainStatsSource') {
            const nextSource = normalizeSessionSettingValue('mainStatsSource', value);
            if (this._settings.mainStatsSource === nextSource) return;

            this._settings.mainStatsSource = nextSource;
            this._saveAndApply();
            this.emit('change', 'mainStatsSource', nextSource);
            return;
        }

        if (key === 'animationMode') {
            const nextAnimationMode = this._normalizeAnimationMode(value);
            if (this._settings.animationMode === nextAnimationMode) return;

            this._settings.animationMode = nextAnimationMode;
            this._saveAndApply();
            this.emit('change', 'animationMode', nextAnimationMode);
            this.emit('change', 'animationsEnabled', this._settings.animationsEnabled);
            return;
        }

        if (key === 'theme') {
            const nextTheme = normalizeThemeId(value);
            if (this._settings.theme === nextTheme) return;

            this._settings.theme = nextTheme;
            this._saveAndApply();
            this.emit('change', 'theme', nextTheme);
            this.emit('change', 'highContrastMode', this._settings.highContrastMode);
            return;
        }

        if (key === 'customThemes') {
            const nextCustomThemes = normalizeCustomThemes(value);
            if (deepEqual(this._settings.customThemes, nextCustomThemes)) return;

            this._settings.customThemes = nextCustomThemes;
            this._saveAndApply();
            this.emit('change', 'customThemes', this.get('customThemes'));
            return;
        }

        if (key === 'customThemeBases') {
            const nextCustomThemeBases = normalizeCustomThemeBases(value);
            if (deepEqual(this._settings.customThemeBases, nextCustomThemeBases)) return;

            this._settings.customThemeBases = nextCustomThemeBases;
            this._saveAndApply();
            this.emit('change', 'customThemeBases', this.get('customThemeBases'));
            return;
        }

        if (key === 'customThemeBackgrounds') {
            const nextCustomThemeBackgrounds = normalizeCustomThemeBackgrounds(value);
            if (deepEqual(this._settings.customThemeBackgrounds, nextCustomThemeBackgrounds)) return;

            this._settings.customThemeBackgrounds = nextCustomThemeBackgrounds;
            this._saveAndApply();
            this.emit('change', 'customThemeBackgrounds', this.get('customThemeBackgrounds'));
            return;
        }

        if (key === 'settingsCollapsedSections') {
            const nextCollapsedSections = normalizeSettingsCollapsedSections(value);
            if (deepEqual(this._settings.settingsCollapsedSections, nextCollapsedSections)) return;

            this._settings.settingsCollapsedSections = nextCollapsedSections;
            this._saveAndApply();
            this.emit('change', 'settingsCollapsedSections', this.get('settingsCollapsedSections'));
            return;
        }

        if (key === 'themeCustomizationCollapsedSections') {
            const nextCollapsedSections = normalizeThemeCustomizationCollapsedSections(value);
            if (deepEqual(this._settings.themeCustomizationCollapsedSections, nextCollapsedSections)) return;

            this._settings.themeCustomizationCollapsedSections = nextCollapsedSections;
            this._saveAndApply();
            this.emit('change', 'themeCustomizationCollapsedSections', this.get('themeCustomizationCollapsedSections'));
            return;
        }

        if (key === 'autoExportEvery100Solves') {
            const nextAutoExportEvery100Solves = normalizeAutoExportEvery100Solves(value, {
                defaultValue: DEFAULTS.autoExportEvery100Solves,
            });
            if (this._settings.autoExportEvery100Solves === nextAutoExportEvery100Solves) return;

            this._settings.autoExportEvery100Solves = nextAutoExportEvery100Solves;
            this._saveAndApply();
            this.emit('change', 'autoExportEvery100Solves', nextAutoExportEvery100Solves);
            return;
        }

        const isObj = typeof value === 'object' && value !== null;
        const nextVal = isObj ? JSON.parse(JSON.stringify(value)) : value;
        if (!isObj && this._settings[key] === nextVal) return;

        this._settings[key] = nextVal;
        this._saveAndApply();
        this.emit('change', key, nextVal);
    }

    reset() {
        this._settings = {
            ...DEFAULTS,
            graphView: { ...DEFAULTS.graphView },
            summaryStatsList: [...DEFAULTS.summaryStatsList],
            customThemes: createDefaultCustomThemes(),
            customThemeBases: createDefaultCustomThemeBases(),
            customThemeBackgrounds: createDefaultCustomThemeBackgrounds(),
            settingsCollapsedSections: createDefaultSettingsCollapsedSections(),
            settingScopes: {},
            themeCustomizationCollapsedSections: createDefaultThemeCustomizationCollapsedSections(),
        };
        this._storedActiveSessionSettings = {};
        this._activeSessionSettings = {};
        this._persistActiveSessionSettings({ reconcileKeys: SESSION_SCOPABLE_SETTING_KEYS });
        this._persistSessionScopeChange(SESSION_SCOPABLE_SETTING_KEYS, SETTING_SCOPE_GLOBAL);
        this._syncAnimationSettings();
        this._syncThemeSettings();
        save('settings', this._settings);
        this._apply();
        this.emit('reset');
    }

    _apply() {
        this._syncAnimationSettings();
        this._syncThemeSettings();

        const effectiveAnimationEnabled = this.get('animationsEnabled');
        const effectiveTheme = normalizeThemeId(this.get('theme'));
        const effectiveTimeEntryMode = normalizeTimeEntryMode(this.get('timeEntryMode'));
        const effectivePillSize = ['small', 'medium', 'large', 'hidden'].includes(this.get('pillSize'))
            ? this.get('pillSize')
            : DEFAULTS.pillSize;

        document.body.classList.toggle('no-animations', !effectiveAnimationEnabled);
        document.body.classList.toggle('high-contrast-mode', effectiveTheme === THEME_OLED_ID);
        document.body.classList.toggle('typing-entry-mode', effectiveTimeEntryMode === TIME_ENTRY_MODE_TYPING);
        document.body.classList.toggle(
            'background-spacebar-enabled',
            Boolean(this.get('backgroundSpacebarEnabled')) && effectiveTimeEntryMode === TIME_ENTRY_MODE_TIMER,
        );

        document.body.classList.remove('pill-size-small', 'pill-size-medium', 'pill-size-large', 'pill-size-hidden');
        document.body.classList.add(`pill-size-${effectivePillSize}`);

        const displayFont = DISPLAY_FONT_STACKS[this.get('displayFont')] || DISPLAY_FONT_STACKS[DEFAULTS.displayFont];
        document.documentElement.style.setProperty('--font-mono', displayFont);
        document.documentElement.style.setProperty('--font-timer', displayFont);

        const themeColors = this._getActiveThemeColors();
        THEME_COLOR_ITEMS.forEach(({ key, variable }) => {
            document.documentElement.style.setProperty(variable, themeColors[key]);
        });

        document.documentElement.style.setProperty('--graph-color-ao5', themeColors.graphColorLine1);
        document.documentElement.style.setProperty('--graph-color-ao12', themeColors.graphColorLine2);
        document.documentElement.style.setProperty('--graph-color-ao100', themeColors.graphColorLine3);
        document.documentElement.style.setProperty('--danger', themeColors.dangerPenalty);
        document.documentElement.style.setProperty('--success', themeColors.statBest);
        document.documentElement.style.setProperty('--new-best-popup-border', withAlpha(themeColors.newBestPopup, 0.45, 'rgba(63, 185, 80, 0.45)'));
        document.documentElement.style.setProperty('--danger-popup-surface', mixThemeColors(themeColors.bgPrimary, themeColors.dangerPenalty, 0.18, 0.94, 'rgba(55, 29, 32, 0.94)'));
        document.documentElement.style.setProperty('--danger-bg-soft', withAlpha(themeColors.dangerPenalty, 0.1, 'rgba(248, 81, 73, 0.1)'));
        document.documentElement.style.setProperty('--danger-bg-strong', withAlpha(themeColors.dangerPenalty, 0.15, 'rgba(248, 81, 73, 0.15)'));
        document.documentElement.style.setProperty('--danger-bg-hover', withAlpha(themeColors.dangerPenalty, 0.2, 'rgba(248, 81, 73, 0.2)'));
        document.documentElement.style.setProperty('--danger-border', withAlpha(themeColors.dangerPenalty, 0.5, 'rgba(248, 81, 73, 0.5)'));
        document.documentElement.style.setProperty('--danger-border-strong', withAlpha(themeColors.dangerPenalty, 0.6, 'rgba(248, 81, 73, 0.6)'));
        document.documentElement.style.setProperty('--timer-delta-glow-strong', withAlpha(themeColors.bgPrimary, 1, 'rgba(12, 17, 22, 1)'));
        document.documentElement.style.setProperty('--timer-delta-glow-soft', withAlpha(themeColors.bgPrimary, 0.92, 'rgba(12, 17, 22, 0.92)'));
        document.documentElement.style.setProperty('--distribution-legend-bg', withAlpha(themeColors.floatingSurface, 0.92, 'rgba(13, 17, 23, 0.92)'));
        document.documentElement.style.setProperty('--distribution-legend-border', themeColors.floatingSurfaceBorderStrong);
        document.documentElement.style.setProperty('--distribution-selected-stroke', themeColors.accentHover);

        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            const { hex } = decomposeThemeColor(themeColors.bgPrimary, DEFAULT_THEME_COLORS.bgPrimary);
            themeColorMeta.setAttribute('content', hex);
        }
    }
}

export const settings = new Settings();
