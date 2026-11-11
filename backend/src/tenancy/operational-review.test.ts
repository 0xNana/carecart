import {afterEach,expect,it} from 'vitest';
import {copyFileSync,existsSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ClinicRegistry} from './registry';
import {openClinicRuntime} from './runtime';
import {localOperationsProfile} from '../operations/local';

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'carecart-operational-review-'));
 cleanup.push(()=>rmSync(folder,{recursive:true,force:true}));
 const registry=new ClinicRegistry(join(folder,'registry.sqlite'));
 cleanup.push(()=>registry.close());
 const user={userId:randomUUID(),sessionId:randomUUID(),email:'owner@example.invalid',expires:Date.now()+3600000};
 const clinic=()=>registry.createClinic(user,{name:'Operational review fixture',country:'GH',timezone:'Africa/Accra',storeroom:'Main',syntheticDemo:true});
 return {folder,registry,user,clinic};
}

it('TENANT OPERATIONS: provisioning resumes after registry-only creation; coordinated SQLite backups restore an owned workspace at its original path',async()=>{
 const {folder,registry,user,clinic}=fixture(),c=clinic(),path=localOperationsProfile(c.workspace).databasePath;
 cleanup.push(()=>rmSync(dirname(path),{recursive:true,force:true}));
 expect(existsSync(path)).toBe(false);
 let local=openClinicRuntime(c);
 cleanup.push(()=>local.close());
 const movement={id:'backup-consumption',productId:'mn-item-1',kind:'Consume' as const,quantity:4,unit:'base' as const,source:'manual' as const};
 local.inventory.move(movement,'review');
 local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'review');
 for(let i=0;i<6;i++)local.monitor.runOnce('review');
 const caseId=local.inventory.dashboard().obligations[0].caseId,poHash=local.workflow.get(caseId).poHash;
 // Writers are quiescent during both online backups. Never copy a live main DB without its WAL.
 await registry.db.backup(join(folder,'registry-backup.sqlite'));
 await local.inventory.db.backup(join(folder,'clinic-backup.sqlite'));
 const registryCopy=new ClinicRegistry(join(folder,'registry-backup.sqlite'));
 try{expect(registryCopy.membership(user.userId,c.id).role).toBe('Clinic Admin');expect(registryCopy.clinic(c.id).workspace).toBe(c.workspace);}finally{registryCopy.close();}
 local.inventory.move({...movement,id:'after-backup'},'review');
 expect(local.inventory.balance('mn-item-1').onHand).toBe(22);
 local.close();
 expect(existsSync(path+'-wal')).toBe(false);
 renameSync(path,path+'.pre-restore');
 copyFileSync(join(folder,'clinic-backup.sqlite'),path);
 local=openClinicRuntime(c);
 expect(local.inventory.balance('mn-item-1').onHand).toBe(26);
 expect(local.workflow.get(caseId).poHash).toBe(poHash);
 expect(local.inventory.db.pragma('integrity_check',{simple:true})).toBe('ok');
 local.inventory.move(movement,'review');
 expect(local.inventory.balance('mn-item-1').onHand).toBe(26);
 expect(local.inventory.db.prepare('SELECT MAX(version) FROM inventory_schema_migrations').pluck().get()).toBe(4);
});

it('TENANT OPERATIONS: identical movement IDs and concurrent clinic openings remain independently idempotent',async()=>{
 const {clinic}=fixture(),a=clinic(),b=clinic();
 const locals=await Promise.all([a,b].map(async c=>{const local=openClinicRuntime(c);cleanup.push(()=>rmSync(dirname(local.inventory.path),{recursive:true,force:true}),()=>local.close());return local;}));
 for(const [index,local] of locals.entries()){
  const movement={id:'same-clinic-local-id',productId:'mn-item-1',kind:'Consume' as const,quantity:index+1,unit:'base' as const,source:'manual' as const};
  local.inventory.move(movement,'review');local.inventory.move(movement,'review');
  expect(local.inventory.balance('mn-item-1').onHand).toBe(29-index);
 }
});

it('TENANT OPERATIONS: an inactive clinic denies access and worker routing without hiding the users remaining active memberships',()=>{
 const {registry,user,clinic}=fixture(),active=clinic(),inactive=clinic();
 // Lifecycle administration is not exposed as a product endpoint; simulate operator maintenance in the isolated registry.
 registry.db.prepare("UPDATE clinics SET status='Inactive' WHERE id=?").run(inactive.id);
 expect(()=>registry.membership(user.userId,inactive.id)).toThrow();
 expect(registry.activeClinics().map(c=>c.id)).toEqual([active.id]);
 expect(registry.clinicsFor(user.userId).map(c=>c.id)).toEqual([active.id]);
});
