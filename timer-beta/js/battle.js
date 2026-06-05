import { load, remove, save } from './storage.js?v=2026060501';
import { EventEmitter, formatTime, generateId } from './utils.js?v=2026060501';

const STORAGE_KEYS = Object.freeze({
    accountId: 'battleAccountId',
    nickname: 'battleNickname',
    roomId: 'battleRoomId',
    pendingSolveUpload: 'battlePendingSolveUpload',
});

const SESSION_STORAGE_KEY = 'ukraTimerBattleSessionId';
const ROOM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{2,31})$/i;
const MAX_NICKNAME_LENGTH = 18;

const PING_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 15;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const ZOMBIE_TIMEOUT_MS = 16000;
const PENDING_SOLVE_RETRY_BASE_DELAY_MS = 1000;
const PENDING_SOLVE_RETRY_MAX_DELAY_MS = 10000;
const SESSION_REPLACED_CLOSE_CODE = 4001;
const SESSION_REPLACED_CLOSE_REASON = 'Replaced by a newer connection.';
const UNLOAD_BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';
const MISSING_NEXT_SCRAMBLE_UPLOAD_ERROR_MESSAGE = 'Next battle scramble is required before uploading.';

export const BattlePresenceStatus = Object.freeze({
    READY: 'READY',
    INSPECTING: 'INSPECTING',
    SOLVING: 'SOLVING',
    SOLVED: 'SOLVED',
});

const TIMER_STATE_TO_BATTLE_STATUS = Object.freeze({
    idle: BattlePresenceStatus.READY,
    stopped: BattlePresenceStatus.READY,
    holding: BattlePresenceStatus.READY,
    ready: BattlePresenceStatus.READY,
    'inspection-primed': BattlePresenceStatus.INSPECTING,
    inspecting: BattlePresenceStatus.INSPECTING,
    'inspection-holding': BattlePresenceStatus.INSPECTING,
    'inspection-ready': BattlePresenceStatus.INSPECTING,
    running: BattlePresenceStatus.SOLVING,
});

export const BATTLE_STATUS_LABELS = Object.freeze({
    [BattlePresenceStatus.READY]: 'Ready',
    [BattlePresenceStatus.INSPECTING]: 'Inspecting',
    [BattlePresenceStatus.SOLVING]: 'Solving',
    [BattlePresenceStatus.SOLVED]: 'Solved',
});

const ACTIVE_ATTEMPT_STATUS_SET = new Set([
    BattlePresenceStatus.INSPECTING,
    BattlePresenceStatus.SOLVING,
]);
const BATTLE_STATUS_PROGRESS_RANK = Object.freeze({
    [BattlePresenceStatus.READY]: 0,
    [BattlePresenceStatus.INSPECTING]: 1,
    [BattlePresenceStatus.SOLVING]: 2,
    [BattlePresenceStatus.SOLVED]: 3,
});

function normalizeNickname(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_NICKNAME_LENGTH);
}

function normalizeRoomId(value) {
    return String(value ?? '').trim();
}

function normalizeBattlePenalty(value) {
    return value === '+2' || value === 'DNF' ? value : null;
}

function getFiniteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function getNonNegativeRoundedNumber(value, fallback = null) {
    const number = getFiniteNumber(value);
    return number == null ? fallback : Math.max(0, Math.round(number));
}

function getBattleStatusProgressRank(status) {
    return BATTLE_STATUS_PROGRESS_RANK[String(status ?? '').trim().toUpperCase()] ?? 0;
}

function isBattleStatusRegression(nextStatus, currentStatus) {
    return getBattleStatusProgressRank(nextStatus) < getBattleStatusProgressRank(currentStatus);
}

function isAllowedBattleStatusRegression(nextStatus, currentStatus) {
    return currentStatus === BattlePresenceStatus.INSPECTING
        && nextStatus === BattlePresenceStatus.READY;
}

function isMissingNextScrambleUploadError(error) {
    return String(error?.message ?? error ?? '') === MISSING_NEXT_SCRAMBLE_UPLOAD_ERROR_MESSAGE;
}

function isValidRoomId(value) {
    return ROOM_ID_PATTERN.test(normalizeRoomId(value));
}

function normalizePendingSolveUpload(value) {
    if (!value || typeof value !== 'object') return null;

    const accountId = String(value.accountId ?? '').trim();
    const roomId = normalizeRoomId(value.roomId);
    const localSolveId = String(value.localSolveId ?? '').trim();
    const solveId = Number(value.solveId);
    const localTimestamp = Number(value.localTimestamp) || 0;
    const roundScramble = String(value.roundScramble ?? '').trim();
    const timeMs = Number.isFinite(Number(value.timeMs))
        ? Math.max(0, Math.round(Number(value.timeMs)))
        : null;

    if (!accountId || !roomId || !localSolveId || !Number.isFinite(solveId) || solveId <= 0 || timeMs == null || localTimestamp <= 0 || !roundScramble) {
        return null;
    }

    return {
        accountId,
        roomId,
        localSolveId,
        solveId: Math.round(solveId),
        timeMs,
        penalty: normalizeBattlePenalty(value.penalty),
        localTimestamp,
        roundScramble,
        nextScramble: String(value.nextScramble ?? '').trim(),
        createdAt: Number(value.createdAt) || Date.now(),
        updatedAt: Number(value.updatedAt) || Date.now(),
    };
}

function loadBattleSessionId() {
    try {
        const existing = String(window.sessionStorage?.getItem(SESSION_STORAGE_KEY) ?? '').trim();
        if (existing) return existing;
    } catch {
        // Ignore sessionStorage access failures and keep the session in memory.
    }

    const sessionId = `battle_session_${generateId()}`;
    try {
        window.sessionStorage?.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch {
        // Ignore sessionStorage write failures and keep the session in memory.
    }
    return sessionId;
}

function createBattlePageInstanceId() {
    return `battle_page_${generateId()}`;
}

function createBattleConnectionId() {
    return `battle_connection_${generateId()}`;
}

function isSessionReplacementCloseEvent(event) {
    return Number(event?.code) === SESSION_REPLACED_CLOSE_CODE
        || String(event?.reason ?? '') === SESSION_REPLACED_CLOSE_REASON;
}

function getCloseEventDetails(event) {
    return {
        code: Number.isFinite(Number(event?.code)) ? Number(event.code) : null,
        reason: String(event?.reason ?? ''),
        wasClean: Boolean(event?.wasClean),
    };
}

function getBattleServerMetaUrl() {
    return document
        .querySelector('meta[name="battle-server-url"]')
        ?.content
        ?.trim() || '';
}

function getDefaultBattleServerUrl() {
    const metaUrl = getBattleServerMetaUrl();
    if (metaUrl) return metaUrl;

    if (!window.location?.origin || window.location.protocol === 'file:') {
        return '';
    }

    return new URL('/battle', window.location.origin).toString();
}

function resolveBattleServerUrl() {
    const rawValue = getDefaultBattleServerUrl();
    if (!rawValue) return '';

    let url;
    try {
        url = new URL(rawValue, window.location.origin);
    } catch {
        throw new Error('Invalid battle server endpoint.');
    }

    if (url.protocol === 'http:') {
        url.protocol = 'ws:';
    } else if (url.protocol === 'https:') {
        url.protocol = 'wss:';
    }

    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('Battle server endpoint must use ws:// or wss://.');
    }

    if (!url.pathname || url.pathname === '/') {
        url.pathname = '/battle';
    }

    return url.toString().replace(/\/+$/, '');
}

function resolveBattleServerHttpUrl() {
    const rawValue = getDefaultBattleServerUrl();
    if (!rawValue) return '';

    let url;
    try {
        url = new URL(rawValue, window.location.origin);
    } catch {
        throw new Error('Invalid battle server endpoint.');
    }

    if (url.protocol === 'ws:') {
        url.protocol = 'http:';
    } else if (url.protocol === 'wss:') {
        url.protocol = 'https:';
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Battle server endpoint must use http:// or https://.');
    }

    if (!url.pathname || url.pathname === '/') {
        url.pathname = '/battle';
    }

    return url.toString().replace(/\/+$/, '');
}

function buildRoomSocketUrl(roomId) {
    const normalizedRoomId = normalizeRoomId(roomId);
    const baseUrl = resolveBattleServerUrl();
    if (!baseUrl) {
        throw new Error('Battle server endpoint is missing.');
    }

    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(normalizedRoomId)}`;
    return url.toString();
}

function buildRoomProbeUrl(roomId) {
    const normalizedRoomId = normalizeRoomId(roomId);
    const baseUrl = resolveBattleServerHttpUrl();
    if (!baseUrl) {
        throw new Error('Battle server endpoint is missing.');
    }

    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(normalizedRoomId)}`;
    return url.toString();
}

