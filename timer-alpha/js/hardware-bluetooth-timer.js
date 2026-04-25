import { createAes128 } from './crypto-aes128.js?v=2026042504';
import { EventEmitter } from './utils.js?v=2026042504';

const STORAGE_KEY_MAC_MAP = 'ukratimer-bluetooth-timer-mac-map-v1';

export const BluetoothTimerState = Object.freeze({
    DISCONNECT: 0,
    GET_SET: 1,
    HANDS_OFF: 2,
    RUNNING: 3,
    STOPPED: 4,
    IDLE: 5,
    HANDS_ON: 6,
    FINISHED: 7,
    INSPECTION: 8,
    GAN_RESET: 9,
});

const GAN_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const GAN_READ_UUID = '0000fff5-0000-1000-8000-00805f9b34fb';

const QIYI_SERVICE_UUID = '0000fd50-0000-1000-8000-00805f9b34fb';
const QIYI_UUID_SUFFIX = '-0000-1001-8001-00805f9b07d0';
const QIYI_WRITE_UUID = `00000001${QIYI_UUID_SUFFIX}`;
const QIYI_READ_UUID = `00000002${QIYI_UUID_SUFFIX}`;
const QIYI_MANUFACTURER_IDS = [0x0504];
const QIYI_AES_KEY = Array(16).fill(0x77);

const BLUETOOTH_UNAVAILABLE_MESSAGE = 'Web Bluetooth is not available here. Try a Chromium-based browser over HTTPS with Bluetooth enabled.';
const INVALID_MAC_MESSAGE = 'A valid MAC address is required for QiYi timers.';

function toUuid128(uuid) {
    if (/^[0-9A-Fa-f]{4}$/.test(uuid)) {
        return `0000${uuid}-0000-1000-8000-00805F9B34FB`.toUpperCase();
    }
    return String(uuid).toUpperCase();
}

function findUuid(items, uuid) {
    const normalized = toUuid128(uuid);
    return items.find((item) => toUuid128(item.uuid) === normalized) || null;
}

function loadSavedMacMap() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_MAC_MAP) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveSavedMacMap(map) {
    try {
        localStorage.setItem(STORAGE_KEY_MAC_MAP, JSON.stringify(map));
    } catch {
    }
}

function isMacAddress(value) {
    return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(value ?? '').trim());
}

function normalizeMacAddress(value) {
    return String(value ?? '').trim().replace(/-/g, ':').toUpperCase();
}

async function checkBluetoothAvailability() {
    if (!window.navigator?.bluetooth) {
        throw new Error(BLUETOOTH_UNAVAILABLE_MESSAGE);
    }

    if (typeof window.navigator.bluetooth.getAvailability !== 'function') return;

    const available = await window.navigator.bluetooth.getAvailability();
    if (!available) {
        throw new Error(BLUETOOTH_UNAVAILABLE_MESSAGE);
    }
}

async function waitForAdvertisements(device, timeoutMs = 10000) {
    if (!device?.watchAdvertisements) {
        throw new Error('Bluetooth advertisements are not supported by this browser.');
    }

    const controller = new AbortController();
    try {
        return await new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error('Timed out waiting for timer advertisements.'));
            }, timeoutMs);

            const onAdvertisement = (event) => {
                cleanup();
                resolve(event.manufacturerData);
            };

            const cleanup = () => {
                window.clearTimeout(timeoutId);
                device.removeEventListener('advertisementreceived', onAdvertisement);
                controller.abort();
            };

            device.addEventListener('advertisementreceived', onAdvertisement);
            device.watchAdvertisements({ signal: controller.signal }).catch((error) => {
                cleanup();
                reject(error);
            });
        });
    } finally {
        controller.abort();
    }
}

async function writeCharacteristic(characteristic, bytes) {
    const payload = new Uint8Array(bytes).buffer;
    if (typeof characteristic.writeValueWithoutResponse === 'function') {
        return characteristic.writeValueWithoutResponse(payload);
    }
    return characteristic.writeValue(payload);
}

function crc16Ccitt(buffer) {
    const view = new DataView(buffer);
    let crc = 0xFFFF;
    for (let i = 0; i < view.byteLength; i += 1) {
        crc ^= view.getUint8(i) << 8;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x8000) > 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
        }
    }
    return crc & 0xFFFF;
}

function validateGanEvent(dataView) {
    try {
        if (!dataView || dataView.byteLength === 0 || dataView.getUint8(0) !== 0xFE) return false;
        const packetCrc = dataView.getUint16(dataView.byteLength - 2, true);
        const calculated = crc16Ccitt(dataView.buffer.slice(2, dataView.byteLength - 2));
        return packetCrc === calculated;
    } catch {
        return false;
    }
}

