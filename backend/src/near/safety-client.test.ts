import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { SafetyVaultClient } from './safety-client';
import type { SafetyProfile } from './safety-profile';
import { NEAR_USDC, digest } from '../intents/settlement';
import { OperationJournal } from './operation-journal';
const credentials = {
  committer: KeyPair.fromRandom('ed25519').toString(),
  requester: KeyPair.fromRandom('ed25519').toString(),
};
const profile: SafetyProfile = {
  version: 2,
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  vault: 'safety.testnet',
  token: 'ccusd.testnet',
  decimals: 6,
  admin: 'admin.testnet',
  guardian: 'guardian.testnet',
  treasury: 'treasury.testnet',
  committer: 'committer.testnet',
  requester: 'requester.testnet',
  committerPublicKey: KeyPair.fromString(credentials.committer)
    .getPublicKey()
    .toString(),
  requesterPublicKey: KeyPair.fromString(credentials.requester)
    .getPublicKey()
    .toString(),
  maxKeyAllowanceYocto: '250000000000000000000000',
  codeHash: '1'.repeat(44),
  databasePath: 'backend/data/safety-testnet.sqlite',
};
const operationJournals: OperationJournal[] = [];
function operations() {
  const journal = new OperationJournal(':memory:', digest(profile));
  operationJournals.push(journal);
  return journal;
}
afterEach(() => {
  for (const journal of operationJournals.splice(0)) journal.close();
  vi.restoreAllMocks();
});
function rpc() {
  vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({
    chain_id: 'testnet',
  } as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockResolvedValue({
    code_hash: profile.codeHash,
  } as never);
  vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(
    async ({ method }) => {
      if (method === 'ft_metadata') return { decimals: 6 };
      if (method === 'get_state')
        return {
          profile: 'testnet',
          admin: profile.admin,
          guardian: profile.guardian,
          treasury: profile.treasury,
          token: profile.token,
        };
      if (method === 'get_purchase_order')
        return {
          po_id: 'po-1',
          supplier: 'supplier.testnet', amount: '1000000', invoice_digest: 'a'.repeat(64),
          profile: 'testnet',
          token: profile.token,
          destination: 'Near',
        };
      if (method === 'get_payment') return { status: 'Committed', attempt_id: '', reason: 'None' };
      if (method === 'get_roles') return { requester: true, committer: false, supplier: true };
      return undefined;
    },
  );
  return vi
    .spyOn(Account.prototype, 'callFunctionRaw')
    .mockResolvedValue({ transaction: { hash: 'fixture-tx' } } as never);
}
describe('separate safety ABI signing guards', () => {
  it('never resends after a lost RPC response; finalized state can reconcile without inventing a tx hash', async () => {
    const sign = rpc().mockRejectedValue(new Error('lost response'));
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({ permission: { FunctionCall: {
      receiver_id: profile.vault, method_names: ['request_payment'], allowance: '1',
    } } } as never);
    const journal = operations();
    const client = new SafetyVaultClient(profile, { requester: credentials.requester }, journal);
    await expect(client.submitPayment('po-1')).rejects.toThrow(/ambiguous/);
    await expect(client.submitPayment('po-1')).rejects.toThrow(/reconcile/);
    expect(sign).toHaveBeenCalledTimes(1);
    const view = vi.mocked(JsonRpcProvider.prototype.callFunction);
    const previous = view.getMockImplementation()!;
    view.mockImplementation(async (input) => input.method === 'get_payment'
      ? { status: 'Dispatching', attempt_id: '', reason: 'None' } : previous(input));
    await expect(client.submitPayment('po-1')).resolves.toEqual({ transactionHash: null, reconciled: true });
    expect(sign).toHaveBeenCalledTimes(1);
  });
  it('rejects both role credentials even when they are different keys', () => {
    expect(() => new SafetyVaultClient(profile, credentials)).toThrow(/Separate processes/);
  });
  it('refuses FullAccess keys before signing', async () => {
    const sign = rpc();
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({ permission: 'FullAccess' } as never);
    await expect(new SafetyVaultClient(profile, { requester: credentials.requester }, operations()).submitPayment('po-1')).rejects.toThrow(/restricted/);
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects duplicate method permissions and a revoked role before signing', async () => {
    const sign = rpc();
    const access = vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({ permission: { FunctionCall: {
      receiver_id: profile.vault, method_names: ['request_payment', 'request_payment'], allowance: '1',
    } } } as never);
    const client = new SafetyVaultClient(profile, { requester: credentials.requester }, operations());
    await expect(client.submitPayment('po-1')).rejects.toThrow(/Duplicate/);
    access.mockResolvedValue({ permission: { FunctionCall: { receiver_id: profile.vault, method_names: ['request_payment'], allowance: '1' } } } as never);
    const view = vi.mocked(JsonRpcProvider.prototype.callFunction);
    const previous = view.getMockImplementation()!;
    view.mockImplementation(async (input) => input.method === 'get_roles'
      ? { requester: false, committer: false, supplier: false } : previous(input));
    await expect(client.submitPayment('po-1')).rejects.toThrow(/revoked/);
    expect(sign).not.toHaveBeenCalled();
  });
  it.each(['network', 'decimals', 'symbol', 'token', 'treasury', 'profile'])('rejects mainnet %s mismatch before signing', async (mismatch) => {
    const mainnet: SafetyProfile = {
      ...profile, network: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org', token: NEAR_USDC,
      vault: 'vault.near', admin: 'admin.near', guardian: 'guardian.near', treasury: 'treasury.near',
      committer: 'committer.near', requester: 'requester.near',
      databasePath: 'backend/data/mainnet-usdc-v2/carecart.sqlite',
    };
    const sign = vi.spyOn(Account.prototype, 'callFunctionRaw').mockResolvedValue({ transaction: { hash: 'fixture-mainnet-only' } } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({ chain_id: mismatch === 'network' ? 'testnet' : 'mainnet' } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockResolvedValue({ code_hash: mainnet.codeHash } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(async ({ method }) => {
      if (method === 'ft_metadata') return { decimals: mismatch === 'decimals' ? 0 : 6, symbol: mismatch === 'symbol' ? 'USDC.e' : 'USDC' };
      if (method === 'get_state') return { profile: 'mainnet', admin: mainnet.admin, guardian: mainnet.guardian, treasury: mismatch === 'treasury' ? 'rogue.near' : mainnet.treasury, token: mismatch === 'token' ? 'token.testnet' : NEAR_USDC };
      if (method === 'get_purchase_order') return { po_id: 'po-1', supplier: 'supplier.near', amount: '1000000', invoice_digest: 'a'.repeat(64), destination: 'Near', token: NEAR_USDC, profile: mismatch === 'profile' ? 'testnet' : 'mainnet' };
      return undefined;
    });
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({ permission: { FunctionCall: {
      receiver_id: mainnet.vault, method_names: ['request_payment'], allowance: '1',
    } } } as never);
    const errors: Record<string, RegExp> = { network: /chain mismatch/, decimals: /decimals/, symbol: /metadata/, token: /role mismatch/, treasury: /role mismatch/, profile: /same-chain PO/ };
    await expect(new SafetyVaultClient(mainnet, { requester: credentials.requester }).submitPayment('po-1')).rejects.toThrow(errors[mismatch]);
    expect(sign).not.toHaveBeenCalled();
    // A noncanonical token in the local manifest must fail even before RPC inspection.
    expect(() => new SafetyVaultClient({ ...mainnet, token: 'token.testnet' }, { requester: credentials.requester })).toThrow();
  });
  it.each([null, '0', '250000000000000000000001'])(
    'rejects unlimited, empty or excessive gas allowance (%s)',
    async (allowance) => {
      const sign = rpc();
      vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({
        permission: {
          FunctionCall: {
            receiver_id: profile.vault,
            method_names: ['request_payment'],
            allowance,
          },
        },
      } as never);
      await expect(
        new SafetyVaultClient(profile, { requester: credentials.requester }, operations()).submitPayment('po-1'),
      ).rejects.toThrow('finite gas allowance');
      expect(sign).not.toHaveBeenCalled();
    },
  );
  it('rejects zero-decimal CCTEST metadata before signing', async () => {
    const sign = rpc();
    vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockResolvedValue({
      decimals: 0,
    });
    await expect(
      new SafetyVaultClient(profile, { requester: credentials.requester }, operations()).submitPayment('po-1'),
    ).rejects.toThrow('decimals');
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects reused key material and incompatible chains before signing', async () => {
    expect(
      () =>
        new SafetyVaultClient(profile, {
          committer: credentials.committer,
          requester: credentials.committer,
        }),
    ).toThrow('Separate');
    const sign = rpc();
    vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({
      chain_id: 'mainnet',
    } as never);
    await expect(
      new SafetyVaultClient(profile, { requester: credentials.requester }, operations()).submitPayment('po-1'),
    ).rejects.toThrow('chain mismatch');
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects old code, wrong decimals and broad method permissions', async () => {
    const sign = rpc();
    const client = new SafetyVaultClient(profile, { requester: credentials.requester }, operations());
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockResolvedValue({
      code_hash: 'wrong',
    } as never);
    await expect(client.submitPayment('po-1')).rejects.toThrow('Unreviewed');
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockResolvedValue({
      code_hash: profile.codeHash,
    } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({
      permission: {
        FunctionCall: {
          receiver_id: profile.vault,
          method_names: ['request_payment', 'unpause'],
        },
      },
    } as never);
    await expect(client.submitPayment('po-1')).rejects.toThrow('restricted');
    expect(sign).not.toHaveBeenCalled();
  });
  it('requests only an independently committed same-chain ID with zero deposit', async () => {
    const sign = rpc();
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({
      permission: {
        FunctionCall: {
          receiver_id: profile.vault,
          method_names: ['request_payment'],
          allowance: '1',
        },
      },
    } as never);
    await new SafetyVaultClient(profile, { requester: credentials.requester }, operations()).submitPayment('po-1');
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        methodName: 'request_payment',
        args: { po_id: 'po-1' },
        deposit: 0n,
      }),
    );
  });
});
