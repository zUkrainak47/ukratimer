import { load, save } from './storage.js?v=2026042704';
import { EventEmitter, formatTime, generateId } from './utils.js?v=2026042704';

const STORAGE_KEYS = Object.freeze({
    accountId: 'battleAccountId',
    nickname: 'battleNickname',
    roomId: 'battleRoomId',
});

const ROOM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{2,31})$/i;
const MAX_NICKNAME_LENGTH = 18;

const PING_INTERVAL_MS = 25000;
const MAX_RECONNECT_ATTEMPTS = 15;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const ZOMBIE_TIMEOUT_MS = 35000;

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

function normalizeNickname(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_NICKNAME_LENGTH);
}

function normalizeRoomId(value) {
    return String(value ?? '').trim();
}

function isValidRoomId(value) {
    return ROOM_ID_PATTERN.test(normalizeRoomId(value));
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
                elo: Number.isFinite(Number(player?.elo)) ? Number(player.elo) : 1000,
                wins: Number.isFinite(Number(player?.wins)) ? Number(player.wins) : 0,
                status: String(player?.status ?? BattlePresenceStatus.READY),
            }))
            : [],
        solves: Array.isArray(roomInfo?.solves)
            ? roomInfo.solves.map((solve) => ({
                accountId: String(solve?.accountId ?? ''),
                solveId: Number(solve?.solveId) || 0,
                timeMs: Number.isFinite(Number(solve?.timeMs)) ? Math.max(0, Math.round(Number(solve.timeMs))) : null,
                penalty: solve?.penalty === '+2' || solve?.penalty === 'DNF' ? solve.penalty : null,
                submittedAt: Number(solve?.submittedAt) || 0,
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

export function formatBattleSolve(solve) {
    if (!solve || solve.timeMs == null) return '-';
    if (solve.penalty === 'DNF') return 'DNF';

    const displayTime = solve.penalty === '+2'
        ? solve.timeMs + 2000
        : solve.timeMs;
    const formatted = formatTime(displayTime);
    return solve.penalty === '+2' ? `${formatted}+` : formatted;
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
        const currentSolve = playerSolves.get(roomState.currentRoundId) || null;
        const previousSolve = playerSolves.get(roomState.lastRoundId) || null;
        const shownSolve = currentSolve || previousSolve;
        const shouldDimSolve = hasCurrentSolve && player.status !== BattlePresenceStatus.SOLVED && !currentSolve && previousSolve;

        return {
            rank: index + 1,
            accountId: player.accountId,
            nickname: player.nickname,
            elo: player.elo,
            wins: player.wins,
            status: player.status,
            statusLabel: BATTLE_STATUS_LABELS[player.status] || player.status,
            solve: shownSolve,
            solveText: formatBattleSolve(shownSolve),
            dimSolve: shouldDimSolve,
            isLocal: Boolean(localAccountId) && player.accountId === localAccountId,
        };
    });
}

class BattleManager extends EventEmitter {
    constructor() {
        super();
        this._accountId = load(STORAGE_KEYS.accountId, '') || `battle_${generateId()}`;
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
        this._lastSolvedRoundId = null;
        this._lastSolvedLocalId = null;
        this._expectedClose = false;
        this._pingIntervalId = null;
        this._reconnecting = false;
        this._reconnectTimer = null;
        this._reconnectAttempt = 0;
        this._lastMessageAt = 0;

        save(STORAGE_KEYS.accountId, this._accountId);

        window.addEventListener('pagehide', () => {
            this.leaveRoomSync();
        });
        window.addEventListener('beforeunload', () => {
            this.leaveRoomSync();
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

    getStartBlockReason() {
        if (!this._joined) return null;
        if (!this._roomState.currentScramble) return 'Waiting for the room scramble.';
        if (this._submittedRoundId === this._roomState.currentRoundId) {
            return 'Waiting for the next battle scramble.';
        }
        return null;
    }

    isWaitingForOthers() {
        return this._joined && this._submittedRoundId === this._roomState.currentRoundId;
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
        save(STORAGE_KEYS.nickname, this._nickname);
        save(STORAGE_KEYS.roomId, this._roomId);
        this._cancelReconnect();

        if (this._socket) {
            this._expectedClose = true;
            this._teardownSocket();
            this._roomState = createInitialRoomState();
            this._joined = false;
        }

        await this._connect(normalizedRoomId);
        const response = await this._request('join', {
            accountId: this._accountId,
            nickname: this._nickname,
            scrambleType: normalizedScrambleType,
            initialScramble: String(initialScramble).trim(),
        });

        this._joined = true;
        this._setConnection('connected', `Joined room ${normalizedRoomId}.`);
        if (response?.roomInfo) {
            this._applyRoomInfo(response.roomInfo);
        } else {
            this._emitState();
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
        this._cancelReconnect();
        this._expectedClose = true;

        if (this._socket && this._socket.readyState === WebSocket.OPEN) {
            try {
                await this._request('leave', { accountId: this._accountId });
            } catch {
                // Ignore leave errors during teardown.
            }
        }

        this._teardownSocket();
        this._joined = false;
        this._submittedRoundId = null;
        this._lastSolvedRoundId = null;
        this._lastSolvedLocalId = null;
        this._roomState = createInitialRoomState();
        this._setConnection('idle', '');
        this._emitState();
    }

    leaveRoomSync() {
        if (!this._joined || !this._roomId) return;
        this._cancelReconnect();

        const payload = JSON.stringify({
            action: 'leave',
            accountId: this._accountId,
        });
        const url = buildRoomProbeUrl(this._roomId);

        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
            } else {
                void window.fetch(url, {
                    method: 'POST',
                    mode: 'cors',
                    keepalive: true,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: payload,
                }).catch(() => { });
            }
        } catch {
            // Ignore unload delivery errors.
        }

        this._expectedClose = true;
        this._teardownSocket();
        this._joined = false;
        this._submittedRoundId = null;
        this._lastSolvedRoundId = null;
        this._lastSolvedLocalId = null;
        this._roomState = createInitialRoomState();
    }

    async submitStatus(status) {
        if (!this._joined || !this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        await this._request('status', {
            accountId: this._accountId,
            status,
        }).catch(() => { });
    }

    async handleTimerStateChange(timerState) {
        if (!this._joined) return;
        if (this._submittedRoundId === this._roomState.currentRoundId) return;

        const status = TIMER_STATE_TO_BATTLE_STATUS[timerState] || BattlePresenceStatus.READY;
        const localPlayer = this.getState().localPlayer;
        if (localPlayer?.status === status) return;
        await this.submitStatus(status);
    }

    async handleLocalSolve(solve, { nextScramble } = {}) {
        if (!this._joined) return;
        if (this._submittedRoundId === this._roomState.currentRoundId) return;
        if (!solve || this._roomState.currentRoundId <= 0) return;

        this._submittedRoundId = this._roomState.currentRoundId;
        this._lastSolvedRoundId = this._roomState.currentRoundId;
        this._lastSolvedLocalId = solve.id ?? null;
        this._emitState();

        await this._request('solve', {
            accountId: this._accountId,
            solveId: this._roomState.currentRoundId,
            timeMs: Number.isFinite(Number(solve.time)) ? Math.max(0, Math.round(Number(solve.time))) : null,
            penalty: solve.penalty === '+2' || solve.penalty === 'DNF' ? solve.penalty : null,
            nextScramble: String(nextScramble ?? '').trim(),
        }).catch((error) => {
            this._submittedRoundId = null;
            this._setConnection('error', error instanceof Error ? error.message : 'Failed to upload solve.');
            this._emitState();
            throw error;
        });
    }

    async updatePenalty(solveId, penalty) {
        if (!this._joined || !this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        await this._request('updatePenalty', {
            accountId: this._accountId,
            solveId,
            penalty: penalty === '+2' || penalty === 'DNF' ? penalty : null,
        }).catch((error) => {
            console.error('Failed to update battle penalty:', error);
        });
    }

    getLastSolvedRoundId() {
        return this._lastSolvedRoundId;
    }

    getLastSolvedLocalId() {
        return this._lastSolvedLocalId;
    }

    async setScrambleType(scrambleType, scramble) {
        if (!this._joined) return;
        await this._request('setScrambleType', {
            accountId: this._accountId,
            scrambleType: String(scrambleType ?? '333').trim().toLowerCase() || '333',
            scramble: String(scramble ?? '').trim(),
        });
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
        const socket = new WebSocket(socketUrl);
        this._socket = socket;

        socket.addEventListener('message', (event) => {
            this._handleSocketMessage(event.data);
        });
        socket.addEventListener('close', () => {
            if (this._socket !== socket) return;
            if (this._reconnecting) {
                this._teardownSocket();
                return;
            }

            const wasExpected = this._expectedClose;
            const wasJoined = this._joined;
            this._teardownSocket();

            if (!wasExpected && wasJoined) {
                this._setConnection('reconnecting', 'Reconnecting to battle...');
                this._emitState();
                this._scheduleReconnect();
            } else {
                this._joined = false;
                this._submittedRoundId = null;
                this._lastSolvedRoundId = null;
                this._lastSolvedLocalId = null;
                this._roomState = createInitialRoomState();
                if (!wasExpected) {
                    this._setConnection('error', 'Battle connection closed.');
                } else {
                    this._setConnection('idle', '');
                }
                this._emitState();
            }
        });
        socket.addEventListener('error', () => {
            this._setConnection('error', 'Unable to connect to the battle server.');
            this._emitState();
        });

        await new Promise((resolve, reject) => {
            const handleOpen = () => {
                cleanup();
                this._startPingInterval();
                this._setConnection('connected', 'Connected to the battle server.');
                this._emitState();
                resolve();
            };
            const handleError = () => {
                cleanup();
                reject(new Error('Unable to connect to the battle server.'));
            };
            const handleClose = () => {
                cleanup();
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
                    this._socket.close();
                    return;
                }
                try {
                    this._socket.send(JSON.stringify({ action: 'ping' }));
                } catch {
                    // Send failure; the close event will handle cleanup.
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
            this._cancelReconnect();
            return;
        }

        this._reconnecting = true;

        try {
            await this._connect(this._roomId);
            const response = await this._request('join', {
                accountId: this._accountId,
                nickname: this._nickname,
                scrambleType: this._roomState.scrambleType || '333',
                initialScramble: this._roomState.currentScramble || '',
            });

            this._reconnecting = false;
            this._reconnectAttempt = 0;
            this._joined = true;
            this._setConnection('connected', `Rejoined room ${this._roomId}.`);
            if (response?.roomInfo) {
                this._applyRoomInfo(response.roomInfo);
            } else {
                this._emitState();
            }
        } catch {
            this._reconnecting = false;
            this._teardownSocket();

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
                this._lastSolvedRoundId = null;
                this._lastSolvedLocalId = null;
                this._roomState = createInitialRoomState();
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
            this._teardownSocket();
            this._reconnectAttempt = 0;
            this._setConnection('reconnecting', 'Reconnecting to battle...');
            this._emitState();
            this._scheduleReconnect();
        }
    }

    async _request(action, payload = {}) {
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

            this._pendingRequests.set(requestId, { resolve, reject, timeoutId });
            this._socket.send(JSON.stringify(message));
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
                pending.reject(new Error(String(message?.error || 'Battle request failed.')));
                return;
            }

            if (message?.roomInfo) {
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
        const nextRoomState = mapRoomInfo(roomInfo);
        this._roomState = nextRoomState;

        if (previousRoundId !== nextRoomState.currentRoundId) {
            this._submittedRoundId = null;
        }

        const hasSolvedCurrent = nextRoomState.solves.some(
            (s) => s.accountId === this._accountId && s.solveId === nextRoomState.currentRoundId
        );
        if (hasSolvedCurrent) {
            this._submittedRoundId = nextRoomState.currentRoundId;
        }

        this._joined = true;
        this._setConnection('connected', `Joined room ${nextRoomState.roomId}.`);
        this._emitState();

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
