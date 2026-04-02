import { describe, it, expect } from "vitest";
import { validate } from "../src/validate.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MINIMAL_VALID = {
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
  cms_version: "1.0",
  name: "Mountain Sunset",
  description: "A digital painting of a mountain at dusk.",
  image: "ipfs://QmSimple123...",
};

const FULL_VALID = {
  $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
  cms_version: "1.0",
  name: "Mystic Tiger #042",
  description: "A legendary fire tiger from the Mystic Tigers collection.",
  image: "ipfs://QmImage123...",
  attributes: [
    { trait_type: "Background", value: "Volcano" },
    { trait_type: "Eyes", value: "Fire" },
    { trait_type: "Level", value: 5, display_type: "number" },
    { trait_type: "Birthday", value: 1546360800, display_type: "date" },
  ],
  royalty: {
    bps: 500,
    address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrst",
    splits: [
      { address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrst", share: 80 },
      { address: "bitcoincash:qp9xyzabcdef1234567890abcdefghijklmnopqrst", share: 20 },
    ],
  },
  creators: [
    {
      address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrst",
      share: 100,
      name: "TigerStudio",
    },
  ],
  collection: {
    name: "Mystic Tigers",
    category_id:
      "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
    max_supply: 1000,
    token_serial: 42,
  },
  extensions: {
    ai_hook: {
      version: "1.0",
      type: "gateway",
      endpoint: {
        uri: "https://api.mystictigers.io/agent/v1",
        protocol: "https",
        auth: "bearer_ownership",
        network: "mainnet",
      },
      capabilities: ["chat", "generate"],
      model: {
        name: "claude-sonnet-4-6",
        provider: "anthropic",
        modalities: ["text", "image"],
      },
      ownership_gate: {
        method: "utxo_proof",
        challenge_endpoint: "https://api.mystictigers.io/challenge",
        category_id:
          "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
        token_serial: 42,
      },
    },
  },
};

// ─── Required fields ─────────────────────────────────────────────────────────

describe("validate() — required fields", () => {
  it("accepts a minimal valid token", () => {
    const result = validate(MINIMAL_VALID);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing $schema", () => {
    const { $schema: _, ...rest } = MINIMAL_VALID;
    const result = validate(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("$schema") || e.includes("required"))).toBe(true);
  });

  it("rejects wrong $schema value", () => {
    const result = validate({ ...MINIMAL_VALID, $schema: "https://wrong.example.org/schema" });
    expect(result.valid).toBe(false);
  });

  it("rejects missing cms_version", () => {
    const { cms_version: _, ...rest } = MINIMAL_VALID;
    const result = validate(rest);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong cms_version", () => {
    const result = validate({ ...MINIMAL_VALID, cms_version: "2.0" });
    expect(result.valid).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = MINIMAL_VALID;
    const result = validate(rest);
    expect(result.valid).toBe(false);
  });

  it("rejects name longer than 128 chars", () => {
    const result = validate({ ...MINIMAL_VALID, name: "x".repeat(129) });
    expect(result.valid).toBe(false);
  });

  it("rejects missing description", () => {
    const { description: _, ...rest } = MINIMAL_VALID;
    const result = validate(rest);
    expect(result.valid).toBe(false);
  });

  it("rejects missing image", () => {
    const { image: _, ...rest } = MINIMAL_VALID;
    const result = validate(rest);
    expect(result.valid).toBe(false);
  });

  it("rejects image without ipfs:// or https:// prefix", () => {
    const result = validate({ ...MINIMAL_VALID, image: "ftp://example.com/img.png" });
    expect(result.valid).toBe(false);
  });

  it("accepts image with https:// prefix", () => {
    const result = validate({ ...MINIMAL_VALID, image: "https://example.com/img.png" });
    expect(result.valid).toBe(true);
  });
});

// ─── Full valid ───────────────────────────────────────────────────────────────

