import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROXY_BODY_BYTES, ProxyBodyTooLarge, readProxyBody } from '../src/lib/proxy-body.ts';

test('accepts real JSON bytes, including UTF-8 split across stream chunks', async () => {
  const bytes = new TextEncoder().encode('{"requestId":"judge-☀"}');
  const body = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, -3)); controller.enqueue(bytes.slice(-3)); controller.close(); } });
  const request = new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit);
  assert.equal(await readProxyBody(request), new TextDecoder().decode(bytes));
});
test('rejects an excessive declared size before consuming its body', async () => {
  const request = new Request('http://localhost', { method: 'POST', body: '{}', headers: { 'Content-Length': String(MAX_PROXY_BODY_BYTES + 1) } });
  await assert.rejects(readProxyBody(request), ProxyBodyTooLarge);
  assert.equal(request.bodyUsed, false);
});
test('counts streamed bytes even when a sender lies about Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_PROXY_BODY_BYTES)); controller.enqueue(new Uint8Array(1));
    controller.enqueue(new Uint8Array(1)); controller.close();
  }, cancel() { cancelled = true; } });
  const request = new Request('http://localhost', { method: 'POST', body, duplex: 'half', headers: { 'Content-Length': '1' } } as RequestInit);
  await assert.rejects(readProxyBody(request), ProxyBodyTooLarge);
  assert.equal(cancelled, true);
});
test('accepts exactly the byte limit and rejects multibyte text above it without a length header', async () => {
  assert.equal((await readProxyBody(new Request('http://localhost', { method: 'POST', body: 'a'.repeat(MAX_PROXY_BODY_BYTES) }))).length, MAX_PROXY_BODY_BYTES);
  await assert.rejects(readProxyBody(new Request('http://localhost', { method: 'POST', body: '☀'.repeat(6000) })), ProxyBodyTooLarge);
});
