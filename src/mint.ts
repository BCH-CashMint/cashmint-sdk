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
import tls from "node:tls";
import { CID } from "multiformats/cid";
import { validate } from "./validate.js";
import type { MintParams, MintResult } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// CashTokens outputs require a higher minimum value than plain P2PKH.
// Standard BCH dust = 546 sat; token-bearing outputs = 1000 sat minimum.
const DUST_SATOSHIS = 1000n;
// The minting token output keeps a reserve so it can fund the next mint.
// Needs at least 2×DUST + FEE_ESTIMATE_INITIAL (≈2600) for the next call.
const MINTING_RESERVE = 5000n;
// Conservative initial fee estimate (sats). Adjusted to the real tx size in
// the second pass. Sized to cover a cid_serial (40-byte commitment) tx safely.
const FEE_ESTIMATE_INITIAL = 600n;
const SIGHASH_TYPE = SigningSerializationTypeBCH.allOutputsAllUtxos; // 0x61

// ─── Commitment encoding ──────────────────────────────────────────────────────

/**
 * Encodes the on-chain NFT commitment bytes from a serial number and CID.
 *
 * "sequential" — minimal little-endian VM number representation:
 *   - serial 0 → `[0x00]`  (1 byte minimum)
 *   - serial n → n as LE bytes, sign-bit–padded so it reads as positive
 *
 * "cid_serial" — fixed 40-byte layout:
 *   - bytes  0–3:  serial as uint32 LE
 *   - bytes  4–35: 32-byte SHA-256 digest extracted from the IPFS CID multihash
 *   - bytes 36–39: flags (currently 0x00000000)
 */
export function encodeCommitment(
  serial: number,
  cid: string,
  format: "sequential" | "cid_serial"
): Uint8Array {
  if (!Number.isInteger(serial) || serial < 0) {
    throw new RangeError(`serial must be a non-negative integer (got ${serial})`);
  }
  return format === "sequential"
    ? encodeMinimalLEVMNumber(serial)
    : encodeCidSerial(serial, cid);
}

function encodeMinimalLEVMNumber(n: number): Uint8Array {
  // Serial 0 → single zero byte (1-byte minimum per CMS spec)
  if (n === 0) return new Uint8Array([0x00]);

  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.push(v & 0xff);
    v = Math.floor(v / 256);
  }
  // If the high bit of the most-significant byte is set, append 0x00 so the
  // value is unambiguously positive when decoded as a BCH VM script number.
  if ((bytes[bytes.length - 1]! & 0x80) !== 0) {
    bytes.push(0x00);
  }
  return new Uint8Array(bytes);
}

function encodeCidSerial(serial: number, cidString: string): Uint8Array {
  const result = new Uint8Array(40);
  const view = new DataView(result.buffer);

  // Bytes 0-3: serial as 32-bit unsigned little-endian
  view.setUint32(0, serial, /* littleEndian= */ true);

  // Bytes 4-35: raw 32-byte SHA-256 digest from the CID multihash
  const parsed = CID.parse(cidString);
  const digest = parsed.multihash.digest;
  if (digest.length !== 32) {
    throw new Error(
      `CID multihash digest must be 32 bytes (sha2-256), got ${digest.length}. ` +
        `Ensure the CID was produced by sha2-256 hashing.`
    );
  }
  result.set(digest, 4);

  // Bytes 36-39: flags (all zero, reserved for future use)
  view.setUint32(36, 0, /* littleEndian= */ true);

  return result;
}

// ─── IPFS pinning ─────────────────────────────────────────────────────────────

