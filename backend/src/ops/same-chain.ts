import { readFileSync } from 'node:fs';
import { mainnetSafetyProfile } from '../profiles/mainnet';
import { SafetyOrderSchema } from '../near/commitments';
import { SafetyVaultClient } from '../near/safety-client';
import { OperationJournal } from '../near/operation-journal';
import { digest } from '../intents/settlement';
import { roleCredentials } from './role-credentials';

/** Separate human-invoked worker processes; no dotenv, admin signer, scheduler or public API. */
async function main() {
  const [action, profilePath, input, expectedHash] = process.argv.slice(2);
  if (!['inspect', 'commit', 'review', 'request'].includes(action ?? '') || !profilePath || !input)
    throw new Error('Use inspect|commit MANIFEST ORDER.json [PO_HASH], or review|request MANIFEST PO_ID [PO_HASH]');
  const { profile, fingerprint } = mainnetSafetyProfile(JSON.parse(readFileSync(profilePath, 'utf8')));
  const reader = new SafetyVaultClient(profile);
  const order = action === 'inspect' || action === 'commit'
    ? SafetyOrderSchema.parse(JSON.parse(readFileSync(input, 'utf8')))
    : await reader.canonicalOrder(input);
  if (order.profile !== profile.network || order.token !== profile.token || order.destination !== 'Near')
    throw new Error('Canonical same-chain order/profile required');
  const poHash = digest(order);
  if (action === 'inspect' || action === 'review') {
    console.info(JSON.stringify({ order, poHash, profileFingerprint: fingerprint }, null, 2));
    return;
  }
  if (process.env.CARECART_SAFETY_WRITES !== 'approved' || expectedHash !== poHash)
    throw new Error('Exact reviewed PO hash and separately approved write mode required');
  const credentials = roleCredentials(action === 'commit' ? 'committer' : 'requester');
  const operations = new OperationJournal(profile.databasePath, fingerprint);
  try {
    const client = new SafetyVaultClient(profile, credentials, operations);
    console.info(action === 'commit' ? await client.commitOrder(order) : await client.submitPayment(order.po_id));
  } finally { operations.close(); }
}
if (require.main === module) void main().catch(() => {
  console.error('Same-chain operation stopped. Check the canonical PO and durable operation state before any retry.');
  process.exitCode = 1;
});
