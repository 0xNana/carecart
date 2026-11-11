import type {NextRequest} from 'next/server';import {identityProxy} from '@/lib/identity-proxy';
async function forward(r:NextRequest,c:{params:Promise<{path:string[]}>}){return identityProxy(r,(await c.params).path);}
export const GET=forward;export const POST=forward;
