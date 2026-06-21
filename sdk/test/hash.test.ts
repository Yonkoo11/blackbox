import { contentHash, entryHash, u64le, toHex } from '../src/hash.js';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

// u64 LE encoding (BCS) — 1 -> 01 00 00 00 00 00 00 00
check('u64le(1)', toHex(u64le(1n)) === '0100000000000000');
check('u64le(258)', toHex(u64le(258n)) === '0201000000000000');

// content hash is deterministic + 32 bytes
const a = contentHash(new TextEncoder().encode('hello'));
check('contentHash length 32', a.length === 32);
check('contentHash deterministic', toHex(a) === toHex(contentHash(new TextEncoder().encode('hello'))));

// chain: seq 0 uses empty prev head; different content -> different entry
const c0 = contentHash(new TextEncoder().encode('step0'));
const e0 = entryHash(new Uint8Array(0), c0, 0n, 0n);
const e0b = entryHash(new Uint8Array(0), c0, 0n, 0n);
check('entryHash deterministic', toHex(e0) === toHex(e0b));
const e0_diffAmount = entryHash(new Uint8Array(0), c0, 1n, 0n);
check('amount changes entry hash', toHex(e0) !== toHex(e0_diffAmount));
const e1 = entryHash(e0, contentHash(new TextEncoder().encode('step1')), 0n, 1n);
check('chain links (e1 depends on e0)', toHex(e1) !== toHex(e0));

console.log(failures === 0 ? '\nALL HASH TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
