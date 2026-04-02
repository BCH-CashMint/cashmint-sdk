/**
 * e2e/mint.e2e.ts
 *
 * End-to-end mint test on chipnet (Bitcoin Cash testnet).
 *
 * Prerequisites:
 *   - A WIF private key for a chipnet address that holds a minting-capable
 *     CashTokens UTXO (genesis UTXO). Get chipnet BCH from tbch.googol.cash.
 *   - A web3.storage UCAN delegation token for IPFS pinning.
 *   - Copy .env.example → .env and fill in the values.
 *
 * Run: npx tsx e2e/mint.e2e.ts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, mint } from "../src/index.js";

// ─── Load .env ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");

try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  console.error("Could not read .env — copy .env.example to .env and fill in values.");
  process.exit(1);
}

const TEST_WIF = process.env["TEST_WIF"];
const PINATA_JWT = process.env["PINATA_JWT"];
const FULCRUM_URL =
  process.env["FULCRUM_URL"] ?? "https://chipnet.imaginary.cash:50002";
const MINTING_TXID = process.env["MINTING_TXID"];
const MINTING_VOUT = Number(process.env["MINTING_VOUT"] ?? "0");
const MINTING_SATOSHIS = Number(process.env["MINTING_SATOSHIS"] ?? "10000");
const MINTING_COMMITMENT = process.env["MINTING_COMMITMENT"] ?? "";
const CATEGORY_ID = process.env["CATEGORY_ID"];
const TOKEN_SERIAL = Number(process.env["TOKEN_SERIAL"] ?? "1");

// ─── Guard required env vars ──────────────────────────────────────────────────

const missing: string[] = [];
if (!TEST_WIF) missing.push("TEST_WIF");
if (!PINATA_JWT) missing.push("PINATA_JWT");
if (!MINTING_TXID) missing.push("MINTING_TXID");
if (!CATEGORY_ID) missing.push("CATEGORY_ID");

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill in values.");
  process.exit(1);
}

// ─── Build metadata ───────────────────────────────────────────────────────────

const metadata = {
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json" as const,
  cms_version: "1.0" as const,
  name: `Chipnet Test NFT #${TOKEN_SERIAL}`,
  description: "An end-to-end test NFT minted on Bitcoin Cash chipnet.",
  image: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  collection: {
    name: "CashMint E2E Tests",
    category_id: CATEGORY_ID!,
    token_serial: TOKEN_SERIAL,
  },
};

// ─── Step 1: validate ─────────────────────────────────────────────────────────

console.log("─── Step 1: validate metadata ───────────────────────────────────");
const validationResult = validate(metadata);
if (!validationResult.valid) {
  console.error("Validation FAILED:");
  for (const err of validationResult.errors) {
    console.error(" ", err);
  }
  process.exit(1);
}
console.log("✓ metadata valid");

// ─── Step 2: mint ─────────────────────────────────────────────────────────────

console.log("\n─── Step 2: mint on chipnet ─────────────────────────────────────");
console.log("  Fulcrum URL  :", FULCRUM_URL);
console.log("  Category ID  :", CATEGORY_ID);
console.log("  Serial       :", TOKEN_SERIAL);
console.log("  Minting UTXO :", MINTING_TXID, "vout", MINTING_VOUT);
console.log("  Satoshis     :", MINTING_SATOSHIS);
console.log();

try {
  const result = await mint({
    metadata,
    serial: TOKEN_SERIAL,
    categoryId: CATEGORY_ID!,
    mintingUtxo: {
      txid: MINTING_TXID!,
      vout: MINTING_VOUT,
      satoshis: MINTING_SATOSHIS,
      commitment: MINTING_COMMITMENT,
    },
    wif: TEST_WIF!,
    encodingFormat: "sequential",
    fulcrumUrl: FULCRUM_URL,
    pinataJwt: PINATA_JWT!,
  });

  console.log("─── Mint result ─────────────────────────────────────────────────");
  console.log("  txid       :", result.txid);
  console.log("  CID        :", result.cid);
  console.log("  commitment :", result.commitment);
  console.log();
  console.log("Chipnet explorer:");
  console.log(
    `  https://chipnet.chaingraph.cash/tx/${result.txid}`
  );
} catch (err) {
  console.error("\nMint FAILED:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
