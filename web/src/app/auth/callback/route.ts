import {NextResponse,type NextRequest} from 'next/server';import {authConfiguration,safeAuthNext} from '@/lib/auth-config';import {supabaseServer} from '@/lib/supabase/server';import {establishIdentitySession} from '@/lib/identity-backend';
export async function GET(request:NextRequest){let origin:string,cleanPaths:boolean;try{const config=authConfiguration();origin=config.origin;cleanPaths=config.cleanPaths;}catch{return NextResponse.json({error:'Identity configuration is incomplete'},{status:503});}
 const next=safeAuthNext(request.nextUrl.searchParams.get('next'),'/onboarding',cleanPaths);try{const supabase=await supabaseServer(),code=request.nextUrl.searchParams.get('code'),token=request.nextUrl.searchParams.get('token_hash'),type=request.nextUrl.searchParams.get('type');
  if(code&&code.length<=4096){const result=await supabase.auth.exchangeCodeForSession(code);if(result.error)throw result.error;}
  else if(token&&token.length<=512&&['signup','recovery','email'].includes(type??'')){const result=await supabase.auth.verifyOtp({token_hash:token,type:type as 'signup'|'recovery'|'email'});if(result.error)throw result.error;}
  else throw new Error('Callback invalid');
  await establishIdentitySession();return NextResponse.redirect(new URL(next,origin),{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.redirect(new URL('/login?error=verification_failed',origin),{headers:{'Cache-Control':'no-store'}});}
}
