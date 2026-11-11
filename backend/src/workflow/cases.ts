import {assertTenantExecution,type TenantExecutionPermit} from '../tenancy/treasury-authority';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { digest } from '../intents/settlement';
import { V2ProcurementStore } from '../procurement/v2-store';
import type {WorkflowProcurement} from './procurement-port';
import {isSandboxProfile} from '../sandbox/profile';
import { Identity, WorkflowState, nextAction, permitted, preparation, terminal } from './model';
import { roleCredentials } from '../ops/role-credentials';
import { reconcileProcurement } from '../procurement/v2-bridge';
import { assertCheckedObservation, domainCapabilities, observeVault, Observation, restrictedPaymentCapability, type FinancialObservation } from './capabilities';

type Row = { case_id: string; identity_json: string; state: WorkflowState; version: number; po_id: string | null;
  po_hash: string | null; created_at: string; updated_at: string };
type Audit = { caseId: string; eventType: string; previousState: WorkflowState | null; resultingState: WorkflowState;
  actor: string; poId: string | null; operationId: string | null; timestamp: string; evidence: unknown;
  evidenceReference: string; idempotencyKey: string; previousHash: string | null };

/** Workflow state coordinates work; it never supplies canonical payment terms or signing credentials. */
export class ReplenishmentWorkflow {
  readonly #db: Database.Database;
  readonly capabilities;
  constructor(readonly procurement: WorkflowProcurement) {
    this.capabilities = domainCapabilities(procurement);
    this.#db = new Database(procurement.profile.databasePath);
    this.#db.pragma('journal_mode = WAL'); this.#db.pragma('synchronous = FULL'); this.#db.pragma('busy_timeout = 3000');
    this.#db.exec(`CREATE TABLE IF NOT EXISTS replenishment_cases(case_id TEXT PRIMARY KEY,identity_json TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,event_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,
      po_id TEXT UNIQUE,po_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replenishment_events(case_id TEXT NOT NULL,version INTEGER NOT NULL,event_key TEXT NOT NULL,
      body_json TEXT NOT NULL,event_hash TEXT NOT NULL,PRIMARY KEY(case_id,version),UNIQUE(case_id,event_key));`);
  }
  close() { if (this.#db.open) this.#db.close(); }
  #row(caseId: string) {
    Identity.shape.caseId.parse(caseId);
    const row = this.#db.prepare('SELECT * FROM replenishment_cases WHERE case_id=?').get(caseId) as Row | undefined;
    if (!row) throw new Error('Unknown case');
    Identity.parse(JSON.parse(row.identity_json)); WorkflowState.parse(row.state);
    return row;
  }
  #history(row: Row): Audit[] {
    const rows = this.#db.prepare('SELECT version,event_key,body_json,event_hash FROM replenishment_events WHERE case_id=? ORDER BY version')
      .all(row.case_id) as { version: number; event_key: string; body_json: string; event_hash: string }[];
    let previous: Audit | undefined; let hash: string | null = null;
    const history = rows.map((r, index) => {
      const e = JSON.parse(r.body_json) as Audit;
      if (r.version !== index || e.caseId !== row.case_id || e.idempotencyKey !== r.event_key || e.previousHash !== hash ||
          e.previousState !== (previous?.resultingState ?? null) || digest(e.evidence) !== e.evidenceReference || digest(e) !== r.event_hash ||
          (previous && !permitted(previous.resultingState, e.resultingState))) throw new Error('Missing or corrupt case audit evidence');
      WorkflowState.parse(e.resultingState); previous = e; hash = r.event_hash; return e;
    });
    if (!history.length || history.length !== row.version+1 || history.at(-1)!.resultingState !== row.state || history[0].resultingState !== 'Opened' ||
        digest(history[0].evidence) !== digest({identity:JSON.parse(row.identity_json),profile:this.procurement.fingerprint}))
      throw new Error('Case state does not match durable audit evidence');
    return history;
  }
  #append(row: Row | null, identity: Identity, to: WorkflowState, eventType: string, evidence: unknown,
    key: string, now: Date, binding?: { poId: string; poHash: string }, actor = 'deterministic-coordinator', operationId: string | null = null) {
    const history = row ? this.#history(row) : [];
    if (row && !permitted(row.state, to)) throw new Error(`Unauthorized workflow transition ${row.state} → ${to}`);
    const version = row ? row.version+1 : 0;
    const event: Audit = { caseId: identity.caseId, eventType, previousState: row?.state ?? null, resultingState: to,
      actor, poId: binding?.poId ?? row?.po_id ?? null, operationId, timestamp: now.toISOString(), evidence,
      evidenceReference: digest(evidence), idempotencyKey: key,
      previousHash: history.length ? digest(history.at(-1)) : null };
    this.#db.prepare('INSERT INTO replenishment_events VALUES(?,?,?,?,?)').run(identity.caseId, version, key, JSON.stringify(event), digest(event));
    if (row) {
      const changed = this.#db.prepare('UPDATE replenishment_cases SET state=?,version=?,po_id=?,po_hash=?,updated_at=? WHERE case_id=? AND version=?')
        .run(to,version,event.poId,binding?.poHash ?? row.po_hash,event.timestamp,identity.caseId,row.version);
      if (changed.changes !== 1) throw new Error('Concurrent case update');
    } else this.#db.prepare('INSERT INTO replenishment_cases VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(identity.caseId,JSON.stringify(identity),identity.idempotencyKey,identity.eventId,to,version,null,null,event.timestamp,event.timestamp);
  }
  #advance(caseId: string, to: WorkflowState, type: string, evidence: unknown, key: string, now: Date,
    expectedVersion?: number, binding?: { poId: string; poHash: string }, actor?: string, operationId?: string) {
    this.#db.transaction(() => {
      const row = this.#row(caseId);
      if (expectedVersion !== undefined && row.version !== expectedVersion) throw new Error('Concurrent case update');
      const existing = this.#db.prepare('SELECT 1 FROM replenishment_events WHERE case_id=? AND event_key=?').get(caseId,key);
      if (existing) return;
      this.#append(row,Identity.parse(JSON.parse(row.identity_json)),to,type,evidence,key,now,binding,actor,operationId);
    }).immediate();
  }
  open(raw: unknown, now = new Date()) {
    const identity = Identity.parse(raw);
    this.#db.transaction(() => {
      const rows = this.#db.prepare('SELECT * FROM replenishment_cases WHERE case_id=? OR idempotency_key=? OR event_id=?')
        .all(identity.caseId,identity.idempotencyKey,identity.eventId) as Row[];
      if (rows.length) {
        if (rows.length !== 1 || digest(JSON.parse(rows[0].identity_json)) !== digest(identity)) throw new Error('Conflicting case identity');
        this.#history(rows[0]); return;
      }
      this.#append(null,identity,'Opened','CaseOpened',{ identity, profile: this.procurement.fingerprint },`ingest:${identity.idempotencyKey}`,now);
    }).immediate();
    return this.get(identity.caseId);
  }
  ingest(raw: unknown, now = new Date()) {const opened=this.open(raw,now);return this.prepare(opened.caseId,now);}
  prepare(caseId: string, now = new Date()) {
    let row = this.#row(caseId); this.#history(row);
    if (!preparation.slice(0,-1).includes(row.state)) return this.get(caseId);
    const identity = Identity.parse(JSON.parse(row.identity_json));
    // P1 atomically persists event+quotes. If interrupted before the case update, replay reconstructs them.
    const event = this.procurement.inventoryEvent({ eventId: identity.eventId,itemId: identity.itemId },now);
    for (const [state,type,evidence] of [
      ['InventoryRecorded','InventoryRecorded',{ eventId: event.eventId,itemId: event.itemId }],
      ['ForecastEvaluated','ForecastEvaluated',this.capabilities.forecasting.evaluate(event.eventId).forecasts],
      ['QuotesAvailable','QuotesAvailable',{ quotes: this.capabilities.suppliers.compare(event.eventId).map(q => ({ id:q.id,hash:digest(q) })) }],
    ] as const) {
      row = this.#row(caseId);
      if (preparation.indexOf(row.state) < preparation.indexOf(state)) this.#advance(caseId,state,type,evidence,type,now,row.version);
    }
    let order;
    try { order = this.capabilities.orders.construct(identity.eventId,now); }
    catch (error) {
      if (error instanceof Error && /quote expired/.test(error.message)) {
        this.#advance(caseId,'Expired','SupplierQuotesExpired',{ eventId: identity.eventId },'quotes-expired',now); return this.get(caseId);
      }
      throw error;
    }
    const binding = { poId:order.canonical.po_id,poHash:digest(order.canonical) };
    row = this.#row(caseId);
    if (row.state === 'QuotesAvailable') this.#advance(caseId,'SupplierSelected','SupplierSelected',
      { quoteId:order.quoteId,quoteDigest:order.quoteDigest,policy:order.decisionPolicy },'supplier-selected',now,row.version,binding);
    row = this.#row(caseId);
    if (row.state === 'SupplierSelected') this.#advance(caseId,'PoDrafted','PoDrafted',binding,'po-drafted',now,row.version,binding);
    return this.get(caseId);
  }
  /** Manual, single-role command only. Preparation/refresh never call this method. */
  async act(raw:unknown, environment:NodeJS.ProcessEnv = process.env, now=new Date(),tenantPermit?:TenantExecutionPermit) {
    const input=z.object({caseId:Identity.shape.caseId,role:z.enum(['committer','requester']),
      expectedVersion:z.number().int().nonnegative(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
    const c=this.get(input.caseId);
    if (!c.poId || c.poHash!==input.expectedHash || environment.CARECART_SAFETY_WRITES!=='approved') throw new Error('Exact operator authorization required');
    assertTenantExecution(this.procurement.profile.databasePath,input.role,c.poId,tenantPermit,c.poHash!);
    roleCredentials(input.role,environment); // Refuse overlapping/missing credentials before changing workflow state.
    if (input.role==='committer' && Date.parse(this.procurement.quoteExpiry(c.poId))<=now.getTime())
      throw new Error('Supplier quote expired; observe canonical state before further authorization');
    if (c.state !== (input.role==='committer'?'PoDrafted':'PoCommitted') ||
        (input.role==='requester' && c.domain!.purchaseOrder.canonical.destination!=='Near')) throw new Error('Unauthorized workflow action; human review or reconciliation required');
    const pending=input.role==='committer'?'CommitmentPending':'PaymentRequestPending';
    const op=`${input.role==='committer'?'commit_purchase_order':'request_payment'}:${c.poId}`;
    this.#advance(c.caseId,pending,'OperationAuthorized',{canonicalHash:c.poHash},`authorize:${op}`,now,input.expectedVersion,undefined,`operator:${input.role}`,op);
    try {
      if(isSandboxProfile(this.procurement.profile)){
        if(!this.procurement.executeSandboxRole)throw new Error('Dedicated Sandbox role worker required');
        await this.procurement.executeSandboxRole(input.role,c.poId,environment,tenantPermit);
      }else{
        if(!(this.procurement instanceof V2ProcurementStore))throw new Error('Verified public procurement store required');
        await restrictedPaymentCapability.execute(this.procurement,input.role,{poId:c.poId,expectedHash:c.poHash},environment,now,tenantPermit);
      }
      // A successful transport return is not a financial state transition.
      this.#advance(c.caseId,pending,'BridgeReturned',{operationId:op,requiresIndependentObservation:true},`returned:${op}`,now,undefined,undefined,`restricted-${input.role}`,op);
    } catch {
      this.#advance(c.caseId,'RequiresReconciliation','OperationUncertain',{operationId:op},`uncertain:${op}`,now,undefined,undefined,`restricted-${input.role}`,op);
      throw new Error('Workflow operation requires reconciliation; no automatic retry is authorized');
    }
    return this.get(c.caseId);
  }
  /** Fresh observations only. Plain proof JSON and cached journal status cannot enter this boundary. */
  observe(caseId:string, observation:FinancialObservation, expectedVersion?:number) {
    assertCheckedObservation(observation);
    const c=this.get(caseId); const canonical=c.domain?.purchaseOrder.canonical;
    if (!canonical || observation.poId!==c.poId || observation.profileFingerprint!==this.procurement.fingerprint || observation.canonicalHash!==c.poHash)
      throw new Error('Observation/case canonical conflict');
    const before=c.vault;
    if (before && Date.parse(observation.checkedAt)<Date.parse(before.checkedAt)) throw new Error('Stale observation');
    let state:WorkflowState;
    const status=observation.payment.status;
    if (status==='Committed') state='PoCommitted';
    else if (status==='PendingApproval') state='AwaitingHumanApproval';
    else if (status==='Registering' || status==='Dispatching') state='DispatchInProgress';
    else if (status==='Paid' && canonical.destination==='Near') state='SameChainConfirmed';
    else if (status==='Dispatched' && canonical.destination!=='Near') state='SourceDispatched';
    else if (status==='Rejected') state='Rejected';
    else if (status==='Expired') state='Expired';
    else if (status==='Failed' || status==='Blocked') state='Failed';
    else throw new Error('Unsupported canonical financial transition');
    if (observation.settlement) {
      if (canonical.destination==='Near' || status!=='Dispatched' || observation.payment.attempt_id!==observation.settlement.attemptId)
        throw new Error('Settlement/vault observation conflict');
      if (observation.settlement.state==='Settled') state='DestinationSettled';
      if (observation.settlement.state==='Refunded') state='Refunded';
    }
    // Missing/invalid local operation evidence is a recovery problem, never a reason to resend.
    const operations=c.domain!.operations as {operation_key:string;state:string;evidence:string|null}[];
    for (const event of c.timeline.filter(e => e.eventType==='OperationAuthorized')) {
      if (!operations.some(op => op.operation_key===event.operationId)) throw new Error('Missing operation journal; human adjudication required');
    }
    for (const op of operations) {
      if (!['Sending','Ambiguous','Confirmed'].includes(op.state)) throw new Error('Corrupt operation journal');
      if (op.state==='Confirmed') z.object({transactionHash:z.string().min(1).nullable(),reconciled:z.boolean()}).strict().parse(JSON.parse(op.evidence!));
      else throw new Error('Unresolved operation journal; reconcile exact intent first');
    }
    if ((c.state==='CommitmentPending' || c.state==='PaymentRequestPending' || c.state==='RequiresReconciliation') && !operations.length)
      throw new Error('Missing operation journal; human adjudication required');
    if (status==='Committed' && operations.some(op => op.operation_key===`request_payment:${c.poId}`))
      throw new Error('Payment request has no canonical effect; human adjudication required');
    this.#advance(caseId,state,'VaultObserved',observation,`observation:${digest(observation)}`,new Date(observation.checkedAt),expectedVersion ?? c.version,
      undefined,`vault-observer:${observation.kind}`,c.timeline.filter(e=>e.eventType==='OperationAuthorized').at(-1)?.operationId ?? undefined);
    return this.get(caseId);
  }
  async refresh(caseId:string) {
    const c=this.get(caseId); if (!c.poId) throw new Error('No canonical PO');
    return this.observe(caseId,await observeVault(this.procurement,c.poId),c.version);
  }
  async reconcile(caseId:string, operation:'commit'|'request') {
    const c=this.get(caseId); if (!c.poId) throw new Error('No canonical PO');
    if(!(this.procurement instanceof V2ProcurementStore))throw new Error('Use dedicated Sandbox reconciliation; no automatic retry');
    await reconcileProcurement(this.procurement,{poId:c.poId,operation}); // P0: no keys/reset/resend.
    return this.refresh(caseId);
  }
  get(caseId: string) {
    const row = this.#row(caseId); const timeline = this.#history(row); const identity = Identity.parse(JSON.parse(row.identity_json));
    const domain = row.po_id ? this.procurement.inspect(row.po_id) : null;
    if (domain && (domain.canonicalHash !== row.po_hash || domain.purchaseOrder.eventId !== identity.eventId)) throw new Error('Case canonical PO conflict');
    // Cross-chain intents are keyed by attempt ID, not PO ID. Join their existing journal rows too.
    const attemptIds=domain ? (domain.settlement as {id:string}[]).map(a=>Identity.shape.caseId.parse(a.id)) : [];
    if (domain) for (const id of attemptIds) for (const method of ['commit_quote','request_crosschain']) {
      const exists=this.#db.prepare("SELECT 1 FROM sqlite_master WHERE name='backend_operations'").get();
      if (!exists) continue;
      const operation=this.#db.prepare('SELECT operation_key,state,evidence FROM backend_operations WHERE operation_key=?').get(`${method}:${id}`);
      if (operation) domain.operations.push(operation);
    }
    const inventory = row.state === 'Opened' ? null : this.procurement.eventSnapshot(identity.eventId);
    const vaultEvent=timeline.filter(e => e.eventType==='VaultObserved').at(-1);
    const vault=vaultEvent ? Observation.parse(vaultEvent.evidence) : null;
    if (vault && (vault.poId!==row.po_id || vault.canonicalHash!==row.po_hash || vault.profileFingerprint!==this.procurement.fingerprint))
      throw new Error('Corrupt saved vault evidence');
    const action=nextAction(row.state,domain?.purchaseOrder.canonical.destination !== 'Near');
    const humanInterventions=['AuthorizeCommitment','AuthorizePaymentRequest','HumanCrossChainReview','HumanWalletReview','ReadOnlyReconciliation'].includes(action) ? [action] : [];
    if (vault?.settlement?.state==='Refunded' && !vault.settlement.fullRefund) humanInterventions.push('ReviewPartialRefund');
    return { ...identity,state:row.state,version:row.version,poId:row.po_id,poHash:row.po_hash,createdAt:row.created_at,updatedAt:row.updated_at,
      nextAction:action, humanInterventions,domain,inventory,timeline,
      operationIds:domain ? [`commit_purchase_order:${row.po_id}`,...(domain.purchaseOrder.canonical.destination==='Near'
        ? [`request_payment:${row.po_id}`] : attemptIds.flatMap(id=>[`commit_quote:${id}`,`request_crosschain:${id}`]))] : [],
      paymentState:vault?.payment.status ?? 'Unobserved',vault,settlement:vault?.settlement ?? null,evidenceKind:vault?.kind ?? 'local-only' };
  }
  list() { return (this.#db.prepare('SELECT case_id FROM replenishment_cases ORDER BY created_at,case_id').all() as {case_id:string}[]).map(r => this.get(r.case_id)); }
  page(raw:unknown) {
    const p=z.object({filter:z.enum(['all','active','attention']).default('all'),limit:z.number().int().min(1).max(50).default(20),
      offset:z.number().int().min(0).max(10000).default(0)}).strict().parse(raw);
    const states=p.filter==='active' ? WorkflowState.options.filter(s=>!terminal.has(s)) : p.filter==='attention'
      ? ['PoDrafted','PoCommitted','CommitmentPending','PaymentRequestPending','AwaitingHumanApproval','RequiresReconciliation'] : [];
    const where=states.length?`WHERE state IN (${states.map(()=>'?').join(',')})`:'';
    const rows=this.#db.prepare(`SELECT case_id FROM replenishment_cases ${where} ORDER BY created_at,case_id LIMIT ? OFFSET ?`)
      .all(...states,p.limit,p.offset) as {case_id:string}[];
    const total=this.#db.prepare(`SELECT count(*) FROM replenishment_cases ${where}`).pluck().get(...states) as number;
    return {cases:rows.map(r=>this.get(r.case_id)),total,limit:p.limit,offset:p.offset,
      nextOffset:p.offset+rows.length<total?p.offset+rows.length:null};
  }
  caseForEvent(eventId:string) {
    Identity.shape.eventId.parse(eventId);
    const row=this.#db.prepare('SELECT case_id FROM replenishment_cases WHERE event_id=?').get(eventId) as {case_id:string}|undefined;
    return row?this.get(row.case_id):null;
  }
  /** Nonfinancial annotations only: models cannot supply state, payment status, terms or arbitrary evidence. */
  recordAgentEvent(caseId:string,raw:unknown,now=new Date()) {
    const p=z.object({runId:z.uuid(),type:z.enum(['ManualAgentRunRequested','AgentRunStarted','AgentProposedAction','AgentRunCompleted','AgentRunFailed','AgentRunInterrupted']),
      execution:z.enum(['live-provider','mocked-provider','deterministic']),action:z.string().regex(/^[A-Za-z]{1,64}$/).optional()}).strict().parse(raw);
    const c=this.get(caseId);
    if(p.type==='AgentProposedAction'&&p.action!==c.nextAction)throw new Error('Proposal differs from permitted workflow action');
    this.#advance(caseId,c.state,p.type,p,`agent:${p.runId}:${p.type}`,now,c.version,undefined,p.type==='ManualAgentRunRequested'?'operator':'procurement-agent');
    return this.get(caseId);
  }
  projection(now=new Date()) { return {format:'carecart-workflow-v1' as const,dataOrigin:'synthetic' as const,
    generatedAt:now.toISOString(),profileFingerprint:this.procurement.fingerprint,cases:this.list(),
    notice:'Read-only saved workflow export. Revalidate canonical state before any authorized operation; this file is not a payment proof.'}; }
}
