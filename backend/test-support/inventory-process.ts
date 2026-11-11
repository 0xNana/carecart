import { openInventoryOperations } from '../src/inventory/local';
/** Credential-free process fault/concurrency harness, never an operational entrypoint. */
const [mode, name, value] = process.argv.slice(2);
const local = openInventoryOperations(name, () => mode === 'resume' ? Number(value) : Date.now());
try {
    if (mode === 'crash')
        local.monitor.runOnce('crash-fixture', () => process.exit(73));
    else if (mode === 'resume')
        console.info(JSON.stringify(local.monitor.runOnce('restart-fixture')));
    else if (mode === 'consume')
        local.inventory.move({ id: value, productId: 'mn-item-1', kind: 'Consume', quantity: 8, unit: 'base', source: 'synthetic' }, 'concurrent-fixture');
    else if (mode === 'claim')
        console.info(JSON.stringify(local.monitor.claim('fixture-' + process.pid)));
    else if (mode !== 'init')
        throw new Error('Invalid fixture mode');
}
catch {
    process.exitCode = 2;
}
finally {
    local.close();
}
