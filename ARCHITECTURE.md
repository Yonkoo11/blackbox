# Blackbox — Architecture

**Blackbox** is the accountability layer for autonomous AI agents on Sui: an agent wallet whose
spending limits are **enforced on-chain** (the agent literally cannot exceed them — the funds are
custodied by a Sui object and the only exit is a recorded, capped path), and whose every action is a
**verifiable, Seal-encrypted, tamper-evident memory** stored on Walrus.

## Why these primitives (verified 2026-06-21 against live SDKs)
- **Sui object model + custody** — funds live in a shared `AgentVault` object; Move aborts an
  over-limit or unauthorized spend. This is a *real* guardrail, not a self-reported number. Per-object
  access control is the thing Sui does that EVM/Solana don't do cleanly (`real-problems:548`).
- **Walrus** (`@mysten/walrus@1.2.1`, or funded public testnet HTTP publisher/aggregator) — each
  action payload is a Walrus blob; blob ids are **content-addressed hashes**, so storage itself is
  verifiable.
- **Seal** (`@mysten/seal@1.2.1`) — threshold-encryption + an on-chain `seal_approve` policy =
  selective disclosure. Only the vault owner + allowlisted auditors can decrypt payloads.
- **DeepBook v3** (`@mysten/deepbook-v3`) — flagship demo: an autonomous trading agent records every
  decision through Blackbox while trading live testnet pools.
- **MemWal** — NOT on the trust path (its high-level API hides blob ids/hashes). Optional V2 add-on
  for semantic recall + headline-sponsor breadth.

## On-chain (Move package `blackbox`)
- `AgentVault` (shared): `funds: Balance<SUI>`, `owner`, `agent` (delegate addr), `spend_limit`,
  `spent`, `expires_at_ms`, `active`, `head_hash`, `count`, `viewers` (Seal allowlist). Public so
  anyone can verify the hash-chain head; payloads stay encrypted off-chain.
- `OwnerCap` (owned): operator authority — add/remove viewer, deactivate (kill switch), top up, withdraw.
- `spend_and_record(vault, amount, recipient, blob_id, content_hash, clock, ctx)` — **THE guardrail**:
  asserts sender==agent, active, in-window, `spent+amount<=limit`, sufficient balance; splits the coin,
  transfers it, appends the hash-chain entry, emits `ActionRecorded`. Atomic.
- `record_note(vault, blob_id, content_hash, clock, ctx)` — non-financial memory step (amount 0).
- `seal_approve(id, vault, ctx)` — Seal policy: id must be prefixed by the vault's object id, and
  sender must be owner or an allowlisted viewer; aborts otherwise.
- `compute_entry_hash(prev_head, content_hash, amount, seq)` — deterministic keccak256 the off-chain
  verifier reruns over Walrus blobs to compare against on-chain `head_hash`.

### Tamper-evidence chain
`entry_hash_n = keccak256(entry_hash_{n-1} || content_hash_n || amount_n || seq_n)`, where
`content_hash_n = keccak256(encrypted_payload_blob_n)`. Editing any stored payload changes its blob
hash → breaks the chain → verifier flags TAMPERED. Recipient/amount are on-chain in the event, so
financial actions are independently auditable even without decrypting.

## Off-chain (TypeScript, MIT)
- **`@blackbox/sdk`**: `record(step)` (Seal-encrypt payload → Walrus blob → call `record_note`/
  `spend_and_record`) and `verify(vaultId)` (read events from Sui + blobs from Walrus → recompute
  chain → per-step VALID/TAMPERED; owner Seal-decrypts payloads).
- **Agent harness**: a reference autonomous agent that takes actions and records each.
- **Flagship demo**: DeepBook trading agent — every order decision recorded; replay proves it untampered.
- **Verifier web app**: paste a vault id → timeline of VALID/TAMPERED rows + owner reveal.
- **Onboarding**: zkLogin (via Enoki) for owners; sponsored transactions so the agent acts gasless.

## Trust model / honesty
- Public, no-trust: the hash-chain integrity (anyone verifies), spend cap (Move-enforced), fund custody.
- Trusted: Seal key servers for decryption availability (threshold mitigates); Walrus for blob
  availability (paid epochs). The agent's *honesty about its own reasoning text* is NOT proven — only
  that the recorded bytes are untampered and the financial actions are capped + logged. We state this plainly.

## Deploy path
Testnet first (package id in `ai/deploy.md`), then mainnet for 100% prize payout.
