import { settings } from './settings.js?v=2026071401';
import { SCRAMBLE_TYPE_OPTIONS } from './scramble.js?v=2026071401';
import { sessionManager } from './session.js?v=2026071401';
import {
    computeDailyStreakState,
    dailyStreakStore,
    dayKeyToTimestamp,
    normalizeDailyStreakGoal,
    shiftDayKey,
    toDayKey,
} from './streaks.js?v=2026071401';
import { formatReadableDate, formatTime, getEffectiveTime } from './utils.js?v=2026071401';

const WEEK_COUNT = 53;
const DAYS_PER_WEEK = 7;
const WEEKDAY_LABELS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const ALL_FILTER_VALUE = 'all';
const FILTER_MODE_SCRAMBLE_TYPE = 'scrambleType';
const FILTER_MODE_SESSION = 'session';
const HEATMAP_METRIC_TOTAL_TIME = 'totalTime';
const HEATMAP_METRIC_BEST_TIME = 'bestTime';
const HEATMAP_METRIC_MEAN_TIME = 'meanTime';
const HEATMAP_METRIC_SETTING = 'dailyStreakHeatmapMetric';
const HEATMAP_METRICS = Object.freeze({
    [HEATMAP_METRIC_TOTAL_TIME]: Object.freeze({
        label: 'Total time',
        lessLabel: 'Less',
        moreLabel: 'More',
        levelQualifiers: Object.freeze(['lower', 'moderate', 'higher', 'highest']),
    }),
    [HEATMAP_METRIC_BEST_TIME]: Object.freeze({
        label: 'Best time',
        lessLabel: 'Slower',
        moreLabel: 'Faster',
        levelQualifiers: Object.freeze(['highest', 'higher', 'lower', 'lowest']),
        invertScale: true,
        colorActiveDays: true,
    }),
    [HEATMAP_METRIC_MEAN_TIME]: Object.freeze({
        label: 'Mean time',
        lessLabel: 'Slower',
        moreLabel: 'Faster',
        levelQualifiers: Object.freeze(['highest', 'higher', 'lower', 'lowest']),
        invertScale: true,
        colorActiveDays: true,
    }),
});
const HYDRATION_RETRY_YIELD_MS = 0;
const HEATMAP_GREEN_STOPS = Object.freeze([
    Object.freeze({ r: 2, g: 58, b: 22 }),
    Object.freeze({ r: 24, g: 109, b: 46 }),
    Object.freeze({ r: 43, g: 160, b: 68 }),
    Object.freeze({ r: 87, g: 212, b: 99 }),
]);
const HEATMAP_SINGLE_VALUE_RATIO = 0.5;
const SCRAMBLE_TYPE_LABEL_BY_ID = new Map(
    SCRAMBLE_TYPE_OPTIONS.map((option) => [
        option.id,
        option.menuLabel || option.buttonLabel || option.id,
    ]),
);
const SCRAMBLE_TYPE_ORDER_BY_ID = new Map(
    SCRAMBLE_TYPE_OPTIONS.map((option, index) => [option.id, index]),
);
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
const fullMonthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long' });
const touchPrimaryQuery = window.matchMedia('(hover: none) and (pointer: coarse)');

let _overlay = null;
let _modalBox = null;
let _closeButton = null;
let _requestHistoryState = null;
let _dismissHistoryState = null;
let _subtitle = null;
let _overview = null;
let _weekdayLabels = null;
let _monthLabels = null;
let _grid = null;
let _calendarScroll = null;
let _tooltip = null;
let _detail = null;
let _legend = null;
let _emptyState = null;
let _filterModeSelect = null;
let _filterValueLabel = null;
let _filterValueSelect = null;
let _heatmapMetricSelect = null;
let _mouseDownTarget = null;
let _mouseUpTarget = null;
let _initialized = false;
let _openRequestId = 0;
let _openPromise = null;

let _state = createEmptyState();

function createEmptyState() {
    return {
        isOpen: false,
        todayKey: toDayKey(Date.now()),
        goal: 0,
        streakState: null,
        daySummaries: new Map(),
        firstVisibleDayKey: '',
        selectedDayKey: '',
        hoveredDayKey: '',
        buttonByDayKey: new Map(),
        filterMode: FILTER_MODE_SCRAMBLE_TYPE,
        scrambleTypeFilter: ALL_FILTER_VALUE,
        sessionFilter: ALL_FILTER_VALUE,
        heatmapMetric: normalizeHeatmapMetric(settings.get(HEATMAP_METRIC_SETTING)),
        availableScrambleTypes: [],
        availableSessions: [],
        hasAnySolves: false,
        heatmapValues: [],
        totalSolves: 0,
        activeDays: 0,
        goalDays: 0,
        bestStreak: 0,
    };
}

function plural(count, singular, pluralForm = `${singular}s`) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

function isTouchLikePointer(pointerType) {
    return pointerType === 'touch' || pointerType === 'pen';
}

function shouldUseTouchInteraction(pointerType = null) {
    if (pointerType === 'mouse') return false;
    if (isTouchLikePointer(pointerType)) return true;
    return touchPrimaryQuery.matches;
}

function getWeekday(dayKey) {
    return new Date(dayKeyToTimestamp(dayKey)).getDay();
}

function getStartOfWeekKey(dayKey) {
    return shiftDayKey(dayKey, -getWeekday(dayKey));
}

