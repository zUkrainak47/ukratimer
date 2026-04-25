function rn(max) {
    return Math.floor(Math.random() * max);
}

function rndEl(values) {
    return values[rn(values.length)];
}

function rndProb(probabilities) {
    let total = 0;
    let selectedIndex = 0;

    probabilities.forEach((probability, index) => {
        if (!probability) return;
        if (Math.random() < (probability / (total + probability))) {
            selectedIndex = index;
        }
        total += probability;
    });

    return selectedIndex;
}

function normalizeScrambleText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPruning(table, index) {
    return (table[index >> 3] >> ((index & 7) << 2)) & 15;
}

function acycle(values, permutation, pow = 1, orientation = null) {
    const length = permutation.length;
    const base = orientation ? orientation[orientation.length - 1] : 0;
    const snapshot = permutation.map((entry) => values[entry]);

    for (let index = 0; index < length; index += 1) {
        const targetIndex = (index + pow) % length;
        values[permutation[targetIndex]] = snapshot[index];
        if (orientation) {
            values[permutation[targetIndex]] += orientation[targetIndex] - orientation[index] + base;
        }
    }

    return values;
}

function getNPerm(values, length = values.length, even = 0) {
    let index = 0;

    for (let start = 0; start < length - 1; start += 1) {
        let smaller = 0;
        for (let cursor = start + 1; cursor < length; cursor += 1) {
            if (values[cursor] < values[start]) {
                smaller += 1;
            }
        }
        index = index * (length - start) + smaller;
    }

    return even < 0 ? (index >> 1) : index;
}

function setNPerm(values, index, length, even = 0) {
    const available = Array.from({ length }, (_, cursor) => cursor);
    const digits = new Array(length - 1).fill(0);
    let parity = 0;
    let remainingIndex = even < 0 ? index * 2 : index;

    for (let divisor = 2; divisor <= length; divisor += 1) {
        const digitIndex = length - divisor;
        const digit = remainingIndex % divisor;
        digits[digitIndex] = digit;
        parity ^= digit;
        remainingIndex = Math.floor(remainingIndex / divisor);
    }

    for (let cursor = 0; cursor < length - 1; cursor += 1) {
        values[cursor] = available.splice(digits[cursor], 1)[0];
    }

    values[length - 1] = available[0];

    if (even < 0 && parity) {
        const swap = values[length - 1];
        values[length - 1] = values[length - 2];
        values[length - 2] = swap;
    }

    return values;
}

function getNOri(values, length, evenBase) {
    const base = Math.abs(evenBase);
    let index = evenBase < 0 ? 0 : (values[0] % base);

    for (let cursor = length - 1; cursor > 0; cursor -= 1) {
        index = (index * base) + (values[cursor] % base);
    }

    return index;
}

function setNOri(values, index, length, evenBase) {
    const base = Math.abs(evenBase);
    let parity = base * length;
    let remainingIndex = index;

    for (let cursor = 1; cursor < length; cursor += 1) {
        values[cursor] = remainingIndex % base;
        parity -= values[cursor];
        remainingIndex = Math.floor(remainingIndex / base);
    }

    values[0] = (evenBase < 0 ? parity : remainingIndex) % base;
    return values;
}

class Coord {
    constructor(type, length, evenBase) {
        this.length = length;
        this.evenBase = evenBase;

        if (type === 'p') {
            this.get = (values) => getNPerm(values, this.length, this.evenBase);
            this.set = (values, index) => setNPerm(values, index, this.length, this.evenBase);
            return;
        }

        if (type === 'o') {
            this.get = (values) => getNOri(values, this.length, this.evenBase);
            this.set = (values, index) => setNOri(values, index, this.length, this.evenBase);
            return;
        }

        throw new Error(`Unsupported coordinate type: ${type}`);
    }
}

function createMove(moveTable, size, doMove, moveCount) {
    if (Array.isArray(doMove)) {
        const coord = new Coord(doMove[1], doMove[2], doMove[3]);
        const moveFn = doMove[0];

        for (let axis = 0; axis < moveCount; axis += 1) {
            moveTable[axis] = [];
            for (let index = 0; index < size; index += 1) {
                const state = coord.set([], index);
                moveFn(state, axis);
                moveTable[axis][index] = coord.get(state);
            }
        }
        return;
    }

    for (let axis = 0; axis < moveCount; axis += 1) {
        moveTable[axis] = [];
        for (let index = 0; index < size; index += 1) {
            moveTable[axis][index] = doMove(index, axis);
        }
    }
}

