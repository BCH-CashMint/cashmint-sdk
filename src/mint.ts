import {
  encodeTransaction,
  hexToBin,
  binToHex,
  NonFungibleTokenCapability,
  type Transaction,
} from "@bitauth/libauth";
import tls from "node:tls";
import { CID } from "multiformats/cid";
import { validate } from "./validate.js";
import type { MintParams, MintResult } from "./types.js";
import type { SourceOutput } from "./signer.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// CashTokens outputs require a higher minimum value than plain P2PKH.
// Standard BCH dust = 546 sat; token-bearing outputs = 1000 sat minimum.
const DUST_SATOSHIS = 1000n;
// The minting token output keeps a reserve so it can fund the next mint.
// Needs at least 2×DUST + FEE_ESTIMATE_INITIAL (≈2600) for the next call.
const MINTING_RESERVE = 5000n;

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
  if (n === 0) return new Uint8Array([0x00]);

  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.push(v & 0xff);
    v = Math.floor(v / 256);
  }
  if ((bytes[bytes.length - 1]! & 0x80) !== 0) {
    bytes.push(0x00);
  }
  return new Uint8Array(bytes);
}

function encodeCidSerial(serial: number, cidString: string): Uint8Array {
  const result = new Uint8Array(40);
  const view = new DataView(result.buffer);

  view.setUint32(0, serial, /* littleEndian= */ true);

  const parsed = CID.parse(cidString);
  const digest = parsed.multihash.digest;
  if (digest.length !== 32) {
    throw new Error(
      `CID multihash digest must be 32 bytes (sha2-256), got ${digest.length}.`
    );
  }
  result.set(digest, 4);
  view.setUint32(36, 0, /* littleEndian= */ true);

  return result;
}

// ─── Transaction building ─────────────────────────────────────────────────────

