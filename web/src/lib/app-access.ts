export interface AppAccess {
  role: 'operator' | 'viewer';
}

const defaultOperationsUrl = 'http://127.0.0.1:3002';

export async function verifyAppSession(
  token: string | undefined,
  fetcher: typeof fetch = fetch,
  operationsUrl = process.env.CARECART_OPERATIONS_API_URL || defaultOperationsUrl,
): Promise<AppAccess | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const service = new URL(operationsUrl);
  if (service.protocol !== 'http:' || service.hostname !== '127.0.0.1' || !service.port ||
    service.username || service.password || service.pathname !== '/' || service.search || service.hash) {
    throw new Error('Authenticated app requires the configured loopback operations service.');
  }

  const response = await fetcher(new URL('/api/operations/session', service), {
    headers: { Cookie: `carecart_ops=${token}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Operations session verification failed (${response.status}).`);

  const session: unknown = await response.json();
  if (!session || typeof session !== 'object' ||
    !['operator', 'viewer'].includes((session as { role?: string }).role ?? '') ||
    !/^[a-f0-9]{64}$/.test((session as { profileFingerprint?: string }).profileFingerprint ?? '') ||
    !/^[a-f0-9]{64}$/.test((session as { csrf?: string }).csrf ?? '') ||
    !/^[a-f0-9]{48}$/.test((session as { nonce?: string }).nonce ?? '')) {
    throw new Error('Operations returned invalid session evidence.');
  }

  return { role: (session as { role: AppAccess['role'] }).role };
}
