import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {wasmHash,verifyVaultRelease} from './verify-vault-release.mjs';
const {baseEncode}=createRequire(new URL('../backend/package.json',import.meta.url))('near-api-js');
test('NEAR code hashes encode the SHA-256 bytes as Base58, including leading zeros',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('carecart-reviewed-release'),Buffer.alloc(288241,7)]){
  const digest=createHash('sha256').update(bytes).digest();
  assert.equal(wasmHash(bytes).nearCodeHash,baseEncode(digest));assert.equal(wasmHash(bytes).sha256,digest.toString('hex'));
 }
});
test('release verifier rejects a mainnet profile before requesting a network resource',async()=>{
 let requests=0;await assert.rejects(verifyVaultRelease({network:'mainnet'},Buffer.alloc(0),async()=>{requests++;}),/testnet/);assert.equal(requests,0);
});
