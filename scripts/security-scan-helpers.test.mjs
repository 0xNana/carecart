import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifiedTransactionSignatures } from './security-scan-helpers.mjs';

const { baseEncode } = createRequire(new URL('../backend/package.json', import.meta.url))('near-api-js');

function signedPublicEvidence() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const hash = createHash('sha256').update('synthetic public transaction evidence').digest();
  const publicKeyBytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const transaction = {
    hash: baseEncode(hash),
    public_key: `ed25519:${baseEncode(publicKeyBytes)}`,
    signature: `ed25519:${baseEncode(sign(null, hash, privateKey))}`,
  };
  return { evidence: { public_rpc_evidence: { transaction: { result: { transaction } } } }, transaction };
}

test('recognizes a cryptographically verified public transaction signature without exempting arbitrary key-looking strings', () => {
  const { evidence, transaction } = signedPublicEvidence();
  assert(verifiedTransactionSignatures(Buffer.from(JSON.stringify(evidence))).has(transaction.signature));
  for (const changed of [
    { hash: baseEncode(Buffer.alloc(32, 1)) },
    { public_key: `ed25519:${baseEncode(Buffer.alloc(32, 1))}` },
    { signature: `ed25519:${baseEncode(Buffer.alloc(64, 1))}` },
  ]) {
    assert.equal(verifiedTransactionSignatures(Buffer.from(JSON.stringify({ ...transaction, ...changed }))).size, 0);
  }
  assert.equal(verifiedTransactionSignatures(Buffer.from('not json')).size, 0);
  assert.equal(verifiedTransactionSignatures(Buffer.from(JSON.stringify({ private_key: transaction.signature }))).size, 0);
});
