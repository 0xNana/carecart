import Database from 'better-sqlite3';
import { z } from 'zod';
import { chmodSync } from 'node:fs';
import { digest } from '../intents/settlement';
import {Movement,Autonomy,Products,OrderLink,type Product,type TenantBinding} from './model';
import {migrateInventory} from './migrations';
export {Movement,Autonomy,type Product,type TenantBinding} from './model';
export const gloves: Product = { id: 'mn-item-1', clinicId: 'synthetic-clinic', storeroomId: 'main-storeroom', sku: 'GLOVES-BOX', name: 'Medical gloves (synthetic)', baseUnit: 'box', packSize: 10, baselineDailyDemand: 4, leadTimeDays: 5, safetyStock: 8, targetStock: 48, source: 'synthetic' };
type Stored = z.infer<typeof Movement> & {
    baseQuantity: number;
    actor: string;
    timestamp: string;
    allocations: {
        lotId: string;
        quantity: number;
    }[];
    previousHash: string | null;
};
const stockUp = new Set(['Opening', 'Receive', 'AdjustUp']);
const stockDown = new Set(['Consume', 'Dispense', 'AdjustDown', 'Expire', 'Unusable']);
export class InventoryLedger {
    readonly db: Database.Database;
    #trustedCatalog:unknown;
    constructor(readonly path: string, readonly fingerprint: string, readonly products: Product[] = [gloves], readonly clock = () => Date.now(), connection?: Database.Database,readonly tenant?:TenantBinding) {
        this.db = connection ?? new Database(path);
        this.db.pragma('busy_timeout=3000');
        this.db.pragma('journal_mode=WAL');
        this.db.pragma('synchronous=FULL');
        chmodSync(path, 0o600);
        try {
            Products.parse(products);
            migrateInventory(this.db,fingerprint,products,clock,tenant);
        }
        catch (e) {
            this.db.close();
            throw e;
        }
    }
    close() { if (this.db.open)
        this.db.close(); }
    product(productId: string) {
        const trusted = this.products.find(p => p.id === productId);
        const row = this.db.prepare('SELECT body_json FROM inventory_products WHERE id=?').get(productId) as {
            body_json: string;
        } | undefined;
        if (!trusted || !row || digest(JSON.parse(row.body_json)) !== digest(trusted))
            throw new Error('Unknown or changed registered product');
        return structuredClone(trusted);
    }
    history(productId: string) {
        this.product(productId);
        let previousHash: string | null = null;
        return (this.db.prepare('SELECT body_json,body_hash FROM inventory_movements WHERE product_id=? ORDER BY seq').all(productId) as {
            body_json: string;
            body_hash: string;
        }[]).map(row => {
            const body = JSON.parse(row.body_json) as Stored;
            if (digest(body) !== row.body_hash || body.previousHash !== previousHash || body.productId !== productId)
                throw new Error('Corrupt inventory movement evidence');
            previousHash = row.body_hash;
            return body;
        });
    }
    effectiveQuantities(history: Stored[]) {
        const effective=new Map(history.map(m=>[m.id,m.baseQuantity]));
        for(const m of [...history].reverse())if(m.corrects)effective.set(m.corrects,effective.get(m.corrects)!-effective.get(m.id)!);
        return effective;
    }
    registerOrderLink(raw:unknown,actor:string) {
        const link=OrderLink.parse(raw);this.product(link.productId);
        if(!actor||actor.length>100)throw new Error('Inventory actor required');
        return this.db.transaction(()=>{
            const prior=this.db.prepare('SELECT product_id,case_id,quantity,canonical_hash FROM inventory_order_links WHERE order_id=?').get(link.orderId) as {product_id:string;case_id:string;quantity:number;canonical_hash:string}|undefined;
            if(prior){if(prior.product_id!==link.productId||prior.case_id!==link.caseId||prior.quantity!==link.quantity||prior.canonical_hash!==link.canonicalHash)throw new Error('Conflicting canonical inventory order link');return link;}
            const old=this.history(link.productId).find(m=>m.kind==='ConfirmInbound'&&m.orderId===link.orderId);
            if(old&&old.baseQuantity!==link.quantity)throw new Error('Legacy inbound/canonical quantity conflict');
            this.db.prepare('INSERT INTO inventory_order_links VALUES(?,?,?,?,?)').run(link.orderId,link.productId,link.caseId,link.quantity,link.canonicalHash);
            this.audit('OrderProposalLinked',link,actor);return link;
        }).immediate();
    }
    delivery(orderId:string) {
        const link=this.db.prepare('SELECT product_id,case_id,quantity,canonical_hash FROM inventory_order_links WHERE order_id=?').get(orderId) as {product_id:string;case_id:string;quantity:number;canonical_hash:string}|undefined;
        const old=this.db.prepare("SELECT product_id FROM inventory_movements WHERE order_id=? AND kind='ConfirmInbound' ORDER BY seq LIMIT 1").get(orderId) as {product_id:string}|undefined;
        if(!link&&!old)throw new Error('Unknown inventory order');
        const productId=link?.product_id??old!.product_id;const history=this.history(productId);const effective=this.effectiveQuantities(history);
        const confirmations=history.filter(m=>m.kind==='ConfirmInbound'&&m.orderId===orderId);
        const expected=link?.quantity??confirmations[0].baseQuantity;
        const confirmed=confirmations.find(m=>!!m.confirmationReference&&!!m.confirmedAt);
        const received=history.filter(m=>m.kind==='Receive'&&m.orderId===orderId).reduce((n,m)=>n+effective.get(m.id)!,0);
        const cancelled=history.filter(m=>m.kind==='CancelInbound'&&m.orderId===orderId).reduce((n,m)=>n+m.baseQuantity,0);
        const remaining=expected-received-cancelled;
        if(!Number.isSafeInteger(remaining)||remaining<0)throw new Error('Invalid inventory delivery evidence');
        return {orderId,productId,caseId:link?.case_id??null,canonicalHash:link?.canonical_hash??null,expected,received,cancelled,remaining,
            confirmedIncoming:confirmed?remaining:0,unverifiedIncoming:!confirmed&&confirmations.length?remaining:0,
            confirmationReference:confirmed?.confirmationReference??null,confirmedAt:confirmed?.confirmedAt??null};
    }
    balance(productId: string) {
        let onHand=0,reserved=0;
        const lots=new Map<string,{quantity:number;expiresAt:string|null;receivedAt:string;receiptReference:string|null}>();
        const history=this.history(productId);
        for(const m of history){
            if(stockUp.has(m.kind)){onHand+=m.baseQuantity;lots.set(m.id,{quantity:m.baseQuantity,expiresAt:m.expiresAt??null,receivedAt:m.timestamp,receiptReference:m.receiptReference??null});}
            if(stockDown.has(m.kind)){
                onHand-=m.baseQuantity;
                if(m.allocations.reduce((n,a)=>n+a.quantity,0)!==m.baseQuantity)throw new Error('Invalid lot allocation total');
                for(const a of m.allocations){const lot=lots.get(a.lotId);if(!lot||lot.quantity<a.quantity)throw new Error('Invalid lot evidence');lot.quantity-=a.quantity;}
            }
            if(m.kind==='Reserve')reserved+=m.baseQuantity;
            if(m.kind==='Release')reserved-=m.baseQuantity;
            if([onHand,reserved].some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Impossible inventory balance evidence');
        }
        const expired=[...lots.values()].filter(l=>l.expiresAt&&Date.parse(l.expiresAt)<=this.clock()).reduce((n,l)=>n+l.quantity,0);
        const linked=this.db.prepare('SELECT order_id FROM inventory_order_links WHERE product_id=?').all(productId) as {order_id:string}[];
        const ids=new Set([...linked.map(o=>o.order_id),...history.filter(m=>m.orderId).map(m=>m.orderId!)]);
        const deliveries=[...ids].map(order=>this.delivery(order));const orders=new Map(deliveries.map(d=>[d.orderId,d.remaining]));
        const incoming=deliveries.reduce((n,d)=>n+d.confirmedIncoming,0),unverifiedIncoming=deliveries.reduce((n,d)=>n+d.unverifiedIncoming,0);
        const usableOnHand=onHand-expired,available=Math.max(0,usableOnHand-reserved),backorders=Math.max(0,reserved-usableOnHand);
        // Reservations already include committed demand. Backorders are explanatory, never subtracted twice.
        const inventoryPosition=usableOnHand-reserved+incoming;
        if(!Number.isSafeInteger(inventoryPosition)||!Number.isSafeInteger(incoming))throw new Error('Inventory accounting overflow');
        return {onHand,usableOnHand,reserved,available,incoming,unverifiedIncoming,backorders,inventoryPosition,expired,lots,orders};
    }
    #move(input: z.infer<typeof Movement>, actor: string) {
        const p = this.product(input.productId);
        const prior = this.db.prepare('SELECT body_json FROM inventory_movements WHERE id=?').get(input.id) as {
            body_json: string;
        } | undefined;
        if (prior) {
            const { baseQuantity: _q, actor: _a, timestamp: _t, allocations: _al, previousHash: _p, ...original } = JSON.parse(prior.body_json) as Stored;
            if (digest(original) !== digest(input))
                throw new Error('Conflicting movement ID');
            return JSON.parse(prior.body_json) as Stored;
        }
        if (input.kind === 'Dispense' && !input.destination)throw new Error('Dispensing department or purpose required');
        if(input.receivedAt && (input.kind!=='Receive'||Date.parse(input.receivedAt)>this.clock()))throw new Error('A nonfuture physical receiving date is required');
        if (input.kind === 'Receive' && !input.receiptReference)throw new Error('Physical receipt reference required');
        if(input.kind==='ConfirmInbound'&&(!input.confirmationReference||!input.confirmedAt||Date.parse(input.confirmedAt)>this.clock()))throw new Error('Explicit nonfuture supplier/order confirmation evidence required');
        if (input.kind === 'Opening' && actor !== 'synthetic-seed')
            throw new Error('Opening stock is provisioned once');
        if (['AdjustUp', 'AdjustDown'].includes(input.kind) && !input.reason)
            throw new Error('Adjustment reason required');
        if (input.corrects && !this.db.prepare('SELECT 1 FROM inventory_movements WHERE id=? AND product_id=?').get(input.corrects, p.id))
            throw new Error('Unknown correction target');
        const n = BigInt(input.quantity) * BigInt(input.unit === 'pack' ? p.packSize : 1);
        if (n > 1000000n)
            throw new Error('Invalid stock conversion');
        const quantity = Number(n);
        let correctionLot:string|undefined;
        if (input.corrects) {
            const history=this.history(p.id);const original=history.find(m=>m.id===input.corrects)!;
            const inverse=stockDown.has(original.kind)?'AdjustUp':stockUp.has(original.kind)?'AdjustDown':null;
            if(input.kind!==inverse||quantity>this.effectiveQuantities(history).get(original.id)!)throw new Error('Invalid or excessive compensating movement');
            if(stockUp.has(original.kind)){
                correctionLot=original.id;if(input.lotId&&input.lotId!==correctionLot)throw new Error('Correction must use its original batch');
            }else{
                const expiries=original.allocations.map(a=>history.find(m=>m.id===a.lotId)?.expiresAt).filter((date):date is string=>!!date).sort();
                if(expiries.length&&input.expiresAt!==expiries[0])throw new Error('Correction must preserve the earliest original batch expiry');
            }
        }
        const b = this.balance(p.id);
        if (['ConfirmInbound', 'CancelInbound'].includes(input.kind) && !input.orderId)
            throw new Error('Inbound PO reference required');
        if (input.kind === 'Reserve' && quantity > b.available || input.kind === 'Release' && quantity > b.reserved)
            throw new Error('Impossible reservation');
        if(input.kind==='CancelInbound'||input.kind==='Receive'&&input.orderId){
            const delivery=this.delivery(input.orderId!);if(delivery.productId!==p.id||quantity>delivery.remaining)throw new Error('Receipt/cancellation exceeds outstanding delivery');
        }
        if(input.kind==='ConfirmInbound'){
            const confirmations=this.history(p.id).filter(m=>m.kind==='ConfirmInbound'&&m.orderId===input.orderId);
            if(confirmations.some(m=>!!m.confirmationReference))throw new Error('Inbound order already confirmed');
            if(confirmations.length&&confirmations[0].baseQuantity!==quantity)throw new Error('Legacy inbound quantity conflict');
            const link=this.db.prepare('SELECT product_id,quantity FROM inventory_order_links WHERE order_id=?').get(input.orderId) as {product_id:string;quantity:number}|undefined;
            if(!link||link.product_id!==p.id||link.quantity!==quantity)throw new Error('Inbound canonical order link required');
        }
        const allocations: Stored['allocations'] = [];
        if (stockDown.has(input.kind)) {
            if (quantity > (input.kind === 'Expire' ? b.expired : b.available))
                throw new Error('Insufficient available stock');
            let left = quantity;
            const lots = [...b.lots.entries()].sort((a, b) => (a[1].expiresAt ?? '9999').localeCompare(b[1].expiresAt ?? '9999') || a[0].localeCompare(b[0]));
            for (const [lotId, lot] of lots) {
                if ((input.lotId??correctionLot) && (input.lotId??correctionLot) !== lotId)
                    continue;
                const expired=!!lot.expiresAt&&Date.parse(lot.expiresAt)<=this.clock();
                if ((input.kind==='Expire'&&!expired)||(input.kind!=='Expire'&&expired))continue;
                const used = Math.min(left, lot.quantity);
                if (used) {
                    allocations.push({ lotId, quantity: used });
                    left -= used;
                }
                if (!left)
                    break;
            }
            if (left)
                throw new Error('Unavailable stock lot');
        }
        if (input.kind === 'Expire' && actor !== 'expiry-monitor')
            throw new Error('Expiry is derived by the monitor');
        const history = this.history(p.id);
        const body: Stored = { ...input, baseQuantity: quantity, actor, timestamp: new Date(this.clock()).toISOString(), allocations, previousHash: history.length ? digest(history.at(-1)) : null };
        this.db.prepare('INSERT INTO inventory_movements(id,product_id,kind,order_id,body_json,body_hash,receipt_reference) VALUES(?,?,?,?,?,?,?)').run(body.id, p.id, body.kind, body.orderId ?? null, JSON.stringify(body), digest(body),body.receiptReference??null);
        this.balance(p.id);
        this.db.prepare('UPDATE inventory_jobs SET next_due=?,generation=generation+1 WHERE product_id=?').run(this.clock(), p.id);
        return body;
    }
    move(raw: unknown, actor: string) {
        const input = Movement.parse(raw);
        if (!actor || actor.length > 100)
            throw new Error('Inventory actor required');
        return this.db.transaction(() => this.#move(input, actor)).immediate();
    }
    expire(productId: string) {
        return this.db.transaction(() => {
            const b = this.balance(productId);
            for (const [lotId, lot] of b.lots)
                if (lot.quantity && lot.expiresAt && Date.parse(lot.expiresAt) <= this.clock())
                    this.#move({ id: 'expiry-' + digest([productId, lotId]).slice(0, 48), productId, kind: 'Expire', quantity: lot.quantity, unit: 'base', lotId, source: 'synthetic' }, 'expiry-monitor');
        }).immediate();
    }
    forecast(productId: string) {
        const p = this.product(productId);
        const b = this.balance(productId);
        const now = this.clock();
        const all=this.history(productId);
        const effective=this.effectiveQuantities(all);
        const history = all.filter(m => ['Consume','Dispense'].includes(m.kind) && Date.parse(m.timestamp) > now - 30 * 86400000)
            .map(m=>({...m,baseQuantity:effective.get(m.id)!}))
            .filter(m=>m.baseQuantity>0);
        const days = new Set(history.map(m => m.timestamp.slice(0, 10)));
        const span = history.length ? Math.max(1, Math.ceil((now - Date.parse(history[0].timestamp)) / 86400000)) : 0;
        const observed = days.size >= 3 && span >= 7;
        const observedConsumptionUnits=history.reduce((n,m)=>n+m.baseQuantity,0);
        const daily = observed ? Math.ceil(observedConsumptionUnits / Math.min(span, 30)) : p.baselineDailyDemand;
        const leadTimeDemand = daily * p.leadTimeDays;
        const reorderPoint = leadTimeDemand + p.safetyStock;
        const target = Math.max(p.targetStock, reorderPoint);
        return { basis: observed ? 'consumption-history' : 'configured-baseline', windowDays: 30, observedDays: days.size, observedConsumptionUnits, dailyDemand: daily, leadTimeDays: p.leadTimeDays, safetyStock: p.safetyStock, leadTimeDemand, reorderPoint, targetStock: target,
            inventoryPosition: b.inventoryPosition, shortage: b.inventoryPosition < reorderPoint, recommendedQuantity: Math.max(0, target - b.inventoryPosition), daysOfSupply: daily ? b.available / daily : null };
    }
    catalogDefinition(){return this.#trustedCatalog===undefined?undefined:structuredClone(this.#trustedCatalog);}
    registerCatalog(definition:unknown,actor:string,refresh=false){
        this.#trustedCatalog=structuredClone(definition);
        this.db.transaction(()=>{
            const existing=this.db.prepare("SELECT 1 FROM inventory_sources WHERE id='supplier-catalog'").get();
            const initialized=this.db.prepare("SELECT 1 FROM inventory_audit WHERE json_extract(body_json,'$.type')='SyntheticCatalogSnapshot' LIMIT 1").get();
            if(!refresh&&(existing||initialized))return;
            const body={definition,observedAt:this.clock(),source:'synthetic'};
            this.db.prepare("INSERT INTO inventory_sources VALUES('supplier-catalog',?,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,body_json=excluded.body_json,body_hash=excluded.body_hash").run(body.observedAt,JSON.stringify(body),digest(body));
            this.audit('SyntheticCatalogSnapshot',{observedAt:body.observedAt,definitionHash:digest(definition)},actor);
            this.db.prepare('UPDATE inventory_jobs SET next_due=?,generation=generation+1').run(this.clock());
        }).immediate();
    }
    refreshCatalog(actor:string){if(this.#trustedCatalog===undefined)throw new Error('Trusted supplier catalog unavailable');this.registerCatalog(this.#trustedCatalog,actor,true);return this.catalogInfo();}
    catalogInfo(){
        const row=this.db.prepare("SELECT observed_at,body_json,body_hash FROM inventory_sources WHERE id='supplier-catalog'").get() as {observed_at:number;body_json:string;body_hash:string}|undefined;
        if(!row)throw new Error('Supplier catalog snapshot missing; explicitly refresh the synthetic catalog');
        const body=JSON.parse(row.body_json) as {definition:unknown;observedAt:number};
        if(digest(body)!==row.body_hash||body.observedAt!==row.observed_at||this.#trustedCatalog===undefined||digest(body.definition)!==digest(this.#trustedCatalog))throw new Error('Supplier catalog evidence invalid');
        return {observedAt:body.observedAt,definitionHash:digest(body.definition),source:'synthetic' as const};
    }
    freshness(productId:string){
        const history=this.history(productId),config=this.config();const last=history.filter(m=>['Opening','Receive','Consume','Dispense','AdjustUp','AdjustDown','Unusable'].includes(m.kind)).at(-1)?.timestamp??null;
        const age=last?(this.clock()-Date.parse(last))/1000:null;const issues:string[]=[];
        if(age===null||age<0||age>config.maxInventoryAgeSeconds)issues.push('Inventory inputs stale or unavailable; validate a stock count or receipt');
        let catalogObservedAt:number|null=null;let catalogAgeSeconds:number|null=null;
        try{const c=this.catalogInfo();catalogObservedAt=c.observedAt;catalogAgeSeconds=(this.clock()-c.observedAt)/1000;
            if(catalogAgeSeconds<0||catalogAgeSeconds>config.maxCatalogAgeSeconds)issues.push('Supplier catalog stale; refresh the trusted synthetic snapshot');
        }catch(error){issues.push(error instanceof Error?error.message:'Supplier catalog unavailable');}
        return {lastMovementAt:last,inventoryAgeSeconds:age,catalogObservedAt,catalogAgeSeconds,issues};
    }
    heartbeat(worker:string,phase:string,error:string|null=null){
        if(!/^[A-Za-z0-9_-]{1,64}$/.test(worker)||!['Running','Idle','Stopped'].includes(phase))throw new Error('Invalid worker heartbeat');
        this.db.prepare('INSERT INTO inventory_worker_heartbeats VALUES(?,?,?,?,?) ON CONFLICT(worker) DO UPDATE SET last_seen=excluded.last_seen,phase=excluded.phase,error=excluded.error').run(worker,this.clock(),this.clock(),phase,error?.slice(0,180)??null);
    }
    workerHealth(){
        const workers=this.db.prepare('SELECT worker,started_at AS startedAt,last_seen AS lastSeen,phase,error FROM inventory_worker_heartbeats ORDER BY last_seen DESC LIMIT 30').all() as {worker:string;startedAt:number;lastSeen:number;phase:string;error:string|null}[];
        const active=workers.find(w=>w.phase!=='Stopped');const last=active??workers[0];
        const timestamp=this.db.prepare("SELECT MAX(completed_at) AS timestamp FROM inventory_monitor_runs WHERE state='Completed'").get() as {timestamp:number|null};
        return {status:!last?'unobserved':!active?'stopped':this.clock()-active.lastSeen>10000?'stale':'healthy',lastSeenAt:last?new Date(last.lastSeen).toISOString():null,
            lastSuccessfulEvaluation:timestamp.timestamp===null?null:new Date(timestamp.timestamp).toISOString(),workers};
    }
    config() { return Autonomy.parse(JSON.parse((this.db.prepare('SELECT body_json FROM inventory_autonomy WHERE id=1').get() as {
        body_json: string;
    }).body_json)); }
    configure(raw: unknown, actor: string) {
        const config = Autonomy.parse(raw);
        this.db.transaction(() => {
            this.db.prepare('UPDATE inventory_autonomy SET body_json=? WHERE id=1').run(JSON.stringify(config));
            this.audit('AutonomyConfigured', { config }, actor);
            this.db.prepare('UPDATE inventory_jobs SET next_due=?,generation=generation+1').run(this.clock());
            this.db.prepare('DELETE FROM inventory_job_failures').run();
        }).immediate();
        return config;
    }
    audit(type: string, evidence: unknown, actor: string) { const body = { type, evidence, actor, timestamp: new Date(this.clock()).toISOString() }; this.db.prepare('INSERT INTO inventory_audit(body_json,body_hash) VALUES(?,?)').run(JSON.stringify(body), digest(body)); }
    evaluation(eventId: string, itemId: string) {
        const row = this.db.prepare('SELECT body_json,body_hash FROM inventory_evaluations WHERE event_id=? AND product_id=?').get(eventId, itemId) as {
            body_json: string;
            body_hash: string;
        } | undefined;
        if (!row || digest(JSON.parse(row.body_json)) !== row.body_hash)
            throw new Error('Missing/corrupt inventory evaluation');
        return JSON.parse(row.body_json) as ReturnType<InventoryLedger['forecast']> & {
            issuedAt: string;
            movementHash: string;
        };
    }
    dashboard() {
        const items = this.products.map(p => { const { lots: _lots, orders: _orders, ...balance } = this.balance(p.id); return { ...this.product(p.id), balance, forecast: this.forecast(p.id), freshness:this.freshness(p.id),batches:[..._lots.entries()].map(([id,lot])=>({id,...lot})), movements: this.history(p.id).slice(-50) }; });
        return { tenant:this.tenant??null,workerHealth:this.workerHealth(),readAt:new Date(this.clock()).toISOString(), deliveries:(this.db.prepare('SELECT order_id FROM inventory_order_links').all() as {order_id:string}[]).map(o=>this.delivery(o.order_id)),audit:(this.db.prepare('SELECT seq,body_json FROM inventory_audit ORDER BY seq DESC LIMIT 100').all() as {seq:number;body_json:string}[]).map(r=>({id:r.seq,...JSON.parse(r.body_json)})),dataOrigin: 'synthetic' as const, financialExecution: false as const, config: this.config(), trackedSkus: items.length, lowStock: items.filter(i => i.forecast.shortage).length, criticalStock: items.filter(i => i.balance.available < i.forecast.dailyDemand * i.leadTimeDays).length, items,
            obligations: this.db.prepare('SELECT id,product_id AS productId,event_id AS eventId,case_id AS caseId,closed_at AS closedAt FROM inventory_obligations ORDER BY rowid DESC LIMIT 100').all() as {
                id: string;
                productId: string;
                eventId: string;
                caseId: string;
                closedAt: number | null;
            }[],
            jobs: this.db.prepare('SELECT j.product_id AS productId,next_due AS nextDue,lease_owner AS leaseOwner,lease_until AS leaseUntil,COALESCE(f.failures,0) AS failures FROM inventory_jobs j LEFT JOIN inventory_job_failures f ON f.product_id=j.product_id').all(),
            runs: this.db.prepare('SELECT id,product_id AS productId,worker,state,started_at AS startedAt,completed_at AS completedAt,evidence_json AS evidence,error FROM inventory_monitor_runs ORDER BY started_at DESC LIMIT 30').all() };
    }
}
