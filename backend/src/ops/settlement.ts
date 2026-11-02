import { readFileSync } from 'node:fs';
import { mainnetSafetyProfile } from '../profiles/mainnet';
import { SafetyVaultClient } from '../near/safety-client';
import { SettlementOrderSchema, SettlementQuotes } from '../intents/settlement';
import { SettlementJournal } from '../intents/journal';
import { SettlementRecovery } from '../intents/recovery';
import { OperationJournal } from '../near/operation-journal';
import { roleCredentials } from './role-credentials';

/** Manual operational entry point. Nothing is registered in the browser/API preview routes. */
async function main() {
  const [action, profilePath, attemptId, argument, reviewHash] =
    process.argv.slice(2);
  if (
    !['prepare', 'commit', 'request', 'review', 'revalidate', 'observe', 'recover'].includes(
      action ?? '',
    ) ||
    !profilePath ||
    !attemptId
  )
    throw new Error(
      'Use prepare|commit|request|review|revalidate|observe|recover PROFILE.json ATTEMPT_ID [ORDER.json|STORAGE_YOCTO|REVIEW.json|TX_HASH|BASE_RPC_URL] [REVIEW_HASH]',
    );
  const { profile, fingerprint } = mainnetSafetyProfile(
    JSON.parse(readFileSync(profilePath, 'utf8')),
  );
  if (profile.network !== 'mainnet')
    throw new Error(
      'Real 1Click settlement has no testnet deployment; use offline tests',
    );
  const journal = new SettlementJournal(profile.databasePath, fingerprint);
  try {
    if (action === 'prepare') {
      if (!argument) throw new Error('Reviewed order JSON required');
      const order = SettlementOrderSchema.parse(
        JSON.parse(readFileSync(argument, 'utf8')),
      );
      if (order.vault !== profile.vault || order.treasury !== profile.treasury)
        throw new Error('Order profile mismatch');
      const quote = await new SettlementQuotes(
        process.env.ONECLICK_SETTLEMENT_API_KEY ?? '',
      ).prepare(order);
      console.info(JSON.stringify(journal.prepare(attemptId, quote), null, 2));
      return;
    }
    const attempt = journal.get(attemptId);
    if (action === 'commit' || action === 'request') {
      if (
        process.env.CARECART_SAFETY_WRITES !== 'approved' ||
        reviewHash !== attempt.reviewHash
      )
        throw new Error(
          'Exact reviewed attempt hash and separately approved write mode required',
        );
      const credentials = roleCredentials(action === 'commit' ? 'committer' : 'requester');
      const operations = new OperationJournal(profile.databasePath, fingerprint);
      try {
        if (action === 'commit') {
          if (!argument || !process.env.SAFETY_COMMITTER_PRIVATE_KEY)
            throw new Error(
              'Reviewed storage budget and isolated committer credential required',
            );
          const client = new SafetyVaultClient(profile, credentials, operations);
          const q = attempt.quote;
          await client.commitOrder({
            po_id: q.order.poId,
            profile: 'mainnet',
            supplier: q.order.supplier,
            token: q.order.token,
            amount: q.order.amount,
            invoice_digest: q.order.invoiceDigest,
            destination: await client.reviewedBaseDestination(q),
          });
          console.info(await client.commitQuote(attemptId, q, argument));
          return;
        }
        if (!process.env.SAFETY_REQUESTER_PRIVATE_KEY)
          throw new Error('Isolated requester credential required');
        console.info(
          await new SafetyVaultClient(profile, credentials, operations).requestCrosschain(attempt.poId, attemptId),
        );
        return;
      } finally {
        operations.close();
      }
    }
    const client = new SafetyVaultClient(profile);
    if (action === 'observe') {
      if (!argument)
        throw new Error('Final human approval transaction hash required');
      console.info(
        JSON.stringify(
          await client.observeDispatch(attemptId, argument, journal),
          null,
          2,
        ),
      );
      return;
    }
    await client.reconcile(attemptId, journal);
    if (action === 'revalidate') {
      if (!argument) throw new Error('Previously reviewed approval JSON required');
      console.info(JSON.stringify(await client.revalidateApproval(
        attemptId, JSON.parse(readFileSync(argument, 'utf8')), journal,
      ), null, 2));
      return;
    }
    if (action === 'review') {
      console.info(
        JSON.stringify(
          await client.approvalReview(attemptId, journal),
          null,
          2,
        ),
      );
      return;
    }
    if (!argument) throw new Error('Independent Base HTTPS RPC required');
    const refunds = process.env.SAFETY_REFUND_SIGNERS_JSON
      ? (JSON.parse(process.env.SAFETY_REFUND_SIGNERS_JSON) as Record<
          string,
          string
        >)
      : {};
    console.info(
      JSON.stringify(
        await new SettlementRecovery(
          new SettlementQuotes(process.env.ONECLICK_SETTLEMENT_API_KEY ?? ''),
          profile.rpcUrl,
          argument,
        ).reconcile(journal, attemptId, refunds),
        null,
        2,
      ),
    );
  } finally {
    journal.close();
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'Settlement operation stopped. Check profile, quote expiry, canonical state and local configuration. Never blindly retry an ambiguous dispatch.',
    );
    process.exitCode = 1;
  });
