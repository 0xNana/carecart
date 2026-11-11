import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {verifiedTransactionSignatures} from './security-scan-helpers.mjs';
const evidence=JSON.parse(readFileSync(new URL('../docs/mainnet-account-creation-receipts-2026-11-03.json',import.meta.url)));
const transaction=evidence.public_rpc_evidence.transaction.result.transaction;
test('recognizes a cryptographically verified public transaction signature without exempting arbitrary key-looking strings',()=>{
 assert(verifiedTransactionSignatures(Buffer.from(JSON.stringify(evidence))).has(transaction.signature));
 for(const changed of [{hash:'1'.repeat(32)},{public_key:'ed25519:'+'1'.repeat(32)},{signature:'ed25519:'+'1'.repeat(88)}])
  assert.equal(verifiedTransactionSignatures(Buffer.from(JSON.stringify({...transaction,...changed}))).size,0);
 assert.equal(verifiedTransactionSignatures(Buffer.from('not json')).size,0);
 assert.equal(verifiedTransactionSignatures(Buffer.from(JSON.stringify({private_key:transaction.signature}))).size,0);
});
