import { vaultConfig, vaultReader } from '@/lib/vault-rpc';
export async function GET() {
  try { return Response.json(await vaultReader(vaultConfig()).state(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return Response.json({ error: { message: cause instanceof Error ? cause.message : 'Could not read the testnet vault.' } }, { status: 503 }); }
}