function getVisibleRange(todayKey) {
    const currentWeekStart = getStartOfWeekKey(todayKey);
    return {
        firstDayKey: shiftDayKey(currentWeekStart, -(WEEK_COUNT - 1) * DAYS_PER_WEEK),
        currentWeekStart,
    };
}

function createDaySummary(dayKey) {
    return {
        dayKey,
        count: 0,
        validCount: 0,
        dnfCount: 0,
        plus2Count: 0,
        bestTime: null,
        meanTime: null,
        totalTime: 0,
        resultTimeTotal: 0,
        firstTimestamp: null,
        lastTimestamp: null,
    };
}

function getScrambleTypeLabel(type) {
    return SCRAMBLE_TYPE_LABEL_BY_ID.get(type) || String(type || '').toUpperCase();
}

function sortScrambleTypes(types) {
    return [...types].sort((left, right) => {
        const leftIndex = SCRAMBLE_TYPE_ORDER_BY_ID.has(left)
            ? SCRAMBLE_TYPE_ORDER_BY_ID.get(left)
            : Number.POSITIVE_INFINITY;
        const rightIndex = SCRAMBLE_TYPE_ORDER_BY_ID.has(right)
            ? SCRAMBLE_TYPE_ORDER_BY_ID.get(right)
            : Number.POSITIVE_INFINITY;

        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return getScrambleTypeLabel(left).localeCompare(getScrambleTypeLabel(right));
    });
}

