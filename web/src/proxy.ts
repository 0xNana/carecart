import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
import {authConfiguration,supabaseMode} from './lib/auth-config';
import {siteOrigins,siteRoute} from './lib/application-routing';

/** Refresh only. Protected layouts and the backend validate identity and membership. */
export async function proxy(request:NextRequest){
 const publicUrl=new URL(request.nextUrl);
 const host=request.headers.get('host');
 if(host){const authority=new URL(publicUrl.protocol+'//'+host);publicUrl.host=authority.host;publicUrl.port=authority.port;}
 if(request.headers.get('x-forwarded-proto')==='https')publicUrl.protocol='https:';
 const route=siteRoute(publicUrl,siteOrigins());
 // Never forward a submitted password across hosts when following an old form.
 if(route.kind==='redirect')return NextResponse.redirect(route.url!,request.method==='GET'||request.method==='HEAD'?308:303);
 const protectedPath=route.kind==='rewrite'||/^\/(?:app(?:\/|$)|onboarding|login|signup|forgot-password|reset-password|auth\/callback|api\/(?:operations|identity)(?:\/|$))/.test(request.nextUrl.pathname);
 const requestHeaders=new Headers(request.headers);
 requestHeaders.delete('x-carecart-application-path');
 if(route.kind==='rewrite')requestHeaders.set('x-carecart-application-path',request.nextUrl.pathname);
 const respond=()=>route.kind==='rewrite'?NextResponse.rewrite(new URL(route.path!,request.url),{request:{headers:requestHeaders}}):NextResponse.next({request:{headers:requestHeaders}});
 if(!protectedPath||!supabaseMode())return respond();
 let config;try{config=authConfiguration();}catch{return respond();}
 let response=respond();
 const supabase=createServerClient(config.url,config.key,{cookieOptions:{name:'carecart_supabase',httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'},cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{
  for(const v of values)request.cookies.set(v.name,v.value);
  requestHeaders.set('cookie',request.cookies.toString());response=respond();
  for(const v of values)response.cookies.set(v.name,v.value,{...v.options,httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'});
 }}});
 await supabase.auth.getClaims();response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|txt|xml|webmanifest)$).*)']};
