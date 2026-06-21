// Motion-mode recorder: drives the REAL live Blackbox verifier and records 6 clips.
// Each clip does its scene's motion at the tail; assembly trims each to its audio length.
import { chromium } from 'playwright';
import { mkdirSync, renameSync, readdirSync } from 'node:fs';

const SITE = process.env.BB_URL || 'https://yonkoo11.github.io/blackbox/';
const OUT = new URL('./clips/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const W = 1920, H = 1080;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fake cursor + smooth scroll helpers injected into the page
const HELPERS = `
  window.__cur = (()=>{ const c=document.createElement('div'); c.id='__cur';
    c.style.cssText='position:fixed;z-index:99999;width:22px;height:22px;left:0;top:0;pointer-events:none;transition:left .6s cubic-bezier(.23,1,.32,1),top .6s cubic-bezier(.23,1,.32,1);';
    c.innerHTML='<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 17 L6.5 12.5 L9.5 19 L12 18 L9 11.5 L15 11.5 Z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>';
    document.body.appendChild(c); return c; })();
  window.__moveCur = (x,y)=>{ window.__cur.style.left=x+'px'; window.__cur.style.top=y+'px'; };
  window.__scrollTo = (sel)=>{ const e=document.querySelector(sel); if(e) e.scrollIntoView({behavior:'smooth',block:'center'}); };
`;

async function clip(name, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'networkidle' });
  // wait for the verifier to finish (verdict rendered) + walrus blobs fetched
  await page.waitForSelector('.verdict', { timeout: 45000 });
  await page.waitForSelector('.tape .rec', { timeout: 45000 });
  await page.addScriptTag({ content: HELPERS });
  await sleep(700);
  await fn(page);
  await sleep(500);
  const vid = page.video();
  await ctx.close();           // finalizes the recording
  await browser.close();
  const saved = await vid.path();
  renameSync(saved, OUT + name + '.webm');
  console.log('saved', name);
}

// c1: hero + inclusion proof — settle at top on the verdict
await clip('c1', async (p) => { await p.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'})); await sleep(4200); });
// c2: guardrail card
await clip('c2', async (p) => { await p.evaluate(()=>window.__scrollTo('.policy')); await sleep(3800); });
// c3: record tape
await clip('c3', async (p) => { await p.evaluate(()=>window.__scrollTo('.tape')); await sleep(3600); });
// c4: money-shot setup — cursor to the seq-1 flip toggle
await clip('c4', async (p) => {
  await p.evaluate(()=>window.__scrollTo('.tape'));
  await sleep(900);
  const box = await p.locator('input[data-seq="1"]').boundingBox();
  if (box) await p.evaluate(([x,y])=>window.__moveCur(x,y), [box.x+8, box.y+4]);
  await sleep(2600);
});
// c5: money-shot payoff — click toggle, TAMPERED cascade, hold
await clip('c5', async (p) => {
  await p.evaluate(()=>window.__scrollTo('.tape'));
  await sleep(700);
  const box = await p.locator('input[data-seq="1"]').boundingBox();
  if (box) await p.evaluate(([x,y])=>window.__moveCur(x,y), [box.x+8, box.y+4]);
  await sleep(800);
  await p.locator('input[data-seq="1"]').click();
  await p.evaluate(()=>window.__scrollTo('.verdict'));   // show the seal turn red + recomputed mismatch
  await sleep(3600);
});
// c6: close — restore VERIFIED, hold on footer URL
await clip('c6', async (p) => {
  await p.locator('input[data-seq="1"]').click();        // toggle back -> VERIFIED
  await sleep(1200);
  await p.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));
  await sleep(4000);
});

console.log('all clips recorded:', readdirSync(OUT).filter(f=>f.endsWith('.webm')));
