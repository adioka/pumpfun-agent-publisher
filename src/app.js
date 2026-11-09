// pumpfun agent publisher — runs entirely in the OWNER's browser.
// The owner's wallet (Phantom/Backpack) signs: 1 Irys fund tx, 4 Irys data items (signMessage), 1 Metaplex tx.
// Collection/asset keypairs are generated here, in memory only, and are wiped after confirmation or on page close.
import { Buffer } from 'buffer';
import { WebUploader } from '@irys/web-upload';
import { WebSolana } from '@irys/web-upload-solana';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey, createNoopSigner, signerIdentity, generateSigner, transactionBuilder } from '@metaplex-foundation/umi';
import { mplCore, createCollection, create, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { mplAgentIdentity, registerIdentityV1, findAgentIdentityV1Pda } from '@metaplex-foundation/mpl-agent-registry';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';

// Static-site config. Owner is HARD-LOCKED. ?network=devnet is for testing only.
const OWNER = 'BvnuEJdEr5oNct7mGsQC4PHMZPNBNt8XETqFydb83uDN';
const QS = new URLSearchParams(location.search);
const NET = QS.get('network') === 'devnet' ? 'devnet' : 'mainnet';
// Test hook: ?testOwner= only honoured on devnet (never on mainnet).
const CFG = { owner: NET === 'devnet' && QS.get('testOwner') ? QS.get('testOwner') : OWNER, network: NET };
const RPCS = NET === 'devnet' ? ['https://api.devnet.solana.com'] : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
let RPC = RPCS[0];
async function pickRpc() {
  for (const u of RPCS) {
    try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] }) }); const j = await r.json(); if (j.result?.value?.blockhash) { RPC = u; return u; } } catch {}
  }
  throw new Error('No Solana RPC reachable from this browser: ' + RPCS.join(', '));
}
const GATEWAY = 'https://gateway.irys.xyz/';
const $ = (id) => document.getElementById(id);
const log = (msg, cls = '') => { const p = document.createElement('div'); p.className = cls; p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; $('log').prepend(p); };
const lam = (n) => `${Number(n).toLocaleString()} lamports (${(Number(n) / 1e9).toFixed(9)} SOL)`;

const S = { provider: null, wallet: null, irys: null, umi: null, collection: null, asset: null, docs: null, files: {}, uris: {}, built: null, done: false };
window.addEventListener('beforeunload', (e) => { if (S.asset && !S.done) { e.preventDefault(); e.returnValue = ''; } });

function injected() {
  if (window.phantom?.solana?.isPhantom) return { name: 'Phantom', p: window.phantom.solana };
  if (window.backpack?.isBackpack || window.backpack) return { name: 'Backpack', p: window.backpack };
  if (window.solana) return { name: 'Injected wallet', p: window.solana };
  return null;
}

function step(n) { document.querySelectorAll('[data-step]').forEach((b) => { b.disabled = Number(b.dataset.step) !== n; }); }

async function connect() {
  const w = injected();
  if (!w) { log('No Solana wallet found in this browser. Open this page inside Phantom/Backpack (mobile in-app browser) or a desktop browser with the extension.', 'err'); return; }
  const res = await w.p.connect();
  const pk = new PublicKey((res?.publicKey ?? w.p.publicKey).toString());
  if (pk.toBase58() !== CFG.owner) { log(`Connected ${pk.toBase58()} but this flow is locked to owner ${CFG.owner}. Switch accounts and reconnect.`, 'err'); return; }
  S.provider = w.p;
  S.wallet = {
    publicKey: pk,
    signMessage: async (msg) => { const r = await w.p.signMessage(msg, 'utf8'); return r?.signature ?? r; },
    signTransaction: (tx) => w.p.signTransaction(tx),
    sendTransaction: async (tx, conn, opts) => { const signed = await w.p.signTransaction(tx); return conn.sendRawTransaction(signed.serialize(), opts); },
  };
  $('who').textContent = `${w.name}: ${pk.toBase58()}`;
  log(`Connected ${w.name} ${pk.toBase58()}`);
  await prepare();
}

