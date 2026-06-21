import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Known Seal testnet key-server object ids (best-effort; AES fallback if unreachable).
const TESTNET_KEY_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];

/**
 * Payload confidentiality. Tries Seal (threshold encryption + on-chain access policy);
 * falls back to AES-256-GCM if the Seal testnet key servers are unavailable.
 *
 * NOTE: the tamper-evidence chain hashes whatever ciphertext is stored, so the
 * VALID/TAMPERED verification gate is INDEPENDENT of which mode is used here.
 */
export type EncMode = 'seal' | 'aes';
export interface Encrypted {
  ciphertext: Uint8Array;
  mode: EncMode;
  id?: string; // seal id (hex, no 0x) — needed to decrypt
  aesKey?: Uint8Array; // aes fallback key (owner-held)
}

function vaultIdHex(vaultId: string): string {
  return vaultId.startsWith('0x') ? vaultId.slice(2) : vaultId;
}

/** Seal id = 32-byte vault object id (the on-chain policy namespace) ++ random nonce. */
export function makeSealId(vaultId: string): string {
  return vaultIdHex(vaultId) + Buffer.from(randomBytes(8)).toString('hex');
}

export async function encryptPayload(
  suiClient: any,
  packageId: string,
  vaultId: string,
  data: Uint8Array,
): Promise<Encrypted> {
  try {
    const { SealClient } = await import('@mysten/seal');
    const client = new SealClient({
      suiClient: suiClient as any,
      serverConfigs: TESTNET_KEY_SERVERS.map((objectId: string) => ({ objectId, weight: 1 })),
      verifyKeyServers: false,
    });
    const id = makeSealId(vaultId);
    const { encryptedObject } = await client.encrypt({
      threshold: 1,
      packageId,
      id,
      data,
    });
    return { ciphertext: new Uint8Array(encryptedObject), mode: 'seal', id };
  } catch (e) {
    // AES fallback
    const aesKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
    const tag = cipher.getAuthTag();
    // ciphertext layout: iv(12) || tag(16) || ct
    const ciphertext = new Uint8Array(Buffer.concat([iv, tag, ct]));
    return { ciphertext, mode: 'aes', aesKey: new Uint8Array(aesKey) };
  }
}

/** Best-effort decrypt for the owner-reveal demo (selective disclosure). */
export function aesDecrypt(ciphertext: Uint8Array, aesKey: Uint8Array): Uint8Array {
  const buf = Buffer.from(ciphertext);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(aesKey), iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}