function createPrun(prun, init, size, maxDepth, doMove, moveCount, powerCount, inverseDepth = 256) {
    const isMoveTable = Array.isArray(doMove);
    const initialStates = Array.isArray(init) ? init : [init];
    const packedLength = (size + 7) >>> 3;

    for (let index = 0; index < packedLength; index += 1) {
        prun[index] = -1;
    }

    initialStates.forEach((state) => {
        prun[state >> 3] ^= 15 << ((state & 7) << 2);
    });

    let value = 0;

    for (let depth = 0; depth <= (maxDepth || 256); depth += 1) {
        let visited = 0;
        const useInverse = depth >= inverseDepth;
        const fillValue = (depth + 1) ^ 15;
        const findValue = useInverse ? 15 : depth;
        const checkValue = useInverse ? depth : 15;

        outer: for (let state = 0; state < size; state += 1, value >>= 4) {
            if ((state & 7) === 0) {
                value = prun[state >> 3];
                if (!useInverse && value === -1) {
                    state += 7;
                    continue;
                }
            }

            if ((value & 15) !== findValue) continue;

            for (let axis = 0; axis < moveCount; axis += 1) {
                let nextState = state;

                for (let power = 0; power < powerCount; power += 1) {
                    nextState = isMoveTable ? doMove[axis][nextState] : doMove(nextState, axis);
                    if (nextState < 0) break;
                    if (getPruning(prun, nextState) !== checkValue) continue;

                    visited += 1;

                    if (useInverse) {
                        prun[state >> 3] ^= fillValue << ((state & 7) << 2);
                        continue outer;
                    }

                    prun[nextState >> 3] ^= fillValue << ((nextState & 7) << 2);
                }
            }
        }

        if (visited === 0) break;
    }
}

class Searcher {
    constructor(isSolved, getPrun, doMove, axisCount, powerCount, ckmv = Array.from({ length: axisCount }, (_, index) => (1 << index))) {
        this.isSolved = isSolved || (() => true);
        this.getPrun = getPrun;
        this.doMove = doMove;
        this.axisCount = axisCount;
        this.powerCount = powerCount;
        this.ckmv = ckmv;
    }

    solve(index, minLength, maxLength) {
        this.sol = [];

        for (let length = minLength; length <= maxLength; length += 1) {
            if (this.idaSearch(index, length, 0, -1, this.sol) === 0) {
                return this.sol;
            }
        }

        return null;
    }

    idaSearch(index, maxLength, depth, lastMove, solution) {
        const pruning = this.getPrun(index);
        if (pruning > maxLength) {
            return pruning > (maxLength + 1) ? 2 : 1;
        }

        if (maxLength === 0) {
            return this.isSolved(index) ? 0 : 1;
        }

        if (pruning === 0 && maxLength === 1 && this.isSolved(index)) {
            return 1;
        }

        let axis = solution.length > depth ? solution[depth][0] : 0;
        for (; axis < this.axisCount; axis += 1) {
            if ((this.ckmv[lastMove] >> axis) & 1) continue;

            let nextIndex = Array.isArray(index) ? index.slice() : index;
            let power = solution.length > depth ? solution[depth][1] : 0;

            for (; power < this.powerCount; power += 1) {
                nextIndex = this.doMove(nextIndex, axis, power);
                if (nextIndex == null) break;

                solution[depth] = [axis, power];
                const result = this.idaSearch(nextIndex, maxLength - 1, depth + 1, axis, solution);

                if (result === 0) {
                    return 0;
                }

                solution.pop();
                if (result === 2) break;
            }
        }

        return 1;
    }
}

class Solver {
    constructor(axisCount, powerCount, stateParams) {
        this.axisCount = axisCount;
        this.powerCount = powerCount;
        this.stateParams = stateParams;
        this.inited = false;
    }

