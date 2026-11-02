import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { NearApiVaultClient } from './client';

const key = KeyPair.fromRandom('ed25519').toString();
function client() {
  return new NearApiVaultClient({ rpcUrl: 'https://test.rpc.fastnear.com', vaultAccountId: 'vault.testnet',
    committerAccountId: 'committer.testnet', committerPrivateKey: key,
    requesterAccountId: 'requester.testnet', requesterPrivateKey: key });
}
afterEach(() => vi.restoreAllMocks());
describe('vault signing guards', () => {
  it('refuses mainnet before signing even with a testnet-labelled configuration', async () => {
    vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({ chain_id: 'mainnet' } as never);
    const sign = vi.spyOn(Account.prototype, 'callFunctionRaw');
    await expect(client().requestPayment('po-000001')).rejects.toThrow(/network/);
    expect(sign).not.toHaveBeenCalled();
  });
  it.each(['FullAccess', { FunctionCall: { receiver_id: 'other.testnet', method_names: ['request_payment'], allowance: '1' } },
    { FunctionCall: { receiver_id: 'vault.testnet', method_names: [], allowance: '1' } }])('refuses an overprivileged or wrong key', async (permission) => {
    vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({ chain_id: 'testnet' } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockResolvedValue({ permission } as never);
    const sign = vi.spyOn(Account.prototype, 'callFunctionRaw');
    await expect(client().requestPayment('po-000001')).rejects.toThrow(/function-call key/);
    expect(sign).not.toHaveBeenCalled();
  });
  it('attaches zero deposit to commits and sends only the PO ID to payment requests', async () => {
    vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({ chain_id: 'testnet' } as never);
    const access = vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey');
    const sign = vi.spyOn(Account.prototype, 'callFunctionRaw').mockResolvedValue({ transaction: { hash: 'tx' } } as never);
    const vault = client();
    access.mockResolvedValue({ permission: { FunctionCall: { receiver_id: 'vault.testnet', method_names: ['commit_purchase_order'] } } } as never);
    await vault.commitPurchaseOrder({ poId: 'po-000001', supplierAccountId: 'supplier.testnet', tokenAccountId: 'token.testnet', amountAtomic: '1200' });
    expect(sign).toHaveBeenLastCalledWith(expect.objectContaining({ deposit: 0n, methodName: 'commit_purchase_order' }));
    access.mockResolvedValue({ permission: { FunctionCall: { receiver_id: 'vault.testnet', method_names: ['request_payment'] } } } as never);
    await vault.requestPayment('po-000001');
    expect(sign).toHaveBeenLastCalledWith(expect.objectContaining({ deposit: 0n, args: { po_id: 'po-000001' } }));
  });
  it('does not permit a Sandbox override to target a public network', () => {
    expect(() => new NearApiVaultClient({ rpcUrl: 'https://test.rpc.fastnear.com',
      vaultAccountId: 'vault.testnet', committerAccountId: 'committer.testnet', committerPrivateKey: key,
      requesterAccountId: 'requester.testnet', requesterPrivateKey: key, sandboxChainId: 'test-chain-example' }))
      .toThrow(/loopback/);
  });

});
