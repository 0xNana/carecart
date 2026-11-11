import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {PROJECT_ROOT} from '../profiles/storage';
import {SafetyProfileSchema} from '../near/safety-profile';
import {sandboxProfile,isSandboxProfile} from './profile';
import {SandboxProcurementStore} from './store';
import {ReplenishmentWorkflow} from '../workflow/cases';
const directories:string[]=[];
function fixture(){
 const directory=join(PROJECT_ROOT,'backend/data/sandbox-v2','unit-'+randomUUID());mkdirSync(directory,{recursive:true});directories.push(directory);
 return {version:2 as const,environment:'sandbox' as const,network:'testnet' as const,chainId:'local-sandbox',genesisHash:'1'.repeat(44),rpcUrl:'http://127.0.0.1:4000',
  vault:'vault.testnet',token:'token.testnet',decimals:6 as const,tokenSymbol:'CCUSD' as const,admin:'admin.testnet',guardian:'guardian.testnet',treasury:'treasury.testnet',
  committer:'committer.testnet',requester:'agent.testnet',committerPublicKey:'ed25519:'+'1'.repeat(43),requesterPublicKey:'ed25519:'+'2'.repeat(43),
  maxKeyAllowanceYocto:'20000000000000000000000',codeHash:'3'.repeat(44),databasePath:join(directory,'state.sqlite')};
}
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
describe('LOCAL SQLITE / no RPC: isolated Sandbox procurement boundary',()=>{
 it('rejects public chain identities, non-loopback endpoints and public production profiles',()=>{
  const p=fixture();
  for(const override of [{chainId:'mainnet'},{chainId:'testnet'},{rpcUrl:'https://rpc.testnet.near.org'},
   {rpcUrl:'http://127.0.0.1:4000/?redirect=mainnet'},{tokenSymbol:'USDC'},{decimals:0}])expect(()=>sandboxProfile({...p,...override})).toThrow();
  expect(SafetyProfileSchema.safeParse(p).success).toBe(false);
  const branded=sandboxProfile(p);expect(isSandboxProfile(branded)).toBe(true);expect(isSandboxProfile({...branded})).toBe(false);
 });
 it('rejects shared role identities, shared keys and operational database paths',()=>{
  const p=fixture();
  for(const override of [{requester:p.committer},{requesterPublicKey:p.committerPublicKey},{databasePath:'/tmp/operational.sqlite'},
   {maxKeyAllowanceYocto:'300000000000000000000000'}])expect(()=>sandboxProfile({...p,...override})).toThrow();
 });
 it('refuses a database containing production or legacy CCTEST procurement tables',()=>{
  for(const table of ['v2_procurement_profile','purchase_orders']){
   const p=fixture();const db=new Database(p.databasePath);db.exec(`CREATE TABLE ${table}(id TEXT)`);db.close();
   expect(()=>new SandboxProcurementStore(sandboxProfile(p))).toThrow(/cannot reuse/);
  }
 });
 it('persists one obligation across duplicate inventory events and restart without mainnet IDs',()=>{
  const p=sandboxProfile(fixture());let store=new SandboxProcurementStore(p);let workflow=new ReplenishmentWorkflow(store);
  const input={caseId:'sb-unit-case',eventId:'sb-unit-event',idempotencyKey:'sb-unit-event',itemId:'sb-item-1'};
  const before=workflow.ingest(input);expect(workflow.ingest(input).poHash).toBe(before.poHash);
  expect(before.poId).toMatch(/^sb-po-/);expect(before.domain?.purchaseOrder.canonical.token).toBe('token.testnet');
  expect(before.state).toBe('PoDrafted');expect(before.domain?.purchaseOrder.canonical.amount).toBe('1000000');
  workflow.close();store.close();store=new SandboxProcurementStore(p);workflow=new ReplenishmentWorkflow(store);
  try{expect(workflow.get(input.caseId)).toEqual(before);expect(store.db.prepare('SELECT count(*) AS n FROM sandbox_orders').get()).toEqual({n:1});}
  finally{workflow.close();store.close();}
 });
 it('blocks changed persisted canonical terms',()=>{
  const store=new SandboxProcurementStore(sandboxProfile(fixture()));
  try{store.inventoryEvent({eventId:'event',itemId:'sb-item-1'});const po=store.selectQuote({eventId:'event'});
   const changed=structuredClone(po);changed.canonical.amount='1';
   store.db.prepare('UPDATE sandbox_orders SET body_json=?').run(JSON.stringify(changed));
   expect(()=>store.resolve(po.canonical.po_id)).toThrow(/immutable PO conflict/);
   expect(()=>store.resolve('mn-po-'+'a'.repeat(56))).toThrow();
  }finally{store.close();}
 });
 it('refuses expired unselected quotes and a different genesis on restart',()=>{
  const raw=fixture();const store=new SandboxProcurementStore(sandboxProfile(raw));
  try{store.inventoryEvent({eventId:'old',itemId:'sb-item-1'},new Date('2020-01-01T00:00:00Z'));
   expect(()=>store.selectQuote({eventId:'old'})).toThrow(/expired/);
  }finally{store.close();}
  expect(()=>new SandboxProcurementStore(sandboxProfile({...raw,genesisHash:'4'.repeat(44)}))).toThrow(/genesis\/profile\/database conflict/);
 });
 it('requires explicit restricted-role authorization before financial invocation',async()=>{
  const store=new SandboxProcurementStore(sandboxProfile(fixture()));const workflow=new ReplenishmentWorkflow(store);
  try{const c=workflow.ingest({caseId:'sb-auth',eventId:'auth',idempotencyKey:'auth',itemId:'sb-item-1'});
   await expect(workflow.act({caseId:c.caseId,role:'committer',expectedVersion:c.version,expectedHash:c.poHash},{})).rejects.toThrow();
   expect(workflow.get(c.caseId).state).toBe('PoDrafted');
  }finally{workflow.close();store.close();}
 });
});