function createInitialRoomState() {
    return {
        roomId: '',
        ownerAccountId: '',
        scrambleType: '333',
        currentRoundId: 0,
        lastRoundId: -1,
        currentScramble: '',
        lastScramble: '',
        players: [],
        solves: [],
    };
}

function cloneRoomState(roomState) {
    return {
        roomId: roomState.roomId,
        ownerAccountId: roomState.ownerAccountId,
        scrambleType: roomState.scrambleType,
        currentRoundId: roomState.currentRoundId,
        lastRoundId: roomState.lastRoundId,
        currentScramble: roomState.currentScramble,
        lastScramble: roomState.lastScramble,
        players: roomState.players.map((player) => ({ ...player })),
        solves: roomState.solves.map((solve) => ({ ...solve })),
    };
}

function mapRoomInfo(roomInfo) {
    return {
        roomId: String(roomInfo?.roomId ?? ''),
        ownerAccountId: String(roomInfo?.ownerAccountId ?? ''),
        scrambleType: String(roomInfo?.scrambleType ?? '333').trim().toLowerCase() || '333',
        currentRoundId: Number(roomInfo?.current?.id) || 0,
        lastRoundId: Number(roomInfo?.last?.id) || -1,
        currentScramble: String(roomInfo?.current?.scramble ?? ''),
        lastScramble: String(roomInfo?.last?.scramble ?? ''),
        players: Array.isArray(roomInfo?.players)
            ? roomInfo.players.map((player) => ({
                accountId: String(player?.accountId ?? ''),
                nickname: normalizeNickname(player?.nickname || player?.accountId || 'Player'),
                elo: getFiniteNumber(player?.elo) ?? 1000,
                wins: getFiniteNumber(player?.wins) ?? 0,
                solveCount: getNonNegativeRoundedNumber(player?.solveCount),
                meanTimeMs: getNonNegativeRoundedNumber(player?.meanTimeMs),
                meanTimeSum: getNonNegativeRoundedNumber(player?.meanTimeSum),
                meanTimeCount: getNonNegativeRoundedNumber(player?.meanTimeCount),
                status: String(player?.status ?? BattlePresenceStatus.READY),
                connected: player?.connected !== false,
            }))
            : [],
        solves: Array.isArray(roomInfo?.solves)
            ? roomInfo.solves.map((solve) => ({
                accountId: String(solve?.accountId ?? ''),
                solveId: getFiniteNumber(solve?.solveId) || 0,
                timeMs: getNonNegativeRoundedNumber(solve?.timeMs),
                penalty: solve?.penalty === '+2' || solve?.penalty === 'DNF' ? solve.penalty : null,
                localTimestamp: getFiniteNumber(solve?.localTimestamp) || 0,
                submittedAt: getFiniteNumber(solve?.submittedAt) || 0,
                origin: String(solve?.origin ?? ''),
            }))
            : [],
    };
}

function getSolveMap(roomState) {
    const byPlayer = new Map();

    roomState.solves.forEach((solve) => {
        if (!solve?.accountId) return;
        if (!byPlayer.has(solve.accountId)) {
            byPlayer.set(solve.accountId, new Map());
        }
        byPlayer.get(solve.accountId).set(solve.solveId, solve);
    });

    return byPlayer;
}

function getPlayerSolveCountFromSolves(roomState, accountId) {
    if (!roomState || !accountId) return 0;
    return roomState.solves.filter((solve) => solve?.accountId === accountId).length;
}

function getKnownBattleSolveCount(roomState, player) {
    if (!player?.accountId) return 0;
    const solveCount = getNonNegativeRoundedNumber(player.solveCount);
    if (solveCount != null) {
        return solveCount;
    }
    const meanTimeCount = getNonNegativeRoundedNumber(player.meanTimeCount);
    if (meanTimeCount != null) {
        return meanTimeCount;
    }
    return getPlayerSolveCountFromSolves(roomState, player.accountId);
}

function hasBattlePlayerAggregateStats(player) {
    if (!player) return false;
    if (getNonNegativeRoundedNumber(player.solveCount, 0) > 0) return true;
    if (getNonNegativeRoundedNumber(player.meanTimeMs, 0) > 0) return true;
    if (getNonNegativeRoundedNumber(player.meanTimeSum, 0) > 0) return true;
    if (getNonNegativeRoundedNumber(player.meanTimeCount, 0) > 0) return true;
    if (getNonNegativeRoundedNumber(player.wins, 0) > 0) return true;
    const elo = getFiniteNumber(player.elo);
    return Number.isFinite(elo) && elo !== 1000;
}

function isBattlePlayerProgressRollback(previousRoomState, nextRoomState, previousPlayer, nextPlayer) {
    if (!previousPlayer?.accountId || previousPlayer.accountId !== nextPlayer?.accountId) return false;

    const previousSolveCount = getKnownBattleSolveCount(previousRoomState, previousPlayer);
    const previousWins = getNonNegativeRoundedNumber(previousPlayer.wins, 0);
    const previousElo = getFiniteNumber(previousPlayer.elo);
    const previousHasMean = getNonNegativeRoundedNumber(previousPlayer.meanTimeMs) != null
        || (getNonNegativeRoundedNumber(previousPlayer.meanTimeSum) != null
            && getNonNegativeRoundedNumber(previousPlayer.meanTimeCount, 0) > 0);
    const previousHadProgress = previousSolveCount > 0
        || previousWins > 0
        || previousHasMean
        || (Number.isFinite(previousElo) && previousElo !== 1000);

    return previousHadProgress
        && !hasBattlePlayerAggregateStats(nextPlayer)
        && getPlayerSolveCountFromSolves(nextRoomState, nextPlayer.accountId) > 0;
}

function reconcileRoomState(previousRoomState, nextRoomState) {
    if (!previousRoomState?.roomId
        || previousRoomState.roomId !== nextRoomState?.roomId
        || !previousRoomState.players.length
        || !nextRoomState.players.length) {
        return nextRoomState;
    }

    // Preserve local aggregate stats only when a snapshot still has solves but lacks
    // the matching player totals. Lower totals can be legitimate penalty/delete updates.
    const previousPlayers = new Map(previousRoomState.players.map((player) => [player.accountId, player]));
    let preservedProgressCount = 0;
    const players = nextRoomState.players.map((nextPlayer) => {
        const previousPlayer = previousPlayers.get(nextPlayer.accountId);
        if (!previousPlayer || !isBattlePlayerProgressRollback(previousRoomState, nextRoomState, previousPlayer, nextPlayer)) {
            return nextPlayer;
        }

        preservedProgressCount++;
        return {
            ...nextPlayer,
            elo: previousPlayer.elo,
            wins: previousPlayer.wins,
            solveCount: previousPlayer.solveCount ?? getKnownBattleSolveCount(previousRoomState, previousPlayer),
            meanTimeMs: previousPlayer.meanTimeMs,
            meanTimeSum: previousPlayer.meanTimeSum,
            meanTimeCount: previousPlayer.meanTimeCount,
        };
    });

    if (!preservedProgressCount) return nextRoomState;

    return {
        ...nextRoomState,
        players,
        preservedProgressCount,
    };
}

export function formatBattleSolve(solve) {
    if (!solve || solve.timeMs == null) return '-';
    if (solve.penalty === 'DNF') return 'DNF';

    const displayTime = solve.penalty === '+2'
        ? solve.timeMs + 2000
        : solve.timeMs;
    const formatted = formatTime(displayTime);
    return solve.penalty === '+2' ? `${formatted}+` : formatted;
}

function getBattleSolveTimeValue(solve) {
    if (!solve || solve.timeMs == null || solve.penalty === 'DNF') return null;
    return solve.penalty === '+2' ? solve.timeMs + 2000 : solve.timeMs;
}

function getBattleMeanTimeText(solves) {
    const timeValues = solves
        .map(getBattleSolveTimeValue)
        .filter((value) => Number.isFinite(value));

    if (!timeValues.length) return '-';

    const total = timeValues.reduce((sum, value) => sum + value, 0);
    return formatTime(Math.round(total / timeValues.length));
}

