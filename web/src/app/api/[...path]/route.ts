import type { NextRequest } from 'next/server';
import { ProxyBodyTooLarge, readProxyBody } from '@/lib/proxy-body';

async function forward(request: NextRequest, context: RouteContext<'/api/[...path]'>) {
  const { path } = await context.params;
  const route = path.join('/');
  const allowed = request.method === 'GET'
    ? route === 'dashboard' || route === 'intents/config' || /^inventory\/item-[0-9]{6}\/forecast$/.test(route)
    : request.method === 'POST' && ['supplier-quotes', 'purchase-orders', 'intents/preview', 'intents/dry-quote'].includes(route);
  if (!allowed) return Response.json({ error: { message: 'Endpoint not available in this dashboard' } }, { status: 404 });
  const origin = request.headers.get('origin');
  // Next may normalize nextUrl's hostname; compare against the browser's actual Host header.
  if (request.method === 'POST' && origin !== `${request.nextUrl.protocol}//${request.headers.get('host')}`) {
    return Response.json({ error: { message: 'Request origin is not allowed' } }, { status: 403 });
  }
  try {
    const upstream = await fetch(new URL(`/api/${route}`, process.env.CARECART_API_URL || 'http://127.0.0.1:3001'), {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: request.method === 'POST' ? await readProxyBody(request) : undefined,
      cache: 'no-store', signal: AbortSignal.timeout(route === 'intents/dry-quote' ? 30000 : 10000), redirect: 'error',
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (cause) {
    if (cause instanceof ProxyBodyTooLarge) return Response.json({ error: { message: cause.message } }, { status: 413 });
    return Response.json({ error: { message: 'The procurement service is unavailable. Start the backend and try again.' } }, { status: 503 });
  }
}
export const GET = forward;
export const POST = forward;
