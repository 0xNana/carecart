import 'server-only';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {supabaseMode,authConfiguration} from './auth-config';
import {identityContext,type ClinicContext} from './identity-backend';
import {verifyAppSession} from './app-access';

/** Also called by retired pages: a child redirect must not race the layout's auth check. */
export async function requireApplicationAccess():Promise<{role:'operator'|'viewer';tenant?:{clinic:ClinicContext;clinics:ClinicContext[];email:string}}|null>{
 if(supabaseMode()){
  try{authConfiguration();}catch{return null;}
  let context;try{context=await identityContext();}catch{redirect('/login?next=%2Fapp');}
  const active=(await cookies()).get('carecart_clinic')?.value;
  const clinic=context.clinics.find(c=>c.id===active);
  if(!clinic)redirect('/onboarding');
  return {role:clinic.role==='Viewer'?'viewer':'operator',tenant:{clinic,clinics:context.clinics,email:context.email}};
 }
 const access=await verifyAppSession((await cookies()).get('carecart_app')?.value);
 if(!access)redirect('/operations?next=%2Fapp');
 return access;
}