function buildGanTimerEvent(dataView) {
    const state = [
        BluetoothTimerState.DISCONNECT,
        BluetoothTimerState.GET_SET,
        BluetoothTimerState.HANDS_OFF,
        BluetoothTimerState.RUNNING,
        BluetoothTimerState.STOPPED,
        BluetoothTimerState.GAN_RESET,
        BluetoothTimerState.HANDS_ON,
        BluetoothTimerState.FINISHED,
    ][dataView.getUint8(3)] || BluetoothTimerState.DISCONNECT;

    const event = { state };
    if (state === BluetoothTimerState.STOPPED) {
        const minutes = dataView.getUint8(4);
        const seconds = dataView.getUint8(5);
        const millis = dataView.getUint16(6, true);
        event.solveTime = (minutes * 60000) + (seconds * 1000) + millis;
    }
    return event;
}

function crc16Modbus(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i += 1) {
        crc ^= data[i];
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x1) > 0 ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
        }
    }
    return crc;
}

function getQiyiManufacturerDataBytes(manufacturerData) {
    if (manufacturerData instanceof DataView) {
        return new DataView(manufacturerData.buffer.slice(2));
    }

    for (const id of QIYI_MANUFACTURER_IDS) {
        if (manufacturerData?.has(id)) {
            return manufacturerData.get(id);
        }
    }

    return null;
}

function buildBluetoothRequestOptions() {
    return {
        filters: [
            { namePrefix: 'GAN' },
            { namePrefix: 'Gan' },
            { namePrefix: 'gan' },
            { namePrefix: 'QY-Timer' },
            { namePrefix: 'QY-Adapter' },
        ],
        optionalServices: [GAN_SERVICE_UUID, QIYI_SERVICE_UUID],
        optionalManufacturerData: QIYI_MANUFACTURER_IDS,
    };
}

function getDefaultQiyiMacFromDeviceName(deviceName = '') {
    const match = /^QY-(?:Timer|Adapter).*-([0-9A-F]{4})$/i.exec(deviceName.trim());
    if (!match) return '';
    const prefix = deviceName.startsWith('QY-Adapter') ? 'CC:A8' : 'CC:A1';
    return `${prefix}:00:00:${match[1].slice(0, 2)}:${match[1].slice(2, 4)}`.toUpperCase();
}

export class BluetoothTimerInput extends EventEmitter {
    constructor() {
        super();
        this._device = null;
        this._context = null;
        this._deviceInfo = null;
        this._disconnecting = false;
        this._promptForMac = null;

        this._handleGattDisconnect = this._handleGattDisconnect.bind(this);
    }

    setMacPromptHandler(handler) {
        this._promptForMac = typeof handler === 'function' ? handler : null;
    }

    isConnected() {
        return Boolean(this._device && this._context);
    }

    getConnectionInfo() {
        return this._deviceInfo ? { ...this._deviceInfo } : null;
    }

    async connect() {
        await checkBluetoothAvailability();

        if (this.isConnected()) {
            return this.getConnectionInfo();
        }

        const device = await navigator.bluetooth.requestDevice(buildBluetoothRequestOptions());
        const driverId = this._detectDriverId(device.name);
        if (!driverId) {
            throw new Error('This Bluetooth timer is not supported yet.');
        }

        this._device = device;
        this._device.addEventListener('gattserverdisconnected', this._handleGattDisconnect);
        this._disconnecting = false;

        try {
            this._context = driverId === 'gan'
                ? await this._connectGanDriver(device)
                : await this._connectQiyiDriver(device);
            this._deviceInfo = {
                driverId,
                name: device.name?.trim() || 'Bluetooth timer',
            };
            this.emit('connected', this.getConnectionInfo());
            return this.getConnectionInfo();
        } catch (error) {
            await this.disconnect({ emitDisconnected: false });
            throw error;
        }
    }

    async disconnect({ emitDisconnected = true } = {}) {
        if (!this._device) return;

        this._disconnecting = true;
        const device = this._device;
        const context = this._context;

        this._device = null;
        this._context = null;
        this._deviceInfo = null;

        try {
            device.removeEventListener('gattserverdisconnected', this._handleGattDisconnect);
        } catch {
        }

        try {
            if (context?.cleanup) {
                await context.cleanup({ emitDisconnectState: false });
            }
        } finally {
            if (device?.gatt?.connected) {
                try {
                    device.gatt.disconnect();
                } catch {
                }
            }
            this._disconnecting = false;
            if (emitDisconnected) {
                this.emit('disconnected', { expected: true });
            }
        }
    }

    _emitTimerEvent(event) {
        this.emit('event', {
            ...event,
        });
    }

