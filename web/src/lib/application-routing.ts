/** Public host routing. Internal /app routes retain their protected layout. */
export type SiteOrigins={app:string;site:string};
export function siteOrigins(env:Record<string,string|undefined>=process.env):SiteOrigins|null{
 try{const u=new URL(env.CARECART_PUBLIC_ORIGIN??'');if(u.protocol!=='https:'||u.origin!==env.CARECART_PUBLIC_ORIGIN||!u.hostname.startsWith('app.')||u.port)return null;return {app:u.origin,site:'https://'+u.hostname.slice(4)};}catch{return null;}
}
export function applicationPublicPath(path:string,cleanPaths:boolean){return cleanPaths?path.replace(/^\/app(?=\/|[?#]|$)/,'').replace(/^([?#]|$)/,'/$1'):path;}
export function applicationInternalPath(path:string){return /^\/app(?:\/|$)/.test(path)?path:path==='/'?'/app':'/app'+path;}
export function isApplicationPath(path:string){return /^\/(?:inventory|replenishment|suppliers|payments|activity|settings)?$/.test(path);}
export function siteRoute(url:URL,origins:SiteOrigins|null):{kind:'next'|'rewrite'|'redirect';path?:string;url?:string}{
 if(!origins)return {kind:'next'};
 const app=url.origin===origins.app,site=url.origin===origins.site||url.origin===origins.site.replace('https://','https://www.');
 if(!app&&!site)return {kind:'next'};
 const path=url.pathname,legacy=path==='/app'||path.startsWith('/app/'),auth=/^\/(?:login|signup|forgot-password|reset-password|onboarding|auth\/callback)$/.test(path);
 if((site&&(legacy||auth||path==='/operations'))||(app&&(legacy||path==='/operations'))){const target=new URL(url);target.host=new URL(origins.app).host;target.pathname=path==='/operations'||/^\/app\/playground(?:\/testnet)?$/.test(path)?'/':applicationPublicPath(path,true);return {kind:'redirect',url:target.href};}
 if(app&&(path==='/docs'||path.startsWith('/docs/')||path==='/docs-search')){const target=new URL(url);target.host=new URL(origins.site).host;return {kind:'redirect',url:target.href};}
 if(app&&isApplicationPath(path))return {kind:'rewrite',path:applicationInternalPath(path)};
 return {kind:'next'};
}
