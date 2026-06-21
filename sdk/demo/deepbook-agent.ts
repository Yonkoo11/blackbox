/**
 * Autonomous DeepBook v3 trading agent on Sui testnet that records its decision
 * verifiably through the Blackbox SDK (Seal-encrypted, Walrus-stored, on-chain
 * tamper-evident memory).
 *
 * Loop: observe real market data -> decide -> attempt trade -> record -> verify.
 *
 *  1. Read REAL on-chain market data from the live SUI/DBUSDC pool: midPrice,
 *     pool book params (tick/lot/minSize), and a couple of level-2 ticks.
 *  2. Construct an ASK (sell) limit order at the pool minSize, one tick above mid,
 *     and attempt to place it. If the BalanceManager has enough SUI it RESTS and we
 *     print the tx digest; otherwise the on-chain abort is CAUGHT and its exact
 *     error message is printed. We never fake a fill.
 *  3. Record the decision through Blackbox (recordNote on the demo vault), with an
 *     explicit `orderOutcome` of `rested:<digest>` or `blocked:<error>`.
 *  4. verify() the vault — the new trade-decision must appear as the latest VALID
 *     entry, chainValid true.
 *
 * NOTE ON THE TYPE CAST: @mysten/deepbook-v3 bundles its own copy of @mysten/sui,
 * so the `Transaction` it expects is a *different class instance* from the
 * `Transaction` we import at the top level. The two are structurally identical at
 * runtime, so we cast our Transaction to `any` when handing it to DeepBook builder
 * functions. This is the only place `as any` is used for that reason.
 *
 * Uses the EPHEMERAL throwaway agent key in .demo-keys.json (testnet only).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { BlackboxClient } from '../src/client.js';

const PACKAGE_ID = process.env.BLACKBOX_PKG ?? '0xc2a851cb0cd8603740fe0b838623b341652fd8f7945fcb1351f8ca158e9c5225';
const DEMO_VAULT = process.env.BLACKBOX_VAULT ?? '0x8d1e23c0619253dffcaf004bc32781bf62d25664f7cd18ab593891da781a6516';
const POOL = 'SUI_DBUSDC'; // base = SUI, quote = DBUSDC
const KEYS_PATH = new URL('../.demo-keys.json', import.meta.url);

const ASK_MARKUP = 1.05; // place ask ~5% above mid so it would rest (does not cross)

const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Keys {
  owner: string;
  agent: string;
  ownerAddr: string;
  agentAddr: string;
  balanceManagerId?: string;
}

function loadKeys(): Keys {
  return JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
}
function saveKeys(k: Keys) {
  writeFileSync(KEYS_PATH, JSON.stringify(k, null, 2) + '\n');
}

async function exec(signer: Ed25519Keypair, tx: Transaction, label: string, gasBudgetMist?: bigint) {
  // The DeepBook SDK sets a high default GAS_BUDGET (~0.25 SUI). The ephemeral
  // throwaway holds little SUI, so cap the budget for the cheap order/cancel txs.
  if (gasBudgetMist) tx.setGasBudget(gasBudgetMist);
  const res = await rpc.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showObjectChanges: true, showEffects: true },
  });
  const status = res.effects?.status?.status;
  if (status !== 'success') {
    // Surface the on-chain abort verbatim (move abort code / module), not a generic message.
    const reason = res.effects?.status?.error ?? JSON.stringify(res.effects?.status);
    throw new Error(`${label} aborted on-chain: ${reason} (digest ${res.digest})`);
  }
  return res;
}

/** Round a price to a multiple of the pool tick size. */
function roundToTick(price: number, tick: number): number {
  const n = Math.round(price / tick);
  return Number((n * tick).toFixed(12));
}