interface UnsignedTxParams {
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
 * Builds an unsigned CashTokens NFT mint transaction.
 * Returns both the transaction structure and the source output needed for signing.
 *
 * Input layout:
 *   0: minting-capable token UTXO
 *
 * Output layout:
 *   0: new immutable NFT (capability=none, commitment=encoded)
 *   1: minting token returned to sender (capability=minting, empty commitment)
 *   2: BCH change
 */
function buildUnsignedTx(p: UnsignedTxParams): {
  transaction: Transaction;
  sourceOutput: SourceOutput;
} {
  const {
    lockingBytecode,
    categoryBytes,
    outpointHash,
    vout,
    inputSatoshis,
    mintingCommitment,
    nftCommitment,
    changeSatoshis,
  } = p;

  const transaction: Transaction = {
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: outpointHash,
        outpointIndex: vout,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: new Uint8Array(0),
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

  const sourceOutput: SourceOutput = {
    outpointTransactionHash: outpointHash,
    outpointIndex: vout,
    sequenceNumber: 0xfffffffe,
    unlockingBytecode: new Uint8Array(0),
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

  return { transaction, sourceOutput };
}

/**
 * Estimates the signed transaction size by encoding the unsigned tx with a
 * worst-case P2PKH unlocking script (uncompressed key, max DER sig length).
 * Using the upper bound ensures the fee is always sufficient.
 *
 * Upper bound breakdown:
 *   1 (push opcode) + 73 (DER sig + sighash byte) + 1 (push opcode) + 65 (uncompressed pubkey) = 140 bytes
 */
function estimateSignedTxSize(unsignedTx: Transaction): number {
  const UNLOCKING_UPPER_BOUND = new Uint8Array(140);
  const dummyTx: Transaction = {
    ...unsignedTx,
    inputs: unsignedTx.inputs.map((inp) => ({
      ...inp,
      unlockingBytecode: UNLOCKING_UPPER_BOUND,
    })),
  };
  return encodeTransaction(dummyTx).length;
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
          reject(
            new Error(
              `Fulcrum broadcast RPC error ${msg.error.code}: ${msg.error.message}`
            )
          );
        } else if (typeof msg.result !== "string") {
          reject(
            new Error(
              `Fulcrum returned unexpected broadcast result: ${JSON.stringify(msg.result)}`
            )
          );
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
 *  2. Pin the JSON to IPFS via the provided IpfsProvider (returns CID)
 *  3. Encode the on-chain commitment from the serial + CID
 *  4. Build the unsigned BCH transaction
 *     - Single-pass fee calculation using a worst-case dummy unlocking script
 *  5. Sign via the provided CashMintSigner (key never enters this function)
 *  6. Broadcast via fulcrumUrl (or skip if the signer already broadcast)
 *  7. Return { txid, commitment, cid, token }
 */
export async function mint(params: MintParams): Promise<MintResult> {
  const {
    metadata,
    serial,
    categoryId,
    mintingUtxo,
    signer,
    ipfs,
    encodingFormat,
    fulcrumUrl,
  } = params;

  // ── Step 1: validate all inputs before any async work ────────────────────
  const validation = validate(metadata);
  if (!validation.valid) {
    throw new Error(
      `Token metadata is invalid:\n${validation.errors.join("\n")}`
    );
  }

  const inputSatoshis = BigInt(mintingUtxo.satoshis);
  const tokenOutputsTotal = DUST_SATOSHIS + MINTING_RESERVE;
  // Conservative minimum: token outputs + rough upper-bound fee estimate
  const MIN_REQUIRED = tokenOutputsTotal + 300n;
  if (inputSatoshis < MIN_REQUIRED) {
    throw new Error(
      `Insufficient satoshis: minting UTXO has ${inputSatoshis}, ` +
        `needs at least ${MIN_REQUIRED} (NFT dust + minting reserve + fee estimate)`
    );
  }

  // ── Step 2: pin to IPFS ───────────────────────────────────────────────────
  const cid = await ipfs.pin(metadata);

  // ── Step 3: encode commitment ─────────────────────────────────────────────
  const nftCommitment = encodeCommitment(serial, cid, encodingFormat);
  const commitmentHex = binToHex(nftCommitment);

  // ── Step 4: build unsigned transaction with exact fee ────────────────────
  const lockingBytecode = await signer.getLockingBytecode();

  // libauth's encodeTransaction reverses outpointTransactionHash and
  // token.category internally, so pass display-format bytes as-is (no reversal).
  const categoryBytes = hexToBin(categoryId);
  const outpointHash = hexToBin(mintingUtxo.txid);
  const mintingCommitment =
    mintingUtxo.commitment !== ""
      ? hexToBin(mintingUtxo.commitment)
      : new Uint8Array(0);

  // Estimate size with worst-case dummy unlocking to get exact 1 sat/byte fee
  const { transaction: dummyTx } = buildUnsignedTx({
    lockingBytecode,
    categoryBytes,
    outpointHash,
    vout: mintingUtxo.vout,
    inputSatoshis,
    mintingCommitment,
    nftCommitment,
    changeSatoshis: 0n, // placeholder — doesn't affect size estimate
  });
  const fee = BigInt(estimateSignedTxSize(dummyTx));
  const changeSatoshis = inputSatoshis - tokenOutputsTotal - fee;

  if (changeSatoshis < 0n) {
    throw new Error(
      `Insufficient funds: input ${inputSatoshis} sats, ` +
        `need at least ${tokenOutputsTotal + fee} sats ` +
        `(NFT dust + minting reserve + ${fee} sat fee)`
    );
  }

  const { transaction, sourceOutput } = buildUnsignedTx({
    lockingBytecode,
    categoryBytes,
    outpointHash,
    vout: mintingUtxo.vout,
    inputSatoshis,
    mintingCommitment,
    nftCommitment,
    changeSatoshis,
  });

  // ── Step 5: sign ──────────────────────────────────────────────────────────
  const signResult = await signer.signTransaction({
    transaction,
    sourceOutput,
    inputIndex: 0,
  });

  // ── Step 6: broadcast ─────────────────────────────────────────────────────
  let txid: string;
  if (signResult.txid !== undefined) {
    txid = signResult.txid;
  } else {
    if (!fulcrumUrl) {
      throw new Error(
        "fulcrumUrl is required when the signer does not broadcast the transaction. " +
          "Either provide fulcrumUrl or use WizardConnectSigner with broadcast: true."
      );
    }
    txid = await broadcast(binToHex(signResult.signedTxBytes), fulcrumUrl);
  }

  // ── Step 7: return result ─────────────────────────────────────────────────
  return { txid, commitment: commitmentHex, cid, token: metadata };
}
