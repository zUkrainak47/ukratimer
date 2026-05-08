const STATUS = Object.freeze({
    READY: 'READY',
    INSPECTING: 'INSPECTING',
    SOLVING: 'SOLVING',
    SOLVED: 'SOLVED',
});
const SOLVE_ORIGIN = Object.freeze({
    CLIENT: 'client',
    FORFEIT: 'forfeit',
});

const STATUS_SET = new Set(Object.values(STATUS));
const FORFEIT_ELIGIBLE_STATUS_SET = new Set([
    STATUS.INSPECTING,
    STATUS.SOLVING,
]);
const STATUS_PROGRESS_RANK = Object.freeze({
    [STATUS.READY]: 0,
    [STATUS.INSPECTING]: 1,
    [STATUS.SOLVING]: 2,
    [STATUS.SOLVED]: 3,
});
const MAX_PLAYERS = 16;
const ROOM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{2,31})$/i;
const SCRAMBLE_TYPE_PATTERN = /^[a-z0-9_-]{2,24}$/i;
const SESSION_REPLACED_CLOSE_CODE = 4001;
const SESSION_REPLACED_CLOSE_REASON = 'Replaced by a newer connection.';
const BATTLE_CLIENT_UPDATE_REQUIRED_MESSAGE = 'Online battles updated. Please close and reopen the timer!';
const DISCONNECT_GRACE_MS_BY_STATUS = Object.freeze({
    [STATUS.READY]: 10000,
    [STATUS.INSPECTING]: 15000,
    [STATUS.SOLVING]: 15000,
    [STATUS.SOLVED]: 10000,
});
const SESSION_RECLAIM_INACTIVE_MS_BY_STATUS = Object.freeze({
    [STATUS.READY]: 18000,
    [STATUS.INSPECTING]: 18000,
    [STATUS.SOLVING]: 18000,
    [STATUS.SOLVED]: 18000,
});
const STALE_ACTIVITY_MS_BY_STATUS = Object.freeze({
    [STATUS.READY]: 120000,
    [STATUS.INSPECTING]: 120000,
    [STATUS.SOLVING]: 120000,
    [STATUS.SOLVED]: 120000,
});

function normalizeRoomId(value) {
    return String(value ?? '').trim();
}

function isValidRoomId(value) {
    return ROOM_ID_PATTERN.test(normalizeRoomId(value));
}

function normalizeNickname(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 24);
}

function normalizeScrambleType(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return SCRAMBLE_TYPE_PATTERN.test(normalized) ? normalized : '333';
}

function normalizeStatus(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return STATUS_SET.has(normalized) ? normalized : null;
}

function normalizeRoundNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : null;
}

function isAllowedStatusRegression(status, previousStatus) {
    return previousStatus === STATUS.INSPECTING && status === STATUS.READY;
}

function getDisconnectGraceMs(status) {
    return DISCONNECT_GRACE_MS_BY_STATUS[String(status ?? '').trim().toUpperCase()] || 10000;
}

function getSessionReclaimInactiveMs(status) {
    return SESSION_RECLAIM_INACTIVE_MS_BY_STATUS[String(status ?? '').trim().toUpperCase()] || 18000;
}

function getStaleActivityMs(status) {
    return STALE_ACTIVITY_MS_BY_STATUS[String(status ?? '').trim().toUpperCase()] || 120000;
}

function cloneSolve(solve) {
    return {
        accountId: solve.accountId,
        solveId: solve.solveId,
        timeMs: solve.timeMs,
        penalty: solve.penalty,
        localTimestamp: solve.localTimestamp,
        submittedAt: solve.submittedAt,
        origin: solve.origin === SOLVE_ORIGIN.FORFEIT ? SOLVE_ORIGIN.FORFEIT : SOLVE_ORIGIN.CLIENT,
    };
}

function compareSolveTimes(a, b) {
    const valueA = a?.penalty === 'DNF' || a?.timeMs == null
        ? Number.POSITIVE_INFINITY
        : a.timeMs + (a.penalty === '+2' ? 2000 : 0);
    const valueB = b?.penalty === 'DNF' || b?.timeMs == null
        ? Number.POSITIVE_INFINITY
        : b.timeMs + (b.penalty === '+2' ? 2000 : 0);

    if (valueA === valueB) return 0;
    return valueA < valueB ? -1 : 1;
}

function getSolveMeanValue(solve) {
    if (!solve || solve.timeMs == null || solve.penalty === 'DNF') return null;
    return solve.timeMs + (solve.penalty === '+2' ? 2000 : 0);
}

function createPlayerStats(seed = {}) {
    return {
        elo: Number.isFinite(Number(seed.elo)) ? Number(seed.elo) : 1000,
        wins: Number.isFinite(Number(seed.wins)) ? Math.max(0, Math.round(Number(seed.wins))) : 0,
        solveCount: Number.isFinite(Number(seed.solveCount)) ? Math.max(0, Math.round(Number(seed.solveCount))) : 0,
        meanTimeSum: Number.isFinite(Number(seed.meanTimeSum)) ? Math.max(0, Math.round(Number(seed.meanTimeSum))) : 0,
        meanTimeCount: Number.isFinite(Number(seed.meanTimeCount)) ? Math.max(0, Math.round(Number(seed.meanTimeCount))) : 0,
    };
}

function ensurePlayerStats(stats) {
    if (!stats) return null;
    const normalized = createPlayerStats(stats);
    stats.elo = normalized.elo;
    stats.wins = normalized.wins;
    stats.solveCount = normalized.solveCount;
    stats.meanTimeSum = normalized.meanTimeSum;
    stats.meanTimeCount = normalized.meanTimeCount;
    return stats;
}

function applySolveToPlayerStats(stats, solve, direction = 1) {
    ensurePlayerStats(stats);
    if (!stats || !solve) return;

    const delta = direction >= 0 ? 1 : -1;
    stats.solveCount = Math.max(0, Math.round(Number(stats.solveCount) || 0) + delta);

    const meanValue = getSolveMeanValue(solve);
    if (meanValue != null) {
        stats.meanTimeCount = Math.max(0, Math.round(Number(stats.meanTimeCount) || 0) + delta);
        stats.meanTimeSum = Math.max(0, Math.round(Number(stats.meanTimeSum) || 0) + (delta * meanValue));
    }
}

function createJsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}

