import {
  Account,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  type SerializedReturnValue,
} from 'near-api-js';
import { SafetyProfileSchema, type SafetyProfile } from './safety-profile';
import {
  digest,
  revalidateStoredQuote,
  type VerifiedQuote,
} from '../intents/settlement';
import type { SettlementJournal } from '../intents/journal';
import { verifyNearDispatch } from '../intents/receipts';
import { assertQuoteCommitment, quoteApprovalSummary } from '../intents/approval';
import { SafetyOrderSchema, SafetyQuoteSchema, SafetyRouteSchema, routeHash, quoteCommitmentHash, type SafetyOrder, type SafetyQuote } from './commitments';
import type { OperationJournal } from './operation-journal';
export type { SafetyOrder } from './commitments';

export interface SafetyPayment {
  status: string;
  reason: string;
  attempt_id: string;
}
export type { SafetyQuote } from './commitments';
const methods = {
  committer: ['commit_purchase_order', 'commit_quote'],
  requester: ['request_payment', 'request_crosschain'],
} as const;
/** Separate v2 ABI, explicit manifest, no automatic configuration from the old CCTEST environment. */
export class SafetyVaultClient {
  private readonly provider: JsonRpcProvider;
  readonly profile: SafetyProfile;
  constructor(
    raw: SafetyProfile,
    private readonly credentials?: { committer?: string; requester?: string },
    private readonly operations?: OperationJournal,
  ) {
    this.profile = Object.freeze(SafetyProfileSchema.parse(raw));
    this.provider = new JsonRpcProvider({ url: this.profile.rpcUrl });
    if (credentials?.committer && credentials?.requester)
      throw new Error('Separate processes must load only one backend role credential');
    if (operations && operations.profileFingerprint !== digest(this.profile))
      throw new Error('Operation journal profile mismatch');
  }
  private async verifyProfile() {
    const p = this.profile;
    const status = await this.provider.viewNodeStatus();
    if (status.chain_id !== p.network)
      throw new Error('Safety profile chain mismatch');
    const account = await this.provider.viewAccount({
      accountId: p.vault,
      blockQuery: { finality: 'final' },
    });
    if (account.code_hash !== p.codeHash)
      throw new Error('Unreviewed safety vault code');
    const meta = await this.provider.callFunction<{ decimals: number; symbol?: string }>({
      contractId: p.token,
      method: 'ft_metadata',
      args: {},
      blockQuery: { finality: 'final' },
    });
    if (meta?.decimals !== 6)
      throw new Error('Safety profile token decimals mismatch');
    if (p.network === 'mainnet' && meta.symbol !== 'USDC')
      throw new Error('Mainnet native USDC metadata mismatch');
    const state = await this.view<Record<string, unknown>>('get_state', {});
    if (state.profile !== p.network) throw new Error('Safety contract profile mismatch');
    for (const role of ['admin', 'guardian', 'treasury', 'token'] as const) {
      if (state[role] !== p[role]) throw new Error('Safety role mismatch');
    }
  }
  private journal() {
    if (!this.operations || (this.profile.network === 'mainnet' && !this.operations.persistent))
      throw new Error('Durable profile-bound backend operation journal required');
    return this.operations;
  }
  private async optionalView<T extends SerializedReturnValue>(method: string, args: Record<string, unknown>): Promise<T | null> {
    return (await this.provider.callFunction<T>({ contractId: this.profile.vault, method, args,
      blockQuery: { finality: 'final' } })) ?? null;
  }
  private observed(method: string, args: object) {
    return this.journal().confirm(this.operationKey(method, args), { method, args }, { transactionHash: null, reconciled: true });
  }
  private operationKey(method: string, args: object) {
    const fields = args as { order?: SafetyOrder; quote?: SafetyQuote; po_id?: string; attempt_id?: string };
    return `${method}:${fields.order?.po_id ?? fields.quote?.attempt_id ?? fields.attempt_id ?? fields.po_id}`;
  }
  async view<T extends SerializedReturnValue>(
    method: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const value = await this.provider.callFunction<T>({
      contractId: this.profile.vault,
      method,
      args,
      blockQuery: { finality: 'final' },
    });
    if (value == null) throw new Error('Canonical v2 record unavailable');
    return value;
  }
  private async revalidate(q: VerifiedQuote) {
    const r = await fetch('https://1click.chaindefuser.com/v0/tokens', {
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error('Live token list unavailable');
    return revalidateStoredQuote(q, await r.json());
  }
  private async assertCanonicalOrder(q: VerifiedQuote) {
    if (
      q.order.vault !== this.profile.vault ||
      q.order.treasury !== this.profile.treasury ||
      q.order.token !== this.profile.token ||
      this.profile.network !== 'mainnet'
    )
      throw new Error('Canonical quote profile mismatch');
    const order = SafetyOrderSchema.parse(await this.view<SafetyOrder>('get_purchase_order', {
      po_id: q.order.poId,
    }));
    if (
      order.po_id !== q.order.poId ||
      order.profile !== 'mainnet' ||
      order.supplier !== q.order.supplier ||
      order.token !== q.order.token ||
      order.amount !== q.order.amount ||
      order.invoice_digest !== q.order.invoiceDigest ||
      order.destination === 'Near' ||
      order.destination.Base.route_id !== q.order.routeId ||
      order.destination.Base.version !== q.order.routeVersion ||
      order.destination.Base.route_hash !== (await this.reviewedBaseDestination(q)).Base.route_hash
    )
      throw new Error('Canonical PO differs from reviewed quote');
    return order;
  }
  /** Resolve the trusted route independently of supplier text/LLM output. */
  async reviewedBaseDestination(q: VerifiedQuote) {
    await this.verifyProfile();
    const route = SafetyRouteSchema.parse(await this.view('get_route', { route_id: q.order.routeId }));
    if (this.profile.network !== 'mainnet' || q.order.vault !== this.profile.vault || q.order.treasury !== this.profile.treasury ||
        !route.active || route.route_id !== q.order.routeId || route.version !== q.order.routeVersion ||
        route.supplier !== q.order.supplier || route.recipient.toLowerCase() !== q.order.recipient.toLowerCase() ||
        route.asset_id !== q.response.quoteRequest.destinationAsset)
      throw new Error('Reviewed Base route mismatch');
    return { Base: { route_id: route.route_id, version: route.version, route_hash: routeHash(route) } };
  }
  private async send(
    role: 'committer' | 'requester',
    method: string,
    args: object,
  ) {
    const key = this.credentials?.[role];
    if (!(methods[role] as readonly string[]).includes(method) || !key)
      throw new Error('Restricted backend capability unavailable');
    await this.verifyProfile();
    const who = this.profile[role];
    const publicKey = KeyPair.fromString(key as KeyPairString)
      .getPublicKey()
      .toString();
    if (
      publicKey !==
      (role === 'committer'
        ? this.profile.committerPublicKey
        : this.profile.requesterPublicKey)
    )
      throw new Error('Credential does not match the reviewed role key');
    const access = await this.provider.viewAccessKey({
      accountId: who,
      publicKey,
      finalityQuery: { finality: 'final' },
    });
    if (
      typeof access.permission === 'string' ||
      access.permission.FunctionCall.receiver_id !== this.profile.vault ||
      access.permission.FunctionCall.method_names.length === 0 ||
      access.permission.FunctionCall.method_names.some(
        (m) => !(methods[role] as readonly string[]).includes(m),
      ) ||
      !access.permission.FunctionCall.method_names.includes(method)
    )
      throw new Error('Exact restricted v2 role key required');
    const allowance = access.permission.FunctionCall.allowance;
    if (
      typeof allowance !== 'string' ||
      !/^[0-9]+$/.test(allowance) ||
      BigInt(allowance) === 0n ||
      BigInt(allowance) > BigInt(this.profile.maxKeyAllowanceYocto)
    )
      throw new Error('Reviewed finite gas allowance required');
    if (new Set(access.permission.FunctionCall.method_names).size !== access.permission.FunctionCall.method_names.length)
      throw new Error('Duplicate method permissions are forbidden');
    const membership = await this.view<{ committer: boolean; requester: boolean }>('get_roles', { account: who });
    if (!membership[role] || membership[role === 'committer' ? 'requester' : 'committer'])
      throw new Error('Canonical backend role revoked or overlapping');
    const journal = this.journal();
    const operationKey = this.operationKey(method, args);
    const payload = { method, args };
    const confirmed = journal.begin(operationKey, payload);
    if (confirmed) return confirmed;
    try {
      const outcome = await new Account(who, this.provider, key as KeyPairString).callFunctionRaw({
        contractId: this.profile.vault,
        methodName: method,
        args,
        deposit: 0n,
        gas: 120_000_000_000_000n,
        waitUntil: 'FINAL',
      });
      return journal.confirm(operationKey, payload, { transactionHash: outcome.transaction.hash, reconciled: false });
    } catch {
      journal.ambiguous(operationKey);
      throw new Error('Backend response is ambiguous; reconcile finalized contract state before retrying');
    }
  }
  async commitOrder(order: SafetyOrder) {
    order = SafetyOrderSchema.parse(order);
    if (
      order.profile !== this.profile.network ||
      order.token !== this.profile.token
    )
      throw new Error('PO profile mismatch');
    await this.verifyProfile();
    this.journal().rememberOrder(order);
    const existing = await this.optionalView<SafetyOrder>('get_purchase_order', { po_id: order.po_id });
    if (existing) {
      if (digest(SafetyOrderSchema.parse(existing)) !== digest(order)) throw new Error('Canonical immutable PO conflict');
      return this.observed('commit_purchase_order', { order });
    }
    const supplier = await this.view<{ supplier: boolean }>('get_roles', { account: order.supplier });
    if (!supplier.supplier) throw new Error('Trusted supplier is not allowlisted');
    if (order.destination !== 'Near') {
      const route = SafetyRouteSchema.parse(await this.view('get_route', { route_id: order.destination.Base.route_id }));
      if (!route.active || route.version !== order.destination.Base.version || route.supplier !== order.supplier || routeHash(route) !== order.destination.Base.route_hash)
        throw new Error('Canonical PO route mismatch');
    }
    return this.send('committer', 'commit_purchase_order', { order });
  }
  /** Finalized canonical lookup; never accepts PO fields from a requester. */
  async canonicalOrder(poId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(poId)) throw new Error('Registered PO ID required');
    await this.verifyProfile();
    const order = SafetyOrderSchema.parse(await this.view<SafetyOrder>('get_purchase_order', {
      po_id: poId,
    }));
    if (order.po_id !== poId || order.profile !== this.profile.network || order.token !== this.profile.token)
      throw new Error('Independently committed same-chain PO required');
    return order;
  }
  /** Agent-facing ID only; accepts no order, payee, amount or quote fields. */
  async submitPayment(poId: string) {
    const order = await this.canonicalOrder(poId);
    if (order.destination !== 'Near')
      throw new Error('Independently committed same-chain PO required');
    this.journal().rememberOrder(order);
    const payment = await this.view<SafetyPayment>('get_payment', { po_id: poId });
    this.assertPaymentStatus(payment);
    if (payment.status !== 'Committed') return this.observed('request_payment', { po_id: poId });
    return this.send('requester', 'request_payment', { po_id: poId });
  }
  async commitQuote(
    attemptId: string,
    q: VerifiedQuote,
    storageDepositYocto: string,
  ) {
    if (
      q.order.vault !== this.profile.vault ||
      q.order.treasury !== this.profile.treasury ||
      this.profile.network !== 'mainnet' ||
      !/^\d+$/.test(storageDepositYocto) ||
      BigInt(storageDepositYocto) > 10n ** 22n
    )
      throw new Error('Reviewed quote profile/native budget mismatch');
    await this.verifyProfile();
    const canonical = await this.assertCanonicalOrder(q);
    this.journal().rememberOrder(canonical);
    const quote = SafetyQuoteSchema.parse({
      attempt_id: attemptId, po_id: q.order.poId, route_id: q.order.routeId,
      route_version: q.order.routeVersion, signed_quote_hash: q.identityHash,
      deposit_account: q.response.quote.depositAddress,
      deadline_ns: (BigInt(Date.parse(q.expiresAt)) * 1_000_000n).toString(),
      min_amount_out: q.response.quote.minAmountOut, storage_deposit_yocto: storageDepositYocto,
    });
    const existing = await this.optionalView<SafetyQuote>('get_quote', { attempt_id: attemptId });
    if (existing) {
      if (digest(SafetyQuoteSchema.parse(existing)) !== digest(quote)) throw new Error('Canonical immutable quote conflict');
      return this.observed('commit_quote', { quote });
    }
    await this.revalidate(q);
    const registered = await this.provider.callFunction<{ total: string }>({
      contractId: this.profile.token,
      method: 'storage_balance_of',
      args: { account_id: q.response.quote.depositAddress },
      blockQuery: { finality: 'final' },
    });
    if (!registered) {
      const bounds = await this.provider.callFunction<{ min: string }>({
        contractId: this.profile.token,
        method: 'storage_balance_bounds',
        args: {},
        blockQuery: { finality: 'final' },
      });
      if (
        !bounds ||
        !/^[0-9]+$/.test(bounds.min) ||
        BigInt(storageDepositYocto) < BigInt(bounds.min)
      )
        throw new Error(
          'Reviewed native budget does not cover live token storage bounds',
        );
    }
    if (Date.parse(q.expiresAt) <= Date.now() + 30000)
      throw new Error('Quote expired before commitment');
    return this.send('committer', 'commit_quote', { quote });
  }
  async requestCrosschain(poId: string, attemptId: string) {
    await this.verifyProfile();
    const order = SafetyOrderSchema.parse(await this.view('get_purchase_order', { po_id: poId }));
    if (order.po_id !== poId || order.profile !== this.profile.network || order.token !== this.profile.token || order.destination === 'Near')
      throw new Error('Independently committed Base PO required');
    this.journal().rememberOrder(order);
    const quote = SafetyQuoteSchema.parse(await this.view<SafetyQuote>('get_quote', { attempt_id: attemptId }));
    if (quote.attempt_id !== attemptId || quote.po_id !== poId || quote.route_id !== order.destination.Base.route_id || quote.route_version !== order.destination.Base.version)
      throw new Error('Cross-chain attempt does not reference the immutable PO');
    const payment = await this.view<SafetyPayment>('get_payment', { po_id: poId });
    this.assertPaymentStatus(payment);
    if (payment.attempt_id === attemptId && payment.status !== 'Committed')
      return this.observed('request_crosschain', { po_id: poId, attempt_id: attemptId });
    if (!['Committed', 'Expired', 'Failed'].includes(payment.status)) throw new Error('Previous attempt is unresolved; do not retry');
    return this.send('requester', 'request_crosschain', {
      po_id: poId,
      attempt_id: attemptId,
    });
  }
  private assertPaymentStatus(payment: SafetyPayment) {
    if (!['Committed', 'PendingApproval', 'Registering', 'Dispatching', 'Dispatched', 'Paid', 'Rejected', 'Blocked', 'Expired', 'Failed'].includes(payment.status))
      throw new Error('Canonical payment status unavailable');
  }
  async reconcile(attemptId: string, journal: SettlementJournal) {
    if (journal.profileFingerprint !== digest(this.profile))
      throw new Error('Journal profile mismatch');
    await this.verifyProfile();
    const a = journal.get(attemptId);
    const payment = await this.view<SafetyPayment>('get_payment', {
      po_id: a.poId,
    });
    const quote = await this.view<SafetyQuote>('get_quote', {
      attempt_id: attemptId,
    });
    return journal.reconcileSource(attemptId, payment, quote);
  }
  async observeDispatch(
    attemptId: string,
    txHash: string,
    journal: SettlementJournal,
  ) {
    if (
      journal.profileFingerprint !== digest(this.profile) ||
      this.profile.network !== 'mainnet'
    )
      throw new Error('Mainnet journal profile mismatch');
    await this.verifyProfile();
    const a = journal.get(attemptId);
    await this.assertCanonicalOrder(a.quote);
    const tx = await this.provider.viewTransactionStatusWithReceipts({
      txHash,
      accountId: this.profile.admin,
      waitUntil: 'FINAL',
    });
    const commitment = assertQuoteCommitment(a.quote, attemptId, await this.view('get_quote', { attempt_id: attemptId }));
    const proof = verifyNearDispatch(a.quote, txHash, this.profile.admin, tx, quoteCommitmentHash(commitment));
    journal.recordSource(attemptId, proof);
    return this.reconcile(attemptId, journal);
  }
  /** Produces an unsigned review only. The caller must hand it to an explicit human wallet action. */
  async approvalReview(attemptId: string, journal: SettlementJournal) {
    if (journal.profileFingerprint !== digest(this.profile))
      throw new Error('Journal profile mismatch');
    await this.verifyProfile();
    const a = journal.get(attemptId);
    const q = a.quote;
    if (
      q.order.vault !== this.profile.vault ||
      q.order.treasury !== this.profile.treasury ||
      this.profile.network !== 'mainnet'
    )
      throw new Error('Cross-chain profile mismatch');
    await this.revalidate(q);
    const canonicalOrder = await this.assertCanonicalOrder(q);
    if (
      a.state !== 'PendingApproval' ||
      Date.parse(q.expiresAt) <= Date.now() + 30000
    )
      throw new Error('Quote unavailable for human review');
    const payment = await this.view<SafetyPayment>('get_payment', {
      po_id: a.poId,
    });
    const quote = assertQuoteCommitment(q, attemptId, await this.view<SafetyQuote>('get_quote', {
      attempt_id: attemptId,
    }));
    const route = SafetyRouteSchema.parse(await this.view('get_route', { route_id: q.order.routeId }));
    if (
      payment.status !== 'PendingApproval' ||
      payment.attempt_id !== attemptId ||
      quote.signed_quote_hash !== q.identityHash ||
      quote.deposit_account !== q.response.quote.depositAddress ||
      !route.active ||
      route.version !== q.order.routeVersion ||
      route.recipient.toLowerCase() !== q.order.recipient.toLowerCase() ||
      route.supplier !== q.order.supplier ||
      route.asset_id !== q.response.quoteRequest.destinationAsset ||
      canonicalOrder.destination === 'Near' ||
      routeHash(route) !== canonicalOrder.destination.Base.route_hash
    )
      throw new Error('Quote or route changed before signing');
    await this.verifyProfile();
    if (Date.parse(q.expiresAt) <= Date.now() + 30000) throw new Error('Quote expired during human review');
    const summary = quoteApprovalSummary(q, quote);
    return {
      reviewHash: digest({
        quoteReview: a.reviewHash,
        commitment: quote,
        canonicalOrder,
        profile: journal.profileFingerprint,
        summary,
      }),
      summary,
      quote: q,
      commitment: quote,
      canonicalOrder,
      signerId: this.profile.admin,
      receiverId: this.profile.vault,
      methodName: 'approve_payment',
      args: { po_id: a.poId, expected_quote_hash: q.identityHash, expected_commitment_hash: quoteCommitmentHash(quote) },
      depositYocto: '1',
      gas: '120000000000000',
    };
  }
  /** Invoke immediately before wallet handoff; reconstructs everything and returns only fresh unsigned data. */
  async revalidateApproval(attemptId: string, reviewed: unknown, journal: SettlementJournal) {
    const fresh = await this.approvalReview(attemptId, journal);
    if (digest(reviewed) !== digest(fresh)) throw new Error('Human approval review changed; review the fresh quote again');
    return fresh;
  }
}