function normalizeScrambleType(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getSolveScrambleType(solve, sessionById) {
    const solveScrambleType = normalizeScrambleType(solve?.scrambleType);
    if (solveScrambleType) return solveScrambleType;

    const sessionScrambleType = normalizeScrambleType(sessionById.get(solve?.sessionId)?.scrambleType);
    return sessionScrambleType;
}

function buildFilterContext(solves) {
    const sessions = sessionManager.getSessions();
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const scrambleTypeSet = new Set();

    sessions.forEach((session) => {
        const scrambleType = normalizeScrambleType(session?.scrambleType);
        if (scrambleType) scrambleTypeSet.add(scrambleType);
    });

    (Array.isArray(solves) ? solves : []).forEach((solve) => {
        const scrambleType = getSolveScrambleType(solve, sessionById);
        if (scrambleType) scrambleTypeSet.add(scrambleType);
    });

    return {
        sessions,
        sessionById,
        availableScrambleTypes: sortScrambleTypes(scrambleTypeSet),
    };
}

function normalizeFilterMode(mode) {
    return mode === FILTER_MODE_SESSION ? FILTER_MODE_SESSION : FILTER_MODE_SCRAMBLE_TYPE;
}

function normalizeHeatmapMetric(metric) {
    return HEATMAP_METRICS[metric] ? metric : HEATMAP_METRIC_TOTAL_TIME;
}

function getHeatmapMetric() {
    return HEATMAP_METRICS[normalizeHeatmapMetric(_state.heatmapMetric)];
}

function getResolvedFilters(context) {
    const scrambleTypeSet = new Set(context.availableScrambleTypes);
    const sessionIdSet = new Set(context.sessions.map((session) => session.id));
    const filterMode = normalizeFilterMode(_state.filterMode);
    const scrambleTypeFilter = _state.scrambleTypeFilter === ALL_FILTER_VALUE || scrambleTypeSet.has(_state.scrambleTypeFilter)
        ? _state.scrambleTypeFilter
        : ALL_FILTER_VALUE;
    const sessionFilter = _state.sessionFilter === ALL_FILTER_VALUE || sessionIdSet.has(_state.sessionFilter)
        ? _state.sessionFilter
        : ALL_FILTER_VALUE;

    return {
        filterMode,
        scrambleTypeFilter,
        sessionFilter,
    };
}

function filterSolves(solves, context, filters) {
    return (Array.isArray(solves) ? solves : []).filter((solve) => {
        if (
            filters.filterMode === FILTER_MODE_SESSION
            && filters.sessionFilter !== ALL_FILTER_VALUE
            && solve?.sessionId !== filters.sessionFilter
        ) {
            return false;
        }

        if (
            filters.filterMode === FILTER_MODE_SCRAMBLE_TYPE
            && filters.scrambleTypeFilter !== ALL_FILTER_VALUE
            && getSolveScrambleType(solve, context.sessionById) !== filters.scrambleTypeFilter
        ) {
            return false;
        }

        return true;
    });
}

function buildDaySummaries(solves, goal) {
    const daySummaries = new Map();

    (Array.isArray(solves) ? solves : []).forEach((solve) => {
        if (!solve || !Number.isFinite(solve.timestamp)) return;
        const dayKey = toDayKey(solve.timestamp);
        let summary = daySummaries.get(dayKey);
        if (!summary) {
            summary = createDaySummary(dayKey);
            daySummaries.set(dayKey, summary);
        }

        summary.count += 1;
        summary.plus2Count += solve.penalty === '+2' ? 1 : 0;
        summary.dnfCount += solve.penalty === 'DNF' ? 1 : 0;
        summary.firstTimestamp = summary.firstTimestamp == null
            ? solve.timestamp
            : Math.min(summary.firstTimestamp, solve.timestamp);
        summary.lastTimestamp = summary.lastTimestamp == null
            ? solve.timestamp
            : Math.max(summary.lastTimestamp, solve.timestamp);

        const solvingTime = Math.round(Number(solve.time));
        if (Number.isFinite(solvingTime) && solvingTime >= 0) {
            summary.totalTime += solvingTime;
        }

        const effectiveTime = getEffectiveTime(solve);
        if (Number.isFinite(effectiveTime)) {
            summary.validCount += 1;
            summary.resultTimeTotal += effectiveTime;
            summary.bestTime = summary.bestTime == null
                ? effectiveTime
                : Math.min(summary.bestTime, effectiveTime);
        }
    });

    daySummaries.forEach((summary) => {
        summary.meanTime = summary.validCount > 0 ? summary.resultTimeTotal / summary.validCount : null;
        summary.goalMet = goal > 0 && summary.count >= goal;
    });

    return daySummaries;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function interpolate(left, right, ratio) {
    return left + ((right - left) * ratio);
}

function getHeatmapColor(ratio) {
    const normalizedRatio = clamp(ratio, 0, 1);
    const scaledRatio = normalizedRatio * (HEATMAP_GREEN_STOPS.length - 1);
    const leftIndex = Math.floor(scaledRatio);
    const rightIndex = Math.min(leftIndex + 1, HEATMAP_GREEN_STOPS.length - 1);
    const stopRatio = scaledRatio - leftIndex;
    const left = HEATMAP_GREEN_STOPS[leftIndex];
    const right = HEATMAP_GREEN_STOPS[rightIndex];
    const r = Math.round(interpolate(left.r, right.r, stopRatio));
    const g = Math.round(interpolate(left.g, right.g, stopRatio));
    const b = Math.round(interpolate(left.b, right.b, stopRatio));
    return `rgb(${r}, ${g}, ${b})`;
}

function shouldUseSummaryForHeatmap(summary, goal) {
    if (!summary) return false;
    if (getHeatmapMetric().colorActiveDays) return summary.count > 0;
    return goal > 0 ? Boolean(summary.goalMet) : summary.count > 0;
}

function getSummaryHeatmapValue(summary) {
    const value = summary?.[normalizeHeatmapMetric(_state.heatmapMetric)];
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function getVisibleHeatmapValues(daySummaries, firstDayKey, todayKey, goal) {
    const values = [];
    let cursorKey = firstDayKey;

    while (cursorKey <= todayKey) {
        const summary = daySummaries.get(cursorKey);
        const value = getSummaryHeatmapValue(summary);
        if (shouldUseSummaryForHeatmap(summary, goal) && value != null) {
            values.push(value);
        }
        cursorKey = shiftDayKey(cursorKey, 1);
    }

    return values.sort((left, right) => left - right);
}

function getSummaryHeatmapRatio(summary) {
    const value = getSummaryHeatmapValue(summary);
    if (value == null) return 0;
    const values = _state.heatmapValues;
    if (!values.length) return 0;
    if (values.length === 1) return HEATMAP_SINGLE_VALUE_RATIO;

    const firstIndex = values.indexOf(value);
    const lastIndex = values.lastIndexOf(value);
    if (firstIndex < 0 || lastIndex < 0) return HEATMAP_SINGLE_VALUE_RATIO;

    const ratio = (firstIndex + lastIndex) / (2 * (values.length - 1));
    return getHeatmapMetric().invertScale ? 1 - ratio : ratio;
}

function getHeatmapLevel(ratio) {
    return Math.min(4, Math.max(1, Math.ceil(clamp(ratio, 0, 1) * 4)));
}

function computeBestStreak(daySummaries, goal, todayKey) {
    if (goal <= 0 || daySummaries.size === 0) return 0;

    const sortedKeys = Array.from(daySummaries.keys()).sort();
    let cursorKey = sortedKeys[0];
    let best = 0;
    let current = 0;

    while (cursorKey <= todayKey) {
        const count = daySummaries.get(cursorKey)?.count || 0;
        if (count >= goal) {
            current += 1;
            best = Math.max(best, current);
        } else {
            current = 0;
        }
        cursorKey = shiftDayKey(cursorKey, 1);
    }

    return best;
}

function buildCalendarState() {
    const goal = normalizeDailyStreakGoal(settings.get('dailyStreakGoal'));
    const todayKey = toDayKey(Date.now());
    const allSolves = dailyStreakStore.getSolves();
    const filterContext = buildFilterContext(allSolves);
    const filters = getResolvedFilters(filterContext);
    const filteredSolves = filterSolves(allSolves, filterContext, filters);
    const streakState = computeDailyStreakState(filteredSolves, goal);
    const daySummaries = buildDaySummaries(filteredSolves, goal);
    const { firstDayKey } = getVisibleRange(todayKey);
    const heatmapMetric = normalizeHeatmapMetric(_state.heatmapMetric);
    const heatmapValues = getVisibleHeatmapValues(daySummaries, firstDayKey, todayKey, goal);
    let totalSolves = 0;
    let activeDays = 0;
    let goalDays = 0;

    daySummaries.forEach((summary) => {
        totalSolves += summary.count;
        activeDays += summary.count > 0 ? 1 : 0;
        goalDays += summary.goalMet ? 1 : 0;
    });

    return {
        ..._state,
        todayKey,
        goal,
        streakState,
        daySummaries,
        firstVisibleDayKey: firstDayKey,
        selectedDayKey: _state.selectedDayKey || todayKey,
        hoveredDayKey: '',
        buttonByDayKey: new Map(),
        filterMode: filters.filterMode,
        scrambleTypeFilter: filters.scrambleTypeFilter,
        sessionFilter: filters.sessionFilter,
        heatmapMetric,
        availableScrambleTypes: filterContext.availableScrambleTypes,
        availableSessions: filterContext.sessions,
        hasAnySolves: allSolves.length > 0,
        heatmapValues,
        totalSolves,
        activeDays,
        goalDays,
        bestStreak: computeBestStreak(daySummaries, goal, todayKey),
    };
}

function formatClockTime(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatSolveTimeOfDaySummary(summary) {
    if (!summary || !Number.isFinite(summary.firstTimestamp) || !Number.isFinite(summary.lastTimestamp)) return '';
    const start = formatClockTime(summary.firstTimestamp);
    const end = formatClockTime(summary.lastTimestamp);
    return start === end
        ? `Solved at ${start}.`
        : `Solves happened between ${start} and ${end}.`;
}

function formatPenaltySummary(summary) {
    if (!summary) return '-';

    const parts = [];
    if (summary.dnfCount > 0) parts.push(plural(summary.dnfCount, 'DNF', 'DNFs'));
    if (summary.plus2Count > 0) parts.push(plural(summary.plus2Count, '+2'));
    return parts.length > 0 ? parts.join(' / ') : '-';
}

function formatTotalDuration(ms) {
    if (!ms || !Number.isFinite(ms) || ms <= 0) return '-';

    const totalSeconds = ms / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    const wholeSeconds = Math.floor(seconds);
    parts.push(`${wholeSeconds}s`);

    return parts.join(' ');
}

function formatDayDate(dayKey) {
    return formatReadableDate(dayKeyToTimestamp(dayKey));
}

function getOrdinalSuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
        case 1:
            return 'st';
        case 2:
            return 'nd';
        case 3:
            return 'rd';
        default:
            return 'th';
    }
}

function formatTooltipDayDate(dayKey) {
    const date = new Date(dayKeyToTimestamp(dayKey));
    const day = date.getDate();
    return `${fullMonthFormatter.format(date)} ${day}${getOrdinalSuffix(day)}`;
}

function getDayStatus(summary, dayKey) {
    if (dayKey > _state.todayKey) return 'Upcoming';
    const count = summary?.count || 0;
    if (count === 0) return 'No solves';
    if (_state.goal <= 0) return plural(count, 'solve');
    if (count >= _state.goal) return 'Goal met';
    return `${_state.goal - count} to goal`;
}

function getDayAriaLabel(dayKey) {
    const summary = _state.daySummaries.get(dayKey);
    const count = summary?.count || 0;
    const date = formatDayDate(dayKey);
    const status = getDayStatus(summary, dayKey);
    return `${date}: ${plural(count, 'solve')}. ${status}.`;
}

function setText(selector, text) {
    const el = _overlay?.querySelector(selector);
    if (el) el.textContent = text;
}

function hasActiveFilters() {
    if (_state.filterMode === FILTER_MODE_SESSION) {
        return _state.sessionFilter !== ALL_FILTER_VALUE;
    }
    return _state.scrambleTypeFilter !== ALL_FILTER_VALUE;
}

function setSelectOptions(selectEl, options, selectedValue) {
    if (!selectEl) return;

    const fragment = document.createDocumentFragment();
    options.forEach(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        fragment.append(option);
    });

    selectEl.replaceChildren(fragment);
    selectEl.value = selectedValue;
}

function getSessionFilterLabel(session) {
    const solveCount = Number.isFinite(session?.solveCount) ? session.solveCount : 0;
    return `${session?.name || 'Session'} (${solveCount})`;
}

function renderFilterControls() {
    if (!_filterModeSelect || !_filterValueSelect) return;

    const scrambleTypeOptions = [
        { value: ALL_FILTER_VALUE, label: 'All scramble types' },
        ..._state.availableScrambleTypes.map((scrambleType) => ({
            value: scrambleType,
            label: getScrambleTypeLabel(scrambleType),
        })),
    ];
    const sessionOptions = [
        { value: ALL_FILTER_VALUE, label: 'All sessions' },
        ..._state.availableSessions.map((session) => ({
            value: session.id,
            label: getSessionFilterLabel(session),
        })),
    ];
    const isSessionMode = _state.filterMode === FILTER_MODE_SESSION;
    const valueOptions = isSessionMode ? sessionOptions : scrambleTypeOptions;
    const selectedValue = isSessionMode ? _state.sessionFilter : _state.scrambleTypeFilter;

    _filterModeSelect.value = _state.filterMode;
    if (_filterValueLabel) {
        _filterValueLabel.textContent = isSessionMode ? 'Session' : 'Scramble type';
    }
    _filterValueSelect.setAttribute(
        'aria-label',
        isSessionMode ? 'Daily streak session filter' : 'Daily streak scramble type filter',
    );

    setSelectOptions(_filterValueSelect, valueOptions, selectedValue);
}

function renderHeatmapMetricControl() {
    if (!_heatmapMetricSelect) return;
    _heatmapMetricSelect.value = normalizeHeatmapMetric(_state.heatmapMetric);
}

function renderOverview() {
    if (!_subtitle || !_overview || !_legend) return;

    const streakState = _state.streakState || {};
    const todayCount = streakState.todayCount || 0;
    const currentStreak = streakState.currentStreak || 0;
    const remainingToday = Math.max(0, _state.goal - todayCount);

    const hasGoal = _state.goal > 0;

    _subtitle.textContent = hasGoal
        ? `Goal: ${plural(_state.goal, 'solve')} per day`
        : plural(_state.activeDays, 'active day');
    _overview.hidden = !hasGoal;

    if (!hasGoal) {
        renderLegend();
        return;
    }

    setText('[data-daily-streak-modal-stat="current"]', String(currentStreak));
    setText('[data-daily-streak-modal-stat-label="current"]', currentStreak === 1 ? 'day' : 'days');
    setText('[data-daily-streak-modal-stat="today"]', `${todayCount}/${_state.goal}`);
    setText(
        '[data-daily-streak-modal-stat-sub="today"]',
        remainingToday === 0 ? 'streak extended' : `${plural(remainingToday, 'solve')} left`,
    );
    setText('[data-daily-streak-modal-stat="best"]', String(_state.bestStreak));
    setText('[data-daily-streak-modal-stat-label="best"]', _state.bestStreak === 1 ? 'day' : 'days');
    setText('[data-daily-streak-modal-stat="active"]', String(_state.activeDays));
    setText('[data-daily-streak-modal-stat-sub="active"]', `${plural(_state.goalDays, 'goal day')}`);

    renderLegend();
}

function getLegendLabel(level) {
    if (level <= 0) return 'No solves';
    const metric = getHeatmapMetric();
    const prefix = _state.goal > 0 && !metric.colorActiveDays ? 'Goal met' : 'Active day';
    const qualifier = metric.levelQualifiers[level - 1]
        || metric.levelQualifiers[metric.levelQualifiers.length - 1];
    return `${prefix}, ${qualifier} ${metric.label.toLowerCase()}`;
}

function renderLegend() {
    if (!_legend) return;

    const metric = getHeatmapMetric();
    _legend.setAttribute('aria-label', `Daily ${metric.label.toLowerCase()} legend`);
    const lessLabel = _legend.querySelector('[data-daily-streak-legend-label="less"]');
    const moreLabel = _legend.querySelector('[data-daily-streak-legend-label="more"]');
    if (lessLabel) lessLabel.textContent = metric.lessLabel;
    if (moreLabel) moreLabel.textContent = metric.moreLabel;
    _legend.querySelectorAll('[data-daily-streak-legend-level]').forEach((item) => {
        const level = Number(item.dataset.dailyStreakLegendLevel || 0);
        item.setAttribute('aria-label', getLegendLabel(level));
        if (level <= 0) {
            item.style.removeProperty('background');
            return;
        }

        item.style.background = getHeatmapColor((level - 1) / 3);
    });
}

function renderMonthLabels() {
    if (!_monthLabels) return;

    _monthLabels.textContent = '';
    _monthLabels.style.gridTemplateColumns = `repeat(${WEEK_COUNT}, var(--daily-streak-cell-size))`;

    let previousMonth = null;
    for (let weekIndex = 0; weekIndex < WEEK_COUNT; weekIndex += 1) {
        const weekStartKey = shiftDayKey(_state.firstVisibleDayKey, weekIndex * DAYS_PER_WEEK);
        const date = new Date(dayKeyToTimestamp(weekStartKey));
        const month = date.getMonth();
        const label = document.createElement('span');
        label.className = 'daily-streak-month-label';
        label.style.gridColumn = String(weekIndex + 1);
        label.textContent = weekIndex === 0 || month !== previousMonth ? monthFormatter.format(date) : '';
        _monthLabels.append(label);
        previousMonth = month;
    }
}

function renderWeekdayLabels() {
    if (!_weekdayLabels || _weekdayLabels.childElementCount) return;

    WEEKDAY_LABELS.forEach((label, index) => {
        const item = document.createElement('span');
        item.textContent = index % 2 === 1 ? label : '';
        _weekdayLabels.append(item);
    });
}

function renderCalendarGrid() {
    if (!_grid) return;

    _grid.textContent = '';
    _grid.style.gridTemplateColumns = `repeat(${WEEK_COUNT}, var(--daily-streak-cell-size))`;
    _state.buttonByDayKey.clear();

    const fragment = document.createDocumentFragment();
    for (let weekIndex = 0; weekIndex < WEEK_COUNT; weekIndex += 1) {
        for (let dayIndex = 0; dayIndex < DAYS_PER_WEEK; dayIndex += 1) {
            const dayKey = shiftDayKey(_state.firstVisibleDayKey, (weekIndex * DAYS_PER_WEEK) + dayIndex);
            const summary = _state.daySummaries.get(dayKey);
            const solveCount = summary?.count || 0;
            const isPastOrToday = dayKey <= _state.todayKey;
            const isHeatmapDay = isPastOrToday
                && shouldUseSummaryForHeatmap(summary, _state.goal)
                && getSummaryHeatmapValue(summary) != null;
            const isGoalMetDay = _state.goal > 0 && isPastOrToday && Boolean(summary?.goalMet);
            const isMissedGoalDay = _state.goal > 0 && isPastOrToday && solveCount > 0 && !isGoalMetDay;
            const heatmapRatio = isHeatmapDay ? getSummaryHeatmapRatio(summary) : 0;
            const level = isHeatmapDay ? getHeatmapLevel(heatmapRatio) : 0;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `daily-streak-day daily-streak-level-${level}`;
            button.dataset.dayKey = dayKey;
            button.style.gridColumn = String(weekIndex + 1);
            button.style.gridRow = String(dayIndex + 1);
            if (isHeatmapDay) button.style.background = getHeatmapColor(heatmapRatio);
            button.setAttribute('aria-pressed', dayKey === _state.selectedDayKey ? 'true' : 'false');

            if (isGoalMetDay) button.classList.add('is-goal-met');
            if (isMissedGoalDay) button.classList.add('is-goal-missed');
            if (dayKey === _state.todayKey) button.classList.add('is-today');
            if (dayKey === _state.selectedDayKey) button.classList.add('is-selected');
            if (dayKey > _state.todayKey) button.classList.add('is-future');

            const label = document.createElement('span');
            label.className = 'daily-streak-day-label';
            label.textContent = getDayAriaLabel(dayKey);
            button.append(label);

            fragment.append(button);
            _state.buttonByDayKey.set(dayKey, button);
        }
    }

    _grid.append(fragment);
}

function setSelectedDay(dayKey, { focus = false, showTooltip = true } = {}) {
    if (!dayKey || !_state.buttonByDayKey.has(dayKey)) return;

    const previousButton = _state.buttonByDayKey.get(_state.selectedDayKey);
    previousButton?.classList.remove('is-selected');
    previousButton?.setAttribute('aria-pressed', 'false');

    _state.selectedDayKey = dayKey;
    const nextButton = _state.buttonByDayKey.get(dayKey);
    nextButton?.classList.add('is-selected');
    nextButton?.setAttribute('aria-pressed', 'true');

    renderDayDetail(dayKey);
    renderEmptyState();
    if (showTooltip && nextButton) showTooltipForDay(dayKey, nextButton);
    if (focus && nextButton) nextButton.focus({ preventScroll: true });
}

function renderDayDetail(dayKey = _state.selectedDayKey) {
    if (!_detail) return;

    const summary = _state.daySummaries.get(dayKey);
    const count = summary?.count || 0;
    const isFuture = dayKey > _state.todayKey;
    const status = getDayStatus(summary, dayKey);

    _detail.classList.toggle('is-empty-day', count === 0);
    _detail.innerHTML = `
        <div class="daily-streak-detail-heading">
            <span class="daily-streak-detail-date"></span>
            ${_state.goal > 0 ? '<span class="daily-streak-detail-status"></span>' : ''}
        </div>
        <div class="daily-streak-detail-grid">
            <div>
                <span class="daily-streak-detail-label">Solves</span>
                <strong data-detail-value="solves"></strong>
            </div>
            <div>
                <span class="daily-streak-detail-label">Best</span>
                <strong data-detail-value="best"></strong>
            </div>
            <div>
                <span class="daily-streak-detail-label">Mean</span>
                <strong data-detail-value="mean"></strong>
            </div>
            <div>
                <span class="daily-streak-detail-label">Total</span>
                <strong data-detail-value="total"></strong>
            </div>
            <div>
                <span class="daily-streak-detail-label">Penalties</span>
                <strong data-detail-value="penalties"></strong>
            </div>
        </div>
        <div class="daily-streak-detail-meta"></div>
    `;

    _detail.querySelector('.daily-streak-detail-date').textContent = formatDayDate(dayKey);
    const statusEl = _detail.querySelector('.daily-streak-detail-status');
    if (statusEl) statusEl.textContent = status;
    _detail.querySelector('[data-detail-value="solves"]').textContent = String(count);
    _detail.querySelector('[data-detail-value="best"]').textContent = summary?.bestTime != null ? formatTime(summary.bestTime) : '-';
    _detail.querySelector('[data-detail-value="mean"]').textContent = summary?.meanTime != null ? formatTime(summary.meanTime) : '-';
    _detail.querySelector('[data-detail-value="penalties"]').textContent = formatPenaltySummary(summary);
    _detail.querySelector('[data-detail-value="total"]').textContent = formatTotalDuration(summary?.totalTime);

    const meta = _detail.querySelector('.daily-streak-detail-meta');
    if (isFuture) {
        meta.textContent = 'No data yet.';
    } else if (count === 0) {
        meta.textContent = hasActiveFilters() && _state.hasAnySolves
            ? 'No solves logged for this filter.'
            : (_state.goal > 0 ? `${plural(_state.goal, 'solve')} needed for the goal.` : 'No solves logged.');
    } else {
        meta.textContent = formatSolveTimeOfDaySummary(summary);
    }
}

function renderEmptyState() {
    if (!_emptyState || !_modalBox) return;

    const hasMatchingSolves = _state.totalSolves > 0;
    _emptyState.textContent = _state.hasAnySolves && hasActiveFilters()
        ? 'No solves match this filter.'
        : 'No solves have been logged yet.';
    _emptyState.style.removeProperty('min-height');

    if (_detail) {
        if (hasMatchingSolves) {
            _detail.hidden = false;
            _detail.removeAttribute('aria-hidden');
        } else {
            _detail.hidden = false;
            _detail.setAttribute('aria-hidden', 'true');
        }
    }

    _emptyState.hidden = hasMatchingSolves;
    _modalBox.classList.toggle('daily-streak-empty-only', !hasMatchingSolves);
}

function renderDailyStreakModal() {
    if (!_overlay) return;

    _state = buildCalendarState();
    renderFilterControls();
    renderHeatmapMetricControl();
    renderOverview();
    renderWeekdayLabels();
    renderMonthLabels();
    renderCalendarGrid();
    renderDayDetail(_state.selectedDayKey);
    renderEmptyState();
}

function showTooltipForDay(dayKey, button) {
    if (!_tooltip || !button || !_overlay?.classList.contains('active')) return;

    const summary = _state.daySummaries.get(dayKey);
    const count = summary?.count || 0;
    const lines = [
        `${plural(count, 'solve')} on ${formatTooltipDayDate(dayKey)}`,
        `best ${summary?.bestTime != null ? formatTime(summary.bestTime) : '-'}`,
        `mean ${summary?.meanTime != null ? formatTime(summary.meanTime) : '-'}`,
        `total ${formatTotalDuration(summary?.totalTime)}`,
    ];

    _tooltip.textContent = '';
    lines.forEach((line, index) => {
        const item = document.createElement(index === 0 ? 'strong' : 'span');
        item.textContent = line;
        _tooltip.append(item);
    });

    _tooltip.hidden = false;
    positionTooltip(button);
}

function positionTooltip(button) {
    if (!_tooltip || !button) return;

    const shell = _tooltip.offsetParent || _overlay;
    const shellRect = shell.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = _tooltip.getBoundingClientRect();
    const centeredLeft = buttonRect.left - shellRect.left + (buttonRect.width / 2);
    const clampedLeft = Math.max(tooltipRect.width / 2 + 8, Math.min(shellRect.width - (tooltipRect.width / 2) - 8, centeredLeft));
    const top = buttonRect.top - shellRect.top - 10;

    _tooltip.style.left = `${clampedLeft}px`;
    _tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
    if (!_tooltip) return;
    _tooltip.hidden = true;
    _state.hoveredDayKey = '';
}

function getDayButtonFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    return target.closest('.daily-streak-day');
}

