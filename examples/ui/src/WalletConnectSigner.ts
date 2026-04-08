/**
 * WalletConnectSigner
 *
 * Implements CashMintSigner using WalletConnect V2 (wc2-bch-bcr spec).
 * Works with Cashonize, Paytaca, Zapit — key never leaves the wallet.
 *
 * Broadcast strategy: we use broadcast:false so Cashonize returns the signed
 * transaction bytes without broadcasting. We then broadcast ourselves via
 * WebSocket Electrum. This avoids Cashonize's broadcast path (which was
 * returning "TX decode failed" on chipnet) and gives us the raw signed bytes
 * for independent verification.
 */

import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { hexToBin, binToHex, stringify, decodeCashAddress } from "@bitauth/libauth";
import type {
  CashMintSigner,
  SignTransactionRequest,
  SignTransactionResult,
} from "@cashmint/sdk";

export const BCH_CHAIN = {
  mainnet: "bch:bitcoincash",
  chipnet: "bch:bchtest",
} as const;

const DEFAULT_CHAIN = BCH_CHAIN.chipnet;

// Default WebSocket Electrum endpoints (browser-compatible, no node:tls needed)
const DEFAULT_ELECTRUM_WS: Record<string, string> = {
  [BCH_CHAIN.chipnet]: "wss://chipnet.imaginary.cash:50003",
  [BCH_CHAIN.mainnet]: "wss://fulcrum.greyh.at:50004",
};

const WC_METADATA = {
  name: "CashMint",
  description: "Mint CashMintStandard NFTs on Bitcoin Cash",
  url: typeof window !== "undefined" ? window.location.origin : "https://cashmint.app",
  icons: [],
};

export class WalletConnectSigner implements CashMintSigner {
  private constructor(
    private readonly client: SignClient,
    private readonly session: SessionTypes.Struct,
    private readonly chainId: string,
    private readonly electrumWsUrl: string,
  ) {}

  // ── Static factory ──────────────────────────────────────────────────────────

  /**
   * Connect using a FRESH SignClient every time.
   *
   * Why fresh? A reused client can have a stale/throttled relay WebSocket —
   * when the user switches to another browser tab (Cashonize), the background
   * tab's WebSocket may be throttled and never receive the approval message.
   * A fresh init guarantees an active relay connection.
   *
   * `onUri` is awaited before we start listening for the approval, ensuring
   * the URI is displayed (or copied) before the relay begins listening.
   */
  static async connect(
    projectId: string,
    onUri: (uri: string) => Promise<void>,
    chainId: string = DEFAULT_CHAIN,
    electrumWsUrl?: string,
  ): Promise<WalletConnectSigner> {
    const client = await SignClient.init({
      projectId,
      relayUrl: "wss://relay.walletconnect.com",
      metadata: WC_METADATA,
    });

    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        bch: {
          chains: [chainId],
          // Include all methods Cashonize / Paytaca / Zapit may check for
          methods: ["bch_getAddresses", "bch_signTransaction", "bch_signMessage"],
          events: ["accountsChanged"],
        },
      },
    });

    if (!uri) throw new Error("WalletConnect did not return a pairing URI.");

    // Await onUri so the URI is shown / copied BEFORE we start waiting
    await onUri(uri);

    // approval() resolves when the wallet approves the session
    const session = await approval();
    const wsUrl = electrumWsUrl ?? DEFAULT_ELECTRUM_WS[chainId] ?? DEFAULT_ELECTRUM_WS[BCH_CHAIN.chipnet]!;
    return new WalletConnectSigner(client, session, chainId, wsUrl);
  }

  // ── CashMintSigner interface ────────────────────────────────────────────────

  async getLockingBytecode(): Promise<Uint8Array> {
    const addresses = await this.client.request<string[]>({
      topic: this.session.topic,
      chainId: this.chainId,
      request: { method: "bch_getAddresses", params: {} },
    });

    const addr = addresses[0];
    if (!addr) throw new Error("Wallet returned no addresses.");

    // Decode cashaddr → pubkey hash → P2PKH locking bytecode
    const decoded = decodeCashAddress(addr);
    if (typeof decoded === "string") throw new Error(`Invalid cashaddr: ${decoded}`);

    // P2PKH: OP_DUP OP_HASH160 <20B hash> OP_EQUALVERIFY OP_CHECKSIG
    return new Uint8Array([0x76, 0xa9, 0x14, ...decoded.payload, 0x88, 0xac]);
  }

  async signTransaction(req: SignTransactionRequest): Promise<SignTransactionResult> {
    const { transaction, sourceOutput } = req;

    // Cashonize / wc2-bch-bcr expects the raw libauth Transaction object (not hex),
    // with sourceOutputs as raw libauth objects. The entire params object is
    // serialized via libauth's stringify (Uint8Array → "<Uint8Array: 0x…>",
    // bigint → "<bigint: …n>") — identical to what bch-connect does internally.
    //
    // We use broadcast:false so Cashonize returns the signed bytes to us without
    // broadcasting. We then broadcast ourselves via WebSocket Electrum, which:
    //  1. Bypasses any quirks in Cashonize's chipnet broadcast path
    //  2. Gives us the raw signed hex for debugging
    //  3. Returns a proper error message from the node if something is wrong
    const params = JSON.parse(stringify({
      transaction,
      sourceOutputs: [sourceOutput],
      broadcast: false,
      userPrompt: "Confirm CashMint NFT mint",
    }));

    const result = await this.client.request<{
      signedTransaction: string;
      signedTransactionHash: string;
    }>({
      topic: this.session.topic,
      chainId: this.chainId,
      request: {
        method: "bch_signTransaction",
        params,
      },
    });

    console.log("[WalletConnectSigner] signed tx hex:", result.signedTransaction);

    // Broadcast ourselves via WebSocket Electrum (browser-compatible)
    const txid = await this.broadcastViaWebSocket(result.signedTransaction);

    return {
      signedTxBytes: hexToBin(result.signedTransaction),
      txid,
    };
  }

  // ── Broadcast via WebSocket Electrum ────────────────────────────────────────

  private broadcastViaWebSocket(txHex: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        fn();
      };

      const ws = new WebSocket(this.electrumWsUrl);

      const timer = setTimeout(() => {
        done(() => reject(new Error(`Electrum broadcast timed out after 30s (${this.electrumWsUrl})`)));
      }, 30_000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "blockchain.transaction.broadcast",
            params: [txHex],
          }),
        );
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            id: number;
            result?: string;
            error?: { message?: string; code?: number };
          };
          if (msg.error) {
            done(() => reject(new Error(msg.error!.message ?? JSON.stringify(msg.error))));
          } else if (typeof msg.result === "string") {
            done(() => resolve(msg.result!));
          }
          // ignore non-response messages (e.g. subscription events)
        } catch (e) {
          done(() => reject(e));
        }
      };

      ws.onerror = () => {
        done(() =>
          reject(
            new Error(
              `Could not connect to Electrum WebSocket at ${this.electrumWsUrl}. ` +
                "Try a different endpoint URL.",
            ),
          ),
        );
      };

      ws.onclose = (ev) => {
        if (!settled && !ev.wasClean) {
          done(() =>
            reject(new Error(`Electrum WebSocket closed unexpectedly (code ${ev.code})`)),
          );
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect({
      topic: this.session.topic,
      reason: { code: 6000, message: "User disconnected" },
    });
  }
}
