import {PUBLIC_TOKENS} from './token-registry';
import { describe, expect, it } from 'vitest';
import { safetyProfile } from './safety-profile';
import { NEAR_USDC } from '../intents/settlement';
const testnet = {
  version: 2,
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  vault: 'safety.testnet',
  token: PUBLIC_TOKENS.testnet.account,
  decimals: 6,
  admin: 'admin.testnet',
  guardian: 'guardian.testnet',
  treasury: 'treasury.testnet',
  committer: 'committer.testnet',
  requester: 'requester.testnet',
  committerPublicKey: 'ed25519:ESpXAHMCBfrZNhtW8GrweayeeMnmoL8j25fUpe4cUFDZ',
  requesterPublicKey: 'ed25519:CxJkkdPs6M7bpFJuyELJSBJaeUtWtV5Ed5qdqHi2CN64',
  maxKeyAllowanceYocto: '250000000000000000000000',
  codeHash: '1'.repeat(44),
  databasePath: 'backend/data/safety-testnet.sqlite',
};
describe('separate safety deployment profile', () => {
  it('binds an explicit six-decimal ABI/profile without reinterpreting CCTEST', () => {
    expect(safetyProfile(testnet).fingerprint).toMatch(/^[0-9a-f]{64}$/);
    for (const change of [
      { version: 1 },
      { decimals: 0 },
      { databasePath: 'backend/data/testnet-smoke.sqlite' },
      { guardian: testnet.admin },
      { requester: testnet.committer },
      { rpcUrl: 'http://rpc.testnet.near.org' },
    ])
      expect(() => safetyProfile({ ...testnet, ...change })).toThrow();
  });
  it('requires distinct mainnet identities and the canonical native USDC token', () => {
    const mainnet = {
      ...testnet,
      network: 'mainnet',
      token: NEAR_USDC,
      vault: 'safety.near',
      admin: 'admin.near',
      guardian: 'guardian.near',
      treasury: 'treasury.near',
      committer: 'committer.near',
      requester: 'requester.near',
      rpcUrl: 'https://rpc.mainnet.near.org',
      databasePath: 'backend/data/local-v2/carecart.sqlite',
    };
    expect(safetyProfile(mainnet).profile.network).toBe('mainnet');
    expect(() =>
      safetyProfile({ ...mainnet, token: 'usdt.tether-token.near' }),
    ).toThrow();
    expect(() =>
      safetyProfile({ ...mainnet, guardian: 'guardian.testnet' }),
    ).toThrow();
    for (const databasePath of [
      'backend/data/safety-testnet.sqlite',
      'backend/data/local-v2/../carecart.sqlite',
      `${process.cwd()}/data/carecart.sqlite`,
      ':memory:',
    ]) expect(() => safetyProfile({ ...mainnet, databasePath })).toThrow();
  });
});
