import { openInventoryOperations } from '../inventory/local';
import { assertNoSigningCredentials } from '../operations/local';
import { createOperationsApp } from '../operations/api';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import dotenv from 'dotenv';
import {z} from 'zod';
import {PROJECT_ROOT} from '../profiles/storage';
import {SafetyProfileSchema} from '../near/safety-profile';
import {testnetProfile} from '../profiles/testnet';
import {liveConfiguration,openAiTransport} from '../agent/live';
import {procurementToolDefinitions} from '../operations/tools';
/** Independent browser-free process. Never loads human custody or a wallet. */
export async function inventoryMain() {
    assertNoSigningCredentials(process.env);
    const preparation=process.env.CARECART_OPERATIONS_MODE==='testnet-preparation';
    if (!preparation&&process.env.CARECART_OPERATIONS_MODE !== 'local-synthetic')
        throw new Error('Explicit local-synthetic or testnet-preparation mode required');
    const mode = process.argv[2];
    if (!['api', 'worker', 'once'].includes(mode))
        throw new Error('Use inventory.ts api|worker|once');
    if(mode!=='api'&&process.env.CARECART_INVENTORY_WORKER_ENABLED!=='true')throw new Error('Explicit CARECART_INVENTORY_WORKER_ENABLED=true required');
    const dataset=process.env.CARECART_INVENTORY_DATASET??'clinic';
    if(!['clinic','playground'].includes(dataset))throw new Error('Explicit clinic or playground dataset required');
    const candidate=preparation?z.object({profile:SafetyProfileSchema,suppliers:z.array(z.string()).length(3)}).strict().parse(JSON.parse(readFileSync(process.env.CARECART_TESTNET_WORKSPACE_FILE??'','utf8'))):undefined;
    if(candidate)testnetProfile(candidate.profile);
    const local = openInventoryOperations(process.env.CARECART_INVENTORY_WORKSPACE ?? 'clinic-runtime',()=>Date.now(),{dataset:dataset as 'clinic'|'playground',testnet:candidate});
    if (mode === 'api') {
        try {
            const port = Number(process.env.CARECART_OPERATIONS_PORT ?? 3004);
            if (!Number.isInteger(port) || port < 1024 || port > 65535)
                throw new Error('Invalid loopback port');
            const ai = liveConfiguration(process.env);
            const provider = ai ? { config: ai, transport: openAiTransport(ai, procurementToolDefinitions), evidence: 'live-provider' as const } : undefined;
            const app = createOperationsApp({ workflow: local.workflow, inventory: local.inventory, origin: process.env.CARECART_OPERATIONS_ORIGIN ?? 'http://127.0.0.1:3005',
                operatorCredential: process.env.CARECART_OPERATIONS_OPERATOR_SECRET ?? '', viewerCredential: process.env.CARECART_OPERATIONS_VIEWER_SECRET, provider });
            app.addHook('onClose', async () => local.close());
            for (const signal of ['SIGINT', 'SIGTERM'] as const)
                process.once(signal, () => void app.close());
            await app.listen({ host: '127.0.0.1', port });
            console.info('Synthetic inventory API on loopback; financial execution disabled; '+(preparation?'testnet CCUSD preparation':'legacy local preparation'));
        }
        catch (e) {
            local.close();
            throw e;
        }
        return;
    }
    const worker = 'inventory-' + process.pid;
    if (mode === 'once') {
        try {
            console.info(JSON.stringify(local.monitor.runOnce(worker)));
        }
        finally {
            local.close();
        }
        return;
    }
    const tick = () => { try {
        local.inventory.heartbeat(worker,'Running');
        const run = local.monitor.runOnce(worker);
        if (run)
            console.info(JSON.stringify(run));
    }
    catch {
        local.inventory.heartbeat(worker,'Running','Inventory worker requires inspection');
        console.error('Inventory worker requires inspection; no financial action attempted');
    } };
    const timer = setInterval(tick, 1000);
    tick();
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => { clearInterval(timer);local.inventory.heartbeat(worker,'Stopped'); local.close(); });
}
if (require.main === module) {
    dotenv.config({ path: join(PROJECT_ROOT, '.env') });
    void inventoryMain().catch(() => { console.error('Inventory runtime failed; inspect local configuration. No financial execution.'); process.exitCode = 1; });
}
