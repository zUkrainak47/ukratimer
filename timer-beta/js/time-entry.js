export const TIME_ENTRY_MODE_TIMER = 'timer';
export const TIME_ENTRY_MODE_TYPING = 'typing';
export const TIME_ENTRY_MODE_STACKMAT = 'stackmat';
export const TIME_ENTRY_MODE_BLUETOOTH = 'bluetooth';

export const TIME_ENTRY_MODE_VALUES = Object.freeze([
    TIME_ENTRY_MODE_TIMER,
    TIME_ENTRY_MODE_TYPING,
    TIME_ENTRY_MODE_STACKMAT,
    TIME_ENTRY_MODE_BLUETOOTH,
]);

const TIME_ENTRY_MODE_SET = new Set(TIME_ENTRY_MODE_VALUES);

export function normalizeTimeEntryMode(value) {
    return TIME_ENTRY_MODE_SET.has(value) ? value : TIME_ENTRY_MODE_TIMER;
}

export function isTypingTimeEntryMode(value) {
    return normalizeTimeEntryMode(value) === TIME_ENTRY_MODE_TYPING;
}

export function isStackmatTimeEntryMode(value) {
    return normalizeTimeEntryMode(value) === TIME_ENTRY_MODE_STACKMAT;
}

export function isBluetoothTimeEntryMode(value) {
    return normalizeTimeEntryMode(value) === TIME_ENTRY_MODE_BLUETOOTH;
}

export function isHardwareTimeEntryMode(value) {
    const normalized = normalizeTimeEntryMode(value);
    return normalized === TIME_ENTRY_MODE_STACKMAT || normalized === TIME_ENTRY_MODE_BLUETOOTH;
}