describe("validate() — full valid token", () => {
  it("accepts a fully-populated valid token", () => {
    const result = validate(FULL_VALID);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Attributes ───────────────────────────────────────────────────────────────

describe("validate() — attributes", () => {
  it("rejects an empty attributes array", () => {
    const result = validate({ ...MINIMAL_VALID, attributes: [] });
    expect(result.valid).toBe(false);
  });

  it("rejects attribute missing trait_type", () => {
    const result = validate({
      ...MINIMAL_VALID,
      attributes: [{ value: "Fire" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects attribute with invalid display_type", () => {
    const result = validate({
      ...MINIMAL_VALID,
      attributes: [{ trait_type: "Level", value: 5, display_type: "emoji" }],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts numeric value with display_type: number", () => {
    const result = validate({
      ...MINIMAL_VALID,
      attributes: [{ trait_type: "Level", value: 5, display_type: "number" }],
    });
    expect(result.valid).toBe(true);
  });
});

// ─── Royalty ─────────────────────────────────────────────────────────────────

describe("validate() — royalty", () => {
  it("rejects royalty bps > 1000", () => {
    const result = validate({
      ...MINIMAL_VALID,
      royalty: {
        bps: 1001,
        address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrs",
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects royalty address in non-cashaddr format", () => {
    const result = validate({
      ...MINIMAL_VALID,
      royalty: { bps: 500, address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf..." },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects splits with fewer than 2 entries", () => {
    const result = validate({
      ...MINIMAL_VALID,
      royalty: {
        bps: 500,
        address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrs",
        splits: [{ address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrs", share: 100 }],
      },
    });
    expect(result.valid).toBe(false);
  });
});

// ─── Collection ───────────────────────────────────────────────────────────────

describe("validate() — collection", () => {
  it("rejects invalid category_id format", () => {
    const result = validate({
      ...MINIMAL_VALID,
      collection: { name: "Test", category_id: "not-a-hex-id" },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts valid collection without optional fields", () => {
    const result = validate({
      ...MINIMAL_VALID,
      collection: {
        name: "Test Collection",
        category_id:
          "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c",
      },
    });
    expect(result.valid).toBe(true);
  });
});

// ─── AI Hook ─────────────────────────────────────────────────────────────────

describe("validate() — ai_hook", () => {
  it("accepts gateway type with required fields", () => {
    const result = validate(FULL_VALID);
    expect(result.valid).toBe(true);
  });

  it("rejects gateway type without ownership_gate", () => {
    const hook = { ...FULL_VALID.extensions.ai_hook };
    // @ts-expect-error intentional test
    delete hook.ownership_gate;
    const result = validate({
      ...MINIMAL_VALID,
      extensions: { ai_hook: hook },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects unknown ai_hook type", () => {
    const result = validate({
      ...MINIMAL_VALID,
      extensions: {
        ai_hook: { version: "1.0", type: "unknown_type" },
      },
    });
    expect(result.valid).toBe(false);
  });
});

// ─── Additional properties ────────────────────────────────────────────────────

describe("validate() — additionalProperties", () => {
  it("rejects top-level unknown properties", () => {
    const result = validate({ ...MINIMAL_VALID, unknown_field: "hello" });
    expect(result.valid).toBe(false);
  });

  it("rejects unknown properties inside attribute items", () => {
    const result = validate({
      ...MINIMAL_VALID,
      attributes: [{ trait_type: "Eyes", value: "Fire", extra: true }],
    });
    expect(result.valid).toBe(false);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("validate() — edge cases", () => {
  it("returns errors array with meaningful messages", () => {
    const result = validate({ cms_version: "1.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(typeof result.errors[0]).toBe("string");
  });

  it("handles null input gracefully", () => {
    const result = validate(null);
    expect(result.valid).toBe(false);
  });

  it("handles non-object input gracefully", () => {
    const result = validate("just a string");
    expect(result.valid).toBe(false);
  });

  it("handles array input gracefully", () => {
    const result = validate([]);
    expect(result.valid).toBe(false);
  });
});
