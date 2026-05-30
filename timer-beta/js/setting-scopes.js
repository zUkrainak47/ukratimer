export const SETTING_SCOPE_GLOBAL = 'global';
export const SETTING_SCOPE_SESSION = 'session';

// Keep settings-panel entries aligned with the settings scope UI. A few scoped
// settings are controlled from their own UI surface instead.
export const SESSION_SCOPABLE_SETTING_KEYS = Object.freeze([
    'inspectionTime',
    'inspectionAlerts',
    'timerUpdate',
    'timeEntryMode',
    'multiPhaseCount',
    'multiPhaseSoundEnabled',
    'theme',
    'animationMode',
    'displayFont',
    'largeScrambleText',
    'pillSize',
    'summaryStatsPreset',
    'summaryStatsCustom',
    'summaryStatsList',
    'mainStatsSource',
    'solvesTableStat1',
    'solvesTableStat2',
    'showDelta',
    'deltaReference',
    'newBestPopupEnabled',
    'graphTooltipDateEnabled',
    'graphLine1Stat',
    'graphLine2Stat',
    'graphLine3Stat',
    'centerTimer',
    'hideUIWhileSolving',
    'backgroundSpacebarEnabled',
    'cameraBackgroundEnabled',
]);

export const DEFAULT_SESSION_SCOPED_SETTING_KEYS = Object.freeze([
    'multiPhaseCount',
    'mainStatsSource',
]);

export const SUMMARY_STATS_SCOPE_SETTING_KEYS = Object.freeze([
    'summaryStatsPreset',
    'summaryStatsCustom',
    'summaryStatsList',
]);

const LINKED_SESSION_SCOPE_GROUPS = Object.freeze([
    SUMMARY_STATS_SCOPE_SETTING_KEYS,
]);

const SESSION_SCOPABLE_SETTING_KEY_SET = new Set(SESSION_SCOPABLE_SETTING_KEYS);
const DEFAULT_SESSION_SCOPED_SETTING_KEY_SET = new Set(DEFAULT_SESSION_SCOPED_SETTING_KEYS);
const LINKED_SESSION_SCOPE_KEY_MAP = new Map();

LINKED_SESSION_SCOPE_GROUPS.forEach((group) => {
    group.forEach((key) => {
        LINKED_SESSION_SCOPE_KEY_MAP.set(key, group);
    });
});

export function canScopeSetting(key) {
    return SESSION_SCOPABLE_SETTING_KEY_SET.has(key);
}

export function isDefaultSessionScopedSetting(key) {
    return DEFAULT_SESSION_SCOPED_SETTING_KEY_SET.has(key);
}

export function getLinkedSessionScopeKeys(key) {
    const group = LINKED_SESSION_SCOPE_KEY_MAP.get(key);
    return group ? [...group] : [key];
}

export function normalizeSettingScopes(scopeMap) {
    const source = scopeMap && typeof scopeMap === 'object' ? scopeMap : {};
    const normalized = {};

    Object.entries(source).forEach(([key, scope]) => {
        if (!canScopeSetting(key)) return;
        if (scope === SETTING_SCOPE_SESSION) {
            normalized[key] = SETTING_SCOPE_SESSION;
        } else if (scope === SETTING_SCOPE_GLOBAL && isDefaultSessionScopedSetting(key)) {
            normalized[key] = SETTING_SCOPE_GLOBAL;
        }
    });

    LINKED_SESSION_SCOPE_GROUPS.forEach((group) => {
        if (!group.some((key) => normalized[key] === SETTING_SCOPE_SESSION)) return;
        group.forEach((key) => {
            normalized[key] = SETTING_SCOPE_SESSION;
        });
    });

    DEFAULT_SESSION_SCOPED_SETTING_KEYS.forEach((key) => {
        if (!canScopeSetting(key) || normalized[key] === SETTING_SCOPE_GLOBAL) return;
        normalized[key] = SETTING_SCOPE_SESSION;
    });

    return normalized;
}

export function getSessionScopedSettingKeys(scopeMap) {
    return Object.entries(normalizeSettingScopes(scopeMap))
        .filter(([, scope]) => scope === SETTING_SCOPE_SESSION)
        .map(([key]) => key);
}