function getBattlePlayerMeanTimeText(player, fallbackSolves) {
    const meanTimeMs = getNonNegativeRoundedNumber(player.meanTimeMs);
    if (meanTimeMs != null) {
        return formatTime(meanTimeMs);
    }
    const meanTimeSum = getNonNegativeRoundedNumber(player.meanTimeSum);
    const meanTimeCount = getNonNegativeRoundedNumber(player.meanTimeCount);
    if (meanTimeSum != null && meanTimeCount > 0) {
        return formatTime(Math.round(meanTimeSum / meanTimeCount));
    }
    if (getNonNegativeRoundedNumber(player.solveCount) != null || meanTimeCount != null) {
        return '-';
    }
    return getBattleMeanTimeText(fallbackSolves);
}

export function buildBattleRows(roomState, localAccountId = '') {
    const solveMap = getSolveMap(roomState);
    const players = [...roomState.players].sort((a, b) => {
        if (b.elo !== a.elo) return b.elo - a.elo;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' });
    });
    const hasCurrentSolve = players.some((player) => (
        solveMap.get(player.accountId)?.has(roomState.currentRoundId)
    ));

    return players.map((player, index) => {
        const playerSolves = solveMap.get(player.accountId) || new Map();
        const solveList = Array.from(playerSolves.values());
        const currentSolve = playerSolves.get(roomState.currentRoundId) || null;
        const previousSolve = playerSolves.get(roomState.lastRoundId) || null;
        const shownSolve = currentSolve || previousSolve;
        const shouldDimSolve = hasCurrentSolve && player.status !== BattlePresenceStatus.SOLVED && !currentSolve && previousSolve;
        const solveCount = getNonNegativeRoundedNumber(player.solveCount) ?? solveList.length;
        const winCount = Math.max(0, Math.round(Number(player.wins) || 0));
        const isDisconnected = player.connected === false;

        return {
            rank: index + 1,
            accountId: player.accountId,
            nickname: player.nickname,
            elo: player.elo,
            wins: winCount,
            winRateText: `${winCount}/${solveCount}`,
            meanTimeText: getBattlePlayerMeanTimeText(player, solveList),
            status: player.status,
            statusLabel: BATTLE_STATUS_LABELS[player.status] || player.status,
            solve: shownSolve,
            solveText: formatBattleSolve(shownSolve),
            dimSolve: shouldDimSolve,
            isDisconnected,
            isLocal: Boolean(localAccountId) && player.accountId === localAccountId,
        };
    });
}

class BattleManager extends EventEmitter {
    constructor() {
        super();
        this._accountId = load(STORAGE_KEYS.accountId, '') || `battle_${generateId()}`;
        this._sessionId = loadBattleSessionId();
        this._pageInstanceId = createBattlePageInstanceId();
        this._connectionId = '';
        this._nickname = normalizeNickname(load(STORAGE_KEYS.nickname, ''));
        this._roomId = normalizeRoomId(load(STORAGE_KEYS.roomId, ''));
        this._connectionState = 'idle';
        this._connectionMessage = '';
        this._roomState = createInitialRoomState();
        this._socket = null;
        this._requestSeq = 1;
        this._pendingRequests = new Map();
        this._joined = false;
        this._submittedRoundId = null;
        this._lastSubmittedTimestamp = null;
        this._expectedClose = false;
        this._pingIntervalId = null;
        this._reconnecting = false;
        this._reconnectTimer = null;
        this._reconnectAttempt = 0;
        this._lastMessageAt = 0;
        this._lastLocalStatus = BattlePresenceStatus.READY;
        this._activeAttemptRoundId = null;
        this._pageDisconnectNotified = false;
        this._pendingSolveUpload = this._loadPendingSolveUpload();
        this._pendingSolveUploadInFlight = false;
        this._pendingSolveRetryTimer = null;
        this._pendingSolveRetryAttempt = 0;
        if (this._pendingSolveUpload) {
            this._submittedRoundId = this._pendingSolveUpload.solveId;
            this._lastSubmittedTimestamp = this._pendingSolveUpload.localTimestamp;
            this._lastLocalStatus = BattlePresenceStatus.SOLVED;
            this._activeAttemptRoundId = null;
        }

        save(STORAGE_KEYS.accountId, this._accountId);

        window.addEventListener('pagehide', () => {
            this._notifyPageDisconnectSync('pagehide');
        });
        window.addEventListener('beforeunload', () => {
            this._notifyPageDisconnectSync('beforeunload');
        });
        window.addEventListener('pageshow', (event) => {
            this._handlePageShow(event);
        });
        document.addEventListener('visibilitychange', () => {
            this._handleVisibilityChange();
        });
        window.addEventListener('online', () => {
            this._handleVisibilityChange();
        });
    }

    getState() {
        return {
            accountId: this._accountId,
            nickname: this._nickname,
            roomId: this._roomId,
            connectionState: this._connectionState,
            connectionMessage: this._connectionMessage,
            joined: this._joined,
            room: cloneRoomState(this._roomState),
            localPlayer: this._roomState.players.find((player) => player.accountId === this._accountId) || null,
            isOwner: this._roomState.ownerAccountId === this._accountId,
            rows: buildBattleRows(this._roomState, this._accountId),
            scrambleType: this._roomState.scrambleType || '333',
            currentScramble: this._roomState.currentScramble,
            currentRoundId: this._roomState.currentRoundId,
            submittedRoundId: this._submittedRoundId,
            pendingSolveUpload: Boolean(this._pendingSolveUpload),
        };
    }

    isJoined() {
        return this._joined;
    }

    getRoomId() {
        return this._roomId;
    }

    getCurrentScramble() {
        return this._roomState.currentScramble;
    }

    getCurrentRoundId() {
        return this._roomState.currentRoundId;
    }

    getScrambleType() {
        return this._roomState.scrambleType || '333';
    }

    getNickname() {
        return this._nickname;
    }

    _hasOpenSocket() {
        const openState = typeof WebSocket === 'function' ? WebSocket.OPEN : 1;
        return this._socket?.readyState === openState;
    }

    _getConnectionBlockReason() {
        if (this._connectionState === 'connecting') return 'Connecting to battle...';
        if (this._connectionState === 'reconnecting') return 'Reconnecting to battle...';
        if (this._connectionState === 'error') {
            return this._connectionMessage || 'Battle connection is not available. Please rejoin the room.';
        }
        if (this._connectionState !== 'connected' || !this._hasOpenSocket()) {
            return 'Battle connection is not ready. Please wait or rejoin the room.';
        }
        return '';
    }

    getStartBlockReason() {
        if (!this._joined) return null;
        if (this._pendingSolveUpload) {
            const connectionBlockReason = this._getConnectionBlockReason();
            if (connectionBlockReason) {
                return connectionBlockReason.startsWith('Battle solve saved')
                    ? connectionBlockReason
                    : `Battle solve saved locally. ${connectionBlockReason}`;
            }
            return 'Uploading battle solve...';
        }
        const connectionBlockReason = this._getConnectionBlockReason();
        if (connectionBlockReason) return connectionBlockReason;
        if (!this._roomState.currentScramble) return 'Waiting for the room scramble.';
        const localPlayer = this._roomState.players.find((player) => player.accountId === this._accountId) || null;
        if (ACTIVE_ATTEMPT_STATUS_SET.has(localPlayer?.status) && this._lastLocalStatus === BattlePresenceStatus.READY) {
            return 'This battle attempt is already in progress. Reconnect to the original timer state or leave the round.';
        }
        if (this._submittedRoundId === this._roomState.currentRoundId) {
            return 'Waiting for the next battle scramble.';
        }
        return null;
    }

    isWaitingForOthers() {
        return this._joined && (
            this._pendingSolveUpload?.solveId === this._roomState.currentRoundId
            || this._submittedRoundId === this._roomState.currentRoundId
        );
    }

    hasPendingSolveUpload() {
        return Boolean(this._pendingSolveUpload);
    }

    needsPendingSolveNextScramble() {
        return Boolean(
            this._pendingSolveUpload
            && this._pendingSolveUpload.solveId === this._roomState.currentRoundId
            && !this._pendingSolveUpload.nextScramble
        );
    }

    _log(level, message, details = {}) {
        const logger = console?.[level] || console.log;
        logger(`[battle] ${message}`, {
            roomId: this._roomId || '',
            accountId: this._accountId,
            sessionId: this._sessionId,
            pageInstanceId: this._pageInstanceId,
            connectionId: this._connectionId,
            joined: this._joined,
            connectionState: this._connectionState,
            ...details,
        });
    }

