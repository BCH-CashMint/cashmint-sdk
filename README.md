# @cashmint/sdk

[![npm](https://img.shields.io/npm/v/@cashmint/sdk)](https://www.npmjs.com/package/@cashmint/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official TypeScript SDK for [CashMintStandard](https://github.com/BCH-CashMint/cashmintstandard) — a BCMR extension profile for NFTs on Bitcoin Cash CashTokens. The SDK covers the full lifecycle of a CMS-compliant token: validating per-token metadata, generating BCMR registry files, resolving on-chain token data, and minting NFTs directly from TypeScript.

## Installation

```bash
npm install @cashmint/sdk
```

## Quick start

### validate()

Validate a per-token metadata object against the CashMintStandard v1.0 schema before publishing or minting.

```ts
import { validate } from "@cashmint/sdk";

const result = validate({
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
  cms_version: "1.0",
  name: "Mystic Tiger #042",
  description: "A legendary fire tiger from the Mystic Tigers collection.",
  image: "ipfs://QmImage123...",
  attributes: [
    { trait_type: "Background", value: "Volcano" },
    { trait_type: "Level", value: 5, display_type: "number" },
  ],
  royalty: {
    bps: 500,
    address: "bitcoincash:qr3kqekcd...",
  },
});

if (!result.valid) {
  console.error("Schema errors:", result.errors);
}
```

### buildBCMR()

Generate a CMS-compliant BCMR registry file for a collection. Publish the output JSON on-chain (OP_RETURN), to IPFS, or via HTTPS.

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

// Write to file or pin to IPFS
console.log(JSON.stringify(registry, null, 2));
```

### fetchToken()

Fetch and resolve full metadata for a specific token. Reads the BCMR from the category's on-chain authchain, resolves the per-token JSON from `metadata_base_uri`, and validates it.

```ts
import { fetchToken } from "@cashmint/sdk";

const token = await fetchToken(
  "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
  42 // serial number (zero-indexed)
);

console.log(token.metadata.name);       // "Mystic Tiger #042"
console.log(token.metadata.attributes); // [{ trait_type: "Background", value: "Volcano" }, ...]
console.log(token.commitment);          // hex commitment bytes from on-chain UTXO
```

### mint()

Mint a CMS-compliant NFT on Bitcoin Cash. Validates metadata, pins the JSON to IPFS via Pinata, encodes the on-chain commitment, builds and signs the BCH transaction with libauth, and broadcasts via a Fulcrum ElectrumX node.

```ts
import { mint } from "@cashmint/sdk";

const result = await mint({
  metadata: {
    $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
    cms_version: "1.0",
    name: "Mystic Tiger #001",
    description: "The first tiger.",
    image: "ipfs://QmImage001...",
    collection: {
      name: "Mystic Tigers",
      category_id: "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
      token_serial: 1,
    },
  },
  serial: 1,
  categoryId: "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
  mintingUtxo: {
    txid: "<genesis-txid>",
    vout: 0,
    satoshis: 10000,
    commitment: "",
  },
  wif: process.env.MINTER_WIF!,
  encodingFormat: "sequential", // or "cid_serial"
  fulcrumUrl: "chipnet.imaginary.cash:50002",
  pinataJwt: process.env.PINATA_JWT!,
});

console.log("txid:", result.txid);
console.log("cid:", result.cid);
console.log("commitment:", result.commitment);
```

**`pinataJwt`** is a Pinata JWT (Bearer token) from your [Pinata](https://pinata.cloud) account, used to pin metadata JSON to IPFS.

**`encodingFormat`** controls the on-chain commitment bytes:
- `"sequential"` — serial as a minimal little-endian BCH VM number (1–4 bytes)
- `"cid_serial"` — 40-byte layout: `[4B serial LE][32B CID SHA-256 digest][4B flags]`

## API reference

| Function | Status | Description |
|---|---|---|
| `validate(json)` | ✅ | Validate token metadata against CMS v1.0 schema |
| `buildBCMR(params)` | ✅ | Generate a BCMR registry with `extensions.cashmint` block |
| `fetchCollection(categoryId)` | ✅ | Resolve collection metadata from BCMR |
| `fetchToken(categoryId, serial)` | ✅ | Fetch + validate per-token metadata |
| `fetchByAddress(cashaddr)` | ✅ | List all CMS tokens held by an address |
| `mint(params)` | ✅ | Mint a CMS-compliant NFT on BCH |
| `encodeCommitment(serial, cid, format)` | ✅ | Encode on-chain commitment bytes |
| `buildMetadataFolder(tokens[])` | 🔜 | Generate a full collection metadata folder |
| `requestChallenge(endpoint, categoryId, serial)` | 🔜 | Request an ownership challenge (AI hook) |
| `proveOwnership(challenge, privateKey)` | 🔜 | Sign an ownership challenge |
| `verifyOwnership(signature, categoryId, serial)` | 🔜 | Verify UTXO ownership on-chain |

## Spec

**CashMintStandard** defines the per-token metadata schema, royalty conventions, collection rules, and an optional AI agent hook (`extensions.ai_hook`) for BCH CashTokens NFTs.

Full specification: [github.com/BCH-CashMint/cashmintstandard](https://github.com/BCH-CashMint/cashmintstandard)

## License

MIT
