import { OperatorApiError, type OperatorClient } from './operator-client.ts';

type ApplicationClient = Pick<OperatorClient, 'session'|'cases'|'inventory'|'recent'|'catalog'>;

export function applicationErrorText(cause: unknown) {
  return cause instanceof OperatorApiError && cause.status === 401
    ? 'AUTH_EXPIRED: sign in again to continue.'
    : cause instanceof Error ? cause.message : 'WORKSPACE_UNAVAILABLE';
}

/** A failed refresh replaces its source with an explicit unavailable state. */
export async function loadApplicationData(client: ApplicationClient, offset = 0) {
  const session = await client.session();
  const [cases, inventory, runs, catalog] = await Promise.allSettled([
    client.cases('all', offset), client.inventory(), client.recent(), client.catalog(),
  ]);
  for (const result of [cases, inventory, runs, catalog]) {
    if (result.status === 'rejected' && result.reason instanceof OperatorApiError &&
      (result.reason.status === 401 || result.reason.code === 'PROFILE_MISMATCH')) throw result.reason;
  }
  return {
    session,
    cases: cases.status === 'fulfilled' ? cases.value.projection.cases : [],
    caseCount: cases.status === 'fulfilled' ? cases.value.total : 0,
    nextOffset: cases.status === 'fulfilled' ? cases.value.nextOffset : null,
    caseReadAt: cases.status === 'fulfilled' ? cases.value.projection.generatedAt : null,
    inventory: inventory.status === 'fulfilled' ? inventory.value : [],
    runs: runs.status === 'fulfilled' ? runs.value : [],
    catalog: catalog.status === 'fulfilled' ? catalog.value : null,
    errors: {
      cases: cases.status === 'rejected' ? applicationErrorText(cases.reason) : '',
      inventory: inventory.status === 'rejected' ? applicationErrorText(inventory.reason) : '',
      runs: runs.status === 'rejected' ? applicationErrorText(runs.reason) : '',
      catalog: catalog.status === 'rejected' ? applicationErrorText(catalog.reason) : '',
    },
  };
}
