import assert from 'node:assert/strict';
import test from 'node:test';
import {vaultConfig} from '../test-support/legacy-wallet/vault-rpc.ts';

const explicit={CARECART_PLAYGROUND_PROFILE:'testnet-cctest',CARECART_PLAYGROUND_RPC_URL:'https://test.rpc.fastnear.com',
 CARECART_VAULT_ID:'vault.carecart.testnet',CARECART_TEST_TOKEN_ID:'token.carecart.testnet',CARECART_ADMIN_ID:'admin.carecart.testnet'};
test('Playground requires a complete explicit CCTEST testnet profile before provider initialization',()=>{
 assert.throws(()=>vaultConfig({}),/configuration/i);
 for(const field of Object.keys(explicit))assert.throws(()=>vaultConfig({...explicit,[field]:''}),/configuration/i);
 assert.deepEqual(vaultConfig(explicit),{vaultId:explicit.CARECART_VAULT_ID,tokenId:explicit.CARECART_TEST_TOKEN_ID,adminId:explicit.CARECART_ADMIN_ID});
});
test('contradictory network, RPC, profile, identities and native-USDC labels fail closed',()=>{
 for(const change of [{CARECART_PLAYGROUND_PROFILE:'local-usdc-v2'}, {CARECART_PLAYGROUND_RPC_URL:'https://rpc.mainnet.near.org'},
  {NEAR_NETWORK:'mainnet'}, {NEAR_RPC_URL:'https://rpc.mainnet.near.org'}, {CARECART_PROFILE:'local-usdc-v2'}, {CARECART_VAULT_ID:'vault.near'},
  {CARECART_TEST_TOKEN_ID:'usdc.near'}, {CARECART_ADMIN_ID:'admin.near'}, {VAULT_ASSET_CODE:'USDC'},
  {CARECART_ADMIN_ID:explicit.CARECART_VAULT_ID}])
  assert.throws(()=>vaultConfig({...explicit,...change}),/configuration|testnet accounts/i);
});
