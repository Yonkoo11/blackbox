import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { putBlob, getBlob } from './walrus.js';
import { encryptPayload, type Encrypted } from './seal.js';
import { contentHash, entryHash, bytesEqual, toBytes, toHex } from './hash.js';

const CLOCK_ID = '0x6';

export interface RecordReceipt {
  seq: number;
  amount: bigint;
  blobId: string;
  digest: string;
  enc: Encrypted;
  contentHashHex: string;
}

export interface VerifyRow {
  seq: number;
  amount: bigint;
  blobId: string;
  status: 'VALID' | 'TAMPERED';
}

export interface VerifyResult {
  vaultId: string;
  rows: VerifyRow[];
  chainValid: boolean;
  onchainHeadHex: string;
  recomputedHeadHex: string;
}

function norm(id: string): string {
  const h = (id.startsWith('0x') ? id.slice(2) : id).toLowerCase();
  return '0x' + h.replace(/^0+/, '').padStart(1, '0');
}

export class BlackboxClient {
  readonly sui: SuiJsonRpcClient;
  readonly packageId: string;

  constructor(packageId: string, network: 'testnet' | 'mainnet' | 'devnet' = 'testnet') {
    this.packageId = packageId;
    this.sui = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
  }

  private eventType() {
    return `${this.packageId}::blackbox::ActionRecorded`;
  }

  /**
   * Owner creates + shares a vault funded with `fundMist`, agent = `agentAddr`.
   * `windowMs`/`rateLimitMist` set a rolling rate cap (0 disables it); `expiresAtMs` a policy expiry.
   */
  async createVault(
    owner: Ed25519Keypair,
    agentAddr: string,
    spendLimitMist: bigint,
    fundMist: bigint,
    windowMs: bigint = 0n,
    rateLimitMist: bigint = 0n,
    expiresAtMs: bigint = 0n,
  ) {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(fundMist)]);
    const cap = tx.moveCall({
      target: `${this.packageId}::blackbox::create_vault`,
      arguments: [
        coin,
        tx.pure.address(agentAddr),
        tx.pure.u64(spendLimitMist),
        tx.pure.u64(windowMs),
        tx.pure.u64(rateLimitMist),
        tx.pure.u64(expiresAtMs),
      ],
    });
    tx.transferObjects([cap], owner.toSuiAddress());

    const res = await this.sui.signAndExecuteTransaction({
      signer: owner,
      transaction: tx,
      options: { showObjectChanges: true, showEffects: true },
    });
    if (res.effects?.status?.status !== 'success') {
      throw new Error('createVault failed: ' + JSON.stringify(res.effects?.status));
    }
    let vaultId = '';
    let ownerCapId = '';
    for (const c of res.objectChanges ?? []) {
      if (c.type === 'created' && (c as any).objectType?.endsWith('::blackbox::AgentVault')) vaultId = (c as any).objectId;
      if (c.type === 'created' && (c as any).objectType?.endsWith('::blackbox::OwnerCap')) ownerCapId = (c as any).objectId;
    }
    if (!vaultId) throw new Error('createVault: AgentVault object not found in changes');
    return { vaultId, ownerCapId, digest: res.digest };
  }

  /** Encrypt → store on Walrus → commit content hash on-chain. */
  private async encryptAndStore(vaultId: string, payload: unknown) {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const enc = await encryptPayload(this.sui, this.packageId, vaultId, data);
    const blobId = await putBlob(enc.ciphertext);
    const ch = contentHash(enc.ciphertext);
    return { blobId, ch, enc };
  }

  async recordNote(agent: Ed25519Keypair, vaultId: string, payload: unknown): Promise<RecordReceipt> {
    const { blobId, ch, enc } = await this.encryptAndStore(vaultId, payload);
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::blackbox::record_note`,
      arguments: [tx.object(vaultId), tx.pure.string(blobId), tx.pure.vector('u8', Array.from(ch)), tx.object(CLOCK_ID)],
    });
    const res = await this.sui.signAndExecuteTransaction({ signer: agent, transaction: tx, options: { showEffects: true } });
    if (res.effects?.status?.status !== 'success') throw new Error('recordNote failed: ' + JSON.stringify(res.effects?.status));
    return { seq: -1, amount: 0n, blobId, digest: res.digest, enc, contentHashHex: toHex(ch) };
  }

  async spendAndRecord(agent: Ed25519Keypair, vaultId: string, amountMist: bigint, recipient: string, payload: unknown): Promise<RecordReceipt> {
    const { blobId, ch, enc } = await this.encryptAndStore(vaultId, payload);
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::blackbox::spend_and_record`,
      arguments: [
        tx.object(vaultId),
        tx.pure.u64(amountMist),
        tx.pure.address(recipient),
        tx.pure.string(blobId),
        tx.pure.vector('u8', Array.from(ch)),
        tx.object(CLOCK_ID),
      ],
    });
    const res = await this.sui.signAndExecuteTransaction({ signer: agent, transaction: tx, options: { showEffects: true } });
    if (res.effects?.status?.status !== 'success') throw new Error('spendAndRecord failed: ' + JSON.stringify(res.effects?.status));
    return { seq: -1, amount: amountMist, blobId, digest: res.digest, enc, contentHashHex: toHex(ch) };
  }

  /** Read the on-chain head_hash for a vault. */
  async onchainHead(vaultId: string): Promise<{ headHex: string; count: number }> {
    const obj = await this.sui.getObject({ id: vaultId, options: { showContent: true } });
    const fields = (obj.data?.content as any)?.fields;
    if (!fields) throw new Error('vault content not found');
    return { headHex: toHex(toBytes(fields.head_hash)), count: Number(fields.count) };
  }

  /**
   * Verify a vault's memory chain: read ActionRecorded events, fetch each blob from Walrus,
   * recompute the keccak chain, and compare per-entry + final head to the on-chain value.
   * `overrideBlob` lets the caller inject tampered bytes for one seq (tamper demo).
   */
  async verify(vaultId: string, overrideBlob?: Map<number, Uint8Array>): Promise<VerifyResult> {
    const evs = await this.sui.queryEvents({
      query: { MoveEventType: this.eventType() },
      limit: 200,
      order: 'ascending',
    });
    const mine = evs.data
      .map((e) => e.parsedJson as any)
      .filter((p) => p && norm(p.vault) === norm(vaultId))
      .sort((a, b) => Number(a.seq) - Number(b.seq));

    const rows: VerifyRow[] = [];
    let prevHead: Uint8Array = new Uint8Array(0);
    for (const ev of mine) {
      const seq = Number(ev.seq);
      const amount = BigInt(ev.amount);
      const blobId: string = ev.blob_id;
      const onchainEntry = toBytes(ev.entry_hash);

      const bytes = overrideBlob?.get(seq) ?? (await getBlob(blobId));
      const ch = contentHash(bytes);
      const recomputed = entryHash(prevHead, ch, amount, seq);
      const ok = bytesEqual(recomputed, onchainEntry);
      rows.push({ seq, amount, blobId, status: ok ? 'VALID' : 'TAMPERED' });
      prevHead = recomputed; // continue from recomputed so a break cascades visibly
    }

    const { headHex } = await this.onchainHead(vaultId);
    const recomputedHeadHex = toHex(prevHead);
    return {
      vaultId,
      rows,
      chainValid: recomputedHeadHex === headHex && rows.every((r) => r.status === 'VALID'),
      onchainHeadHex: headHex,
      recomputedHeadHex,
    };
  }
}
