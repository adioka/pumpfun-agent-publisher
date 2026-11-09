# pumpfun-agent-publisher
Static page that lets the owner (`BvnuEJdEr5oNct7mGsQC4PHMZPNBNt8XETqFydb83uDN`, hard-locked) publish the pumpfun Metaplex agent:
fund Irys (1 tx), upload image + 3 JSON (4 message signatures), then sign one combined Metaplex tx
(createCollection + create asset + registerIdentityV1). Collection/asset keypairs are generated in the
browser, kept in tab memory only, and wiped after confirmation. Every transaction is simulated before signing.
No server, no keys, no secrets. `files/*.json` contain placeholders only; the page fills `image` and `agentId` at run time.
RPC: solana-rpc.publicnode.com (fallback api.mainnet-beta.solana.com). Irys: uploader.irys.xyz.
`app.js` is an esbuild bundle of `src/app.js` from the builder workspace.
