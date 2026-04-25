import { getEffectiveTime } from './utils.js?v=2026041801';

const MAX_ROLLING_STAT_WINDOW = 99999;

export function getAverageTrimCount(n) {
    return Math.ceil(n / 20);
}

export function parseRollingStatType(type) {
    const match = String(type ?? '').trim().toLowerCase().match(/^(mo|ao)([1-9]\d*)$/);
    if (!match) return null;

    const kind = match[1];
    const windowSize = Number(match[2]);
    if (!Number.isInteger(windowSize) || windowSize < 1) return null;
    if (windowSize > MAX_ROLLING_STAT_WINDOW) return null;

    if (kind === 'mo' && windowSize < 2) return null;
    if (kind === 'ao' && windowSize < 3) return null;

    const trim = kind === 'ao' ? getAverageTrimCount(windowSize) : 0;
    if (kind === 'ao' && (windowSize - (trim * 2)) <= 0) return null;

    return {
        type: `${kind}${windowSize}`,
        kind,
        windowSize,
        trim,
    };
}

export function parseGraphStatType(type) {
    const token = String(type ?? '').trim().toLowerCase();
    if (token === 'mean') {
        return {
            type: 'mean',
            kind: 'mean',
        };
    }

    return parseRollingStatType(token);
}

/**
 * Trim best and worst values from an array.
 * @param {number[]} times - Array of effective times
 * @param {number} trimCount - Number of best AND worst to remove
 * @returns {number[]} Trimmed array
 */
function trimmedArray(times, trimCount) {
    if (times.length <= trimCount * 2) return [];
    const sorted = [...times].sort((a, b) => a - b);
    return sorted.slice(trimCount, sorted.length - trimCount);
}

/**
 * Calculate mean of an array of times.
 * If any time is Infinity (DNF), result is Infinity.
 * @param {number[]} times
 * @returns {number}
 */
function mean(times) {
    if (times.length === 0) return null;
    if (times.some(t => t === Infinity)) return Infinity;
    return times.reduce((s, t) => s + t, 0) / times.length;
}

function rollingStatFromWindow(window, config) {
    if (config.kind === 'mo') return mean(window);

    const dnfCount = window.filter(t => t === Infinity).length;
    if (dnfCount > config.trim) return Infinity;

    const trimmed = trimmedArray(window, config.trim);
    return mean(trimmed);
}

export function rollingStatAt(times, index, type) {
    const config = parseRollingStatType(type);
    if (!config) return null;
    if (index < config.windowSize - 1) return null;

    const window = times.slice(index - config.windowSize + 1, index + 1);
    return rollingStatFromWindow(window, config);
}

export function rollingStatCurrent(times, type) {
    if (!times.length) return null;
    return rollingStatAt(times, times.length - 1, type);
}

/**
 * Mean of 3 (no trimming).
 * @param {number[]} times - effective times, most recent at end
 * @returns {number|null}
 */
export function mo3(times) {
    if (times.length < 3) return null;
    const last3 = times.slice(-3);
    return mean(last3);
}

/**
 * Compute mo3 at a specific index (using solves up to and including index).
 */
export function mo3At(times, index) {
    if (index < 2) return null;
    return mean(times.slice(index - 2, index + 1));
}

/**
 * Average of N with trimming.
 * @param {number[]} times
 * @param {number} n - window size
 * @param {number} trim - how many to trim from each end
 * @returns {number|null}
 */
function aoN(times, n, trim) {
    if (times.length < n) return null;
    const effectiveTrim = Number.isInteger(trim) ? trim : getAverageTrimCount(n);
    const window = times.slice(-n);
    // Count DNFs
    const dnfCount = window.filter(t => t === Infinity).length;
    // If more DNFs than trim allows, result is DNF
    if (dnfCount > effectiveTrim) return Infinity;
    const trimmed = trimmedArray(window, effectiveTrim);
    return mean(trimmed);
}

/**
 * Average of 5 (trim 1 best, 1 worst).
 */
export function ao5(times) {
    return aoN(times, 5);
}

/**
 * Average of 12 (trim 1 best, 1 worst).
 */
