import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApplicationData } from '../src/lib/application-data.ts';
import { OperatorApiError, type OperatorClient, type OperatorSession } from '../src/lib/operator-client.ts';

const session: OperatorSession = { role:'viewer', csrf:'a'.repeat(64), nonce:'b'.repeat(48),
  profileFingerprint:'c'.repeat(64), expiresAt:'2026-11-10T00:00:00Z', providerAvailable:false, model:null };
function client(): Pick<OperatorClient, 'session'|'cases'|'inventory'|'recent'|'catalog'> {
  return {
    session: async () => session,
    cases: async () => ({projection:{generatedAt:'2026-11-06T12:00:00Z',profileFingerprint:session.profileFingerprint,cases:[]},total:0,nextOffset:null}),
    inventory: async () => [{id:'mn-item-1',name:'Synthetic gloves',onHand:12,reorderPoint:28}],
    recent: async () => [],
    catalog: async () => ({configured:false,dataOrigin:'synthetic',profileFingerprint:session.profileFingerprint}),
  };
}

test('application load retains server read time and paginates cases without mutating viewer permissions', async () => {
  const api=client();let offset:number|undefined;
  api.cases=async (_filter,nextOffset)=>{offset=nextOffset;return {projection:{generatedAt:'2026-11-06T12:00:00Z',profileFingerprint:session.profileFingerprint,cases:[]},total:25,nextOffset:20};};
  const data=await loadApplicationData(api,0);
  assert.equal(offset,0);assert.equal(data.caseReadAt,'2026-11-06T12:00:00Z');
  assert.equal(data.caseCount,25);assert.equal(data.session.role,'viewer');assert.equal(data.inventory.length,1);
});

test('failed inventory and run reads produce separate unavailable states rather than retaining successful values', async () => {
  const api=client();const first=await loadApplicationData(api);
  api.inventory=async ()=>{throw new Error('INVENTORY_OFFLINE');};
  api.recent=async ()=>{throw new Error('RUNS_OFFLINE');};
  const next=await loadApplicationData(api);
  assert.equal(first.inventory.length,1);assert.deepEqual(next.inventory,[]);assert.deepEqual(next.runs,[]);
  assert.equal(next.errors.inventory,'INVENTORY_OFFLINE');assert.equal(next.errors.runs,'RUNS_OFFLINE');
  assert.equal(next.errors.cases,'');assert.equal(next.caseReadAt,first.caseReadAt);
});

test('unavailable cases and catalog clear their evidence instead of reporting an empty healthy workspace', async () => {
  const api=client();api.cases=async ()=>{throw new Error('CASES_OFFLINE');};
  api.catalog=async ()=>{throw new Error('CATALOG_OFFLINE');};
  const next=await loadApplicationData(api);
  assert.equal(next.caseReadAt,null);assert.equal(next.catalog,null);assert.equal(next.nextOffset,null);
  assert.equal(next.errors.cases,'CASES_OFFLINE');assert.equal(next.errors.catalog,'CATALOG_OFFLINE');
});

test('expired authentication or mismatched profile on any parallel read rejects the entire view', async () => {
  for(const [status,code] of [[401,'AUTH_REQUIRED'],[409,'PROFILE_MISMATCH']] as const) {
    const api=client();api.catalog=async ()=>{throw new OperatorApiError(code,status);};
    await assert.rejects(loadApplicationData(api), (cause: unknown)=>cause instanceof OperatorApiError&&cause.code===code);
  }
});
