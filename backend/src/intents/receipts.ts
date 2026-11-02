import { BASE_USDC, NEAR_USDC, type VerifiedQuote } from './settlement';
import { z } from 'zod';
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const block = z.object({ number: hex, hash });
const receipt = z.object({
  transactionHash: hash,
  status: hex,
  blockNumber: hex,
  blockHash: hash,
  logs: z.array(
    z.object({
      address: z.string(),
      topics: z.array(hash),
      data: hex,
      logIndex: hex,
      removed: z.boolean().optional(),
    }),
  ),
});
const TRANSFER =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Independent Base RPC; finalized canonical block + successful native-USDC transfer to fixed recipient. */
export async function verifyBaseReceipt(
  q: VerifiedQuote,
  hashes: string[],
  minimum: string,
  rpc: Rpc,
) {
  if ((await rpc('eth_chainId', [])) !== '0x2105')
    throw new Error('Base mainnet RPC required');
  const finalized = block.parse(
    await rpc('eth_getBlockByNumber', ['finalized', false]),
  );
  for (const h of hashes) {
    hash.parse(h);
    const raw = await rpc('eth_getTransactionReceipt', [h]);
    if (!raw) continue;
    const r = receipt.parse(raw);
    if (
      r.transactionHash.toLowerCase() !== h.toLowerCase() ||
      r.status !== '0x1' ||
      BigInt(r.blockNumber) > BigInt(finalized.number)
    )
      continue;
    const canonical = block.parse(
      await rpc('eth_getBlockByNumber', [r.blockNumber, false]),
    );
    if (
      BigInt(canonical.number) !== BigInt(r.blockNumber) ||
      canonical.hash.toLowerCase() !== r.blockHash.toLowerCase()
    )
      continue;
    const matches = r.logs.filter(
      (l) =>
        !l.removed &&
        l.address.toLowerCase() === BASE_USDC &&
        l.topics.length === 3 &&
        l.topics[0].toLowerCase() === TRANSFER &&
        l.topics[2].toLowerCase() ===
          `0x${q.order.recipient.slice(2).toLowerCase().padStart(64, '0')}` &&
        /^0x[0-9a-fA-F]{64}$/.test(l.data),
    );
    const amount = matches.reduce((sum, l) => sum + BigInt(l.data), 0n);
    if (amount >= BigInt(minimum))
      return {
        key: `base:${h.toLowerCase()}:${q.order.recipient.toLowerCase()}`,
        evidence: {
          chainId: 8453,
          transactionHash: h,
          blockHash: r.blockHash,
          blockNumber: r.blockNumber,
          token: BASE_USDC,
          recipient: q.order.recipient,
          amount: amount.toString(),
          finality: 'finalized',
        },
      };
  }
  return null;
}
const outcome = z.object({
  id: z.string(),
  outcome: z.object({
    executor_id: z.string(),
    logs: z.array(z.string()),
    status: z.record(z.string(), z.unknown()),
  }),
});
const nearFinal = z.object({
  final_execution_status: z.literal('FINAL'),
  status: z.object({ SuccessValue: z.string() }),
  transaction: z.object({ hash: z.string() }),
  receipts_outcome: z.array(outcome),
});
/** Input must come from an independent mainnet tx RPC, never from a user-supplied proof object. */
export function verifyNearRefund(
  q: VerifiedQuote,
  txHash: string,
  minimum: string,
  raw: unknown,
) {
  const tx = nearFinal.parse(raw);
  if (tx.transaction.hash !== txHash)
    throw new Error('Refund transaction mismatch');
  let amount = 0n;
  const receipts: string[] = [];
  for (const r of tx.receipts_outcome) {
    if (
      r.outcome.executor_id !== NEAR_USDC ||
      !('SuccessValue' in r.outcome.status)
    )
      continue;
    for (const log of r.outcome.logs) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      let event;
      try {
        event = JSON.parse(log.slice(11));
      } catch {
        continue;
      }
      if (
        !event ||
        event.standard !== 'nep141' ||
        event.event !== 'ft_transfer' ||
        !Array.isArray(event.data)
      )
        continue;
      for (const d of event.data) {
        if (
          d &&
          typeof d === 'object' &&
          (d.old_owner_id === 'intents.near' ||
            d.old_owner_id === q.response.quote.depositAddress) &&
          d.new_owner_id === q.order.treasury &&
          typeof d.amount === 'string' &&
          /^(0|[1-9][0-9]{0,38})$/.test(d.amount)
        ) {
          amount += BigInt(d.amount);
          receipts.push(r.id);
        }
      }
    }
  }
  if (amount < BigInt(minimum)) return null;
  return {
    key: `near:${txHash}:${q.order.treasury}`,
    evidence: {
      network: 'mainnet',
      transactionHash: txHash,
      receipts,
      token: NEAR_USDC,
      recipient: q.order.treasury,
      amount: amount.toString(),
      finality: 'FINAL',
    },
  };
}

