import { useState } from "react";
import { WalletConnectSigner } from "./WalletConnectSigner";
import { PinataProvider, mint, type MintResult, type IpfsProvider } from "@cashmint/sdk";

// ─── WalletConnect project ID ─────────────────────────────────────────────────
const WC_PROJECT_ID = import.meta.env["VITE_WC_PROJECT_ID"] as string | undefined;

// ─── Supported wallets ────────────────────────────────────────────────────────
const WALLETS = [
  {
    name: "Cashonize",
    color: "#4f46e5",
    url: "https://cashonize.com",
    hint: "Open Cashonize → WalletConnect → paste the URI",
  },
  {
    name: "Paytaca",
    color: "#0ea5e9",
    url: "https://paytaca.com",
    hint: "Open Paytaca → Apps → WalletConnect → paste the URI",
  },
  {
    name: "Zapit",
    color: "#f59e0b",
    url: "https://zapit.io",
    hint: "Open Zapit → DApps → WalletConnect → paste the URI",
  },
] as const;

type WalletName = (typeof WALLETS)[number]["name"];

// ─── IPFS options ─────────────────────────────────────────────────────────────
type IpfsMode = "prehosted" | "pinata" | "selfhosted" | "filebase";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = "connect" | "ipfs" | "details" | "minting" | "result";