    _loadPendingSolveUpload() {
        const pending = normalizePendingSolveUpload(load(STORAGE_KEYS.pendingSolveUpload, null));
        if (!pending) {
            remove(STORAGE_KEYS.pendingSolveUpload);
            return null;
        }
        if (pending.accountId !== this._accountId || pending.roomId !== this._roomId) {
            remove(STORAGE_KEYS.pendingSolveUpload);
            return null;
        }
        return pending;
    }

    _persistPendingSolveUpload() {
        if (this._pendingSolveUpload) {
            save(STORAGE_KEYS.pendingSolveUpload, this._pendingSolveUpload);
        } else {
            remove(STORAGE_KEYS.pendingSolveUpload);
        }
    }

    _getExitStatus() {
        if (this._pendingSolveUpload && this._lastLocalStatus === BattlePresenceStatus.SOLVED) {
            return BattlePresenceStatus.SOLVING;
        }
        return this._lastLocalStatus;
    }

    _getStatusRoundId(status = null) {
        const normalizedStatus = String(status ?? '').trim().toUpperCase();
        if (this._pendingSolveUpload && normalizedStatus === BattlePresenceStatus.SOLVING) {
            return Number(this._pendingSolveUpload.solveId) || 0;
        }
        if (ACTIVE_ATTEMPT_STATUS_SET.has(normalizedStatus) && this._activeAttemptRoundId != null) {
            return Number(this._activeAttemptRoundId) || 0;
        }
        return Number(this._roomState.currentRoundId) || 0;
    }

    _getPendingSolveTransportPayload() {
        const pending = this._pendingSolveUpload;
        if (!pending || pending.accountId !== this._accountId || pending.roomId !== this._roomId) {
            return null;
        }
        if (!this._pendingSolveMatchesKnownRound(pending)) {
            return null;
        }
        if (pending.solveId === this._roomState.currentRoundId && !pending.nextScramble) {
            return null;
        }

        return {
            solveId: pending.solveId,
            timeMs: pending.timeMs,
            penalty: pending.penalty,
            localTimestamp: pending.localTimestamp,
            roundScramble: pending.roundScramble,
            nextScramble: pending.nextScramble,
        };
    }

    _pendingSolveMatchesKnownRound(pending, roomState = this._roomState) {
        if (!pending || !roomState) return false;
        const pendingScramble = String(pending.roundScramble ?? '').trim();
        if (!pendingScramble) return false;

        const currentRoundId = Number(roomState.currentRoundId) || 0;
        if (pending.solveId === currentRoundId) {
            return pendingScramble === String(roomState.currentScramble ?? '').trim();
        }

        const lastRoundId = Number(roomState.lastRoundId) || 0;
        if (pending.solveId === lastRoundId) {
            return pendingScramble === String(roomState.lastScramble ?? '').trim();
        }

        return false;
    }

    _roomInfoConfirmsPendingSolve(roomInfo, pending = this._pendingSolveUpload) {
        if (!pending || !roomInfo || !Array.isArray(roomInfo?.solves)) return false;
        const roomState = mapRoomInfo(roomInfo);
        return roomState.solves.some((solve) => (
            solve.accountId === pending.accountId
            && solve.solveId === pending.solveId
            && solve.localTimestamp === pending.localTimestamp
            && solve.penalty === pending.penalty
        ));
    }

    _roomInfoIsEmpty(roomInfo) {
        return Boolean(roomInfo)
            && Array.isArray(roomInfo?.players)
            && roomInfo.players.length === 0;
    }

