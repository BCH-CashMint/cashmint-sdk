import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchToken, fetchByAddress } from "../src/token.js";

const VALID_CATEGORY =
  "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c";

const MOCK_BCMR = {
  $schema: "https://cashtokens.org/bcmr-v2.schema.json",
  version: { major: 0, minor: 1, patch: 0 },
  latestRevision: "2024-01-01T00:00:00.000Z",
  registryIdentity: { name: "Mystic Tigers BCMR" },
  identities: {
    [VALID_CATEGORY]: {
      "2024-01-01T00:00:00.000Z": {
        name: "Mystic Tigers",
        token: { category: VALID_CATEGORY },
      },
    },
  },
  extensions: {
    cashmint: {
      version: "1.0",
      metadata_base_uri: "https://meta.mystictigers.io",
    },
  },
};

const MOCK_TOKEN_METADATA = {
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
  cms_version: "1.0",
  name: "Mystic Tiger #42",
  description: "A legendary fire tiger.",
  image: "ipfs://QmImage42...",
  collection: {
    name: "Mystic Tigers",
    category_id: VALID_CATEGORY,
    token_serial: 42,
  },
};

// Mock the OP_RETURN resolver — we test it via fetchCollection, so here we
// provide the bcmrUrl directly to bypass network calls.
beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchToken()", () => {
  it("fetches and returns a resolved token", async () => {
    // We inject both bcmrUrl (skips electrum) and a stub fetch for metadata
    global.fetch = vi
      .fn()
      // First call: BCMR registry
      .mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_BCMR), { status: 200 })
      )
      // Second call: per-token metadata JSON
      .mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_TOKEN_METADATA), { status: 200 })
      );

    const token = await fetchToken(VALID_CATEGORY, 42, {
      bcmrUrl: "https://meta.mystictigers.io/bcmr.json",
    });

    expect(token.categoryId).toBe(VALID_CATEGORY);
    expect(token.serial).toBe(42);
    expect(token.metadata.name).toBe("Mystic Tiger #42");
  });

  it("throws for invalid categoryId", async () => {
    await expect(fetchToken("not-valid", 0)).rejects.toThrow(/categoryId/);
  });

  it("throws for negative serial", async () => {
    await expect(fetchToken(VALID_CATEGORY, -1)).rejects.toThrow(/serial/);
  });

  it("throws when BCMR has no metadata_base_uri", async () => {
    const bcmrNoUri = {
      ...MOCK_BCMR,
      extensions: { cashmint: { version: "1.0" } },
    };

    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(bcmrNoUri), { status: 200 })
    );

    await expect(
      fetchToken(VALID_CATEGORY, 0, {
        bcmrUrl: "https://meta.mystictigers.io/bcmr.json",
      })
    ).rejects.toThrow(/metadata_base_uri/);
  });

  it("throws when token metadata fails schema validation", async () => {
    const badMetadata = { name: "Bad Token" }; // missing required fields

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_BCMR), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(badMetadata), { status: 200 })
      );

    await expect(
      fetchToken(VALID_CATEGORY, 0, {
        bcmrUrl: "https://meta.mystictigers.io/bcmr.json",
      })
    ).rejects.toThrow(/validation/);
  });

  it("throws when the metadata endpoint returns 404", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_BCMR), { status: 200 })
      )
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }));

    await expect(
      fetchToken(VALID_CATEGORY, 0, {
        bcmrUrl: "https://meta.mystictigers.io/bcmr.json",
      })
    ).rejects.toThrow(/404/);
  });
});

describe("fetchByAddress()", () => {
  it("throws for a non-cashaddr address", async () => {
    await expect(fetchByAddress("1A1zP1invalid...")).rejects.toThrow(
      /cashaddr/
    );
  });

  it("returns an empty array when the address has no NFT UTXOs", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }),
        { status: 200 }
      )
    );

    const tokens = await fetchByAddress(
      "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrs",
      { electrumUrl: "https://electrum.test" }
    );

    expect(tokens).toEqual([]);
  });
});
