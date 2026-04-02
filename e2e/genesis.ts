/**
 * e2e/genesis.ts
 *
 * Creates the CashTokens genesis transaction on chipnet.
 * Spends a plain BCH UTXO to produce a minting-capable NFT output.
 * The category ID = TXID of the input being spent.
 *
 * Reads TEST_WIF and FULCRUM_URL from e2e/.env.
 * Prints the four .env values to paste after success.
 *
 * Run: npx tsx e2e/genesis.ts
 */

import tls from "node:tls";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodePrivateKeyWif,
  secp256k1,
  publicKeyToP2pkhLockingBytecode,
  generateSigningSerializationBCH,
  SigningSerializationTypeBCH,
  encodeTransaction,
  hash256,
  hexToBin,
  binToHex,
  NonFungibleTokenCapability,
} from "@bitauth/libauth";

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
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  console.error("Could not read e2e/.env");
  process.exit(1);
}

const WIF = process.env["TEST_WIF"]!;
const FULCRUM_URL = process.env["FULCRUM_URL"] ?? "https://chipnet.imaginary.cash:50002";

if (!WIF) {
  console.error("TEST_WIF is not set in e2e/.env");
  process.exit(1);
}

// ─── Parse Fulcrum host + port ────────────────────────────────────────────────

const fulcrumUrl = new URL(FULCRUM_URL);
const FULCRUM_HOST = fulcrumUrl.hostname;
const FULCRUM_PORT = parseInt(fulcrumUrl.port || "50002", 10);

// ─── Electrum TLS query helper ────────────────────────────────────────────────

function electrumQuery<T>(method: string, params: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: FULCRUM_HOST, port: FULCRUM_PORT, rejectUnauthorized: false },
      () => {
        socket.write(
          JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n"
        );
      }
    );

    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const newline = buf.indexOf("\n");
      if (newline !== -1) {
        socket.destroy();
        try {
          const msg = JSON.parse(buf.slice(0, newline)) as {
            result?: T;
            error?: { message: string };
          };
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result as T);
        } catch (e) {
          reject(e);
        }
      }
    });

    socket.on("error", reject);
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("Electrum query timed out"));
    });
  });
}

// ─── Broadcast via Electrum TLS ───────────────────────────────────────────────

async function broadcast(txHex: string): Promise<string> {
  return electrumQuery<string>("blockchain.transaction.broadcast", [txHex]);
}

// ─── Key derivation ───────────────────────────────────────────────────────────

const wifResult = decodePrivateKeyWif(WIF);
if (typeof wifResult === "string") {
  console.error("Invalid WIF:", wifResult);
  process.exit(1);
}
const { privateKey } = wifResult;

// WIF starting with '9' (testnet) or '5' (mainnet) = uncompressed key.
// Use the uncompressed 65-byte public key so the P2PKH address matches the
// funded address produced by bitcore-lib-cash in derive-wif.cjs.
const isUncompressed = WIF.startsWith("9") || WIF.startsWith("5");
const publicKey = isUncompressed
  ? secp256k1.derivePublicKeyUncompressed(privateKey)
  : secp256k1.derivePublicKeyCompressed(privateKey);
if (typeof publicKey === "string") {
  console.error("Public key derivation failed:", publicKey);
  process.exit(1);
}
const lockingBytecode = publicKeyToP2pkhLockingBytecode({ publicKey });
const addressHex = binToHex(lockingBytecode);

// ─── Fetch UTXOs ──────────────────────────────────────────────────────────────

interface ElectrumUtxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number; // 0 = unconfirmed
}

// Derive the chipnet cashaddr from the public key hash for the Electrum call.
// P2PKH locking bytecode: OP_DUP OP_HASH160 <20B hash> OP_EQUALVERIFY OP_CHECKSIG
// The 20-byte hash sits at bytes 3–22 of the locking bytecode.
import { encodeCashAddress, hash160 } from "@bitauth/libauth";

const pubkeyHash = hash160(publicKey);
const encodeResult = encodeCashAddress({
  prefix: "bchtest",
  type: "p2pkh",
  payload: pubkeyHash,
});
// libauth v3 encodeCashAddress returns { address: string } (not a bare string)
const cashaddr =
  typeof encodeResult === "string" ? encodeResult : encodeResult.address;

console.log("─── Fetching UTXOs ──────────────────────────────────────────────");
console.log("  Fulcrum :", FULCRUM_HOST + ":" + FULCRUM_PORT);
console.log("  Address :", cashaddr);

const utxos = await electrumQuery<ElectrumUtxo[]>(
  "blockchain.address.listunspent",
  [cashaddr]
);

if (!utxos || utxos.length === 0) {
  console.error("\nNo UTXOs found. Fund the address first.");
  process.exit(1);
}

console.log(`  Found ${utxos.length} UTXO(s):`);
for (const u of utxos) {
  console.log(`    ${u.tx_hash}:${u.tx_pos}  ${u.value} sat  (height ${u.height})`);
}

