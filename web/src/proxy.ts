import {createServerClient} from '@supabase/ssr';import {NextResponse,type NextRequest} from 'next/server';import {authConfiguration,supabaseMode} from './lib/auth-config';
/** Refresh only. Protected layouts and the backend independently validate identity and membership. */
export async function proxy(request:NextRequest){if(!supabaseMode())return NextResponse.next();let config;try{config=authConfiguration();}catch{return NextResponse.next();}
 let response=NextResponse.next({request});const supabase=createServerClient(config.url,config.key,{cookieOptions:{name:'carecart_supabase',httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'},cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{for(const v of values)request.cookies.set(v.name,v.value);response=NextResponse.next({request});for(const v of values)response.cookies.set(v.name,v.value,{...v.options,httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'});}}});
 await supabase.auth.getClaims();response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/app/:path*','/onboarding','/login','/signup','/reset-password','/api/operations/:path*','/api/identity/:path*']};
