'use strict';

/**
 * Proves that a caller controls the Stellar account behind a username.
 *
 * The caller signs `${operation}:${username}` with the account key.  Three
 * verification paths are accepted:
 *
 * 1. **Freighter / single-signer** – a base64-encoded Ed25519 signature
 *    created by the account's master key.
 *
 * 2. **Multi-sig single address** – `signature` is a single valid Ed25519
 *    public key belonging to one of the account's co-signers.  The
 *    `verifyMultiSignerThreshold` helper is called with that one key.
 *
 * 3. **Multi-sig array** – `signature` is an array of valid Ed25519 public
 *    keys, one per co-signer.  All keys are forwarded to
 *    `verifyMultiSignerThreshold` so the threshold can be met by combining
 *    the weights of multiple signers (e.g. 2-of-3).
 *
 * Paths 2 and 3 are detected by checking the runtime type of `signature`
 * before attempting Freighter-style Ed25519 verification.
 */

const crypto = require('crypto');
const { Keypair, StrKey } = require('@stellar/stellar-sdk');
const { prisma } = require('../../prismaClient');
const { poolGet } = require('../db');
const { verifyMultiSignerThreshold } = require('../multisigner-verifier');
const { normalizeNameTag, shouldFallbackToLocalRegistry } = require('../utils');

const httpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const verifyFreighterSignedMessage = ({ message, signature, signerAddress, publicKey }) => {
  const claimedSigner = signerAddress || publicKey;

  if (!StrKey.isValidEd25519PublicKey(claimedSigner)) {
    throw httpError('Invalid signer address format.', 400);
  }

  const keypair = Keypair.fromPublicKey(claimedSigner);

  let signatureBuffer;
  if (Buffer.isBuffer(signature)) {
    signatureBuffer = signature;
  } else if (typeof signature === 'string') {
    signatureBuffer = Buffer.from(signature, 'base64');
  } else {
    throw new Error('Invalid message signature format.');
  }

  const prefix = Buffer.from('Stellar Signed Message:\n', 'utf8');
  const messageBytes = Buffer.from(message, 'utf8');
  const payload = Buffer.concat([prefix, messageBytes]);
  const messageHash = crypto.createHash('sha256').update(payload).digest();

  if (!keypair.verify(messageHash, signatureBuffer)) {
    throw httpError('Signature verification failed.', 401);
  }

  if (claimedSigner !== publicKey) {
    throw httpError('Signer address does not match the registered account.', 401);
  }

  return claimedSigner;
};

const findUserRecord = async (username) => {
  try {
    return await prisma.user.findUnique({
      where: { username },
      select: { username: true, address: true },
    });
  } catch (err) {
    if (!shouldFallbackToLocalRegistry(err)) throw err;
    const localRow = await poolGet(
      'SELECT username, address FROM username_registry WHERE username = $1 LIMIT 1',
      [username],
    );
    return localRow ? { username: localRow.username, address: localRow.address } : null;
  }
};

/**
 * Returns true when `value` is a single valid Ed25519 public key string.
 * @param {unknown} value
 * @returns {boolean}
 */
const isSignerAddress = (value) =>
  typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);

/**
 * Returns true when `value` is a non-empty array of valid Ed25519 public
 * key strings (multi-sig threshold proof with multiple co-signer addresses).
 * @param {unknown} value
 * @returns {boolean}
 */
const isSignerAddressArray = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((v) => typeof v === 'string' && StrKey.isValidEd25519PublicKey(v));

/**
 * @returns {Promise<{username: string, address: string}>} the authenticated user
 * @throws {Error} with `statusCode` set on any failure
 */
const authenticateUsernameOwner = async ({
  username: rawUsername,
  signature: rawSignature,
  signerAddress: rawSignerAddress,
  operation = 'webhook',
}) => {
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  const signerAddress =
    typeof rawSignerAddress === 'string' ? rawSignerAddress.trim() : undefined;

  // Normalise signature: strings are trimmed, arrays are passed through as-is.
  let signature;
  if (Array.isArray(rawSignature)) {
    signature = rawSignature;
  } else if (typeof rawSignature === 'string') {
    signature = rawSignature.trim();
  } else {
    signature = rawSignature;
  }

  if (!username) throw httpError('Missing required field: username.', 400);

  // A missing/empty signature is invalid regardless of type.
  const isMissing =
    signature === '' ||
    signature === null ||
    signature === undefined ||
    (Array.isArray(signature) && signature.length === 0);
  if (isMissing) throw httpError('Missing required field: signature.', 400);

  const normalizedUsername = normalizeNameTag(username).toLowerCase();
  const userRecord = await findUserRecord(normalizedUsername);

  if (!userRecord) throw httpError('Username not registered.', 404);

  const message = `${operation}:${normalizedUsername}`;

  // ── Path 1: multi-sig with an array of co-signer addresses ─────────────
  // Caller provides multiple signer public keys to satisfy a threshold
  // (e.g. 2-of-3).  All keys are forwarded to verifyMultiSignerThreshold
  // so the module can compute the combined signing weight.
  if (isSignerAddressArray(signature)) {
    const verificationResult = await verifyMultiSignerThreshold(
      userRecord.address,
      signature,
      { operationType: 'management' },
    );
    if (!verificationResult.success) {
      throw httpError(verificationResult.errorMessage || 'Signature verification failed', 401);
    }
    return userRecord;
  }

  // ── Path 2: multi-sig with a single signer address ──────────────────────
  // Caller provides one co-signer public key.  The verifier will check
  // whether that key's weight alone meets the account's threshold.
  if (isSignerAddress(signature) && !signerAddress) {
    const verificationResult = await verifyMultiSignerThreshold(
      userRecord.address,
      [signature],
      { operationType: 'management' },
    );
    if (!verificationResult.success) {
      throw httpError(verificationResult.errorMessage || 'Signature verification failed', 401);
    }
    return userRecord;
  }

  // ── Path 3: Freighter / single-signer Ed25519 signature ─────────────────
  // Standard accounts use a base64-encoded cryptographic signature produced
  // by the Freighter wallet (or equivalent) over the prefixed message hash.
  verifyFreighterSignedMessage({
    message,
    signature,
    signerAddress,
    publicKey: userRecord.address,
  });

  return userRecord;
};

module.exports = {
  authenticateUsernameOwner,
  verifyFreighterSignedMessage,
};
