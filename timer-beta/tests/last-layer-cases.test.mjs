import test from 'node:test';
import assert from 'node:assert/strict';

import { applyScramble } from '../js/cube-display.js';
import {
    OLL_CASES,
    invertFaceTurnAlgorithm,
    normalizeAlgorithmToFaceTurns,
} from '../js/oll-cases.js';
import { PLL_CASES } from '../js/pll-cases.js';

const AUFS = Object.freeze(['', 'U', 'U2', "U'"]);
const SIDE_COLORS = Object.freeze([1, 2, 5, 4]);
const LEADING_U_MOVE = /^U(?:2|')?(?:\s|$)/;

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