async function readJsonPayload(request) {
    const rawBody = await request.text();
    if (!rawBody.trim()) return null;
    return JSON.parse(rawBody);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const roomMatch = url.pathname.match(/^\/battle\/([^/]+)$/);
        if (!roomMatch) {
            return new Response('Not found.', { status: 404 });
        }

        const roomId = normalizeRoomId(decodeURIComponent(roomMatch[1]));
        if (!isValidRoomId(roomId)) {
            return new Response('Room id must be 3-32 characters using letters, numbers, "_" or "-".', { status: 400 });
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        const objectId = env.BATTLE_ROOM.idFromName(roomId.toLowerCase());
        const stub = env.BATTLE_ROOM.get(objectId);

        if (request.headers.get('Upgrade') !== 'websocket') {
            if (request.method !== 'GET' && request.method !== 'POST') {
                return createJsonResponse({ error: 'Method not allowed.' }, 405);
            }
            return stub.fetch(`https://battle.internal/${encodeURIComponent(roomId)}`, request);
        }

        return stub.fetch(`https://battle.internal/${encodeURIComponent(roomId)}`, request);
    },
};

export class BattleRoom {
    constructor(state) {
        this.state = state;
        this.roomId = '';
        this.ownerAccountId = '';
        this.scrambleType = '333';
        this.players = [];
        this.solves = [];
        this.current = { id: 1, scramble: '' };
        this.last = { id: 0, scramble: '' };
        this.nextScramble = '';
        this.socketAccounts = new Map();
        this.disconnectTimers = new Map();
        this.departedStats = new Map();
        this.lastRoundScoreSnapshot = new Map();
    }

    log(level, message, details = {}) {
        const logger = console?.[level] || console.log;
        logger(`[battle-worker] ${message}`, {
            roomId: this.roomId || '',
            ownerAccountId: this.ownerAccountId || '',
            playerCount: this.players.length,
            ...details,
        });
    }

    async fetch(request) {
        const url = new URL(request.url);
        const requestedRoomId = normalizeRoomId(decodeURIComponent(url.pathname.slice(1)));
        if (!isValidRoomId(requestedRoomId)) {
            return createJsonResponse({ error: 'Room id must be 3-32 characters using letters, numbers, "_" or "-".' }, 400);
        }
        this.roomId = this.roomId || requestedRoomId;
        this.sweepInactivePlayers();

        if (request.method === 'GET' && request.headers.get('Upgrade') !== 'websocket') {
            return createJsonResponse({
                roomId: this.roomId,
                exists: this.players.length > 0,
                roomInfo: this.players.length > 0 ? this.getRoomInfo() : null,
            });
        }

        if (request.method === 'POST' && request.headers.get('Upgrade') !== 'websocket') {
            let payload = null;
            try {
                payload = await readJsonPayload(request);
            } catch {
                return createJsonResponse({ error: 'Invalid JSON payload.' }, 400);
            }

            const action = String(payload?.action ?? '').trim().toLowerCase();
            if (action !== 'leave' && action !== 'disconnect') {
                return createJsonResponse({ error: 'Unsupported battle action.' }, 400);
            }

            const accountId = String(payload?.accountId ?? '').trim();
            const sessionId = String(payload?.sessionId ?? '').trim();
            const pageInstanceId = String(payload?.pageInstanceId ?? '').trim();
            const connectionId = String(payload?.connectionId ?? '').trim();
            const status = normalizeStatus(payload?.status);
            if (!accountId) {
                return createJsonResponse({ error: 'Account id is required.' }, 400);
            }
            if (!sessionId) {
                return createJsonResponse({ error: 'Session id is required.' }, 400);
            }
            if (!connectionId) {
                return createJsonResponse({ error: 'Connection id is required.' }, 400);
            }

            const player = this.getPlayer(accountId);
            if (!player || String(player.sessionId ?? '') !== sessionId) {
                this.log('warn', 'Rejected room action because the session id did not match the active player.', {
                    action,
                    accountId,
                    sessionId,
                    pageInstanceId,
                });
                return createJsonResponse({ error: 'Leave session is invalid.' }, 403);
            }
            if (String(player.pageInstanceId ?? '') && String(player.pageInstanceId ?? '') !== pageInstanceId) {
                this.log('warn', 'Rejected room action because the page instance id did not match the active player.', {
                    action,
                    accountId,
                    sessionId,
                    pageInstanceId,
                    activePageInstanceId: String(player.pageInstanceId ?? ''),
                });
                return createJsonResponse({ error: 'Leave page instance is invalid.' }, 403);
            }
            if (String(player.connectionId ?? '') !== connectionId) {
                this.log('warn', 'Rejected room action because the connection id did not match the active player.', {
                    action,
                    accountId,
                    sessionId,
                    pageInstanceId,
                    connectionId,
                    activeConnectionId: String(player.connectionId ?? ''),
                });
                return createJsonResponse({ error: 'Leave connection is stale.' }, 409);
            }

            this.log('info', 'Handling room action from HTTP endpoint.', {
                action,
                accountId,
                sessionId,
                pageInstanceId,
                connectionId,
                status,
            });
            const now = Date.now();
            let changed = this.applyPendingSolveFromTransport(accountId, payload?.pendingSolve, {
                source: `http_${action}`,
                now,
            });
            if (this.shouldApplyTransportStatus(payload, status, { source: `http_${action}` })) {
                changed = this.applyPlayerStatus(player, status, { source: `http_${action}` }) || changed;
            }
            const roomActionChanged = action === 'leave'
                ? this.leaveRoom(accountId, { reason: 'explicit_http_leave' })
                : this.disconnectPlayer(accountId, {
                    now,
                    closeSocket: true,
                    closeReason: 'Battle page disconnected.',
                    disconnectReason: 'page_disconnect_beacon',
                });
            changed = roomActionChanged || changed;
            if (changed) {
                this.broadcastRoomInfo();
            }
            return createJsonResponse({ ok: true, roomInfo: this.getRoomInfo() });
        }

        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected websocket upgrade.', { status: 426 });
        }

        const pair = new WebSocketPair();
        const [clientSocket, serverSocket] = Object.values(pair);

        serverSocket.accept();
        serverSocket.addEventListener('message', (event) => {
            void this.handleMessage(serverSocket, event.data);
        });
        serverSocket.addEventListener('close', (event) => {
            this.handleSocketClose(serverSocket, 'socket_close', event);
        });
        serverSocket.addEventListener('error', (event) => {
            this.handleSocketClose(serverSocket, 'socket_error', event);
        });

