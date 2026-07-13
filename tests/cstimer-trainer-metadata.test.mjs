import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCsTimerTrainerCaseMetadata,
    buildCsTimerTrainerSelections,
    normalizeCsTimerTrainerSelections,
    normalizeTrainerCaseMetadata,
    resolveCsTimerTrainerCaseMetadata,
} from '../js/cstimer-trainer-metadata.mjs';

function solve({ timestamp = 1_700_000_000_123, time = 1234, scramble = 'R U', trainerCase = null } = {}) {
    return { timestamp, time, scramble, ...(trainerCase ? { trainerCase } : {}) };
}

function csSolve(value) {
    return [[0, value.time], value.scramble, '', Math.floor(value.timestamp / 1000)];
}

test('normalizes supported trainer metadata', () => {
    assert.deepEqual(normalizeTrainerCaseMetadata({ trainerId: ' OLL ', caseId: ' 21 ' }), {
        trainerId: 'oll',
        caseId: '21',
    });
    assert.deepEqual(normalizeTrainerCaseMetadata({ trainerId: 'PLL', caseId: ' UA ' }), {
        trainerId: 'pll',
        caseId: 'ua',
    });
});

test('rejects malformed and unsupported trainer metadata', () => {
    assert.equal(normalizeTrainerCaseMetadata(null), null);
    assert.equal(normalizeTrainerCaseMetadata({ trainerId: 'f2l', caseId: '1' }), null);
    assert.equal(normalizeTrainerCaseMetadata({ trainerId: 'oll', caseId: ' ' }), null);
});

test('normalizes trainer selections for csTimer backup metadata', () => {
    assert.deepEqual(normalizeCsTimerTrainerSelections({
        ollCaseSelection: [' 21 ', 57, '21', '', null],
        pllCaseSelection: [' UA ', 'ub', 'ua'],
    }), {
        ollCaseSelection: ['21', '57'],
        pllCaseSelection: ['ua', 'ub'],
    });
});

test('preserves explicit empty selections and ignores malformed selection fields', () => {
    assert.deepEqual(normalizeCsTimerTrainerSelections({
        ollCaseSelection: [],
        pllCaseSelection: 'ua',
    }), {
        ollCaseSelection: [],
    });
    assert.deepEqual(normalizeCsTimerTrainerSelections(null), {});
});

test('drops unsupported OLL and PLL case IDs from trainer selections', () => {
    assert.deepEqual(normalizeCsTimerTrainerSelections({
        ollCaseSelection: [0, 1, 57, 58, 'bogus'],
        pllCaseSelection: ['ua', 'bogus', 21, 'Z'],
    }), {
        ollCaseSelection: ['1', '57'],
        pllCaseSelection: ['ua', 'z'],
    });
});

test('builds effective trainer selections for csTimer export metadata', () => {
    const defaults = buildCsTimerTrainerSelections({
        ollCaseSelection: [],
        pllCaseSelection: ['bogus'],
    });
    assert.deepEqual(defaults.ollCaseSelection, Array.from({ length: 57 }, (_, index) => String(index + 1)));
    assert.deepEqual(defaults.pllCaseSelection, [
        'aa', 'ab', 'e', 'f', 'ga', 'gb', 'gc', 'gd', 'h', 'ja', 'jb',
        'na', 'nb', 'ra', 'rb', 't', 'ua', 'ub', 'v', 'y', 'z',
    ]);

    assert.deepEqual(buildCsTimerTrainerSelections({
        ollCaseSelection: ['21'],
        pllCaseSelection: ['UA', 'z'],
    }), {
        ollCaseSelection: ['21'],
        pllCaseSelection: ['ua', 'z'],
    });
});

test('builds sparse compact metadata', () => {
    const solves = [
        solve(),
        solve({ trainerCase: { trainerId: 'oll', caseId: '21' } }),
        solve({ trainerCase: { trainerId: 'pll', caseId: 'ua' } }),
    ];
    const metadata = buildCsTimerTrainerCaseMetadata(solves);

    assert.deepEqual(Object.keys(metadata), ['1', '2']);
    assert.equal(metadata['1'].length, 3);
    assert.equal(metadata['1'][1], 0);
    assert.equal(metadata['1'][2], '21');
    assert.equal(metadata['2'][1], 1);
    assert.equal(metadata['2'][2], 'ua');
    assert.ok(JSON.stringify(metadata).length < 90, 'two trainer records should stay below 90 bytes');
});

