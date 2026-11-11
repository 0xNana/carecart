export interface StockMovement {
    id: string;
    productId: string;
    kind: string;
    quantity: number;
    baseQuantity: number;
    unit: string;
    source: string;
    orderId?: string;
    timestamp: string;
    actor: string;
    reason?: string;
    corrects?: string;
    receiptReference?: string;
    supplierId?: string;
    batch?: string;
    receivedAt?: string;
    destination?: string;
    reference?: string;
    confirmationReference?: string;
}
export interface AutonomyConfig {
    monitoring: boolean;
    automaticCases: boolean;
    automaticPreparation: boolean;
    financialExecution: false;
    intervalSeconds: number;
    maxInventoryAgeSeconds?: number;
    maxCatalogAgeSeconds?: number;
}
export interface StockDashboard {
    tenant?: {clinicId:string;syntheticDemo:boolean}|null;
    dataOrigin: 'synthetic';
    financialExecution: false;
    profileFingerprint: string;
    config: AutonomyConfig;
    readAt?: string;
    workerHealth?: {status:string;lastSeenAt:string|null;lastSuccessfulEvaluation:string|null};
    deliveries?: {orderId:string;productId:string;caseId:string|null;expected:number;received:number;remaining:number;confirmedIncoming:number;unverifiedIncoming:number;confirmationReference:string|null}[];
    audit?: {id:number;type:string;timestamp:string;actor:string;evidence:unknown}[];
    trackedSkus: number;
    lowStock: number;
    criticalStock: number;
    items: {
        id: string;
        sku: string;
        name: string;
        clinicId: string;
        storeroomId: string;
        baseUnit: string;
        packSize: number;
        source: string;
        balance: {
            onHand: number;
            reserved: number;
            available: number;
            incoming: number;
            inventoryPosition: number;
            expired: number;
            usableOnHand?: number;
            backorders?: number;
            unverifiedIncoming?: number;
        };
        forecast: {
            basis: string;
            dailyDemand: number;
            leadTimeDays: number;
            safetyStock: number;
            reorderPoint: number;
            targetStock: number;
            shortage: boolean;
            daysOfSupply: number | null;
        };
        freshness?: {issues:string[];lastMovementAt:string|null;catalogObservedAt:number|null};
        batches?: {id:string;quantity:number;expiresAt?:string;receivedAt?:string;receiptReference?:string}[];
        movements: StockMovement[];
    }[];
    obligations: {
        id: string;
        productId: string;
        eventId: string;
        caseId: string;
        closedAt: number | null;
    }[];
    jobs: {
        productId: string;
        nextDue: number;
        leaseOwner: string | null;
        leaseUntil: number | null;
        failures?: number;
    }[];
    runs: {
        id: string;
        productId: string;
        worker: string;
        state: string;
        startedAt: number;
        completedAt: number | null;
        error: string | null;
    }[];
    caseStates: {
        caseId: string;
        state: string;
        paymentState: string;
        humanInterventions: string[];
    }[];
}
export function parseStockDashboard(raw: unknown, fingerprint: string): StockDashboard {
    const value = raw as StockDashboard;
    if (!value || value.dataOrigin !== 'synthetic' || value.financialExecution !== false || value.profileFingerprint !== fingerprint || !Array.isArray(value.items) || value.items.length > 1000 ||
        !Array.isArray(value.runs) || value.runs.length > 30 || !Array.isArray(value.obligations) || value.obligations.length > 100 || value.config?.financialExecution !== false)
        throw new Error('INVENTORY_PROFILE_OR_EVIDENCE_INVALID');
    for (const item of value.items) {
        if (!/^mn-item-[1-9][0-9]*$/.test(item.id) || !Number.isSafeInteger(item.packSize) || item.packSize < 1 || !Array.isArray(item.movements) || item.movements.length > 50)
            throw new Error('INVENTORY_DATA_INVALID');
        for (const key of ['onHand', 'reserved', 'available', 'incoming', 'expired'] as const)
            if (!Number.isSafeInteger(item.balance[key]) || item.balance[key] < 0)
                throw new Error('INVENTORY_BALANCE_INVALID');
        if(!Number.isSafeInteger(item.balance.inventoryPosition))throw new Error('INVENTORY_BALANCE_INVALID');
    }
    return value;
}
