import {createRemoteJWKSet,jwtVerify,customFetch} from 'jose';
import {z} from 'zod';
import {OperationsError} from '../operations/auth';
export interface VerifiedIdentity {userId:string;sessionId:string;email:string;expires:number}
export interface SupabaseConfiguration {url:string;publishableKey:string;origin:string}
export function identityConfiguration(env:NodeJS.ProcessEnv):SupabaseConfiguration {
 if(env.CARECART_AUTH_MODE!=='supabase')throw new Error('Explicit Supabase auth mode required');
 const url=new URL(env.SUPABASE_URL??''),origin=new URL(env.CARECART_PUBLIC_ORIGIN??'');
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||
  (origin.protocol!=='https:'&&!['http://localhost','http://127.0.0.1'].some(p=>origin.origin.startsWith(p+':')))||origin.origin!==env.CARECART_PUBLIC_ORIGIN)throw new Error('Explicit HTTPS identity/public origin configuration required');
 const key=env.SUPABASE_PUBLISHABLE_KEY??'';if(!key.startsWith('sb_publishable_')||key.length<25)throw new Error('Public Supabase publishable key required; service-role and legacy shared JWT keys are unsupported');
 return {url:url.origin,publishableKey:key,origin:origin.origin};
}
/** Signature verification and fresh Auth-server identity checks. No client identity headers are accepted. */
export class SupabaseIdentity {
 readonly issuer:string;readonly keys:ReturnType<typeof createRemoteJWKSet>;
 constructor(readonly config:SupabaseConfiguration,readonly fetcher:typeof fetch=fetch,fixture=false){
  const url=new URL(config.url);if((url.protocol!=='https:'&&!(fixture&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Identity endpoint configuration invalid');
  this.issuer=url.origin+'/auth/v1';this.keys=createRemoteJWKSet(new URL(this.issuer+'/.well-known/jwks.json'),{cooldownDuration:fixture?0:5000,cacheMaxAge:300000,timeoutDuration:5000,[customFetch]:fetcher});
 }
 async verify(token:string):Promise<VerifiedIdentity>{
  try{
   if(!token||token.length>16000)throw new Error('Token invalid');
   const {payload,protectedHeader}=await jwtVerify(token,this.keys,{issuer:this.issuer,audience:'authenticated',algorithms:['ES256','RS256'],requiredClaims:['exp','iat','sub','session_id'],clockTolerance:0});
   if(!protectedHeader.kid||payload.role!=='authenticated'||payload.is_anonymous===true||typeof payload.iat!=='number'||payload.iat>Date.now()/1000+5)throw new Error('Identity claims invalid');
   const userId=z.uuid().parse(payload.sub),sessionId=z.uuid().parse(payload.session_id);
   const response=await this.fetcher(this.issuer+'/user',{headers:{Authorization:'Bearer '+token,apikey:this.config.publishableKey},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw new Error('Identity revoked');const user=await response.json() as {id?:string;email?:string;email_confirmed_at?:string;is_anonymous?:boolean};
   if(payload.exp!*1000<=Date.now()||user.id!==userId||!user.email_confirmed_at||!Number.isFinite(Date.parse(user.email_confirmed_at))||user.is_anonymous||user.email?.toLowerCase()!==String(payload.email).toLowerCase())throw new Error('Verified email required');
   return {userId,sessionId,email:z.email().parse(user.email).toLowerCase(),expires:payload.exp!*1000};
  }catch{throw new OperationsError(401,'IDENTITY_INVALID_OR_UNVERIFIED');}
 }
}