export function ao12(times) {
    return aoN(times, 12);
}

/**
 * Average of 100 (trim 5 best, 5 worst).
 */
export function ao100(times) {
    return aoN(times, 100);
}

function aoNAt(times, index, n, trim) {
    if (index < n - 1) return null;
    const effectiveTrim = Number.isInteger(trim) ? trim : getAverageTrimCount(n);
    const window = times.slice(index - n + 1, index + 1);
    const dnfs = window.filter(t => t === Infinity).length;
    if (dnfs > effectiveTrim) return Infinity;
    const trimmed = trimmedArray(window, effectiveTrim);
    return mean(trimmed);
}

/**
 * Compute ao5 at a specific index (using solves up to and including index).
 */
export function ao5At(times, index) {
    return aoNAt(times, index, 5);
}

/**
 * Compute ao12 at a specific index.
 */
export function ao12At(times, index) {
    return aoNAt(times, index, 12);
}

/**
 * Compute ao100 at a specific index.
 */
export function ao100At(times, index) {
    return aoNAt(times, index, 100);
}

/**
 * Find the best (minimum) value in an array, ignoring nulls.
 * @param {(number|null)[]} values
 * @returns {number|null}
 */
function best(values) {
    const valid = values.filter(v => v != null && v !== Infinity);
    if (valid.length === 0) return null;
    return Math.min(...valid);
}

/**
 * Compute all statistics from a list of solves.
 * @param {object[]} solves - Array of solve objects (oldest first)
 * @returns {object} { current, best, count, sessionMean }
 */
export function computeAll(solves) {
    const times = solves.map(s => getEffectiveTime(s));

    const currentTime = times.length > 0 ? times[times.length - 1] : null;
    const currentMo3 = mo3(times);
    const currentAo5 = ao5(times);
    const currentAo12 = ao12(times);
    const currentAo100 = ao100(times);

    // Best of each
    const allAo5 = [];
    const allAo12 = [];
    for (let i = 0; i < times.length; i++) {
        const a5 = ao5At(times, i);
        if (a5 != null) allAo5.push(a5);
        const a12 = ao12At(times, i);
        if (a12 != null) allAo12.push(a12);
    }

    // Best ao100 - compute rolling
    const allAo100 = [];
    if (times.length >= 100) {
        for (let i = 99; i < times.length; i++) {
            allAo100.push(ao100At(times, i));
        }
    }

    // All mo3
    const allMo3 = [];
    for (let i = 2; i < times.length; i++) {
        const m = mo3At(times, i);
        allMo3.push(m);
    }

    const validTimes = times.filter(t => t !== Infinity);
    const sessionMean = validTimes.length > 0
        ? validTimes.reduce((s, t) => s + t, 0) / validTimes.length
        : null;

    return {
        count: solves.length,
        sessionMean,
        current: {
            time: currentTime,
            mo3: currentMo3,
            ao5: currentAo5,
            ao12: currentAo12,
            ao100: currentAo100,
        },
        best: {
            time: best(times),
            mo3: best(allMo3),
            ao5: best(allAo5),
            ao12: best(allAo12),
            ao100: best(allAo100),
        },
    };
}

/**
 * Compute per-solve ao5 and ao12 for display in the solves table.
 * @param {object[]} solves
 * @returns {{ ao5: (number|null), ao12: (number|null), ao100: (number|null) }[]}
 */
export function perSolveStats(solves) {
    const times = solves.map(s => getEffectiveTime(s));
    return times.map((_, i) => ({
        ao5: ao5At(times, i),
        ao12: ao12At(times, i),
        ao100: ao100At(times, i),
    }));
}

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

function buildRollingMeanValues(times, windowSize) {
    const values = new Array(times.length).fill(null);
    let sum = 0;
    let dnfCount = 0;

    for (let i = 0; i < times.length; i++) {
        const time = times[i];
        if (time === Infinity) {
            dnfCount++;
        } else {
            sum += time;
        }

        if (i >= windowSize) {
            const outgoing = times[i - windowSize];
            if (outgoing === Infinity) {
                dnfCount--;
            } else {
                sum -= outgoing;
            }
        }

        if (i < windowSize - 1) continue;
        values[i] = dnfCount > 0 ? Infinity : (sum / windowSize);
    }

    return values;
}

