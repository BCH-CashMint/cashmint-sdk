import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CID } from "multiformats/cid";

// ─── Hoisted mock constants ───────────────────────────────────────────────────
const { MOCK_CID, MOCK_TXID } = vi.hoisted(() => ({
  MOCK_CID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  MOCK_TXID: "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233",
}));

// ─── Mock node:tls ───────────────────────────────────────────────────────────
// Simulates a Fulcrum Electrum TLS connection returning a configurable response.
// tlsResponse is updated per-test to simulate success/error scenarios.
const tlsState = vi.hoisted(() => ({
  response: "" as string, // set before each test
}));

vi.mock("node:tls", () => ({
  default: {
    connect: (_opts: unknown, connectCb: () => void) => {
      const handlers: Record<string, (arg?: unknown) => void> = {};
      const socket = {
        write: (_data: string) => {
          // Deliver the configured response asynchronously after write
          setTimeout(() => handlers["data"]?.(Buffer.from(tlsState.response + "\n")), 0);
        },
        on: (event: string, handler: (arg?: unknown) => void) => {
          handlers[event] = handler;
          return socket;
        },
        destroy: () => {},
        setTimeout: () => {},
      };
      // Simulate async TLS handshake completing
      setTimeout(connectCb, 0);
      return socket;
    },
  },
}));

// ─── Source under test ────────────────────────────────────────────────────────
import { encodeCommitment, mint } from "../src/mint.js";
import type { MintParams } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_WIF = "L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN";
const TEST_CATEGORY =
  "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c";
const TEST_TXID =
  "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

const VALID_METADATA = {
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json" as const,
  cms_version: "1.0" as const,
  name: "Mystic Tiger #1",
  description: "A legendary fire tiger.",
  image: "ipfs://QmTestImage123...",
  collection: {
    name: "Mystic Tigers",
    category_id: TEST_CATEGORY,
    token_serial: 1,
  },
};

function makeParams(overrides: Partial<MintParams> = {}): MintParams {
  return {
    metadata: VALID_METADATA,
    serial: 1,
    categoryId: TEST_CATEGORY,
    mintingUtxo: {
      txid: TEST_TXID,
      vout: 0,
      satoshis: 10000,
      commitment: "",
    },
    wif: TEST_WIF,
    encodingFormat: "sequential",
    fulcrumUrl: "https://fulcrum.test:50002",
    pinataJwt: "test-pinata-jwt",
    ...overrides,
  };
}

// ─── encodeCommitment — sequential ───────────────────────────────────────────

describe("encodeCommitment() — sequential", () => {
  it("encodes serial 0 as [0x00] (1-byte minimum)", () => {
    expect(encodeCommitment(0, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0x00])
    );
  });

  it("encodes serial 1 as [0x01]", () => {
    expect(encodeCommitment(1, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0x01])
    );
  });

  it("encodes serial 127 as [0x7f]", () => {
    expect(encodeCommitment(127, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0x7f])
    );
  });

  it("encodes serial 128 as [0x80, 0x00] (sign-bit padding)", () => {
    expect(encodeCommitment(128, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0x80, 0x00])
    );
  });

  it("encodes serial 255 as [0xff, 0x00]", () => {
    expect(encodeCommitment(255, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0xff, 0x00])
    );
  });

  it("encodes serial 256 as [0x00, 0x01] (little-endian)", () => {
    expect(encodeCommitment(256, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0x00, 0x01])
    );
  });

  it("encodes serial 1000 = 0x03e8 as [0xe8, 0x03] LE", () => {
    expect(encodeCommitment(1000, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0xe8, 0x03])
    );
  });

  it("encodes serial 32767 (0x7fff) as 2 bytes", () => {
    expect(encodeCommitment(32767, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0xff, 0x7f])
    );
  });

  it("encodes serial 32768 (0x8000) with sign-bit padding → 3 bytes", () => {
    expect(encodeCommitment(32768, MOCK_CID, "sequential")).toEqual(
      new Uint8Array([0x00, 0x80, 0x00])
    );
  });

  it("produces at most 4 bytes for serials ≤ 0x7fffff", () => {
    expect(encodeCommitment(0x7fffff, MOCK_CID, "sequential").length).toBeLessThanOrEqual(4);
  });

  it("throws for a negative serial", () => {
    expect(() => encodeCommitment(-1, MOCK_CID, "sequential")).toThrow(/serial/);
  });

  it("throws for a non-integer serial", () => {
    expect(() => encodeCommitment(1.5, MOCK_CID, "sequential")).toThrow(/serial/);
  });
});

// ─── encodeCommitment — cid_serial ────────────────────────────────────────────

