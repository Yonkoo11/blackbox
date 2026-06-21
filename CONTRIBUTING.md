# Contributing to Blackbox

Thanks for your interest. Blackbox is MIT-licensed and contributions are welcome.

## Dev setup
- **Contracts:** [Sui CLI](https://docs.sui.io/) ≥ 1.68. `cd move && sui move test`.
- **SDK:** Node ≥ 20. `cd sdk && npm install && npm run test` (offline) / `npm run demo` (testnet).

## Ground rules
- Never commit secrets or private keys. Demo keys are ephemeral testnet throwaways in `.demo-keys.json` (gitignored).
- Keep the SDK hash layout byte-identical to the Move `compute_entry_hash` — `sdk/test/hash.test.ts`
  and the on-chain comparison in `verify` guard this. Any change to one must update the other.
- Add a Move test for any new `entry`/`public` function; add an SDK assertion for any new client method.

## Where to help
- DeepBook v3 reference trading agent (flagship demo).
- Verifier web app (replay UI).
- MemWal integration for semantic recall (secondary; must not become the trust path).
- zkLogin + sponsored-transaction onboarding.

## PRs
Open an issue describing the change first for anything non-trivial. Keep PRs focused; include the
test output you observed.
