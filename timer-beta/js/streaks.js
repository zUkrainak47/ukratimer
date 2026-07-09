import * as db from './db.js?v=2026070902';

export function toDayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function dayKeyToTimestamp(dayKey) {
    const [year, month, day] = String(dayKey).split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1).getTime();
}

export function shiftDayKey(dayKey, amount) {
    const [year, month, day] = String(dayKey).split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    date.setDate(date.getDate() + amount);
    return toDayKey(date.getTime());
}

export function normalizeDailyStreakGoal(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;

    const normalized = Math.max(0, Math.floor(numericValue));
    return normalized;
}

function getSolveDayKey(solve) {
    return solve && Number.isFinite(solve.timestamp) ? toDayKey(solve.timestamp) : '';
}

function cloneSolve(solve) {
    if (!solve || typeof solve !== 'object') return solve;

    return {
        ...solve,
        ...(Array.isArray(solve.phaseSplits) ? { phaseSplits: [...solve.phaseSplits] } : {}),
    };
}

function incrementDayCount(dayCounts, dayKey) {
    if (!dayKey) return;
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
}

function decrementDayCount(dayCounts, dayKey) {
    if (!dayKey) return;

    const nextCount = (dayCounts.get(dayKey) || 0) - 1;
    if (nextCount > 0) {
        dayCounts.set(dayKey, nextCount);
    } else {
        dayCounts.delete(dayKey);
    }
}

function computeDailyStreakStateFromDayCounts(dayCounts, goal, now = Date.now()) {
    const normalizedGoal = normalizeDailyStreakGoal(goal);
    const todayKey = toDayKey(now);

    if (normalizedGoal === 0) {
        return {
            disabled: true,
            goal: 0,
            currentStreak: 0,
            todayCount: 0,
            progressRatio: 0,
            progressPercent: 0,
            remainingToday: 0,
            goalMetToday: false,
            yesterdayMetGoal: false,
            isAtRisk: false,
            hasActiveStreak: false,
            todayKey,
        };
    }

    const todayCount = dayCounts.get(todayKey) || 0;
    const yesterdayKey = shiftDayKey(todayKey, -1);
    const goalMetToday = todayCount >= normalizedGoal;
    const yesterdayMetGoal = (dayCounts.get(yesterdayKey) || 0) >= normalizedGoal;
    const anchorKey = goalMetToday ? todayKey : yesterdayKey;

    let currentStreak = 0;
    let cursorKey = anchorKey;
    while ((dayCounts.get(cursorKey) || 0) >= normalizedGoal) {
        currentStreak += 1;
        cursorKey = shiftDayKey(cursorKey, -1);
    }

    const remainingToday = Math.max(0, normalizedGoal - todayCount);
    const progressRatio = normalizedGoal > 0 ? Math.min(1, todayCount / normalizedGoal) : 0;

    return {
        disabled: false,
        goal: normalizedGoal,
        currentStreak,
        todayCount,
        progressRatio,
        progressPercent: Math.round(progressRatio * 100),
        remainingToday,
        goalMetToday,
        yesterdayMetGoal,
        isAtRisk: !goalMetToday && currentStreak > 0 && yesterdayMetGoal,
        hasActiveStreak: currentStreak > 0,
        todayKey,
    };
}

export function computeDailyStreakState(solves, goal, now = Date.now()) {
    const dayCounts = new Map();

    (Array.isArray(solves) ? solves : []).forEach((solve) => {
        incrementDayCount(dayCounts, getSolveDayKey(solve));
    });

    return computeDailyStreakStateFromDayCounts(dayCounts, goal, now);
}

export class DailyStreakStore {
    constructor() {
        this._solves = new Map();
        this._solveDayKeys = new Map();
        this._dayCounts = new Map();
        this._solvesHydrated = false;
        this._hydratePromise = null;
    }

    async init() {
        const entries = await db.getSolveDayEntries();
        this.replaceDayEntries(entries);
        return this;
    }

    replaceDayEntries(entries) {
        this._solves.clear();
        this._solveDayKeys.clear();
        this._dayCounts.clear();
        this._solvesHydrated = false;

        (Array.isArray(entries) ? entries : []).forEach((entry) => {
            if (!entry?.id || !Number.isFinite(entry.timestamp)) return;
            const dayKey = toDayKey(entry.timestamp);
            this._solveDayKeys.set(entry.id, dayKey);
            incrementDayCount(this._dayCounts, dayKey);
        });
    }

    replaceAll(solves) {
        this._solves.clear();
        this._solveDayKeys.clear();
        this._dayCounts.clear();
        this._solvesHydrated = true;

        (Array.isArray(solves) ? solves : []).forEach((solve) => {
            this.upsertSolve(solve);
        });
    }

    async ensureSolvesHydrated({ force = false } = {}) {
        if (!force && this._solvesHydrated) return this;
        if (this._hydratePromise) {
            await this._hydratePromise;
            if (!force) return this;
        }

        this._hydratePromise = db.getAllData()
            .then(({ solves }) => {
                this.replaceAll(solves);
                return this;
            })
            .finally(() => {
                this._hydratePromise = null;
            });
        return this._hydratePromise;
    }

    upsertSolve(solve) {
        if (!solve?.id) return;

        const previousDayKey = this._solveDayKeys.get(solve.id);
        decrementDayCount(this._dayCounts, previousDayKey);

        const nextDayKey = getSolveDayKey(solve);
        if (nextDayKey) {
            this._solveDayKeys.set(solve.id, nextDayKey);
            incrementDayCount(this._dayCounts, nextDayKey);
        } else {
            this._solveDayKeys.delete(solve.id);
        }

        if (this._solvesHydrated) {
            const storedSolve = cloneSolve(solve);
            this._solves.set(storedSolve.id, storedSolve);
        }
    }

    deleteSolve(solveIdOrIds) {
        const solveIds = Array.isArray(solveIdOrIds) ? solveIdOrIds : [solveIdOrIds];
        solveIds.forEach((solveId) => {
            if (!solveId) return;
            decrementDayCount(this._dayCounts, this._solveDayKeys.get(solveId));
            this._solveDayKeys.delete(solveId);
            this._solves.delete(solveId);
        });
    }

    getSolves() {
        return Array.from(this._solves.values(), cloneSolve);
    }

    getState(goal, now = Date.now()) {
        return computeDailyStreakStateFromDayCounts(this._dayCounts, goal, now);
    }
}

export const dailyStreakStore = new DailyStreakStore();
