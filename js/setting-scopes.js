export const SETTING_SCOPE_GLOBAL = 'global';
export const SETTING_SCOPE_SESSION = 'session';

// Keep this list aligned with the settings scope UI until non-settings-panel controls
// get their own scope affordances.
export const SESSION_SCOPABLE_SETTING_KEYS = Object.freeze([
    'inspectionTime',
    'inspectionAlerts',
    'timerUpdate',
    'timeEntryMode',
    'theme',
    'animationMode',
    'displayFont',
    'largeScrambleText',
    'pillSize',
    'summaryStatsPreset',
    'summaryStatsCustom',
    'summaryStatsList',
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

export const SUMMARY_STATS_SCOPE_SETTING_KEYS = Object.freeze([
    'summaryStatsPreset',
    'summaryStatsCustom',
    'summaryStatsList',
]);

const LINKED_SESSION_SCOPE_GROUPS = Object.freeze([
    SUMMARY_STATS_SCOPE_SETTING_KEYS,
]);

const SESSION_SCOPABLE_SETTING_KEY_SET = new Set(SESSION_SCOPABLE_SETTING_KEYS);
const LINKED_SESSION_SCOPE_KEY_MAP = new Map();

LINKED_SESSION_SCOPE_GROUPS.forEach((group) => {
    group.forEach((key) => {
        LINKED_SESSION_SCOPE_KEY_MAP.set(key, group);
    });
});

export function canScopeSetting(key) {
    return SESSION_SCOPABLE_SETTING_KEY_SET.has(key);
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
        }
    });

    LINKED_SESSION_SCOPE_GROUPS.forEach((group) => {
        if (!group.some((key) => normalized[key] === SETTING_SCOPE_SESSION)) return;
        group.forEach((key) => {
            normalized[key] = SETTING_SCOPE_SESSION;
        });
    });

    return normalized;
}

export function getSessionScopedSettingKeys(scopeMap) {
    return Object.keys(normalizeSettingScopes(scopeMap));
}
