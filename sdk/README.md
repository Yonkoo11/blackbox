# @blackbox/sdk

TypeScript SDK for **Blackbox** — the on-chain accountability layer for autonomous AI agents on Sui.

- `record` an agent action → payload encrypted (Seal, AES fallback) → stored on Walrus → content
  hash committed on-chain via the `blackbox` Move package.
- `verify` a vault → replay the keccak hash-chain from Sui events + Walrus blobs → per-step
  `VALID`/`TAMPERED`. The on-chain spend limit is enforced by the contract (funds are custodied).

## Install
```bash
cd sdk && npm install
```

## Run the end-to-end demo (Sui testnet)
```bash
npm run test     # offline: hash-layout unit tests
npm run demo     # live: create vault, record 3 actions, verify, tamper-detect
```
The demo generates **ephemeral testnet keypairs** (saved to `.demo-keys.json`, gitignored — they hold
only faucet SUI). If the public faucet is rate-limited, fund the printed owner/agent addresses from any
testnet wallet and re-run (`sui client transfer-sui ...`); the demo reuses persisted keys.

### What the demo proves (last verified run, testnet)
- Package `0x1e96efd1d947d8a17359fb5ac0d1f91e4ff953550e1146a38c9f0e7bcc422720`
- 3 actions recorded with **Seal** encryption + **Walrus** storage → `verify` = VALID×3, `chainValid: true`
- Tampering one stored payload → that step + everything after it flips to `TAMPERED`, `chainValid: false`
- Spend capped on-chain: `spent 0.01 SUI` against a `0.05 SUI` limit; over-limit aborts (Move test).

## API
```ts
const bb = new BlackboxClient(PACKAGE_ID); // testnet
const { vaultId } = await bb.createVault(owner, agentAddr, spendLimitMist, fundMist);
await bb.spendAndRecord(agent, vaultId, amountMist, recipient, { reason: '...' });
await bb.recordNote(agent, vaultId, { observation: '...' });
const result = await bb.verify(vaultId); // { rows:[{seq,amount,status}], chainValid }
```

## Hash layout (must match the Move contract)
`entry_hash = keccak256(prev_head || content_hash || u64_le(amount) || u64_le(seq))`,
`content_hash = keccak256(stored_ciphertext)`. The off-chain `verify` reruns this over the Walrus
blobs and compares against the on-chain `head_hash`.

MIT.
