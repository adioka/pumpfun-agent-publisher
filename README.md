# pumpfun-agent-publisher
Static page that lets the owner (`BvnuEJdEr5oNct7mGsQC4PHMZPNBNt8XETqFydb83uDN`, hard-locked) publish the pumpfun Metaplex agent:
fund Irys (1 tx), upload image + 3 JSON (4 message signatures), then sign one combined Metaplex tx
(createCollection + create asset + registerIdentityV1). Collection/asset keypairs are generated in the
browser, kept in tab memory only, and wiped after confirmation. Every transaction is simulated before signing.
No server, no keys, no secrets. `files/*.json` contain placeholders only; the page fills `image` and `agentId` at run time.
RPC: solana-rpc.publicnode.com (fallback api.mainnet-beta.solana.com). Irys: uploader.irys.xyz.
`app.js` is an esbuild bundle of `src/app.js` from the builder workspace.

## Musebook SIWS (`siws.html`)
Static Sign-In With Solana helper for Phantom mobile. The challenge is carried in the page URL (`?m=` or `#m=` base64url of the exact Musebook SIWS message) so a new nonce does not require a GitHub Pages redeploy. Locked to owner `BvnuEJdEr5oNct7mGsQC4PHMZPNBNt8XETqFydb83uDN`. The page validates a musebook.trade SIWS message for that wallet, shows the full message, then signs with Phantom and offers a Copy button. No keys, no server, no Musebook API calls (CORS is origin-locked).

## Update A2A / x402m services (`update-services.html`)
Locked to owner `BvnuEJdEr5oNct7mGsQC4PHMZPNBNt8XETqFydb83uDN`. Uploads a new ERC-8004 registration document (existing email service plus A2A and x402m endpoints for handle `pumpfun-aaron`) to Irys, then signs one mpl-core `UpdateExternalPluginAdapter` transaction that points the Core asset's AgentIdentity plugin URI at the new doc. The registry identity PDA does not store the URI. The page simulates the update on mainnet before offering a signature. No server, no keys.
