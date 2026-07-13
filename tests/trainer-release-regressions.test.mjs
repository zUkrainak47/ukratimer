import test from 'node:test';
import assert from 'node:assert/strict';

import { getTrainerCaseSolvesFromChunk } from '../js/db.js';
import { getMissingBackupKeysForReplacement } from '../js/storage.js';

test('trainer solve chunk filtering retains only the requested trainer without hydrating sessions', () => {
    const chunk = {
        sessionId: 'session-a',
        solves: [
            { id: 'oll', sessionId: 'stale', trainerCase: { trainerId: 'oll', caseId: '21' }, phaseSplits: [100, 200] },
            { id: 'pll', trainerCase: { trainerId: 'pll', caseId: 'ua' } },
            { id: 'plain' },
        ],
    };

    const solves = getTrainerCaseSolvesFromChunk(chunk, ' OLL ');

    assert.deepEqual(solves.map(({ id }) => id), ['oll']);
    assert.equal(solves[0].sessionId, 'session-a');
    assert.notEqual(solves[0].phaseSplits, chunk.solves[0].phaseSplits);
    assert.deepEqual(getTrainerCaseSolvesFromChunk(chunk, 'unsupported'), []);
});

test('legacy merge replacement preserves missing trainer selections only when requested', () => {
    const providedKeys = new Set(['settings', 'activeSessionId', 'scrambleType']);
    const preserveSelections = new Set(['pllCaseSelection', 'ollCaseSelection']);

    assert.deepEqual(
        getMissingBackupKeysForReplacement(providedKeys, preserveSelections),
        [],
    );
    assert.deepEqual(
        getMissingBackupKeysForReplacement(providedKeys),
        ['pllCaseSelection', 'ollCaseSelection'],
    );
});