    async joinRoom({ roomId, nickname, scrambleType = '333', initialScramble }) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const normalizedNickname = normalizeNickname(nickname);
        const normalizedScrambleType = String(scrambleType ?? '333').trim().toLowerCase() || '333';

        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('Room name must be 3-32 characters using letters, numbers, "_" or "-".');
        }
        if (!normalizedNickname) {
            throw new Error('Nickname is required.');
        }
        if (!String(initialScramble ?? '').trim()) {
            throw new Error('Unable to create the initial battle scramble.');
        }

        this._nickname = normalizedNickname;
        this._roomId = normalizedRoomId;
        this._submittedRoundId = null;
        this._activeAttemptRoundId = null;
        if (this._pendingSolveUpload && this._pendingSolveUpload.roomId !== normalizedRoomId) {
            this._clearPendingSolveUpload({ resetSubmission: true });
        }
        if (this._pendingSolveUpload) {
            this._submittedRoundId = this._pendingSolveUpload.solveId;
            this._lastSubmittedTimestamp = this._pendingSolveUpload.localTimestamp;
        }
        save(STORAGE_KEYS.nickname, this._nickname);
        save(STORAGE_KEYS.roomId, this._roomId);
        this._cancelReconnect();

        if (this._socket) {
            this._expectedClose = true;
            this._teardownSocket();
            this._roomState = createInitialRoomState();
            this._joined = false;
        }

        try {
            await this._connect(normalizedRoomId);
            const response = await this._request('join', {
                accountId: this._accountId,
                sessionId: this._sessionId,
                pageInstanceId: this._pageInstanceId,
                connectionId: this._connectionId,
                nickname: this._nickname,
                scrambleType: normalizedScrambleType,
                initialScramble: String(initialScramble).trim(),
            });

            this._joined = true;
            this._lastLocalStatus = this._pendingSolveUpload
                ? BattlePresenceStatus.SOLVED
                : BattlePresenceStatus.READY;
            this._pageDisconnectNotified = false;
            this._setConnection('connected', `Joined room ${normalizedRoomId}.`);
            if (response?.roomInfo) {
                this._applyRoomInfo(response.roomInfo);
            } else {
                this._emitState();
            }
        } catch (error) {
            this._expectedClose = true;
            this._teardownSocket();
            this._joined = false;
            this._submittedRoundId = this._pendingSolveUpload?.solveId ?? null;
            this._lastSubmittedTimestamp = this._pendingSolveUpload?.localTimestamp ?? null;
            this._activeAttemptRoundId = null;
            this._roomState = createInitialRoomState();
            this._pageDisconnectNotified = false;
            this._setConnection('error', error instanceof Error ? error.message : 'Unable to join the battle room.');
            this._emitState();
            throw error;
        }
        return this.getState();
    }

    async inspectRoom(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('Room name must be 3-32 characters using letters, numbers, "_" or "-".');
        }

        const response = await window.fetch(buildRoomProbeUrl(normalizedRoomId), {
            method: 'GET',
            mode: 'cors',
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error('Unable to check the battle room.');
        }

        const payload = await response.json().catch(() => null);
        return {
            exists: Boolean(payload?.exists),
            roomInfo: payload?.roomInfo ? mapRoomInfo(payload.roomInfo) : null,
        };
    }

    async leaveRoom() {
        this._log('info', 'Leaving room on user request.');
        this._cancelReconnect();
        this._expectedClose = true;
        let leaveDelivered = false;
        let leaveRoomInfo = null;
        if (this._pendingSolveUpload && this._hasOpenSocket()) {
            try {
                await this._flushPendingSolveUpload({ throwOnBlock: false });
            } catch {
                this._log('warn', 'Failed to flush pending solve before leaving; including it in leave payload.');
            }
        }

        const pendingSolve = this._getPendingSolveTransportPayload();
        const exitStatus = this._getExitStatus();
        const leavePayload = {
            status: exitStatus,
            statusRoundId: this._getStatusRoundId(exitStatus),
            ...(pendingSolve ? { pendingSolve } : {}),
        };

        if (this._socket && this._socket.readyState === WebSocket.OPEN) {
            try {
                const response = await this._request('leave', leavePayload, { applyRoomInfo: false });
                leaveDelivered = true;
                leaveRoomInfo = response?.roomInfo || null;
                this._log('info', 'Sent leave request over websocket.');
            } catch {
                this._log('warn', 'Failed to send leave request over websocket; falling back to HTTP leave.');
            }
        }

        if (!leaveDelivered && this._joined && this._roomId) {
            try {
                const response = await this._postRoomAction('leave', leavePayload);
                leaveDelivered = true;
                leaveRoomInfo = response?.roomInfo || null;
                this._log('info', 'Sent leave request over HTTP fallback.');
            } catch {
                this._log('warn', 'Failed to send leave request over HTTP fallback.');
            }
        }

        this._teardownSocket();
        this._joined = false;
        this._submittedRoundId = null;
        this._lastSubmittedTimestamp = null;
        this._activeAttemptRoundId = null;
        // Empty roomInfo means the room reset after leave; there is no active room to retry against.
        const pendingSolveConfirmed = leaveDelivered && (
            this._roomInfoConfirmsPendingSolve(leaveRoomInfo)
            || this._roomInfoIsEmpty(leaveRoomInfo)
        );
        if (!this._pendingSolveUpload || pendingSolveConfirmed) {
            this._clearPendingSolveUpload();
        } else {
            this._log('warn', 'Keeping pending battle solve after leave did not confirm upload.');
        }
        this._roomState = createInitialRoomState();
        this._pageDisconnectNotified = false;
        this._setConnection('idle', '');
        this._emitState();
    }

    _notifyPageDisconnectSync(source = 'unknown') {
        if (!this._joined || !this._roomId || this._pageDisconnectNotified) return;
        this._pageDisconnectNotified = true;
        this._cancelReconnect();

        const pendingSolve = this._getPendingSolveTransportPayload();
        const exitStatus = this._getExitStatus();
        const payload = JSON.stringify({
            action: 'disconnect',
            accountId: this._accountId,
            sessionId: this._sessionId,
            pageInstanceId: this._pageInstanceId,
            connectionId: this._connectionId,
            status: exitStatus,
            statusRoundId: this._getStatusRoundId(exitStatus),
            ...(pendingSolve ? { pendingSolve } : {}),
        });
        const url = buildRoomProbeUrl(this._roomId);

        try {
            if (navigator.sendBeacon) {
                const delivered = navigator.sendBeacon(url, new Blob([payload], { type: UNLOAD_BEACON_CONTENT_TYPE }));
                this._log(delivered ? 'info' : 'warn', 'Sent page disconnect beacon.', { source, transport: 'sendBeacon', delivered });
                if (delivered) {
                    this._log('info', 'Closing socket after page disconnect notification.', { source });
                    this._expectedClose = true;
                    this._teardownSocket();
                    return;
                }
            }

            {
                void window.fetch(url, {
                    method: 'POST',
                    mode: 'cors',
                    keepalive: true,
                    headers: {
                        'Content-Type': UNLOAD_BEACON_CONTENT_TYPE,
                    },
                    body: payload,
                }).then(() => {
                    this._log('info', 'Sent page disconnect beacon.', { source, transport: 'fetch-keepalive', delivered: true });
                }).catch((error) => {
                    this._log('warn', 'Failed to send page disconnect beacon.', {
                        source,
                        transport: 'fetch-keepalive',
                        error: error instanceof Error ? error.message : String(error ?? ''),
                    });
                });
            }
        } catch {
            this._log('warn', 'Disconnect beacon threw before sending.', { source });
        }

        this._log('info', 'Closing socket after page disconnect notification.', { source });
        this._expectedClose = true;
        this._teardownSocket();
    }

    async submitStatus(status) {
        const normalizedStatus = String(status ?? '').trim().toUpperCase();
        if (!BattlePresenceStatus[normalizedStatus]) return;
        this._lastLocalStatus = normalizedStatus;
        const localPlayer = this._roomState.players.find((player) => player.accountId === this._accountId) || null;
        if (isBattleStatusRegression(normalizedStatus, localPlayer?.status)
            && !isAllowedBattleStatusRegression(normalizedStatus, localPlayer?.status)) {
            this._log('info', 'Skipped battle status regression because the room state is ahead.', {
                status: normalizedStatus,
                roomStatus: localPlayer?.status || '',
                currentRoundId: this._roomState.currentRoundId,
            });
            return;
        }
        if (!this._joined || !this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        await this._request('status', {
            status: normalizedStatus,
            statusRoundId: this._getStatusRoundId(normalizedStatus),
        }).catch(() => { });
    }

    async handleTimerStateChange(timerState) {
        if (!this._joined) return;
        if (this._submittedRoundId === this._roomState.currentRoundId) return;

        const status = TIMER_STATE_TO_BATTLE_STATUS[timerState] || BattlePresenceStatus.READY;
        if (ACTIVE_ATTEMPT_STATUS_SET.has(status) && this._activeAttemptRoundId == null && this._roomState.currentRoundId > 0) {
            this._activeAttemptRoundId = this._roomState.currentRoundId;
        } else if (status === BattlePresenceStatus.READY && timerState !== 'stopped') {
            this._activeAttemptRoundId = null;
        }
        this._lastLocalStatus = status;
        const localPlayer = this.getState().localPlayer;
        if (localPlayer?.status === status) return;
        await this.submitStatus(status);
    }

    stageLocalSolve(solve, { nextScramble } = {}) {
        if (!this._joined) return false;
        const solveRoundId = Number(this._activeAttemptRoundId || this._roomState.currentRoundId) || 0;
        if (this._submittedRoundId === solveRoundId) return false;
        if (!solve || solveRoundId <= 0) return false;

        const pendingSolveUpload = {
            accountId: this._accountId,
            roomId: this._roomId,
            localSolveId: String(solve.id ?? '').trim(),
            solveId: solveRoundId,
            timeMs: Number.isFinite(Number(solve.time)) ? Math.max(0, Math.round(Number(solve.time))) : null,
            penalty: normalizeBattlePenalty(solve.penalty),
            localTimestamp: Number(solve.timestamp) || 0,
            roundScramble: String(solve.scramble ?? this._roomState.currentScramble ?? '').trim(),
            nextScramble: String(nextScramble ?? '').trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        this._pendingSolveUpload = pendingSolveUpload;
        this._persistPendingSolveUpload();
        this._submittedRoundId = pendingSolveUpload.solveId;
        this._lastSubmittedTimestamp = pendingSolveUpload.localTimestamp;
        this._lastLocalStatus = BattlePresenceStatus.SOLVED;
        this._activeAttemptRoundId = null;
        this._emitState();
        return true;
    }

    async handleLocalSolve(solve, { nextScramble } = {}) {
        if (!this.stageLocalSolve(solve, { nextScramble })) return false;
        return this.uploadPendingSolve();
    }

    _setPendingSolveNextScramble(nextScramble) {
        const normalizedNextScramble = String(nextScramble ?? '').trim();
        if (!this._pendingSolveUpload || !normalizedNextScramble) return false;
        if (this._pendingSolveUpload.nextScramble === normalizedNextScramble) return false;

        this._pendingSolveUpload = {
            ...this._pendingSolveUpload,
            nextScramble: normalizedNextScramble,
            updatedAt: Date.now(),
        };
        this._persistPendingSolveUpload();
        return true;
    }

    _handlePendingSolveUploadFailure(error) {
        this._setConnection('error', this._getPendingSolveUploadMessage(error));
        if (!isMissingNextScrambleUploadError(error)) {
            this._schedulePendingSolveRetry();
        }
        this._emitState();
    }

    async uploadPendingSolve({ nextScramble } = {}) {
        if (nextScramble !== undefined) {
            this._setPendingSolveNextScramble(nextScramble);
        }
        await this._flushPendingSolveUpload().catch((error) => {
            this._handlePendingSolveUploadFailure(error);
            throw error;
        });
    }

    _getPendingSolveUploadMessage(error = null) {
        const detail = error instanceof Error ? error.message : String(error ?? '').trim();
        if (isMissingNextScrambleUploadError(error)) {
            return 'Battle solve saved locally, but the next scramble is not ready yet.';
        }
        if (!this._pendingSolveUpload) {
            return detail
                ? `Battle solve saved locally, but it could not be uploaded. ${detail}`
                : 'Battle solve saved locally, but it could not be uploaded.';
        }
        return detail
            ? `Battle solve saved locally. Upload will retry. ${detail}`
            : 'Battle solve saved locally. Upload will retry.';
    }

    _clearPendingSolveUpload({ resetSubmission = false } = {}) {
        const pending = this._pendingSolveUpload;
        if (this._pendingSolveRetryTimer != null) {
            window.clearTimeout(this._pendingSolveRetryTimer);
            this._pendingSolveRetryTimer = null;
        }
        this._pendingSolveUpload = null;
        this._pendingSolveUploadInFlight = false;
        this._pendingSolveRetryAttempt = 0;
        this._persistPendingSolveUpload();
        if (resetSubmission && pending) {
            if (this._submittedRoundId === pending.solveId && this._lastSubmittedTimestamp === pending.localTimestamp) {
                this._submittedRoundId = null;
                this._lastSubmittedTimestamp = null;
            }
            if (this._lastLocalStatus === BattlePresenceStatus.SOLVED) {
                this._lastLocalStatus = BattlePresenceStatus.READY;
            }
        }
    }

    _schedulePendingSolveRetry() {
        if (!this._pendingSolveUpload || this._pendingSolveRetryTimer != null) return;
        const delay = Math.min(
            PENDING_SOLVE_RETRY_BASE_DELAY_MS * Math.pow(2, this._pendingSolveRetryAttempt),
            PENDING_SOLVE_RETRY_MAX_DELAY_MS,
        );
        this._pendingSolveRetryAttempt++;
        this._pendingSolveRetryTimer = window.setTimeout(() => {
            this._pendingSolveRetryTimer = null;
            void this._flushPendingSolveUpload({ throwOnBlock: false }).catch((error) => {
                this._setConnection('error', this._getPendingSolveUploadMessage(error));
                this._schedulePendingSolveRetry();
                this._emitState();
            });
        }, delay);
    }

    async _sendPendingSolveRequest(pending) {
        const sentPenalty = pending.penalty;
        await this._request('solve', {
            solveId: pending.solveId,
            timeMs: pending.timeMs,
            penalty: pending.penalty,
            localTimestamp: pending.localTimestamp,
            roundScramble: pending.roundScramble,
            nextScramble: pending.nextScramble,
        });

        const latestPending = this._pendingSolveUpload;
        if (latestPending
            && latestPending.accountId === pending.accountId
            && latestPending.roomId === pending.roomId
            && latestPending.solveId === pending.solveId
            && latestPending.localTimestamp === pending.localTimestamp
            && latestPending.penalty !== sentPenalty) {
            await this._request('updatePenalty', {
                solveId: latestPending.solveId,
                penalty: latestPending.penalty,
            });
        }
    }

    async _flushPendingSolveUpload({ throwOnBlock = true } = {}) {
        if (!this._pendingSolveUpload) return false;
        if (this._pendingSolveUploadInFlight) return false;
        if (!this._joined) return false;

        const pending = this._pendingSolveUpload;
        if (pending.accountId !== this._accountId || pending.roomId !== this._roomId) {
            this._clearPendingSolveUpload({ resetSubmission: true });
            throw new Error('Pending battle solve belongs to a different room.');
        }
        const uploadedSolve = this._roomState.solves.find((solve) => (
            solve.accountId === this._accountId
            && solve.solveId === pending.solveId
            && (!pending.localTimestamp || solve.localTimestamp === pending.localTimestamp)
        ));
        const uploadedSolveMatchesPending = uploadedSolve && uploadedSolve.penalty === pending.penalty;
        const uploadedCurrentSolveStillNeedsNextScramble = uploadedSolveMatchesPending
            && pending.solveId === this._roomState.currentRoundId
            && !pending.nextScramble;
        if (uploadedSolveMatchesPending && !uploadedCurrentSolveStillNeedsNextScramble) {
            this._clearPendingSolveUpload();
            this._emitState();
            return true;
        }

        if (!this._pendingSolveMatchesKnownRound(pending)) {
            this._clearPendingSolveUpload({ resetSubmission: true });
            throw new Error('Pending battle solve belongs to a different battle round.');
        }
        if (pending.solveId === this._roomState.currentRoundId && !pending.nextScramble) {
            if (throwOnBlock) throw new Error(MISSING_NEXT_SCRAMBLE_UPLOAD_ERROR_MESSAGE);
            return false;
        }

        if (pending.solveId !== this._roomState.currentRoundId) {
            if (uploadedSolve) {
                if (this._connectionState === 'error' && this._hasOpenSocket()) {
                    this._setConnection('connected', `Joined room ${this._roomId}.`);
                }
                const connectionBlockReason = this._getConnectionBlockReason();
                if (connectionBlockReason) {
                    if (throwOnBlock) throw new Error(connectionBlockReason);
                    this._schedulePendingSolveRetry();
                    return false;
                }

                this._pendingSolveUploadInFlight = true;
                try {
                    await this._request('updatePenalty', {
                        solveId: pending.solveId,
                        penalty: pending.penalty,
                    });
                    this._clearPendingSolveUpload();
                    this._emitState();
                    return true;
                } catch (error) {
                    this._pendingSolveUploadInFlight = false;
                    if (!this._pendingSolveUpload) {
                        this._emitState();
                        return true;
                    }
                    throw error;
                }
            }

            if (pending.solveId === this._roomState.lastRoundId) {
                if (this._connectionState === 'error' && this._hasOpenSocket()) {
                    this._setConnection('connected', `Joined room ${this._roomId}.`);
                }
                const connectionBlockReason = this._getConnectionBlockReason();
                if (connectionBlockReason) {
                    if (throwOnBlock) throw new Error(connectionBlockReason);
                    this._schedulePendingSolveRetry();
                    return false;
                }

                this._pendingSolveUploadInFlight = true;
                try {
                    await this._sendPendingSolveRequest(pending);
                    this._clearPendingSolveUpload();
                    this._emitState();
                    return true;
                } catch (error) {
                    this._pendingSolveUploadInFlight = false;
                    if (!this._pendingSolveUpload) {
                        this._emitState();
                        return true;
                    }
                    throw error;
                }
            }

            this._clearPendingSolveUpload({ resetSubmission: true });
            throw new Error('Battle round changed before the pending solve uploaded.');
        }

        if (this._connectionState === 'error' && this._hasOpenSocket()) {
            this._setConnection('connected', `Joined room ${this._roomId}.`);
        }

        const connectionBlockReason = this._getConnectionBlockReason();
        if (connectionBlockReason) {
            if (throwOnBlock) throw new Error(connectionBlockReason);
            this._schedulePendingSolveRetry();
            return false;
        }

        this._pendingSolveUploadInFlight = true;
        try {
            await this._sendPendingSolveRequest(pending);
            this._clearPendingSolveUpload();
            this._emitState();
            return true;
        } catch (error) {
            this._pendingSolveUploadInFlight = false;
            if (!this._pendingSolveUpload) {
                this._emitState();
                return true;
            }
            throw error;
        }
    }

    async updatePenalty(solveId, penalty) {
        const normalizedPenalty = normalizeBattlePenalty(penalty);
        if (this._pendingSolveUpload?.solveId === solveId) {
            this._pendingSolveUpload = {
                ...this._pendingSolveUpload,
                penalty: normalizedPenalty,
                updatedAt: Date.now(),
            };
            this._persistPendingSolveUpload();
            if (!this._pendingSolveUploadInFlight) {
                void this._flushPendingSolveUpload({ throwOnBlock: false }).catch((error) => {
                    this._setConnection('error', this._getPendingSolveUploadMessage(error));
                    this._schedulePendingSolveRetry();
                    this._emitState();
                });
            }
            return;
        }
        if (!this._joined || !this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        await this._request('updatePenalty', {
            solveId,
            penalty: normalizedPenalty,
        }).catch((error) => {
            console.error('Failed to update battle penalty:', error);
        });
    }

    handleLocalSolveDeleted(solveIdOrIds) {
        const solveIds = (Array.isArray(solveIdOrIds) ? solveIdOrIds : [solveIdOrIds])
            .map((solveId) => String(solveId ?? '').trim())
            .filter(Boolean);
        const pending = this._pendingSolveUpload;
        if (!pending?.localSolveId || !solveIds.includes(pending.localSolveId)) {
            return false;
        }

        const cancelPayload = {
            solveId: pending.solveId,
            localTimestamp: pending.localTimestamp,
        };
        const shouldRequestRemoteCancel = this._joined && this._hasOpenSocket();
        this._log('info', 'Clearing pending battle solve because its local solve was deleted.', {
            localSolveId: pending.localSolveId,
            solveId: pending.solveId,
            localTimestamp: pending.localTimestamp,
            remoteCancelRequested: shouldRequestRemoteCancel,
        });
        this._clearPendingSolveUpload({ resetSubmission: true });
        this._emitState();
        if (shouldRequestRemoteCancel) {
            void this._request('deleteSolve', cancelPayload).catch((error) => {
                this._log('warn', 'Failed to cancel deleted battle solve on the server.', {
                    solveId: cancelPayload.solveId,
                    localTimestamp: cancelPayload.localTimestamp,
                    error: error instanceof Error ? error.message : String(error ?? ''),
                });
            });
        }
        return true;
    }

    getLocalSolveRoundId(solveTimestamp) {
        if (!solveTimestamp) return null;
        const ts = Number(solveTimestamp);
        if (!Number.isFinite(ts) || ts <= 0) return null;

        const accountId = this._accountId;
        if (this._pendingSolveUpload
            && this._pendingSolveUpload.accountId === accountId
            && this._pendingSolveUpload.roomId === this._roomId
            && this._pendingSolveUpload.localTimestamp === ts) {
            return this._pendingSolveUpload.solveId;
        }

        if (!this._joined) return null;

        const match = this._roomState.solves.find(
            (s) => s.accountId === accountId && s.localTimestamp === ts
        );
        if (match) return match.solveId;

        // Fallback for race condition: user updates penalty before server confirms solve in room state.
        if (this._submittedRoundId != null && this._submittedRoundId === this._roomState.currentRoundId && ts === this._lastSubmittedTimestamp) {
            return this._submittedRoundId;
        }

        return null;
    }

    async setScrambleType(scrambleType, scramble) {
        if (!this._joined) return;
        await this._request('setScrambleType', {
            scrambleType: String(scrambleType ?? '333').trim().toLowerCase() || '333',
            scramble: String(scramble ?? '').trim(),
        });
    }

    async _postRoomAction(action, payload = {}) {
        if (!this._roomId) {
            throw new Error('Battle room is not available.');
        }

        const response = await window.fetch(buildRoomProbeUrl(this._roomId), {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                action,
                accountId: this._accountId,
                sessionId: this._sessionId,
                pageInstanceId: this._pageInstanceId,
                connectionId: this._connectionId,
                ...payload,
            }),
        });

        if (!response.ok) {
            throw new Error(`Battle ${action} request failed.`);
        }

        return response.json().catch(() => null);
    }

    _emitState() {
        this.emit('stateChange', this.getState());
    }

    _setConnection(state, message = '') {
        this._connectionState = state;
        this._connectionMessage = String(message ?? '');
    }

    async _connect(roomId) {
        if (this._socket?.readyState === WebSocket.OPEN) return;
        if (this._socket?.readyState === WebSocket.CONNECTING) {
            await new Promise((resolve, reject) => {
                const onOpen = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    reject(new Error('Unable to connect to the battle server.'));
                };
                const onClose = () => {
                    cleanup();
                    reject(new Error('Battle connection closed before opening.'));
                };
                const cleanup = () => {
                    this._socket?.removeEventListener('open', onOpen);
                    this._socket?.removeEventListener('error', onError);
                    this._socket?.removeEventListener('close', onClose);
                };
                this._socket?.addEventListener('open', onOpen, { once: true });
                this._socket?.addEventListener('error', onError, { once: true });
                this._socket?.addEventListener('close', onClose, { once: true });
            });
            return;
        }

        this._expectedClose = false;
        this._setConnection('connecting', 'Connecting to the battle server...');
        this._emitState();

        const socketUrl = buildRoomSocketUrl(roomId);
        const connectionId = createBattleConnectionId();
        this._connectionId = connectionId;
        this._log('info', 'Opening battle websocket.', { socketUrl });
        const socket = new WebSocket(socketUrl);
        this._socket = socket;

        socket.addEventListener('message', (event) => {
            this._handleSocketMessage(event.data);
        });
        socket.addEventListener('close', (event) => {
            if (this._socket !== socket) return;
            if (this._reconnecting) {
                this._log('warn', 'Reconnect socket closed while reconnect attempt was in progress.', getCloseEventDetails(event));
                this._teardownSocket();
                return;
            }

            const wasExpected = this._expectedClose;
            const wasJoined = this._joined;
            const wasReplaced = isSessionReplacementCloseEvent(event);
            const closeDetails = getCloseEventDetails(event);
            this._teardownSocket();

            if (!wasExpected && !wasReplaced && wasJoined) {
                this._log('warn', 'Battle websocket closed unexpectedly; scheduling reconnect.', {
                    ...closeDetails,
                    reconnectAttempt: this._reconnectAttempt + 1,
                });
                this._setConnection('reconnecting', 'Reconnecting to battle...');
                this._emitState();
                this._scheduleReconnect();
            } else {
                this._joined = false;
                this._submittedRoundId = null;
                this._lastSubmittedTimestamp = null;
                this._activeAttemptRoundId = null;
                this._roomState = createInitialRoomState();
                this._pageDisconnectNotified = false;
                if (wasReplaced) {
                    this._log('warn', 'Battle session was replaced by another tab or connection.', closeDetails);
                    this._setConnection('error', 'This battle session is now active in another tab.');
                } else if (!wasExpected) {
                    this._log('warn', 'Battle websocket closed without reconnect.', closeDetails);
                    this._setConnection('error', 'Battle connection closed.');
                } else {
                    this._log('info', 'Battle websocket closed as expected.', closeDetails);
                    this._setConnection('idle', '');
                }
                this._emitState();
            }
        });
        socket.addEventListener('error', () => {
            this._log('warn', 'Battle websocket emitted an error event.');
            this._setConnection('error', 'Unable to connect to the battle server.');
            this._emitState();
        });

        await new Promise((resolve, reject) => {
            const handleOpen = () => {
                cleanup();
                this._startPingInterval();
                this._log('info', 'Battle websocket opened successfully.');
                this._setConnection('connected', 'Connected to the battle server.');
                this._emitState();
                resolve();
            };
            const handleError = () => {
                cleanup();
                this._log('warn', 'Battle websocket errored before opening.');
                reject(new Error('Unable to connect to the battle server.'));
            };
            const handleClose = (event) => {
                cleanup();
                this._log('warn', 'Battle websocket closed before opening.', getCloseEventDetails(event));
                reject(new Error('Battle connection closed before opening.'));
            };
            const cleanup = () => {
                socket.removeEventListener('open', handleOpen);
                socket.removeEventListener('error', handleError);
                socket.removeEventListener('close', handleClose);
            };

            socket.addEventListener('open', handleOpen, { once: true });
            socket.addEventListener('error', handleError, { once: true });
            socket.addEventListener('close', handleClose, { once: true });
        });
    }

    _teardownSocket() {
        this._stopPingInterval();
        const pendingRequestCount = this._pendingRequests.size;
        this._pendingRequests.forEach(({ reject, timeoutId }) => {
            clearTimeout(timeoutId);
            reject(new Error('Battle connection closed.'));
        });
        this._pendingRequests.clear();

        if (this._socket) {
            try {
                this._socket.close();
            } catch {
                // Ignore close errors on torn-down sockets.
            }
        }
        if (pendingRequestCount > 0) {
            this._log('warn', 'Cleared pending battle requests because the socket was torn down.', {
                pendingRequestCount,
            });
        }
        this._socket = null;
        this._expectedClose = false;
    }

    _startPingInterval() {
        this._stopPingInterval();
        this._lastMessageAt = Date.now();
        this._pingIntervalId = window.setInterval(() => {
            if (this._socket?.readyState === WebSocket.OPEN) {
                if (this._lastMessageAt && Date.now() - this._lastMessageAt > ZOMBIE_TIMEOUT_MS) {
                    // No data received for too long — connection is likely dead.
                    this._log('warn', 'Closing battle websocket because it appears inactive.', {
                        lastMessageAgeMs: Date.now() - this._lastMessageAt,
                        zombieTimeoutMs: ZOMBIE_TIMEOUT_MS,
                    });
                    this._socket.close();
                    return;
                }
                try {
                    this._socket.send(JSON.stringify({ action: 'ping' }));
                } catch {
                    this._log('warn', 'Failed to send battle ping; waiting for socket close handling.');
                }
            }
        }, PING_INTERVAL_MS);
    }

    _stopPingInterval() {
        if (this._pingIntervalId != null) {
            window.clearInterval(this._pingIntervalId);
            this._pingIntervalId = null;
        }
    }

    _scheduleReconnect() {
        if (this._reconnectTimer != null) return;
        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this._reconnectAttempt),
            RECONNECT_MAX_DELAY_MS,
        );
        this._reconnectAttempt++;
        this._log('info', 'Scheduling battle reconnect attempt.', {
            reconnectAttempt: this._reconnectAttempt,
            reconnectDelayMs: delay,
        });
        this._reconnectTimer = window.setTimeout(() => {
            this._reconnectTimer = null;
            this._attemptReconnect();
        }, delay);
    }

    _cancelReconnect() {
        if (this._reconnectTimer != null) {
            window.clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._reconnectAttempt = 0;
        this._reconnecting = false;
    }

    async _attemptReconnect() {
        if (!this._joined || this._expectedClose) {
            this._log('info', 'Skipping reconnect attempt because the battle session is no longer active.', {
                expectedClose: this._expectedClose,
            });
            this._cancelReconnect();
            return;
        }

        this._reconnecting = true;
        this._log('info', 'Attempting to reconnect to battle.', {
            reconnectAttempt: this._reconnectAttempt,
        });

        try {
            await this._connect(this._roomId);
            const response = await this._request('join', {
                accountId: this._accountId,
                sessionId: this._sessionId,
                pageInstanceId: this._pageInstanceId,
                connectionId: this._connectionId,
                nickname: this._nickname,
                scrambleType: this._roomState.scrambleType || '333',
                initialScramble: this._roomState.currentScramble || '',
            });

            this._reconnecting = false;
            this._reconnectAttempt = 0;
            this._joined = true;
            this._pageDisconnectNotified = false;
            if (this._lastLocalStatus === BattlePresenceStatus.SOLVED
                && this._submittedRoundId !== this._roomState.currentRoundId
                && !this._pendingSolveUpload) {
                this._lastLocalStatus = BattlePresenceStatus.READY;
            }
            this._log('info', 'Battle reconnect succeeded.');
            this._setConnection('connected', `Rejoined room ${this._roomId}.`);
            if (response?.roomInfo) {
                this._applyRoomInfo(response.roomInfo);
            } else {
                this._emitState();
            }
        } catch (error) {
            this._reconnecting = false;
            this._teardownSocket();
            this._log('warn', 'Battle reconnect attempt failed.', {
                reconnectAttempt: this._reconnectAttempt,
                error: error instanceof Error ? error.message : String(error ?? ''),
            });

            if (!this._joined || this._expectedClose) {
                this._cancelReconnect();
                return;
            }

            if (this._reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
                this._setConnection('reconnecting', 'Reconnecting to battle...');
                this._emitState();
                this._scheduleReconnect();
            } else {
                this._joined = false;
                this._submittedRoundId = null;
                this._lastSubmittedTimestamp = null;
                this._activeAttemptRoundId = null;
                this._roomState = createInitialRoomState();
                this._pageDisconnectNotified = false;
                this._setConnection('error', 'Unable to reconnect. Please rejoin the room.');
                this._emitState();
            }
        }
    }

    _handleVisibilityChange() {
        if (document.visibilityState !== 'visible') return;
        if (!this._joined) return;
        if (this._socket?.readyState === WebSocket.OPEN) return;

        // Socket is dead but we think we're still joined — trigger reconnect
        if (!this._reconnecting && this._reconnectTimer == null) {
            this._log('info', 'Visibility or online event detected a dead socket; forcing reconnect.', {
                visibilityState: document.visibilityState,
            });
            this._teardownSocket();
            this._reconnectAttempt = 0;
            this._setConnection('reconnecting', 'Reconnecting to battle...');
            this._emitState();
            this._scheduleReconnect();
        }
    }

    _handlePageShow(event) {
        if (!this._joined) return;
        if (this._socket?.readyState === WebSocket.OPEN) return;

        this._pageDisconnectNotified = false;
        if (document.visibilityState !== 'visible') return;
        if (!this._reconnecting && this._reconnectTimer == null) {
            this._log('info', 'Page restored with no battle socket; forcing reconnect.', {
                persisted: Boolean(event?.persisted),
                visibilityState: document.visibilityState,
            });
            this._teardownSocket();
            this._reconnectAttempt = 0;
            this._setConnection('reconnecting', 'Reconnecting to battle...');
            this._emitState();
            this._scheduleReconnect();
        }
    }

    async _request(action, payload = {}, { applyRoomInfo = true } = {}) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
            throw new Error('Battle connection is not open.');
        }

        const requestId = this._requestSeq++;
        const message = { action, requestId, ...payload };

        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                this._pendingRequests.delete(requestId);
                reject(new Error(`Battle request timed out while handling "${action}".`));
            }, 8000);

            this._pendingRequests.set(requestId, { resolve, reject, timeoutId, applyRoomInfo, action });
            try {
                this._socket.send(JSON.stringify(message));
            } catch (error) {
                window.clearTimeout(timeoutId);
                this._pendingRequests.delete(requestId);
                reject(error instanceof Error ? error : new Error('Failed to send battle request.'));
            }
        });
    }

    _handleSocketMessage(rawData) {
        this._lastMessageAt = Date.now();

        let message;
        try {
            message = JSON.parse(String(rawData ?? ''));
        } catch {
            return;
        }

        if (Number.isFinite(Number(message?.requestId)) && this._pendingRequests.has(Number(message.requestId))) {
            const requestId = Number(message.requestId);
            const pending = this._pendingRequests.get(requestId);
            this._pendingRequests.delete(requestId);
            clearTimeout(pending.timeoutId);

            if (message?.ok === false) {
                if (pending.applyRoomInfo !== false && pending.action !== 'join' && message?.roomInfo) {
                    this._applyRoomInfo(message.roomInfo);
                }
                pending.reject(new Error(String(message?.error || 'Battle request failed.')));
                return;
            }

            if (pending.applyRoomInfo !== false && message?.roomInfo) {
                this._applyRoomInfo(message.roomInfo);
            }
            pending.resolve(message);
            return;
        }

        if (message?.type === 'roomInfo' && message?.roomInfo) {
            this._applyRoomInfo(message.roomInfo);
        }
    }

    _applyRoomInfo(roomInfo) {
        const previousRoundId = this._roomState.currentRoundId;
        const previousScramble = this._roomState.currentScramble;
        const previousScrambleType = this._roomState.scrambleType;
        const mappedRoomState = mapRoomInfo(roomInfo);
        const nextRoomState = reconcileRoomState(this._roomState, mappedRoomState);
        if (nextRoomState.preservedProgressCount) {
            this._log('warn', 'Preserved battle player progress from a regressive room snapshot.', {
                preservedProgressCount: nextRoomState.preservedProgressCount,
                currentRoundId: nextRoomState.currentRoundId,
                previousRoundId,
            });
            delete nextRoomState.preservedProgressCount;
        }
        const pendingSolveUpload = this._pendingSolveUpload;
        const uploadedPendingSolve = pendingSolveUpload && nextRoomState.solves.find((solve) => (
            solve.accountId === this._accountId
            && solve.solveId === pendingSolveUpload.solveId
            && (!pendingSolveUpload.localTimestamp || solve.localTimestamp === pendingSolveUpload.localTimestamp)
        ));
        const hasUploadedPendingSolve = uploadedPendingSolve && uploadedPendingSolve.penalty === pendingSolveUpload.penalty;
        const uploadedCurrentSolveStillNeedsNextScramble = hasUploadedPendingSolve
            && pendingSolveUpload.solveId === nextRoomState.currentRoundId
            && !pendingSolveUpload.nextScramble;
        this._roomState = nextRoomState;

        if (hasUploadedPendingSolve && !uploadedCurrentSolveStillNeedsNextScramble) {
            this._clearPendingSolveUpload();
        }

        if (previousRoundId !== nextRoomState.currentRoundId) {
            this._submittedRoundId = null;
            if (!this._pendingSolveUpload) {
                this._lastLocalStatus = BattlePresenceStatus.READY;
            }
        }

        const hasSolvedCurrent = nextRoomState.solves.some(
            (s) => s.accountId === this._accountId && s.solveId === nextRoomState.currentRoundId
        );
        if (hasSolvedCurrent) {
            this._submittedRoundId = nextRoomState.currentRoundId;
            this._lastLocalStatus = BattlePresenceStatus.SOLVED;
            this._activeAttemptRoundId = null;
        }
        if (this._pendingSolveUpload?.solveId === nextRoomState.currentRoundId) {
            this._submittedRoundId = this._pendingSolveUpload.solveId;
            this._lastSubmittedTimestamp = this._pendingSolveUpload.localTimestamp;
            this._lastLocalStatus = BattlePresenceStatus.SOLVED;
        }

        this._joined = true;
        this._pageDisconnectNotified = false;
        this._setConnection('connected', `Joined room ${nextRoomState.roomId}.`);
        this._emitState();

        if (this._pendingSolveUpload && !this._pendingSolveUploadInFlight && this._hasOpenSocket()) {
            void this._flushPendingSolveUpload({ throwOnBlock: false }).catch((error) => {
                this._setConnection('error', this._getPendingSolveUploadMessage(error));
                this._schedulePendingSolveRetry();
                this._emitState();
            });
        }

        if (nextRoomState.currentScramble && nextRoomState.currentScramble !== previousScramble) {
            this.emit('scrambleChange', {
                scramble: nextRoomState.currentScramble,
                scrambleType: nextRoomState.scrambleType,
                roundId: nextRoomState.currentRoundId,
                previousRoundId,
            });
        }

        if (nextRoomState.scrambleType !== previousScrambleType) {
            this.emit('scrambleTypeChange', {
                scrambleType: nextRoomState.scrambleType,
                roundId: nextRoomState.currentRoundId,
            });
        }
    }
}

export const battleManager = new BattleManager();
