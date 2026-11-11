import { describe, expect, it } from 'vitest';
import { KeyPair } from 'near-api-js';
import { loadVaultPaymentConfiguration } from './config';
const privateKey = KeyPair.fromRandom('ed25519').toString();
const complete = { NEAR_NETWORK: 'testnet', NEAR_RPC_URL: 'https://test.rpc.fastnear.com', VAULT_ID: 'vault.testnet',
  TEST_TOKEN_ID: 'token.testnet', PO_COMMITTER_ACCOUNT_ID: 'committer.testnet', PO_COMMITTER_PRIVATE_KEY: privateKey,
  AGENT_ACCOUNT_ID: 'agent.testnet', AGENT_FC_PRIVATE_KEY: privateKey };
describe('payment configuration', () => {
  it('keeps payments disabled without credentials', () => expect(loadVaultPaymentConfiguration({})).toBeNull());
  it('rejects partial configuration', () => expect(() => loadVaultPaymentConfiguration({ VAULT_ID: 'vault.testnet' })).toThrow(/incomplete/));
  it('rejects mainnet and plaintext RPC configuration', () => {
    expect(() => loadVaultPaymentConfiguration({ ...complete, NEAR_NETWORK: 'mainnet' })).toThrow(/testnet only/);
    expect(() => loadVaultPaymentConfiguration({ ...complete, NEAR_RPC_URL: 'http://localhost:3030' })).toThrow(/HTTPS/);
  });
  it('requires explicit testnet identity, RPC and CCTEST semantics, never legacy USDC labeling',()=>{
    for(const extra of [{NEAR_NETWORK:undefined},{NEAR_RPC_URL:'https://rpc.mainnet.near.org'},
      {VAULT_ID:'vault.near'},{TEST_TOKEN_ID:'usdc.near'},{AGENT_ACCOUNT_ID:'agent.near'},
      {PO_COMMITTER_ACCOUNT_ID:'committer.near'},{VAULT_ASSET_CODE:'USDC'},{AGENT_ACCOUNT_ID:'committer.testnet'}])
      expect(()=>loadVaultPaymentConfiguration({...complete,...extra})).toThrow();
  });
  it('uses the test token label and keeps signing values in the server config', () => {
    expect(loadVaultPaymentConfiguration(complete)).toMatchObject({ assetCode: 'CCTEST', vaultAccountId: 'vault.testnet' });
  });
  it('rejects invalid signing keys without including their value in the error', () => {
    expect(() => loadVaultPaymentConfiguration({ ...complete, PO_COMMITTER_PRIVATE_KEY: 'invalid-secret' }))
      .toThrow('NEAR signing keys must be valid encoded keypairs');
  });

});
