/**
 * AES-256-CTR als pure JavaScript-Implementierung (nur Verschlüsselungsrichtung,
 * CTR nutzt ausschließlich die Vorwärts-Chiffre). Wird für die Verschlüsselung
 * der lokalen Caches, Entwürfe und der Offline-Queue verwendet — der Schlüssel
 * liegt in der iOS-Keychain (expo-secure-store), die Daten unverschlüsselt
 * nirgends auf der Platte.
 *
 * Die S-Box wird programmatisch aus dem multiplikativen Inversen in GF(2^8)
 * und der Affinen Transformation erzeugt (keine abgetippte Tabelle).
 */

/** a·2 in GF(2^8) */
function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

/** 8-Bit-Rotation nach links */
function rotl8(a: number, n: number): number {
  return ((a << n) | (a >>> (8 - n))) & 0xff;
}

/** AES-S-Box (affine Transformation über dem multiplikativen Inversen) */
function buildSbox(): Uint8Array {
  const pow = new Uint8Array(256);
  const log = new Uint8Array(256);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    pow[i] = v;
    log[v] = i;
    v = (v ^ xtime(v)) & 0xff; // v *= 3 (Erzeuger)
  }
  const sbox = new Uint8Array(256);
  for (let a = 0; a < 256; a++) {
    // Inverses: a = 3^i → a^-1 = 3^(255-i); Index modulo 255 (i=0 → 3^0 = 1)
    const inv = a === 0 ? 0 : pow[(255 - log[a]) % 255];
    sbox[a] = inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63;
  }
  return sbox;
}

const SBOX = buildSbox();

/** SubWord: S-Box auf jedes Byte eines 32-Bit-Worts */
function subWord(t: number): number {
  return (
    ((SBOX[(t >>> 24) & 0xff] << 24) |
      (SBOX[(t >>> 16) & 0xff] << 16) |
      (SBOX[(t >>> 8) & 0xff] << 8) |
      SBOX[t & 0xff]) >>> 0
  );
}

/** Schlüsselerweiterung AES-256 (Nk=8, Nr=14 → 60 Wörter) */
export function expandKey(key: Uint8Array): Uint32Array {
  const Nk = 8;
  const w = new Uint32Array(60);
  for (let i = 0; i < Nk; i++) {
    w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  }
  let rcon = 1;
  for (let i = Nk; i < 60; i++) {
    let temp = w[i - 1];
    if (i % Nk === 0) {
      temp = (((temp << 8) | (temp >>> 24)) & 0xffffffff) >>> 0; // RotWord
      temp = (subWord(temp) ^ (rcon << 24)) >>> 0; // SubWord + Rcon
      rcon = xtime(rcon);
    } else if (i % Nk === 4) {
      temp = subWord(temp);
    }
    w[i] = (w[i - Nk] ^ temp) >>> 0;
  }
  return w;
}

/**
 * Ein 16-Byte-Block verschlüsseln (kein Padding — nur für CTR-Keystream).
 * State liegt spaltenweise flach: Index r + 4c (Zeile r, Spalte c).
 */
export function encryptBlock(input: Uint8Array, w: Uint32Array, out: Uint8Array): void {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[i];

  const addRoundKey = (round: number) => {
    for (let c = 0; c < 4; c++) {
      const k = w[round * 4 + c];
      s[4 * c] ^= (k >>> 24) & 0xff;
      s[4 * c + 1] ^= (k >>> 16) & 0xff;
      s[4 * c + 2] ^= (k >>> 8) & 0xff;
      s[4 * c + 3] ^= k & 0xff;
    }
  };

  addRoundKey(0);
  for (let round = 1; round <= 13; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    // ShiftRows: Zeile r um r nach links
    const t = new Uint8Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) t[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
    }
    for (let i = 0; i < 16; i++) s[i] = t[i];
    // MixColumns
    for (let c = 0; c < 4; c++) {
      const i0 = 4 * c;
      const a0 = s[i0], a1 = s[i0 + 1], a2 = s[i0 + 2], a3 = s[i0 + 3];
      s[i0] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
      s[i0 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
      s[i0 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
      s[i0 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
    }
    addRoundKey(round);
  }
  // Schlussrunde ohne MixColumns
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
  const t = new Uint8Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) t[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
  }
  for (let i = 0; i < 16; i++) s[i] = t[i];
  addRoundKey(14);
  for (let i = 0; i < 16; i++) out[i] = s[i];
}

/**
 * AES-256-CTR: verschlüsselt/entschlüsselt `data` (XOR mit dem Keystream,
 * Ver- und Entschlüsselung sind identisch). Der 16-Byte-Zähler beginnt mit
 * `iv` und wird als 128-Bit-Big-Endian inkrementiert.
 */
export function aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key);
  const out = new Uint8Array(data.length);
  const counter = new Uint8Array(16);
  counter.set(iv.subarray(0, 16));
  const ks = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    encryptBlock(counter, w, ks);
    const n = Math.min(16, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
    for (let i = 15; i >= 0; i--) {
      counter[i] = (counter[i] + 1) & 0xff;
      if (counter[i] !== 0) break;
    }
  }
  return out;
}

// --- UTF-8 und Base64-Helfer (React Native hat kein Buffer/TextDecoder) ---

export function utf8Encode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) { cp = b; i += 1; }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2; }
    else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
