/**
 * Proves (or honestly fails) Seal selective disclosure end-to-end on testnet:
 *  1. agent records a fresh Seal-encrypted note (we capture its Seal id)
 *  2. the VAULT OWNER decrypts it via SessionKey + the on-chain `seal_approve` policy
 *  3. a STRANGER attempts the same decrypt and is DENIED by the policy
 *
 * Run after `npm run demo` (reuses .demo-keys.json: the persisted owner/agent for the demo vault).
 */
import { readFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SealClient, SessionKey } from '@mysten/seal';
import { BlackboxClient } from '../src/client.js';
import { getBlob } from '../src/walrus.js';

const PKG = '0x1e96efd1d947d8a17359fb5ac0d1f91e4ff953550e1146a38c9f0e7bcc422720';
const VAULT = '0x3aae4b99aca7e0bcd2ce7ca4787624c61a7cbca85d60038f77824c9a6df2a18c';
const KEY_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex'));

async function buildApprove(sui: any, sealId: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::blackbox::seal_approve`,
    arguments: [tx.pure.vector('u8', Array.from(fromHex(sealId))), tx.object(VAULT)],
  });
  return tx.build({ client: sui, onlyTransactionKind: true });
}

async function makeSessionKey(sui: any, signer: Ed25519Keypair) {
  const sk = await SessionKey.create({ address: signer.toSuiAddress(), packageId: PKG, ttlMin: 10, suiClient: sui });
  const msg = sk.getPersonalMessage();
  const { signature } = await signer.signPersonalMessage(msg);
  await sk.setPersonalMessageSignature(signature);
  return sk;
}

async function main() {
  const k = JSON.parse(readFileSync(new URL('../.demo-keys.json', import.meta.url), 'utf8'));
  const owner = Ed25519Keypair.fromSecretKey(k.owner);
  const agent = Ed25519Keypair.fromSecretKey(k.agent);
  const bb = new BlackboxClient(PKG);
  // IMPORTANT: a SealClient caches derived keys per id. Use a SEPARATE instance per actor,
  // otherwise the stranger would reuse the owner's cached key and bypass seal_approve.
  const newSeal = () =>
    new SealClient({
      suiClient: bb.sui as any,
      serverConfigs: KEY_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
      verifyKeyServers: false,
    });

  console.log('# Seal selective-disclosure proof\nvault:', VAULT, '\n');
  console.log('1) agent records a fresh encrypted note...');
  const secret = { type: 'private-reasoning', note: 'CONFIDENTIAL: model flagged counterparty risk 0.82', ts: 'demo' };
  const rec = await bb.recordNote(agent, VAULT, secret);
  if (rec.enc.mode !== 'seal' || !rec.enc.id) {
    console.log('   Seal encrypt unavailable (mode=' + rec.enc.mode + '). Cannot prove Seal decrypt. RESULT: INCONCLUSIVE');
    process.exit(2);
  }
  console.log('   blob=' + rec.blobId.slice(0, 16) + '…  sealId=' + rec.enc.id.slice(0, 20) + '…  digest=' + rec.digest);
  const cipher = await getBlob(rec.blobId);

  console.log('\n2) OWNER decrypts via seal_approve policy...');
  let ownerPlain = '';
  try {
    const sk = await makeSessionKey(bb.sui, owner);
    const txBytes = await buildApprove(bb.sui, rec.enc.id);
    const out = await newSeal().decrypt({ data: cipher, sessionKey: sk, txBytes });
    ownerPlain = new TextDecoder().decode(out);
    console.log('   OWNER decrypted ->', ownerPlain);
  } catch (e: any) {
    console.log('   OWNER decrypt FAILED:', e?.message ?? e);
  }

  console.log('\n3) STRANGER attempts the same decrypt (must be DENIED)...');
  let strangerDenied = false;
  try {
    const stranger = new Ed25519Keypair();
    const sk = await makeSessionKey(bb.sui, stranger);
    const txBytes = await buildApprove(bb.sui, rec.enc.id);
    await newSeal().decrypt({ data: cipher, sessionKey: sk, txBytes });
    console.log('   STRANGER DECRYPTED — policy FAILED (this is bad)');
  } catch (e: any) {
    strangerDenied = true;
    console.log('   STRANGER denied (expected):', (e?.message ?? String(e)).split('\n')[0].slice(0, 80));
  }

  const ownerOk = ownerPlain.includes('CONFIDENTIAL');
  console.log('\n=========================================');
  console.log('SELECTIVE DISCLOSURE:', ownerOk && strangerDenied ? 'PROVEN ✅' : 'NOT PROVEN ❌');
  console.log('  owner decrypted:', ownerOk, '| stranger denied:', strangerDenied);
  console.log('=========================================');
  process.exit(ownerOk && strangerDenied ? 0 : 1);
}

main().catch((e) => {
  console.error('REVEAL ERROR:', e?.stack ?? e);
  process.exit(1);
});