function handlePointerMove(event) {
    if (shouldUseTouchInteraction(event.pointerType)) return;

    const button = getDayButtonFromEvent(event);
    const dayKey = button?.dataset.dayKey;
    if (!button || !dayKey || dayKey === _state.hoveredDayKey) return;

    _state.hoveredDayKey = dayKey;
    setSelectedDay(dayKey, { showTooltip: true });
}

function handleDayClick(event) {
    const button = getDayButtonFromEvent(event);
    const dayKey = button?.dataset.dayKey;
    if (!button || !dayKey) return;

    event.preventDefault();
    setSelectedDay(dayKey, { focus: true, showTooltip: true });
}

function handleFocusIn(event) {
    const button = getDayButtonFromEvent(event);
    const dayKey = button?.dataset.dayKey;
    if (!button || !dayKey) return;

    setSelectedDay(dayKey, { showTooltip: true });
}

function handleGridKeydown(event) {
    const button = getDayButtonFromEvent(event);
    const dayKey = button?.dataset.dayKey;
    if (!button || !dayKey) return;

    const offsets = {
        ArrowUp: -1,
        ArrowDown: 1,
        ArrowLeft: -DAYS_PER_WEEK,
        ArrowRight: DAYS_PER_WEEK,
    };
    const offset = offsets[event.key];
    if (!offset) return;

    const nextDayKey = shiftDayKey(dayKey, offset);
    if (!_state.buttonByDayKey.has(nextDayKey)) return;

    event.preventDefault();
    setSelectedDay(nextDayKey, { focus: true, showTooltip: true });
}

