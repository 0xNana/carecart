import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStockDashboard, type StockDashboard } from '../src/lib/inventory.ts';
const fp = 'a'.repeat(64);
function fixture(): StockDashboard {
    return { dataOrigin: 'synthetic', financialExecution: false, profileFingerprint: fp, config: { monitoring: true, automaticCases: true, automaticPreparation: true, financialExecution: false, intervalSeconds: 30 },
        trackedSkus: 1, lowStock: 1, criticalStock: 1, items: [{ id: 'mn-item-1', sku: 'GLOVES-BOX', name: 'Medical gloves (synthetic)', clinicId: 'synthetic-clinic', storeroomId: 'main-storeroom', baseUnit: 'box', packSize: 10, source: 'synthetic',
                balance: { onHand: 8, reserved: 0, available: 8, incoming: 40, inventoryPosition: 48, expired: 0 }, forecast: { basis: 'configured-baseline', dailyDemand: 4, leadTimeDays: 5, safetyStock: 8, reorderPoint: 28, targetStock: 48, shortage: false, daysOfSupply: 2 }, movements: [] }],
        obligations: [{ id: 'event', productId: 'mn-item-1', eventId: 'event', caseId: 'case-stock', closedAt: null }], jobs: [], runs: [], caseStates: [{ caseId: 'case-stock', state: 'PoDrafted', paymentState: 'Unobserved', humanInterventions: ['AuthorizeCommitment'] }] };
}
test('LOCAL INVENTORY PROJECTION: rejects cross-profile, financial activation and impossible balances', () => {
    const f = fixture();
    assert.equal(parseStockDashboard(f, fp).items[0].balance.onHand, 8);
    assert.throws(() => parseStockDashboard(f, 'b'.repeat(64)));
    assert.throws(() => parseStockDashboard({ ...f, financialExecution: true }, fp));
    f.items[0].balance.onHand = -1;
    assert.throws(() => parseStockDashboard(f, fp));
});
test('RENDERED UI / SYNTHETIC: shows worker, inventory, incoming stock and unobserved payment as distinct facts', async () => {
    const { mkdtempSync, writeFileSync, symlinkSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, resolve } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { default: ts } = await import('typescript');
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const folder = mkdtempSync(join(tmpdir(), 'carecart-stock-ui-'));
    try {
        symlinkSync(resolve('node_modules'), join(folder, 'node_modules'), 'dir');
        const code = ts.transpileModule(readFileSync('src/components/inventory-operations.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('../lib/product-copy', pathToFileURL(resolve('src/lib/product-copy.ts')).href).replaceAll('../lib/operator-client', pathToFileURL(resolve('src/lib/operator-client.ts')).href);
        writeFileSync(join(folder, 'inventory.mjs'), code);
        const { InventorySummary } = await import(pathToFileURL(join(folder, 'inventory.mjs')).href);
        const data=fixture();
        data.items[0].movements=[{id:'issued-1',productId:'mn-item-1',kind:'Dispense',quantity:2,baseQuantity:2,unit:'base',source:'manual',timestamp:'2026-11-07T10:00:00Z',actor:'operator:staff',destination:'Treatment room',reference:'ISSUE-1'},
         {id:'receipt-1',productId:'mn-item-1',kind:'Receive',quantity:1,baseQuantity:10,unit:'pack',source:'manual',timestamp:'2026-11-07T09:00:00Z',actor:'operator:staff',supplierId:'mn-supplier-1',batch:'LOT-1',receivedAt:'2026-11-07T08:00:00Z'}];
        const html = renderToStaticMarkup(createElement(InventorySummary, { data }));
        for(const text of ['Stock dispensed or consumed','Treatment room','reference ISSUE-1','mn-supplier-1','lot LOT-1','received 11/7/2026'])assert.ok(html.includes(text),text);
        for (const text of ['Stock levels', 'configured-baseline', '28 / 48', '40 / 48', 'Not checked yet', 'Confirm order', 'independently of payment', 'No lots recorded.'])
            assert.ok(html.includes(text), text);
        assert.doesNotMatch(html, /PRIVATE_KEY|OPERATOR_SECRET|Paid|Settled/);
    }
    finally {
        rmSync(folder, { recursive: true, force: true });
    }
});
test('LOCAL INVENTORY PROJECTION: negative inventory position represents committed demand without permitting negative physical stock',()=>{
 const f=fixture();f.items[0].balance.inventoryPosition=-2;assert.equal(parseStockDashboard(f,fp).items[0].balance.inventoryPosition,-2);
 f.items[0].balance.available=-1;assert.throws(()=>parseStockDashboard(f,fp));
});
test('retired Playground pages validate access before redirect and mount no wallet or simulation',async()=>{
 const {readFileSync,existsSync}=await import('node:fs');const source=readFileSync('src/app/app/playground/[[...path]]/page.tsx','utf8');
 assert.ok(source.indexOf('await requireApplicationAccess()')<source.lastIndexOf("redirect('/app')"));
 assert.doesNotMatch(source,/WalletControls|NearProvider|signAndSendTransaction|PlaygroundSimulation/);
 for(const old of ['src/components/testnet-playground.tsx','src/components/playground-simulation.tsx'])assert.equal(existsSync(old),false);
});
