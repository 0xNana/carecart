const signingCredentialName=/(?:PRIVATE_KEY|SECRET_KEY|MNEMONIC|(?:^|_)SEED(?:_|$))/i;
export function assertNoSigningCredentials(env:Record<string,string|undefined>=process.env){if(Object.entries(env).some(([name,value])=>!!value&&signingCredentialName.test(name)))throw new Error('Web process must not receive signing credentials.');}
export function supabaseMode(env:Record<string,string|undefined>=process.env){assertNoSigningCredentials(env);if(env.CARECART_AUTH_MODE&&!['supabase','legacy-local'].includes(env.CARECART_AUTH_MODE))throw new Error('Unsupported CareCart authentication profile');return env.CARECART_AUTH_MODE==='supabase';}
export function authConfiguration(env:Record<string,string|undefined>=process.env){
 if(!supabaseMode(env))throw new Error('Supabase authentication is not configured. Set the explicit Supabase profile before using these forms.');
 const url=new URL(env.SUPABASE_URL??''),site=new URL(env.CARECART_PUBLIC_ORIGIN??'');const key=env.SUPABASE_PUBLISHABLE_KEY??'';
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||site.origin!==env.CARECART_PUBLIC_ORIGIN||
  (site.protocol!=='https:'&&!(site.protocol==='http:'&&['127.0.0.1','localhost'].includes(site.hostname)))||!key.startsWith('sb_publishable_')||key.length<25)throw new Error('CareCart identity configuration is incomplete. Configure the HTTPS Supabase URL, publishable key and canonical application origin.');
 return {url:url.origin,key,origin:site.origin,secure:site.protocol==='https:',cleanPaths:site.protocol==='https:'&&site.hostname.startsWith('app.')};
}
export function safeAuthNext(value:unknown,fallback='/onboarding',cleanPaths=false) {
 if(typeof value!=='string')return fallback;
 if(/^\/app\/playground(?:\/testnet)?$/.test(value))return cleanPaths?'/':'/app';
 if(/^\/app(?:\/(?:inventory|replenishment|suppliers|payments|activity|settings))?$/.test(value))return cleanPaths?(value.slice(4)||'/'):value;
 if(/^\/(?:onboarding(?:\?invite=[a-f0-9]{64})?|reset-password)$/.test(value))return value;
 if(cleanPaths&&/^\/(?:inventory|replenishment|suppliers|payments|activity|settings)?$/.test(value))return value;
 return fallback;
}
export function identityBackendUrl(env:Record<string,string|undefined>=process.env){const u=new URL(env.CARECART_OPERATIONS_API_URL??'http://127.0.0.1:3002');if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Fixed identity backend origin required');if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port)return u.origin;const pub=env.CARECART_PUBLIC_ORIGIN?new URL(env.CARECART_PUBLIC_ORIGIN):null;const sibling=pub?.hostname.startsWith('app.')?'api.'+pub.hostname.slice(4):null;if(u.protocol==='https:'&&pub&&pub.protocol==='https:'&&u.port===pub.port&&(u.hostname===pub.hostname||u.hostname.endsWith('.'+pub.hostname)||u.hostname===sibling))return u.origin;throw new Error('Fixed loopback or same-domain HTTPS identity backend required');}
export function allowedOrigin(actual:string|null|undefined,expected:string){if(actual===expected)return true;try{const a=new URL(actual??''),b=new URL(expected);if(a.protocol==='http:'&&b.protocol==='http:'&&a.port===b.port&&['127.0.0.1','localhost'].includes(a.hostname)&&['127.0.0.1','localhost'].includes(b.hostname))return true;return a.protocol==='https:'&&b.protocol==='https:'&&a.port===b.port&&(a.hostname==='www.'+b.hostname||b.hostname==='www.'+a.hostname);}catch{return false;}}