        return new Response(null, {
            status: 101,
            webSocket: clientSocket,
        });
    }

    handleSocketClose(socket, source = 'socket_close', event = null) {
        const accountId = this.socketAccounts.get(socket);
        this.socketAccounts.delete(socket);
        if (!accountId) return;
        this.log('warn', 'Socket disconnected from the worker.', {
            accountId,
            source,
            closeCode: Number.isFinite(Number(event?.code)) ? Number(event.code) : null,
            closeReason: String(event?.reason ?? ''),
        });
        if (this.disconnectPlayer(accountId, {
            socket,
            now: Date.now(),
            disconnectReason: source,
        })) {
            this.broadcastRoomInfo();
        }
    }

    async handleMessage(socket, rawData) {
        let message;
        try {
            message = JSON.parse(String(rawData ?? ''));
        } catch {
            this.reply(socket, null, false, { error: 'Invalid JSON payload.' });
            return;
        }

        const action = String(message?.action ?? '');
        const requestId = Number.isFinite(Number(message?.requestId)) ? Number(message.requestId) : null;
        if (action !== 'join') {
            this.touchBoundPlayer(socket);
        }
        this.sweepInactivePlayers();

        try {
            switch (action) {
                case 'join':
                    this.handleJoin(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'leave':
                    this.handleLeave(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'status':
                    this.handleStatus(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'solve':
                    this.handleSolve(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'deleteSolve':
                    this.handleDeleteSolve(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'updatePenalty':
                    this.handleUpdatePenalty(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'setScrambleType':
                    this.handleSetScrambleType(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'ping':
                    this.touchBoundPlayer(socket);
                    this.reply(socket, requestId, true);
                    return;
                default:
                    this.reply(socket, requestId, false, { error: 'Unknown battle action.' });
            }
        } catch (error) {
            const errorPayload = {
                error: error instanceof Error ? error.message : 'Battle action failed.',
            };
            if (action !== 'join') {
                errorPayload.roomInfo = this.getRoomInfo();
            }
            this.reply(socket, requestId, false, errorPayload);
        }
    }

    handleJoin(socket, message) {
        const now = Date.now();
        const accountId = String(message?.accountId ?? '').trim();
        const nickname = normalizeNickname(message?.nickname || accountId);
        const initialScramble = String(message?.initialScramble ?? '').trim();
        const scrambleType = normalizeScrambleType(message?.scrambleType);
        const sessionId = String(message?.sessionId ?? '').trim();
        const pageInstanceId = String(message?.pageInstanceId ?? '').trim();
        const connectionId = String(message?.connectionId ?? '').trim();
        const existingSocketAccountId = this.socketAccounts.get(socket);

        if (!accountId) {
            throw new Error('Account id is required.');
        }
        if (!nickname) {
            throw new Error('Nickname is required.');
        }
        if (!initialScramble && !this.current.scramble) {
            throw new Error('Initial scramble is required.');
        }
        if (!sessionId) {
            throw new Error(BATTLE_CLIENT_UPDATE_REQUIRED_MESSAGE);
        }
        if (!connectionId) {
            throw new Error(BATTLE_CLIENT_UPDATE_REQUIRED_MESSAGE);
        }
        if (existingSocketAccountId && existingSocketAccountId !== accountId) {
            throw new Error('This socket is already joined as a different player.');
        }

        let player = this.getPlayer(accountId);
        const isExistingPlayer = Boolean(player);
        if (!player) {
            if (this.players.length >= MAX_PLAYERS) {
                throw new Error('This room is full.');
            }

            const departed = this.departedStats.get(accountId);
            const departedStats = createPlayerStats(departed);
            player = {
                accountId,
                nickname,
                elo: departedStats.elo,
                wins: departedStats.wins,
                solveCount: departedStats.solveCount,
                meanTimeSum: departedStats.meanTimeSum,
                meanTimeCount: departedStats.meanTimeCount,
                status: STATUS.READY,
                connected: true,
                lastSeenAt: now,
                disconnectedAt: 0,
                sessionId,
                pageInstanceId: pageInstanceId || '',
                connectionId,
                socket,
            };
            this.departedStats.delete(accountId);
            this.players.push(player);
            if (!this.ownerAccountId) {
                this.ownerAccountId = accountId;
            }
        } else {
            ensurePlayerStats(player);

            const activeSessionId = String(player.sessionId ?? '');
            const activePageInstanceId = String(player.pageInstanceId ?? '');
            const isDifferentSession = Boolean(activeSessionId && activeSessionId !== sessionId);
            const isDifferentPageInstance = Boolean(activePageInstanceId && pageInstanceId && activePageInstanceId !== pageInstanceId);
            const isSameSessionPageInstanceRejoin = Boolean(!isDifferentSession && isDifferentPageInstance);
            if (isDifferentSession || isDifferentPageInstance) {
                const lastSeenAt = Number(player.lastSeenAt) || 0;
                const inactiveMs = lastSeenAt > 0 ? Math.max(0, now - lastSeenAt) : null;
                const canReclaimSession = isSameSessionPageInstanceRejoin || this.canReclaimPlayerSession(player, now);
                if (!canReclaimSession) {
                    this.log('warn', 'Rejected join because a different active page owns the player slot.', {
                        accountId,
                        sessionId,
                        activeSessionId,
                        pageInstanceId,
                        activePageInstanceId,
                        connectionId,
                        activeConnectionId: String(player.connectionId ?? ''),
                        connected: player.connected !== false,
                        inactiveMs,
                        reclaimInactiveMs: getSessionReclaimInactiveMs(player.status),
                        sameSessionPageInstanceRejoin: isSameSessionPageInstanceRejoin,
                    });
                    throw new Error('This player is already connected from another tab or device.');
                }

                this.log('warn', 'Reclaiming player slot from an inactive battle page.', {
                    accountId,
                    sessionId,
                    activeSessionId,
                    pageInstanceId,
                    activePageInstanceId,
                    connectionId,
                    activeConnectionId: String(player.connectionId ?? ''),
                    connected: player.connected !== false,
                    inactiveMs,
                    reclaimInactiveMs: getSessionReclaimInactiveMs(player.status),
                    sameSessionPageInstanceRejoin: isSameSessionPageInstanceRejoin,
                });
                this.cancelDisconnectRemoval(accountId);
                this.socketAccounts.forEach((mappedAccountId, mappedSocket) => {
                    if (mappedAccountId === accountId) {
                        this.socketAccounts.delete(mappedSocket);
                    }
                });
                if (player.socket && player.socket !== socket) {
                    try {
                        player.socket.close(SESSION_REPLACED_CLOSE_CODE, SESSION_REPLACED_CLOSE_REASON);
                    } catch {
                        // Ignore close failures on stale sockets.
                    }
                    player.socket = null;
                }
            }

            if (player.socket && player.socket !== socket) {
                this.log('warn', 'Replacing older socket for the same battle session.', {
                    accountId,
                    sessionId,
                    pageInstanceId,
                    connectionId,
                });
                this.socketAccounts.delete(player.socket);
                try {
                    player.socket.close(SESSION_REPLACED_CLOSE_CODE, SESSION_REPLACED_CLOSE_REASON);
                } catch {
                    // Ignore close failures on stale sockets.
                }
            }
        }

        const previousPageInstanceId = String(player.pageInstanceId ?? '');
        const activeAttemptRoundId = this.current.id;
        const wasActiveAttempt = isExistingPlayer
            && FORFEIT_ELIGIBLE_STATUS_SET.has(player.status)
            && !this.hasSolve(accountId, activeAttemptRoundId);
        const isNewPageInstanceRejoin = Boolean(
            previousPageInstanceId
            && pageInstanceId
            && previousPageInstanceId !== pageInstanceId
        );

        this.applyPendingSolveFromTransport(accountId, message?.pendingSolve, {
            source: 'websocket_join',
            now,
        });
        if (wasActiveAttempt
            && isNewPageInstanceRejoin
            && this.current.id === activeAttemptRoundId
            && !this.hasSolve(accountId, activeAttemptRoundId)) {
            // Battle rooms and ELO are ephemeral, so favor mobile/reload forgiveness over
            // treating an interrupted active attempt as a competitive forfeit.
            this.log('info', 'Resetting active battle attempt after rejoin from a new page instance.', {
                accountId,
                previousPageInstanceId,
                pageInstanceId,
                status: player.status,
                currentRoundId: activeAttemptRoundId,
            });
            player.status = STATUS.READY;
        }

        this.cancelDisconnectRemoval(accountId);
        player.nickname = nickname;
        player.sessionId = sessionId;
        player.pageInstanceId = pageInstanceId || String(player.pageInstanceId ?? '');
        player.connectionId = connectionId;
        player.socket = socket;
        player.connected = true;
        player.disconnectedAt = 0;
        player.lastSeenAt = now;

        const hasSolvedCurrent = this.solves.some(
            (s) => s.accountId === accountId && s.solveId === this.current.id
        );
        if (hasSolvedCurrent) {
            player.status = STATUS.SOLVED;
        } else if (!isExistingPlayer || !STATUS_SET.has(player.status)) {
            player.status = STATUS.READY;
        }

        this.socketAccounts.set(socket, accountId);

        if (!this.current.scramble) {
            this.current.scramble = initialScramble;
        }
        if (!this.players.length || !this.current.scramble || this.current.id === 1 && this.solves.length === 0 && this.players.length === 1) {
            this.scrambleType = scrambleType;
        } else if (!this.scrambleType) {
            this.scrambleType = scrambleType;
        }
    }

    disconnectPlayer(
        accountId,
        {
            socket = null,
            now = Date.now(),
            closeSocket = false,
            closeCode = 1000,
            closeReason = 'Battle connection closed.',
            disconnectReason = 'unspecified_disconnect',
        } = {},
    ) {
        const player = this.getPlayer(accountId);
        if (!player) return false;
        if (socket && player.socket !== socket) return false;
        const activeSocket = player.socket;
        const wasConnected = player.connected !== false || player.socket != null;

        if (!wasConnected) {
            if (!this.disconnectTimers.has(accountId)) {
                this.scheduleDisconnectRemoval(accountId, { disconnectReason });
            }
            this.log('info', 'Ignoring duplicate battle player disconnect.', {
                accountId,
                disconnectReason,
                status: player.status,
            });
            return false;
        }

        this.cancelDisconnectRemoval(accountId);
        this.socketAccounts.forEach((mappedAccountId, mappedSocket) => {
            if (mappedAccountId === accountId) {
                this.socketAccounts.delete(mappedSocket);
            }
        });

        player.socket = null;
        player.connected = false;
        player.disconnectedAt = now;
        player.lastSeenAt = Math.max(Number(player.lastSeenAt) || 0, now);
        this.log('warn', 'Marked battle player as disconnected.', {
            accountId,
            disconnectReason,
            closeSocket,
            closeCode,
            closeReason,
            status: player.status,
        });
        this.scheduleDisconnectRemoval(accountId, { disconnectReason });

        if (closeSocket && activeSocket) {
            try {
                activeSocket.close(closeCode, closeReason);
            } catch {
                // Ignore close failures on stale sockets.
            }
        }

        return wasConnected;
    }

    handleLeave(socket, message) {
        const accountId = this.requireBoundAccountId(socket);
        if (!accountId) return;
        const player = this.getPlayer(accountId);
        this.applyPendingSolveFromTransport(accountId, message?.pendingSolve, {
            source: 'websocket_leave',
            now: Date.now(),
        });
        if (this.shouldApplyTransportStatus(message, normalizeStatus(message?.status), { source: 'websocket_leave' })) {
            this.applyPlayerStatus(player, normalizeStatus(message?.status), { source: 'websocket_leave' });
        }
        this.socketAccounts.delete(socket);
        this.leaveRoom(accountId, { reason: 'explicit_websocket_leave' });
    }

    requireBoundAccountId(socket) {
        const accountId = String(this.socketAccounts.get(socket) ?? '').trim();
        if (!accountId) {
            throw new Error('Join the room before sending battle actions.');
        }
        const player = this.getPlayer(accountId);
        if (player) {
            this.touchPlayer(player);
        }
        return accountId;
    }

    touchBoundPlayer(socket) {
        const accountId = String(this.socketAccounts.get(socket) ?? '').trim();
        if (!accountId) return null;
        return this.touchPlayer(this.getPlayer(accountId));
    }

    canReclaimPlayerSession(player, now = Date.now()) {
        if (!player) return false;
        if (player.connected === false || !player.socket) return true;
        const lastSeenAt = Number(player.lastSeenAt) || 0;
        if (lastSeenAt <= 0) return false;
        return now - lastSeenAt > getSessionReclaimInactiveMs(player.status);
    }

    touchPlayer(player, now = Date.now()) {
        if (!player) return null;
        player.lastSeenAt = now;
        return player;
    }

    isPlayerStale(player, now = Date.now()) {
        if (!player || player.connected === false) return false;
        const lastSeenAt = Number(player.lastSeenAt) || 0;
        if (lastSeenAt <= 0) return false;
        return now - lastSeenAt > getStaleActivityMs(player.status);
    }

    sweepInactivePlayers(now = Date.now()) {
        let changed = false;
        [...this.players].forEach((player) => {
            if (!player || player.connected !== false) return;
            const disconnectedAt = Number(player.disconnectedAt) || 0;
            if (disconnectedAt <= 0 || now - disconnectedAt < getDisconnectGraceMs(player.status)) return;

            this.log('warn', 'Sweeping disconnected player after expired grace period.', {
                accountId: player.accountId,
                status: player.status,
                disconnectedAt,
                graceMs: getDisconnectGraceMs(player.status),
            });
            if (this.leaveRoom(player.accountId, { reason: 'grace_sweep' })) {
                changed = true;
            }
        });

        this.players.forEach((player) => {
            if (!player || player.connected === false) return;
            if (this.isPlayerStale(player, now)) {
                if (this.disconnectPlayer(player.accountId, {
                    now,
                    closeSocket: true,
                    closeReason: 'Battle connection became inactive.',
                    disconnectReason: 'stale_activity_timeout',
                })) {
                    changed = true;
                }
            }
        });
        if (changed) {
            this.broadcastRoomInfo();
        }
        return changed;
    }

    cancelDisconnectRemoval(accountId) {
        const entry = this.disconnectTimers.get(accountId);
        if (!entry) return;
        clearTimeout(entry.timeoutId);
        this.disconnectTimers.delete(accountId);
    }

    scheduleDisconnectRemoval(accountId, { disconnectReason = 'unspecified_disconnect' } = {}) {
        this.cancelDisconnectRemoval(accountId);
        const player = this.getPlayer(accountId);
        if (!player) return;
        const delay = getDisconnectGraceMs(player.status);
        const disconnectedAt = Number(player.disconnectedAt) || 0;
        const sessionId = String(player.sessionId ?? '');
        const pageInstanceId = String(player.pageInstanceId ?? '');
        const connectionId = String(player.connectionId ?? '');
        this.log('info', 'Scheduled disconnected player removal grace period.', {
            accountId,
            disconnectReason,
            status: player.status,
            delayMs: delay,
            disconnectedAt,
            sessionId,
            pageInstanceId,
            connectionId,
        });

        // Keep mobile/background users in the room briefly so transient closes
        // do not count as an immediate forfeit or round advancement.
        let timeoutId = null;
        const token = {
            disconnectedAt,
            sessionId,
            pageInstanceId,
            connectionId,
        };
        timeoutId = setTimeout(() => {
            const activeEntry = this.disconnectTimers.get(accountId);
            if (!activeEntry || activeEntry.timeoutId !== timeoutId) return;
            this.disconnectTimers.delete(accountId);

            const activePlayer = this.getPlayer(accountId);
            const isCurrentDisconnect = activePlayer
                && activePlayer.connected === false
                && Number(activePlayer.disconnectedAt) === token.disconnectedAt
                && String(activePlayer.sessionId ?? '') === token.sessionId
                && String(activePlayer.pageInstanceId ?? '') === token.pageInstanceId
                && String(activePlayer.connectionId ?? '') === token.connectionId;

            if (!isCurrentDisconnect) {
                this.log('info', 'Ignoring stale disconnect removal timer.', {
                    accountId,
                    disconnectReason,
                    delayMs: delay,
                    disconnectedAt: token.disconnectedAt,
                    sessionId: token.sessionId,
                    pageInstanceId: token.pageInstanceId,
                    connectionId: token.connectionId,
                });
                return;
            }

            this.log('warn', 'Disconnect grace period expired; removing player from room.', {
                accountId,
                disconnectReason,
                delayMs: delay,
                disconnectedAt: token.disconnectedAt,
                sessionId: token.sessionId,
                pageInstanceId: token.pageInstanceId,
                connectionId: token.connectionId,
            });
            if (this.leaveRoom(accountId, { reason: `grace_timeout:${disconnectReason}` })) {
                this.broadcastRoomInfo();
            }
        }, delay);

        this.disconnectTimers.set(accountId, {
            timeoutId,
            disconnectedAt,
            sessionId,
            pageInstanceId,
            connectionId,
            reason: disconnectReason,
        });
    }

    leaveRoom(accountId, { reason = 'unspecified_leave' } = {}) {
        const previousLength = this.players.length;
        const departingPlayer = this.getPlayer(accountId);
        if (departingPlayer) {
            this.recordForfeitSolve(accountId, { reason });
            this.log('info', 'Removing player from battle room.', {
                accountId,
                reason,
                connected: departingPlayer.connected !== false,
                status: departingPlayer.status,
            });
            ensurePlayerStats(departingPlayer);
            this.departedStats.set(accountId, {
                elo: departingPlayer.elo,
                wins: departingPlayer.wins,
                solveCount: departingPlayer.solveCount,
                meanTimeSum: departingPlayer.meanTimeSum,
                meanTimeCount: departingPlayer.meanTimeCount,
            });

            // Prevent indefinite memory leak if the room stays active indefinitely
            if (this.departedStats.size > 50) {
                const oldestKey = this.departedStats.keys().next().value;
                this.departedStats.delete(oldestKey);
            }
        }
        this.cancelDisconnectRemoval(accountId);
        this.socketAccounts.forEach((mappedAccountId, mappedSocket) => {
            if (mappedAccountId === accountId) {
                this.socketAccounts.delete(mappedSocket);
            }
        });
        this.players = this.players.filter((player) => player.accountId !== accountId);
        if (this.players.length === previousLength) return false;

        if (this.players.length === 0) {
            this.resetRoom();
            return true;
        }
        if (this.ownerAccountId === accountId) {
            this.ownerAccountId = this.players[0]?.accountId || '';
        }
        this.maybeAdvanceRound();
        return true;
    }

    hasSolve(accountId, solveId = this.current.id) {
        return this.solves.some((solve) => solve.accountId === accountId && solve.solveId === solveId);
    }

    getSolve(accountId, solveId = this.current.id) {
        return this.solves.find((solve) => solve.accountId === accountId && solve.solveId === solveId) || null;
    }

    wouldCompleteCurrentRoundWithSolve(accountId) {
        if (this.players.length === 0) return false;
        return this.players.every((player) => (
            player.accountId === accountId
            || this.hasSolve(player.accountId, this.current.id)
        ));
    }

    restoreLastRoundScoreSnapshot() {
        this.lastRoundScoreSnapshot.forEach((snapshot, id) => {
            const stats = this.getPlayer(id) || this.departedStats.get(id);
            if (stats) {
                stats.elo = snapshot.elo;
                stats.wins = snapshot.wins;
            }
        });
    }

    canRollbackLastRoundAfterSolveDelete(solveId) {
        return Number(solveId) === Number(this.last.id)
            && Number(this.current.id) === Number(solveId) + 1
            && !this.solves.some((solve) => solve.solveId === this.current.id)
            && this.players.every((player) => player.status === STATUS.READY);
    }

    rollbackLastRoundAfterSolveDelete(solveId) {
        const nextRoundScramble = String(this.current.scramble ?? '').trim();
        this.current = { ...this.last };
        this.last = {
            id: Math.max(0, Number(solveId) - 1),
            scramble: '',
        };
        this.nextScramble = nextRoundScramble;
        this.lastRoundScoreSnapshot = new Map();
        this.players.forEach((player) => {
            player.status = this.hasSolve(player.accountId, this.current.id)
                ? STATUS.SOLVED
                : STATUS.READY;
        });
        this.log('info', 'Rolled battle room back after deleting a just-submitted solve.', {
            solveId,
            restoredCurrentRoundId: this.current.id,
        });
    }

    recordForfeitSolve(accountId, { reason = 'unspecified_forfeit', now = Date.now() } = {}) {
        const player = this.getPlayer(accountId);
        if (!player || !this.current.scramble || this.hasSolve(accountId, this.current.id)) return false;
        if (!FORFEIT_ELIGIBLE_STATUS_SET.has(player.status)) return false;

        const solve = {
            accountId,
            solveId: this.current.id,
            timeMs: 0,
            penalty: 'DNF',
            localTimestamp: 0,
            submittedAt: now,
            origin: SOLVE_ORIGIN.FORFEIT,
        };

        this.solves.push(solve);
        applySolveToPlayerStats(player, solve, 1);
        player.status = STATUS.SOLVED;
        this.log('warn', 'Recorded battle forfeit as DNF.', {
            accountId,
            reason,
            solveId: solve.solveId,
        });
        return true;
    }

    shouldApplyTransportStatus(payload, status, { source = 'unspecified_status_transport' } = {}) {
        if (!status) return false;
        const statusRoundId = normalizeRoundNumber(payload?.statusRoundId);
        if (statusRoundId != null && statusRoundId !== this.current.id) {
            this.log('info', 'Ignored stale battle status from transport boundary.', {
                source,
                status,
                statusRoundId,
                currentRoundId: this.current.id,
            });
            return false;
        }
        return true;
    }

    applyPlayerStatus(player, status, { source = 'unspecified_status_update' } = {}) {
        if (!player || !status) return false;
        if (status === STATUS.SOLVED && !this.hasSolve(player.accountId, this.current.id)) return false;
        if (player.status === STATUS.SOLVED && status !== STATUS.SOLVED) return false;
        if (player.status === status) return false;
        if (STATUS_PROGRESS_RANK[status] < STATUS_PROGRESS_RANK[player.status]
            && !isAllowedStatusRegression(status, player.status)) {
            this.log('info', 'Ignored battle status regression for current round.', {
                accountId: player.accountId,
                previousStatus: player.status,
                status,
                source,
                currentRoundId: this.current.id,
            });
            return false;
        }

        this.log('info', 'Applied battle player status from transport boundary.', {
            accountId: player.accountId,
            previousStatus: player.status,
            status,
            source,
        });
        player.status = status;
        return true;
    }

    applyPendingSolveFromTransport(accountId, pendingSolve, { source = 'unspecified_pending_solve', now = Date.now() } = {}) {
        if (!pendingSolve || typeof pendingSolve !== 'object') return false;
        try {
            this.recordSolve(accountId, pendingSolve, { source, now });
            return true;
        } catch (error) {
            this.log('warn', 'Failed to apply pending battle solve from transport boundary.', {
                accountId,
                source,
                currentRoundId: this.current.id,
                solveId: Number(pendingSolve?.solveId) || null,
                error: error instanceof Error ? error.message : String(error ?? ''),
            });
            return false;
        }
    }

    recordSolve(accountId, message, { source = 'websocket_solve', now = Date.now() } = {}) {
        const solveId = Number(message?.solveId);
        const timeMs = Number.isFinite(Number(message?.timeMs)) ? Math.max(0, Math.round(Number(message.timeMs))) : null;
        const penalty = message?.penalty === '+2' || message?.penalty === 'DNF' ? message.penalty : null;
        const roundScramble = String(message?.roundScramble ?? '').trim();
        const nextScramble = String(message?.nextScramble ?? '').trim();
        const player = this.getPlayer(accountId);

        if (!player) {
            throw new Error('Player not found in this room.');
        }
        if (!Number.isFinite(solveId)) {
            throw new Error('Solve id does not match the current round.');
        }
        if (timeMs == null) {
            throw new Error('Solve time is required.');
        }
        const existingIndex = this.solves.findIndex((entry) => (
            entry.accountId === accountId && entry.solveId === solveId
        ));
        const existingSolve = existingIndex >= 0 ? this.solves[existingIndex] : null;
        const existingOrigin = existingSolve?.origin === SOLVE_ORIGIN.FORFEIT
            ? SOLVE_ORIGIN.FORFEIT
            : SOLVE_ORIGIN.CLIENT;
        const isCurrentRoundSolve = solveId === this.current.id;
        const isLastRoundLateSolve = !isCurrentRoundSolve && solveId === this.last.id;
        if (!isCurrentRoundSolve && !isLastRoundLateSolve) {
            throw new Error('Solve id does not match the current round.');
        }
        const expectedScramble = isCurrentRoundSolve
            ? String(this.current.scramble ?? '').trim()
            : String(this.last.scramble ?? '').trim();
        if (isLastRoundLateSolve && (!roundScramble || !expectedScramble || roundScramble !== expectedScramble)) {
            throw new Error('Solve scramble does not match the battle round.');
        }
        if (roundScramble && expectedScramble && roundScramble !== expectedScramble) {
            throw new Error('Solve scramble does not match the battle round.');
        }
        if (isCurrentRoundSolve && !this.nextScramble && !nextScramble) {
            throw new Error('Next scramble is required before the battle round can advance.');
        }

        const solve = {
            accountId,
            solveId,
            timeMs,
            penalty,
            localTimestamp: Number(message?.localTimestamp) || 0,
            submittedAt: now,
            origin: SOLVE_ORIGIN.CLIENT,
        };

        if (existingIndex >= 0) {
            const isCasualForfeitRecovery = existingOrigin === SOLVE_ORIGIN.FORFEIT;
            const isIdempotentClientRetry = existingOrigin === SOLVE_ORIGIN.CLIENT
                && (
                    !existingSolve.localTimestamp
                    || !solve.localTimestamp
                    || existingSolve.localTimestamp === solve.localTimestamp
                );
            if (!isCasualForfeitRecovery && !isIdempotentClientRetry) {
                throw new Error('Solve already submitted for this round.');
            }
            if (isCasualForfeitRecovery) {
                this.log('info', 'Replacing battle forfeit with late client solve under casual policy.', {
                    accountId,
                    source,
                    solveId,
                    previousSubmittedAt: existingSolve.submittedAt,
                });
            }

            applySolveToPlayerStats(player, existingSolve, -1);
            this.solves.splice(existingIndex, 1, solve);
        } else {
            this.solves.push(solve);
        }
        applySolveToPlayerStats(player, solve, 1);

        if (isCurrentRoundSolve) {
            player.status = STATUS.SOLVED;
        }
        player.lastSeenAt = now;
        if (isCurrentRoundSolve && !this.nextScramble && nextScramble) {
            this.nextScramble = nextScramble;
        }

        this.log('info', 'Recorded battle solve.', {
            accountId,
            source,
            solveId,
            penalty,
        });
        if (isCurrentRoundSolve) {
            this.maybeAdvanceRound();
        } else if (isLastRoundLateSolve) {
            if (this.lastRoundScoreSnapshot.size > 0) {
                this.lastRoundScoreSnapshot.forEach((snapshot, id) => {
                    const stats = this.getPlayer(id) || this.departedStats.get(id);
                    if (stats) {
                        stats.elo = snapshot.elo;
                        stats.wins = snapshot.wins;
                    }
                });
            }
            this.updateScoresForRound(solveId);
        }
        return solve;
    }

    handleStatus(socket, message) {
        const accountId = this.requireBoundAccountId(socket);
        const status = normalizeStatus(message?.status);
        const player = this.getPlayer(accountId);

        if (!player) {
            throw new Error('Player not found in this room.');
        }
        if (!status) {
            throw new Error('Unsupported battle status.');
        }

        if (this.shouldApplyTransportStatus(message, status, { source: 'websocket_status' })) {
            this.applyPlayerStatus(player, status, { source: 'websocket_status' });
        }
        player.socket = socket;
    }

    handleSolve(socket, message) {
        const accountId = this.requireBoundAccountId(socket);
        this.recordSolve(accountId, message, { source: 'websocket_solve' });
        const player = this.getPlayer(accountId);
        if (player) {
            player.socket = socket;
        }
    }

    handleDeleteSolve(socket, message) {
        const accountId = this.requireBoundAccountId(socket);
        const solveId = normalizeRoundNumber(message?.solveId);
        const localTimestamp = Number(message?.localTimestamp) || 0;

        if (!solveId || (solveId !== this.current.id && solveId !== this.last.id)) {
            throw new Error('Can only delete battle solves for the current or last round.');
        }

        const existingIndex = this.solves.findIndex((solve) => (
            solve.accountId === accountId && solve.solveId === solveId
        ));
        if (existingIndex < 0) {
            this.log('info', 'Ignored battle solve delete because the solve was not present.', {
                accountId,
                solveId,
                localTimestamp,
            });
            return;
        }

        const solve = this.solves[existingIndex];
        if (solve.origin === SOLVE_ORIGIN.FORFEIT) {
            throw new Error('Cannot delete a server-created battle forfeit.');
        }
        if (localTimestamp && Number(solve.localTimestamp) !== localTimestamp) {
            throw new Error('Battle solve delete did not match the submitted solve.');
        }

        const hadLastRoundScoreSnapshot = this.lastRoundScoreSnapshot.size > 0;
        const stats = this.getPlayer(accountId) || this.departedStats.get(accountId);
        if (stats) {
            applySolveToPlayerStats(stats, solve, -1);
        }
        this.solves.splice(existingIndex, 1);
        const shouldRollbackLastRound = this.canRollbackLastRoundAfterSolveDelete(solveId);

        if (solveId === this.last.id && hadLastRoundScoreSnapshot) {
            this.restoreLastRoundScoreSnapshot();
        }
        if (shouldRollbackLastRound) {
            this.rollbackLastRoundAfterSolveDelete(solveId);
        } else {
            const player = this.getPlayer(accountId);
            if (player && solveId === this.current.id && !this.hasSolve(accountId, this.current.id)) {
                player.status = STATUS.READY;
            }
        }

        if (!shouldRollbackLastRound && solveId === this.last.id && hadLastRoundScoreSnapshot) {
            this.updateScoresForRound(solveId);
        }

        this.log('info', 'Deleted battle solve after local pending solve removal.', {
            accountId,
            solveId,
            localTimestamp,
        });
    }

    handleUpdatePenalty(socket, message) {
        const accountId = this.requireBoundAccountId(socket);
        const solveId = Number(message?.solveId);
        const penalty = message?.penalty === '+2' || message?.penalty === 'DNF' ? message.penalty : null;
        const player = this.getPlayer(accountId);

        if (!player) {
            throw new Error('Player not found in this room.');
        }
        if (!Number.isFinite(solveId) || (solveId !== this.current.id && solveId !== this.last.id)) {
            throw new Error('Can only update penalties for the current or last round.');
        }

        const solve = this.solves.find((s) => s.accountId === accountId && s.solveId === solveId);
        if (!solve) {
            throw new Error('Solve not found.');
        }

        applySolveToPlayerStats(player, solve, -1);
        solve.penalty = penalty;
        applySolveToPlayerStats(player, solve, 1);

        // If the solve belongs to the already-scored last round, recalculate.
        if (solveId === this.last.id && this.lastRoundScoreSnapshot.size > 0) {
            // Restore pre-round scores from the snapshot.
            this.lastRoundScoreSnapshot.forEach((snapshot, id) => {
                const stats = this.getPlayer(id) || this.departedStats.get(id);
                if (stats) {
                    stats.elo = snapshot.elo;
                    stats.wins = snapshot.wins;
                }
            });
            // Recalculate with the corrected penalty.
            this.updateScoresForRound(solveId);
        }
    }

    handleSetScrambleType(socket, message) {
        const accountId = this.requireBoundAccountId(socket);
        const scrambleType = normalizeScrambleType(message?.scrambleType);
        const scramble = String(message?.scramble ?? '').trim();

        if (!accountId || accountId !== this.ownerAccountId) {
            throw new Error('Only the room owner can change the scramble type.');
        }
        if (!scramble) {
            throw new Error('A new scramble is required when changing the scramble type.');
        }

        this.scrambleType = scrambleType;
        this.last = { ...this.current };
        this.current = {
            id: this.current.id + 1,
            scramble,
        };
        this.nextScramble = '';
        this.lastRoundScoreSnapshot.clear();
        this.solves = this.solves.filter((solve) => solve.solveId >= this.current.id - 5);
        this.players.forEach((player) => {
            player.status = STATUS.READY;
        });
    }

    maybeAdvanceRound() {
        if (this.players.length === 0) return;
        if (!this.players.every((player) => player.status === STATUS.SOLVED)) return;
        if (!this.nextScramble) {
            this.log('warn', 'Refusing to advance battle round without a next scramble.', {
                completedRoundId: this.current.id,
            });
            return;
        }

        const completedRoundId = this.current.id;
        this.updateScoresForRound(completedRoundId);

        this.last = { ...this.current };
        this.current = {
            id: completedRoundId + 1,
            scramble: this.nextScramble,
        };
        this.nextScramble = '';

        this.solves = this.solves.filter((solve) => solve.solveId >= this.current.id - 5);
        this.players.forEach((player) => {
            player.status = STATUS.READY;
        });
    }

    updateScoresForRound(roundId) {
        const roundSolves = this.solves
            .filter((solve) => solve.solveId === roundId)
            .sort(compareSolveTimes);

        this.lastRoundScoreSnapshot = new Map();
        if (roundSolves.length <= 1) return;

        // Snapshot pre-scoring state so penalties can trigger recalculation later.
        const getStatsObj = (accountId) => {
            return ensurePlayerStats(this.getPlayer(accountId) || this.departedStats.get(accountId) || null);
        };

        roundSolves.forEach((solve) => {
            const stats = getStatsObj(solve.accountId);
            if (stats) {
                this.lastRoundScoreSnapshot.set(solve.accountId, { elo: stats.elo, wins: stats.wins });
            }
        });

        const bestSolve = roundSolves[0];
        const lastSolve = roundSolves[roundSolves.length - 1];

        const baseRatings = new Map(roundSolves.map((solve) => {
            const stats = getStatsObj(solve.accountId);
            return [solve.accountId, stats ? stats.elo : 1000];
        }));

        roundSolves.forEach((solve, index) => {
            const statsObj = getStatsObj(solve.accountId);
            if (!statsObj) return;

            const tiedForBest = compareSolveTimes(solve, bestSolve) === 0;
            const isNonTrivialWin = compareSolveTimes(bestSolve, lastSolve) !== 0;
            if (tiedForBest && isNonTrivialWin) {
                statsObj.wins += 1;
            }

            let eloDelta = 0;
            roundSolves.forEach((otherSolve, otherIndex) => {
                if (index === otherIndex) return;
                const otherStatsObj = getStatsObj(otherSolve.accountId);
                if (!otherStatsObj) return;

                const score = (compareSolveTimes(otherSolve, solve) + 1) / 2;
                const expected = 1 / (1 + Math.pow(10, (baseRatings.get(otherSolve.accountId) - baseRatings.get(solve.accountId)) / 400));
                eloDelta += Math.round((score - expected) * 32 / (roundSolves.length - 1));
            });
            statsObj.elo += eloDelta;
        });
    }

    getPlayer(accountId) {
        return this.players.find((player) => player.accountId === accountId) || null;
    }

    resetRoom() {
        this.ownerAccountId = '';
        this.scrambleType = '333';
        this.players = [];
        this.solves = [];
        this.current = { id: 1, scramble: '' };
        this.last = { id: 0, scramble: '' };
        this.nextScramble = '';
        this.disconnectTimers.forEach((entry) => clearTimeout(entry.timeoutId));
        this.disconnectTimers.clear();
        this.departedStats.clear();
        this.lastRoundScoreSnapshot = new Map();
    }

    getRoomInfo() {
        return {
            roomId: this.roomId,
            ownerAccountId: this.ownerAccountId,
            scrambleType: this.scrambleType,
            current: { ...this.current },
            last: { ...this.last },
            players: this.players.map((player) => {
                ensurePlayerStats(player);
                return {
                    accountId: player.accountId,
                    nickname: player.nickname,
                    elo: player.elo,
                    wins: player.wins,
                    solveCount: player.solveCount,
                    meanTimeMs: player.meanTimeCount > 0
                        ? Math.round(player.meanTimeSum / player.meanTimeCount)
                        : null,
                    meanTimeSum: player.meanTimeSum,
                    meanTimeCount: player.meanTimeCount,
                    status: player.status,
                    connected: player.connected !== false,
                };
            }),
            solves: this.solves.map(cloneSolve),
        };
    }

    reply(socket, requestId, ok, payload = {}) {
        this.sendJson(socket, {
            requestId,
            ok,
            ...payload,
        }, { type: 'reply', requestId });
    }

    broadcastRoomInfo() {
        const message = JSON.stringify({
            type: 'roomInfo',
            roomInfo: this.getRoomInfo(),
        });

        this.players.forEach((player) => {
            if (!player.socket) return;
            try {
                player.socket.send(message);
            } catch (error) {
                this.log('warn', 'Failed to send battle websocket message.', {
                    type: 'broadcast',
                    accountId: player.accountId,
                    error: error instanceof Error ? error.message : String(error ?? ''),
                });
            }
        });
    }

    sendJson(socket, payload, context = {}) {
        if (!socket) return false;
        try {
            socket.send(JSON.stringify(payload));
            return true;
        } catch (error) {
            this.log('warn', 'Failed to send battle websocket message.', {
                ...context,
                error: error instanceof Error ? error.message : String(error ?? ''),
            });
            return false;
        }
    }
}