function buildRollingAverageValues(times, windowSize, trim) {
    const values = new Array(times.length).fill(null);
    if (times.length < windowSize) return values;

    const finiteValues = times.filter(time => time !== Infinity);
    const indexToValue = Array.from(new Set(finiteValues)).sort((a, b) => a - b);
    const valueToIndex = new Map(indexToValue.map((value, index) => [value, index + 1]));
    const countTree = indexToValue.length ? new FenwickTree(indexToValue.length) : null;
    const sumTree = indexToValue.length ? new FenwickTree(indexToValue.length) : null;

    let dnfCount = 0;
    let finiteCount = 0;
    let finiteSum = 0;

    const addTime = (time) => {
        if (time === Infinity) {
            dnfCount++;
            return;
        }

        const index = valueToIndex.get(time);
        if (!index || !countTree || !sumTree) return;
        countTree.add(index, 1);
        sumTree.add(index, time);
        finiteCount++;
        finiteSum += time;
    };

    const removeTime = (time) => {
        if (time === Infinity) {
            dnfCount--;
            return;
        }

        const index = valueToIndex.get(time);
        if (!index || !countTree || !sumTree) return;
        countTree.add(index, -1);
        sumTree.add(index, -time);
        finiteCount--;
        finiteSum -= time;
    };

    for (let i = 0; i < times.length; i++) {
        addTime(times[i]);

        if (i >= windowSize) {
            removeTime(times[i - windowSize]);
        }

        if (i < windowSize - 1) continue;
        if (dnfCount > trim) {
            values[i] = Infinity;
            continue;
        }
        if (!countTree || !sumTree) continue;

        const lowTrim = trim;
        const highTrim = trim - dnfCount;
        const rightRank = finiteCount - highTrim;
        const leftRankMinusOne = lowTrim;
        if (rightRank <= leftRankMinusOne) continue;

        const rightSum = sumOfSmallestK(countTree, sumTree, indexToValue, rightRank, finiteCount, finiteSum);
        const leftSum = sumOfSmallestK(countTree, sumTree, indexToValue, leftRankMinusOne, finiteCount, finiteSum);
        values[i] = (rightSum - leftSum) / (windowSize - (trim * 2));
    }

    return values;
}

function buildRollingStatValues(times, config) {
    if (config.kind === 'mo') {
        return buildRollingMeanValues(times, config.windowSize);
    }
    return buildRollingAverageValues(times, config.windowSize, config.trim);
}

function buildRollingBestFlags(values) {
    const flags = new Array(values.length).fill(false);
    let rollingBest = Infinity;

    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value == null || value === Infinity || value >= rollingBest) continue;
        rollingBest = value;
        flags[i] = true;
    }

    return { flags, rollingBest };
}

// ──── Incremental Stats Cache ────

/**
 * A fixed-size sorted window for sliding-window average computation.
 * Uses binary insertion + splice to maintain a sorted array of at most `size` elements.
 * This avoids the slice+sort allocation pattern in the hot rebuild path.
 */
class SortedWindow {
    constructor(size, trim) {
        this._size = size;
        this._trim = trim;
        this._buf = [];     // circular chronological buffer (unsorted)
        this._sorted = [];  // sorted copy of _buf
        this._pos = 0;
        this._dnfs = 0;
        this._sumTrimmed = 0; // not maintained (we compute on query — window is small)
    }

