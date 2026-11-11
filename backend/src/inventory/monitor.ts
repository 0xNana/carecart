import { randomUUID } from 'node:crypto';
import { digest } from '../intents/settlement';
import { InventoryLedger } from './ledger';
import { ReplenishmentWorkflow } from '../workflow/cases';
type Job = {
    product_id: string;
    generation: number;
    lease_token: string;
};
/** No signer, RPC client, model or financial retry exists in this worker. */
export class InventoryMonitor {
    constructor(readonly inventory: InventoryLedger, readonly workflow: ReplenishmentWorkflow) { if (inventory.path !== workflow.procurement.profile.databasePath || inventory.fingerprint !== workflow.procurement.fingerprint)
        throw new Error('Inventory/workflow binding mismatch'); }
    claim(worker: string) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(worker))
            throw new Error('Invalid worker identity');
        const l = this.inventory;
        const now = l.clock();
        return l.db.transaction(() => {
            if (!l.config().monitoring)
                return null;
            const row = l.db.prepare('SELECT product_id,generation FROM inventory_jobs WHERE next_due<=? AND (lease_until IS NULL OR lease_until<=?) AND product_id NOT IN (SELECT product_id FROM inventory_job_failures WHERE failures>=3) ORDER BY next_due,product_id LIMIT 1').get(now, now) as Omit<Job, 'lease_token'> | undefined;
            if (!row)
                return null;
            const token = randomUUID();
            l.db.prepare("UPDATE inventory_monitor_runs SET state='Interrupted',completed_at=?,error='Lease expired; resume durable obligation, never financial retry' WHERE product_id=? AND state='Running'").run(now, row.product_id);
            l.db.prepare('UPDATE inventory_jobs SET lease_owner=?,lease_until=?,lease_token=? WHERE product_id=?').run(worker, now + 30000, token, row.product_id);
            l.db.prepare("INSERT INTO inventory_monitor_runs VALUES(?,?,?,'Running',?,NULL,NULL,NULL)").run(token, row.product_id, worker, now);
            return { ...row, lease_token: token };
        }).immediate();
    }
    runOnce(worker: string, afterObligation?: () => void) { const job = this.claim(worker); if (!job)
        return null; return this.execute(job, afterObligation); }
    execute(job: Job, afterObligation?: () => void) {
        const l = this.inventory;
        let evidence: unknown = null;
        let error: string | null = null;
        try {
            // A single synchronous transaction on the inventory connection fences lease changes.
            // Workflow uses its own connection, so it runs AFTER this transaction commits.
            const obligation = l.db.transaction(() => {
                const current = l.db.prepare('SELECT lease_token,lease_until FROM inventory_jobs WHERE product_id=?').get(job.product_id) as {
                    lease_token: string;
                    lease_until: number;
                };
                if (current.lease_token !== job.lease_token || current.lease_until <= l.clock())
                    throw new Error('Worker lease lost');
                l.expire(job.product_id);
                const forecast = l.forecast(job.product_id);
                const config = l.config();
                const freshness=l.freshness(job.product_id);
                const catalog=this.workflow.procurement.registeredCatalog?.();
                if(!catalog||!catalog.suppliers.length||!catalog.entries.some(e=>e.itemId===job.product_id))freshness.issues.push('Approved supplier catalog unavailable');
                const event='stock-'+job.lease_token;
                const snapshot={...forecast,issuedAt:new Date(l.clock()).toISOString(),movementHash:digest(l.history(job.product_id)),
                    inputs:l.product(job.product_id),freshness,catalogFingerprint:l.catalogDefinition()===undefined?null:digest(l.catalogDefinition())};
                l.db.prepare('INSERT INTO inventory_evaluations VALUES(?,?,?,?)').run(event,job.product_id,JSON.stringify(snapshot),digest(snapshot));
                evidence={forecast,freshness,eventId:event,financialExecution:false};
                // Persist failed freshness evaluations as well; no obligation is created from them.
                if(freshness.issues.length)return {blocked:freshness.issues.join('; ')};
                const closed=l.db.prepare('SELECT o.case_id,c.po_id FROM inventory_obligations o JOIN replenishment_cases c ON c.case_id=o.case_id WHERE o.product_id=? AND o.closed_at IS NOT NULL').all(job.product_id) as {case_id:string;po_id:string|null}[];
                for(const old of closed)if(old.po_id&&l.delivery(old.po_id).remaining>0)throw new Error('Delivery correction requires reconciliation before another replenishment');
                let active = l.db.prepare('SELECT id,event_id,case_id FROM inventory_obligations WHERE product_id=? AND closed_at IS NULL').get(job.product_id) as {
                    id: string;
                    event_id: string;
                    case_id: string;
                } | undefined;
                if (active) {
                    // Payment never counts as goods receipt. Only physical receiving movements can close an obligation.
                    const po = l.db.prepare('SELECT po_id FROM replenishment_cases WHERE case_id=?').get(active.case_id) as {
                        po_id: string | null;
                    } | undefined;
                    if (po?.po_id) {
                        const c=this.workflow.get(active.case_id);
                        l.registerOrderLink({orderId:po.po_id,productId:job.product_id,caseId:c.caseId,quantity:c.domain!.quote.quantity,canonicalHash:c.poHash!},'inventory-monitor');
                        const receipts = l.delivery(po.po_id).received;
                        const quantity = this.workflow.procurement.inspect(po.po_id).quote.quantity;
                        if (receipts >= quantity && !forecast.shortage) {
                            l.db.prepare('UPDATE inventory_obligations SET closed_at=? WHERE id=?').run(l.clock(), active.id);
                            active = undefined;
                        }
                    }
                }
                if (!active && forecast.shortage && config.automaticCases) {
                    active = { id: event, event_id: event, case_id: 'case-' + digest([l.fingerprint, event]).slice(0, 48) };
                    l.db.prepare('INSERT INTO inventory_obligations VALUES(?,?,?,?,NULL)').run(active.id, job.product_id, event, active.case_id);
                }
                evidence = { forecast, obligation: active ?? null, financialExecution: false };
                l.audit('InventoryEvaluated', evidence, 'inventory-monitor');
                return active;
            }).immediate();
            if(obligation&&'blocked' in obligation)throw new Error(obligation.blocked);
            afterObligation?.(); // deterministic crash-injection point in local tests
            const fence = l.db.prepare('SELECT lease_token,lease_until FROM inventory_jobs WHERE product_id=?').get(job.product_id) as {
                lease_token: string;
                lease_until: number;
            };
            if (fence.lease_token !== job.lease_token || fence.lease_until <= l.clock())
                throw new Error('Worker lease lost');
            if (obligation) {
                const now = new Date(l.clock());
                this.workflow.open({ caseId: obligation.case_id, eventId: obligation.event_id, idempotencyKey: obligation.event_id, itemId: job.product_id }, now);
                if (l.config().automaticPreparation){
                    const c=this.workflow.prepare(obligation.case_id, now);
                    if(c.poId&&c.poHash)l.registerOrderLink({orderId:c.poId,productId:job.product_id,caseId:c.caseId,quantity:c.domain!.quote.quantity,canonicalHash:c.poHash},'inventory-monitor');
                }
            }
        }
        catch (e) {
            error = e instanceof Error ? e.message.slice(0, 180) : 'Inventory evaluation failed';
        }
        return l.db.transaction(() => {
            const current = l.db.prepare('SELECT lease_token,generation FROM inventory_jobs WHERE product_id=?').get(job.product_id) as {
                lease_token: string;
                generation: number;
            };
            if (current.lease_token !== job.lease_token)
                throw new Error('Worker lease lost; stale completion refused');
            const state = error ? 'Failed' : 'Completed';
            if(error)l.audit('InventoryEvaluationFailed',{productId:job.product_id,runId:job.lease_token,error},'inventory-monitor');
            l.db.prepare('UPDATE inventory_monitor_runs SET state=?,completed_at=?,evidence_json=?,error=? WHERE id=?').run(state, l.clock(), JSON.stringify(evidence), error, job.lease_token);
            if (error)
                l.db.prepare('INSERT INTO inventory_job_failures VALUES(?,1) ON CONFLICT(product_id) DO UPDATE SET failures=failures+1').run(job.product_id);
            else
                l.db.prepare('DELETE FROM inventory_job_failures WHERE product_id=?').run(job.product_id);
            l.db.prepare('UPDATE inventory_jobs SET next_due=?,lease_owner=NULL,lease_until=NULL,lease_token=NULL WHERE product_id=?').run(current.generation === job.generation ? l.clock() + l.config().intervalSeconds * 1000 : l.clock(), job.product_id);
            return { id: job.lease_token, state, error, evidence };
        }).immediate();
    }
}