async function pinToIPFS(json: object, pinataJwt: string): Promise<string> {
  const resp = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pinataJwt}`,
    },
    body: JSON.stringify({
      pinataContent: json,
      pinataMetadata: { name: "metadata.json" },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Pinata pin failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as { IpfsHash: string };
  return data.IpfsHash;
}

// ─── Transaction building + signing ──────────────────────────────────────────

interface BuildSignedTxParams {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  lockingBytecode: Uint8Array;
  categoryBytes: Uint8Array;
  outpointHash: Uint8Array;
  vout: number;
  inputSatoshis: bigint;
  mintingCommitment: Uint8Array;
  nftCommitment: Uint8Array;
  changeSatoshis: bigint;
}

/**
 * Builds a fully-signed CashTokens NFT mint transaction.
 *
 * Input layout:
 *   0: minting-capable token UTXO
 *
 * Output layout:
 *   0: new immutable NFT (capability=none, commitment=encoded)
 *   1: minting token returned to sender (capability=minting, empty commitment)
 *   2: BCH change
 */
function buildSignedTx(p: BuildSignedTxParams): Uint8Array {
  const {
    privateKey,
    publicKey,
    lockingBytecode,
    categoryBytes,
    outpointHash,
    vout,
    inputSatoshis,
    mintingCommitment,
    nftCommitment,
    changeSatoshis,
  } = p;

  // Unsigned transaction skeleton
  const tx = {
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: outpointHash,
        outpointIndex: vout,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: new Uint8Array(0), // filled after signing
      },
    ],
    outputs: [
      // Output 0: new immutable NFT to minter
      {
        lockingBytecode,
        valueSatoshis: DUST_SATOSHIS,
        token: {
          amount: 0n,
          category: categoryBytes,
          nft: {
            capability: NonFungibleTokenCapability.none,
            commitment: nftCommitment,
          },
        },
      },
      // Output 1: minting token returned to preserve capability.
      // Holds MINTING_RESERVE sats so the next mint() call has enough to spend.
      {
        lockingBytecode,
        valueSatoshis: MINTING_RESERVE,
        token: {
          amount: 0n,
          category: categoryBytes,
          nft: {
            capability: NonFungibleTokenCapability.minting,
            commitment: new Uint8Array(0),
          },
        },
      },
      // Output 2: BCH change
      {
        lockingBytecode,
        valueSatoshis: changeSatoshis,
      },
    ],
  };

  // Source UTXO data needed by the CashTokens sighash
  const sourceOutput = {
    lockingBytecode,
    valueSatoshis: inputSatoshis,
    token: {
      amount: 0n,
      category: categoryBytes,
      nft: {
        capability: NonFungibleTokenCapability.minting,
        commitment: mintingCommitment,
      },
    },
  };

  // Generate signing serialization (SIGHASH_ALL | SIGHASH_UTXOS = 0x61)
  const serialization = generateSigningSerializationBCH(
    { inputIndex: 0, transaction: tx, sourceOutputs: [sourceOutput] },
    {
      coveredBytecode: lockingBytecode,
      signingSerializationType: new Uint8Array([SIGHASH_TYPE]),
    }
  );

  const msgHash = hash256(serialization);
  const derSig = secp256k1.signMessageHashDER(privateKey, msgHash);
  if (typeof derSig === "string") {
    throw new Error(`secp256k1 signing failed: ${derSig}`);
  }

  // Append sighash type byte to produce a complete BCH transaction signature
  const sigWithType = new Uint8Array(derSig.length + 1);
  sigWithType.set(derSig);
  sigWithType[derSig.length] = SIGHASH_TYPE;

  // P2PKH unlocking script: OP_PUSH(sig) OP_PUSH(pubkey)
  // Both elements fit in a single-byte length prefix (≤ 75 bytes each)
  const unlocking = new Uint8Array(
    1 + sigWithType.length + 1 + publicKey.length
  );
  let cur = 0;
  unlocking[cur++] = sigWithType.length;
  unlocking.set(sigWithType, cur);
  cur += sigWithType.length;
  unlocking[cur++] = publicKey.length;
  unlocking.set(publicKey, cur);

  tx.inputs[0]!.unlockingBytecode = unlocking;

  return encodeTransaction(tx);
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

// Broadcasts via the Electrum TLS protocol (line-delimited JSON over TLS TCP).
// This is the standard Fulcrum interface — port 50002 on most nodes.
async function broadcast(txHex: string, fulcrumUrl: string): Promise<string> {
  const url = new URL(fulcrumUrl);
  const host = url.hostname;
  const port = parseInt(url.port || "50002", 10);

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, rejectUnauthorized: false },
      () => {
        socket.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "blockchain.transaction.broadcast",
            params: [txHex],
          }) + "\n"
        );
      }
    );

    let buf = "";
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const newline = buf.indexOf("\n");
      if (newline === -1) return;
      socket.destroy();
      try {
        const msg = JSON.parse(buf.slice(0, newline)) as {
          result?: string;
          error?: { code: number; message: string };
        };
        if (msg.error !== undefined) {
          reject(new Error(
            `Fulcrum broadcast RPC error ${msg.error.code}: ${msg.error.message}`
          ));
        } else if (typeof msg.result !== "string") {
          reject(new Error(
            `Fulcrum returned unexpected broadcast result: ${JSON.stringify(msg.result)}`
          ));
        } else {
          resolve(msg.result);
        }
      } catch (e) {
        reject(e);
      }
    });

    socket.on("error", (err: Error) => reject(err));
    socket.setTimeout(30_000, () => {
      socket.destroy();
      reject(new Error("Fulcrum broadcast timed out"));
    });
  });
}

// ─── mint ─────────────────────────────────────────────────────────────────────

/**
 * Mints a CashMintStandard-compliant NFT on Bitcoin Cash.
 *
 * Steps:
 *  1. Validate the per-token metadata against the CMS v1.0 schema
 *  2. Pin the JSON to IPFS via web3.storage (returns CID)
 *  3. Encode the on-chain commitment from the serial + CID
 *  4. Build and sign the BCH transaction with libauth
 *     - two-pass fee calculation: sign once to measure tx size, then re-sign
 *       with the exact 1 sat/byte fee
 *  5. Broadcast via the provided Fulcrum ElectrumX endpoint
 *  6. Return { txid, commitment, cid, token }
 */
export async function mint(params: MintParams): Promise<MintResult> {
  const {
    metadata,
    serial,
    categoryId,
    mintingUtxo,
    wif,
    encodingFormat,
    fulcrumUrl,
    pinataJwt,
  } = params;

  // ── Step 1: validate all inputs before any async work ────────────────────
  const validation = validate(metadata);
  if (!validation.valid) {
    throw new Error(
      `Token metadata is invalid:\n${validation.errors.join("\n")}`
    );
  }

  if (pinataJwt === undefined || pinataJwt === "") {
    throw new Error("pinataJwt is required for IPFS pinning");
  }

  const inputSatoshis = BigInt(mintingUtxo.satoshis);
  const minRequired = DUST_SATOSHIS + MINTING_RESERVE + FEE_ESTIMATE_INITIAL;
  if (inputSatoshis < minRequired) {
    throw new Error(
      `Insufficient satoshis: minting UTXO has ${inputSatoshis}, ` +
        `needs at least ${minRequired} (NFT dust + minting reserve + fee estimate)`
    );
  }

  // ── Step 2: pin to IPFS ───────────────────────────────────────────────────
  const cid = await pinToIPFS(metadata, pinataJwt);

  // ── Step 3: encode commitment ─────────────────────────────────────────────
  const nftCommitment = encodeCommitment(serial, cid, encodingFormat);
  const commitmentHex = binToHex(nftCommitment);

  // ── Step 4: build + sign transaction ─────────────────────────────────────

  // Key derivation
  const wifResult = decodePrivateKeyWif(wif);
  if (typeof wifResult === "string") {
    throw new Error(`Invalid WIF private key: ${wifResult}`);
  }
  const { privateKey } = wifResult;
  // WIF starting with '9' (testnet) or '5' (mainnet) encodes an uncompressed key.
  const isUncompressed = wif.startsWith("9") || wif.startsWith("5");
  const publicKey = isUncompressed
    ? secp256k1.derivePublicKeyUncompressed(privateKey)
    : secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === "string") {
    throw new Error(`Failed to derive public key: ${publicKey}`);
  }
  const lockingBytecode = publicKeyToP2pkhLockingBytecode({ publicKey });

  // libauth's encodeTransaction reverses outpointTransactionHash and token.category
  // internally when serializing, so pass display-format bytes as-is (no reversal).
  const categoryBytes = hexToBin(categoryId);
  const outpointHash = hexToBin(mintingUtxo.txid);
  const mintingCommitment =
    mintingUtxo.commitment !== ""
      ? hexToBin(mintingUtxo.commitment)
      : new Uint8Array(0);

  const buildParams: Omit<BuildSignedTxParams, "changeSatoshis"> = {
    privateKey,
    publicKey,
    lockingBytecode,
    categoryBytes,
    outpointHash,
    vout: mintingUtxo.vout,
    inputSatoshis,
    mintingCommitment,
    nftCommitment,
  };

  // Total reserved for token outputs: NFT dust + minting reserve
  const tokenOutputsTotal = DUST_SATOSHIS + MINTING_RESERVE;

  // Pass 1: sign with conservative estimate to measure real tx size
  const pass1Bytes = buildSignedTx({
    ...buildParams,
    changeSatoshis: inputSatoshis - tokenOutputsTotal - FEE_ESTIMATE_INITIAL,
  });

  // Actual fee = 1 sat/byte (rounded up); minimum 1 sat
  const actualFee = BigInt(pass1Bytes.length);
  const finalChange = inputSatoshis - tokenOutputsTotal - actualFee;

  if (finalChange < 0n) {
    throw new Error(
      `Insufficient funds after fee calculation: ` +
        `input ${inputSatoshis} sats, fee ${actualFee} sats, ` +
        `needed ${inputSatoshis - finalChange} sats`
    );
  }

  // Pass 2: re-sign with exact change (outputs changed → signature changes)
  const finalTxBytes = buildSignedTx({ ...buildParams, changeSatoshis: finalChange });
  const txHex = binToHex(finalTxBytes);

  // ── Step 5: broadcast ─────────────────────────────────────────────────────
  const txid = await broadcast(txHex, fulcrumUrl);

  // ── Step 6: return result ─────────────────────────────────────────────────
  return { txid, commitment: commitmentHex, cid, token: metadata };
}
