import type {
  BCMRRegistry,
  BCMRIdentitySnapshot,
  BuildBCMRParams,
  ResolvedCollection,
  FetchTokenOptions,
  CashMintBCMRExtension,
} from "./types.js";

const BCMR_SCHEMA =
  "https://cashtokens.org/bcmr-v2.schema.json";

/**
 * Generates a CashMintStandard-compliant BCMR registry file for a collection.
 *
 * The output includes:
 * - A standard BCMR v2 identity snapshot for the token category
 * - An `extensions.cashmint` block with CMS-specific collection metadata
 *
 * @param params - Collection parameters
 * @returns A fully-formed BCMR registry object ready to be serialised to JSON
 *          and published (on-chain OP_RETURN, IPFS, or HTTPS).
 */
export function buildBCMR(params: BuildBCMRParams): BCMRRegistry {
  const {
    categoryId,
    name,
    description,
    symbol,
    metadataBaseUri,
    maxSupply,
    mintDate,
    royalty,
    creators,
    uris,
    tags,
    aiHook,
  } = params;

  if (!/^[0-9a-f]{64}$/.test(categoryId)) {
    throw new Error(
      `categoryId must be a 64-char lowercase hex string (got: ${categoryId})`
    );
  }

  const now = new Date().toISOString();

  const snapshot: BCMRIdentitySnapshot = {
    name,
    ...(description !== undefined && { description }),
    token: {
      category: categoryId,
      ...(symbol !== undefined && { symbol }),
      nfts: {
        ...(description !== undefined && { description }),
        parse: {
          bytecodeToNftTypes: {},
        },
      },
    },
    ...(uris !== undefined && { uris }),
    ...(tags !== undefined && { tags }),
  };

  const cashmintExt: NonNullable<CashMintBCMRExtension["cashmint"]> = {
    version: "1.0",
    ...(metadataBaseUri !== undefined && { metadata_base_uri: metadataBaseUri }),
    ...(royalty !== undefined && { royalty }),
    ...(creators !== undefined && { creators }),
    ...(maxSupply !== undefined && { max_supply: maxSupply }),
    ...(mintDate !== undefined && { mint_date: mintDate }),
    ...(aiHook !== undefined && { ai_hook: aiHook }),
  };

  const registry: BCMRRegistry = {
    $schema: BCMR_SCHEMA,
    version: { major: 0, minor: 1, patch: 0 },
    latestRevision: now,
    registryIdentity: {
      name: `${name} BCMR`,
      ...(description !== undefined && { description }),
      ...(uris !== undefined && { uris }),
    },
    identities: {
      [categoryId]: {
        [now]: snapshot,
      },
    },
    extensions: {
      cashmint: cashmintExt,
    },
  };

  return registry;
}

/**
 * Fetches and resolves collection metadata for a given category ID.
 *
 * Resolution order:
 * 1. If `options.bcmrUrl` is provided, fetch from that URL directly.
 * 2. Otherwise, read the on-chain OP_RETURN BCMR pointer from the genesis
 *    transaction of `categoryId` and follow it.
 *
 * @param categoryId - 64-char hex CashTokens category ID
 * @param options    - Optional overrides for network/resolver
 */
export async function fetchCollection(
  categoryId: string,
  options: FetchTokenOptions = {}
): Promise<ResolvedCollection> {
  if (!/^[0-9a-f]{64}$/.test(categoryId)) {
    throw new Error(
      `categoryId must be a 64-char lowercase hex string (got: ${categoryId})`
    );
  }

  let bcmrUrl = options.bcmrUrl;

  if (bcmrUrl === undefined) {
    bcmrUrl = await resolveBCMRUrl(categoryId, options.electrumUrl);
  }

  const response = await fetch(bcmrUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch BCMR from ${bcmrUrl}: HTTP ${response.status}`
    );
  }

  const bcmr = (await response.json()) as BCMRRegistry;

  const cashmint = bcmr.extensions?.cashmint;

  return { categoryId, bcmr, cashmint };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolves the BCMR URL from the genesis transaction's OP_RETURN output.
 *
 * CashTokens BCMR authchains use an OP_RETURN with:
 *   OP_RETURN <0x424d5252> <uri-or-hash> [<hash>]
 *
 * This implementation queries a Fulcrum/Electrum server via the standard
 * JSON-RPC interface.
 */
async function resolveBCMRUrl(
  categoryId: string,
  electrumUrl?: string
): Promise<string> {
  const url = electrumUrl ?? "https://electrum.cashmint.org";

  // The category ID is the txid of the genesis tx. Fetch it.
  const rpcResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "blockchain.transaction.get",
      params: [categoryId, true],
    }),
  });

  if (!rpcResp.ok) {
    throw new Error(
      `Electrum RPC error fetching genesis tx for ${categoryId}: HTTP ${rpcResp.status}`
    );
  }

  const rpc = (await rpcResp.json()) as {
    result?: { vout?: Array<{ scriptPubKey?: { hex?: string } }> };
    error?: { message: string };
  };

  if (rpc.error !== undefined) {
    throw new Error(`Electrum RPC error: ${rpc.error.message}`);
  }

  const vout = rpc.result?.vout ?? [];

  for (const output of vout) {
    const hex = output.scriptPubKey?.hex ?? "";
    const parsed = parseBCMROpReturn(hex);
    if (parsed !== null) return parsed;
  }

  throw new Error(
    `No BCMR OP_RETURN found in genesis transaction for category ${categoryId}`
  );
}

/**
 * Parses a scriptPubKey hex string and extracts a BCMR URI if present.
 *
 * BCMR OP_RETURN format (CHIP-2022-02-CashTokens):
 *   6a                  — OP_RETURN
 *   04 424d5252         — push "BCMR" (4 bytes)
 *   <push> <uri-bytes>  — UTF-8 URI or IPFS CID
 *   [<push> <hash>]     — optional SHA256 hash for integrity
 */
function parseBCMROpReturn(hex: string): string | null {
  // Must start with OP_RETURN (6a) and contain "BCMR" marker (424d5252)
  if (!hex.startsWith("6a") || !hex.includes("424d5252")) return null;

  try {
    const bytes = Buffer.from(hex, "hex");
    let cursor = 0;

    // OP_RETURN
    if (bytes[cursor] !== 0x6a) return null;
    cursor++;

    // Expect OP_PUSHDATA for "BCMR" — could be 04 (4-byte push)
    const markerLen = bytes[cursor];
    if (markerLen === undefined) return null;
    cursor++;
    const marker = bytes.subarray(cursor, cursor + markerLen).toString("ascii");
    if (marker !== "BCMR") return null;
    cursor += markerLen;

    // Next push is the URI
    const uriLen = bytes[cursor];
    if (uriLen === undefined) return null;
    cursor++;
    const uri = bytes.subarray(cursor, cursor + uriLen).toString("utf8");

    return uri;
  } catch {
    return null;
  }
}
