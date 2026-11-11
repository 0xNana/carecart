import { readProxyBody,ProxyBodyTooLarge } from './proxy-body.ts';
/** Same-origin cookie proxy. No operator credential or blockchain key is configured in Next.js. */
export async function proxyOperatorRequest(request:Request,path:string[],upstream='http://127.0.0.1:3002',fetcher:typeof fetch=fetch) {
 const route=path.join('/');const allowed=operationsRouteAllowed(request.method,route);
 if(!allowed)return Response.json({error:{code:'ENDPOINT_UNAVAILABLE'}},{status:404});
 const url=new URL(request.url);const host=request.headers.get('host') ?? url.host;
 if(!/^(localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(host))return Response.json({error:{code:'LOCAL_ORIGIN_REQUIRED'}},{status:403});
 const origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(request.method==='POST'&&origin!==`${url.protocol}//${host}`))
  return Response.json({error:{code:'ORIGIN_FORBIDDEN'}},{status:403});
 try {
  const target=new URL(upstream);
  if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||!target.port||target.username||target.password||target.pathname!=='/'||target.search||target.hash)
   return Response.json({error:{code:'LOCAL_SERVICE_REQUIRED'}},{status:503});
  const headers=new Headers({'Content-Type':'application/json'});
  const cookies=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>/^carecart_ops=[a-f0-9]{64}$/.test(s));
  if(cookies.length===1)headers.set('Cookie',cookies[0]);
  for(const name of ['origin','x-csrf-token','x-operation-nonce','sec-fetch-site']){const value=request.headers.get(name);if(value&&value.length<=256)headers.set(name,value);}
  const body=request.method==='POST'?await readProxyBody(request):undefined;
  const response=await fetcher(new URL(`/api/operations/${route}${url.search}`,target),{method:request.method,headers,body,
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(route==='runs'?70000:10000)});
  const outHeaders=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Cookie'});
  for(const cookie of response.headers.getSetCookie().filter(value=>/^(?:carecart_ops|carecart_app)=/.test(value)))
   outHeaders.append('Set-Cookie',cookie);
  const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let length=0;
  if(reader)try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>2*1024*1024){await reader.cancel();throw new Error('Response too large');}chunks.push(next.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new Response(bytes,{status:response.status,headers:outHeaders});
 }catch(cause){return Response.json({error:{code:cause instanceof ProxyBodyTooLarge?'BODY_TOO_LARGE':'OPERATIONS_UNAVAILABLE'}},{status:cause instanceof ProxyBodyTooLarge?413:503});}
}

export function operationsRouteAllowed(method:string,route:string){return method==='GET'
  ? /^(session|inventory|catalog|stock|cases|runs|cases\/[A-Za-z0-9_-]{1,64}(?:\/(?:events|runs|financial-review))?|runs\/[a-f0-9-]{36}|wallet-reviews\/[a-f0-9-]{36})$/.test(route)
  : method==='POST'&&(/^(login|logout|runs)$/.test(route)||/^runs\/[a-f0-9-]{36}\/reconcile$/.test(route)||
    /^cases\/[A-Za-z0-9_-]{1,64}\/(wallet-reviews|financial-authorizations)$/.test(route)||/^wallet-reviews\/[a-f0-9-]{36}\/(handoff|report|reconcile|mock-wallet)$/.test(route)||/^stock\/(movements|autonomy|catalog-refresh)$/.test(route)||/^financial-authorizations\/[a-f0-9-]{36}\/(simulate|reconcile)$/.test(route));}
