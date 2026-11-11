import {authConfiguration,identityBackendUrl} from '@/lib/auth-config';

/** Readiness only. Never queries public chains or returns configuration details. */
export async function GET(){
 try{
  authConfiguration();
  const response=await fetch(identityBackendUrl()+'/healthz',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!response.ok||(await response.json()).status!=='ok')throw new Error('Backend unavailable');
  return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
