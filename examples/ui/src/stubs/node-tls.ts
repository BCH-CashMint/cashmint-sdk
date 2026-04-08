// Browser stub for node:tls — the browser UI uses WalletConnectSigner
// with broadcast:true so the wallet handles broadcasting; this path is never hit.
export default {
  connect: () => {
    throw new Error(
      "node:tls is not available in the browser. " +
        "WalletConnectSigner with broadcast:true handles broadcasting via the wallet."
    );
  },
};
