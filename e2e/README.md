# CashMint SDK — End-to-End Tests (Chipnet)

These scripts test the full mint flow against Bitcoin Cash **chipnet** (public testnet). They hit a real Fulcrum node and real IPFS — no mocking.

## Prerequisites

### 1. Chipnet BCH

You need a chipnet address holding a **minting-capable CashTokens UTXO** (the genesis UTXO from creating your token category). Get chipnet BCH from:

- Faucet: **https://tbch.googol.cash**

### 2. A minting-capable UTXO

Before running the e2e test you need a token genesis UTXO on chipnet. You can create one with [Electron Cash](https://electroncash.org/) (chipnet mode) or any BCH tool that supports CashTokens genesis. Copy the TXID, vout index, satoshi value, and category ID into your `.env`.

### 3. Pinata JWT

`mint()` pins the metadata JSON to IPFS via [Pinata](https://pinata.cloud). You need a Pinata JWT:

1. Sign up at pinata.cloud
2. Go to API Keys and create a new key with `pinFileToIPFS` / `pinJSONToIPFS` permissions
3. Copy the JWT and paste it into `PINATA_JWT` in your `.env`

## Setup

```bash
cp e2e/.env.example e2e/.env
# edit e2e/.env and fill in all values
```

`.env` fields:

| Variable | Description |
|---|---|
| `TEST_WIF` | WIF private key for your chipnet minting address |
| `PINATA_JWT` | Pinata JWT for pinning metadata JSON to IPFS |
| `FULCRUM_URL` | Fulcrum Electrum TLS endpoint (default: chipnet.imaginary.cash:50002) |
| `CATEGORY_ID` | 64-char hex token category ID (from genesis tx) |
| `MINTING_TXID` | TXID of the minting-capable UTXO to spend |
| `MINTING_VOUT` | Output index of the minting UTXO (default: 0) |
| `MINTING_SATOSHIS` | Satoshi value of that UTXO (min ~1700 for dust×2 + fee) |
| `MINTING_COMMITMENT` | Hex commitment of the minting UTXO, or empty string |
| `TOKEN_SERIAL` | Serial number to mint (default: 1) |

> **Note on Fulcrum URL**: `mint()` uses the **Electrum TLS TCP** protocol (`tls.connect`), not HTTP. Port **50002** is the raw Electrum TLS port. Provide the host and port without a scheme, e.g. `chipnet.imaginary.cash:50002`.

## Run

```bash
npx tsx e2e/mint.e2e.ts
```

Or via the package script:

```bash
npm run e2e
```

## Expected output

```
─── Step 1: validate metadata ───────────────────────────────────
✓ metadata valid

─── Step 2: mint on chipnet ─────────────────────────────────────
  Fulcrum URL  : https://chipnet.imaginary.cash:50002
  Category ID  : 89cad9...
  Serial       : 1
  Minting UTXO : abcdef... vout 0
  Satoshis     : 10000

─── Mint result ─────────────────────────────────────────────────
  txid       : <chipnet txid>
  CID        : bafybei...
  commitment : 01

Chipnet explorer:
  https://chipnet.chaingraph.cash/tx/<txid>
```

## After minting

Each successful mint spends the minting UTXO and creates a new one (output 1 returns the minting capability). Update `MINTING_TXID`, `MINTING_VOUT`, and `MINTING_COMMITMENT` to the new minting UTXO for the next serial.
