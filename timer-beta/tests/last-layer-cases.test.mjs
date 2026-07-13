import test from 'node:test';
import assert from 'node:assert/strict';

import { applyScramble } from '../js/cube-display.js';
import {
    OLL_CASES,
    createLastLayerCaseScramble,
    invertFaceTurnAlgorithm,
    normalizeAlgorithmToFaceTurns,
} from '../js/oll-cases.js';
import { PLL_CASES } from '../js/pll-cases.js';

const AUFS = Object.freeze(['', 'U', 'U2', "U'"]);
const SIDE_COLORS = Object.freeze([1, 2, 5, 4]);
const LEADING_U_MOVE = /^U(?:2|')?(?:\s|$)/;
const DOUBLE_SLICE_MOVE = /\b[MSE]2\b/;
const MAX_LAST_LAYER_BASE_SCRAMBLE_MOVES = 20;
const MAX_LAST_LAYER_SCRAMBLE_MOVES = 21;
const SIDE_FACE_CYCLE = Object.freeze(['R', 'B', 'L', 'F']);
const OPPOSITE_FACE_DOUBLE_TURNS = Object.freeze({
    U2: 'D2',
    D2: 'U2',
    R2: 'L2',
    L2: 'R2',
    F2: 'B2',
    B2: 'F2',
});

function containsOppositeFaceDoubleTurnPair(algorithm) {
    const moves = algorithm.split(' ');
    return moves.some((move, index) => {
        const oppositeMove = OPPOSITE_FACE_DOUBLE_TURNS[move];
        return oppositeMove != null && oppositeMove === moves[index + 1];
    });
}

function hasOppositeFaceDoubleTurnPair(algorithm) {
    return containsOppositeFaceDoubleTurnPair(invertFaceTurnAlgorithm(algorithm));
}

function moveCount(algorithm) {
    return String(algorithm ?? '').split(' ').filter(Boolean).length;
}

function sequenceRandom(values) {
    let index = 0;
    return () => values[index++ % values.length];
}

function canonicalizeLastLayerScramble(scramble) {
    const moves = scramble.split(' ').filter(Boolean);
    if (/^U(?:2|')?$/.test(moves[moves.length - 1] || '')) moves.pop();

    const rotations = Array.from({ length: 4 }, (_, rotationIndex) => moves
        .map((move) => {
            const faceIndex = SIDE_FACE_CYCLE.indexOf(move[0]);
            if (faceIndex < 0) return move;
            return SIDE_FACE_CYCLE[(faceIndex + rotationIndex) % SIDE_FACE_CYCLE.length] + move.slice(1);
        })
        .join(' '));

    return rotations.sort()[0];
}

function canonicalLastLayerSignature(algorithm, { oll }) {
    const signatures = [];

    for (const preAuf of AUFS) {
        for (const postAuf of AUFS) {
            const cube = applyScramble([preAuf, algorithm, postAuf].filter(Boolean).join(' '));

            for (let rotation = 0; rotation < 4; rotation += 1) {
                const remapSideColor = (color) => {
                    if (color === 0 || color === 3) return color;
                    const colorIndex = SIDE_COLORS.indexOf(color);
                    return SIDE_COLORS[(colorIndex + rotation) % SIDE_COLORS.length];
                };

                const stickers = oll
                    ? cube[0].map((color) => color === 0 ? 1 : 0)
                    : [
                        ...cube[0],
                        ...cube[1].slice(0, 3),
                        ...cube[2].slice(0, 3),
                        ...cube[4].slice(0, 3),
                        ...cube[5].slice(0, 3),
                    ].map(remapSideColor);
                signatures.push(stickers.join(''));
            }
        }
    }

    return signatures.sort()[0];
}

function verifyCaseDataset(cases, { oll }) {
    cases.forEach((trainerCase) => {
        const expectedSignature = canonicalLastLayerSignature(trainerCase.setup, { oll });
        const candidateAlgorithms = trainerCase.scrambleAlgorithms || trainerCase.algorithms;

        assert.doesNotMatch(
            trainerCase.setup,
            LEADING_U_MOVE,
            `${trainerCase.name} setup must not produce a scramble beginning with U`,
        );

        candidateAlgorithms.forEach((algorithm, index) => {
            const normalized = normalizeAlgorithmToFaceTurns(algorithm);
            const scramble = invertFaceTurnAlgorithm(algorithm);
            const label = `${trainerCase.name} algorithm #${index + 1}`;

            assert.ok(normalized, `${label} must normalize`);
            assert.doesNotMatch(
                scramble,
                LEADING_U_MOVE,
                `${label} must not produce a scramble beginning with U`,
            );
            assert.equal(
                canonicalLastLayerSignature(scramble, { oll }),
                expectedSignature,
                `${label} must produce the declared case`,
            );
        });
    });
}

test('every selectable OLL algorithm produces its declared case without a leading U move', () => {
    verifyCaseDataset(OLL_CASES, { oll: true });
});

test('every selectable PLL algorithm produces its declared case without a leading U move', () => {
    verifyCaseDataset(PLL_CASES, { oll: false });
});

test('visually revealing H and Z algorithms are not selectable as PLL scrambles', () => {
    for (const caseId of ['h', 'z']) {
        const pllCase = PLL_CASES.find(({ id }) => id === caseId);

        assert.ok(pllCase, `${caseId.toUpperCase()} Perm must exist`);
        assert.equal(
            pllCase.includeSetupInScrambles,
            false,
            `${pllCase.name} must not select its visually revealing fixed setup`,
        );
        assert.ok(
            pllCase.algorithms.some((algorithm) => DOUBLE_SLICE_MOVE.test(algorithm)),
            `${pllCase.name} must retain double-slice algorithms in its catalogue`,
        );
        assert.ok(pllCase.scrambleAlgorithms.length > 0, `${pllCase.name} must retain selectable alternatives`);
        assert.ok(
            pllCase.scrambleAlgorithms.every((algorithm) => !DOUBLE_SLICE_MOVE.test(algorithm)),
            `${pllCase.name} must not select an algorithm containing M2, S2, or E2`,
        );
        assert.ok(
            pllCase.scrambleAlgorithms.every((algorithm) => !hasOppositeFaceDoubleTurnPair(algorithm)),
            `${pllCase.name} must not select an algorithm containing adjacent opposite-face double turns`,
        );
    }
});

function verifySelectableCandidateLengths(cases) {
    cases.forEach((trainerCase) => {
        assert.ok(
            trainerCase.scrambleAlgorithms.length > 0,
            `${trainerCase.name} must retain at least one selectable algorithm`,
        );

        if (trainerCase.includeSetupInScrambles) {
            assert.ok(
                moveCount(trainerCase.setup) <= MAX_LAST_LAYER_BASE_SCRAMBLE_MOVES,
                `${trainerCase.name} fixed setup must leave room for AUF`,
            );
        }

        trainerCase.scrambleAlgorithms.forEach((algorithm, index) => {
            const scramble = invertFaceTurnAlgorithm(algorithm);
            assert.ok(
                moveCount(scramble) <= MAX_LAST_LAYER_BASE_SCRAMBLE_MOVES,
                `${trainerCase.name} algorithm #${index + 1} must leave room for AUF`,
            );
            assert.ok(
                moveCount(`${scramble} U`) <= MAX_LAST_LAYER_SCRAMBLE_MOVES,
                `${trainerCase.name} algorithm #${index + 1} must not exceed 21 moves with AUF`,
            );
        });
    });
}

test('selectable OLL candidates leave room for a 21-move scramble including AUF', () => {
    verifySelectableCandidateLengths(OLL_CASES);
});

test('selectable PLL candidates leave room for a 21-move scramble including AUF', () => {
    verifySelectableCandidateLengths(PLL_CASES);
});

function verifySelectableCandidatesAreUnique(cases) {
    cases.forEach((trainerCase) => {
        const scrambleKeys = trainerCase.scrambleAlgorithms.map((algorithm) => (
            canonicalizeLastLayerScramble(invertFaceTurnAlgorithm(algorithm))
        ));
        const uniqueScrambleKeys = new Set(scrambleKeys);

        assert.equal(
            uniqueScrambleKeys.size,
            scrambleKeys.length,
            `${trainerCase.name} algorithms must be unique modulo y rotation and final AUF`,
        );

        if (trainerCase.includeSetupInScrambles) {
            assert.ok(
                !uniqueScrambleKeys.has(canonicalizeLastLayerScramble(trainerCase.setup)),
                `${trainerCase.name} fixed setup must not duplicate an algorithm modulo y rotation and final AUF`,
            );
        }
    });
}

test('selectable OLL candidates are unique modulo y rotation and final AUF', () => {
    verifySelectableCandidatesAreUnique(OLL_CASES);
});

test('selectable PLL candidates are unique modulo y rotation and final AUF', () => {
    verifySelectableCandidatesAreUnique(PLL_CASES);
});

function verifyGeneratorCandidates(cases, { rejectRevealingOppositeDoubleTurns = false } = {}) {
    cases.forEach((trainerCase) => {
        const candidates = [
            ...(trainerCase.includeSetupInScrambles ? [trainerCase.setup] : []),
            ...trainerCase.scrambleAlgorithms.map(invertFaceTurnAlgorithm),
        ];

        candidates.forEach((candidate, candidateIndex) => {
            for (let rotationIndex = 0; rotationIndex < 4; rotationIndex += 1) {
                for (let aufIndex = 0; aufIndex < 4; aufIndex += 1) {
                    const random = sequenceRandom([
                        (candidateIndex + 0.5) / candidates.length,
                        (rotationIndex + 0.5) / 4,
                        (aufIndex + 0.5) / 4,
                    ]);
                    const scramble = createLastLayerCaseScramble(trainerCase, random);
                    const label = `${trainerCase.name} candidate #${candidateIndex + 1}, rotation ${rotationIndex}, AUF ${aufIndex}`;

                    assert.equal(
                        canonicalizeLastLayerScramble(scramble),
                        canonicalizeLastLayerScramble(candidate),
                        `${label} must use the selected candidate`,
                    );
                    assert.ok(
                        moveCount(scramble) <= MAX_LAST_LAYER_SCRAMBLE_MOVES,
                        `${label} must not exceed 21 moves`,
                    );
                    assert.ok(
                        scramble.split(' ').every((move) => /^[UDRLFB](?:2|')?$/.test(move)),
                        `${label} must contain only normalized face turns`,
                    );

                    if (rejectRevealingOppositeDoubleTurns && (trainerCase.id === 'h' || trainerCase.id === 'z')) {
                        assert.ok(
                            !containsOppositeFaceDoubleTurnPair(scramble),
                            `${label} must not reveal the case with opposite-face double turns`,
                        );
                    }
                }
            }
        });
    });
}

test('OLL generator preserves every selected candidate across rotations and AUFs', () => {
    verifyGeneratorCandidates(OLL_CASES);
});

test('PLL generator preserves every selected candidate across rotations and AUFs', () => {
    verifyGeneratorCandidates(PLL_CASES, { rejectRevealingOppositeDoubleTurns: true });
});
