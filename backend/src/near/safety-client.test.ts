import {PUBLIC_TOKENS} from './token-registry';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { SafetyVaultClient } from './safety-client';
import type { SafetyProfile } from './safety-profile';
import { NEAR_USDC, digest } from '../intents/settlement';
import { OperationJournal } from './operation-journal';
import { SafetyOrderSchema } from './commitments';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const credentials = {
  committer: KeyPair.fromRandom('ed25519').toString(),
  requester: KeyPair.fromRandom('ed25519').toString(),
};
const profile: SafetyProfile = {
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
const operationDirectories: string[] = [];
function operations() {
  const journal = new OperationJournal(':memory:', digest(profile));
  operationJournals.push(journal);
  return journal;
}
beforeEach(()=>{
  const directory=mkdtempSync(join(tmpdir(),'carecart-safety-profile-'));operationDirectories.push(directory);
  profile.databasePath=join(directory,'profile.sqlite');
  const profileJournal=new OperationJournal(profile.databasePath,digest(profile));profileJournal.close();
});
afterEach(() => {
  for (const journal of operationJournals.splice(0)) journal.close();
  for (const directory of operationDirectories.splice(0)) rmSync(directory, { recursive: true });
  vi.restoreAllMocks();
});
function rpc() {
  vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({
    chain_id: 'testnet',
  } as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===profile.token?PUBLIC_TOKENS.testnet.codeHash:profile.codeHash}) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(
    async ({ method }) => {
      if (method === 'ft_metadata') return { decimals: 6,symbol:'USDC',spec:'ft-1.0.0' };
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
  it.each(['Sending', 'Ambiguous'])('recovers an executed %s request by finalized observation without a signing credential', async (state) => {
    const sign = rpc();
    const directory = mkdtempSync(join(tmpdir(), 'carecart-recovery-'));
    operationDirectories.push(directory);
    const file = join(directory, 'operations.sqlite');
    let journal = new OperationJournal(file, digest(profile));
    operationJournals.push(journal);
    const operation = { method: 'request_payment', args: { po_id: 'po-1' } } as const;
    journal.begin('request_payment:po-1', operation);
    if (state === 'Ambiguous') journal.ambiguous('request_payment:po-1');
    journal.close();
    journal = new OperationJournal(file, digest(profile));
    operationJournals.push(journal);
    const view = vi.mocked(JsonRpcProvider.prototype.callFunction);
    const previous = view.getMockImplementation()!;
    view.mockImplementation(async (input) => input.method === 'get_payment'
      ? { status: 'Dispatching', attempt_id: '', reason: 'None' } : previous(input));
    const reader = new SafetyVaultClient(profile, undefined, journal);
    const observation = { transactionHash: null, reconciled: true };
    await expect(reader.reconcileOperation(operation)).resolves.toEqual(observation);
    await expect(reader.reconcileOperation(operation)).resolves.toEqual(observation);
    expect(journal.begin('request_payment:po-1', operation)).toEqual(observation);
    expect(sign).not.toHaveBeenCalled();
    for (const [input] of view.mock.calls) expect(input.blockQuery).toEqual({ finality: 'final' });
  });
  it('keeps an ambiguous request frozen on unchanged state, missing records, RPC failure or wrong release', async () => {
    const sign = rpc();
    const journal = operations();
    const operation = { method: 'request_payment', args: { po_id: 'po-1' } } as const;
    journal.begin('request_payment:po-1', operation);
    journal.ambiguous('request_payment:po-1');
    const reader = new SafetyVaultClient(profile, undefined, journal);
    await expect(reader.reconcileOperation(operation)).rejects.toThrow(/unresolved/);
    const view = vi.mocked(JsonRpcProvider.prototype.callFunction);
    const previous = view.getMockImplementation()!;
    view.mockImplementation(async (input) => input.method === 'get_payment' ? undefined : previous(input));
    await expect(reader.reconcileOperation(operation)).rejects.toThrow(/unavailable/);
    view.mockRejectedValue(new Error('RPC unavailable'));
    await expect(reader.reconcileOperation(operation)).rejects.toThrow(/RPC unavailable/);
    vi.mocked(JsonRpcProvider.prototype.viewAccount).mockResolvedValue({ code_hash: 'wrong' } as never);
    await expect(reader.reconcileOperation(operation)).rejects.toThrow(/Unreviewed/);
    expect(() => journal.begin('request_payment:po-1', operation)).toThrow(/reconcile/);
    expect(sign).not.toHaveBeenCalled();
  });
  it('recovers an exact immutable commitment but rejects conflicting or unrecorded operations', async () => {
    const sign = rpc();
    const journal = operations();
    const order = SafetyOrderSchema.parse({ po_id: 'po-1', supplier: 'supplier.testnet', amount: '1000000', invoice_digest: 'a'.repeat(64),
      profile: 'testnet', token: profile.token, destination: 'Near' });
    const operation = { method: 'commit_purchase_order', args: { order } } as const;
    journal.begin('commit_purchase_order:po-1', operation);
    const reader = new SafetyVaultClient(profile, undefined, journal);
    await expect(reader.reconcileOperation({ ...operation, args: { order: { ...order, amount: '2000000' } } })).rejects.toThrow(/conflict/);
    await expect(reader.reconcileOperation({ method: 'request_payment', args: { po_id: 'po-1' } })).rejects.toThrow(/recorded/);
    await expect(reader.reconcileOperation(operation)).resolves.toEqual({ transactionHash: null, reconciled: true });
    expect(sign).not.toHaveBeenCalled();
  });
  it('requires exact finalized quote contents and the requested cross-chain attempt before recovery', async () => {
    const sign = rpc();
    const journal = operations();
    const canonical = { po_id: 'po-1', supplier: 'supplier.testnet', amount: '1000000', invoice_digest: 'a'.repeat(64),
      profile: 'testnet', token: profile.token, destination: { Base: { route_id: 'base-1', version: 1, route_hash: 'b'.repeat(64) } } };
    const quote = { attempt_id: 'attempt-1', po_id: 'po-1', route_id: 'base-1', route_version: 1, signed_quote_hash: 'c'.repeat(64),
      deposit_account: 'd'.repeat(64), deadline_ns: '200000000000000', min_amount_out: '900000', storage_deposit_yocto: '0' };
    const commit = { method: 'commit_quote', args: { quote } } as const;
    const request = { method: 'request_crosschain', args: { po_id: 'po-1', attempt_id: 'attempt-1' } } as const;
    journal.begin('commit_quote:attempt-1', commit);
    journal.begin('request_crosschain:attempt-1', request);
    journal.ambiguous('commit_quote:attempt-1');
    let storedQuote = { ...quote, min_amount_out: '800000' };
    let paymentAttempt = 'other-attempt';
    const view = vi.mocked(JsonRpcProvider.prototype.callFunction);
    const previous = view.getMockImplementation()!;
    view.mockImplementation(async (input) => input.method === 'get_purchase_order' ? canonical
      : input.method === 'get_quote' ? storedQuote
      : input.method === 'get_payment' ? { status: 'PendingApproval', attempt_id: paymentAttempt, reason: 'None' }
      : previous(input));
    const reader = new SafetyVaultClient(profile, undefined, journal);
    await expect(reader.reconcileOperation(commit)).rejects.toThrow(/commitment/);
    expect(() => journal.begin('commit_quote:attempt-1', commit)).toThrow(/reconcile/);
    storedQuote = quote;
    await expect(reader.reconcileOperation(commit)).resolves.toEqual({ transactionHash: null, reconciled: true });
    await expect(reader.reconcileOperation(request)).rejects.toThrow(/unresolved/);
    expect(() => journal.begin('request_crosschain:attempt-1', request)).toThrow(/reconcile/);
    paymentAttempt = 'attempt-1';
    await expect(reader.reconcileOperation(request)).resolves.toEqual({ transactionHash: null, reconciled: true });
    expect(sign).not.toHaveBeenCalled();
  });
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
      databasePath: 'backend/data/local-v2/carecart.sqlite',
    };
    const sign = vi.spyOn(Account.prototype, 'callFunctionRaw').mockResolvedValue({ transaction: { hash: 'fixture-mainnet-only' } } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({ chain_id: mismatch === 'network' ? 'testnet' : 'mainnet' } as never);
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===mainnet.token?PUBLIC_TOKENS.mainnet.codeHash:mainnet.codeHash}) as never);
    vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(async ({ method }) => {
      if (method === 'ft_metadata') return { decimals: mismatch === 'decimals' ? 0 : 6, spec:'ft-1.0.0',symbol: mismatch === 'symbol' ? 'USDC.e' : 'USDC' };
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
    vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===profile.token?PUBLIC_TOKENS.testnet.codeHash:profile.codeHash}) as never);
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
it('TENANT DIRECT SIGNER: an unrelated memory journal cannot bypass ownership of the configured operational database',async()=>{
 const {randomUUID}=await import('node:crypto');const {InventoryLedger,gloves}=await import('../inventory/ledger.js');
 const sign=rpc(),directory=mkdtempSync(join(tmpdir(),'carecart-tenant-signer-'));operationDirectories.push(directory);
 vi.spyOn(JsonRpcProvider.prototype,'viewAccessKey').mockResolvedValue({permission:{FunctionCall:{receiver_id:profile.vault,method_names:['request_payment'],allowance:'1'}}} as never);
 const clinicId=randomUUID(),p={...profile,databasePath:join(directory,'clinic.sqlite')};
 const inventory=new InventoryLedger(p.databasePath,digest(p),[{...gloves,clinicId}],Date.now,undefined,{clinicId,storeroomId:'main-storeroom',syntheticDemo:false});
 const journal=new OperationJournal(':memory:',digest(p));try{
  const client=new SafetyVaultClient(p,{requester:credentials.requester},journal);
  await expect(client.submitPayment('po-1')).rejects.toThrow('TENANT_DIRECT_SIGNING_DISABLED');expect(sign).not.toHaveBeenCalled();
  const missing={...p,databasePath:join(directory,'missing.sqlite')},other=new OperationJournal(':memory:',digest(missing));try{await expect(new SafetyVaultClient(missing,{requester:credentials.requester},other).submitPayment('po-1')).rejects.toThrow();expect(sign).not.toHaveBeenCalled();}finally{other.close();}
 }finally{journal.close();inventory.close();}
});