async function main() {
  const k = loadKeys();
  const agent = Ed25519Keypair.fromSecretKey(k.agent);
  const agentAddr = agent.toSuiAddress();
  console.log('Agent address :', agentAddr);
  if (agentAddr !== k.agentAddr) throw new Error('loaded agent key does not match agentAddr');

  const bal = await rpc.getBalance({ owner: agentAddr });
  console.log('Agent SUI     :', (Number(bal.totalBalance) / 1e9).toFixed(4), 'SUI');
  if (BigInt(bal.totalBalance) < 30_000_000n) {
    throw new Error('agent has < 0.03 SUI; cannot pay gas. Fund ' + agentAddr);
  }

  // ---- BalanceManager: reuse the persisted one, or create+share once ---------
  let managerId = k.balanceManagerId;
  if (managerId) {
    const obj = await rpc.getObject({ id: managerId, options: { showType: true } });
    if (!obj.data) {
      console.log('persisted BalanceManager not found on chain, creating a new one');
      managerId = undefined;
    } else {
      console.log('BalanceManager :', managerId, '(reused)');
    }
  }
  if (!managerId) {
    const dbCreate = new DeepBookClient({ client: rpc as any, address: agentAddr, env: 'testnet' });
    const tx = new Transaction();
    dbCreate.balanceManager.createAndShareBalanceManager()(tx as any);
    const res = await exec(agent, tx, 'createAndShareBalanceManager', 60_000_000n);
    for (const c of res.objectChanges ?? []) {
      if (c.type === 'created' && (c as any).objectType?.includes('::balance_manager::BalanceManager')) {
        managerId = (c as any).objectId;
      }
    }
    if (!managerId) throw new Error('BalanceManager object id not found in objectChanges');
    console.log('BalanceManager :', managerId, '(created, digest', res.digest + ')');
    k.balanceManagerId = managerId;
    saveKeys(k);
  }

  // DeepBookClient wired with our manager under key "MANAGER_1".
  const db = new DeepBookClient({
    client: rpc as any,
    address: agentAddr,
    env: 'testnet',
    balanceManagers: { MANAGER_1: { address: managerId } },
  });

  let mgrSui = 0;
  try {
    mgrSui = (await db.checkManagerBalance('MANAGER_1', 'SUI')).balance;
  } catch (e: any) {
    console.log('checkManagerBalance note    :', e?.message ?? e);
  }
  console.log('Manager SUI balance         :', mgrSui, 'SUI');

  // ---- Step 1: observe REAL on-chain market data --------------------------
  const observedMidPrice = await db.midPrice(POOL);
  const bookParams = await db.poolBookParams(POOL); // { tickSize, lotSize, minSize }
  const book = await db.getLevel2TicksFromMid(POOL, 2);
  console.log('\n=== live SUI/DBUSDC market (on-chain read) ===');
  console.log('midPrice                    :', observedMidPrice);
  console.log('book params                 :', JSON.stringify(bookParams));
  console.log('best bids (price x qty)      :',
    (book.bid_prices ?? []).slice(0, 2).map((p, i) => `${p} x ${book.bid_quantities?.[i]}`).join('  |  ') || '(none)');
  console.log('best asks (price x qty)      :',
    (book.ask_prices ?? []).slice(0, 2).map((p, i) => `${p} x ${book.ask_quantities?.[i]}`).join('  |  ') || '(none)');

  // ---- Step 2: construct the ASK at minSize, slightly above mid -----------
  // Quantity = pool minSize (the smallest order the book accepts). Price rounded
  // to the real pool tick, max(mid*markup, bestAsk + 1 tick) so it would rest.
  const tick = bookParams.tickSize;
  const quantity = bookParams.minSize;
  const bestAsk = book.ask_prices?.[0];
  const targetPrice = Math.max(observedMidPrice * ASK_MARKUP, (bestAsk ?? observedMidPrice) + tick);
  const price = roundToTick(targetPrice, tick);
  const clientOrderId = String(Date.now());
  const reasoning =
    `Passive maker: sell ${quantity} SUI (= pool minSize) ASK @ ${price} ` +
    `(= max(mid*${ASK_MARKUP}, bestAsk+1tick), rounded to tick ${tick}) so it rests ` +
    `above the observed mid ${observedMidPrice} without crossing the spread. Fees paid in SUI (payWithDeep:false).`;
  console.log('\nDecision                    : ASK', quantity, 'SUI @', price, '| clientOrderId', clientOrderId);

  // ---- attempt to place the order. RESTS -> digest, else CATCH the error --
  let orderOutcome = '';
  let orderDigest = '';
  let orderError = '';
  let orderRested = false;
  let placedOrderId = '';
  try {
    const tx = new Transaction();
    db.deepBook.placeLimitOrder({
      poolKey: POOL,
      balanceManagerKey: 'MANAGER_1',
      clientOrderId,
      price,
      quantity,
      isBid: false, // ASK / sell base (SUI)
      payWithDeep: false, // pay fees in input asset, no DEEP needed
    })(tx as any);
    const res = await exec(agent, tx, 'placeLimitOrder', 40_000_000n);
    orderDigest = res.digest;
    await sleep(2000);
    const open = await db.accountOpenOrders(POOL, 'MANAGER_1');
    placedOrderId = open[open.length - 1] ?? '';
    orderRested = open.length > 0;
    orderOutcome = `rested:${orderDigest}`;
    console.log('Order tx digest             :', orderDigest);
    console.log('Open orders on book         :', JSON.stringify(open), orderRested ? '(RESTING)' : '(submitted, none open)');
  } catch (e: any) {
    orderError = (e?.message ?? String(e)).replace(/\s+/g, ' ').trim();
    orderOutcome = `blocked:${orderError}`;
    console.log('Order placement BLOCKED     :', orderError);
  }

  // ---- Step 3: record the decision verifiably through Blackbox ------------
  const bb = new BlackboxClient(PACKAGE_ID);
  const decision = {
    type: 'trade-decision',
    pool: POOL,
    observedMidPrice,
    side: 'ask' as const,
    price,
    quantity,
    clientOrderId,
    orderOutcome, // 'rested:<digest>' | 'blocked:<error>'
    reasoning,
    ts: new Date().toISOString(),
  };
  const rec = await bb.recordNote(agent, DEMO_VAULT, decision);
  console.log('\nBlackbox record tx digest   :', rec.digest);
  console.log('Blackbox Walrus blobId      :', rec.blobId);

  // ---- Step 4: verify -- the trade-decision must be the latest VALID row ---
  await sleep(2000);
  const v = await bb.verify(DEMO_VAULT);
  console.log('\n=== verify(DEMO_VAULT) ===');
  console.log('chainValid                  :', v.chainValid);
  for (const r of v.rows) {
    console.log(`  seq ${r.seq}  amount ${r.amount}  ${r.status}  blob ${r.blobId.slice(0, 14)}…`);
  }

  // ---- cancel a resting order so it doesn't lock balance across runs -------
  if (orderRested && placedOrderId) {
    try {
      const tx = new Transaction();
      db.deepBook.cancelOrder(POOL, 'MANAGER_1', placedOrderId)(tx as any);
      const res = await exec(agent, tx, 'cancelOrder', 30_000_000n);
      console.log('\nCancelled resting order     :', placedOrderId, '(digest', res.digest + ')');
    } catch (e: any) {
      console.log('\ncancelOrder note            :', (e?.message ?? e));
    }
  }

  // ---- final evidence block -----------------------------------------------
  const latest = v.rows[v.rows.length - 1];
  console.log('\n========== EVIDENCE ==========');
  console.log('observed mid price          :', observedMidPrice);
  console.log('BalanceManager object id    :', managerId);
  console.log('order outcome               :', orderOutcome);
  console.log('Blackbox record tx digest   :', rec.digest);
  console.log('verify chainValid           :', v.chainValid);
  console.log('verify rows                 :', v.rows.length, latest ? `(latest seq ${latest.seq} = ${latest.status})` : '');
  console.log('==============================');
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack ?? e);
  process.exit(1);
});
