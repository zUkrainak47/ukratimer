const STATUS = Object.freeze({
    READY: 'READY',
    INSPECTING: 'INSPECTING',
    SOLVING: 'SOLVING',
    SOLVED: 'SOLVED',
});

const STATUS_SET = new Set(Object.values(STATUS));
const MAX_PLAYERS = 8;
const SCRAMBLE_TYPE_PATTERN = /^[a-z0-9_-]{2,24}$/i;

function normalizeRoomId(value) {
    return String(value ?? '').trim();
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

function cloneSolve(solve) {
    return {
        accountId: solve.accountId,
        solveId: solve.solveId,
        timeMs: solve.timeMs,
        penalty: solve.penalty,
        submittedAt: solve.submittedAt,
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const roomMatch = url.pathname.match(/^\/battle\/([^/]+)$/);
        if (!roomMatch) {
            return new Response('Not found.', { status: 404 });
        }

        const roomId = normalizeRoomId(decodeURIComponent(roomMatch[1]));
        if (!roomId) {
            return new Response('Room id is required.', { status: 400 });
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
        this.departedStats = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);
        this.roomId = this.roomId || normalizeRoomId(decodeURIComponent(url.pathname.slice(1)));

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
                payload = await request.json();
            } catch {
                return createJsonResponse({ error: 'Invalid JSON payload.' }, 400);
            }

            if (String(payload?.action ?? '') !== 'leave') {
                return createJsonResponse({ error: 'Unsupported battle action.' }, 400);
            }

            const accountId = String(payload?.accountId ?? '').trim();
            if (!accountId) {
                return createJsonResponse({ error: 'Account id is required.' }, 400);
            }

            if (this.leaveRoom(accountId)) {
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
        serverSocket.addEventListener('close', () => {
            this.handleSocketClose(serverSocket);
        });
        serverSocket.addEventListener('error', () => {
            this.handleSocketClose(serverSocket);
        });

        return new Response(null, {
            status: 101,
            webSocket: clientSocket,
        });
    }

    handleSocketClose(socket) {
        const accountId = this.socketAccounts.get(socket);
        this.socketAccounts.delete(socket);
        if (!accountId) return;
        if (this.leaveRoom(accountId)) {
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
                case 'setScrambleType':
                    this.handleSetScrambleType(socket, message);
                    this.reply(socket, requestId, true, { roomInfo: this.getRoomInfo() });
                    this.broadcastRoomInfo();
                    return;
                case 'ping':
                    this.reply(socket, requestId, true);
                    return;
                default:
                    this.reply(socket, requestId, false, { error: 'Unknown battle action.' });
            }
        } catch (error) {
            this.reply(socket, requestId, false, {
                error: error instanceof Error ? error.message : 'Battle action failed.',
            });
        }
    }

    handleJoin(socket, message) {
        const accountId = String(message?.accountId ?? '').trim();
        const nickname = normalizeNickname(message?.nickname || accountId);
        const initialScramble = String(message?.initialScramble ?? '').trim();
        const scrambleType = normalizeScrambleType(message?.scrambleType);

        if (!accountId) {
            throw new Error('Account id is required.');
        }
        if (!nickname) {
            throw new Error('Nickname is required.');
        }
        if (!initialScramble && !this.current.scramble) {
            throw new Error('Initial scramble is required.');
        }

        let player = this.getPlayer(accountId);
        if (!player) {
            if (this.players.length >= MAX_PLAYERS) {
                throw new Error('This room is full.');
            }

            const departed = this.departedStats.get(accountId);
            player = {
                accountId,
                nickname,
                elo: departed?.elo ?? 1000,
                wins: departed?.wins ?? 0,
                status: STATUS.READY,
                socket,
            };
            this.departedStats.delete(accountId);
            this.players.push(player);
            if (!this.ownerAccountId) {
                this.ownerAccountId = accountId;
            }
        } else if (player.socket && player.socket !== socket) {
            this.socketAccounts.delete(player.socket);
            try {
                player.socket.close(1000, 'Replaced by a newer connection.');
            } catch {
                // Ignore close failures on stale sockets.
            }
        }

        player.nickname = nickname;
        player.socket = socket;
        
        const hasSolvedCurrent = this.solves.some(
            (s) => s.accountId === accountId && s.solveId === this.current.id
        );
        player.status = hasSolvedCurrent ? STATUS.SOLVED : STATUS.READY;

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

    handleLeave(socket, message) {
        const accountId = String(message?.accountId ?? this.socketAccounts.get(socket) ?? '').trim();
        if (!accountId) return;
        this.socketAccounts.delete(socket);
        this.leaveRoom(accountId);
    }

    leaveRoom(accountId) {
        const previousLength = this.players.length;
        const departingPlayer = this.getPlayer(accountId);
        if (departingPlayer) {
            this.departedStats.set(accountId, {
                elo: departingPlayer.elo,
                wins: departingPlayer.wins,
            });

            // Prevent indefinite memory leak if the room stays active indefinitely
            if (this.departedStats.size > 50) {
                const oldestKey = this.departedStats.keys().next().value;
                this.departedStats.delete(oldestKey);
            }
        }
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

    handleStatus(socket, message) {
        const accountId = String(message?.accountId ?? this.socketAccounts.get(socket) ?? '').trim();
        const status = String(message?.status ?? '').trim().toUpperCase();
        const player = this.getPlayer(accountId);

        if (!player) {
            throw new Error('Player not found in this room.');
        }
        if (!STATUS_SET.has(status)) {
            throw new Error('Unsupported battle status.');
        }
        if (player.status === STATUS.SOLVED && status !== STATUS.SOLVED) {
            return;
        }

        player.status = status;
        player.socket = socket;
    }

    handleSolve(socket, message) {
        const accountId = String(message?.accountId ?? this.socketAccounts.get(socket) ?? '').trim();
        const solveId = Number(message?.solveId);
        const timeMs = Number.isFinite(Number(message?.timeMs)) ? Math.max(0, Math.round(Number(message.timeMs))) : null;
        const penalty = message?.penalty === '+2' || message?.penalty === 'DNF' ? message.penalty : null;
        const nextScramble = String(message?.nextScramble ?? '').trim();
        const player = this.getPlayer(accountId);

        if (!player) {
            throw new Error('Player not found in this room.');
        }
        if (!Number.isFinite(solveId) || solveId !== this.current.id) {
            throw new Error('Solve id does not match the current round.');
        }
        if (timeMs == null) {
            throw new Error('Solve time is required.');
        }

        const solve = {
            accountId,
            solveId,
            timeMs,
            penalty,
            submittedAt: Date.now(),
        };

        const existingIndex = this.solves.findIndex((entry) => (
            entry.accountId === accountId && entry.solveId === solveId
        ));
        if (existingIndex >= 0) {
            this.solves.splice(existingIndex, 1, solve);
        } else {
            this.solves.push(solve);
        }

        player.status = STATUS.SOLVED;
        player.socket = socket;
        if (!this.nextScramble && nextScramble) {
            this.nextScramble = nextScramble;
        }

        this.maybeAdvanceRound();
    }

    handleSetScrambleType(socket, message) {
        const accountId = String(message?.accountId ?? this.socketAccounts.get(socket) ?? '').trim();
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
        this.solves = this.solves.filter((solve) => solve.solveId >= this.current.id - 5);
        this.players.forEach((player) => {
            player.status = STATUS.READY;
        });
    }

    maybeAdvanceRound() {
        if (this.players.length === 0) return;
        if (!this.players.every((player) => player.status === STATUS.SOLVED)) return;

        const completedRoundId = this.current.id;
        this.updateScoresForRound(completedRoundId);

        this.last = { ...this.current };
        this.current = {
            id: completedRoundId + 1,
            scramble: this.nextScramble || this.current.scramble,
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

        if (roundSolves.length <= 1) return;

        const bestSolve = roundSolves[0];
        const lastSolve = roundSolves[roundSolves.length - 1];
        
        const getStatsObj = (accountId) => {
            return this.getPlayer(accountId) || this.departedStats.get(accountId) || null;
        };

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
    }

    getRoomInfo() {
        return {
            roomId: this.roomId,
            ownerAccountId: this.ownerAccountId,
            scrambleType: this.scrambleType,
            current: { ...this.current },
            last: { ...this.last },
            players: this.players.map((player) => ({
                accountId: player.accountId,
                nickname: player.nickname,
                elo: player.elo,
                wins: player.wins,
                status: player.status,
            })),
            solves: this.solves.map(cloneSolve),
        };
    }

    reply(socket, requestId, ok, payload = {}) {
        socket.send(JSON.stringify({
            requestId,
            ok,
            ...payload,
        }));
    }

    broadcastRoomInfo() {
        const message = JSON.stringify({
            type: 'roomInfo',
            roomInfo: this.getRoomInfo(),
        });

        this.players.forEach((player) => {
            try {
                player.socket?.send(message);
            } catch {
                // Ignore delivery errors; the close event will prune dead sockets.
            }
        });
    }
}