async function loadText(name) { const r = await fetch(`files/${name}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`load ${name}: ${r.status}`); return r; }

async function prepare() {
  log('RPC: ' + await pickRpc());
  S.umi = createUmi(RPC).use(mplCore()).use(mplAgentIdentity());
  S.umi.use(signerIdentity(createNoopSigner(publicKey(CFG.owner))));
  // 1) keys first -> asset address known before anything is uploaded (fixes the agentId ordering problem)
  S.collection = generateSigner(S.umi);
  S.asset = generateSigner(S.umi);
  const [assetSigner] = findAssetSignerPda(S.umi, { asset: S.asset.publicKey });
  const [agentIdentity] = findAgentIdentityV1Pda(S.umi, { asset: S.asset.publicKey });
  $('keys').textContent = `collection ${S.collection.publicKey}\nasset (agentId) ${S.asset.publicKey}\nasset signer PDA ${assetSigner}\nagent identity PDA ${agentIdentity}`;
  const [img, asset, coll, reg] = await Promise.all(['pumpfun-agent.jpg', 'asset.json', 'collection.json', 'registration.json'].map(loadText));
  S.files.image = new Uint8Array(await img.arrayBuffer());
  S.docs = { asset: await asset.json(), collection: await coll.json(), registration: await reg.json() };
  S.docs.registration.registrations = [{ agentId: S.asset.publicKey.toString(), agentRegistry: 'solana:101:metaplex' }];
  renderDocs();
  // 2) Irys client (owner wallet signs); quote real sizes
  let b = WebUploader(WebSolana).withProvider(S.wallet).withRpc(RPC);
  if (NET === 'devnet') b = b.devnet();
  S.irys = await b;
  await quote();
  step(2);
}

function docBytes(name, imageUri = GATEWAY + 'x'.repeat(43)) {
  const d = structuredClone(S.docs[name]);
  d.image = imageUri;
  if (name === 'asset') d.properties = { ...(d.properties || {}), category: 'image', files: [{ uri: imageUri, type: 'image/jpeg' }] };
  return new TextEncoder().encode(JSON.stringify(d, null, 2));
}
function renderDocs() { $('docs').textContent = ['asset', 'collection', 'registration'].map((n) => `--- ${n}.json\n${new TextDecoder().decode(docBytes(n, S.uris.image || '(image URI after upload)'))}`).join('\n'); }

async function quote() {
  const sizes = { image: S.files.image.length, asset: docBytes('asset').length, collection: docBytes('collection').length, registration: docBytes('registration').length };
  let total = 0n; const lines = [];
  for (const [k, v] of Object.entries(sizes)) { const p = BigInt((await S.irys.getPrice(v)).toFixed(0)); total += p; lines.push(`${k}: ${v} B -> ${lam(p)}`); }
  const bal = BigInt((await S.irys.getLoadedBalance()).toFixed(0));
  const margin = total / 5n + 2000n;                     // +20% price drift buffer
  const need = total + margin > bal ? total + margin - bal : 0n;
  S.need = need;
  $('quote').textContent = `${lines.join('\n')}\nupload total: ${lam(total)}\nIrys balance for owner: ${lam(bal)}\nto fund now (incl. 20% buffer): ${lam(need)} + Solana tx fee`;
  return need;
}

async function fund() {
  const need = await quote();
  if (need === 0n) { log('Irys balance already sufficient; skipping fund.'); step(3); return; }
  log(`Requesting wallet signature to fund Irys with ${lam(need)} ...`);
  const r = await S.irys.fund(need.toString());
  log(`Irys funded: tx ${r.id}, credited ${r.quantity}`, 'ok');
  await quote(); step(3);
}

async function upOne(name, bytes, type) {
  log(`Sign data item for ${name} (message signature, no SOL moves)...`);
  const r = await S.irys.upload(Buffer.from(bytes), { tags: [{ name: 'Content-Type', value: type }, { name: 'App-Name', value: 'pumpfun-agent' }] });
  S.uris[name] = GATEWAY + r.id; log(`${name} -> ${S.uris[name]}`, 'ok'); return S.uris[name];
}

async function upload() {
  if (!S.uris.image) await upOne('image', S.files.image, 'image/jpeg');
  renderDocs();
  for (const n of ['collection', 'asset', 'registration']) if (!S.uris[n]) await upOne(n, docBytes(n, S.uris.image), 'application/json');
  $('uris').textContent = Object.entries(S.uris).map(([k, v]) => `${k}: ${v}`).join('\n');
  localStorage.setItem('pumpfun-agent-uris', JSON.stringify({ ...S.uris, asset_address: S.asset.publicKey.toString() })); // public data only
  step(4); await build();
}

async function build() {
  const u = S.umi, owner = u.identity;
  const b = transactionBuilder()
    .add(createCollection(u, { collection: S.collection, name: 'pumpfun agent', uri: S.uris.collection, updateAuthority: owner.publicKey, payer: owner }))
    .add(create(u, { asset: S.asset, collection: { publicKey: S.collection.publicKey }, name: 'pumpfun', uri: S.uris.asset, owner: owner.publicKey, authority: owner, payer: owner }))
    .add(registerIdentityV1(u, { asset: S.asset.publicKey, collection: S.collection.publicKey, payer: owner, authority: owner, agentRegistrationUri: S.uris.registration }));
  const bh = await u.rpc.getLatestBlockhash({ commitment: 'confirmed' });
  let tx = b.setBlockhash(bh).build(u);
  tx = await S.collection.signTransaction(tx);
  tx = await S.asset.signTransaction(tx);
  const bytes = u.transactions.serialize(tx);
  S.built = { tx, bh, b64: Buffer.from(bytes).toString('base64') };
  const sim = await rpc('simulateTransaction', [S.built.b64, { encoding: 'base64', sigVerify: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [S.collection.publicKey.toString(), S.asset.publicKey.toString(), findAgentIdentityV1Pda(u, { asset: S.asset.publicKey })[0].toString()] } }]);
  const v = sim.value; const rent = (v.accounts || []).reduce((s, a) => s + (a?.lamports || 0), 0);
  $('sim').textContent = `tx ${bytes.length} bytes, 3 signatures (owner + 2 presigned throwaway)\nsimulation: ${v.err ? 'ERROR ' + JSON.stringify(v.err) : 'OK'}; ${v.unitsConsumed} CU\nrent created: ${lam(rent)}\nnetwork fee: ${lam(15000)}\nlast logs:\n${(v.logs || []).slice(-4).join('\n')}`;
  if (v.err) { log('Simulation failed; not offering signature. ' + JSON.stringify(v.err), 'err'); return; }
  step(5); log('Built and simulated. Review, then sign with your wallet.', 'ok');
}

async function rpc(method, params) { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`); return j.result; }

