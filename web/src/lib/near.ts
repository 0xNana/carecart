export const NETWORK = 'testnet' as const;
export const RPC_URL = 'https://test.rpc.fastnear.com';
export const GAS = '100000000000000';
export const MAX_U128 = BigInt('340282366920938463463374607431768211455');
export interface VaultConfig { vaultId: string; tokenId: string; adminId: string }
export interface Policy { token_id: string; per_order_cap: string; daily_cap: string; balance_cap: string }
export interface VaultState extends VaultConfig {
  network: 'testnet'; deployment: 'not_deployed' | 'ready'; checkedAt: string;
  policy?: Policy; paused?: boolean; balance?: string; storageReserve?: string;
  usage?: { day: string; daily_spent: string; daily_reserved: string; total_spent: string; total_reserved: string };
}
export interface CanonicalPayment {
  purchaseOrder: { po_id: string; supplier_id: string; token_id: string; amount: string } | null;
  payment: { state: string; reason: string | null; approval_reasons: string[]; human_approved: boolean } | null;
}
export type AdminAction = { method: 'set_paused'; args: { paused: boolean } }
  | { method: 'set_policy'; args: { policy: Policy } }
  | { method: 'approve_payment' | 'reject_payment'; args: { po_id: string } };
export interface WalletTransaction {
  signerId: string; receiverId: string; network: 'testnet';
  actions: [{ type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }];
}
export const isAtomic = (value: unknown): value is string => typeof value === 'string'
  && /^(0|[1-9][0-9]{0,38})$/.test(value) && BigInt(value) <= MAX_U128;
export function testnetAccount(value: string) {
  if (value.length > 64 || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.testnet$/.test(value)) {
    throw new Error('CareCart requires named .testnet accounts.');
  }
  return value;
}
export function buildTransaction(state: VaultState, signer: string, action: AdminAction): WalletTransaction {
  if (state.network !== NETWORK || state.deployment !== 'ready' || !state.policy) throw new Error('The testnet vault is not ready.');
  [state.vaultId, state.tokenId, state.adminId].forEach(testnetAccount);
  if (signer !== state.adminId) throw new Error(`Connect the admin wallet: ${state.adminId}.`);
  if (state.policy.token_id !== state.tokenId) throw new Error('The vault token does not match the configured test token.');
  switch (action.method) {
    case 'set_policy':
      if (action.args.policy.token_id !== state.tokenId || !['per_order_cap', 'daily_cap', 'balance_cap'].every((key) => {
        const value = action.args.policy[key as keyof Policy];
        return isAtomic(value) && BigInt(value) > BigInt(0);
      })) throw new Error('Policy caps must be positive whole atomic amounts within u128. The test token cannot be changed here.');
      break;
    case 'set_paused':
      if (typeof action.args.paused !== 'boolean') throw new Error('Invalid pause action.');
      break;
    case 'approve_payment': case 'reject_payment':
      if (!/^po-[0-9]{6}$/.test(action.args.po_id)) throw new Error('Invalid purchase order ID.');
      break;
    default: throw new Error('This wallet action is not allowed.');
  }
  return { signerId: signer, receiverId: state.vaultId, network: NETWORK,
    actions: [{ type: 'FunctionCall', params: { methodName: action.method, args: action.args, gas: GAS, deposit: '0' } }] };
}
export function requirePending(record: CanonicalPayment, tokenId: string) {
  if (!record.purchaseOrder || record.purchaseOrder.token_id !== tokenId || record.payment?.state !== 'PendingApproval') {
    throw new Error('This payment is no longer pending approval on the configured test token. Refresh its status.');
  }
}
export const transactionUrl = (hash: string) => /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)
  ? `https://explorer.testnet.near.org/transactions/${hash}` : undefined;