// Pick the largest UTXO
const utxo = utxos.reduce((a, b) => (a.value >= b.value ? a : b));
console.log(`\n  Using: ${utxo.tx_hash}:${utxo.tx_pos}  ${utxo.value} sat`);

// ─── Constants ────────────────────────────────────────────────────────────────

const DUST = 546n;
// Satoshis to lock in the minting output — generous so future mint() calls
// have room for 2×dust + fee (need at least ~1700 sat).
const MINTING_OUTPUT_SATS = 10_000n;
const FEE_ESTIMATE = 500n;

const inputSatoshis = BigInt(utxo.value);

if (inputSatoshis < MINTING_OUTPUT_SATS + DUST + FEE_ESTIMATE) {
  console.error(
    `Insufficient funds: have ${inputSatoshis} sat, need at least ${MINTING_OUTPUT_SATS + DUST + FEE_ESTIMATE} sat`
  );
  process.exit(1);
}

// ─── Build + sign genesis tx ──────────────────────────────────────────────────

// libauth's encodeTransaction reverses outpointTransactionHash and token.category
// internally when serializing, so pass the display-format TXID bytes as-is.
const categoryBytes = hexToBin(utxo.tx_hash);
const outpointHash = hexToBin(utxo.tx_hash);

function buildGenesisTx(changeSatoshis: bigint): Uint8Array {
  const tx = {
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: outpointHash,
        outpointIndex: utxo.tx_pos,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: new Uint8Array(0),
      },
    ],
    outputs: [
      // Output 0: minting-capable NFT — this is the minting UTXO
      {
        lockingBytecode,
        valueSatoshis: MINTING_OUTPUT_SATS,
        token: {
          amount: 0n,
          category: categoryBytes,
          nft: {
            capability: NonFungibleTokenCapability.minting,
            commitment: new Uint8Array(0),
          },
        },
      },
      // Output 1: BCH change
      {
        lockingBytecode,
        valueSatoshis: changeSatoshis,
      },
    ],
  };

  // Use SIGHASH_ALL | SIGHASH_UTXOS (0x61) — covers all UTXO data.
  // Required when spending a token UTXO; accepted for plain BCH inputs too.
  const SIGHASH = SigningSerializationTypeBCH.allOutputsAllUtxos; // 0x61

  const sourceOutput = {
    lockingBytecode,
    valueSatoshis: inputSatoshis,
  };

  const serialization = generateSigningSerializationBCH(
    { inputIndex: 0, transaction: tx, sourceOutputs: [sourceOutput] },
    {
      coveredBytecode: lockingBytecode,
      signingSerializationType: new Uint8Array([SIGHASH]),
    }
  );

  const msgHash = hash256(serialization);
  const derSig = secp256k1.signMessageHashDER(privateKey, msgHash);
  if (typeof derSig === "string") throw new Error(`Signing failed: ${derSig}`);

  const sigWithType = new Uint8Array(derSig.length + 1);
  sigWithType.set(derSig);
  sigWithType[derSig.length] = SIGHASH;

  const unlocking = new Uint8Array(1 + sigWithType.length + 1 + publicKey.length);
  let cur = 0;
  unlocking[cur++] = sigWithType.length;
  unlocking.set(sigWithType, cur); cur += sigWithType.length;
  unlocking[cur++] = publicKey.length;
  unlocking.set(publicKey, cur);

  tx.inputs[0]!.unlockingBytecode = unlocking;
  return encodeTransaction(tx);
}

// Two-pass fee: sign once to measure, re-sign with exact fee
const pass1 = buildGenesisTx(inputSatoshis - MINTING_OUTPUT_SATS - FEE_ESTIMATE);
const exactFee = BigInt(pass1.length); // 1 sat/byte
const changeOut = inputSatoshis - MINTING_OUTPUT_SATS - exactFee;

if (changeOut < DUST) {
  console.error(`Change too small (${changeOut} sat) — fund the address with more BCH`);
  process.exit(1);
}

const finalTx = buildGenesisTx(changeOut);
const txHex = binToHex(finalTx);

console.log("\n─── Broadcasting genesis tx ─────────────────────────────────────");
console.log("  tx size :", finalTx.length, "bytes");
console.log("  fee     :", exactFee.toString(), "sat");
console.log("  tx hex  :", txHex);

const txid = await broadcast(txHex);
const categoryId = utxo.tx_hash; // display order = input txid

console.log("\n─── Genesis complete ────────────────────────────────────────────");
console.log("  txid:", txid);
console.log();
console.log("Paste into e2e/.env:");
console.log("─────────────────────────────────────────────────────────────────");
console.log(`CATEGORY_ID=${categoryId}`);
console.log(`MINTING_TXID=${txid}`);
console.log(`MINTING_VOUT=0`);
console.log(`MINTING_SATOSHIS=${MINTING_OUTPUT_SATS.toString()}`);
console.log(`MINTING_COMMITMENT=`);
console.log("─────────────────────────────────────────────────────────────────");
console.log();
console.log(`Chipnet explorer: https://chipnet.chaingraph.cash/tx/${txid}`);
