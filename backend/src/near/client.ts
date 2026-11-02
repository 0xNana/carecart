import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';

export type VaultPaymentState =
  | 'NotRequested'
  | 'CheckingBalance'
  | 'PendingApproval'
  | 'Blocked'
  | 'Processing'
  | 'Paid'
  | 'Failed'
  | 'Rejected';

export interface VaultPurchaseOrder {
  po_id: string;
  supplier_id: string;
  token_id: string;
  amount: string;
}

export interface VaultPaymentRecord {
  request_id: string;
  po_id: string;
  amount: string;
  state: VaultPaymentState;
  reason: string | null;
  approval_reasons: string[];
  human_approved: boolean;
  reserved_day: string;
}

export interface ChainTransaction {
  transactionHash: string;
}

/** Narrow boundary used by the adapter and its local test doubles. */
export interface VaultClient {
  getPurchaseOrder(poId: string): Promise<VaultPurchaseOrder | null>;
  getPaymentState(poId: string): Promise<VaultPaymentRecord | null>;
  commitPurchaseOrder(input: {
    poId: string;
    supplierAccountId: string;
    tokenAccountId: string;
    amountAtomic: string;
  }): Promise<ChainTransaction>;
  requestPayment(poId: string): Promise<ChainTransaction>;
}

export interface NearApiVaultClientOptions {
  rpcUrl: string;
  vaultAccountId: string;
  committerAccountId: string;
  committerPrivateKey: string;
  requesterAccountId: string;
  requesterPrivateKey: string;
  /** Local integration fixtures only; production always defaults to testnet. */
  sandboxChainId?: string;
}

const GAS = 120_000_000_000_000n;

/** NEAR RPC adapter. Signers are server-side and are never included in requests or results. */
export class NearApiVaultClient implements VaultClient {
  private readonly provider: JsonRpcProvider;
  private readonly committer: Account;
  private readonly requester: Account;

  constructor(private readonly options: NearApiVaultClientOptions) {
    this.provider = new JsonRpcProvider({ url: options.rpcUrl });
    this.committer = new Account(
      options.committerAccountId,
      this.provider,
      options.committerPrivateKey as KeyPairString,
    );
    this.requester = new Account(
      options.requesterAccountId,
      this.provider,
      options.requesterPrivateKey as KeyPairString,
    );
    if (options.sandboxChainId && (!/^test-chain-[A-Za-z0-9]+$/.test(options.sandboxChainId) ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(options.rpcUrl).hostname))) {
      throw new Error('Sandbox RPC must use loopback');
    }
  }

  private async assertSigningPermission(accountId: string, privateKey: string, method: string) {
    const { chain_id: network } = await this.provider.viewNodeStatus();
    if (network !== (this.options.sandboxChainId ?? 'testnet')) {
      throw new Error('Vault RPC network does not match the required network');
    }
    const key = await this.provider.viewAccessKey({
      accountId,
      publicKey: KeyPair.fromString(privateKey as KeyPairString).getPublicKey().toString(),
    });
    if (typeof key.permission === 'string' ||
        key.permission.FunctionCall.receiver_id !== this.options.vaultAccountId ||
        key.permission.FunctionCall.method_names.length !== 1 ||
        key.permission.FunctionCall.method_names[0] !== method) {
      throw new Error('Vault signer must be a function-call key scoped to its single vault method');
    }
  }

  async getPurchaseOrder(poId: string): Promise<VaultPurchaseOrder | null> {
    const record = (await this.provider.callFunction<VaultPurchaseOrder>({
      contractId: this.options.vaultAccountId,
      method: 'get_purchase_order',
      args: { po_id: poId },
    })) as VaultPurchaseOrder | null | undefined;
    return record ?? null;
  }

  async getPaymentState(poId: string): Promise<VaultPaymentRecord | null> {
    const record = (await this.provider.callFunction<VaultPaymentRecord>({
      contractId: this.options.vaultAccountId,
      method: 'get_payment_state',
      args: { request_id: poId },
    })) as VaultPaymentRecord | null | undefined;
    return record ?? null;
  }

  async commitPurchaseOrder(input: {
    poId: string;
    supplierAccountId: string;
    tokenAccountId: string;
    amountAtomic: string;
  }): Promise<ChainTransaction> {
    await this.assertSigningPermission(
      this.options.committerAccountId, this.options.committerPrivateKey, 'commit_purchase_order',
    );
    const outcome = await this.committer.callFunctionRaw({
      contractId: this.options.vaultAccountId,
      methodName: 'commit_purchase_order',
      args: {
        po_id: input.poId,
        supplier_id: input.supplierAccountId,
        token_id: input.tokenAccountId,
        amount: input.amountAtomic,
      },
      deposit: 0n,
      gas: GAS,
      waitUntil: 'FINAL',
    });
    return { transactionHash: outcome.transaction.hash };
  }

  async requestPayment(poId: string): Promise<ChainTransaction> {
    await this.assertSigningPermission(
      this.options.requesterAccountId, this.options.requesterPrivateKey, 'request_payment',
    );
    const outcome = await this.requester.callFunctionRaw({
      contractId: this.options.vaultAccountId,
      methodName: 'request_payment',
      args: { po_id: poId },
      deposit: 0n,
      gas: GAS,
      waitUntil: 'FINAL',
    });
    return { transactionHash: outcome.transaction.hash };
  }
}
