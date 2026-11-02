export const MAX_PROXY_BODY_BYTES = 16 * 1024;
export class ProxyBodyTooLarge extends Error {
  constructor() { super('Request body exceeds the 16 KiB dashboard limit.'); }
}

/** Bound actual streamed bytes before buffering, even without a trustworthy Content-Length. */
export async function readProxyBody(request: Request): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(MAX_PROXY_BODY_BYTES)) throw new ProxyBodyTooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROXY_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ProxyBodyTooLarge();
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
