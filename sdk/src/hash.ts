import { keccak_256 } from '@noble/hashes/sha3';

/** keccak256 of arbitrary bytes — matches Move `hash::keccak256`. */
export function contentHash(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

/** BCS encoding of a u64 = 8-byte little-endian. */
export function u64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Recompute one chain entry exactly as the Move contract does:
 *   entry_hash = keccak256( prev_head || content_hash || u64_le(amount) || u64_le(seq) )
 * `prevHead` for seq 0 is the empty byte string.
 */
export function entryHash(
  prevHead: Uint8Array,
  content: Uint8Array,
  amount: bigint | number,
  seq: bigint | number,
): Uint8Array {
  return keccak_256(concat(prevHead, content, u64le(amount), u64le(seq)));
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Normalize a Move vector<u8> as returned by JSON-RPC (number[] | base64 | hex) to bytes. */
export function toBytes(x: unknown): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (Array.isArray(x)) return Uint8Array.from(x as number[]);
  if (typeof x === 'string') {
    if (/^0x/.test(x)) return Uint8Array.from(Buffer.from(x.slice(2), 'hex'));
    // try base64 then hex
    try {
      return new Uint8Array(Buffer.from(x, 'base64'));
    } catch {
      return Uint8Array.from(Buffer.from(x, 'hex'));
    }
  }
  throw new Error('cannot convert to bytes: ' + typeof x);
}