function handleFilterChange(event) {
    const nextMode = normalizeFilterMode(_filterModeSelect?.value);

    _state.filterMode = nextMode;
    if (event?.target === _filterValueSelect || !event?.target) {
        const nextValue = _filterValueSelect?.value || ALL_FILTER_VALUE;
        if (nextMode === FILTER_MODE_SESSION) {
            _state.sessionFilter = nextValue;
        } else {
            _state.scrambleTypeFilter = nextValue;
        }
    }

    hideTooltip();
    renderDailyStreakModal();
}

function handleHeatmapMetricChange() {
    const heatmapMetric = normalizeHeatmapMetric(_heatmapMetricSelect?.value);
    _state.heatmapMetric = heatmapMetric;
    settings.set(HEATMAP_METRIC_SETTING, heatmapMetric);
    hideTooltip();
    renderDailyStreakModal();
}

function scrollCalendarToToday() {
    if (!_calendarScroll) return;
    window.requestAnimationFrame(() => {
        _calendarScroll.scrollLeft = _calendarScroll.scrollWidth;
    });
}

function blurActiveElement() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
}

async function ensureDailyStreakSolvesHydrated() {
    let forceHydration = false;

    while (true) {
        await sessionManager.waitForPendingSolvePersistence();
        const mutationGeneration = sessionManager.getSolveMutationGeneration();
        await dailyStreakStore.ensureSolvesHydrated({ force: forceHydration });
        await sessionManager.waitForPendingSolvePersistence();

        if (sessionManager.getSolveMutationGeneration() === mutationGeneration) return;

        forceHydration = true;
        await new Promise((resolve) => window.setTimeout(resolve, HYDRATION_RETRY_YIELD_MS));
    }
}