interface TokenDetails {
  name: string;
  description: string;
  image: string;
  serial: number;
  categoryId: string;
  mintingTxid: string;
  mintingVout: number;
  mintingVoutStr: string;
  mintingSatoshis: number;
  mintingSatoshisStr: string;
  mintingCommitment: string;
  encodingFormat: "sequential" | "cid_serial";
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  app: {
    maxWidth: 600,
    margin: "40px auto",
    fontFamily: "'system-ui', sans-serif",
    padding: "0 20px",
    color: "#111",
  } as React.CSSProperties,
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 28,
    marginTop: 24,
    background: "#fff",
    boxShadow: "0 1px 4px rgba(0,0,0,.06)",
  } as React.CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 4 } as React.CSSProperties,
  h2: { fontSize: 18, fontWeight: 600, marginBottom: 16 } as React.CSSProperties,
  label: { display: "block", fontWeight: 500, fontSize: 13, marginBottom: 4 } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 14,
    marginBottom: 14,
    boxSizing: "border-box",
  } as React.CSSProperties,
  select: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 14,
    marginBottom: 14,
    background: "#fff",
  } as React.CSSProperties,
  btn: {
    padding: "10px 20px",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  } as React.CSSProperties,
  btnSecondary: {
    padding: "10px 20px",
    background: "transparent",
    color: "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
    marginLeft: 10,
  } as React.CSSProperties,
  walletBtn: (color: string, active: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "14px 16px",
    border: `2px solid ${active ? color : "#e2e8f0"}`,
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? `${color}10` : "#fff",
    marginBottom: 10,
    color: "#111",
    textAlign: "left" as const,
    transition: "border-color 0.15s, background 0.15s",
  } as React.CSSProperties),
  dot: (color: string) => ({
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  } as React.CSSProperties),
  uriBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "monospace",
    fontSize: 11,
    wordBreak: "break-all" as const,
    color: "#475569",
    marginTop: 12,
    position: "relative" as const,
  } as React.CSSProperties,
  ipfsOption: (active: boolean) => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    border: `2px solid ${active ? "#2563eb" : "#e2e8f0"}`,
    borderRadius: 8,
    marginBottom: 8,
    cursor: "pointer",
    background: active ? "#eff6ff" : "#fff",
    transition: "border-color 0.15s",
  } as React.CSSProperties),
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#b91c1c",
    fontSize: 13,
    marginTop: 12,
  } as React.CSSProperties,
  info: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#1d4ed8",
    fontSize: 13,
    marginTop: 12,
  } as React.CSSProperties,
  success: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#166534",
    fontSize: 13,
    marginTop: 8,
    wordBreak: "break-all" as const,
  } as React.CSSProperties,
  mono: { fontFamily: "monospace", fontSize: 12 } as React.CSSProperties,
  step: { display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" as const },
  stepPill: (active: boolean, done: boolean) => ({
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: active ? "#2563eb" : done ? "#dcfce7" : "#f1f5f9",
    color: active ? "#fff" : done ? "#166534" : "#64748b",
  } as React.CSSProperties),
};

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<Step>("connect");

  // Connect state
  const [selectedWallet, setSelectedWallet] = useState<WalletName | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signer, setSigner] = useState<WalletConnectSigner | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);

  // IPFS state
  const [ipfsMode, setIpfsMode] = useState<IpfsMode>("pinata");
  const [prehostedCid, setPrehostedCid] = useState("");
  const [pinataJwt, setPinataJwt] = useState("");
  const [selfhostedUrl, setSelfhostedUrl] = useState("http://localhost:5001");
  const [filebaseKey, setFilebaseKey] = useState("");
  const [filebaseSecret, setFilebaseSecret] = useState("");
  const [filebaseBucket, setFilebaseBucket] = useState("");

  // Electrum WebSocket URL for broadcasting (browser-compatible, bypasses Cashonize's broadcast path)
  const [electrumWsUrl, setElectrumWsUrl] = useState("wss://chipnet.imaginary.cash:50003");

  // Token details state
  const [details, setDetails] = useState<TokenDetails>({
    name: "",
    description: "",
    image: "",
    serial: 1,
    categoryId: "",
    mintingTxid: "",
    mintingVout: 0,
    mintingVoutStr: "0",
    mintingSatoshis: 10000,
    mintingSatoshisStr: "10000",
    mintingCommitment: "",
    encodingFormat: "sequential",
  });

  const [result, setResult] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Step 1: Connect wallet ──────────────────────────────────────────────────

  async function connectWallet(wallet: (typeof WALLETS)[number]) {
    if (!WC_PROJECT_ID) {
      setError("VITE_WC_PROJECT_ID is not set — see examples/ui/.env");
      return;
    }

    setSelectedWallet(wallet.name);
    setWcUri(null);
    setCopied(false);
    setError(null);
    setLoading(true);

    try {
      const connected = await WalletConnectSigner.connect(
        WC_PROJECT_ID,
        async (uri) => {
          setWcUri(uri);
          // Copy to clipboard
          try {
            await navigator.clipboard.writeText(uri);
            setCopied(true);
          } catch {
            // clipboard unavailable (non-HTTPS) — user copies manually
          }
          // Open wallet site
          window.open(wallet.url, "_blank");
        },
        undefined, // chainId — defaults to chipnet
        electrumWsUrl,
      );

      setSigner(connected);
      setConnectedWallet(wallet.name);
      setStep("ipfs");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function copyUri() {
    if (!wcUri) return;
    navigator.clipboard.writeText(wcUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Build IPFS provider from current config ─────────────────────────────────

  function buildIpfsProvider(): IpfsProvider {
    switch (ipfsMode) {
      case "prehosted":
        if (!prehostedCid.trim()) throw new Error("Enter the existing CID.");
        return { pin: async () => prehostedCid.trim() };

      case "pinata":
        if (!pinataJwt.trim()) throw new Error("Enter your Pinata JWT.");
        return new PinataProvider({ jwt: pinataJwt.trim() });

      case "selfhosted": {
        const base = selfhostedUrl.replace(/\/$/, "");
        return {
          pin: async (metadata: object) => {
            const form = new FormData();
            form.append(
              "file",
              new Blob([JSON.stringify(metadata)], { type: "application/json" }),
              "metadata.json",
            );
            const res = await fetch(`${base}/api/v0/add?pin=true`, {
              method: "POST",
              body: form,
            });
            if (!res.ok) throw new Error(`Kubo upload failed: ${res.status}`);
            const { Hash } = (await res.json()) as { Hash: string };
            return Hash;
          },
        };
      }

      case "filebase":
        throw new Error(
          "Filebase uses Node.js crypto — run it server-side. Use Pinata or self-hosted in the browser."
        );
    }
  }

  // ── Step 2: Mint ────────────────────────────────────────────────────────────

  async function handleMint() {
    if (!signer) return;
    setError(null);
    setLoading(true);
    try {
      const ipfs = buildIpfsProvider();
      const mintResult = await mint({
        signer,
        ipfs,
        metadata: {
          $schema: "https://cashmintstandard.org/schema/v1.0.0.json",
          cms_version: "1.0",
          name: details.name,
          description: details.description,
          image: details.image,
        },
        serial: details.serial,
        categoryId: details.categoryId,
        mintingUtxo: {
          txid: details.mintingTxid,
          vout: details.mintingVout,
          satoshis: details.mintingSatoshis,
          commitment: details.mintingCommitment,
        },
        encodingFormat: details.encodingFormat,
      });
      setResult(mintResult);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const steps: Step[] = ["connect", "ipfs", "details", "minting", "result"];
  const stepLabels: Record<Step, string> = {
    connect: "1. Connect",
    ipfs: "2. IPFS",
    details: "3. Token",
    minting: "4. Mint",
    result: "5. Done",
  };

  const activeWallet = WALLETS.find((w) => w.name === selectedWallet);

  return (
    <div style={S.app}>
      <h1 style={S.h1}>CashMint NFT Minter</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
        Mint CashMintStandard NFTs on Bitcoin Cash chipnet — your key never leaves your wallet.
      </p>

      {/* Progress */}
      <div style={S.step}>
        {steps.map((s) => (
          <span key={s} style={S.stepPill(step === s, steps.indexOf(s) < steps.indexOf(step))}>
            {stepLabels[s]}
          </span>
        ))}
      </div>

      {/* ── Step 1: Connect Wallet ── */}
      {step === "connect" && (
        <div style={S.card}>
          <h2 style={S.h2}>Connect your BCH wallet</h2>
          <p style={{ fontSize: 14, color: "#475569", marginBottom: 20 }}>
            Select your wallet. A WalletConnect URI will be copied to your clipboard — paste it
            in your wallet's WalletConnect section to approve.
          </p>

          {!WC_PROJECT_ID && (
            <div style={S.error}>
              <strong>Missing project ID.</strong> Add{" "}
              <code>VITE_WC_PROJECT_ID=your_id</code> to <code>examples/ui/.env</code> — get a
              free ID at{" "}
              <a href="https://cloud.walletconnect.com" target="_blank" rel="noreferrer">
                cloud.walletconnect.com
              </a>.
            </div>
          )}

          {WALLETS.map((w) => (
            <button
              key={w.name}
              style={S.walletBtn(w.color, selectedWallet === w.name)}
              onClick={() => connectWallet(w)}
              disabled={loading || !WC_PROJECT_ID}
            >
              <span style={S.dot(w.color)} />
              {w.name}
            </button>
          ))}

          {/* Pending connection UI */}
          {wcUri && activeWallet && (
            <div style={S.info}>
              <strong>
                {copied ? "URI copied to clipboard!" : "URI generated"} — waiting for{" "}
                {activeWallet.name}…
              </strong>
              <p style={{ marginTop: 6, marginBottom: 8, fontSize: 12 }}>
                {activeWallet.hint}
              </p>
              <div style={S.uriBox}>{wcUri}</div>
              <button
                style={{ ...S.btn, marginTop: 10, fontSize: 12, padding: "6px 14px" }}
                onClick={copyUri}
              >
                {copied ? "Copied!" : "Copy URI"}
              </button>
            </div>
          )}

          {loading && !wcUri && (
            <p style={{ fontSize: 13, color: "#64748b", marginTop: 12 }}>
              Generating URI…
            </p>
          )}

          {error && <div style={S.error}>{error}</div>}
        </div>
      )}

      {/* ── Step 2: IPFS ── */}
      {step === "ipfs" && (
        <div style={S.card}>
          <h2 style={S.h2}>
            Metadata storage{connectedWallet ? ` — ${connectedWallet} connected` : ""}
          </h2>

          <p style={{ fontSize: 14, color: "#475569", marginBottom: 16 }}>
            Is your token metadata already hosted on IPFS?
          </p>

          {/* Already hosted */}
          <div style={S.ipfsOption(ipfsMode === "prehosted")} onClick={() => setIpfsMode("prehosted")}>
            <input type="radio" readOnly checked={ipfsMode === "prehosted"} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Yes — I have a CID</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Metadata is already pinned. Enter the IPFS CID to proceed.
              </div>
            </div>
          </div>

          {ipfsMode === "prehosted" && (
            <div style={{ marginBottom: 14, paddingLeft: 4 }}>
              <label style={S.label}>IPFS CID</label>
              <input
                style={S.input}
                placeholder="QmXyz… or bafy…"
                value={prehostedCid}
                onChange={(e) => setPrehostedCid(e.target.value)}
              />
            </div>
          )}

          {/* Pinata */}
          <div style={S.ipfsOption(ipfsMode === "pinata")} onClick={() => setIpfsMode("pinata")}>
            <input type="radio" readOnly checked={ipfsMode === "pinata"} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Pinata</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Browser-safe. Recommended for dapps.
              </div>
            </div>
          </div>

          {ipfsMode === "pinata" && (
            <div style={{ marginBottom: 14, paddingLeft: 4 }}>
              <label style={S.label}>Pinata JWT</label>
              <input
                style={S.input}
                type="password"
                placeholder="eyJhbGciOi…"
                value={pinataJwt}
                onChange={(e) => setPinataJwt(e.target.value)}
              />
              <p style={{ fontSize: 12, color: "#64748b" }}>
                Get a JWT at{" "}
                <a href="https://app.pinata.cloud/keys" target="_blank" rel="noreferrer">
                  app.pinata.cloud/keys
                </a>{" "}
                with <code>pinJSONToIPFS</code> scope.
              </p>
            </div>
          )}

          {/* Self-hosted */}
          <div style={S.ipfsOption(ipfsMode === "selfhosted")} onClick={() => setIpfsMode("selfhosted")}>
            <input type="radio" readOnly checked={ipfsMode === "selfhosted"} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Self-hosted (Kubo / IPFS node)</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Your own IPFS node with the HTTP API enabled.
              </div>
            </div>
          </div>

          {ipfsMode === "selfhosted" && (
            <div style={{ marginBottom: 14, paddingLeft: 4 }}>
              <label style={S.label}>IPFS API URL</label>
              <input
                style={S.input}
                placeholder="http://localhost:5001"
                value={selfhostedUrl}
                onChange={(e) => setSelfhostedUrl(e.target.value)}
              />
              <p style={{ fontSize: 12, color: "#64748b" }}>
                The node must have CORS enabled for this origin.
              </p>
            </div>
          )}

          {/* Filebase */}
          <div style={S.ipfsOption(ipfsMode === "filebase")} onClick={() => setIpfsMode("filebase")}>
            <input type="radio" readOnly checked={ipfsMode === "filebase"} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                Filebase{" "}
                <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8" }}>
                  server-side only
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                S3-compatible IPFS pinning. Requires Node.js — use the CLI scripts for this.
              </div>
            </div>
          </div>

          {ipfsMode === "filebase" && (
            <div style={{ padding: "10px 14px", background: "#fef9c3", borderRadius: 6, fontSize: 12, color: "#854d0e", marginBottom: 14 }}>
              Filebase uses Node.js <code>node:crypto</code> for AWS Signature V4 and cannot run
              in the browser. Use the <code>cli/mint.ts</code> script instead.
            </div>
          )}

          <button
            style={S.btn}
            onClick={() => setStep("details")}
            disabled={
              (ipfsMode === "prehosted" && !prehostedCid.trim()) ||
              (ipfsMode === "pinata" && !pinataJwt.trim()) ||
              (ipfsMode === "selfhosted" && !selfhostedUrl.trim()) ||
              ipfsMode === "filebase"
            }
          >
            Next
          </button>
          <button style={S.btnSecondary} onClick={() => setStep("connect")}>
            Back
          </button>
        </div>
      )}

      {/* ── Step 3: Token Details ── */}
      {step === "details" && (
        <div style={S.card}>
          <h2 style={S.h2}>Token details</h2>

          <label style={S.label}>Name</label>
          <input
            style={S.input}
            placeholder="Mystic Tiger #1"
            value={details.name}
            onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
          />

          <label style={S.label}>Description</label>
          <input
            style={S.input}
            placeholder="A legendary fire tiger."
            value={details.description}
            onChange={(e) => setDetails((d) => ({ ...d, description: e.target.value }))}
          />

          <label style={S.label}>Image URI (ipfs:// or https://)</label>
          <input
            style={S.input}
            placeholder="ipfs://QmYourImageCID"
            value={details.image}
            onChange={(e) => setDetails((d) => ({ ...d, image: e.target.value }))}
          />

          <label style={S.label}>Serial number</label>
          <input
            style={S.input}
            type="number"
            min={0}
            value={details.serial}
            onChange={(e) => setDetails((d) => ({ ...d, serial: parseInt(e.target.value) || 0 }))}
          />

          <label style={S.label}>Category ID (64-char hex)</label>
          <input
            style={{ ...S.input, ...S.mono }}
            placeholder="b463d07445199c18…"
            value={details.categoryId}
            onChange={(e) => setDetails((d) => ({ ...d, categoryId: e.target.value }))}
          />

          <label style={S.label}>Minting UTXO txid</label>
          <input
            style={{ ...S.input, ...S.mono }}
            placeholder="6eff54533f3daea4…"
            value={details.mintingTxid}
            onChange={(e) => setDetails((d) => ({ ...d, mintingTxid: e.target.value }))}
          />

          <label style={S.label}>Minting UTXO vout</label>
          <input
            style={S.input}
            type="number"
            min={0}
            value={details.mintingVoutStr}
            onChange={(e) =>
              setDetails((d) => ({
                ...d,
                mintingVoutStr: e.target.value,
                mintingVout: parseInt(e.target.value) || 0,
              }))
            }
          />

          <label style={S.label}>Minting UTXO satoshis</label>
          <input
            style={S.input}
            type="number"
            min={1}
            value={details.mintingSatoshisStr}
            onChange={(e) =>
              setDetails((d) => ({
                ...d,
                mintingSatoshisStr: e.target.value,
                mintingSatoshis: parseInt(e.target.value) || 0,
              }))
            }
          />

          <label style={S.label}>Minting UTXO commitment (hex, leave blank if empty)</label>
          <input
            style={{ ...S.input, ...S.mono }}
            placeholder=""
            value={details.mintingCommitment}
            onChange={(e) => setDetails((d) => ({ ...d, mintingCommitment: e.target.value }))}
          />

          <label style={S.label}>Commitment encoding</label>
          <select
            style={S.select}
            value={details.encodingFormat}
            onChange={(e) =>
              setDetails((d) => ({
                ...d,
                encodingFormat: e.target.value as "sequential" | "cid_serial",
              }))
            }
          >
            <option value="sequential">sequential (compact, 1–4 bytes)</option>
            <option value="cid_serial">cid_serial (40 bytes, includes CID digest)</option>
          </select>

          <label style={{ ...S.label, marginTop: 8 }}>
            Electrum WebSocket URL (for broadcast)
          </label>
          <input
            style={{ ...S.input, ...S.mono }}
            placeholder="wss://chipnet.imaginary.cash:50003"
            value={electrumWsUrl}
            onChange={(e) => setElectrumWsUrl(e.target.value)}
          />
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
            WebSocket Electrum endpoint used to broadcast the signed transaction.
            Try port 50003 or 50004. The wallet signs but does NOT broadcast — we do.
          </p>

          <button style={S.btn} onClick={() => setStep("minting")}>
            Review & Mint
          </button>
          <button style={S.btnSecondary} onClick={() => setStep("ipfs")}>
            Back
          </button>
        </div>
      )}

      {/* ── Step 4: Confirm & Mint ── */}
      {step === "minting" && (
        <div style={S.card}>
          <h2 style={S.h2}>Confirm mint</h2>

          <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.8 }}>
            <div><strong>Name:</strong> {details.name}</div>
            <div><strong>Serial:</strong> #{details.serial}</div>
            <div style={S.mono}>
              <strong>Category:</strong>{" "}
              {details.categoryId.slice(0, 16)}…{details.categoryId.slice(-8)}
            </div>
            <div style={S.mono}>
              <strong>Minting UTXO:</strong>{" "}
              {details.mintingTxid.slice(0, 12)}…:{details.mintingVout}{" "}
              ({details.mintingSatoshis.toLocaleString()} sat)
            </div>
            <div>
              <strong>IPFS:</strong>{" "}
              {ipfsMode === "prehosted"
                ? `Pre-hosted (${prehostedCid.slice(0, 12)}…)`
                : ipfsMode === "pinata"
                ? "Pinata"
                : ipfsMode === "selfhosted"
                ? "Self-hosted Kubo"
                : "Filebase"}
            </div>
            <div><strong>Encoding:</strong> {details.encodingFormat}</div>
            <div><strong>Network:</strong> chipnet (bch:bchtest)</div>
          </div>

          <p style={{ fontSize: 13, color: "#64748b", marginTop: 14 }}>
            Clicking Mint will ask your wallet to sign and broadcast the transaction.
          </p>

          {error && <div style={S.error}>{error}</div>}

          <button style={S.btn} onClick={handleMint} disabled={loading}>
            {loading ? "Waiting for wallet approval…" : "Mint NFT"}
          </button>
          <button
            style={S.btnSecondary}
            onClick={() => { setError(null); setStep("details"); }}
            disabled={loading}
          >
            Back
          </button>
        </div>
      )}

      {/* ── Step 5: Result ── */}
      {step === "result" && result && (
        <div style={S.card}>
          <h2 style={{ ...S.h2, color: "#166534" }}>Minted successfully!</h2>

          <label style={S.label}>Transaction ID</label>
          <div style={{ ...S.success, ...S.mono }}>{result.txid}</div>

          <label style={{ ...S.label, marginTop: 12 }}>IPFS CID</label>
          <div style={{ ...S.success, ...S.mono }}>{result.cid}</div>

          <label style={{ ...S.label, marginTop: 12 }}>On-chain commitment (hex)</label>
          <div style={{ ...S.success, ...S.mono }}>{result.commitment}</div>

          <label style={{ ...S.label, marginTop: 12 }}>Metadata URI</label>
          <div style={{ ...S.success, ...S.mono }}>ipfs://{result.cid}</div>

          <button
            style={{ ...S.btn, marginTop: 16 }}
            onClick={() => {
              setResult(null);
              setError(null);
              setStep("details");
              setDetails((d) => ({ ...d, serial: d.serial + 1 }));
            }}
          >
            Mint another
          </button>
        </div>
      )}
    </div>
  );
}
