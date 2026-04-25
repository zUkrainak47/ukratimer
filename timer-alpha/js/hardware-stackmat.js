import { EventEmitter } from './utils.js?v=2026042504';

const THRESHOLD_SCHMITT = 0.2;
const THRESHOLD_EDGE = 0.7;
const IDLE_PACKET_HEADERS = /[ SILRCA]/;
const DIGIT_HEADER = /[0-9]/;

const DEFAULT_STATE = Object.freeze({
    timeMs: 0,
    unit: 10,
    on: false,
    greenLight: false,
    leftHand: false,
    rightHand: false,
    running: false,
    unknownRunning: true,
    signalHeader: 'I',
    noise: 1,
    power: 1,
});

function cloneState(state) {
    return {
        timeMs: state.timeMs,
        unit: state.unit,
        on: state.on,
        greenLight: state.greenLight,
        leftHand: state.leftHand,
        rightHand: state.rightHand,
        running: state.running,
        unknownRunning: state.unknownRunning,
        signalHeader: state.signalHeader,
        noise: state.noise,
        power: state.power,
    };
}

function ensureGetUserMedia() {
    if (navigator.mediaDevices?.getUserMedia) return;

    if (navigator.mediaDevices === undefined) {
        navigator.mediaDevices = {};
    }

    navigator.mediaDevices.getUserMedia = (constraints) => {
        const getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
        if (!getUserMedia) {
            return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
        }
        return new Promise((resolve, reject) => {
            getUserMedia.call(navigator, constraints, resolve, reject);
        });
    };
}

export class StackmatInput extends EventEmitter {
    constructor() {
        super();
        this._audioContext = null;
        this._stream = null;
        this._source = null;
        this._processor = null;
        this._sampleRate = 0;
        this._agcFactor = 0.0001;
        this._lastPower = 1;
        this._lastValues = [];
        this._lastSignalBit = 0;
        this._voltageHoldLength = 0;
        this._distortion = 0;
        this._bitBuffer = [];
        this._byteBuffer = [];
        this._idleBit = 0;
        this._lastBit = 0;
        this._lastBitLength = 0;
        this._noStateLength = 0;
        this._state = cloneState(DEFAULT_STATE);
    }

