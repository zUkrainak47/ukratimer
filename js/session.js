import * as db from './db.js?v=2026041801';
import { load, save } from './storage.js?v=2026041801';
import { generateId, EventEmitter, getStartOfToday, getStartOfWeek, getStartOfMonth, parseCustomStatsFilter } from './utils.js?v=2026041801';
import { settings } from './settings.js?v=2026041801';
import { SCRAMBLE_TYPE_OPTIONS } from './scramble.js?v=2026041801';

const DEFAULT_SCRAMBLE_TYPE = '333';
const LEGACY_SCRAMBLE_TYPE_STORAGE_KEY = 'scrambleType';
const SCRAMBLE_TYPE_SET = new Set(SCRAMBLE_TYPE_OPTIONS.map((option) => option.id));
const BULK_OPERATION_YIELD_INTERVAL = 2000;

function sanitizeSessionScrambleType(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SCRAMBLE_TYPE_SET.has(normalized) ? normalized : DEFAULT_SCRAMBLE_TYPE;
}

function getLegacyScrambleTypeFallback() {
    return sanitizeSessionScrambleType(load(LEGACY_SCRAMBLE_TYPE_STORAGE_KEY, DEFAULT_SCRAMBLE_TYPE));
}

function findSolveInsertIndex(solves, solve) {
    let low = 0;
    let high = solves.length;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if ((solves[mid]?.timestamp ?? 0) <= (solve?.timestamp ?? 0)) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

function waitForNextFrame() {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }

        setTimeout(resolve, 0);
    });
}

async function mergeSolvesByTimestampWithProgress(left, right, onProgress = null) {
    const merged = [];
    let leftIndex = 0;
    let rightIndex = 0;
    let completed = 0;
    const total = left.length + right.length;

    while (leftIndex < left.length && rightIndex < right.length) {
        if ((left[leftIndex]?.timestamp ?? 0) <= (right[rightIndex]?.timestamp ?? 0)) {
            merged.push(left[leftIndex]);
            leftIndex += 1;
        } else {
            merged.push(right[rightIndex]);
            rightIndex += 1;
        }

        completed += 1;
        if (completed % BULK_OPERATION_YIELD_INTERVAL === 0) {
            if (typeof onProgress === 'function') {
                onProgress({ completed, total });
            }
            await waitForNextFrame();
        }
    }

    while (leftIndex < left.length) {
        merged.push(left[leftIndex]);
        leftIndex += 1;
        completed += 1;

        if (completed % BULK_OPERATION_YIELD_INTERVAL === 0) {
            if (typeof onProgress === 'function') {
                onProgress({ completed, total });
            }
            await waitForNextFrame();
        }
    }

    while (rightIndex < right.length) {
        merged.push(right[rightIndex]);
        rightIndex += 1;
        completed += 1;

        if (completed % BULK_OPERATION_YIELD_INTERVAL === 0) {
            if (typeof onProgress === 'function') {
                onProgress({ completed, total });
            }
            await waitForNextFrame();
        }
    }

    if (typeof onProgress === 'function') {
        onProgress({ completed, total });
    }

    return merged;
}

class SessionManager extends EventEmitter {
    constructor() {
        super();
        /** @type {{ id: string, name: string, createdAt: number, order: number, scrambleType: string, solveCount: number, solves: object[] }[]} */
        this._sessions = [];
        this._activeId = null;
        this._ready = false;
    }

    _getNextSessionOrder() {
        if (this._sessions.length === 0) return 0;
        return this._sessions.reduce((maxOrder, session) => {
            const order = Number.isFinite(session.order) ? session.order : -1;
            return Math.max(maxOrder, order);
        }, -1) + 1;
    }