test('omits trainerCases when no solves carry trainer metadata', () => {
    assert.equal(buildCsTimerTrainerCaseMetadata([solve(), solve()]), null);
});

test('restores unchanged sparse metadata', () => {
    const solves = [
        solve(),
        solve({ timestamp: 1_700_000_001_123, trainerCase: { trainerId: 'oll', caseId: '21' } }),
    ];
    const resolved = resolveCsTimerTrainerCaseMetadata(
        buildCsTimerTrainerCaseMetadata(solves),
        solves.map(csSolve),
    );

    assert.deepEqual(resolved.get(1), { trainerId: 'oll', caseId: '21' });
    assert.equal(resolved.size, 1);
});

test('relocates metadata after a solve is inserted', () => {
    const trained = solve({ trainerCase: { trainerId: 'pll', caseId: 'ub' } });
    const metadata = buildCsTimerTrainerCaseMetadata([trained]);
    const inserted = solve({ timestamp: trained.timestamp - 5_000, time: 999, scramble: 'F2' });
    const resolved = resolveCsTimerTrainerCaseMetadata(metadata, [csSolve(inserted), csSolve(trained)]);

    assert.deepEqual(resolved.get(1), { trainerId: 'pll', caseId: 'ub' });
});

test('relocates metadata after solves are reordered or deleted', () => {
    const first = solve({ trainerCase: { trainerId: 'oll', caseId: '1' } });
    const second = solve({
        timestamp: first.timestamp + 5_000,
        time: 1500,
        scramble: 'U2',
        trainerCase: { trainerId: 'pll', caseId: 'h' },
    });
    const metadata = buildCsTimerTrainerCaseMetadata([first, second]);
    const reordered = resolveCsTimerTrainerCaseMetadata(metadata, [csSolve(second), csSolve(first)]);
    const deleted = resolveCsTimerTrainerCaseMetadata(metadata, [csSolve(second)]);

    assert.deepEqual(reordered.get(0), { trainerId: 'pll', caseId: 'h' });
    assert.deepEqual(reordered.get(1), { trainerId: 'oll', caseId: '1' });
    assert.deepEqual(deleted.get(0), { trainerId: 'pll', caseId: 'h' });
    assert.equal(deleted.size, 1);
});

test('does not attach metadata when identifying solve data was edited', () => {
    const trained = solve({ trainerCase: { trainerId: 'oll', caseId: '7' } });
    const metadata = buildCsTimerTrainerCaseMetadata([trained]);
    const edited = { ...trained, scramble: `${trained.scramble} U` };

    assert.equal(resolveCsTimerTrainerCaseMetadata(metadata, [csSolve(edited)]).size, 0);
});

test('drops ambiguous duplicate identities instead of guessing', () => {
    const first = solve({ trainerCase: { trainerId: 'oll', caseId: '1' } });
    const duplicate = solve({ trainerCase: { trainerId: 'oll', caseId: '2' } });
    const metadata = buildCsTimerTrainerCaseMetadata([first, duplicate]);

    assert.equal(resolveCsTimerTrainerCaseMetadata(metadata, [csSolve(first), csSolve(duplicate)]).size, 0);
});

test('ignores malformed compact records', () => {
    const rawSolves = [csSolve(solve())];
    const metadata = {
        0: ['', 0, '1'],
        nope: ['fingerprint', 0, '1'],
        2: ['fingerprint', 9, '1'],
    };

    assert.equal(resolveCsTimerTrainerCaseMetadata(metadata, rawSolves).size, 0);
});

test('reads legacy index-only trainer metadata at its original index', () => {
    const rawSolves = [csSolve(solve()), csSolve(solve({ timestamp: 1_700_000_001_123 }))];
    const resolved = resolveCsTimerTrainerCaseMetadata({
        1: { trainerId: 'OLL', caseId: '21' },
    }, rawSolves);

    assert.deepEqual(resolved.get(1), { trainerId: 'oll', caseId: '21' });
});
