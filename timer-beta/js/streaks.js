import * as db from './db.js?v=2026042504';

function toDayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function shiftDayKey(dayKey, amount) {
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

export function computeDailyStreakState(solves, goal, now = Date.now()) {
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

    const solvesByDay = new Map();

    (Array.isArray(solves) ? solves : []).forEach((solve) => {
        if (!solve || !Number.isFinite(solve.timestamp)) return;
        const dayKey = toDayKey(solve.timestamp);
        solvesByDay.set(dayKey, (solvesByDay.get(dayKey) || 0) + 1);
    });

    const todayCount = solvesByDay.get(todayKey) || 0;
    const yesterdayKey = shiftDayKey(todayKey, -1);
    const goalMetToday = todayCount >= normalizedGoal;
    const yesterdayMetGoal = (solvesByDay.get(yesterdayKey) || 0) >= normalizedGoal;
    const anchorKey = goalMetToday ? todayKey : yesterdayKey;

    let currentStreak = 0;
    let cursorKey = anchorKey;
    while ((solvesByDay.get(cursorKey) || 0) >= normalizedGoal) {
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

export class DailyStreakStore {
    constructor() {
        this._solves = new Map();
    }

    async init() {
        const { solves } = await db.getAllData();
        this.replaceAll(solves);
        return this;
    }

    replaceAll(solves) {
        this._solves.clear();

        (Array.isArray(solves) ? solves : []).forEach((solve) => {
            if (!solve?.id) return;
            this._solves.set(solve.id, solve);
        });
    }

    upsertSolve(solve) {
        if (!solve?.id) return;
        this._solves.set(solve.id, solve);
    }

    deleteSolve(solveIdOrIds) {
        const solveIds = Array.isArray(solveIdOrIds) ? solveIdOrIds : [solveIdOrIds];
        solveIds.forEach((solveId) => {
            if (!solveId) return;
            this._solves.delete(solveId);
        });
    }

    getState(goal, now = Date.now()) {
        return computeDailyStreakState(Array.from(this._solves.values()), goal, now);
    }
}

export const dailyStreakStore = new DailyStreakStore();
