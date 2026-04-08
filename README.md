# @cashmint/sdk

[![npm](https://img.shields.io/npm/v/@cashmint/sdk)](https://www.npmjs.com/package/@cashmint/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official TypeScript SDK for [CashMintStandard](https://github.com/BCH-CashMint/cashmintstandard) NFTs on Bitcoin Cash CashTokens.

Signing is delegated to the user's wallet (Cashonize, Paytaca, Zapit) via WalletConnect V2. IPFS pinning is handled by a pluggable provider (Pinata, self-hosted Kubo, or your own). The SDK handles everything else: metadata validation, commitment encoding, transaction building, and broadcasting.

## Installation

```bash
npm install @cashmint/sdk
```

## Core concepts

### Signer — `CashMintSigner`

The SDK asks your signer to do two things:

```ts
interface CashMintSigner {
  /** Return the P2PKH locking bytecode for the minting address. */
  getLockingBytecode(): Promise<Uint8Array>;

  /** Sign (and optionally broadcast) the unsigned mint transaction. */
  signTransaction(req: SignTransactionRequest): Promise<SignTransactionResult>;
}
```

Implement this interface with any BCH wallet. See [`examples/ui/src/WalletConnectSigner.ts`](examples/ui/src/WalletConnectSigner.ts) for a complete WalletConnect V2 implementation that works with Cashonize, Paytaca, and Zapit.

### IPFS provider — `IpfsProvider`

```ts
interface IpfsProvider {
  /** Pin metadata JSON to IPFS and return the CID string. */
  pin(metadata: object): Promise<string>;
}
```

The SDK ships `PinataProvider` out of the box. Pass your own object to use any other IPFS service.

---

## Quick start

### 1. Validate metadata

```ts
import { validate } from "@cashmint/sdk";

const result = validate({
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
  cms_version: "1.0",
  name: "Mystic Tiger #001",
  description: "A legendary fire tiger.",
  image: "ipfs://QmYourImageCID",
});

if (!result.valid) {
  console.error(result.errors);
}
```

### 2. Mint an NFT

```ts
import { mint, PinataProvider } from "@cashmint/sdk";
import { WalletConnectSigner } from "./WalletConnectSigner"; // from examples/ui

// Connect wallet — user scans QR / pastes URI in Cashonize, Paytaca, or Zapit
const signer = await WalletConnectSigner.connect(
  "your-walletconnect-project-id",
  async (uri) => {
    // Show the URI to your user (copy to clipboard, display as text, etc.)
    await navigator.clipboard.writeText(uri);
  },
);

// IPFS provider — pins metadata before signing
const ipfs = new PinataProvider({ jwt: "your-pinata-jwt" });

const result = await mint({
  signer,
  ipfs,
  metadata: {
    $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
    cms_version: "1.0",
    name: "Mystic Tiger #001",
    description: "A legendary fire tiger.",
    image: "ipfs://QmYourImageCID",
    collection: {
      name: "Mystic Tigers",
      category_id: "89cad9e3...680c",
      token_serial: 1,
    },
  },
  serial: 1,
  categoryId: "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
  mintingUtxo: {
    txid: "<minting-utxo-txid>",
    vout: 1,
    satoshis: 10000,
    commitment: "", // current on-chain commitment of the minting token (empty if first mint)
  },
  encodingFormat: "sequential", // "sequential" | "cid_serial"
});

console.log("txid:", result.txid);
console.log("cid:", result.cid);
console.log("commitment:", result.commitment); // hex — store for next mint
```

**`encodingFormat`** controls the on-chain commitment bytes:
- `"sequential"` — serial as a minimal little-endian BCH VM number (1–4 bytes, compact)
- `"cid_serial"` — 40-byte layout: `[4B serial LE][32B CID SHA-256 digest][4B flags]`

### 3. Custom signer (bring your own wallet)

```ts
import type { CashMintSigner, SignTransactionRequest, SignTransactionResult } from "@cashmint/sdk";

class MyWalletSigner implements CashMintSigner {
  async getLockingBytecode(): Promise<Uint8Array> {
    // Return P2PKH locking bytecode for the minting address
    // OP_DUP OP_HASH160 <20-byte pubkey hash> OP_EQUALVERIFY OP_CHECKSIG
    return myWallet.getLockingBytecode();
  }

  async signTransaction(req: SignTransactionRequest): Promise<SignTransactionResult> {
    const signed = await myWallet.sign(req.transaction, req.sourceOutput);
    return {
      signedTxBytes: signed.bytes,
      txid: signed.txid, // set if the wallet broadcasts; omit to let SDK broadcast via fulcrumUrl
    };
  }
}
```

### 4. Custom IPFS provider

```ts
import type { IpfsProvider } from "@cashmint/sdk";

const myIpfs: IpfsProvider = {
  async pin(metadata: object): Promise<string> {
    const res = await fetch("https://your-ipfs-api/pin", {
      method: "POST",
      body: JSON.stringify(metadata),
    });
    const { cid } = await res.json();
    return cid;
  },
};
```

---

## IPFS providers

### `PinataProvider`

```ts
import { PinataProvider } from "@cashmint/sdk";

const ipfs = new PinataProvider({ jwt: process.env.PINATA_JWT });
```

Get a JWT from [app.pinata.cloud/keys](https://app.pinata.cloud/keys) with the `pinJSONToIPFS` scope. `PinataProvider` uses the Pinata REST API and works in both Node.js and the browser.

---

## Other API

### `buildBCMR(params)`

Generate a CMS-compliant BCMR registry file for a collection. Publish the output on-chain (OP_RETURN), to IPFS, or via HTTPS.

```ts
import { buildBCMR } from "@cashmint/sdk";

const registry = buildBCMR({
  categoryId: "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
  name: "Mystic Tigers",
  description: "1,000 legendary tigers on BCH.",
  symbol: "TIGER",
  metadataBaseUri: "ipfs://QmMetadataFolder",
  maxSupply: 1000,
  royalty: { bps: 500, address: "bitcoincash:qr3kqekcd..." },
  uris: { web: "https://mystictigers.io", icon: "ipfs://QmIcon..." },
});

console.log(JSON.stringify(registry, null, 2));
```

### `fetchToken(categoryId, serial)`

Fetch and resolve full metadata for a specific token.

```ts
import { fetchToken } from "@cashmint/sdk";

const token = await fetchToken(
  "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
  42,
);

console.log(token.metadata.name);       // "Mystic Tiger #042"
console.log(token.metadata.attributes);
console.log(token.commitment);          // hex commitment from on-chain UTXO
```

### `encodeCommitment(serial, cid, format)`

Encode the on-chain NFT commitment bytes directly.

```ts
import { encodeCommitment } from "@cashmint/sdk";

const bytes = encodeCommitment(1, "QmCID...", "sequential"); // Uint8Array [0x01]
```

---

## API reference

| Export | Description |
|--------|-------------|
| `validate(metadata)` | Validate token metadata against CMS v1.0 schema |
| `mint(params)` | Mint a CMS-compliant NFT on BCH |
| `encodeCommitment(serial, cid, format)` | Encode on-chain commitment bytes |
| `buildBCMR(params)` | Generate a BCMR registry with `extensions.cashmint` block |
| `fetchCollection(categoryId)` | Resolve collection metadata from BCMR |
| `fetchToken(categoryId, serial)` | Fetch + validate per-token metadata |
| `fetchByAddress(cashaddr)` | List all CMS tokens held by an address |
| `PinataProvider` | Pinata-backed IPFS provider |
| `CashMintSigner` | Interface — implement for any BCH signing backend |
| `IpfsProvider` | Interface — implement for any IPFS pinning service |

**Coming soon**

| Export | Description |
|--------|-------------|
| `buildMetadataFolder(tokens[])` | Generate a full collection metadata folder |
| `requestChallenge(...)` | Request an ownership challenge (AI hook) |
| `proveOwnership(...)` | Sign an ownership challenge |
| `verifyOwnership(...)` | Verify UTXO ownership on-chain |

---

## Example UI

[`examples/ui/`](examples/ui/) is a minimal React + Vite minting dapp showing the full flow end-to-end:

- Connect Cashonize / Paytaca / Zapit via WalletConnect V2
- Choose IPFS storage (pre-hosted CID, Pinata JWT, or self-hosted Kubo)
- Enter token details
- Sign in-wallet → SDK broadcasts via Electrum WebSocket

```bash
cd examples/ui
cp .env.example .env        # add your WalletConnect project ID
npm install
npm run dev
```

Get a free WalletConnect project ID at [cloud.walletconnect.com](https://cloud.walletconnect.com).

---

## Spec

**CashMintStandard** defines the per-token metadata schema, royalty conventions, collection rules, and an optional AI agent hook (`extensions.ai_hook`) for BCH CashTokens NFTs.

Full specification: [github.com/BCH-CashMint/cashmintstandard](https://github.com/BCH-CashMint/cashmintstandard)

## License

MIT
