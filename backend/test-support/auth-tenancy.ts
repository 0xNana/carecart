/** Disposable mock Supabase Auth over real HTTPS, JOSE signatures and the actual tenant gateway. No hosted credentials. */
import https from 'node:https';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';import {generateKeyPair,SignJWT,exportJWK,decodeJwt} from 'jose';import {Account} from 'near-api-js';
import {testnetPreparation} from '../src/profiles/testnet';import {ClinicRuntimePool} from '../src/tenancy/runtime';
import {PROJECT_ROOT} from '../src/profiles/storage';import {SupabaseIdentity,identityConfiguration} from '../src/tenancy/identity';import {ClinicRegistry} from '../src/tenancy/registry';import {createTenantApp} from '../src/tenancy/api';import {VaultPaymentAdapter} from '../src/payments/adapter';
interface User {id:string;email:string;password:string;verified:boolean}
async function main(){let raw='';for await(const c of process.stdin){raw+=c;if(raw.length>12000)throw new Error('Fixture setup too large');}const setup=JSON.parse(raw) as {keyFile:string;certFile:string;idpPort:number;apiPort:number;origin:string;password:string;control:string};
 const issuer='https://127.0.0.1:'+setup.idpPort+'/auth/v1';let generation=1,keys=await generateKeyPair('ES256');const publicKeys=[{...await exportJWK(keys.publicKey),kid:'fixture-1',alg:'ES256'}];
 const users=new Map<string,User>(),revoked=new Set<string>(),tokens=new Map<string,{user:User;type:string}>(),refresh=new Map<string,{user:User;sid:string}>();const counters={jwksReads:0,confirmedEmails:0,recoveryEmails:0,adapter:0,signing:0,externalSubmission:0};
 VaultPaymentAdapter.prototype.requestPayment=async()=>{counters.adapter++;throw new Error('NO_ADAPTER');};Account.prototype.callFunctionRaw=async()=>{counters.signing++;throw new Error('NO_SIGNING');};const fetch0=globalThis.fetch;globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='object'&&'url' in input?input.url:String(input));if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){counters.externalSubmission++;throw new Error('NO_EXTERNAL_REQUEST');}return fetch0(input,init);};
 const publicUser=(u:User)=>({id:u.id,aud:'authenticated',role:'authenticated',email:u.email,email_confirmed_at:u.verified?new Date().toISOString():null,confirmed_at:u.verified?new Date().toISOString():null,app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
 async function session(u:User,sid:string=randomUUID()){const now=Math.floor(Date.now()/1000),access=await new SignJWT({sub:u.id,session_id:sid,email:u.email,role:'authenticated',aud:'authenticated',iss:issuer,iat:now,exp:now+3600}).setProtectedHeader({alg:'ES256',kid:'fixture-'+generation}).sign(keys.privateKey);const rt=randomBytes(32).toString('hex');refresh.set(rt,{user:u,sid});return {access_token:access,refresh_token:rt,expires_in:3600,expires_at:now+3600,token_type:'bearer',user:publicUser(u)};}
 const provider=https.createServer({key:readFileSync(setup.keyFile),cert:readFileSync(setup.certFile)},async(req,res)=>{res.setHeader('Content-Type','application/json');const send=(status:number,data:unknown)=>{res.statusCode=status;res.end(data===undefined?'':JSON.stringify(data));};
  try{const url=new URL(req.url!,'https://127.0.0.1:'+setup.idpPort);let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw new Error('Too large');}const data=body?JSON.parse(body):{};
   if(url.pathname.startsWith('/__fixture/')){if(req.headers.authorization!=='Bearer '+setup.control)return send(403,{});
    if(url.pathname==='/__fixture/evidence')return send(200,counters);
    if(url.pathname==='/__fixture/rotate'){keys=await generateKeyPair('ES256');generation++;publicKeys.push({...await exportJWK(keys.publicKey),kid:'fixture-'+generation,alg:'ES256'});return send(200,{rotated:true});}
    if(url.pathname==='/__fixture/verify'){const u=users.get(String(data.email));if(!u)throw new Error('User absent');const token=randomBytes(32).toString('hex');tokens.set(token,{user:u,type:String(data.type)});return send(200,{token_hash:token});}
    if(url.pathname==='/__fixture/token'){const u=users.get(String(data.email));if(!u||!u.verified)throw new Error('User unverified');return send(200,await session(u));}
    return send(404,{});
   }
   if(url.pathname==='/auth/v1/.well-known/jwks.json'){counters.jwksReads++;return send(200,{keys:publicKeys});}
   if(url.pathname==='/auth/v1/signup'){const email=String(data.email).toLowerCase();if(!users.has(email))users.set(email,{id:randomUUID(),email,password:String(data.password),verified:false});return send(200,publicUser(users.get(email)!));}
   if(url.pathname==='/auth/v1/recover'){counters.recoveryEmails++;return send(200,{});}
   if(url.pathname==='/auth/v1/verify'){const found=tokens.get(String(data.token_hash));if(!found||found.type!==data.type)return send(403,{msg:'Invalid fixture confirmation'});tokens.delete(String(data.token_hash));found.user.verified=true;counters.confirmedEmails++;return send(200,await session(found.user));}
   if(url.pathname==='/auth/v1/token'){
    if(url.searchParams.get('grant_type')==='refresh_token'){const r=refresh.get(String(data.refresh_token));if(!r||revoked.has(r.sid))return send(401,{msg:'Revoked fixture session'});return send(200,await session(r.user,r.sid));}
    const u=users.get(String(data.email).toLowerCase());if(!u||u.password!==data.password||!u.verified)return send(400,{msg:'Invalid fixture credentials or unverified email'});return send(200,await session(u));
   }
   const bearer=String(req.headers.authorization??'').replace(/^Bearer /,'');let claims;try{claims=decodeJwt(bearer);}catch{return send(401,{});}const u=[...users.values()].find(v=>v.id===claims.sub);if(!u||revoked.has(String(claims.session_id)))return send(401,{});
   if(url.pathname==='/auth/v1/user'){if(req.method==='PUT'&&typeof data.password==='string')u.password=data.password;return send(200,publicUser(u));}
   if(url.pathname==='/auth/v1/logout'){revoked.add(String(claims.session_id));return send(204,undefined);}return send(404,{});
  }catch{return send(400,{msg:'Mock identity request rejected'});}
 });
 await new Promise<void>(resolve=>provider.listen(setup.idpPort,'127.0.0.1',resolve));
 const config=identityConfiguration({CARECART_AUTH_MODE:'supabase',SUPABASE_URL:'https://127.0.0.1:'+setup.idpPort,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_identity_fixture_only',CARECART_PUBLIC_ORIGIN:setup.origin});
 const preparation=testnetPreparation(JSON.parse(readFileSync(process.env.CARECART_TESTNET_WORKSPACE_FILE!,'utf8')));const registry=new ClinicRegistry(join(PROJECT_ROOT,'backend/data/tenancy/registry.sqlite')),app=createTenantApp(registry,new SupabaseIdentity(config),setup.origin,new ClinicRuntimePool(undefined,{preparation,requireTestnet:true}));await app.listen({host:'127.0.0.1',port:setup.apiPort});
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void app.close().then(()=>provider.close());});console.info(JSON.stringify({status:'ready',identityProvider:'mocked-local-HTTPS',publicChainExecution:false}));
}
void main().catch(()=>{console.error('Isolated identity fixture failed; setup and credentials redacted.');process.exitCode=1;});
