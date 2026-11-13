'use server';
import {cookies,headers} from 'next/headers';import {redirect} from 'next/navigation';import {supabaseServer} from '@/lib/supabase/server';import {allowedOrigin,authConfiguration,safeAuthNext} from '@/lib/auth-config';import {establishIdentitySession,identityContext,backendIdentity} from '@/lib/identity-backend';
export interface AuthState {message:string;error:boolean}
export async function authAction(_previous:AuthState,form:FormData):Promise<AuthState>{
 let destination:string|undefined;
 try{const config=authConfiguration();if(!allowedOrigin((await headers()).get('origin'),config.origin))throw new Error('Origin');
  const mode=String(form.get('mode')),email=String(form.get('email')??'').trim(),password=String(form.get('password')??''),next=safeAuthNext(form.get('next'),'/onboarding',config.cleanPaths);
  if(!['login','signup','forgot-password','reset-password'].includes(mode))throw new Error('Invalid mode');
  if(mode!=='reset-password'&&(email.length>254||!/^\S+@\S+\.\S+$/.test(email)))return {message:'Enter a valid email address.',error:true};
  if(mode!=='forgot-password'&&(password.length<(mode==='login'?1:12)||password.length>128))return {message:'Use a password between 12 and 128 characters.',error:true};
  if(['signup','reset-password'].includes(mode)&&password!==String(form.get('confirmation')))return {message:'The passwords do not match.',error:true};
  const supabase=await supabaseServer();
  if(mode==='signup'){const result=await supabase.auth.signUp({email,password,options:{emailRedirectTo:config.origin+'/auth/callback?next='+encodeURIComponent(next)}});if(result.error)return {message:'Registration could not be completed. Check the form or try again later.',error:true};if(result.data.session){await supabase.auth.signOut({scope:'local'});return {message:'Email confirmation must be enabled for this project before onboarding can continue.',error:true};}return {message:'Check your email to verify your identity, then return to create your clinic.',error:false};}
  if(mode==='forgot-password'){const result=await supabase.auth.resetPasswordForEmail(email,{redirectTo:config.origin+'/auth/callback?next=/reset-password'});if(result.error)throw result.error;return {message:'If the account is eligible, a password recovery email will arrive shortly.',error:false};}
  if(mode==='reset-password'){const user=await supabase.auth.getUser();if(!user.data.user?.email_confirmed_at)return {message:'Open a valid recovery link or sign in before changing your password.',error:true};const context=await identityContext();const result=await supabase.auth.updateUser({password});if(result.error)throw result.error;const revoked=await backendIdentity('identity/revoke-all',{method:'POST',headers:{'x-csrf-token':context.csrf,'x-operation-nonce':context.nonce},body:JSON.stringify({requestId:crypto.randomUUID()})});if(!revoked.ok)throw new Error('Session revocation failed');await supabase.auth.signOut({scope:'global'});const jar=await cookies();for(const c of jar.getAll())if(c.name.startsWith('carecart_supabase')||['carecart_identity','carecart_clinic'].includes(c.name))jar.delete(c.name);destination='/login';}
  else {const result=await supabase.auth.signInWithPassword({email,password});if(result.error)return {message:'Sign-in failed. Check your credentials and verify your email.',error:true};await establishIdentitySession();destination=next;}
 }catch{return {message:'Authentication is unavailable or configuration is incomplete. No clinic access was granted.',error:true};}
 if(destination)redirect(destination);return {message:'Authentication could not be completed.',error:true};
}
