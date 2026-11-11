import {it,expect,afterEach} from 'vitest';import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClinicRegistry,permissionFor} from './registry';
const clean:(()=>void)[]=[];afterEach(()=>{for(const c of clean.splice(0).reverse())c();});
function fixture(){const path=mkdtempSync(join(tmpdir(),'carecart-tenancy-'));clean.push(()=>rmSync(path,{recursive:true,force:true}));let now=Date.now();const r=new ClinicRegistry(join(path,'registry.sqlite'),()=>now);clean.push(()=>r.close());return {r,advance:(n:number)=>{now+=n;}};}
const identity=()=>({userId:randomUUID(),sessionId:randomUUID(),email:randomUUID()+'@example.invalid',expires:Date.now()+3600000});
const setup={name:'Clinic fixture',country:'GH',timezone:'Africa/Accra',storeroom:'Main storeroom',syntheticDemo:false};
it('TENANCY: clinic creation grants only the verified founder; roles and active membership are authoritative',()=>{const {r}=fixture(),u=identity(),other=identity();const c=r.createClinic(u,setup);expect(r.membership(u.userId,c.id).role).toBe('Clinic Admin');expect(()=>r.membership(other.userId,c.id)).toThrow();expect(()=>r.createClinic(u,{...setup,role:'Clinic Admin'})).toThrow();expect(permissionFor('Inventory Officer','finance')).toBe(false);expect(permissionFor('Viewer','inventory')).toBe(false);});
it('TENANCY: invitations bind verified email, server-held role, expiry and one-time acceptance',()=>{const {r,advance}=fixture(),u=identity(),staff=identity(),c=r.createClinic(u,setup);const invitation=r.invite(u,c.id,{email:staff.email,role:'Inventory Officer'});expect(()=>r.acceptInvite(identity(),invitation.token)).toThrow();expect(r.acceptInvite(staff,invitation.token).clinicId).toBe(c.id);expect(r.membership(staff.userId,c.id).role).toBe('Inventory Officer');expect(()=>r.acceptInvite(staff,invitation.token)).toThrow();expect(()=>r.invite(staff,c.id,{email:staff.email,role:'Clinic Admin'})).toThrow();const late=identity(),expired=r.invite(u,c.id,{email:late.email,role:'Viewer'});advance(8*86400000);expect(()=>r.acceptInvite(late,expired.token)).toThrow();});
it('TENANCY: global identity sessions rotate, bind Supabase session and are revoked on logout',()=>{const {r}=fixture(),u=identity();const a=r.createSession(u),b=r.createSession(u);expect(a.token).not.toBe(b.token);expect(r.session(u,a.token).userId).toBe(u.userId);expect(()=>r.session(identity(),a.token)).toThrow();r.logout(r.session(u,a.token));expect(()=>r.session(u,b.token)).toThrow();expect(()=>r.createSession(u)).toThrow();expect(r.createSession({...u,sessionId:randomUUID()}).token).toBeTruthy();});
it('TENANCY: last administrator and unauthorized role escalation are protected',()=>{const {r}=fixture(),u=identity(),v=identity(),c=r.createClinic(u,setup);const i=r.invite(u,c.id,{email:v.email,role:'Viewer'});r.acceptInvite(v,i.token);expect(()=>r.updateMember(v,c.id,{userId:v.userId,role:'Clinic Admin',status:'Active'})).toThrow();expect(()=>r.updateMember(u,c.id,{userId:u.userId,role:'Viewer',status:'Active'})).toThrow();r.updateMember(u,c.id,{userId:v.userId,role:'Inventory Officer',status:'Suspended'});expect(()=>r.membership(v.userId,c.id)).toThrow();});
it('TENANCY: expired opaque sessions and mutations fail closed even with a valid identity token',()=>{
 const {r,advance}=fixture(),u=identity(),session=r.createSession(u),s=r.session(u,session.token),nonce=r.nonce(s);
 advance(31*60000);
 expect(()=>r.session(u,session.token)).toThrow();
 let calls=0;
 expect(()=>r.mutate(s,s.csrf,nonce,randomUUID(),'expired',{},()=>++calls)).toThrow();
 expect(calls).toBe(0);
});
it('TENANCY: a nonce cannot be reused for an identical payload in another clinic operation scope',()=>{
 const {r}=fixture(),u=identity(),s=r.session(u,r.createSession(u).token),nonce=r.nonce(s),requestId=randomUUID(),payload={requestId};
 let calls=0;
 expect(r.mutate(s,s.csrf,nonce,requestId,'clinic-a:member',payload,()=>++calls)).toBe(1);
 expect(r.mutate(s,s.csrf,nonce,requestId,'clinic-a:member',payload,()=>++calls)).toBe(1);
 expect(()=>r.mutate(s,s.csrf,nonce,requestId,'clinic-b:member',payload,()=>++calls)).toThrow();
 expect(calls).toBe(1);
});
