import { parseUsdc } from '../amounts';
import { NEAR_USDC } from '../intents/settlement';

/** Local fixtures only. No database handle, deployment identities, registration or signer. */
export function procurementFixtures() {
  const suppliers = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
    id: `mn-supplier-${index + 1}`, displayName: `Synthetic Supplier ${name}`,
    dataOrigin: 'synthetic' as const, nearAccountId: null,
  }));
  const names = ['Saline', 'Gauze', 'Masks', 'Syringes', 'Bandages', 'Nitrile gloves'];
  const items = names.map((name, index) => ({
    id: `mn-item-${index + 1}`, name: `Synthetic ${name}`, unit: 'pack',
    onHand: 1, reorderPoint: 5, dataOrigin: 'synthetic' as const,
  }));
  const orders = ['1', '2', '3', '4', '5', '6.20'].map((amount, index) => ({
    id: `mn-po-${index + 1}`, profile: 'local-usdc-v2', itemId: items[index].id,
    supplierId: suppliers[index % suppliers.length].id,
    tokenAccountId: NEAR_USDC, assetCode: 'USDC', decimals: 6,
    quantity: 10, unitPriceAtomic: (parseUsdc(amount) / 10n).toString(),
    amountAtomic: parseUsdc(amount).toString(), status: 'draft' as const,
    requiresCeilingReview: index === 5, executionAuthorized: false,
  }));
  return { profile: 'local-usdc-v2', dataOrigin: 'synthetic', suppliers, items, orders };
}