describe("encodeCommitment() — cid_serial", () => {
  it("produces exactly 40 bytes", () => {
    expect(encodeCommitment(42, MOCK_CID, "cid_serial").length).toBe(40);
  });

  it("stores the serial as uint32 LE in bytes 0-3", () => {
    const b = encodeCommitment(42, MOCK_CID, "cid_serial");
    expect(new DataView(b.buffer).getUint32(0, true)).toBe(42);
  });

  it("stores a larger serial correctly in bytes 0-3", () => {
    const b = encodeCommitment(0x01020304, MOCK_CID, "cid_serial");
    expect(new DataView(b.buffer).getUint32(0, true)).toBe(0x01020304);
  });

  it("stores the CID SHA-256 digest in bytes 4-35", () => {
    const digest = CID.parse(MOCK_CID).multihash.digest;
    const b = encodeCommitment(0, MOCK_CID, "cid_serial");
    expect(b.slice(4, 36)).toEqual(new Uint8Array(digest));
  });

  it("flags bytes 36-39 are all zero", () => {
    const b = encodeCommitment(1, MOCK_CID, "cid_serial");
    expect(Array.from(b.slice(36, 40))).toEqual([0, 0, 0, 0]);
  });

  it("same CID → identical bytes 4-39 regardless of serial", () => {
    const a = encodeCommitment(1, MOCK_CID, "cid_serial");
    const b = encodeCommitment(2, MOCK_CID, "cid_serial");
    expect(a.slice(0, 4)).not.toEqual(b.slice(0, 4));
    expect(a.slice(4)).toEqual(b.slice(4));
  });
});

// ─── mint() — input validation ───────────────────────────────────────────────

describe("mint() — input validation", () => {
  it("throws if metadata fails CMS schema validation", async () => {
    const params = makeParams({ metadata: { name: "bad" } as never });
    await expect(mint(params)).rejects.toThrow(/invalid/i);
  });

  it("throws if pinataJwt is missing", async () => {
    await expect(mint(makeParams({ pinataJwt: undefined }))).rejects.toThrow(/pinataJwt/);
  });

  it("throws if pinataJwt is empty string", async () => {
    await expect(mint(makeParams({ pinataJwt: "" }))).rejects.toThrow(/pinataJwt/);
  });

  it("throws if minting UTXO has insufficient satoshis", async () => {
    const params = makeParams({
      mintingUtxo: { txid: TEST_TXID, vout: 0, satoshis: 100, commitment: "" },
    });
    await expect(mint(params)).rejects.toThrow(/Insufficient|need at least/i);
  });
});

// ─── mint() — full flow ───────────────────────────────────────────────────────

describe("mint() — full flow", () => {
  beforeEach(() => {
    // Default: Pinata succeeds, Fulcrum returns MOCK_TXID
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ IpfsHash: MOCK_CID }), { status: 200 })
    );
    tlsState.response = JSON.stringify({ jsonrpc: "2.0", id: 1, result: MOCK_TXID });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns MintResult with correct shape", async () => {
    const result = await mint(makeParams());
    expect(result).toMatchObject({
      txid: MOCK_TXID,
      cid: MOCK_CID,
      token: VALID_METADATA,
    });
    expect(typeof result.commitment).toBe("string");
    expect(result.commitment.length).toBeGreaterThan(0);
  });

  it("sequential serial 1 → commitment hex '01'", async () => {
    const result = await mint(makeParams({ serial: 1, encodingFormat: "sequential" }));
    expect(result.commitment).toBe("01");
  });

  it("sequential serial 128 → commitment hex '8000'", async () => {
    const result = await mint(makeParams({ serial: 128, encodingFormat: "sequential" }));
    expect(result.commitment).toBe("8000");
  });

  it("cid_serial → commitment is exactly 80 hex chars (40 bytes)", async () => {
    const result = await mint(makeParams({ encodingFormat: "cid_serial" }));
    expect(result.commitment.length).toBe(80);
    expect(/^[0-9a-f]+$/.test(result.commitment)).toBe(true);
  });

  it("calls Pinata before broadcasting", async () => {
    await mint(makeParams());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("pinata.cloud"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws if Fulcrum returns an RPC error", async () => {
    tlsState.response = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -22, message: "TX decode failed" },
    });
    await expect(mint(makeParams())).rejects.toThrow(/TX decode failed/);
  });

  it("accepts a non-empty minting UTXO commitment", async () => {
    const result = await mint(
      makeParams({
        mintingUtxo: { txid: TEST_TXID, vout: 0, satoshis: 10000, commitment: "2a" },
      })
    );
    expect(result.txid).toBe(MOCK_TXID);
  });

  it("two-pass fee produces a valid transaction version 2", async () => {
    // The mint does two broadcast calls (pass1 + pass2 fee calculation).
    // Collect all tx hexes sent to the TLS socket write.
    const writtenHexes: string[] = [];
    const { default: tlsMod } = await import("node:tls");
    vi.spyOn(tlsMod, "connect").mockImplementation((_opts: unknown, cb: () => void) => {
      const handlers: Record<string, (arg?: unknown) => void> = {};
      const socket = {
        write: (data: string) => {
          const body = JSON.parse(data) as { params: string[] };
          writtenHexes.push(body.params[0]!);
          setTimeout(() => handlers["data"]?.(
            Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: MOCK_TXID }) + "\n")
          ), 0);
        },
        on: (event: string, handler: (arg?: unknown) => void) => { handlers[event] = handler; return socket; },
        destroy: () => {},
        setTimeout: () => {},
      };
      setTimeout(cb, 0);
      return socket as never;
    });

    await mint(makeParams());
    // Two-pass fee builds two txs internally but only broadcasts the final one
    expect(writtenHexes.length).toBe(1);
    const hex = writtenHexes[0]!;
    expect(hex.startsWith("02000000")).toBe(true);
    expect(hex.length % 2).toBe(0);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });
});
