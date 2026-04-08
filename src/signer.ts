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
  type Transaction,
} from "@bitauth/libauth";
import {
  initiateDappRelay,
  childIndexOfPathName,
  type PathName,
} from "@wizardconnect/core";
import { DappConnectionManager } from "@wizardconnect/dapp";

const SIGHASH_TYPE = SigningSerializationTypeBCH.allOutputsAllUtxos; // 0x61

// ─── Types ────────────────────────────────────────────────────────────────────

/** The source UTXO being spent — needed for SIGHASH_UTXOS serialization. */
export interface SourceOutput {
  outpointTransactionHash: Uint8Array;
  outpointIndex: number;
  sequenceNumber: number;
  unlockingBytecode: Uint8Array;
  lockingBytecode: Uint8Array;
  valueSatoshis: bigint;
  token?: {
    amount: bigint;
    category: Uint8Array;
    nft?: {
      capability: number;
      commitment: Uint8Array;
    };
  };
}

export interface SignTransactionRequest {
  /** Unsigned tx structure (libauth format — unlockingBytecode fields are empty). */
  transaction: Transaction;
  /** Source UTXO being spent, needed for SIGHASH_UTXOS. */
  sourceOutput: SourceOutput;
  /** Index of the input to sign (0 for single-input CashMint txs). */
  inputIndex: number;
}

export interface SignTransactionResult {
  signedTxBytes: Uint8Array;
  /**
   * Txid if the signer also broadcast the transaction.
   * When set, mint() will skip calling fulcrumUrl.
   */
  txid?: string;
}

// ─── CashMintSigner interface ─────────────────────────────────────────────────

/**
 * Signing abstraction — the SDK never holds private key material directly.
 *
 * Implement this interface to plug in any signing backend:
 *  - WifSigner        for CLI / server-side scripts
 *  - WizardConnectSigner  for browser dapps (key stays in user's wallet)
 */
export interface CashMintSigner {
  /**
   * Returns the P2PKH locking bytecode for the address that owns the minting UTXO.
   * Used to construct transaction outputs pointing back to the same address.
   */
  getLockingBytecode(): Promise<Uint8Array>;

  /**
   * Signs the prepared transaction and returns the fully-signed bytes.
   * May also broadcast the transaction and return a txid (optional).
   */
  signTransaction(req: SignTransactionRequest): Promise<SignTransactionResult>;
}

// ─── WifSigner ────────────────────────────────────────────────────────────────

/**
 * Signs transactions using a WIF-encoded private key.
 *
 * Appropriate for CLI scripts and server-side automation where the key is
 * stored in an env file or secrets manager — NOT for browser dapps.
 */
export class WifSigner implements CashMintSigner {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  constructor(wif: string) {
    const decoded = decodePrivateKeyWif(wif);
    if (typeof decoded === "string") {
      throw new Error(`Invalid WIF private key: ${decoded}`);
    }
    this.privateKey = decoded.privateKey;

    // WIF starting with '9' (testnet) or '5' (mainnet) = uncompressed key.
    const isUncompressed = wif.startsWith("9") || wif.startsWith("5");
    const pubkey = isUncompressed
      ? secp256k1.derivePublicKeyUncompressed(this.privateKey)
      : secp256k1.derivePublicKeyCompressed(this.privateKey);
    if (typeof pubkey === "string") {
      throw new Error(`Public key derivation failed: ${pubkey}`);
    }
    this.publicKey = pubkey;
  }

  async getLockingBytecode(): Promise<Uint8Array> {
    return publicKeyToP2pkhLockingBytecode({ publicKey: this.publicKey });
  }

  async signTransaction(req: SignTransactionRequest): Promise<SignTransactionResult> {
    const { transaction, sourceOutput, inputIndex } = req;
    const lockingBytecode = publicKeyToP2pkhLockingBytecode({
      publicKey: this.publicKey,
    });

    const serialization = generateSigningSerializationBCH(
      { inputIndex, transaction, sourceOutputs: [sourceOutput] },
      {
        coveredBytecode: lockingBytecode,
        signingSerializationType: new Uint8Array([SIGHASH_TYPE]),
      }
    );

    const msgHash = hash256(serialization);
    const derSig = secp256k1.signMessageHashDER(this.privateKey, msgHash);
    if (typeof derSig === "string") {
      throw new Error(`secp256k1 signing failed: ${derSig}`);
    }

    // Append sighash type byte (0x61)
    const sigWithType = new Uint8Array(derSig.length + 1);
    sigWithType.set(derSig);
    sigWithType[derSig.length] = SIGHASH_TYPE;

    // P2PKH unlocking: <push sig> <sig+sighash> <push pubkey> <pubkey>
    const unlocking = new Uint8Array(
      1 + sigWithType.length + 1 + this.publicKey.length
    );
    let cur = 0;
    unlocking[cur++] = sigWithType.length;
    unlocking.set(sigWithType, cur);
    cur += sigWithType.length;
    unlocking[cur++] = this.publicKey.length;
    unlocking.set(this.publicKey, cur);

    const signed = {
      ...transaction,
      inputs: transaction.inputs.map((inp, i) =>
        i === inputIndex ? { ...inp, unlockingBytecode: unlocking } : inp
      ),
    };

    return { signedTxBytes: encodeTransaction(signed) };
  }
}