    init() {
        if (this.inited) return;

        this.move = [];
        this.prun = [];

        this.stateParams.forEach((stateParam, index) => {
            const [init, doMove, size, maxDepth, inverseDepth] = stateParam;
            this.move[index] = [];
            this.prun[index] = [];
            createMove(this.move[index], size, doMove, this.axisCount);
            createPrun(this.prun[index], init, size, maxDepth, this.move[index], this.axisCount, this.powerCount, inverseDepth);
        });

        this.searcher = new Searcher(
            null,
            (state) => this.prun.reduce((max, table, index) => Math.max(max, getPruning(table, state[index])), 0),
            (state, axis) => state.map((entry, index) => this.move[index][axis][entry]),
            this.axisCount,
            this.powerCount,
        );

        this.inited = true;
    }

    search(state, minLength, maxLength = 99) {
        this.init();
        return this.searcher.solve(state, minLength, maxLength + 1);
    }

    toStr(solution, moveMap, powerMap) {
        return normalizeScrambleText(solution.map(([axis, power]) => `${moveMap[axis]}${powerMap[power]}`).join(' '));
    }
}

const TWO_BY_TWO_MOVE_PIECES = Object.freeze([
    Object.freeze([0, 2, 3, 1]),
    Object.freeze([0, 1, 5, 4]),
    Object.freeze([0, 4, 6, 2]),
]);
const TWO_BY_TWO_MOVE_ORIS = Object.freeze([
    null,
    Object.freeze([0, 1, 0, 1, 3]),
    Object.freeze([1, 0, 1, 0, 3]),
]);
const TWO_BY_TWO_EG_PERMS = Object.freeze([
    Object.freeze([4, 5, 6]),
    Object.freeze([4, 6, 5]),
    Object.freeze([6, 5, 4]),
    Object.freeze([5, 4, 6]),
    Object.freeze([5, 6, 4]),
    Object.freeze([6, 4, 5]),
]);
const TWO_BY_TWO_EGLL_MAP = Object.freeze([
    Object.freeze([0x3210, 0x1221, 2]),
    Object.freeze([0x3120, 0x1221, 2]),
    Object.freeze([0x2310, 0x1221, 4]),
    Object.freeze([0x3012, 0x1221, 4]),
    Object.freeze([0x0312, 0x0210, 4]),
    Object.freeze([0x2310, 0x0210, 4]),
    Object.freeze([0x0213, 0x0210, 4]),
    Object.freeze([0x3210, 0x0210, 4]),
    Object.freeze([0x2013, 0x0210, 4]),
    Object.freeze([0x3012, 0x0210, 4]),
    Object.freeze([0x3210, 0x1212, 4]),
    Object.freeze([0x0213, 0x1212, 4]),
    Object.freeze([0x2310, 0x1212, 4]),
    Object.freeze([0x2013, 0x1212, 4]),
    Object.freeze([0x3012, 0x1212, 4]),
    Object.freeze([0x0312, 0x1212, 4]),
    Object.freeze([0x3210, 0x2220, 4]),
    Object.freeze([0x0213, 0x2220, 4]),
    Object.freeze([0x0312, 0x2220, 4]),
    Object.freeze([0x3012, 0x2220, 4]),
    Object.freeze([0x2013, 0x2220, 4]),
    Object.freeze([0x2310, 0x2220, 4]),
    Object.freeze([0x2310, 0x1020, 4]),
    Object.freeze([0x2013, 0x1020, 4]),
    Object.freeze([0x0213, 0x1020, 4]),
    Object.freeze([0x3210, 0x1020, 4]),
    Object.freeze([0x3012, 0x1020, 4]),
    Object.freeze([0x0312, 0x1020, 4]),
    Object.freeze([0x0213, 0x2010, 4]),
    Object.freeze([0x3210, 0x2010, 4]),
    Object.freeze([0x0312, 0x2010, 4]),
    Object.freeze([0x3012, 0x2010, 4]),
    Object.freeze([0x2310, 0x2010, 4]),
    Object.freeze([0x2013, 0x2010, 4]),
    Object.freeze([0x3210, 0x1011, 4]),
    Object.freeze([0x0213, 0x1011, 4]),
    Object.freeze([0x0312, 0x1011, 4]),
    Object.freeze([0x3012, 0x1011, 4]),
    Object.freeze([0x2310, 0x1011, 4]),
    Object.freeze([0x2013, 0x1011, 4]),
]);
const TWO_BY_TWO_EGLL_PROBS = Object.freeze(TWO_BY_TWO_EGLL_MAP.map((entry) => entry[2]));

