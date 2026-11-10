// Update the on-chain AgentIdentity plugin URI after uploading a new ERC-8004 registration doc.
// Owner is HARD-LOCKED. Never holds keys. Never broadcasts except via the owner's signed tx.
import { Buffer } from 'buffer';
import { WebUploader } from '@irys/web-upload';
import { WebSolana } from '@irys/web-upload-solana';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey, createNoopSigner, signerIdentity } from '@metaplex-foundation/umi';
import { mplCore, fetchAsset, fetchCollection, updatePlugin } from '@metaplex-foundation/mpl-core';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';

const OWNER = 'BvnuEJdEr5oNct7mGsQC4PHMZPNBNt8XETqFydb83uDN';
const ASSET = '9kdRgbA6gCJwBMzRwX4Rjx7cmoLNzqMyd4B8PET7nDBu';
const COLLECTION = '7qhGumCGixQdLs1ZbDXrNdvwVbnpPCxag72aNG2dphkK';
const IDENTITY = 'FBhzVpJbtt6K1Bq1nNJaDqR1RBeKKVnbuHX5cw51kzDw';
const QS = new URLSearchParams(location.search);
const NET = QS.get('network') === 'devnet' ? 'devnet' : 'mainnet';
const CFG = { owner: NET === 'devnet' && QS.get('testOwner') ? QS.get('testOwner') : OWNER, network: NET };
const RPCS = NET === 'devnet' ? ['https://api.devnet.solana.com'] : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
let RPC = RPCS[0];
const GATEWAY = 'https://gateway.irys.xyz/';
const $ = (id) => document.getElementById(id);
const log = (msg, cls = '') => { const p = document.createElement('div'); p.className = cls; p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; $('log').prepend(p); };
const lam = (n) => `${Number(n).toLocaleString()} lamports (${(Number(n) / 1e9).toFixed(9)} SOL)`;
const RENT0 = 650240n;
const FEE = 5000n;
const MIN_SOL = RENT0 + FEE + 20000n; // rent-exempt after fee + small buffer

const S = { provider: null, wallet: null, irys: null, umi: null, doc: null, bytes: null, need: 0n, uri: null, built: null, done: false };

async function pickRpc() {
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] }) });
      const j = await r.json();
      if (j.result?.value?.blockhash) { RPC = u; return u; }
    } catch {}
  }
  throw new Error('No Solana RPC reachable from this browser: ' + RPCS.join(', '));
}
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
function injected() {
  if (window.phantom?.solana?.isPhantom) return { name: 'Phantom', p: window.phantom.solana };
  if (window.backpack?.isBackpack || window.backpack) return { name: 'Backpack', p: window.backpack };
  if (window.solana) return { name: 'Injected wallet', p: window.solana };
  return null;
}
function step(n) { document.querySelectorAll('[data-step]').forEach((b) => { b.disabled = Number(b.dataset.step) !== n; }); }

async function connect() {
  const w = injected();
  if (!w) { log('No Solana wallet found. Open this page inside Phantom (in-app browser) or a desktop browser with the extension.', 'err'); return; }
  const res = await w.p.connect();
  const pk = new PublicKey((res?.publicKey ?? w.p.publicKey).toString());
  if (pk.toBase58() !== CFG.owner) { log(`Connected ${pk.toBase58()} but this flow is locked to owner ${CFG.owner}. Switch accounts and reconnect.`, 'err'); return; }
  S.provider = w.p;
  S.wallet = {
    publicKey: pk,
    signMessage: async (msg) => { const r = await w.p.signMessage(msg, 'utf8'); return r?.signature ?? r; },
    signTransaction: (tx) => w.p.signTransaction(tx),
  };
  $('who').textContent = `${w.name}: ${pk.toBase58()}`;
  log(`Connected ${w.name} ${pk.toBase58()}`, 'ok');
  await prepare();
}