    _detectDriverId(deviceName = '') {
        const name = deviceName.trim();
        if (name.startsWith('QY-Timer') || name.startsWith('QY-Adapter')) {
            return 'qiyi';
        }
        if (name.startsWith('GAN') || name.startsWith('Gan') || name.startsWith('gan')) {
            return 'gan';
        }
        return null;
    }

    async _handleGattDisconnect() {
        if (this._disconnecting) return;

        const context = this._context;
        this._device = null;
        this._context = null;
        this._deviceInfo = null;

        try {
            if (context?.cleanup) {
                await context.cleanup({ emitDisconnectState: true });
            } else {
                this._emitTimerEvent({ state: BluetoothTimerState.DISCONNECT });
            }
        } finally {
            this.emit('disconnected', { expected: false });
        }
    }

    async _connectGanDriver(device) {
        const gatt = await device.gatt.connect();
        const service = await gatt.getPrimaryService(GAN_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(GAN_READ_UUID);

        const onValue = (event) => {
            const dataView = event.target.value;
            if (!validateGanEvent(dataView)) {
                console.warn('[Bluetooth timer] Invalid GAN timer packet received.');
            }
            this._emitTimerEvent(buildGanTimerEvent(dataView));
        };

        characteristic.addEventListener('characteristicvaluechanged', onValue);
        await characteristic.startNotifications();

        return {
            cleanup: async ({ emitDisconnectState } = {}) => {
                characteristic.removeEventListener('characteristicvaluechanged', onValue);
                await characteristic.stopNotifications().catch(() => {});
                if (emitDisconnectState) {
                    this._emitTimerEvent({ state: BluetoothTimerState.DISCONNECT });
                }
            },
        };
    }

    async _connectQiyiDriver(device) {
        const decoder = createAes128(QIYI_AES_KEY);
        const deviceName = device.name?.trim() || 'QiYi timer';

        let deviceMac = '';
        try {
            const manufacturerData = await waitForAdvertisements(device);
            const view = getQiyiManufacturerDataBytes(manufacturerData);
            if (view && view.byteLength >= 6) {
                const bytes = [];
                for (let i = 5; i >= 0; i -= 1) {
                    bytes.push((view.getUint8(i) + 0x100).toString(16).slice(1));
                }
                deviceMac = bytes.join(':').toUpperCase();
            }
        } catch {
            deviceMac = '';
        }

        const gatt = await device.gatt.connect();
        const service = await gatt.getPrimaryService(QIYI_SERVICE_UUID);
        const characteristics = await service.getCharacteristics();
        const writeCharacteristicRef = findUuid(characteristics, QIYI_WRITE_UUID);
        const readCharacteristicRef = findUuid(characteristics, QIYI_READ_UUID);

        if (!writeCharacteristicRef || !readCharacteristicRef) {
            throw new Error('Could not find the required QiYi timer characteristics.');
        }

        const state = {
            waitPacket: 0,
            payloadLength: 0,
            payloadData: [],
        };

        const sendMessage = async (sendSequence, ackSequence, command, data) => {
            let message = [
                (sendSequence >> 24) & 0xff,
                (sendSequence >> 16) & 0xff,
                (sendSequence >> 8) & 0xff,
                sendSequence & 0xff,
                (ackSequence >> 24) & 0xff,
                (ackSequence >> 16) & 0xff,
                (ackSequence >> 8) & 0xff,
                ackSequence & 0xff,
                (command >> 8) & 0xff,
                command & 0xff,
            ];
            message.push((data.length >> 8) & 0xff, data.length & 0xff);
            message = message.concat(data);
            const crc = crc16Modbus(message);
            message.push(crc >> 8, crc & 0xff);

            for (let i = 0; i < message.length; i += 16) {
                const block = message.slice(i, i + 16);
                while (block.length < 16) {
                    block.push(1);
                }
                decoder.encrypt(block);
                const packet = i === 0 ? [0x00, message.length + 2, 0x40, 0x00] : [i >> 4];
                packet.push(...block);
                await writeCharacteristic(writeCharacteristicRef, packet);
            }
        };

        const sendAck = (sendSequence, ackSequence, command) => sendMessage(sendSequence, ackSequence, command, [0x00]);

        const sendHello = async (macAddress) => {
            const content = [0, 0, 0, 0, 0, 33, 8, 0, 1, 5, 90];
            for (let i = 5; i >= 0; i -= 1) {
                content.push(parseInt(macAddress.slice(i * 3, i * 3 + 2), 16));
            }
            return sendMessage(1, 0, 1, content);
        };

        const onValue = (event) => {
            const dataView = event.target.value;
            const bytes = [];
            for (let i = 0; i < dataView.byteLength; i += 1) {
                bytes.push(dataView.getUint8(i));
            }

            if (bytes[0] !== state.waitPacket) {
                state.waitPacket = 0;
                state.payloadData = [];
                if (bytes[0] !== 0) return;
            }

            let payloadBytes;
            if (bytes[0] === 0) {
                state.payloadLength = bytes[1] - 2;
                payloadBytes = bytes.slice(4);
            } else {
                payloadBytes = bytes.slice(1);
            }

            for (let i = 0; i < payloadBytes.length; i += 16) {
                const block = payloadBytes.slice(i, i + 16);
                if (block.length < 16) {
                    state.waitPacket = 0;
                    state.payloadData = [];
                    return;
                }
                decoder.decrypt(block);
                state.payloadData = state.payloadData.concat(block);
            }

            if (state.payloadData.length < state.payloadLength) {
                state.waitPacket += 1;
                return;
            }

            const packet = state.payloadData.slice(0, state.payloadLength);
            state.waitPacket = 0;
            state.payloadData = [];

            const length = (packet[10] << 8) | packet[11];
            const checkSlice = packet.slice(0, length + 12).concat([packet[length + 13], packet[length + 12]]);
            if (crc16Modbus(checkSlice) !== 0) return;

            const sendSequence = (packet[0] << 24) | (packet[1] << 16) | (packet[2] << 8) | packet[3];
            const ackSequence = (packet[4] << 24) | (packet[5] << 16) | (packet[6] << 8) | packet[7];
            const command = (packet[8] << 8) | packet[9];
            const data = packet.slice(12, length + 12);
            if (command !== 0x1003) return;

            const dataPointId = data[0];
            const dataPointType = data[1];

            if (dataPointId === 1 && dataPointType === 1) {
                this._emitTimerEvent({
                    state: BluetoothTimerState.STOPPED,
                    solveTime: (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11],
                    inspectTime: (data[12] << 24) | (data[13] << 16) | (data[14] << 8) | data[15],
                });
                void sendAck(ackSequence + 1, sendSequence, 0x1003);
                return;
            }

            if (dataPointId === 4 && dataPointType === 4) {
                const stateValue = [
                    BluetoothTimerState.IDLE,
                    BluetoothTimerState.INSPECTION,
                    BluetoothTimerState.GET_SET,
                    BluetoothTimerState.RUNNING,
                    BluetoothTimerState.FINISHED,
                    BluetoothTimerState.STOPPED,
                    BluetoothTimerState.DISCONNECT,
                ][data[4]];

                this._emitTimerEvent({
                    state: stateValue,
                    solveTime: (data[5] << 24) | (data[6] << 16) | (data[7] << 8) | data[8],
                });
            }
        };

        readCharacteristicRef.addEventListener('characteristicvaluechanged', onValue);
        await readCharacteristicRef.startNotifications();

        const macAddress = await this._requestMacAddress({
            deviceName,
            detectedMac: deviceMac,
            defaultMac: getDefaultQiyiMacFromDeviceName(deviceName),
        });
        await sendHello(macAddress);

        return {
            cleanup: async ({ emitDisconnectState } = {}) => {
                readCharacteristicRef.removeEventListener('characteristicvaluechanged', onValue);
                await readCharacteristicRef.stopNotifications().catch(() => {});
                if (emitDisconnectState) {
                    this._emitTimerEvent({ state: BluetoothTimerState.DISCONNECT });
                }
            },
        };
    }

    async _requestMacAddress({ deviceName, detectedMac = '', defaultMac = '' }) {
        const savedMacMap = loadSavedMacMap();
        let mac = savedMacMap[deviceName];

        if (detectedMac) {
            if (!mac || normalizeMacAddress(mac) !== normalizeMacAddress(detectedMac)) {
                mac = detectedMac;
            }
        } else if (!mac) {
            const message = 'Enter the timer MAC address (xx:xx:xx:xx:xx:xx). Browsers with Bluetooth advertisement support can often fill this automatically.';
            const proposed = await this._promptForMacAddress(message, defaultMac || 'xx:xx:xx:xx:xx:xx');
            mac = proposed || defaultMac;
        }

        if (!isMacAddress(mac)) {
            throw new Error(INVALID_MAC_MESSAGE);
        }

        const normalized = normalizeMacAddress(mac);
        if (savedMacMap[deviceName] !== normalized) {
            savedMacMap[deviceName] = normalized;
            saveSavedMacMap(savedMacMap);
        }

        return normalized;
    }

    async _promptForMacAddress(message, defaultValue) {
        if (this._promptForMac) {
            return this._promptForMac({
                message,
                defaultValue,
                title: 'QiYi timer MAC address',
                placeholder: 'xx:xx:xx:xx:xx:xx',
            });
        }

        const value = window.prompt(message, defaultValue);
        return value == null ? null : value;
    }
}

export const bluetoothTimerInput = new BluetoothTimerInput();