export function isDailyStreakModalOpen() {
    return Boolean(_state.isOpen || _overlay?.classList.contains('active'));
}

export async function refreshDailyStreakModal() {
    if (!isDailyStreakModalOpen()) return;

    try {
        const previousSelectedDayKey = _state.selectedDayKey;
        await ensureDailyStreakSolvesHydrated();
        if (!isDailyStreakModalOpen()) return;

        renderDailyStreakModal();
        if (_state.buttonByDayKey.has(previousSelectedDayKey)) {
            setSelectedDay(previousSelectedDayKey, { showTooltip: false });
        }
    } catch (error) {
        console.warn('Could not refresh daily streak data:', error);
    }
}

function blurFocusedModalElement() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !_overlay?.contains(activeElement)) return;
    activeElement.blur();
}

function requestDailyStreakHistoryState() {
    if (typeof _requestHistoryState === 'function') _requestHistoryState();
}

function dismissDailyStreakHistoryState() {
    if (typeof _dismissHistoryState === 'function') _dismissHistoryState();
}

export function closeDailyStreakModal({ isPopState = false, preserveHistoryState = false } = {}) {
    if (!_state.isOpen && !_overlay?.classList.contains('active')) return;

    if (!isPopState && !preserveHistoryState) dismissDailyStreakHistoryState();

    _openRequestId += 1;
    _openPromise = null;
    blurFocusedModalElement();
    _overlay?.classList.remove('active');
    _overlay?.setAttribute('aria-hidden', 'true');
    _overlay?.removeAttribute('aria-busy');
    _state.isOpen = false;
    hideTooltip();
}

