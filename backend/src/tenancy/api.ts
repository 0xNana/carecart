import {ClinicTreasuries} from './treasury';
import {createHash} from 'node:crypto';
import Fastify,{type FastifyRequest} from 'fastify';import {z} from 'zod';
import {OperationsError} from '../operations/auth';import {ClinicRegistry,ClinicSetup,ClinicRole,permissionFor,type Permission} from './registry';
import {WalletBindings,WalletProof,WalletChallengeInput} from './wallet-bindings';
import {SupabaseIdentity,type VerifiedIdentity} from './identity';import {ClinicRuntimePool,principalHash} from './runtime';
const header=(r:FastifyRequest,k:string)=>typeof r.headers[k]==='string'?r.headers[k] as string:undefined;
const cookie=(r:FastifyRequest,name:string)=>{const v=(header(r,'cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));if(v.length!==1)return '';return v[0].slice(name.length+1);};
export function operationPermission(method:string,path:string):Permission|null {
 if(method==='GET'||method==='HEAD')return null;
 if(method!=='POST')return 'admin';
 if(path.endsWith('/stock/autonomy'))return 'admin';if(path.endsWith('/stock/catalog-refresh'))return 'procurement';if(path.endsWith('/stock/movements'))return 'inventory';
 if(path.includes('financial-authorizations')||path.includes('wallet-reviews'))return 'finance';if(path.includes('/playground/'))return 'simulation';if(path.includes('/runs'))return 'procurement';return 'admin';
}
export function createTenantApp(registry:ClinicRegistry,identity:SupabaseIdentity,origin:string,pool=new ClinicRuntimePool(),walletConfig?:{network:'testnet';rpcUrl:string}){
 const wallets=new WalletBindings(registry,origin,walletConfig);
 // The server binds to loopback behind Caddy; trust forwarded client IPs only from that proxy.
 const app=Fastify({logger:false,bodyLimit:16384,trustProxy:['127.0.0.1']});
 app.addHook('onRequest',async(r,reply)=>{registry.limit('network',createHash('sha256').update(r.ip).digest('hex'),600);reply.header('Cache-Control','no-store').header('Vary','Cookie, Authorization').header('X-Content-Type-Options','nosniff');if(header(r,'sec-fetch-site')==='cross-site'||(header(r,'origin')&&header(r,'origin')!==origin)||(r.method==='POST'&&header(r,'origin')!==origin))throw new OperationsError(403,'ORIGIN_FORBIDDEN');});
 app.setErrorHandler((e,_r,reply)=>{const status=e instanceof OperationsError?e.status:e instanceof z.ZodError?400:503;reply.code(status).send({error:{code:e instanceof OperationsError?e.code:e instanceof z.ZodError?'INVALID_INPUT':'TENANT_SERVICE_UNAVAILABLE'}});});
 // Loopback readiness only: no identity, clinic records, keys or RPC are exposed.
 app.get('/healthz',async(_r,reply)=>{
  const configured=pool.options.requireTestnet===true&&!!(pool.options.preparation||pool.finance?.testnet);
  if(!configured)return reply.code(503).send({status:'unavailable'});
  registry.db.prepare('SELECT 1').get();
  return {status:'ok'};
 });
 const verified=async(r:FastifyRequest):Promise<VerifiedIdentity>=>{const h=header(r,'authorization');if(!h?.startsWith('Bearer '))throw new OperationsError(401,'AUTH_REQUIRED');return identity.verify(h.slice(7));};
 const context=async(r:FastifyRequest)=>{const u=await verified(r);registry.limit('identity',u.userId,180);return {u,s:registry.session(u,cookie(r,'carecart_identity'))};};
 const mutation=<T>(r:FastifyRequest,s:Awaited<ReturnType<typeof context>>['s'],scope:string,input:{requestId:string},work:()=>T,redact?:(v:T)=>unknown)=>registry.mutate(s,header(r,'x-csrf-token'),header(r,'x-operation-nonce'),input.requestId,scope,input,work,redact);
 app.post('/api/identity/session',async r=>{z.object({}).strict().parse(r.body);const u=await verified(r);const session=registry.createSession(u);registry.audit(null,u.userId,'IdentitySessionCreated',{});return session;});
 app.get('/api/identity/context',async r=>{const {u,s}=await context(r);return {userId:u.userId,email:u.email,csrf:s.csrf,nonce:registry.nonce(s),expiresAt:new Date(s.expires).toISOString(),clinics:registry.clinicsFor(u.userId).map(({workspace:_workspace,...c})=>c)};});
 app.post('/api/identity/logout',async r=>{const {s,u}=await context(r);const input=z.object({requestId:z.uuid()}).strict().parse(r.body);return mutation(r,s,'logout',input,()=>{registry.logout(s);registry.audit(null,u.userId,'IdentitySessionRevoked',{});return {authenticated:false};});});
 app.post('/api/identity/revoke-all',async r=>{const {s,u}=await context(r);const input=z.object({requestId:z.uuid()}).strict().parse(r.body);return mutation(r,s,'revoke-all',input,()=>{registry.logoutAll(s);registry.audit(null,u.userId,'AllIdentitySessionsRevoked',{});return {authenticated:false};});});
 app.post('/api/identity/clinics',async r=>{const {u,s}=await context(r);const input=z.object({requestId:z.uuid(),clinic:ClinicSetup}).strict().parse(r.body);return mutation(r,s,'create-clinic',input,()=>{const c=registry.createClinic(u,input.clinic);const {workspace:_workspace,...safe}=c;return {clinic:safe};});});
 app.post('/api/identity/active-clinic',async r=>{const {u,s}=await context(r);const input=z.object({requestId:z.uuid(),clinicId:z.uuid()}).strict().parse(r.body);return mutation(r,s,'active-clinic',input,()=>{registry.membership(u.userId,input.clinicId);return {clinicId:input.clinicId};});});
 app.get('/api/identity/clinics/:id/staff',async r=>{const {u}=await context(r);return registry.staff(u,z.uuid().parse((r.params as {id:string}).id));});
 app.post('/api/identity/clinics/:id/invitations',async r=>{const {u,s}=await context(r),id=z.uuid().parse((r.params as {id:string}).id);const input=z.object({requestId:z.uuid(),email:z.email().max(254),role:ClinicRole}).strict().parse(r.body);return mutation(r,s,id+':invite',input,()=>registry.invite(u,id,{email:input.email,role:input.role}),v=>({...v,token:undefined}));});
 app.post('/api/identity/invitations/accept',async r=>{const {u,s}=await context(r);const input=z.object({requestId:z.uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(r.body);return mutation(r,s,'accept-invite',input,()=>registry.acceptInvite(u,input.token));});
 app.post('/api/identity/clinics/:id/members',async r=>{const {u,s}=await context(r),id=z.uuid().parse((r.params as {id:string}).id);const input=z.object({requestId:z.uuid(),userId:z.uuid(),role:ClinicRole,status:z.enum(['Active','Suspended'])}).strict().parse(r.body);return mutation(r,s,id+':member',input,()=>registry.updateMember(u,id,{userId:input.userId,role:input.role,status:input.status}));});
 const clinicParam=(r:FastifyRequest)=>z.uuid().parse((r.params as {id:string}).id);
 app.get('/api/identity/clinics/:id/treasuries',async r=>{const {u}=await context(r),id=clinicParam(r);if(!permissionFor(registry.membership(u.userId,id).role,'finance'))throw new OperationsError(403,'FINANCE_MEMBERSHIP_REQUIRED');return {configurations:new ClinicTreasuries(registry).list(id).map(({databasePath:_privatePath,...c})=>c),publicSigningEnabled:false};});
 app.get('/api/identity/clinics/:id/wallet-bindings',async r=>{const {u}=await context(r);return wallets.list(u,clinicParam(r));});
 app.post('/api/identity/clinics/:id/wallet-challenges',async r=>{const {u,s}=await context(r),id=clinicParam(r);const input=WalletChallengeInput.extend({requestId:z.uuid()}).parse(r.body);return mutation(r,s,id+':wallet-challenge',input,()=>wallets.challenge(u,s,id,{accountId:input.accountId,network:input.network}));});
 app.post('/api/identity/clinics/:id/wallet-bindings',async r=>{const {u,s}=await context(r),id=clinicParam(r);const input=WalletProof.extend({requestId:z.uuid()}).parse(r.body);
  const nonce=header(r,'x-operation-nonce');if(header(r,'x-csrf-token')!==s.csrf||!nonce||!registry.db.prepare('SELECT 1 FROM identity_nonces WHERE hash=? AND session_hash=? AND expires>?').get(createHash('sha256').update(nonce).digest('hex'),s.hash,registry.clock()))throw new OperationsError(403,'CSRF_OR_NONCE_INVALID');
  const {requestId:_requestId,...proof}=input;return wallets.verify(u,s,id,proof,work=>mutation(r,s,id+':wallet-proof',input,work));
 });
 app.post('/api/identity/clinics/:id/wallet-bindings/revoke',async r=>{const {u,s}=await context(r),id=clinicParam(r);const input=z.object({requestId:z.uuid(),bindingId:z.uuid()}).strict().parse(r.body);return mutation(r,s,id+':wallet-revoke',input,()=>wallets.revoke(u,id,input.bindingId));});
 for(const p of ['supplier-quotes','purchase-orders','payments','agent/tasks','agent/tick'])app.post('/api/'+p,async(_r,reply)=>reply.code(410).send({error:{code:'LEGACY_EXECUTION_RETIRED'}}));
 app.all('/api/operations/*',async(r,reply)=>{
  const {u,s}=await context(r);const path=r.url.split('?')[0];if(path.endsWith('/login')||path.endsWith('/logout'))throw new OperationsError(403,'LEGACY_AUTH_DISABLED');
  const clinicId=z.uuid().parse(header(r,'x-carecart-clinic'));const membership=registry.membership(u.userId,clinicId),clinic=registry.clinic(clinicId);reply.header('X-Carecart-Clinic',clinicId);const permission=operationPermission(r.method,path);
  if(permission&&!permissionFor(membership.role,permission))throw new OperationsError(403,'CLINIC_PERMISSION_REQUIRED');
  const principal={hash:principalHash(s.hash,clinicId,membership.role),userId:u.userId,clinicId,clinicRole:membership.role,permissions:membership.permissions,expires:s.expires,treasuryIdentity:{user:u,session:s}};
  const response=await pool.withClinic(clinic,principal,child=>child.inject({method:r.method as 'GET'|'POST',url:r.url,headers:{origin:'http://127.0.0.1:3002','content-type':'application/json',...(header(r,'x-csrf-token')?{'x-csrf-token':header(r,'x-csrf-token')!}:{}),...(header(r,'x-operation-nonce')?{'x-operation-nonce':header(r,'x-operation-nonce')!}:{})},payload:r.body===undefined?undefined:JSON.stringify(r.body)}));
  if(r.method==='POST')registry.audit(clinicId,u.userId,'ClinicOperation',{method:r.method,path,status:response.statusCode});
  return reply.code(response.statusCode).header('Content-Type','application/json').send(response.body);
 });
 app.addHook('onClose',async()=>{await pool.close();registry.close();});return app;
}