async function signAndSend() {
  const conn = new Connection(RPC, 'confirmed');
  const height = await conn.getBlockHeight('confirmed');
  if (height > S.built.bh.lastValidBlockHeight - 20) { log('Blockhash stale; rebuilding with the SAME asset/collection keys...'); await build(); }
  const vtx = toWeb3JsTransaction(S.built.tx);
  log('Requesting your wallet signature for the Metaplex agent transaction...');
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
  if (!st) { log(`Not confirmed before blockhash expiry. Check ${sig} on an explorer; if absent, press Rebuild then Sign again (same asset address).`, 'err'); step(4); return; }
  if (st.err) { log('Transaction failed: ' + JSON.stringify(st.err), 'err'); return; }
  const cluster = NET === 'devnet' ? '?cluster=devnet' : '';
  log(`Confirmed. Agent asset ${S.asset.publicKey} — https://solscan.io/tx/${sig}${cluster}`, 'ok');
  $('result').textContent = `asset: ${S.asset.publicKey}\ncollection: ${S.collection.publicKey}\ntx: ${sig}\n${Object.entries(S.uris).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  S.done = true; S.collection = null; S.asset = null; S.built = null; // wipe throwaway keys
  step(0);
}

const guard = (fn) => async () => { try { await fn(); } catch (e) { log(String(e?.message || e), 'err'); console.error(e); } };
$('net').textContent = NET; $('owner').textContent = CFG.owner;
$('b1').onclick = guard(connect); $('b2').onclick = guard(fund); $('b3').onclick = guard(upload); $('b4').onclick = guard(build); $('b5').onclick = guard(signAndSend);
step(1);
window.__test__ = { S, quote, build, prepare, docBytes };
