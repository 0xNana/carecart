import 'server-only';
import {createServerClient} from '@supabase/ssr';import {cookies} from 'next/headers';import {authConfiguration} from '../auth-config';
/** Server-only PKCE/SSR storage. No browser Auth client or service-role secret is used. */
export async function supabaseServer(){const config=authConfiguration(),jar=await cookies();return createServerClient(config.url,config.key,{cookieOptions:{name:'carecart_supabase',httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'},cookies:{getAll:()=>jar.getAll(),setAll:values=>{try{for(const v of values)jar.set(v.name,v.value,{...v.options,httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'});}catch{/* Server Components cannot write; the request Proxy performs refresh. */}}}});}