// ─── WizardConnectSigner ──────────────────────────────────────────────────────

export interface WizardConnectOptions {
  /**
   * Called immediately once the relay is ready — display this URI as a QR code
   * so the user can scan it with their BCH wallet (Cashonize, etc.).
   * Both the raw URI and a QR-code-optimised variant are provided.
   */
  onUri: (uri: string, qrUri: string) => void;

  /**
   * Named HD path for the address that controls the minting UTXO.
   * Corresponds to BIP44 child paths: 'receive' (0), 'change' (1), 'defi' (7).
   * Default: 'receive'
   */
  pathName?: PathName;

  /** Address index under the chosen path. Default: 0 */
  addressIndex?: number;

  /**
   * Whether to ask the wallet to broadcast the transaction after signing.
   * When true, mint() will use the txid returned by WizardConnect instead
   * of broadcasting via fulcrumUrl.
   * Default: true
   */
  broadcast?: boolean;

  /** Text shown in the wallet's signing prompt. Default: 'Confirm CashMint NFT' */
  userPrompt?: string;

  /** Dapp name shown in the wallet's connection screen. Default: 'CashMint SDK' */
  dappName?: string;
}

/**
 * Signs (and optionally broadcasts) transactions via WizardConnect.
 *
 * The private key never leaves the user's wallet — the SDK only builds the
 * unsigned transaction and hands it to the wallet for approval.
 *
 * Uses the Cauldron relay (wss://relay.cauldron.quest:443) by default,
 * the same relay used by Cashonize and TapSwap.
 *
 * @example
 * const signer = await WizardConnectSigner.connect({
 *   onUri: (uri, qrUri) => setQr(qrUri),
 * });
 * await mint({ signer, ipfs, mintingUtxo, ... });
 */
export class WizardConnectSigner implements CashMintSigner {
  private readonly mgr: DappConnectionManager;
  private readonly pathName: PathName;
  private readonly addressIndex: number;
  private readonly shouldBroadcast: boolean;
  private readonly userPrompt: string;

  private constructor(
    mgr: DappConnectionManager,
    pathName: PathName,
    addressIndex: number,
    broadcast: boolean,
    userPrompt: string
  ) {
    this.mgr = mgr;
    this.pathName = pathName;
    this.addressIndex = addressIndex;
    this.shouldBroadcast = broadcast;
    this.userPrompt = userPrompt;
  }

  /**
   * Initiates a WizardConnect relay session and resolves once the user's
   * wallet completes the handshake (scans QR + approves connection).
   */
  static async connect(
    options: WizardConnectOptions
  ): Promise<WizardConnectSigner> {
    const {
      onUri,
      pathName = "receive",
      addressIndex = 0,
      broadcast = true,
      userPrompt = "Confirm CashMint NFT",
      dappName = "CashMint SDK",
    } = options;

    const mgr = new DappConnectionManager(dappName);

    return new Promise<WizardConnectSigner>((resolve, reject) => {
      const relay = initiateDappRelay((payload) => {
        mgr.updateConnection(payload.client, payload.status);
      });

      mgr.attachRelay(relay);
      onUri(relay.uri, relay.qrUri);

      mgr.once("walletready", () => {
        resolve(
          new WizardConnectSigner(
            mgr,
            pathName,
            addressIndex,
            broadcast,
            userPrompt
          )
        );
      });

      mgr.once("disconnect", (reason, msg) => {
        reject(
          new Error(
            `WizardConnect disconnected during handshake: ${String(reason)}${msg ? " — " + msg : ""}`
          )
        );
      });
    });
  }

  async getLockingBytecode(): Promise<Uint8Array> {
    const childIndex = childIndexOfPathName(this.pathName);
    const pubkey = this.mgr.getPubkey(childIndex, BigInt(this.addressIndex));
    if (!pubkey) {
      throw new Error(
        `No pubkey for path '${this.pathName}[${this.addressIndex}]' — wallet may not support this path`
      );
    }
    return publicKeyToP2pkhLockingBytecode({ publicKey: pubkey });
  }

  async signTransaction(req: SignTransactionRequest): Promise<SignTransactionResult> {
    const response = await this.mgr.signTransaction({
      transaction: {
        // WcSignTransactionRequest accepts a libauth Transaction object directly
        transaction: req.transaction as unknown as string,
        sourceOutputs: [req.sourceOutput] as unknown as never[],
        broadcast: this.shouldBroadcast,
        userPrompt: this.userPrompt,
      },
      inputPaths: [[req.inputIndex, this.pathName, this.addressIndex]],
    });

    if (response.error) {
      throw new Error(`WizardConnect signing failed: ${response.error}`);
    }

    const signedTxBytes = hexToBin(response.signedTransaction);

    if (this.shouldBroadcast) {
      // Derive txid: reversed double-SHA256 of the signed transaction bytes
      const txid = binToHex(hash256(signedTxBytes).slice().reverse());
      return { signedTxBytes, txid };
    }

    return { signedTxBytes };
  }

  /** Send a courtesy disconnect message to the wallet and clean up. */
  disconnect(message?: string): void {
    this.mgr.sendDisconnect(message).catch(() => {});
  }
}