    async listInputDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) return [];
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter((device) => device.kind === 'audioinput')
            .map((device, index) => ({
                id: device.deviceId,
                label: device.label || `Microphone ${index + 1}`,
            }));
    }

    getState() {
        return cloneState(this._state);
    }

    isConnected() {
        return Boolean(this._stream);
    }

    async connect({ deviceId } = {}) {
        ensureGetUserMedia();

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
            throw new Error('Web Audio is not supported in this browser.');
        }

        if (!this._audioContext) {
            this._audioContext = new AudioContextCtor();
        }

        if (this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
        }

        this._resetDecoder();

        const audioConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
        };
        if (deviceId) {
            audioConstraints.deviceId = { exact: deviceId };
        }

        if (this._stream) {
            this.disconnect();
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        this._attachStream(stream);
        this.emit('connected');
        return this.getState();
    }

    disconnect() {
        if (this._source && this._processor) {
            try {
                this._source.disconnect(this._processor);
            } catch {
            }
        }

        if (this._processor && this._audioContext) {
            try {
                this._processor.disconnect(this._audioContext.destination);
            } catch {
            }
        }

        if (this._stream) {
            this._stream.getTracks().forEach((track) => track.stop());
        }

        this._source = null;
        this._processor = null;
        this._stream = null;

        const nextState = cloneState(this._state);
        nextState.on = false;
        nextState.running = false;
        nextState.leftHand = false;
        nextState.rightHand = false;
        nextState.greenLight = false;
        nextState.unknownRunning = true;
        this._state = nextState;
        this.emit('packet', this.getState());
        this.emit('disconnected');
    }

    _attachStream(stream) {
        this._stream = stream;
        this._sampleRate = this._audioContext.sampleRate / 1200;
        this._agcFactor = 0.001 / this._sampleRate;
        this._lastValues.length = Math.ceil(this._sampleRate / 6);
        this._lastValues.fill(0);

        this._source = this._audioContext.createMediaStreamSource(stream);
        this._processor = this._audioContext.createScriptProcessor(1024, 1, 1);
        this._processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            for (let i = 0; i < input.length; i += 1) {
                const power = input[i] * input[i];
                this._lastPower = Math.max(0.0001, this._lastPower + (power - this._lastPower) * this._agcFactor);
                const gain = 1 / Math.sqrt(this._lastPower);
                this._processSignal(input[i] * gain);
            }
        };

        this._source.connect(this._processor);
        this._processor.connect(this._audioContext.destination);
    }

    _resetDecoder() {
        this._lastPower = 1;
        this._lastSignalBit = 0;
        this._voltageHoldLength = 0;
        this._distortion = 0;
        this._bitBuffer = [];
        this._byteBuffer = [];
        this._idleBit = 0;
        this._lastBit = 0;
        this._lastBitLength = 0;
        this._noStateLength = 0;
        this._state = cloneState(DEFAULT_STATE);
    }

    _processSignal(signal) {
        this._lastValues.unshift(signal);
        const dropped = this._lastValues.pop() ?? 0;

        const isEdge = (dropped - signal) * (this._lastSignalBit ? 1 : -1) > THRESHOLD_EDGE
            && Math.abs(signal - (this._lastSignalBit ? 1 : -1)) - 1 > THRESHOLD_SCHMITT
            && this._voltageHoldLength > this._sampleRate * 0.6;

        if (isEdge) {
            for (let i = 0; i < Math.round(this._voltageHoldLength / this._sampleRate); i += 1) {
                this._appendBit(this._lastSignalBit);
            }
            this._lastSignalBit ^= 1;
            this._voltageHoldLength = 0;
        } else if (this._voltageHoldLength > this._sampleRate * 2) {
            this._appendBit(this._lastSignalBit);
            this._voltageHoldLength -= this._sampleRate;
        }
        this._voltageHoldLength += 1;

        if (this._lastBitLength < 10) {
            this._distortion = Math.max(
                0.0001,
                this._distortion + ((signal - (this._lastSignalBit ? 1 : -1)) ** 2 - this._distortion) * this._agcFactor,
            );
        } else if (this._lastBitLength > 100) {
            this._distortion = 1;
        }
    }

    _appendBit(bit) {
        this._bitBuffer.push(bit);
        if (bit !== this._lastBit) {
            this._lastBit = bit;
            this._lastBitLength = 1;
        } else {
            this._lastBitLength += 1;
        }
        this._noStateLength += 1;

        if (this._lastBitLength > 10) {
            this._idleBit = bit;
            this._bitBuffer = [];

            if (this._byteBuffer.length > 0) {
                this._byteBuffer = [];
            }

            if (this._lastBitLength > 100 && this._state.on) {
                const nextState = cloneState(this._state);
                nextState.on = false;
                nextState.noise = Math.min(1, this._distortion) || 0;
                nextState.power = this._lastPower;
                this._emitPacket(nextState);
            } else if (this._noStateLength > 700) {
                this._noStateLength = 100;
                const nextState = cloneState(this._state);
                nextState.noise = Math.min(1, this._distortion) || 0;
                nextState.power = this._lastPower;
                this._emitPacket(nextState);
            }
            return;
        }

        if (this._bitBuffer.length !== 10) return;

        if (this._bitBuffer[0] === this._idleBit || this._bitBuffer[9] !== this._idleBit) {
            this._bitBuffer = this._bitBuffer.slice(1);
            return;
        }

        let value = 0;
        for (let i = 8; i > 0; i -= 1) {
            value = (value << 1) | (this._bitBuffer[i] === this._idleBit ? 1 : 0);
        }
        this._byteBuffer.push(String.fromCharCode(value));
        this._decode(this._byteBuffer);
        this._bitBuffer = [];
    }

    _decode(byteBuffer) {
        if (byteBuffer.length !== 9 && byteBuffer.length !== 10) return;

        const head = byteBuffer[0];
        if (!IDLE_PACKET_HEADERS.test(head)) return;

        let checksum = 64;
        for (let i = 1; i < byteBuffer.length - 3; i += 1) {
            if (!DIGIT_HEADER.test(byteBuffer[i])) return;
            checksum += Number(byteBuffer[i]);
        }

        if (checksum !== byteBuffer[byteBuffer.length - 3].charCodeAt(0)) return;

        const timeMs = Number(byteBuffer[1]) * 60000
            + Number(`${byteBuffer[2]}${byteBuffer[3]}`) * 1000
            + Number(`${byteBuffer[4]}${byteBuffer[5]}${byteBuffer.length === 10 ? byteBuffer[6] : '0'}`);

        this._pushNewState(head, timeMs, byteBuffer.length === 9 ? 10 : 1);
    }

    _pushNewState(head, timeMs, unit) {
        const prevState = this._state;
        const isTimeIncreasing = unit === prevState.unit
            ? timeMs > prevState.timeMs
            : Math.floor(timeMs / 10) > Math.floor(prevState.timeMs / 10);

        const nextState = {
            timeMs,
            unit,
            on: true,
            greenLight: head === 'A',
            leftHand: head === 'L' || head === 'A' || head === 'C',
            rightHand: head === 'R' || head === 'A' || head === 'C',
            running: (head !== 'S' || prevState.signalHeader === 'S') && (head === ' ' || isTimeIncreasing),
            signalHeader: head,
            unknownRunning: !prevState.on,
            noise: Math.min(1, this._distortion) || 0,
            power: this._lastPower,
        };

        this._noStateLength = 0;
        this._emitPacket(nextState);
    }

    _emitPacket(nextState) {
        this._state = nextState;
        this.emit('packet', this.getState());
    }
}

export const stackmatInput = new StackmatInput();
