const TRAINER_ID_TO_CODE = Object.freeze({ oll: 0, pll: 1 });
const TRAINER_CODE_TO_ID = Object.freeze(['oll', 'pll']);
const TRAINER_SELECTION_KEYS = Object.freeze(['ollCaseSelection', 'pllCaseSelection']);
const OLL_CASE_ID_SET = new Set(Array.from({ length: 57 }, (_, index) => String(index + 1)));
const PLL_CASE_ID_SET = new Set([
    'aa', 'ab', 'e', 'f', 'ga', 'gb', 'gc', 'gd', 'h', 'ja', 'jb',
    'na', 'nb', 'ra', 'rb', 't', 'ua', 'ub', 'v', 'y', 'z',
]);
const TRAINER_SELECTION_CASE_ID_SETS = Object.freeze({
    ollCaseSelection: OLL_CASE_ID_SET,
    pllCaseSelection: PLL_CASE_ID_SET,
});

export function normalizeCsTimerTrainerSelections(value) {
    if (!value || typeof value !== 'object') return {};

    const normalized = {};
    TRAINER_SELECTION_KEYS.forEach((key) => {
        if (!Array.isArray(value[key])) return;

        normalized[key] = [...new Set(value[key]
            .filter((caseId) => typeof caseId === 'string' || typeof caseId === 'number')
            .map((caseId) => String(caseId).trim().toLowerCase())
            .filter((caseId) => TRAINER_SELECTION_CASE_ID_SETS[key].has(caseId)))];
    });
    return normalized;
}

export function buildCsTimerTrainerSelections(value) {
    const normalized = normalizeCsTimerTrainerSelections(value);

    return Object.fromEntries(TRAINER_SELECTION_KEYS.map((key) => [
        key,
        normalized[key]?.length
            ? normalized[key]
            : [...TRAINER_SELECTION_CASE_ID_SETS[key]],
    ]));
}

export function normalizeTrainerCaseMetadata(value) {
    if (!value || typeof value !== 'object') return null;

    const trainerId = String(value.trainerId ?? '').trim().toLowerCase();
    const caseId = String(value.caseId ?? '').trim().toLowerCase();
    if ((trainerId !== 'oll' && trainerId !== 'pll') || !caseId) return null;

    return { trainerId, caseId };
}

function hashString(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function buildSolveFingerprint(timestampSec, time, scramble) {
    const normalizedTimestamp = Number(timestampSec);
    const normalizedTime = Number(time);
    if (!Number.isFinite(normalizedTimestamp) || !Number.isFinite(normalizedTime)) return '';

    return `${Math.floor(normalizedTimestamp).toString(36)}.${normalizedTime.toString(36)}.${hashString(String(scramble ?? ''))}`;
}

function buildInternalSolveFingerprint(solve) {
    return buildSolveFingerprint(
        Math.floor(Number(solve?.timestamp) / 1000),
        solve?.time,
        solve?.scramble || '',
    );
}

function buildRawCsTimerSolveFingerprint(entry) {
    if (!Array.isArray(entry) || entry.length < 4 || !Array.isArray(entry[0]) || entry[0].length < 2) {
        return '';
    }
    return buildSolveFingerprint(entry[3], entry[0][1], entry[1] || '');
}

export function buildCsTimerTrainerCaseMetadata(solves) {
    const trainerCases = {};

    (Array.isArray(solves) ? solves : []).forEach((solve, index) => {
        const trainerCase = normalizeTrainerCaseMetadata(solve?.trainerCase);
        const fingerprint = buildInternalSolveFingerprint(solve);
        if (!trainerCase || !fingerprint) return;

        trainerCases[String(index)] = [
            fingerprint,
            TRAINER_ID_TO_CODE[trainerCase.trainerId],
            trainerCase.caseId,
        ];
    });

    return Object.keys(trainerCases).length > 0 ? trainerCases : null;
}

function parseTrainerCaseRecord(value, solveIndex) {
    if (Array.isArray(value) && value.length >= 3) {
        const fingerprint = typeof value[0] === 'string' ? value[0] : '';
        const trainerId = TRAINER_CODE_TO_ID[value[1]];
        const trainerCase = normalizeTrainerCaseMetadata({ trainerId, caseId: value[2] });
        return fingerprint && trainerCase ? { fingerprint, trainerCase } : null;
    }

    // Read the short-lived index-only v2 shape defensively. It cannot be
    // relocated after csTimer edits, so it is used only at its original index.
    const trainerCase = normalizeTrainerCaseMetadata(value);
    return trainerCase ? { solveIndex, trainerCase } : null;
}

export function resolveCsTimerTrainerCaseMetadata(trainerCases, rawSolves) {
    const resolved = new Map();
    if (!trainerCases || typeof trainerCases !== 'object' || !Array.isArray(rawSolves)) return resolved;

    const signedRecordsByFingerprint = new Map();
    Object.entries(trainerCases).forEach(([rawIndex, value]) => {
        const solveIndex = Number(rawIndex);
        if (!Number.isInteger(solveIndex) || solveIndex < 0) return;

        const record = parseTrainerCaseRecord(value, solveIndex);
        if (!record) return;
        if (!record.fingerprint) {
            if (solveIndex < rawSolves.length) resolved.set(solveIndex, record.trainerCase);
            return;
        }

        if (!signedRecordsByFingerprint.has(record.fingerprint)) {
            signedRecordsByFingerprint.set(record.fingerprint, []);
        }
        signedRecordsByFingerprint.get(record.fingerprint).push(record);
    });

    const solveIndexesByFingerprint = new Map();
    rawSolves.forEach((entry, solveIndex) => {
        const fingerprint = buildRawCsTimerSolveFingerprint(entry);
        if (!fingerprint) return;
        if (!solveIndexesByFingerprint.has(fingerprint)) solveIndexesByFingerprint.set(fingerprint, []);
        solveIndexesByFingerprint.get(fingerprint).push(solveIndex);
    });

    signedRecordsByFingerprint.forEach((records, fingerprint) => {
        const solveIndexes = solveIndexesByFingerprint.get(fingerprint) || [];
        // Duplicate identities cannot be associated safely if their trainer
        // cases differ, so prefer dropping metadata to corrupting case stats.
        if (records.length !== 1 || solveIndexes.length !== 1) return;
        resolved.set(solveIndexes[0], records[0].trainerCase);
    });

    return resolved;
}
