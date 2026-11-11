import Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {WorkflowProcurement} from '../workflow/procurement-port';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class OperationsError extends Error { constructor(readonly status:number,readonly code:string){super(code);} }
export interface OperatorSession {hash:string;role:'operator'|'viewer';csrf:string;expires:number;userId?:string;clinicId?:string;clinicRole?:string;permissions?:string[]}
/** Opaque HttpOnly-cookie sessions; persistence contains token hashes, never bearer credentials. */
export class OperatorAuth {
 readonly database:Database.Database;
 readonly #credentialVersion:string;
 readonly profileFingerprint:string;
 constructor(store:WorkflowProcurement,readonly origin:string,private readonly operator:string,private readonly viewer='',readonly clock=()=>Date.now()) {
  this.profileFingerprint=store.fingerprint;
  const u=new URL(origin);
  if(u.origin!==origin||!['localhost','127.0.0.1'].includes(u.hostname)||!['http:','https:'].includes(u.protocol))throw new Error('Local canonical operator origin required');
  if(operator.length<32||operator.length>256||(viewer&&(viewer.length<32||viewer===operator)))throw new Error('Independent high-entropy operator credentials required');
  this.#credentialVersion=hash(JSON.stringify([operator,viewer]));this.database=new Database(store.profile.databasePath);
  this.database.pragma('journal_mode=WAL');this.database.pragma('synchronous=FULL');this.database.pragma('busy_timeout=3000');
  this.database.exec(`CREATE TABLE IF NOT EXISTS operations_identity(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL,origin TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS operator_sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL,credential_version TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS operator_nonces(nonce_hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL,expires INTEGER NOT NULL,used_by TEXT,used_hash TEXT);
   CREATE TABLE IF NOT EXISTS operator_limits(bucket TEXT NOT NULL,actor TEXT NOT NULL,time INTEGER NOT NULL);`);
  const old=this.database.prepare('SELECT fingerprint,origin FROM operations_identity WHERE id=1').get() as {fingerprint:string;origin:string}|undefined;
  if(old&&(old.fingerprint!==store.fingerprint||old.origin!==origin)){this.database.close();throw new Error('Operations profile/origin mismatch');}
  this.database.prepare('INSERT OR IGNORE INTO operations_identity VALUES(1,?,?)').run(store.fingerprint,origin);
 }
 close(){if(this.database.open)this.database.close();}
 limit(bucket:string,actor:string,max:number,window=60_000) {
  this.database.transaction(()=>{
   this.database.prepare('DELETE FROM operator_limits WHERE time<?').run(this.clock()-window);
   const count=this.database.prepare('SELECT count(*) FROM operator_limits WHERE bucket=? AND actor=? AND time>=?').pluck().get(bucket,actor,this.clock()-window) as number;
   if(count>=max)throw new OperationsError(429,'RATE_LIMIT');
   this.database.prepare('INSERT INTO operator_limits VALUES(?,?,?)').run(bucket,actor,this.clock());
  }).immediate();
 }
 login(credential:string) {
  this.limit('login','local',10);
  const equal=(a:string,b:string)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
  const role=equal(credential,this.operator)?'operator':this.viewer&&equal(credential,this.viewer)?'viewer':null;
  if(!role)throw new OperationsError(401,'AUTH_REQUIRED');
  const token=randomBytes(32).toString('hex');const csrf=randomBytes(32).toString('hex');const expires=this.clock()+30*60_000;
  this.database.prepare('DELETE FROM operator_sessions WHERE expires<=? OR credential_version!=?').run(this.clock(),this.#credentialVersion);
  this.database.prepare('INSERT INTO operator_sessions VALUES(?,?,?,?,?)').run(hash(token),role,csrf,expires,this.#credentialVersion);
  return {token,expires};
 }
 session(token:string):OperatorSession {
  if(!/^[a-f0-9]{64}$/.test(token))throw new OperationsError(401,'AUTH_REQUIRED');
  const row=this.database.prepare('SELECT * FROM operator_sessions WHERE token_hash=? AND expires>? AND credential_version=?')
   .get(hash(token),this.clock(),this.#credentialVersion) as {token_hash:string;role:'operator'|'viewer';csrf:string;expires:number;userId?:string;clinicId?:string;clinicRole?:string;permissions?:string[]}|undefined;
  if(!row)throw new OperationsError(401,'AUTH_EXPIRED');
  return {hash:row.token_hash,role:row.role,csrf:row.csrf,expires:row.expires};
 }
 /** Server-only verified principal. This is never constructed from request headers or browser claims. */
 identitySession(principal:{hash:string;userId:string;clinicId:string;clinicRole:string;permissions:string[];expires:number}):OperatorSession {
  if(principal.expires<=this.clock())throw new OperationsError(401,'AUTH_EXPIRED');
  this.database.exec('CREATE TABLE IF NOT EXISTS verified_identity_principals(session_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,clinic_id TEXT NOT NULL,membership_role TEXT NOT NULL,expires INTEGER NOT NULL)');
  this.database.prepare('INSERT INTO verified_identity_principals VALUES(?,?,?,?,?) ON CONFLICT(session_hash) DO UPDATE SET expires=excluded.expires').run(principal.hash,principal.userId,principal.clinicId,principal.clinicRole,principal.expires);
  const role=principal.clinicRole==='Viewer'?'viewer':'operator';
  const old=this.database.prepare('SELECT csrf FROM operator_sessions WHERE token_hash=?').get(principal.hash) as {csrf:string}|undefined;
  const csrf=old?.csrf??randomBytes(32).toString('hex');
  this.database.prepare('INSERT INTO operator_sessions VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET role=excluded.role,expires=excluded.expires').run(principal.hash,role,csrf,principal.expires,this.#credentialVersion);
  return {...principal,role,csrf};
 }
 issueNonce(session:OperatorSession) {
  const nonce=randomBytes(24).toString('hex');
  this.database.transaction(()=>{
   this.database.prepare('DELETE FROM operator_nonces WHERE expires<=?').run(this.clock());
   // Bound accumulation, even if an authenticated client repeatedly requests session metadata.
   this.database.prepare('DELETE FROM operator_nonces WHERE session_hash=? AND nonce_hash NOT IN (SELECT nonce_hash FROM operator_nonces WHERE session_hash=? ORDER BY expires DESC LIMIT 15)').run(session.hash,session.hash);
   this.database.prepare('INSERT INTO operator_nonces VALUES(?,?,?,NULL,NULL)').run(hash(nonce),session.hash,this.clock()+5*60_000);
  }).immediate();return nonce;
 }
 authorizeMutation(session:OperatorSession,origin:string|undefined,csrf:string|undefined,nonce:string|undefined,operator=true) {
  if(operator&&session.role!=='operator')throw new OperationsError(403,'OPERATOR_REQUIRED');
  if(origin!==this.origin||csrf!==session.csrf||!nonce||!/^[a-f0-9]{48}$/.test(nonce))throw new OperationsError(403,'CSRF_OR_NONCE_INVALID');
  const row=this.database.prepare('SELECT 1 FROM operator_nonces WHERE nonce_hash=? AND session_hash=? AND expires>?').get(hash(nonce),session.hash,this.clock());
  if(!row)throw new OperationsError(403,'CSRF_OR_NONCE_INVALID');return nonce;
 }
 /** Call inside the same transaction that creates the durable run. */
 claimNonce(session:OperatorSession,nonce:string,requestId:string,payloadHash:string) {
  const row=this.database.prepare('SELECT used_by,used_hash FROM operator_nonces WHERE nonce_hash=? AND session_hash=? AND expires>?')
   .get(hash(nonce),session.hash,this.clock()) as {used_by:string|null;used_hash:string|null}|undefined;
  if(!row||(row.used_by&&(row.used_by!==requestId||row.used_hash!==payloadHash)))throw new OperationsError(409,'NONCE_REPLAY');
  if(!row.used_by)this.database.prepare('UPDATE operator_nonces SET used_by=?,used_hash=? WHERE nonce_hash=?').run(requestId,payloadHash,hash(nonce));
 }
 revoke(session:OperatorSession){this.database.prepare('DELETE FROM operator_sessions WHERE token_hash=?').run(session.hash);this.database.prepare('DELETE FROM operator_nonces WHERE session_hash=?').run(session.hash);}
 cookie(token:string,maxAge=1800){return [`carecart_ops=${token}; HttpOnly; SameSite=Strict; Path=/api/operations; Max-Age=${maxAge}${this.origin.startsWith('https:')?'; Secure':''}`,
  this.appCookie(token,maxAge)];}
 appCookie(token:string,maxAge=1800){return `carecart_app=${token}; HttpOnly; SameSite=Strict; Path=/app; Max-Age=${maxAge}${this.origin.startsWith('https:')?'; Secure':''}`;}
}
