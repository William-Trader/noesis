// Noesis · varint + byte helpers (zero dependencies).
// LEB128 unsigned varints and a growable byte writer / reader.

export class ByteWriter {
  constructor(cap = 1 << 16) {
    this.buf = new Uint8Array(cap);
    this.len = 0;
  }
  _ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(b) { this._ensure(1); this.buf[this.len++] = b & 0xff; return this; }
  u16(x) { this._ensure(2); this.buf[this.len++] = x & 0xff; this.buf[this.len++] = (x >>> 8) & 0xff; return this; }
  u32(x) { this._ensure(4); const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 4); v.setUint32(0, x >>> 0, true); this.len += 4; return this; }
  f64(x) { this._ensure(8); const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 8); v.setFloat64(0, x, true); this.len += 8; return this; }
  uvarint(n) {
    if (n < 0 || !Number.isFinite(n)) throw new Error("uvarint requires a non-negative finite number");
    this._ensure(5);
    n = Math.floor(n);
    while (n >= 0x80) { this.buf[this.len++] = (n & 0x7f) | 0x80; n = Math.floor(n / 128); }
    this.buf[this.len++] = n;
    return this;
  }
  bytes(arr) { this._ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; return this; }
  u8str(s) { const bytes = new TextEncoder().encode(s); this.bytes(bytes); return this; }
  toUint8Array() { return this.buf.subarray(0, this.len); }
}

export class ByteReader {
  constructor(u8) {
    this.u8 = u8;
    this.pos = 0;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  u8() { return this.u8[this.pos++]; }
  u16() { const v = this.u8[this.pos] | (this.u8[this.pos + 1] << 8); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  uvarint() {
    let n = 0, shift = 0, b;
    do { b = this.u8[this.pos++]; n += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
    return n;
  }
  bytes(n) { const s = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return s; }
  u8str(n) { return new TextDecoder().decode(this.bytes(n)); }
  eof() { return this.pos >= this.u8.length; }
  get remaining() { return this.u8.length - this.pos; }
}