    /**
     * Initialize the session manager by loading data from IndexedDB.
     * Must be called (and awaited) before any other methods.
     */
    async init() {
        await db.openDB();

        // Load session metadata from IndexedDB
        const dbSessions = await db.getAllSessions();
        const legacyScrambleType = getLegacyScrambleTypeFallback();
        const solveCounts = await Promise.all(
            dbSessions.map(session => db.getSolveCountBySession(session.id))
        );
        const sessionsToBackfill = [];

        // Build in-memory session objects (metadata + empty solves array)
        this._sessions = dbSessions.map((s, index) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            order: Number.isFinite(s.order) ? s.order : 0,
            scrambleType: (() => {
                const nextScrambleType = sanitizeSessionScrambleType(s.scrambleType ?? legacyScrambleType);
                if (s.scrambleType !== nextScrambleType) {
                    sessionsToBackfill.push({
                        id: s.id,
                        name: s.name,
                        createdAt: s.createdAt,
                        order: Number.isFinite(s.order) ? s.order : 0,
                        scrambleType: nextScrambleType,
                    });
                }
                return nextScrambleType;
            })(),
            solveCount: solveCounts[index] ?? 0,
            solves: [],
            solvesLoaded: false,
        }));

        if (sessionsToBackfill.length > 0) {
            await Promise.all(sessionsToBackfill.map((session) => db.updateSession(session)));
        }

        this._activeId = load('activeSessionId', null);

        if (this._sessions.length === 0) {
            await this._createDefault({ scrambleType: legacyScrambleType });
        }
        if (!this._activeId || !this._sessions.find(s => s.id === this._activeId)) {
            this._activeId = this._sessions[0].id;
            save('activeSessionId', this._activeId);
        }

        // Load solves for the active session
        await this._loadSolvesFor(this._activeId);
        this._ready = true;
    }

    async _loadSolvesFor(sessionId) {
        const session = this._sessions.find(s => s.id === sessionId);
        if (!session) return;
        session.solves = await db.getSolvesBySession(sessionId);
        session.solveCount = session.solves.length;
        session.solvesLoaded = true;
    }

    _serializeSession(session) {
        return {
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            order: session.order,
            scrambleType: sanitizeSessionScrambleType(session.scrambleType),
        };
    }

    async _createDefault({ scrambleType = getLegacyScrambleTypeFallback() } = {}) {
        const session = {
            id: generateId(),
            name: 'Session 1',
            createdAt: Date.now(),
            order: this._getNextSessionOrder(),
            scrambleType: sanitizeSessionScrambleType(scrambleType),
            solveCount: 0,
            solves: [],
            solvesLoaded: false,
        };
        this._sessions.push(session);
        await db.addSession(this._serializeSession(session));
    }

    // --- Session CRUD ---

    getSessions() {
        return this._sessions.map((s) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            order: s.order,
            scrambleType: s.scrambleType,
            solveCount: s.solveCount,
        }));
    }

    getActiveSession() {
        return this._sessions.find(s => s.id === this._activeId);
    }

    getActiveSessionId() {
        return this._activeId;
    }

    getSessionById(id) {
        return this._sessions.find((session) => session.id === id) || null;
    }

    getActiveSessionScrambleType() {
        return this.getActiveSession()?.scrambleType ?? getLegacyScrambleTypeFallback();
    }

    async ensureSessionSolvesLoaded(id) {
        const session = this.getSessionById(id);
        if (!session) return null;
        if (!session.solvesLoaded) {
            await this._loadSolvesFor(id);
        }
        return session;
    }

    async setActiveSession(id) {
        if (!this._sessions.find(s => s.id === id)) return;
        this._activeId = id;
        save('activeSessionId', id);
        await this._loadSolvesFor(id);
        this.emit('sessionChanged', id);
    }

    async createSession(name) {
        const num = this._sessions.length + 1;
        const activeSession = this.getActiveSession();
        const session = {
            id: generateId(),
            name: name || `Session ${num}`,
            createdAt: Date.now(),
            order: this._getNextSessionOrder(),
            scrambleType: sanitizeSessionScrambleType(activeSession?.scrambleType ?? getLegacyScrambleTypeFallback()),
            solveCount: 0,
            solves: [],
            solvesLoaded: false,
        };
        this._sessions.push(session);
        await db.addSession(this._serializeSession(session));
        await this.setActiveSession(session.id);
        return session;
    }

    async renameSession(id, name) {
        const session = this._sessions.find(s => s.id === id);
        if (session) {
            session.name = name;
            await db.updateSession(this._serializeSession(session));
            this.emit('sessionUpdated', id);
        }
    }

    async setSessionScrambleType(id, scrambleType) {
        const session = this._sessions.find((s) => s.id === id);
        if (!session) return false;

        const nextScrambleType = sanitizeSessionScrambleType(scrambleType);
        if (session.scrambleType === nextScrambleType) return false;

        session.scrambleType = nextScrambleType;
        await db.updateSession(this._serializeSession(session));
        this.emit('sessionUpdated', id);
        return true;
    }

    async deleteSession(id) {
        const deletedIndex = this._sessions.findIndex(s => s.id === id);
        if (deletedIndex === -1) return;

        const deletedSession = await this.ensureSessionSolvesLoaded(id);
        const deletedSolveIds = Array.isArray(deletedSession?.solves)
            ? deletedSession.solves.map((solve) => solve?.id).filter(Boolean)
            : [];

        this._sessions = this._sessions.filter(s => s.id !== id);
        await db.deleteSession(id);

        if (this._sessions.length === 0) {
            await this._createDefault();
            this._activeId = this._sessions[0].id;
            save('activeSessionId', this._activeId);
            this.emit('sessionDeleted', {
                id,
                solveIds: deletedSolveIds,
            });
            this.emit('sessionChanged', this._activeId);
        } else {
            if (this._activeId === id) {
                await this.setActiveSession(this._sessions[0].id);
            }
            this.emit('sessionDeleted', {
                id,
                solveIds: deletedSolveIds,
            });
        }
    }

    // --- Solve CRUD ---

    addSolve(time, scramble, isManual = false, penalty = null) {
        const session = this.getActiveSession();
        const solve = {
            id: generateId(),
            sessionId: this._activeId,
            time: Math.round(time),
            scramble,
            isManual,
            penalty,
            timestamp: Date.now(),
        };
        session.solves.push(solve);
        session.solveCount += 1;
        // Fire-and-forget write — in-memory state is already updated
        db.addSolve(solve);
        this.emit('solveAdded', solve);
        return solve;
    }

    _findSolveLocation(solveId) {
        for (const session of this._sessions) {
            const index = session.solves.findIndex((solve) => solve.id === solveId);
            if (index >= 0) {
                return {
                    session,
                    index,
                    solve: session.solves[index],
                };
            }
        }

        return null;
    }

    togglePenalty(solveId, penalty) {
        const location = this._findSolveLocation(solveId);
        const solve = location?.solve;
        if (!solve) return null;
        solve.penalty = solve.penalty === penalty ? null : penalty;
        db.updateSolve(solve);
        this.emit('solveUpdated', solve);
        return solve;
    }

    setSolveComment(solveId, comment) {
        const location = this._findSolveLocation(solveId);
        const solve = location?.solve;
        if (!solve) return;
        solve.comment = comment;
        db.updateSolve(solve);
        this.emit('solveUpdated', solve);
    }

    deleteSolve(solveId) {
        const location = this._findSolveLocation(solveId);
        const session = location?.session;
        if (!session) return;
        const solveIndex = location.index;
        if (solveIndex < 0) return;
        session.solves.splice(solveIndex, 1);
        session.solveCount = Math.max(0, session.solveCount - 1);
        db.deleteSolve(solveId);
        this.emit('solveDeleted', solveId);
    }

    async moveSolve(solveId, targetSessionId) {
        const location = this._findSolveLocation(solveId);
        const sourceSession = location?.session;
        const targetSession = this._sessions.find((session) => session.id === targetSessionId);

        if (!sourceSession || !targetSession || sourceSession.id === targetSession.id) return null;

        const sourceIndex = location.index;
        if (sourceIndex === -1) return null;

        const [solve] = sourceSession.solves.splice(sourceIndex, 1);
        const shouldSyncTargetSolves = Boolean(targetSession.solvesLoaded || targetSession.solveCount === 0);
        const wasTargetSolvesLoaded = targetSession.solvesLoaded;

        sourceSession.solveCount = Math.max(0, sourceSession.solveCount - 1);
        targetSession.solveCount += 1;
        solve.sessionId = targetSession.id;

        if (shouldSyncTargetSolves) {
            targetSession.solvesLoaded = true;
            const insertIndex = findSolveInsertIndex(targetSession.solves, solve);
            targetSession.solves.splice(insertIndex, 0, solve);
        }

        try {
            await db.updateSolve(solve);
        } catch (error) {
            solve.sessionId = sourceSession.id;
            sourceSession.solves.splice(sourceIndex, 0, solve);
            sourceSession.solveCount += 1;
            targetSession.solveCount = Math.max(0, targetSession.solveCount - 1);

            if (shouldSyncTargetSolves) {
                targetSession.solvesLoaded = wasTargetSolvesLoaded;
                targetSession.solves = targetSession.solves.filter((entry) => entry.id !== solve.id);
            }

            throw error;
        }

        this.emit('solveMoved', {
            solve,
            fromSessionId: sourceSession.id,
            toSessionId: targetSession.id,
        });

        return solve;
    }

    async bulkDeleteSolves(solveIds, { onProgress = null } = {}) {
        const session = this.getActiveSession();
        if (!session) return 0;

        const solveIdSet = solveIds instanceof Set ? solveIds : new Set(solveIds);
        if (solveIdSet.size === 0) return 0;

        const previousSolves = session.solves;
        const previousSolveCount = session.solveCount;
        const remainingSolves = [];
        const deletedSolveIds = [];
        const totalScanCount = session.solves.length;
        const totalWork = totalScanCount + solveIdSet.size;
        const reportProgress = (snapshot) => {
            if (typeof onProgress !== 'function') return;
            const effectiveTotalWork = Number.isFinite(snapshot.totalWork) ? snapshot.totalWork : totalWork;
            const processed = Math.max(0, Math.min(effectiveTotalWork, snapshot.processed ?? 0));
            onProgress({
                action: 'delete',
                selectedCount: solveIdSet.size,
                totalWork: effectiveTotalWork,
                ...snapshot,
                percent: effectiveTotalWork > 0 ? (processed / effectiveTotalWork) * 100 : 100,
            });
        };

        reportProgress({
            phase: 'scanning',
            completed: 0,
            total: totalScanCount,
            processed: 0,
        });

        for (let index = 0; index < session.solves.length; index += 1) {
            const solve = session.solves[index];
            if (solveIdSet.has(solve.id)) {
                deletedSolveIds.push(solve.id);
            } else {
                remainingSolves.push(solve);
            }

            const completed = index + 1;
            if (completed % BULK_OPERATION_YIELD_INTERVAL === 0 || completed === totalScanCount) {
                reportProgress({
                    phase: 'scanning',
                    completed,
                    total: totalScanCount,
                    processed: completed,
                });

                if (completed < totalScanCount) {
                    await waitForNextFrame();
                }
            }
        }

        if (deletedSolveIds.length === 0) return 0;

        session.solves = remainingSolves;
        session.solveCount = Math.max(0, previousSolveCount - deletedSolveIds.length);

        try {
            reportProgress({
                phase: 'writing',
                completed: 0,
                total: deletedSolveIds.length,
                processed: totalScanCount,
            });

            await db.deleteSolves(deletedSolveIds, {
                onProgress: ({ completed, total }) => {
                    reportProgress({
                        phase: 'writing',
                        completed,
                        total,
                        processed: totalScanCount + completed,
                    });
                },
            });
        } catch (error) {
            session.solves = previousSolves;
            session.solveCount = previousSolveCount;
            throw error;
        }

        reportProgress({
            phase: 'complete',
            completed: deletedSolveIds.length,
            total: deletedSolveIds.length,
            processed: totalWork,
        });

        this.emit('solveDeleted', deletedSolveIds);
        return deletedSolveIds.length;
    }

    async bulkMoveSolves(solveIds, targetSessionId, { onProgress = null } = {}) {
        const sourceSession = this.getActiveSession();
        const targetSession = this._sessions.find((session) => session.id === targetSessionId);

        if (!sourceSession || !targetSession || sourceSession.id === targetSession.id) return 0;

        const solveIdSet = solveIds instanceof Set ? solveIds : new Set(solveIds);
        if (solveIdSet.size === 0) return 0;

        const remainingSolves = [];
        const movedSolves = [];
        const totalScanCount = sourceSession.solves.length;
        const shouldSyncTargetSolves = Boolean(targetSession.solvesLoaded || targetSession.solveCount === 0);
        const mergeTotal = shouldSyncTargetSolves ? (targetSession.solves.length + solveIdSet.size) : 0;
        const totalWork = totalScanCount + mergeTotal + solveIdSet.size;
        const reportProgress = (snapshot) => {
            if (typeof onProgress !== 'function') return;
            const effectiveTotalWork = Number.isFinite(snapshot.totalWork) ? snapshot.totalWork : totalWork;
            const processed = Math.max(0, Math.min(effectiveTotalWork, snapshot.processed ?? 0));
            onProgress({
                action: 'move',
                selectedCount: solveIdSet.size,
                targetSessionId: targetSession.id,
                targetSessionName: targetSession.name,
                totalWork: effectiveTotalWork,
                ...snapshot,
                percent: effectiveTotalWork > 0 ? (processed / effectiveTotalWork) * 100 : 100,
            });
        };

        reportProgress({
            phase: 'scanning',
            completed: 0,
            total: totalScanCount,
            processed: 0,
        });

        for (let index = 0; index < sourceSession.solves.length; index += 1) {
            const solve = sourceSession.solves[index];
            if (solveIdSet.has(solve.id)) {
                movedSolves.push(solve);
            } else {
                remainingSolves.push(solve);
            }

            const completed = index + 1;
            if (completed % BULK_OPERATION_YIELD_INTERVAL === 0 || completed === totalScanCount) {
                reportProgress({
                    phase: 'scanning',
                    completed,
                    total: totalScanCount,
                    processed: completed,
                });

                if (completed < totalScanCount) {
                    await waitForNextFrame();
                }
            }
        }

        if (movedSolves.length === 0) return 0;

        const previousSourceSolves = sourceSession.solves;
        const previousSourceSolveCount = sourceSession.solveCount;
        const previousTargetSolves = targetSession.solves;
        const previousTargetSolveCount = targetSession.solveCount;
        const previousTargetSolvesLoaded = targetSession.solvesLoaded;
        const actualTotalWork = totalScanCount + (shouldSyncTargetSolves ? (targetSession.solves.length + movedSolves.length) : 0) + movedSolves.length;
        const progressBaseAfterScan = totalScanCount;
        const progressBaseAfterMerge = progressBaseAfterScan + (shouldSyncTargetSolves ? (targetSession.solves.length + movedSolves.length) : 0);

        sourceSession.solves = remainingSolves;
        sourceSession.solveCount = Math.max(0, previousSourceSolveCount - movedSolves.length);
        targetSession.solveCount += movedSolves.length;

        for (const solve of movedSolves) {
            solve.sessionId = targetSession.id;
        }

        if (shouldSyncTargetSolves) {
            targetSession.solvesLoaded = true;
            reportProgress({
                phase: 'merging',
                completed: 0,
                total: targetSession.solves.length + movedSolves.length,
                processed: progressBaseAfterScan,
                totalWork: actualTotalWork,
            });

            targetSession.solves = await mergeSolvesByTimestampWithProgress(
                targetSession.solves,
                movedSolves,
                ({ completed, total }) => {
                    reportProgress({
                        phase: 'merging',
                        completed,
                        total,
                        processed: progressBaseAfterScan + completed,
                        totalWork: actualTotalWork,
                    });
                },
            );
        }

        try {
            reportProgress({
                phase: 'writing',
                completed: 0,
                total: movedSolves.length,
                processed: progressBaseAfterMerge,
                totalWork: actualTotalWork,
            });

            await db.updateSolves(movedSolves, {
                onProgress: ({ completed, total }) => {
                    reportProgress({
                        phase: 'writing',
                        completed,
                        total,
                        processed: progressBaseAfterMerge + completed,
                        totalWork: actualTotalWork,
                    });
                },
            });
        } catch (error) {
            sourceSession.solves = previousSourceSolves;
            sourceSession.solveCount = previousSourceSolveCount;
            targetSession.solves = previousTargetSolves;
            targetSession.solveCount = previousTargetSolveCount;
            targetSession.solvesLoaded = previousTargetSolvesLoaded;

            for (const solve of movedSolves) {
                solve.sessionId = sourceSession.id;
            }

            throw error;
        }

        reportProgress({
            phase: 'complete',
            completed: movedSolves.length,
            total: movedSolves.length,
            processed: actualTotalWork,
            totalWork: actualTotalWork,
        });

        this.emit('solveMoved', {
            solveIds: movedSolves.map((solve) => solve.id),
            fromSessionId: sourceSession.id,
            toSessionId: targetSession.id,
        });

        return movedSolves.length;
    }

    /**
     * Get solves for the active session, filtered by current stats filter.
     * Always returns oldest-first order.
     * @returns {object[]}
     */
    getFilteredSolves() {
        return this.getFilteredSolvesForSessionId(this._activeId);
    }

    getFilteredSolvesForSessionId(sessionId) {
        const session = this.getSessionById(sessionId);
        if (!session) return [];

        const filter = settings.get('statsFilter');
        let cutoff = 0;

        switch (filter) {
            case 'today':
                cutoff = getStartOfToday();
                break;
            case 'week':
                cutoff = getStartOfWeek();
                break;
            case 'month':
                cutoff = getStartOfMonth();
                break;
            case 'custom': {
                const customFilter = parseCustomStatsFilter(settings.get('customFilterDuration'));
                if (customFilter?.mode === 'count') {
                    return session.solves.slice(-customFilter.solveCount);
                }
                if (customFilter?.mode === 'duration') {
                    cutoff = Date.now() - customFilter.durationMs;
                }
                break;
            }
            default: // 'all'
                cutoff = 0;
        }

        return session.solves.filter(s => s.timestamp >= cutoff);
    }

    /**
     * Get ALL solves for the active session (unfiltered).
     * @returns {object[]}
     */
    getAllSolves() {
        const session = this.getActiveSession();
        return session ? session.solves : [];
    }
}

export const sessionManager = new SessionManager();