export async function showDailyStreakModal({ preserveHistoryState = false } = {}) {
    if (!_overlay) return;
    if (_openPromise) return _openPromise;
    if (isDailyStreakModalOpen()) return;

    if (!preserveHistoryState) requestDailyStreakHistoryState();
    blurActiveElement();
    _state.selectedDayKey = toDayKey(Date.now());
    _state.heatmapMetric = normalizeHeatmapMetric(settings.get(HEATMAP_METRIC_SETTING));
    _state.isOpen = true;
    _overlay.classList.add('active');
    _overlay.setAttribute('aria-hidden', 'false');
    _overlay.setAttribute('aria-busy', 'true');

    const openRequestId = _openRequestId + 1;
    _openRequestId = openRequestId;

    _openPromise = (async () => {
        try {
            await ensureDailyStreakSolvesHydrated();
            if (openRequestId !== _openRequestId || !_state.isOpen || !_overlay?.classList.contains('active')) return;

            renderDailyStreakModal();
            scrollCalendarToToday();

            window.requestAnimationFrame(() => {
                if (openRequestId !== _openRequestId || !_state.isOpen) return;
                blurFocusedModalElement();
                hideTooltip();
            });
        } catch (error) {
            console.warn('Could not load daily streak data:', error);
            if (openRequestId === _openRequestId) {
                closeDailyStreakModal();
            }
        } finally {
            if (openRequestId === _openRequestId) {
                _openPromise = null;
                _overlay?.removeAttribute('aria-busy');
            }
        }
    })();

    return _openPromise;
}