/** Final approval transaction plus actual canonical-token debit to the quoted deposit account. */
export function verifyNearDispatch(
  q: VerifiedQuote,
  txHash: string,
  admin: string,
  raw: unknown,
  expectedCommitmentHash: string,
) {
  const schema = nearFinal.extend({
    transaction: z.object({
      hash: z.string(),
      signer_id: z.string(),
      receiver_id: z.string(),
      actions: z
        .array(
          z.object({
            FunctionCall: z.object({
              method_name: z.literal('approve_payment'),
              args: z.string(),
              deposit: z.literal('1'),
              gas: z.number().int().positive().max(120_000_000_000_000),
            }),
          }),
        )
        .length(1),
    }),
  });
  const tx = schema.parse(raw);
  if (
    tx.transaction.hash !== txHash ||
    tx.transaction.signer_id !== admin ||
    tx.transaction.receiver_id !== q.order.vault
  )
    throw new Error('Approval transaction identity mismatch');
  const args = JSON.parse(
    Buffer.from(tx.transaction.actions[0].FunctionCall.args, 'base64').toString(
      'utf8',
    ),
  );
  if (
    !args ||
    Object.keys(args).length !== 3 ||
    args.po_id !== q.order.poId ||
    args.expected_quote_hash !== q.identityHash ||
    !/^[a-f0-9]{64}$/.test(expectedCommitmentHash) ||
    args.expected_commitment_hash !== expectedCommitmentHash
  )
    throw new Error('Approval transaction quote mismatch');
  const receipts: string[] = [];
  let amount = 0n;
  for (const r of tx.receipts_outcome) {
    if (
      r.outcome.executor_id !== q.order.token ||
      !('SuccessValue' in r.outcome.status)
    )
      continue;
    for (const line of r.outcome.logs) {
      if (!line.startsWith('EVENT_JSON:')) continue;
      let event;
      try {
        event = JSON.parse(line.slice(11));
      } catch {
        continue;
      }
      if (
        !event ||
        event.standard !== 'nep141' ||
        event.event !== 'ft_transfer' ||
        !Array.isArray(event.data)
      )
        continue;
      for (const d of event.data) {
        if (
          d &&
          d.old_owner_id === q.order.vault &&
          d.new_owner_id === q.response.quote.depositAddress &&
          typeof d.amount === 'string' &&
          /^[1-9][0-9]{0,38}$/.test(d.amount)
        ) {
          amount += BigInt(d.amount);
          receipts.push(r.id);
        }
      }
    }
  }
  if (amount !== BigInt(q.order.amount))
    throw new Error('Source dispatch amount not proven');
  return {
    transactionHash: txHash,
    receipts,
    amount: amount.toString(),
    token: q.order.token,
    recipient: q.response.quote.depositAddress,
    finality: 'FINAL',
  };
}
