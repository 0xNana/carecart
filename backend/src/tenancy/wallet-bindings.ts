import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {JsonRpcProvider} from 'near-api-js';import {verifyMessage} from 'near-api-js/nep413';import {z} from 'zod';
import {ClinicRegistry,permissionFor,type IdentitySession} from './registry';import type {VerifiedIdentity} from './identity';import {OperationsError} from '../operations/auth';
export const WalletChallengeInput=z.object({accountId:z.string().min(2).max(64).regex(/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet|[a-f0-9]{64})$/),network:z.literal('testnet')}).strict();
export const WalletProof=z.object({challengeId:z.uuid(),accountId:WalletChallengeInput.shape.accountId,publicKey:z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),signature:z.string().length(88)}).strict();
type Config={network:'testnet';rpcUrl:string};
export function walletConfiguration(env:NodeJS.ProcessEnv):Config|undefined{
 if(env.CARECART_WALLET_BINDING_ENABLED!=='true')return;
 if(env.CARECART_WALLET_BINDING_NETWORK!=='testnet'||!['https://test.rpc.fastnear.com','https://archival-rpc.testnet.near.org'].includes(env.CARECART_WALLET_BINDING_RPC_URL??''))throw new Error('Explicit allowlisted testnet wallet proof RPC required');
 return {network:'testnet',rpcUrl:env.CARECART_WALLET_BINDING_RPC_URL!};
}
type Challenge={id:string;clinic_id:string;user_id:string;session_hash:string;epoch:number;body_json:string;expires:number;used:number};
type Binding={id:string;clinicId:string;userId:string;accountId:string;publicKey:string;network:string;status:string;epoch:number;expires:number};
async function bounded<T>(read:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([read(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new OperationsError(503,'WALLET_OBSERVATION_TIMEOUT')),5000);})]);}finally{if(timer)clearTimeout(timer);}}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Off-chain control proof only. This service contains no transaction/signing or vault authorization method. */
export class WalletBindings {
 readonly provider?:JsonRpcProvider;
 constructor(readonly registry:ClinicRegistry,readonly origin:string,readonly config?:Config,provider?:JsonRpcProvider){
  if(new URL(origin).origin!==origin)throw new Error('Canonical wallet proof origin required');
  if(config){if(config.network!=='testnet'||!['https://test.rpc.fastnear.com','https://archival-rpc.testnet.near.org'].includes(config.rpcUrl))throw new Error('Wallet proof network invalid');this.provider=provider??new JsonRpcProvider({url:config.rpcUrl},{retries:1,wait:0,backoff:1});}
 }
 #epoch(userId:string,clinicId:string){return Number(this.registry.db.prepare("SELECT COALESCE(MAX(id),0) FROM tenant_audit WHERE clinic_id=? AND event='MembershipChanged' AND json_extract(evidence_json,'$.userId')=?").pluck().get(clinicId,userId));}
 #member(u:VerifiedIdentity,clinicId:string){if(u.expires<=this.registry.clock())throw new OperationsError(401,'AUTH_EXPIRED');const m=this.registry.membership(u.userId,clinicId);if(!permissionFor(m.role,'finance'))throw new OperationsError(403,'FINANCE_MEMBERSHIP_REQUIRED');return this.#epoch(u.userId,clinicId);}
 #session(u:VerifiedIdentity,s:IdentitySession){if(s.userId!==u.userId||s.expires<=this.registry.clock()||u.expires<=this.registry.clock()||!this.registry.db.prepare('SELECT 1 FROM identity_sessions WHERE hash=? AND user_id=? AND expires>? AND session_id NOT IN (SELECT session_id FROM identity_revocations)').get(s.hash,u.userId,this.registry.clock()))throw new OperationsError(401,'SESSION_REVOKED');}
 challenge(u:VerifiedIdentity,s:IdentitySession,clinicId:string,raw:unknown){
  if(!this.config)throw new OperationsError(503,'WALLET_BINDING_DISABLED');const input=WalletChallengeInput.parse(raw),epoch=this.#member(u,clinicId);this.#session(u,s);
  const now=this.registry.clock(),id=randomUUID(),nonce=randomBytes(32).toString('base64');
  const body={purpose:'carecart.wallet-binding.v1',id,clinicId,userId:u.userId,accountId:input.accountId,network:input.network,origin:this.origin,sessionHash:s.hash,membershipEpoch:epoch,nonce,issuedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+300000,s.expires)).toISOString()};
  return this.registry.db.transaction(()=>{this.registry.db.prepare('INSERT INTO wallet_binding_challenges VALUES(?,?,?,?,?,?,?,?,0)').run(id,clinicId,u.userId,s.hash,epoch,JSON.stringify(body),Date.parse(body.expiresAt),now);
  this.registry.audit(clinicId,u.userId,'WalletChallengeIssued',{challengeId:id,network:input.network});
  return {id,accountId:input.accountId,network:input.network,expiresAt:body.expiresAt,payload:{message:'CareCart wallet ownership only. No transaction, payment or vault role is authorized.\n'+JSON.stringify(body),recipient:new URL(this.origin).host,nonce}};}).immediate();
 }
 #challenge(u:VerifiedIdentity,s:IdentitySession,clinicId:string,id:string){
  this.#session(u,s);const epoch=this.#member(u,clinicId),c=this.registry.db.prepare('SELECT * FROM wallet_binding_challenges WHERE id=? AND clinic_id=? AND user_id=? AND session_hash=?').get(id,clinicId,u.userId,s.hash) as Challenge|undefined;
  if(!c||c.used||c.expires<=this.registry.clock()||c.epoch!==epoch)throw new OperationsError(409,'WALLET_CHALLENGE_INVALID_EXPIRED_OR_USED');return c;
 }
 async #verify(accountId:string,publicKey:string,message:string,nonce:string,signature:string){
  if(!this.provider||!this.config)throw new OperationsError(503,'WALLET_BINDING_DISABLED');
  const status=await this.provider.viewNodeStatus();if(status.chain_id!==this.config.network)throw new OperationsError(409,'WALLET_NETWORK_MISMATCH');
  const bytes=Buffer.from(signature,'base64');if(bytes.length!==64||bytes.toString('base64')!==signature)throw new OperationsError(400,'INVALID_WALLET_SIGNATURE');
  // The supported library checks both NEP-413 cryptography and FullAccess ownership.
  // Override the read to require a finalized access-key observation, never a browser claim.
  const finalProvider=new JsonRpcProvider({url:this.config.rpcUrl});finalProvider.viewAccessKey=args=>this.provider!.viewAccessKey({...args,finalityQuery:{finality:'final'}});
  try{await verifyMessage({signerAccountId:accountId,signerPublicKey:publicKey,payload:{message,nonce:new Uint8Array(Buffer.from(nonce,'base64')),recipient:new URL(this.origin).host},signature:bytes,provider:finalProvider});}catch{throw new OperationsError(403,'WALLET_PROOF_INVALID');}
 }
 async verify(u:VerifiedIdentity,s:IdentitySession,clinicId:string,raw:unknown,commit:(work:()=>ReturnType<WalletBindings['get']>)=>ReturnType<WalletBindings['get']>){
  const input=WalletProof.parse(raw),c=this.#challenge(u,s,clinicId,input.challengeId),body=JSON.parse(c.body_json);
  if(body.accountId!==input.accountId||body.network!==this.config?.network||body.origin!==this.origin)throw new OperationsError(403,'WALLET_CHALLENGE_MISMATCH');
  await bounded(()=>this.#verify(input.accountId,input.publicKey,'CareCart wallet ownership only. No transaction, payment or vault role is authorized.\n'+c.body_json,body.nonce,input.signature));
  return commit(()=>this.registry.db.transaction(()=>{
   this.#challenge(u,s,clinicId,input.challengeId);
   if(this.registry.db.prepare("SELECT 1 FROM clinic_wallet_bindings WHERE clinic_id=? AND user_id=? AND account_id=? AND status='Verified'").get(clinicId,u.userId,input.accountId))throw new OperationsError(409,'WALLET_ALREADY_BOUND');
   const id=randomUUID();this.registry.db.prepare('UPDATE wallet_binding_challenges SET used=1 WHERE id=? AND used=0').run(c.id);
   this.registry.db.prepare("INSERT INTO clinic_wallet_bindings VALUES(?,?,?,?,?,?,?,'Verified',?,?,?)").run(id,clinicId,u.userId,input.accountId,input.publicKey,'testnet',c.epoch,this.registry.clock()+86400000,c.id,digest(input.signature));
   this.registry.audit(clinicId,u.userId,'WalletControlVerified',{bindingId:id,challengeId:c.id,financialAuthorization:false});return this.get(u,clinicId,id);
  }).immediate());
 }
 get(u:VerifiedIdentity,clinicId:string,id:string){this.registry.membership(u.userId,clinicId);const b=this.registry.db.prepare('SELECT id,clinic_id AS clinicId,user_id AS userId,account_id AS accountId,public_key AS publicKey,network,status,epoch,expires FROM clinic_wallet_bindings WHERE id=? AND clinic_id=? AND user_id=?').get(z.uuid().parse(id),clinicId,u.userId) as Binding|undefined;if(!b)throw new OperationsError(404,'WALLET_BINDING_NOT_FOUND');return {...b,status:b.status==='Verified'&&(b.expires<=this.registry.clock()||b.epoch!==this.#epoch(u.userId,clinicId))?'Invalidated':b.status,financialAuthorization:false as const,vaultRole:'Unverified' as const};}
 list(u:VerifiedIdentity,clinicId:string){this.registry.membership(u.userId,clinicId);return {enabled:!!this.config,network:this.config?.network??null,financialExecution:false,bindings:(this.registry.db.prepare('SELECT id FROM clinic_wallet_bindings WHERE clinic_id=? AND user_id=? ORDER BY rowid DESC LIMIT 100').all(clinicId,u.userId) as {id:string}[]).map(b=>this.get(u,clinicId,b.id))};}
 revoke(u:VerifiedIdentity,clinicId:string,id:string){return this.registry.db.transaction(()=>{const b=this.get(u,clinicId,id);this.registry.db.prepare("UPDATE clinic_wallet_bindings SET status='Revoked' WHERE id=? AND clinic_id=? AND user_id=?").run(b.id,clinicId,u.userId);this.registry.audit(clinicId,u.userId,'WalletBindingRevoked',{bindingId:b.id});return this.get(u,clinicId,id);}).immediate();}
 async assertCurrent(u:VerifiedIdentity,clinicId:string,id:string){const b=this.get(u,clinicId,id);this.#member(u,clinicId);if(b.status!=='Verified')throw new OperationsError(403,'WALLET_BINDING_INACTIVE');if(!this.provider||b.network!==this.config?.network)throw new OperationsError(503,'WALLET_BINDING_DISABLED');const [state,key]=await bounded(()=>Promise.all([this.provider!.viewNodeStatus(),this.provider!.viewAccessKey({accountId:b.accountId,publicKey:b.publicKey,finalityQuery:{finality:'final'}})]));if(state.chain_id!==b.network||key.permission!=='FullAccess'||this.get(u,clinicId,id).status!=='Verified')throw new OperationsError(403,'WALLET_BINDING_INACTIVE');return this.get(u,clinicId,id);}
}
