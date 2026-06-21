/**
 * Blackbox end-to-end demo on Sui testnet — the Phase 1 gate.
 *
 *  1. generate ephemeral owner + agent keypairs (testnet throwaways), faucet-fund them
 *  2. owner creates a funded AgentVault (agent + spend limit)
 *  3. agent records 3 actions (1 spend_and_record + 2 record_note), each payload
 *     encrypted (Seal or AES) and stored on Walrus
 *  4. verify() replays the chain from Sui events + Walrus blobs -> expect VALID x3
 *  5. tamper one stored blob locally -> verify flags TAMPERED
 *
 * Ephemeral keys are written to .demo-keys.json (gitignored). They hold only faucet SUI.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { BlackboxClient } from '../src/client.js';
import { getBlob, aesDecrypt } from '../src/index.js';

const PACKAGE_ID = process.env.BLACKBOX_PKG ?? '0x1e96efd1d947d8a17359fb5ac0d1f91e4ff953550e1146a38c9f0e7bcc422720';
const KEYS_PATH = new URL('../.demo-keys.json', import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

async function balance(addr: string): Promise<bigint> {
  const b = await rpc.getBalance({ owner: addr });
  return BigInt(b.totalBalance);
}

async function ensureFunded(addr: string, label: string, minMist: bigint) {
  if ((await balance(addr)) >= minMist) {
    console.log(`  ${label} already funded`);
    return;
  }
  for (let i = 0; i < 4; i++) {
    try {
      await requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient: addr });
    } catch (e: any) {
      console.log(`  faucet retry ${label} (${e?.message ?? e})`);
    }
    await sleep(5000);
    if ((await balance(addr)) >= minMist) return console.log(`  funded ${label}`);
  }
  throw new Error(
    `could not fund ${label} (${addr}). Faucet is rate-limited. ` +
      `Fund it manually, then re-run:  sui client transfer-sui --to ${addr} --amount <mist> --sui-coin-object-id <coin>`,
  );
}

async function main() {
  console.log('# Blackbox testnet demo\nPackage:', PACKAGE_ID, '\n');

  let owner: Ed25519Keypair;
  let agent: Ed25519Keypair;
  if (existsSync(KEYS_PATH)) {
    const k = JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
    owner = Ed25519Keypair.fromSecretKey(k.owner);
    agent = Ed25519Keypair.fromSecretKey(k.agent);
    console.log('Reusing persisted ephemeral keys.');
  } else {
    owner = new Ed25519Keypair();
    agent = new Ed25519Keypair();
    writeFileSync(
      KEYS_PATH,
      JSON.stringify(
        { owner: owner.getSecretKey(), agent: agent.getSecretKey(), ownerAddr: owner.toSuiAddress(), agentAddr: agent.toSuiAddress() },
        null,
        2,
      ),
    );
    console.log('Generated ephemeral keys ->', owner.toSuiAddress(), agent.toSuiAddress());
  }
  const recipient = new Ed25519Keypair().toSuiAddress();

  console.log('Funding ephemeral keys...');
  await ensureFunded(owner.toSuiAddress(), 'owner', 250_000_000n);
  await ensureFunded(agent.toSuiAddress(), 'agent', 30_000_000n);
  await sleep(2000);

  const bb = new BlackboxClient(PACKAGE_ID);

  console.log('\nCreating vault (limit 0.05 SUI, funded 0.2 SUI)...');
  const { vaultId, digest: createDigest } = await bb.createVault(owner, agent.toSuiAddress(), 50_000_000n, 200_000_000n);
  console.log('  vaultId:', vaultId, '\n  create digest:', createDigest);

  const digests: string[] = [];
  console.log('\nAgent recording 3 actions...');
  const r0 = await bb.spendAndRecord(agent, vaultId, 10_000_000n, recipient, {
    type: 'payment', reason: 'pay invoice #42', to: recipient,
  });
  digests.push(r0.digest);
  console.log(`  [0] spend 0.01 SUI  blob=${r0.blobId.slice(0, 12)}…  enc=${r0.enc.mode}  digest=${r0.digest}`);

  const r1 = await bb.recordNote(agent, vaultId, { type: 'observation', note: 'price moved +2%, holding' });
  digests.push(r1.digest);
  console.log(`  [1] note            blob=${r1.blobId.slice(0, 12)}…  enc=${r1.enc.mode}  digest=${r1.digest}`);

  const r2 = await bb.recordNote(agent, vaultId, { type: 'decision', note: 'no further action this cycle' });
  digests.push(r2.digest);
  console.log(`  [2] note            blob=${r2.blobId.slice(0, 12)}…  enc=${r2.enc.mode}  digest=${r2.digest}`);

  console.log('\n== VERIFY (clean) ==');
  await sleep(3000);
  const clean = await bb.verify(vaultId);
  for (const row of clean.rows) console.log(`  seq ${row.seq}  amount=${row.amount}  ${row.status}  ${row.blobId.slice(0, 16)}…`);
  console.log(`  on-chain head:   ${clean.onchainHeadHex.slice(0, 24)}…`);
  console.log(`  recomputed head: ${clean.recomputedHeadHex.slice(0, 24)}…`);
  console.log(`  chainValid: ${clean.chainValid}`);

  console.log('\n== TAMPER demo (flip one byte of seq 1 payload) ==');
  const realBytes = await getBlob(r1.blobId);
  const tampered = Uint8Array.from(realBytes);
  tampered[0] = tampered[0] ^ 0xff;
  const override = new Map<number, Uint8Array>([[1, tampered]]);
  const tamperedResult = await bb.verify(vaultId, override);
  for (const row of tamperedResult.rows) console.log(`  seq ${row.seq}  ${row.status}`);
  console.log(`  chainValid (with tampered seq 1): ${tamperedResult.chainValid}`);

  console.log('\n== Owner selective-disclosure reveal ==');
  if (r1.enc.mode === 'aes' && r1.enc.aesKey) {
    const plain = aesDecrypt(realBytes, r1.enc.aesKey);
    console.log('  owner decrypts seq 1 ->', new TextDecoder().decode(plain));
  } else {
    console.log('  seq 1 stored via Seal (mode=seal); decrypt gated by on-chain seal_approve policy.');
  }

  const gatePass =
    clean.rows.length === 3 &&
    clean.rows.every((r) => r.status === 'VALID') &&
    clean.chainValid === true &&
    tamperedResult.rows.find((r) => r.seq === 1)?.status === 'TAMPERED' &&
    tamperedResult.chainValid === false;

  console.log('\n=========================================');
  console.log('GATE RESULT:', gatePass ? 'PASS ✅' : 'FAIL ❌');
  console.log('  vaultId:', vaultId);
  console.log('  record digests:', digests.join(', '));
  console.log('  encryption mode:', r0.enc.mode);
  console.log('=========================================');
  process.exit(gatePass ? 0 : 1);
}

main().catch((e) => {
  console.error('DEMO ERROR:', e?.stack ?? e);
  process.exit(1);
});
