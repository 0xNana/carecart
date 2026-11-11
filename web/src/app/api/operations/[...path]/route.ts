import type { NextRequest } from 'next/server';
import {supabaseMode} from '@/lib/auth-config';
import {identityProxy} from '@/lib/identity-proxy';
import {operationsRouteAllowed} from '@/lib/operator-proxy';
import { proxyOperatorRequest } from '@/lib/operator-proxy';
async function forward(request:NextRequest,context:RouteContext<'/api/operations/[...path]'>){
 const {path}=await context.params;if(supabaseMode()){if(!operationsRouteAllowed(request.method,path.join('/')))return Response.json({error:{code:'ENDPOINT_UNAVAILABLE'}},{status:404});return identityProxy(request,path,true);}return proxyOperatorRequest(request,path,process.env.CARECART_OPERATIONS_API_URL);
}
export const GET=forward;export const POST=forward;
