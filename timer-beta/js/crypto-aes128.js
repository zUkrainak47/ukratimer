const SBOX = [
    99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118,
    202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192,
    183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21,
    4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117,
    9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132,
    83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207,
    208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168,
    81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
    205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115,
    96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219,
    224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121,
    231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
    186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138,
    112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158,
    225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
    140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22,
];

const SBOX_INV = [];
const SHIFT_TAB_INV = [0, 13, 10, 7, 4, 1, 14, 11, 8, 5, 2, 15, 12, 9, 6, 3];
const XTIME = [];

function initTables() {
    if (XTIME.length > 0) return;
    for (let i = 0; i < 256; i += 1) {
        SBOX_INV[SBOX[i]] = i;
    }
    for (let i = 0; i < 128; i += 1) {
        XTIME[i] = i << 1;
        XTIME[128 + i] = (i << 1) ^ 0x1b;
    }
}

function addRoundKey(state, roundKey) {
    for (let i = 0; i < 16; i += 1) {
        state[i] ^= roundKey[i];
    }
}

function shiftSubAdd(state, roundKey) {
    const snapshot = state.slice();
    for (let i = 0; i < 16; i += 1) {
        state[i] = SBOX_INV[snapshot[SHIFT_TAB_INV[i]]] ^ roundKey[i];
    }
}

function shiftSubAddInverse(state, roundKey) {
    const snapshot = state.slice();
    for (let i = 0; i < 16; i += 1) {
        state[SHIFT_TAB_INV[i]] = SBOX[snapshot[i] ^ roundKey[i]];
    }
}

function mixColumns(state) {
    for (let i = 12; i >= 0; i -= 4) {
        const s0 = state[i];
        const s1 = state[i + 1];
        const s2 = state[i + 2];
        const s3 = state[i + 3];
        const mix = s0 ^ s1 ^ s2 ^ s3;
        state[i] ^= mix ^ XTIME[s0 ^ s1];
        state[i + 1] ^= mix ^ XTIME[s1 ^ s2];
        state[i + 2] ^= mix ^ XTIME[s2 ^ s3];
        state[i + 3] ^= mix ^ XTIME[s3 ^ s0];
    }
}

function mixColumnsInverse(state) {
    for (let i = 0; i < 16; i += 4) {
        const s0 = state[i];
        const s1 = state[i + 1];
        const s2 = state[i + 2];
        const s3 = state[i + 3];
        const mix = s0 ^ s1 ^ s2 ^ s3;
        const xMix = XTIME[mix];
        const h1 = XTIME[XTIME[xMix ^ s0 ^ s2]] ^ mix;
        const h2 = XTIME[XTIME[xMix ^ s1 ^ s3]] ^ mix;
        state[i] ^= h1 ^ XTIME[s0 ^ s1];
        state[i + 1] ^= h2 ^ XTIME[s1 ^ s2];
        state[i + 2] ^= h1 ^ XTIME[s2 ^ s3];
        state[i + 3] ^= h2 ^ XTIME[s3 ^ s0];
    }
}

export class AES128 {
    constructor(key) {
        initTables();
        const expandedKey = key.slice();
        let roundConstant = 1;
        for (let i = 16; i < 176; i += 4) {
            let chunk = expandedKey.slice(i - 4, i);
            if (i % 16 === 0) {
                chunk = [SBOX[chunk[1]] ^ roundConstant, SBOX[chunk[2]], SBOX[chunk[3]], SBOX[chunk[0]]];
                roundConstant = XTIME[roundConstant];
            }
            for (let j = 0; j < 4; j += 1) {
                expandedKey[i + j] = expandedKey[i + j - 16] ^ chunk[j];
            }
        }
        this.key = expandedKey;
    }

    decrypt(block) {
        addRoundKey(block, this.key.slice(160, 176));
        for (let i = 144; i >= 16; i -= 16) {
            shiftSubAdd(block, this.key.slice(i, i + 16));
            mixColumnsInverse(block);
        }
        shiftSubAdd(block, this.key.slice(0, 16));
        return block;
    }

    encrypt(block) {
        shiftSubAddInverse(block, this.key.slice(0, 16));
        for (let i = 16; i < 160; i += 16) {
            mixColumns(block);
            shiftSubAddInverse(block, this.key.slice(i, i + 16));
        }
        addRoundKey(block, this.key.slice(160, 176));
        return block;
    }
}

export function createAes128(key) {
    return new AES128(key);
}
