# Blackbox — the flight recorder for AI agents

**Give an AI agent money without trusting it.** Blackbox is an agent wallet on Sui whose spending
limits are **enforced on-chain** (the funds are custodied by a Sui object; the only way out is a
recorded, capped path — Move aborts an over-limit action), and whose every action is a **verifiable,
encrypted, tamper-evident memory** stored on Walrus and selectively disclosable via Seal.

Built for **Sui Overflow 2026 — Walrus track**.

- **Live verifier (no login):** https://yonkoo11.github.io/blackbox/
- **Testnet package:** `0xc2a851cb0cd8603740fe0b838623b341652fd8f7945fcb1351f8ca158e9c5225`

The live verifier reads a real agent vault straight from Sui + Walrus and recomputes the cryptographic
chain in your browser — toggle "flip a byte" to watch it catch a tampered record.

## Why it matters
Autonomous agents are starting to move money, but there's no way to (a) bound what they can spend or
(b) prove what they did. Web2 agent logs (LangSmith, Helicone) are centralized and tamper-able. The
agent-wallet idea died on EVM because key-management standards don't enforce policy on-chain. Sui's
object-capability model is exactly that missing enforcement layer.

## How it works
1. **Custody + guardrail** — an `AgentVault` (shared Sui object) holds the agent's funds. The agent
   (a delegate key) can only move money through `spend_and_record`, which enforces `spent + amount <=
   limit` on-chain and appends a memory entry atomically.
2. **Verifiable memory** — each action's payload is Seal-encrypted, stored as a Walrus blob, and its
   content hash is chained on-chain: `entry_hash = keccak256(prev || content_hash || amount || seq)`.
3. **Verify / replay** — anyone recomputes the chain from Sui events + Walrus blobs. Edit any stored
   payload and that step (and everything after it) flips to `TAMPERED`.
4. **Selective disclosure** — `seal_approve` gates decryption to the vault owner + allowlisted auditors.

## Deep Sui-ecosystem integration
- **Sui object model / object-capability** — on-chain custody + spend enforcement + `OwnerCap`.
- **Walrus** — content-addressed blob storage for every memory payload.
- **Seal** — threshold encryption + on-chain `seal_approve` access policy.
- **DeepBook v3** (flagship demo, in progress) — an autonomous trading agent recording its decisions.

## Guardrail (on-chain, enforced)
- **Lifetime cap** + **rolling rate limit** (max spend per time window) + **per-recipient allowlist** +
  **expiry** + **owner kill switch**. The agent (a delegate key) is the only one who can act, and only
  through `spend_and_record`. Over-limit / over-rate / disallowed-recipient / inactive all abort on-chain.

## Status (verified, testnet)
- Move package live on Sui testnet: `0xc2a851cb0cd8603740fe0b838623b341652fd8f7945fcb1351f8ca158e9c5225`
- Move tests: **10/10 pass** (`cd move && sui move test`) — custody, lifetime cap, rate-limit (+ window
  reset), recipient allowlist, kill switch, and the `seal_approve` access policy.
- End-to-end demo: **PASS** — 3 actions recorded with real Seal + Walrus, `verify` VALID×3,
  tamper-detection works, spend capped on-chain (`cd sdk && npm run demo`).
- **Seal selective disclosure PROVEN** (`npm run reveal`): owner decrypts, stranger denied on-chain.
- **DeepBook agent** (`npm run deepbook`): reads real testnet SUI/DBUSDC market + records its decision
  verifiably (a *resting* order needs ≥1 SUI in the BalanceManager; the public testnet faucet is
  rate-limited, so the agent records the exact on-chain block instead of faking a fill).

## Repo
- `move/` — the `blackbox` Move package (`AgentVault`, `spend_and_record`, `record_note`, `seal_approve`).
- `sdk/` — TypeScript SDK (`record` / `verify`) + the testnet demo. See `sdk/README.md`.
- `ARCHITECTURE.md` — full design + verified integration map.

## Build / reproduce
```bash
cd move && sui move test          # contract tests
cd ../sdk && npm install && npm run demo   # live testnet end-to-end
```

MIT licensed. Contributions welcome — see CONTRIBUTING.md.
