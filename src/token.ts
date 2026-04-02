import { fetchCollection } from "./bcmr.js";
import { validate } from "./validate.js";
import type {
  ResolvedToken,
  ResolvedCollection,
  FetchTokenOptions,
  TokenMetadata,
} from "./types.js";

/**
 * Fetches and fully resolves metadata for a specific token.
 *
 * Resolution steps:
 * 1. Fetch the collection's BCMR (via `fetchCollection`)
 * 2. Read `extensions.cashmint.metadata_base_uri` to locate per-token JSON
 * 3. Fetch `<metadata_base_uri>/<serial>.json` (or index pattern)
 * 4. Validate the fetched JSON against the CashMintStandard schema
 * 5. Return the merged resolved token
 *
 * @param categoryId - 64-char hex CashTokens category ID
 * @param serial     - Token serial number (0-indexed)
 * @param options    - Optional overrides for network/resolver
 */
export async function fetchToken(
  categoryId: string,
  serial: number,
  options: FetchTokenOptions = {}
): Promise<ResolvedToken> {
  if (!/^[0-9a-f]{64}$/.test(categoryId)) {
    throw new Error(
      `categoryId must be a 64-char lowercase hex string (got: ${categoryId})`
    );
  }
  if (!Number.isInteger(serial) || serial < 0) {
    throw new Error(`serial must be a non-negative integer (got: ${serial})`);
  }

  const collection: ResolvedCollection = await fetchCollection(
    categoryId,
    options
  );

  const baseUri = collection.cashmint?.metadata_base_uri;
  if (baseUri === undefined || baseUri === "") {
    throw new Error(
      `Collection ${categoryId} has no metadata_base_uri in its cashmint extension block`
    );
  }

  const metadataUrl = resolveMetadataUrl(baseUri, serial);
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch token metadata from ${metadataUrl}: HTTP ${response.status}`
    );
  }

  const json: unknown = await response.json();

  const result = validate(json);
  if (!result.valid) {
    throw new Error(
      `Token ${categoryId}:${serial} metadata failed CashMintStandard validation:\n` +
        result.errors.join("\n")
    );
  }

  return {
    categoryId,
    serial,
    metadata: json as TokenMetadata,
  };
}

/**
 * Fetches all CashMintStandard tokens held by a BCH address.
 *
 * Queries the electrum/Fulcrum server for UTXOs with CashToken data at the
 * given address, filters to ones whose category ID resolves to a valid
 * CashMintStandard collection, and returns their resolved metadata.
 *
 * @param cashaddr - Bitcoin Cash address in cashaddr format (bitcoincash:q...)
 * @param options  - Optional overrides for network/resolver
 */
export async function fetchByAddress(
  cashaddr: string,
  options: FetchTokenOptions = {}
): Promise<ResolvedToken[]> {
  if (!cashaddr.startsWith("bitcoincash:")) {
    throw new Error(
      `Address must be in cashaddr format (bitcoincash:...), got: ${cashaddr}`
    );
  }

  const electrumUrl =
    options.electrumUrl ?? "https://electrum.cashmint.org";

  // Fetch UTXOs for the address
  const rpcResp = await fetch(electrumUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "blockchain.address.listunspent",
      params: [cashaddr],
    }),
  });

  if (!rpcResp.ok) {
    throw new Error(
      `Electrum RPC error fetching UTXOs for ${cashaddr}: HTTP ${rpcResp.status}`
    );
  }

  const rpc = (await rpcResp.json()) as {
    result?: Array<{
      token_data?: {
        category?: string;
        nft?: { commitment?: string; capability?: string };
      };
    }>;
    error?: { message: string };
  };

  if (rpc.error !== undefined) {
    throw new Error(`Electrum RPC error: ${rpc.error.message}`);
  }

  const utxos = rpc.result ?? [];

  // Filter to NFT UTXOs
  const nftUtxos = utxos.filter(
    (u) => u.token_data?.category !== undefined && u.token_data.nft !== undefined
  );

  // Deduplicate: group by category + commitment (commitment encodes the serial)
  const resolved: ResolvedToken[] = [];

  const fetchPromises = nftUtxos.map(async (utxo) => {
    const category = utxo.token_data!.category!;
    const commitment = utxo.token_data!.nft?.commitment ?? "";
    const serial = commitmentToSerial(commitment);

    try {
      const token = await fetchToken(category, serial, options);
      token.commitment = commitment;
      resolved.push(token);
    } catch {
      // Skip tokens whose collection is not CashMintStandard-compliant
    }
  });

  await Promise.allSettled(fetchPromises);

  return resolved;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolves the full URL for a per-token metadata JSON file.
 *
 * Supports:
 * - IPFS base URIs: `ipfs://<cid>/` → gateway URL
 * - HTTPS base URIs: `https://.../<serial>.json`
 */
function resolveMetadataUrl(baseUri: string, serial: number): string {
  const base = baseUri.endsWith("/") ? baseUri : `${baseUri}/`;

  if (base.startsWith("ipfs://")) {
    const cid = base.slice(7).replace(/\/$/, "");
    return `https://ipfs.io/ipfs/${cid}/${serial}.json`;
  }

  return `${base}${serial}.json`;
}

/**
 * Decodes a CashTokens NFT commitment bytes (hex) to an integer serial number.
 *
 * CashMintStandard uses little-endian encoding for the serial, stored in the
 * commitment field of the minting UTXO. An empty commitment means serial 0.
 */
function commitmentToSerial(commitmentHex: string): number {
  if (commitmentHex === "" || commitmentHex === "00") return 0;

  const bytes = Buffer.from(commitmentHex, "hex");
  let serial = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    serial = serial * 256 + (bytes[i] ?? 0);
  }
  return serial;
}
