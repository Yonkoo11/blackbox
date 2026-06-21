# Fix Plan — Blackbox (flight recorder for AI agents)

Build order: Phase 1 core action first. No UI polish until the core action works end-to-end.

## Phase 1 — Core Action (the gate)

- [ ] T1: Scaffold Sui Move package `blackbox` with a `MemoryLog` object.
  - Acceptance: `sui move build` passes; `MemoryLog` has fields {owner, head_hash, count, policy_id}.
  - Files: `move/sources/blackbox.move`, `move/Move.toml`

- [ ] T2: Implement `record(log, blob_id, content_hash, prev_hash)` appending a hash-chained entry.
  - Acceptance: Move unit test: two records chain (entry2.prev_hash == entry1.hash); wrong prev_hash aborts.
  - Files: `move/sources/blackbox.move`, `move/tests/blackbox_tests.move`

- [ ] T3: Implement `verify`/view that recomputes and exposes the chain head for off-chain checking.
  - Acceptance: Move test reconstructs the chain and a mutated content_hash fails verification.

- [ ] T4: Deploy `blackbox` to Sui testnet; record package ID in ai/deploy.md.
  - Acceptance: package ID printed; object created on testnet explorer.
  - SECURITY: deploy reads key from env only; never print the key.

- [ ] T5: TypeScript SDK `record(step)` — Seal-encrypt step JSON, write Walrus blob, call Move `record`.
  - Acceptance: one real step round-trips: blob written to Walrus, Sui entry created, blob_id matches.
  - Files: `sdk/src/record.ts`, `sdk/src/walrus.ts`, `sdk/src/seal.ts`

- [ ] T6: SDK `verify(logId)` — fetch chain from Sui + blobs from Walrus, recompute hashes, return per-step VALID/TAMPERED.
  - Acceptance: 3 recorded steps all VALID; hand-tampered blob returns TAMPERED. **THIS IS THE GATE.**

- [ ] T7: Reference agent harness — a tiny agent that takes 3 actions and records each via the SDK.
  - Acceptance: running the harness produces a verifiable log id.

- [ ] T8: Minimal verifier UI — paste log id → per-step VALID/TAMPERED + owner Seal-decrypt reveal.
  - Acceptance: open local URL, paste log id, see 3 green VALID rows; tamper one → red TAMPERED.

## Phase 2 — Real data flows
- [ ] Seal selective disclosure: unauthorized viewer sees only hashes; owner decrypts payloads.
- [ ] MemWal account + delegate key path (fallback to direct Walrus if SDK blocks).
- [ ] Error handling: Walrus unavailable, Seal key-server down, malformed step.

## Phase 3 — Product complete
- [ ] Flagship demo: autonomous DeepBook trading agent records every decision; replay a session.
- [ ] Publish SDK + example; README reproduce-steps; CONTRIBUTING.md; MIT LICENSE.
- [ ] Live verifier URL (no login).

## Phase 4 — Polish + submission
- [ ] /design pass on verifier UI + landing.
- [ ] Demo video ≤5 min (problem → solution → live replay → team).
- [ ] Mainnet deploy for 100% payout; record package id.
- [ ] /submit pre-deadline checklist.

## Completed
(builder fills this in)
