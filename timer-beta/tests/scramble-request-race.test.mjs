import test from 'node:test';
import assert from 'node:assert/strict';

const storedValues = new Map();
globalThis.localStorage = {
    getItem(key) {
        return storedValues.has(key) ? storedValues.get(key) : null;
    },
    setItem(key, value) {
        storedValues.set(key, String(value));
    },
    removeItem(key) {
        storedValues.delete(key);
    },
};

const idleCallbacks = [];
globalThis.window = {
    setTimeout,
    clearTimeout,
    requestIdleCallback(callback) {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
    },
};

const {
    getCurrentScramble,
    getCurrentTrainerCase,
    getScramble,
    isCurrentScrambleManual,
    setCurrentScramble,
    setPllCaseSelection,
    setScrambleType,
} = await import('../js/scramble.js');

test('a scramble request from the previous type cannot overwrite the current trainer scramble', async () => {
    setScrambleType('ll');
    const staleOllRequest = getScramble();

    setScrambleType('pll');
    const currentPllRequest = getScramble();

    assert.equal(await staleOllRequest, null);
    assert.match(await currentPllRequest, /\S/);
    assert.equal(getCurrentTrainerCase()?.trainerId, 'pll');
});

test('a scramble request using a previous trainer selection is discarded', async () => {
    setScrambleType('pll');
    setPllCaseSelection(['ua', 'ub']);
    const staleSelectionRequest = getScramble();

    setPllCaseSelection(['h']);
    const currentSelectionRequest = getScramble();

    assert.equal(await staleSelectionRequest, null);
    assert.match(await currentSelectionRequest, /\S/);
    assert.deepEqual(getCurrentTrainerCase(), { trainerId: 'pll', caseId: 'h' });
});

test('setting a manual scramble invalidates an in-flight generated scramble', async () => {
    const staleGeneratedRequest = getScramble();
    setCurrentScramble("R U R' U'");

    assert.equal(await staleGeneratedRequest, null);
    assert.equal(getCurrentScramble(), "R U R' U'");
    assert.equal(isCurrentScrambleManual(), true);
    assert.equal(getCurrentTrainerCase(), null);
});
