// Core — Priority 1
export { validate } from "./validate.js";
export { buildBCMR, fetchCollection } from "./bcmr.js";
export { fetchToken, fetchByAddress } from "./token.js";

// Priority 2
export { mint, encodeCommitment } from "./mint.js";

// Priority 3
export { requestChallenge, proveOwnership, verifyOwnership } from "./ai-hook.js";

// Types
export type {
  // Token metadata
  TokenMetadata,
  Attribute,
  MediaItem,
  Royalty,
  RoyaltySplit,
  Creator,
  CollectionRef,
  TokenExtensions,
  // AI Hook
  AiHook,
  AiHookEndpoint,
  AiHookModel,
  AiHookIdentity,
  AiHookOwnershipGate,
  AiHookUpdatePolicy,
  AiHookType,
  AiHookProtocol,
  AiHookAuth,
  AiHookNetwork,
  AiHookCapability,
  // Validation
  ValidationResult,
  // BCMR
  BCMRRegistry,
  BCMRIdentitySnapshot,
  BuildBCMRParams,
  CashMintBCMRExtension,
  // Resolved
  ResolvedToken,
  ResolvedCollection,
  FetchTokenOptions,
  // Mint
  MintParams,
  MintingUtxo,
  MintResult,
} from "./types.js";
