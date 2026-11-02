import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mainnetManifest, mainnetSafetyProfile, assertPrototypeProfile } from './mainnet';

const candidate = JSON.parse(readFileSync(resolve(__dirname, '../../..', 'profiles/mainnet.candidate.json'), 'utf8'));
describe('isolated mainnet manifest', () => {
  const deployment = {
    vault: 'vault.near', admin: 'admin.near', guardian: 'guardian.near', treasury: 'treasury.near',
    committer: 'committer.near', requester: 'requester.near',
    committerPublicKey: 'ed25519:ESpXAHMCBfrZNhtW8GrweayeeMnmoL8j25fUpe4cUFDZ',
    requesterPublicKey: 'ed25519:CxJkkdPs6M7bpFJuyELJSBJaeUtWtV5Ed5qdqHi2CN64',
    maxKeyAllowanceYocto: '250000000000000000000000', codeHash: '1'.repeat(44),
  };
  it('binds populated owner fields to the v2 profile and rejects conflicting identities', () => {
    const { profile, fingerprint } = mainnetSafetyProfile({ ...candidate, deployment });
    expect(profile).toMatchObject({ ...deployment, network: 'mainnet', token: candidate.token.accountId, decimals: 6 });
    expect(profile.databasePath).toBe(resolve(__dirname, '../../..', candidate.databasePath));
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    for (const change of [{ treasury: deployment.vault }, { guardian: 'guardian.testnet' }, { committerPublicKey: deployment.requesterPublicKey }]) {
      expect(() => mainnetManifest({ ...candidate, deployment: { ...deployment, ...change } })).toThrow();
    }
  });
  it('permits read-only candidate inspection but cannot become a signing profile without identities', () => {
    expect(mainnetManifest(candidate).network).toBe('mainnet');
    expect(() => mainnetSafetyProfile(candidate)).toThrow(/G0B/);
  });
  it.each([
    { network: 'testnet' }, { id: 'testnet-cctest' },
    { rpc: { url: 'https://rpc.testnet.near.org', chainId: 'testnet' } },
    { rpc: { url: 'http://rpc.mainnet.near.org', chainId: 'mainnet' } },
    { token: { ...candidate.token, accountId: 'token.testnet' } },
    { token: { ...candidate.token, decimals: 0 } },
    { token: { ...candidate.token, oneClickAssetId: 'nep141:wrap.near' } },
    { databasePath: 'backend/data/testnet-smoke.sqlite' },
    { databasePath: 'backend/data/mainnet-usdc-v2/../testnet-smoke.sqlite' },
    { explorers: { ...candidate.explorers, near: 'https://testnet.nearblocks.io' } },
  ])('fails closed for mismatched manifest %j', (change) => {
    expect(() => mainnetManifest({ ...candidate, ...change })).toThrow();
  });
  it('does not enable the prototype by changing environment variables, even without payment keys', () => {
    expect(() => assertPrototypeProfile({})).not.toThrow();
    expect(() => assertPrototypeProfile({ CARECART_PROFILE: 'testnet-cctest', NEAR_NETWORK: 'testnet' })).not.toThrow();
    for (const environment of [{ NEAR_NETWORK: 'mainnet' }, { CARECART_PROFILE: 'mainnet-usdc-v2' }, { CARECART_PROFILE: '' }]) {
      expect(() => assertPrototypeProfile(environment)).toThrow(/testnet/);
    }
    expect(() => assertPrototypeProfile({ CARECART_DATABASE_PATH: resolve(__dirname, '../../../data/mainnet-usdc-v2/carecart.sqlite') })).toThrow();
  });
});
