// ─── IpfsProvider interface ───────────────────────────────────────────────────

/**
 * IPFS pinning abstraction — swap providers without changing mint() call sites.
 *
 * Built-in implementations: PinataProvider, FilebaseProvider.
 * Implement this interface to use any other provider (Infura, Kubo, Arweave, etc.).
 *
 * @example
 * // Custom self-hosted IPFS node
 * class KuboProvider implements IpfsProvider {
 *   async pin(metadata: object): Promise<string> {
 *     const res = await fetch("http://localhost:5001/api/v0/add?pin=true", {
 *       method: "POST",
 *       body: JSON.stringify(metadata),
 *     });
 *     const { Hash } = await res.json();
 *     return Hash;
 *   }
 * }
 */
export interface IpfsProvider {
  /**
   * Upload and pin the given metadata JSON object.
   * Returns the IPFS CIDv0 or CIDv1 string (e.g. "QmXyz..." or "bafy...").
   */
  pin(metadata: object): Promise<string>;
}

// ─── PinataProvider ───────────────────────────────────────────────────────────

/**
 * Pins metadata via Pinata Cloud (https://pinata.cloud).
 *
 * Requires a Pinata JWT — create one in your Pinata account under
 * API Keys → New Key → Grant pinFileToIPFS + pinJSONToIPFS scopes.
 *
 * @example
 * const ipfs = new PinataProvider({ jwt: process.env.PINATA_JWT! });
 */
export class PinataProvider implements IpfsProvider {
  constructor(private readonly config: { jwt: string }) {}

  async pin(metadata: object): Promise<string> {
    const resp = await fetch(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.jwt}`,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: { name: "metadata.json" },
        }),
      }
    );

    if (!resp.ok) {
      throw new Error(
        `Pinata pin failed: ${resp.status} ${resp.statusText}`
      );
    }

    const data = (await resp.json()) as { IpfsHash: string };
    return data.IpfsHash;
  }
}

// ─── FilebaseProvider ─────────────────────────────────────────────────────────

/**
 * Pins metadata via Filebase (https://filebase.com) using their S3-compatible
 * IPFS bucket API.  Filebase stores files on IPFS and returns the CID in the
 * `x-amz-meta-cid` response header.
 *
 * Requires an S3 access key, secret key, and a bucket name configured in
 * your Filebase account with IPFS storage enabled.
 *
 * NOTE: This provider uses Node.js `node:crypto` for AWS Signature V4 and is
 * intended for server-side / CLI use.  In browser dapps use PinataProvider.
 *
 * @example
 * const ipfs = new FilebaseProvider({
 *   accessKey: process.env.FILEBASE_ACCESS_KEY!,
 *   secretKey: process.env.FILEBASE_SECRET_KEY!,
 *   bucket:    process.env.FILEBASE_BUCKET!,
 * });
 */
export class FilebaseProvider implements IpfsProvider {
  constructor(
    private readonly config: {
      accessKey: string;
      secretKey: string;
      bucket: string;
    }
  ) {}

  async pin(metadata: object): Promise<string> {
    // Dynamic import keeps node:crypto out of browser bundles
    const { createHmac, createHash } = await import("node:crypto");

    const { accessKey, secretKey, bucket } = this.config;
    const body = JSON.stringify(metadata);
    const key = `cashmint-metadata-${Date.now()}.json`;
    const region = "us-east-1";
    const service = "s3";
    const host = "s3.filebase.com";

    const now = new Date();
    const date = now.toISOString().replace(/[:-]/g, "").slice(0, 8);
    const datetime =
      now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");

    function sha256Hex(data: string): string {
      return createHash("sha256").update(data, "utf8").digest("hex");
    }
    function hmacSha256(sigKey: Buffer | string, data: string): Buffer {
      return createHmac("sha256", sigKey).update(data).digest();
    }

    const bodyHash = sha256Hex(body);
    const canonicalHeaders = [
      `content-type:application/json`,
      `host:${host}`,
      `x-amz-content-sha256:${bodyHash}`,
      `x-amz-date:${datetime}`,
    ].join("\n") + "\n";
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalUri = `/${bucket}/${key}`;
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      "", // empty query string
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join("\n");

    const credentialScope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      datetime,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = hmacSha256(
      hmacSha256(
        hmacSha256(
          hmacSha256(`AWS4${secretKey}`, date),
          region
        ),
        service
      ),
      "aws4_request"
    );
    const signature = hmacSha256(signingKey, stringToSign).toString("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const resp = await fetch(`https://${host}${canonicalUri}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-amz-content-sha256": bodyHash,
        "x-amz-date": datetime,
        Authorization: authorization,
      },
      body,
    });

    if (!resp.ok) {
      throw new Error(
        `Filebase S3 upload failed: ${resp.status} ${resp.statusText}`
      );
    }

    const cid = resp.headers.get("x-amz-meta-cid");
    if (!cid) {
      throw new Error(
        "Filebase did not return a CID. Ensure the bucket has IPFS storage enabled."
      );
    }
    return cid;
  }
}
