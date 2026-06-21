## SECURITY — KEYS NEVER IN REPO OR CONTEXT (BLOCKING)

The deployer + operator + RPC keys live ONLY in `~/.zshenv`. Hard rules:

- **NEVER read `~/.zshenv`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile`, `~/.netrc`, `~/.npmrc`, `~/.git-credentials`, SSH keys, `*.key`, `*.pem`, or any `keystore/*` file.** Not `Read`, not `cat`, not `head`, not `grep -v`. Project + global hooks block these.
- **NEVER print, echo, or log key values.** `echo $KEY`, `print(os.getenv("KEY"))`, `vm.toString(pk)`, `console.log(process.env.KEY)` are banned.
- **NEVER commit `.env*`, `*.key`, `*.pem`, `keystore/`, `secrets/`** — covered by `.gitignore`. Verify `git diff --cached` before every save point.
- **NEVER use `git add -A` for the first save point in a new project.** Add by explicit file name.
- **Foundry deploys use `vm.envUint("DEPLOYER_PRIVATE_KEY")`** — reads process env at runtime. Never hardcode. Never `--private-key 0x...` on the CLI either.
- **Python agents use `os.getenv("OPERATOR_PRIVATE_KEY")`** — same pattern. Never `dotenv.load_dotenv("~/.zshenv")`. Never shell out to echo env vars.
- **Check var presence without seeing value:** `[ -n "$VARNAME" ] && echo "set"` or `echo "${#VARNAME}"` (length only).
- **If a key ever surfaces in chat or output, STOP. Tell the user to rotate. Do not paginate the value back into context.**

Full playbook: `SECURITY.md`. Read it before any deploy or signing work.

---

## Vibecoder Mode (communication)
- Never say: branch, commit, merge, PR, push, pull, HEAD, diff, npm, deploy, lint, env var. Instead say: version, save point, combine changes, publish, update, latest, changes, install, check code.
- Never show raw terminal output or error messages. Summarize in one sentence; describe changes by what the user SEES.
- Auto-save after every completed task (git add specific files + commit). Never ask. Update `ai/progress.md` with a "What Changed (Plain English)" section each task.
- Keep explanations to 1-3 sentences unless asked for more.

---

## Project: Blackbox — the flight recorder for AI agents

**Pitch:** Verifiable, tamper-evident, selectively-disclosable memory for autonomous AI agents, built on Sui + Walrus + Seal.

### Phase 1 Gate (MUST PASS BEFORE ANYTHING ELSE)
- **Core Action:** A reference agent takes a real on-chain action, writes a Seal-encrypted memory record of it to Walrus via the Blackbox SDK, and the verifier UI replays the record and *detects a tampered record* (rejects it on-chain).
- **Success Test (binary):** 3 agent actions recorded; verifier replays all 3; one hand-tampered blob is flagged INVALID and a clean blob is flagged VALID. Yes/No.
- **Min Tech:** Sui Move module (memory-record object + verify), Walrus blob write/read, Seal encrypt/decrypt, one TypeScript agent harness, minimal verifier UI.
- **NOT Phase 1:** multi-agent shared pools, fancy dashboard, DeepBook trading agent, reputation scores, billing.
- **Status:** [ ] NOT STARTED

### Hackathon context
- **Event:** Sui Overflow 2026 · **Track:** Walrus (specialized, $70K pool, headline sponsor) · **Deadline:** June 21 6PM PT · Shortlist Jul 8 · Demo Day Jul 20 · Winners Aug 27.
- **Judging:** Real-World Application 50% · Product/UX 20% · Technical 20% · Presentation 10%.
- **Deliverables:** public repo (MIT + README + CONTRIBUTING), demo video ≤5 min, testnet/mainnet deploy + package ID, logo, live demo URL.
- **Payout:** 50% on win + 50% on mainnet deploy → deploy to mainnet for 100% upfront.

### Build order
Phase 1 (core action) → Phase 2 (real data flows) → Phase 3 (product complete: SDK + verifier + 1 flagship vertical demo) → Phase 4 (polish via /design). Open the live URL and do the core action BEFORE any CSS.

### Sponsor depth targets (see ai/sponsor-integration.md)
Walrus 5/5 (blob storage + MemWal SDK + Seal) — load-bearing. Sui object model 5/5. DeepBook 3/5 (flagship demo: an autonomous trading agent that records its decisions).

### Research base
`~/Projects/IDEAS-SUMMARY.md` (#53, #4) · `~/Projects/hackathon-winners/` (A4, B7).