    /**
     * Push a new value, evicting the oldest if full.
     * @param {number} val
     */
    push(val) {
        if (this._buf.length === this._size) {
            // Evict oldest
            const old = this._buf[this._pos];
            this._buf[this._pos] = val;
            // Remove old from sorted
            const oi = this._sorted.indexOf(old);
            if (oi >= 0) this._sorted.splice(oi, 1);
            if (old === Infinity) this._dnfs--;
        } else {
            this._buf.push(val);
        }
        this._pos = (this._pos + 1) % this._size;

        // Insert val into sorted
        if (val === Infinity) {
            this._sorted.push(val);
            this._dnfs++;
        } else {
            let lo = 0, hi = this._sorted.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (this._sorted[mid] < val) lo = mid + 1; else hi = mid;
            }
            this._sorted.splice(lo, 0, val);
        }
    }

    isReady() { return this._buf.length === this._size; }

    /**
     * Compute trimmed mean of the current window.
     * Returns null if not full, Infinity if too many DNFs.
     */
    average() {
        if (this._buf.length < this._size) return null;
        const sorted = this._sorted;
        const n = this._size;
        const tr = this._trim;
        if (this._dnfs > tr) return Infinity;
        // Trim from each end (sorted ascending; Infinities are at end)
        let sum = 0;
        const count = n - 2 * tr;
        for (let i = tr; i < n - tr; i++) sum += sorted[i];
        return sum / count;
    }
}

/**
 * A cache that maintains rolling statistics incrementally.
 */
export class StatsCache {
    constructor() {
        /** @type {string[]} */
        this._solveIds = [];
        /** @type {number[]} effective times */
        this._times = [];
        /** @type {{ ao5: number|null, ao12: number|null, ao100: number|null }[]} */
        this._perSolve = [];
        /** @type {Map<string, { config: ReturnType<typeof parseRollingStatType>, values: (number|null)[], newBestFlags: boolean[], rollingBest: number }>} */
        this._rollingSeries = new Map();

        this._bestTime = null;
        this._bestMo3 = null;
        this._bestAo5 = null;
        this._bestAo12 = null;
        this._bestAo100 = null;

        this._validSum = 0;
        this._validCount = 0;

        this._newBestFlags = [];
        this._rollingBestTime = Infinity;

        // Sliding windows (reused across appends)
        this._win5 = new SortedWindow(5, 1);
        this._win12 = new SortedWindow(12, 1);
        this._win100 = new SortedWindow(100, 5);
    }

    get length() { return this._times.length; }

    _reset() {
        this._solveIds = [];
        this._times = [];
        this._perSolve = [];
        this._bestTime = null;
        this._bestMo3 = null;
        this._bestAo5 = null;
        this._bestAo12 = null;
        this._bestAo100 = null;
        this._validSum = 0;
        this._validCount = 0;
        this._newBestFlags = [];
        this._rollingBestTime = Infinity;
        this._win5 = new SortedWindow(5, 1);
        this._win12 = new SortedWindow(12, 1);
        this._win100 = new SortedWindow(100, 5);
        this._rollingSeries.clear();
    }

    /**
     * Full rebuild from a solve array.
     * @param {object[]} solves
     */
    rebuild(solves) {
        this._reset();
        for (const solve of solves) {
            this._appendSolve(solve);
        }
    }

    /**
     * Append a single solve (used after addSolve).
     * @param {object} solve
     */
    append(solve) {
        this._appendSolve(solve);
    }

    matchesSolves(solves) {
        if (this._solveIds.length !== solves.length) return false;

        for (let i = 0; i < solves.length; i++) {
            if (this._solveIds[i] !== String(solves[i]?.id ?? '')) return false;
        }

        return true;
    }

