import { settings } from './settings.js?v=2026052301';
import {
    dailyStreakStore,
    dayKeyToTimestamp,
    normalizeDailyStreakGoal,
    shiftDayKey,
    toDayKey,
} from './streaks.js?v=2026052301';
import { formatReadableDate, formatTime, getEffectiveTime } from './utils.js?v=2026052301';

const WEEK_COUNT = 53;
const DAYS_PER_WEEK = 7;
const WEEKDAY_LABELS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
const fullMonthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long' });
const touchPrimaryQuery = window.matchMedia('(hover: none) and (pointer: coarse)');

let _overlay = null;
let _modalBox = null;
let _closeButton = null;
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
let _mouseDownTarget = null;
let _mouseUpTarget = null;
let _previousFocus = null;
let _initialized = false;

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
        firstTimestamp: null,
        lastTimestamp: null,
    };
}

function getActivityLevel(count, goal) {
    if (count <= 0) return 0;
    if (goal <= 0) return Math.min(4, Math.max(1, Math.ceil(count / 5)));
    if (count < goal) return 1;
    if (count < goal * 2) return 2;
    if (count < goal * 3) return 3;
    return 4;
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

        const effectiveTime = getEffectiveTime(solve);
        if (Number.isFinite(effectiveTime)) {
            summary.validCount += 1;
            summary.totalTime += effectiveTime;
            summary.bestTime = summary.bestTime == null
                ? effectiveTime
                : Math.min(summary.bestTime, effectiveTime);
        }
    });

    daySummaries.forEach((summary) => {
        summary.meanTime = summary.validCount > 0 ? summary.totalTime / summary.validCount : null;
        summary.level = getActivityLevel(summary.count, goal);
        summary.goalMet = goal > 0 && summary.count >= goal;
    });

    return daySummaries;
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
    const streakState = dailyStreakStore.getState(goal);
    const daySummaries = buildDaySummaries(dailyStreakStore.getSolves(), goal);
    const { firstDayKey } = getVisibleRange(todayKey);
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

function renderOverview() {
    if (!_subtitle || !_overview || !_legend) return;

    const streakState = _state.streakState || {};
    const todayCount = streakState.todayCount || 0;
    const currentStreak = streakState.currentStreak || 0;
    const remainingToday = Math.max(0, _state.goal - todayCount);

    _subtitle.textContent = _state.goal > 0
        ? `Goal: ${plural(_state.goal, 'solve')} per day`
        : 'Daily streak goal is off';

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

    _legend.querySelectorAll('[data-daily-streak-legend-level]').forEach((item) => {
        item.setAttribute('aria-label', getLegendLabel(Number(item.dataset.dailyStreakLegendLevel || 0)));
    });
}

function getLegendLabel(level) {
    if (level <= 0) return 'No solves';
    if (_state.goal <= 0) return `${level} activity level`;
    if (level === 1) return `Less than ${_state.goal}`;
    if (level === 2) return `${_state.goal}+`;
    if (level === 3) return `${_state.goal * 2}+`;
    return `${_state.goal * 3}+`;
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
            const level = dayKey > _state.todayKey ? 0 : (summary?.level || 0);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `daily-streak-day daily-streak-level-${level}`;
            button.dataset.dayKey = dayKey;
            button.style.gridColumn = String(weekIndex + 1);
            button.style.gridRow = String(dayIndex + 1);
            button.setAttribute('aria-pressed', dayKey === _state.selectedDayKey ? 'true' : 'false');

            if (summary?.goalMet) button.classList.add('is-goal-met');
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
            <span class="daily-streak-detail-status"></span>
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
    _detail.querySelector('.daily-streak-detail-status').textContent = status;
    _detail.querySelector('[data-detail-value="solves"]').textContent = String(count);
    _detail.querySelector('[data-detail-value="best"]').textContent = summary?.bestTime != null ? formatTime(summary.bestTime) : '-';
    _detail.querySelector('[data-detail-value="mean"]').textContent = summary?.meanTime != null ? formatTime(summary.meanTime) : '-';
    _detail.querySelector('[data-detail-value="penalties"]').textContent = formatPenaltySummary(summary);
    _detail.querySelector('[data-detail-value="total"]').textContent = formatTotalDuration(summary?.totalTime);

    const meta = _detail.querySelector('.daily-streak-detail-meta');
    if (isFuture) {
        meta.textContent = 'No data yet.';
    } else if (count === 0) {
        meta.textContent = _state.goal > 0 ? `${plural(_state.goal, 'solve')} needed for the goal.` : 'No solves logged.';
    } else {
        meta.textContent = formatSolveTimeOfDaySummary(summary);
    }
}

function renderEmptyState() {
    if (!_emptyState || !_modalBox) return;

    const hasSolves = _state.totalSolves > 0;
    _emptyState.hidden = hasSolves;
    _modalBox.classList.toggle('daily-streak-empty-only', !hasSolves);
}

function renderDailyStreakModal() {
    if (!_overlay) return;

    _state = buildCalendarState();
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

function scrollCalendarToToday() {
    if (!_calendarScroll) return;
    window.requestAnimationFrame(() => {
        _calendarScroll.scrollLeft = _calendarScroll.scrollWidth;
    });
}

export function isDailyStreakModalOpen() {
    return Boolean(_overlay?.classList.contains('active'));
}

export function refreshDailyStreakModal() {
    if (!isDailyStreakModalOpen()) return;

    const previousSelectedDayKey = _state.selectedDayKey;
    renderDailyStreakModal();
    if (_state.buttonByDayKey.has(previousSelectedDayKey)) {
        setSelectedDay(previousSelectedDayKey, { showTooltip: false });
    }
}

export function closeDailyStreakModal() {
    if (!_overlay) return;

    _overlay.classList.remove('active');
    _overlay.setAttribute('aria-hidden', 'true');
    _state.isOpen = false;
    hideTooltip();

    if (_previousFocus && typeof _previousFocus.focus === 'function') {
        _previousFocus.focus({ preventScroll: true });
    }
    _previousFocus = null;
}

export function showDailyStreakModal() {
    if (!_overlay) return;

    _previousFocus = document.activeElement;
    _state.selectedDayKey = toDayKey(Date.now());
    renderDailyStreakModal();
    _overlay.classList.add('active');
    _overlay.setAttribute('aria-hidden', 'false');
    _state.isOpen = true;
    scrollCalendarToToday();

    window.requestAnimationFrame(() => {
        _closeButton?.focus({ preventScroll: true });
        hideTooltip();
    });
}

export function initDailyStreakModal() {
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

    if (!_overlay || !_grid) return;

    _closeButton?.addEventListener('click', closeDailyStreakModal);

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