export function initDailyStreakModal({ requestHistoryState = null, dismissHistoryState = null } = {}) {
    if (typeof requestHistoryState === 'function') _requestHistoryState = requestHistoryState;
    if (typeof dismissHistoryState === 'function') _dismissHistoryState = dismissHistoryState;
    if (_initialized) return;
    _initialized = true;

    _overlay = document.getElementById('daily-streak-overlay');
    _modalBox = _overlay?.querySelector('.daily-streak-modal-box') || null;
    _closeButton = document.getElementById('daily-streak-close');
    _subtitle = document.getElementById('daily-streak-modal-subtitle');
    _overview = document.getElementById('daily-streak-overview');
    _weekdayLabels = document.getElementById('daily-streak-weekday-labels');
    _monthLabels = document.getElementById('daily-streak-month-labels');
    _grid = document.getElementById('daily-streak-calendar-grid');
    _calendarScroll = document.getElementById('daily-streak-calendar-scroll');
    _tooltip = document.getElementById('daily-streak-tooltip');
    _detail = document.getElementById('daily-streak-detail');
    _legend = document.getElementById('daily-streak-legend');
    _emptyState = document.getElementById('daily-streak-empty-state');
    _filterModeSelect = document.getElementById('daily-streak-filter-mode');
    _filterValueLabel = document.getElementById('daily-streak-filter-value-label');
    _filterValueSelect = document.getElementById('daily-streak-filter-value');
    _heatmapMetricSelect = document.getElementById('daily-streak-heatmap-metric');

    if (!_overlay || !_grid) return;

    _closeButton?.addEventListener('click', closeDailyStreakModal);
    _filterModeSelect?.addEventListener('change', handleFilterChange);
    _filterValueSelect?.addEventListener('change', handleFilterChange);
    _heatmapMetricSelect?.addEventListener('change', handleHeatmapMetricChange);

    sessionManager.on('sessionChanged', refreshDailyStreakModal);
    sessionManager.on('sessionUpdated', refreshDailyStreakModal);
    sessionManager.on('sessionDeleted', refreshDailyStreakModal);

    _overlay.addEventListener('mousedown', (event) => {
        _mouseDownTarget = event.target;
    });
    _overlay.addEventListener('mouseup', (event) => {
        _mouseUpTarget = event.target;
    });
    _overlay.addEventListener('click', (event) => {
        if (_mouseDownTarget === _overlay && _mouseUpTarget === _overlay) closeDailyStreakModal();
        _mouseDownTarget = null;
        _mouseUpTarget = null;
    });

    _grid.addEventListener('pointermove', handlePointerMove);
    _grid.addEventListener('pointerleave', hideTooltip);
    _grid.addEventListener('click', handleDayClick);
    _grid.addEventListener('focusin', handleFocusIn);
    _grid.addEventListener('focusout', (event) => {
        if (_grid.contains(event.relatedTarget)) return;
        hideTooltip();
    });
    _grid.addEventListener('keydown', handleGridKeydown);
    _calendarScroll?.addEventListener('scroll', hideTooltip, { passive: true });

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape' || !isDailyStreakModalOpen()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDailyStreakModal();
    });

    window.addEventListener('resize', () => {
        if (!isDailyStreakModalOpen()) return;
        const button = _state.buttonByDayKey.get(_state.selectedDayKey);
        if (button && !_tooltip?.hidden) positionTooltip(button);
    });
}