    /** Internal: append a solve and update all caches */
    _appendSolve(solve) {
        this._solveIds.push(String(solve?.id ?? ''));
        const t = getEffectiveTime(solve);
        this._times.push(t);
        const i = this._times.length - 1;

        // Session mean
        if (t !== Infinity) {
            this._validSum += t;
            this._validCount++;
        }

        // Sliding window averages — O(log k) per window, no allocation
        this._win5.push(t);
        this._win12.push(t);
        this._win100.push(t);

        const a5 = this._win5.isReady() ? this._win5.average() : null;
        const a12 = this._win12.isReady() ? this._win12.average() : null;
        const a100 = this._win100.isReady() ? this._win100.average() : null;
        this._perSolve.push({ ao5: a5, ao12: a12, ao100: a100 });

        // Update running bests
        if (t !== Infinity) {
            if (this._bestTime === null || t < this._bestTime) this._bestTime = t;
        }
        const m3 = i >= 2 ? mo3At(this._times, i) : null;
        if (m3 != null && m3 !== Infinity) {
            if (this._bestMo3 === null || m3 < this._bestMo3) this._bestMo3 = m3;
        }
        if (a5 != null && a5 !== Infinity) {
            if (this._bestAo5 === null || a5 < this._bestAo5) this._bestAo5 = a5;
        }
        if (a12 != null && a12 !== Infinity) {
            if (this._bestAo12 === null || a12 < this._bestAo12) this._bestAo12 = a12;
        }
        if (a100 != null && a100 !== Infinity) {
            if (this._bestAo100 === null || a100 < this._bestAo100) this._bestAo100 = a100;
        }

        // New best single flag
        if (t !== Infinity && t < this._rollingBestTime) {
            this._rollingBestTime = t;
            this._newBestFlags.push(true);
        } else {
            this._newBestFlags.push(false);
        }
    }

    /**
     * Get the same shape as computeAll() returns, but from the cache.
     */
    getStats() {
        const n = this._times.length;
        const lastTime = n > 0 ? this._times[n - 1] : null;
        const lastMo3 = n >= 3 ? mo3At(this._times, n - 1) : null;
        const lastPs = n > 0 ? this._perSolve[n - 1] : { ao5: null, ao12: null, ao100: null };

        return {
            count: n,
            sessionMean: this._validCount > 0 ? this._validSum / this._validCount : null,
            current: {
                time: lastTime,
                mo3: lastMo3,
                ao5: lastPs.ao5,
                ao12: lastPs.ao12,
                ao100: lastPs.ao100,
            },
            best: {
                time: this._bestTime,
                mo3: this._bestMo3,
                ao5: this._bestAo5,
                ao12: this._bestAo12,
                ao100: this._bestAo100,
            },
        };
    }

    /** Get per-solve stats at index i. */
    getPerSolveAt(i) {
        return this._perSolve[i] || null;
    }

    /** Get new-best-single flag at index i. */
    isNewBestAt(i) {
        return !!this._newBestFlags[i];
    }

    /** Get effective time at index i. */
    getTimeAt(i) {
        return this._times[i];
    }

    _ensureRollingSeries(statType) {
        const config = parseRollingStatType(statType);
        if (!config) return null;

        const key = config.type;
        const length = this._times.length;
        let entry = this._rollingSeries.get(key) || null;

        if (!entry || entry.values.length > length) {
            const values = buildRollingStatValues(this._times, config);
            const { flags, rollingBest } = buildRollingBestFlags(values);
            entry = { config, values, newBestFlags: flags, rollingBest };
            this._rollingSeries.set(key, entry);
            return entry;
        }

        if (entry.values.length === length) {
            return entry;
        }

        if (entry.values.length === (length - 1)) {
            const nextValue = rollingStatAt(this._times, length - 1, key);
            entry.values.push(nextValue);

            if (nextValue != null && nextValue !== Infinity && nextValue < entry.rollingBest) {
                entry.rollingBest = nextValue;
                entry.newBestFlags.push(true);
            } else {
                entry.newBestFlags.push(false);
            }

            return entry;
        }

        const values = buildRollingStatValues(this._times, config);
        const { flags, rollingBest } = buildRollingBestFlags(values);
        entry = { config, values, newBestFlags: flags, rollingBest };
        this._rollingSeries.set(key, entry);
        return entry;
    }

    getRollingStatValueAt(statType, i) {
        const entry = this._ensureRollingSeries(statType);
        return entry?.values[i] ?? null;
    }

    isRollingStatNewBestAt(statType, i) {
        const entry = this._ensureRollingSeries(statType);
        return !!entry?.newBestFlags[i];
    }

    getRollingStatNewBestFlags(statType) {
        const entry = this._ensureRollingSeries(statType);
        return entry?.newBestFlags || [];
    }

    getRollingStatValues(statType) {
        const entry = this._ensureRollingSeries(statType);
        return entry?.values || [];
    }

    /** Get the full times array. */
    getTimes() {
        return this._times;
    }
}