async function prepare() {
  log('RPC: ' + await pickRpc());
  S.umi = createUmi(RPC).use(mplCore());
  S.umi.use(signerIdentity(createNoopSigner(publicKey(CFG.owner))));
  const r = await fetch('files/registration.json?v=services1', { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load registration.json');
  S.doc = await r.json();
  S.bytes = new TextEncoder().encode(JSON.stringify(S.doc, null, 2) + '\n');
  $('doc').textContent = new TextDecoder().decode(S.bytes);
  const asset = await fetchAsset(S.umi, publicKey(ASSET));
  const current = asset.agentIdentities?.[0]?.uri || '(none)';
  $('onchain').textContent = `asset ${ASSET}\ncollection ${COLLECTION}\nidentity PDA ${IDENTITY}\ncurrent registration URI:\n${current}`;
  const sol = BigInt((await rpc('getBalance', [CFG.owner, { commitment: 'confirmed' }])).value);
  $('sol').textContent = `Wallet SOL: ${lam(sol)}  (need about ${lam(MIN_SOL)} after Irys, to stay rent-exempt and pay the 5,000-lamport fee)`;
  if (sol < MIN_SOL) {
    log(`This wallet only has ${lam(sol)}. The update transaction will fail (InsufficientFundsForRent) unless you add a little SOL first — about 0.002 SOL is a comfortable buffer. Irys already has enough credit, so you do not need to fund Irys.`, 'err');
  }
  let b = WebUploader(WebSolana).withProvider(S.wallet).withRpc(RPC);
  if (NET === 'devnet') b = b.devnet();
  S.irys = await b;
  await quote();
  step(2);
}

async function quote() {
  const price = BigInt((await S.irys.getPrice(S.bytes.length)).toFixed(0));
  const bal = BigInt((await S.irys.getLoadedBalance()).toFixed(0));
  const margin = price / 5n + 2000n;
  const need = price + margin > bal ? price + margin - bal : 0n;
  S.need = need;
  $('quote').textContent = `registration.json: ${S.bytes.length} B -> ${lam(price)}\nIrys balance for owner: ${lam(bal)}\nto fund now (incl. 20% buffer): ${need === 0n ? 'none — already covered' : lam(need) + ' + Solana tx fee'}`;
  return need;
}

async function fund() {
  const need = await quote();
  if (need === 0n) { log('Irys balance already sufficient; skipping fund transaction.', 'ok'); step(3); return; }
  const sol = BigInt((await rpc('getBalance', [CFG.owner, { commitment: 'confirmed' }])).value);
  if (sol < need + MIN_SOL) {
    log(`Not enough SOL to fund Irys and still pay the later update fee. Add about 0.002 SOL first.`, 'err');
    return;
  }
  log(`Requesting wallet signature to fund Irys with ${lam(need)} ...`);
  const r = await S.irys.fund(need.toString());
  log(`Irys funded: tx ${r.id}, credited ${r.quantity}`, 'ok');
  await quote();
  step(3);
}

async function upload() {
  log('Sign the Irys data item for registration.json (message signature, no SOL moves)...');
  const r = await S.irys.upload(Buffer.from(S.bytes), { tags: [{ name: 'Content-Type', value: 'application/json' }, { name: 'App-Name', value: 'pumpfun-agent' }] });
  S.uri = GATEWAY + r.id;
  log(`Uploaded: ${S.uri}`, 'ok');
  $('uri').textContent = S.uri;
  step(4);
  await build();
}

async function build() {
  if (!S.uri) throw new Error('Upload the new registration doc first');
  const umi = S.umi;
  const asset = await fetchAsset(umi, publicKey(ASSET));
  const collection = await fetchCollection(umi, publicKey(COLLECTION));
  const builder = updatePlugin(umi, {
    asset: asset.publicKey,
    collection: collection.publicKey,
    payer: umi.identity,
    authority: umi.identity,
    plugin: { type: 'AgentIdentity', key: { type: 'AgentIdentity' }, uri: S.uri },
  });
  const bh = await umi.rpc.getLatestBlockhash({ commitment: 'confirmed' });
  const tx = builder.setBlockhash(bh).build(umi);
  const bytes = umi.transactions.serialize(tx);
  S.built = { tx, bh, b64: Buffer.from(bytes).toString('base64') };
  const sim = await rpc('simulateTransaction', [S.built.b64, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [ASSET, COLLECTION, CFG.owner] } }]);
  const v = sim.value;
  const postAsset = v.accounts?.[0]?.lamports;
  $('sim').textContent = `tx ${bytes.length} bytes, 1 signature (owner, as payer + collection update authority)\nsimulation: ${v.err ? 'ERROR ' + JSON.stringify(v.err) : 'OK'}; ${v.unitsConsumed} CU\nnetwork fee: ${lam(FEE)}\nlast logs:\n${(v.logs || []).slice(-6).join('\n')}`;
  if (v.err) {
    const msg = JSON.stringify(v.err);
    log('Simulation failed; not offering signature. ' + msg, 'err');
    if (msg.includes('InsufficientFundsForRent')) {
      log('Add a little SOL to this wallet (about 0.002 SOL is enough) and press Rebuild / re-simulate.', 'err');
    }
    return;
  }
  step(5);
  log('Built and simulated OK. Review, then sign the update transaction.', 'ok');
}

async function signAndSend() {
  const conn = new Connection(RPC, 'confirmed');
  const sol = BigInt((await rpc('getBalance', [CFG.owner, { commitment: 'confirmed' }])).value);
  if (sol < MIN_SOL) {
    log(`Wallet only has ${lam(sol)}. Add about 0.002 SOL first or the send will fail rent checks.`, 'err');
    return;
  }
  const height = await conn.getBlockHeight('confirmed');
  if (height > S.built.bh.lastValidBlockHeight - 20) { log('Blockhash stale; rebuilding...'); await build(); if (!S.built) return; }
  const vtx = toWeb3JsTransaction(S.built.tx);
  log('Requesting your wallet signature for the AgentIdentity URI update...');
  const signed = await S.wallet.signTransaction(vtx);
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
  log(`Sent: ${sig}. Confirming...`);
  let st = null;
  for (let i = 0; i < 90 && !st; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) st = s;
    else if ((await conn.getBlockHeight('confirmed')) > S.built.bh.lastValidBlockHeight) break;
  }
  if (!st) { log(`Not confirmed before blockhash expiry. Check ${sig} on an explorer; if absent, press Rebuild then Sign again.`, 'err'); step(4); return; }
  if (st.err) { log('Transaction failed: ' + JSON.stringify(st.err), 'err'); return; }
  const cluster = NET === 'devnet' ? '?cluster=devnet' : '';
  log(`Confirmed. New registration URI ${S.uri} — https://solscan.io/tx/${sig}${cluster}`, 'ok');
  $('result').textContent = `tx: ${sig}\nnew URI: ${S.uri}\nasset: ${ASSET}\nidentity: ${IDENTITY}\n\nVerify: the AgentIdentity plugin URI on the asset should now equal the new Irys URL, and https://musebook.trade/api/metaplex/agents/${ASSET}?network=solana-mainnet should list the A2A and x402m services once it reindexes.`;
  S.done = true;
  step(0);
}

const guard = (fn) => async () => { try { await fn(); } catch (e) { log(String(e?.message || e), 'err'); console.error(e); } };
$('net').textContent = NET;
$('owner').textContent = CFG.owner;
$('b1').onclick = guard(connect);
$('b2').onclick = guard(fund);
$('b3').onclick = guard(upload);
$('b4').onclick = guard(build);
$('b5').onclick = guard(signAndSend);
step(1);
