import { describe, it, expect } from "vitest";
import { buildBCMR } from "../src/bcmr.js";

const VALID_CATEGORY =
  "89cad9e3e34280eb1e8bc420542c00a7fcc01002b663dbf7f38bceddf80e680c";

describe("buildBCMR()", () => {
  it("builds a minimal valid BCMR registry", () => {
    const registry = buildBCMR({
      categoryId: VALID_CATEGORY,
      name: "Mystic Tigers",
    });

    expect(registry.$schema).toBe("https://cashtokens.org/bcmr-v2.schema.json");
    expect(registry.version).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(registry.identities[VALID_CATEGORY]).toBeDefined();
    expect(registry.extensions?.cashmint?.version).toBe("1.0");
  });

  it("includes the identity snapshot under the categoryId key", () => {
    const registry = buildBCMR({
      categoryId: VALID_CATEGORY,
      name: "Mystic Tigers",
      description: "A legendary collection",
    });

    const snapshots = registry.identities[VALID_CATEGORY];
    expect(snapshots).toBeDefined();
    const snapshotValues = Object.values(snapshots!);
    expect(snapshotValues).toHaveLength(1);
    expect(snapshotValues[0]!.name).toBe("Mystic Tigers");
    expect(snapshotValues[0]!.description).toBe("A legendary collection");
  });

  it("sets the token.category correctly", () => {
    const registry = buildBCMR({ categoryId: VALID_CATEGORY, name: "Tigers" });
    const snapshot = Object.values(registry.identities[VALID_CATEGORY]!)[0]!;
    expect(snapshot.token?.category).toBe(VALID_CATEGORY);
  });

  it("includes optional symbol when provided", () => {
    const registry = buildBCMR({
      categoryId: VALID_CATEGORY,
      name: "Tigers",
      symbol: "TIGER",
    });
    const snapshot = Object.values(registry.identities[VALID_CATEGORY]!)[0]!;
    expect(snapshot.token?.symbol).toBe("TIGER");
  });

  it("includes cashmint.metadata_base_uri when provided", () => {
    const registry = buildBCMR({
      categoryId: VALID_CATEGORY,
      name: "Tigers",
      metadataBaseUri: "ipfs://QmMetadata123",
    });
    expect(registry.extensions?.cashmint?.metadata_base_uri).toBe(
      "ipfs://QmMetadata123"
    );
  });

  it("includes royalty in the cashmint extension", () => {
    const royalty = {
      bps: 500,
      address: "bitcoincash:qr3kqekcdabc1234567890abcdefghijklmnopqrs",
    };
    const registry = buildBCMR({
      categoryId: VALID_CATEGORY,
      name: "Tigers",
      royalty,
    });
    expect(registry.extensions?.cashmint?.royalty).toEqual(royalty);
  });

  it("includes max_supply in the cashmint extension", () => {
    const registry = buildBCMR({
      categoryId: VALID_CATEGORY,
      name: "Tigers",
      maxSupply: 1000,
    });
    expect(registry.extensions?.cashmint?.max_supply).toBe(1000);
  });

  it("includes uris on the identity snapshot", () => {
    const uris = { web: "https://mystictigers.io", icon: "ipfs://QmIcon..." };
    const registry = buildBCMR({ categoryId: VALID_CATEGORY, name: "Tigers", uris });
    const snapshot = Object.values(registry.identities[VALID_CATEGORY]!)[0]!;
    expect(snapshot.uris).toEqual(uris);
  });

  it("includes tags on the identity snapshot", () => {
    const tags = ["nft", "gaming"];
    const registry = buildBCMR({ categoryId: VALID_CATEGORY, name: "Tigers", tags });
    const snapshot = Object.values(registry.identities[VALID_CATEGORY]!)[0]!;
    expect(snapshot.tags).toEqual(tags);
  });

  it("throws for an invalid categoryId", () => {
    expect(() =>
      buildBCMR({ categoryId: "not-a-valid-hex", name: "Tigers" })
    ).toThrow(/categoryId/);
  });

  it("sets latestRevision to a valid ISO date string", () => {
    const registry = buildBCMR({ categoryId: VALID_CATEGORY, name: "Tigers" });
    expect(() => new Date(registry.latestRevision)).not.toThrow();
    expect(new Date(registry.latestRevision).getFullYear()).toBeGreaterThan(2020);
  });

  it("omits undefined optional fields from cashmint extension", () => {
    const registry = buildBCMR({ categoryId: VALID_CATEGORY, name: "Tigers" });
    const cashmint = registry.extensions?.cashmint;
    expect(cashmint).not.toHaveProperty("royalty");
    expect(cashmint).not.toHaveProperty("creators");
    expect(cashmint).not.toHaveProperty("max_supply");
    expect(cashmint).not.toHaveProperty("mint_date");
    expect(cashmint).not.toHaveProperty("ai_hook");
    expect(cashmint).not.toHaveProperty("metadata_base_uri");
  });
});
