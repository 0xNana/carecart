import { RPC_URL, NETWORK, testnetAccount, isAtomic, type VaultConfig, type VaultState, type Policy, type CanonicalPayment } from './near.ts';

export function vaultConfig(env: Record<string, string | undefined> = process.env): VaultConfig {
  return { vaultId: testnetAccount(env.CARECART_VAULT_ID || 'vault.carecart.testnet'),
    tokenId: testnetAccount(env.CARECART_TEST_TOKEN_ID || 'token.carecart.testnet'),
    adminId: testnetAccount(env.CARECART_ADMIN_ID || 'admin.carecart.testnet') };
}
export function vaultReader(config: VaultConfig, fetcher: typeof fetch = fetch) {
  async function rpc<T>(method: string, params: object | unknown[]): Promise<T> {
    const response = await fetcher(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'carecart-read', method, params }), cache: 'no-store',
      signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error('Testnet RPC is unavailable. Please retry.');
    const data = await response.json();
    if (data.error || !('result' in data)) throw new Error('The testnet contract query failed. Check deployment and initialization.');
    return data.result as T;
  }
  async function network() {
    if ((await rpc<{ chain_id: string }>('status', [])).chain_id !== NETWORK) throw new Error('RPC network mismatch. Wallet controls are disabled.');
  }
  async function view<T>(account: string, method: string, args = {}): Promise<T> {
    const result = await rpc<{ result: number[] }>('query', { request_type: 'call_function', finality: 'final',
      account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(result.result).toString('utf8')) as T;
  }
  return {
    async state(): Promise<VaultState> {
      await network();
      const account = await rpc<{ code_hash: string }>('query', { request_type: 'view_account', finality: 'final', account_id: config.vaultId });
      const base = { ...config, network: NETWORK, checkedAt: new Date().toISOString() };
      if (account.code_hash === '11111111111111111111111111111111') return { ...base, deployment: 'not_deployed' };
      const [admin, policy, paused, usage, storageReserve, balance, metadata] = await Promise.all([
        view<string>(config.vaultId, 'get_admin'), view<Policy>(config.vaultId, 'get_policy'),
        view<boolean>(config.vaultId, 'is_paused'), view<NonNullable<VaultState['usage']>>(config.vaultId, 'get_usage_state'),
        view<string>(config.vaultId, 'get_commit_storage_reserve'), view<string>(config.tokenId, 'ft_balance_of', { account_id: config.vaultId }),
        view<{ symbol: string; decimals: number }>(config.tokenId, 'ft_metadata'),
      ]);
      if (admin !== config.adminId || policy.token_id !== config.tokenId) throw new Error('Deployed admin or token differs from the reviewed configuration. Controls are disabled.');
      if (metadata.symbol !== 'CCTEST' || metadata.decimals !== 0) throw new Error('The token must be the zero-decimal CCTEST test token. Controls are disabled.');
      if (typeof paused !== 'boolean' || ![balance, storageReserve, policy.per_order_cap, policy.daily_cap, policy.balance_cap,
        usage.daily_spent, usage.daily_reserved, usage.total_spent, usage.total_reserved].every(isAtomic)) throw new Error('Invalid vault response. Controls are disabled.');
      return { ...base, deployment: 'ready', policy, paused, usage, balance, storageReserve };
    },
    async payment(poId: string): Promise<CanonicalPayment> {
      if (!/^po-[0-9]{6}$/.test(poId)) throw new Error('Invalid purchase order ID.');
      await network();
      const [purchaseOrder, payment] = await Promise.all([
        view<CanonicalPayment['purchaseOrder']>(config.vaultId, 'get_purchase_order', { po_id: poId }),
        view<CanonicalPayment['payment']>(config.vaultId, 'get_payment_state', { request_id: poId }),
      ]);
      if (purchaseOrder && (purchaseOrder.po_id !== poId || purchaseOrder.token_id !== config.tokenId || !isAtomic(purchaseOrder.amount))) throw new Error('The canonical purchase order does not match the testnet configuration.');
      return { purchaseOrder, payment };
    },
  };
}
