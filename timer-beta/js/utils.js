/**
 * Format milliseconds to a display string.
 * @param {number} ms - Time in milliseconds
 * @param {number|boolean} [digits=2] - Number of decimal digits (or boolean for backward compatibility)
 * @returns {string} Formatted time string
 */
export function formatTime(ms, digits = 2) {
  if (ms === Infinity || ms === -Infinity) return 'DNF';
  if (ms == null || isNaN(ms)) return '-';

  if (digits === true) digits = 2;
  if (digits === false) digits = 0;

  const negative = ms < 0;
  ms = Math.abs(ms);

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let result = '';
  if (hours > 0) {
    result = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else if (minutes > 0) {
    result = `${minutes}:${String(seconds).padStart(2, '0')}`;
  } else {
    result = `${seconds}`;
  }

  if (digits > 0) {
    if (digits === 1) {
      const tenths = Math.floor((ms % 1000) / 100);
      result += `.${tenths}`;
    } else {
      const centiseconds = Math.floor((ms % 1000) / 10);
      result += `.${String(centiseconds).padStart(2, '0')}`;
    }
  }

  return negative ? `-${result}` : result;
}

/**
 * Format a solve time with penalty indicator.
 * @param {object} solve - Solve object
 * @returns {string}
 */
export function formatSolveTime(solve) {
  let str = '';
  if (solve.penalty === 'DNF') {
    str = 'DNF';
  } else {
    const time = getEffectiveTime(solve);
    str = formatTime(time);
    if (solve.penalty === '+2') str += '+';
  }
  return str;
}

/**
 * Format the large timer display for a solve.
 * DNF keeps the measured time and shows the penalty separately in the UI.
 * @param {object} solve
 * @returns {string}
 */
export function formatTimerDisplayTime(solve) {
  let str = formatTime(solve.time);
  if (solve.penalty === '+2') {
    str = formatTime(solve.time + 2000) + '+';
  }
  return str;
}

/**
 * Get the effective time for a solve (with penalty applied).
 * @param {object} solve
 * @returns {number}
 */
export function getEffectiveTime(solve) {
  if (solve.penalty === 'DNF') return Infinity;
  if (solve.penalty === '+2') return solve.time + 2000;
  return solve.time;
}

/**
 * Parse a user-entered time string into milliseconds.
 * Supports raw seconds ("12.34"), minute/second ("1:23.45"),
 * and hour/minute/second ("1:02:03.45") formats.
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseTimeInputToMs(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
  }

  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/,/g, '.');

  if (!normalized || normalized.startsWith('-')) return null;

  const parseSecondsWithFraction = (text) => {
    const match = text.match(/^(\d+)(?:\.(\d{0,3}))?$/);
    if (!match) return null;

    const wholeSeconds = Number(match[1]);
    const fractionDigits = (match[2] || '').padEnd(3, '0').slice(0, 3);
    return (wholeSeconds * 1000) + Number(fractionDigits || '0');
  };

  if (normalized.includes(':')) {
    const parts = normalized.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => part === '')) {
      return null;
    }

    const secondsMs = parseSecondsWithFraction(parts[parts.length - 1]);
    if (secondsMs == null) return null;

    const wholeSeconds = Math.floor(secondsMs / 1000);
    if (wholeSeconds >= 60) return null;

    if (parts.length === 2) {
      const minutes = Number(parts[0]);
      if (!Number.isInteger(minutes) || minutes < 0) return null;
      return (minutes * 60 * 1000) + secondsMs;
    }

    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isInteger(hours) || hours < 0) return null;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 60) return null;

    return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + secondsMs;
  }

  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  const seconds = Number(normalized);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1000)
    : null;
}

/**
 * Generate a unique ID.
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Format a timestamp to YYYY-MM-DD.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  const d = new Date(timestamp);
  return d.toISOString().split('T')[0];
}

/**
 * Format a timestamp to a readable date (e.g., 6 March 2026).
 * @param {number} timestamp
 * @returns {string}
 */
export function formatReadableDate(timestamp) {
  const d = new Date(timestamp);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format a timestamp to a readable date-time string.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${formatReadableDate(timestamp)}, ${hours}:${minutes}:${seconds}`;
}

/**
 * Parse a duration string like "3d", "2h", "30m" to milliseconds.
 * @param {string} str
 * @returns {number|null} Duration in ms, or null if invalid
 */
export function parseDuration(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();

  if (!/^(\s*\d+\s*[dhmw]\s*)+$/.test(str)) {
    return null;
  }

  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  let totalMs = 0;
  const regex = /(\d+)\s*([dhmw])/g;
  let match;

  while ((match = regex.exec(str)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    totalMs += value * multipliers[unit];
  }

  return totalMs;
}

/**
 * Parse a solve count like "100", "100 solve", or "100 solves".
 * @param {string} str
 * @returns {number|null} Solve count, or null if invalid
 */
export function parseSolveCount(str) {
  if (!str) return null;
  const normalized = str.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(?:solves?)?$/);
  if (!match) return null;

  const count = Number.parseInt(match[1], 10);
  if (!Number.isInteger(count) || count <= 0) return null;
  return count;
}

/**
 * Parse a custom stats filter as either a duration or an absolute solve count.
 * @param {string} str
 * @returns {{ mode: 'duration', durationMs: number } | { mode: 'count', solveCount: number } | null}
 */
export function parseCustomStatsFilter(str) {
  const durationMs = parseDuration(str);
  if (durationMs) {
    return { mode: 'duration', durationMs };
  }

  const solveCount = parseSolveCount(str);
  if (solveCount) {
    return { mode: 'count', solveCount };
  }

  return null;
}

/**
 * Get start of today in ms.
 * @returns {number}
 */
export function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get start of this week (Monday) in ms.
 * @returns {number}
 */
export function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get start of this month in ms.
 * @returns {number}
 */
export function getStartOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Simple event emitter mixin.
 */
export class EventEmitter {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  }

  emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }
}

/**
 * Truncate a time string based on character max limits
 * Handles specific speedcubing notations like +2, decimals, and minutes
 * @param {string} text - The time string to truncate
 * @param {number} maxChars - Maximum characters allowed
 * @returns {string} The truncated time string
 */
export function truncateTimeDisplay(text, maxChars) {
  if (maxChars == null || text === '-' || text.includes('DNF') || text.includes('Inspect')) {
    return text;
  }
  
  const hasPlus = text.endsWith('+');
  let numberPart = hasPlus ? text.slice(0, -1) : text;
  const limit = hasPlus ? maxChars - 1 : maxChars;

  if (numberPart.length > limit && numberPart.includes('.')) {
    const withoutDecimals = numberPart.replace(/\.\d+$/, '');
    if (withoutDecimals.length <= limit) {
      numberPart = withoutDecimals;
    }
  }

  if (numberPart.length > limit && numberPart.includes(':')) {
    const timeParts = numberPart.split(':');
    while (timeParts.length > 1) {
      timeParts.pop();
      const shortened = timeParts.join(':');
      if (shortened.length <= limit) {
        numberPart = shortened;
        break;
      }
    }
  }

  if (numberPart.length > limit) {
    numberPart = numberPart.substring(0, limit);
    if (numberPart.endsWith('.') || numberPart.endsWith(':')) {
      numberPart = numberPart.substring(0, numberPart.length - 1);
    }
  }
  
  return hasPlus ? numberPart + '+' : numberPart;
}
