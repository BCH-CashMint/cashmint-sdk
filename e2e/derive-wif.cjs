/**
 * e2e/derive-wif.js
 *
 * Derives the WIF private key and address from a BIP39 seed phrase.
 * Uses BCH derivation path: m/44'/145'/0'/0/0
 *
 * Usage:
 *   MNEMONIC="your twelve word seed phrase" node e2e/derive-wif.js
 *
 * NEVER hardcode your seed phrase in this file.
 */

const bitcore = require("bitcore-lib-cash");
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const ecc = require("tiny-secp256k1");

const bip32 = BIP32Factory(ecc);

const mnemonic = process.env.MNEMONIC;
if (!mnemonic) {
  console.error("Usage: MNEMONIC='your seed phrase' node e2e/derive-wif.js");
  process.exit(1);
}

const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = bip32.fromSeed(seed);
const child = root.derivePath("m/44'/145'/0'/0/0");

const privateKey = new bitcore.PrivateKey(child.privateKey, "testnet");
console.log("WIF:    ", privateKey.toWIF());
console.log("Address:", privateKey.toAddress().toString());