function doTwoByTwoPermMove(values, move) {
    acycle(values, TWO_BY_TWO_MOVE_PIECES[move]);
}

function doTwoByTwoOriMove(values, move) {
    acycle(values, TWO_BY_TWO_MOVE_PIECES[move], 1, TWO_BY_TWO_MOVE_ORIS[move]);
}

const twoByTwoOriCoord = new Coord('o', 7, -3);
const twoByTwoSolver = new Solver(3, 3, [
    [0, [doTwoByTwoPermMove, 'p', 7], 5040],
    [0, [doTwoByTwoOriMove, 'o', 7, -3], 729],
]);

function createTwoByTwoSubsetScramble(type) {
    const llCase = TWO_BY_TWO_EGLL_MAP[rndProb(TWO_BY_TWO_EGLL_PROBS)];
    const permutation = [0, 1, 2, 3];
    const orientation = [0, 0, 0, 0, 0, 0, 0];

    if (type === '222cll') {
        permutation.push(...TWO_BY_TWO_EG_PERMS[0]);
    } else if (type === '222eg1') {
        permutation.push(...TWO_BY_TWO_EG_PERMS[2 + rn(4)]);
    } else if (type === '222eg2') {
        permutation.push(...TWO_BY_TWO_EG_PERMS[1]);
    } else {
        throw new Error(`Unsupported 2x2 subset scramble type: ${type}`);
    }

    let randomAuf = rn(4);
    while (randomAuf-- > 0) {
        doTwoByTwoPermMove(permutation, 0);
    }

    const permutationSnapshot = permutation.slice();
    for (let index = 0; index < 4; index += 1) {
        permutation[index] = permutationSnapshot[(llCase[0] >> (index * 4)) & 0xf];
        orientation[index] = (llCase[1] >> (index * 4)) & 0xf;
    }

    let randomU = rn(4);
    while (randomU-- > 0) {
        doTwoByTwoOriMove(orientation, 0);
        doTwoByTwoPermMove(permutation, 0);
    }

    const permutationIndex = getNPerm(permutation, 7);
    const orientationIndex = twoByTwoOriCoord.get(orientation);
    const solution = twoByTwoSolver.search([permutationIndex, orientationIndex], 9);

    if (!solution) {
        throw new Error(`Failed to generate a 2x2 subset scramble for ${type}.`);
    }

    return twoByTwoSolver.toStr(solution.reverse(), 'URF', ["'", '2', '']);
}

const PYRAMINX_MOVE_PIECES = Object.freeze([
    Object.freeze([0, 1, 3]),
    Object.freeze([1, 2, 5]),
    Object.freeze([0, 4, 2]),
    Object.freeze([3, 5, 4]),
]);
const PYRAMINX_MOVE_ORIS = Object.freeze([
    Object.freeze([0, 1, 0, 2]),
    Object.freeze([0, 1, 0, 2]),
    Object.freeze([0, 0, 1, 2]),
    Object.freeze([0, 0, 1, 2]),
]);
const PYRAMINX_AUFS = Object.freeze([
    Object.freeze([0, 0]),
    Object.freeze([183, 869]),
    Object.freeze([87, 1729]),
]);
const PYRAMINX_L4E_MAP = Object.freeze([
    Object.freeze([1, 3]),
    Object.freeze([59, 3]),
    Object.freeze([25, 3]),
    Object.freeze([35, 3]),
    Object.freeze([12, 3]),
    Object.freeze([10, 3]),
    Object.freeze([2, 1]),
    Object.freeze([4, 1]),
    Object.freeze([3, 3]),
    Object.freeze([57, 3]),
    Object.freeze([53, 3]),
    Object.freeze([45, 3]),
    Object.freeze([33, 3]),
    Object.freeze([27, 3]),
    Object.freeze([49, 3]),
    Object.freeze([43, 3]),
    Object.freeze([41, 3]),
    Object.freeze([51, 3]),
    Object.freeze([8, 3]),
    Object.freeze([16, 3]),
    Object.freeze([56, 1]),
    Object.freeze([21, 3]),
    Object.freeze([13, 3]),
    Object.freeze([29, 3]),
    Object.freeze([37, 3]),
    Object.freeze([61, 3]),
    Object.freeze([5, 3]),
    Object.freeze([17, 3]),
    Object.freeze([11, 3]),
    Object.freeze([9, 3]),
    Object.freeze([19, 3]),
    Object.freeze([20, 3]),
    Object.freeze([18, 3]),
    Object.freeze([60, 1]),
    Object.freeze([58, 1]),
]);
const PYRAMINX_L4E_PROBS = Object.freeze(PYRAMINX_L4E_MAP.map((entry) => entry[1]));

