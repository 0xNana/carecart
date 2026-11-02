import { vaultConfig, vaultReader } from '@/lib/vault-rpc';
export async function GET(_request: Request, context: { params: Promise<{ poId: string }> }) {
  const { poId } = await context.params;
  if (!/^po-[0-9]{6}$/.test(poId)) return Response.json({ error: { message: 'Invalid purchase order ID.' } }, { status: 400 });
  try { return Response.json(await vaultReader(vaultConfig()).payment(poId), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return Response.json({ error: { message: cause instanceof Error ? cause.message : 'Could not read the payment.' } }, { status: 503 }); }
}
