// ─── Attribute ───────────────────────────────────────────────────────────────

export interface Attribute {
  trait_type: string;
  value: string | number;
  display_type?: "number" | "date" | "boost_number" | "boost_percentage";
}

// ─── Media ────────────────────────────────────────────────────────────────────

export interface MediaItem {
  uri: string;
  type: string;
  cdn?: boolean;
}

// ─── Royalty ──────────────────────────────────────────────────────────────────

export interface RoyaltySplit {
  address: string;
  share: number;
}

export interface Royalty {
  bps: number;
  address: string;
  splits?: RoyaltySplit[];
}

// ─── Creator ─────────────────────────────────────────────────────────────────

export interface Creator {
  address: string;
  share: number;
  name?: string;
  uri?: string;
}

// ─── Collection ───────────────────────────────────────────────────────────────

export interface CollectionRef {
  name: string;
  category_id: string;
  max_supply?: number;
  token_serial?: number;
}

// ─── AI Hook ─────────────────────────────────────────────────────────────────

export type AiHookProtocol = "https" | "mcp" | "a2a";
export type AiHookAuth =
  | "bearer_ownership"
  | "none"
  | "api_key"
  | "signed_challenge";
export type AiHookNetwork = "mainnet" | "chipnet" | "custom";
export type AiHookCapability =
  | "chat"
  | "generate"
  | "transact"
  | "sign"
  | "query"
  | "automate";
export type AiHookType = "gateway" | "identity";

export interface AiHookEndpoint {
  uri: string;
  protocol: AiHookProtocol;
  auth: AiHookAuth;
  network?: AiHookNetwork;
}

export interface AiHookModel {
  name?: string;
  provider?: string;
  version?: string;
  modalities?: Array<"text" | "image" | "audio" | "video" | "code">;
}

export interface AiHookIdentity {
  agent_name: string;
  did: string;
  public_key: string;
  reputation_uri?: string;
}

export interface AiHookOwnershipGate {
  method: "utxo_proof";
  challenge_endpoint: string;
  category_id: string;
  token_serial?: number;
}

export interface AiHookUpdatePolicy {
  mutable_fields: string[];
  immutable_fields: string[];
  update_auth: "utxo_owner";
}

export interface AiHook {
  version: "1.0";
  type: AiHookType;
  endpoint?: AiHookEndpoint;
  capabilities?: AiHookCapability[];
  model?: AiHookModel;
  identity?: AiHookIdentity;
  ownership_gate?: AiHookOwnershipGate;
  update_policy?: AiHookUpdatePolicy;
}

// ─── Extensions ───────────────────────────────────────────────────────────────

export interface TokenExtensions {
  ai_hook?: AiHook;
  [key: string]: unknown;
}

// ─── Token Metadata ───────────────────────────────────────────────────────────

export interface TokenMetadata {
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json";
  cms_version: "1.0";
  name: string;
  description: string;
  image: string;
  animation_url?: string;
  external_url?: string;
  attributes?: Attribute[];
  media?: MediaItem[];
  royalty?: Royalty;
  creators?: Creator[];
  collection?: CollectionRef;
  extensions?: TokenExtensions;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── BCMR ─────────────────────────────────────────────────────────────────────

export interface BCMRIdentitySnapshot {
  name: string;
  description?: string;
  token?: {
    category: string;
    symbol?: string;
    decimals?: number;
    nfts?: {
      description?: string;
      fields?: Record<string, { name: string; description?: string }>;
      parse?: {
        bytecodeToNftTypes?: Record<string, unknown>;
      };
    };
  };
  uris?: Record<string, string>;
  tags?: string[];
}

export interface CashMintBCMRExtension {
  cashmint?: {
    version: string;
    metadata_base_uri?: string;
    royalty?: Royalty;
    creators?: Creator[];
    max_supply?: number;
    mint_date?: string;
    ai_hook?: AiHook;
  };
}

export interface BCMRRegistry {
  $schema: string;
  version: { major: number; minor: number; patch: number };
  latestRevision: string;
  registryIdentity: { name: string; description?: string; uris?: Record<string, string> };
  identities: Record<string, Record<string, BCMRIdentitySnapshot>>;
  extensions?: CashMintBCMRExtension;
}

// ─── buildBCMR params ─────────────────────────────────────────────────────────

export interface BuildBCMRParams {
  categoryId: string;
  name: string;
  description?: string;
  symbol?: string;
  metadataBaseUri?: string;
  maxSupply?: number;
  mintDate?: string;
  royalty?: Royalty;
  creators?: Creator[];
  uris?: Record<string, string>;
  tags?: string[];
  aiHook?: AiHook;
}

// ─── fetchToken / fetchCollection ─────────────────────────────────────────────

export interface FetchTokenOptions {
  /** Override the electrum/fulcrum server to use. Defaults to public mainnet. */
  electrumUrl?: string;
  /** Override the BCMR resolver. Defaults to reading on-chain OP_RETURN. */
  bcmrUrl?: string;
}

export interface ResolvedToken {
  categoryId: string;
  serial: number;
  metadata: TokenMetadata;
  /** Raw on-chain commitment bytes (hex) */
  commitment?: string;
}

export interface ResolvedCollection {
  categoryId: string;
  bcmr: BCMRRegistry;
  cashmint?: CashMintBCMRExtension["cashmint"];
}

// ─── mint ─────────────────────────────────────────────────────────────────────

export interface MintingUtxo {
  txid: string;
  vout: number;
  satoshis: number;
  /** Current on-chain commitment of the minting UTXO (hex, may be empty string) */
  commitment: string;
}

export interface MintParams {
  /** Validated per-token metadata to pin and record on-chain */
  metadata: TokenMetadata;
  /** Zero-indexed serial number for this token */
  serial: number;
  /** 64-char hex CashTokens category ID */
  categoryId: string;
  /** The minting-capable UTXO to spend */
  mintingUtxo: MintingUtxo;
  /**
   * Signing backend. The SDK never holds private key material directly.
   * - WifSigner            — for CLI / server-side scripts (key in env file)
   * - WizardConnectSigner  — for browser dapps (key stays in user's wallet)
   */
  signer: import("./signer.js").CashMintSigner;
  /** IPFS pinning backend (PinataProvider, FilebaseProvider, or custom). */
  ipfs: import("./ipfs.js").IpfsProvider;
  /**
   * How to encode the on-chain NFT commitment:
   * - "sequential"  — serial as minimal little-endian VM number (1–4 bytes)
   * - "cid_serial"  — [4 B serial LE][32 B CID SHA-256 digest][4 B flags] = 40 bytes
   */
  encodingFormat: "sequential" | "cid_serial";
  /**
   * Fulcrum / ElectrumX JSON-RPC endpoint for broadcasting.
   * Required when the signer does not broadcast (i.e. WifSigner).
   * Optional when using WizardConnectSigner with broadcast: true (default).
   */
  fulcrumUrl?: string;
}

export interface MintResult {
  /** Broadcast transaction ID */
  txid: string;
  /** Hex-encoded on-chain commitment bytes */
  commitment: string;
  /** IPFS CID of the pinned per-token JSON */
  cid: string;
  /** The validated token metadata that was minted */
  token: TokenMetadata;
}