function doPyraminxPermMove(values, move) {
    acycle(values, PYRAMINX_MOVE_PIECES[move]);
}

const pyraminxEdgeOriCoord = new Coord('o', 6, -2);
const pyraminxEdgePermCoord = new Coord('p', 6, -1);
const pyraminxCornerOriCoord = new Coord('o', 4, 3);

function pyraminxOriMove(index, move) {
    const edgeOrientation = pyraminxEdgeOriCoord.set([], index & 0x1f);
    const cornerOrientation = pyraminxCornerOriCoord.set([], index >> 5);
    cornerOrientation[move] += 1;
    acycle(edgeOrientation, PYRAMINX_MOVE_PIECES[move], 1, PYRAMINX_MOVE_ORIS[move]);
    return (pyraminxCornerOriCoord.get(cornerOrientation) << 5) | pyraminxEdgeOriCoord.get(edgeOrientation);
}

function pyraminxMult(stateA, stateB) {
    const edgePermA = pyraminxEdgePermCoord.set([], stateA[0]);
    const edgeOriA = pyraminxEdgeOriCoord.set([], stateA[1] & 0x1f);
    const cornerOriA = pyraminxCornerOriCoord.set([], stateA[1] >> 5);
    const edgePermB = pyraminxEdgePermCoord.set([], stateB[0]);
    const edgeOriB = pyraminxEdgeOriCoord.set([], stateB[1] & 0x1f);
    const cornerOriB = pyraminxCornerOriCoord.set([], stateB[1] >> 5);
    const edgePerm = [];
    const edgeOri = [];
    const cornerOri = [];

    for (let index = 0; index < 6; index += 1) {
        edgePerm[index] = edgePermA[edgePermB[index]];
        edgeOri[index] = edgeOriA[edgePermB[index]] ^ edgeOriB[index];
    }

    for (let index = 0; index < 4; index += 1) {
        cornerOri[index] = cornerOriA[index] + cornerOriB[index];
    }

    return [
        pyraminxEdgePermCoord.get(edgePerm),
        (pyraminxCornerOriCoord.get(cornerOri) << 5) | pyraminxEdgeOriCoord.get(edgeOri),
    ];
}

const pyraminxSolver = new Solver(4, 2, [
    [0, [doPyraminxPermMove, 'p', 6, -1], 360],
    [0, pyraminxOriMove, 2592],
]);

function createPyraminxL4EScramble() {
    const l4eCase = PYRAMINX_L4E_MAP[rndProb(PYRAMINX_L4E_PROBS)][0];
    const edgePermutation = getNPerm(setNPerm([], l4eCase & 1, 4, -1).concat([4, 5]), 6, -1);
    const orientation = (((l4eCase >> 1) & 0x3) * 864) + (l4eCase >> 3);
    const state = pyraminxMult(rndEl(PYRAMINX_AUFS), pyraminxMult([edgePermutation, orientation], rndEl(PYRAMINX_AUFS)));
    const solution = pyraminxSolver.search(state, 8);

    if (!solution) {
        throw new Error('Failed to generate a Pyraminx L4E scramble.');
    }

    let scramble = pyraminxSolver.toStr(solution.reverse(), 'ULRB', ["'", '']);

    for (let index = 0; index < 4; index += 1) {
        const tipMove = rn(3);
        if (tipMove < 2) {
            scramble += `${scramble ? ' ' : ''}${'lrbu'.charAt(index)}${tipMove === 0 ? '' : "'"}`;
        }
    }

    return normalizeScrambleText(scramble);
}

export function createSubsetScramble(type) {
    switch (type) {
    case '222cll':
    case '222eg1':
    case '222eg2':
        return createTwoByTwoSubsetScramble(type);
    case 'pyrl4e':
        return createPyraminxL4EScramble();
    default:
        throw new Error(`Unsupported subset scramble type: ${type}`);
    }
}
