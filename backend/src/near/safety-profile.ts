import {publicToken} from './token-registry';
import { z } from 'zod';
import { resolve } from 'node:path';
import { digest, NEAR_USDC } from '../intents/settlement';
import { assertLocalV2DatabasePath, isLocalV2DatabasePath, PROJECT_ROOT } from '../profiles/storage';
const account = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const SafetyProfileSchema = z
  .object({
    version: z.literal(2),
    network: z.enum(['testnet', 'mainnet']),
    rpcUrl: z.url(),
    vault: account,
    token: account,
    decimals: z.literal(6),
    admin: account,
    guardian: account,
    treasury: account,
    committer: account,
    requester: account,
    committerPublicKey: z
      .string()
      .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    requesterPublicKey: z
      .string()
      .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    maxKeyAllowanceYocto: z
      .string()
      .regex(/^[1-9][0-9]{0,38}$/)
      .refine((v) => BigInt(v) < 2n ** 128n),
    codeHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,50}$/),
    // Owner-reviewed CareCart test fixture. Never accepted as a mainnet token identity.
    testToken: z.object({symbol:z.literal('CCUSD'),codeHash:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,50}$/)}).strict().optional(),
    databasePath: z.string().min(1),
    fingerprintDatabasePath: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    try {
      if (p.network === 'mainnet') assertLocalV2DatabasePath(p.databasePath);
      else if (isLocalV2DatabasePath(p.databasePath)) throw new Error('Testnet cannot use mainnet state');
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Database network isolation mismatch' });
    }
    const rpc = new URL(p.rpcUrl);
    if (rpc.protocol !== 'https:' || rpc.username || rpc.password)
      ctx.addIssue({
        code: 'custom',
        message: 'Public profiles require HTTPS RPC',
      });
    const roles = [
      p.admin,
      p.guardian,
      p.treasury,
      p.committer,
      p.requester,
      p.vault,
      p.token,
    ];
    if (new Set(roles).size !== roles.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Independent roles and contracts required',
      });
    if (p.committerPublicKey === p.requesterPublicKey)
      ctx.addIssue({
        code: 'custom',
        message: 'Distinct reviewed backend public keys required',
      });
    if (
      p.network === 'mainnet' &&
      (p.token !== NEAR_USDC || roles.some((a) => a.endsWith('.testnet')))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Mainnet profile/token mismatch',
      });
    if(p.testToken){
      if(p.network!=='testnet'||!p.token.endsWith('.testnet'))ctx.addIssue({code:'custom',message:'Explicit testnet-only token required'});
    }else try { publicToken(p.network,p.token); } catch { ctx.addIssue({code:'custom',message:'Unsupported or wrong-network token contract'}); }
    if(p.fingerprintDatabasePath&&p.network!=='testnet')ctx.addIssue({code:'custom',message:'Fingerprint database relocation is testnet-only'});
    if (p.network === 'testnet' && roles.filter(a=>a!==p.token).some((a) => !a.endsWith('.testnet')))
      ctx.addIssue({ code: 'custom', message: 'Testnet namespace required' });
    if (
      /(?:^|\/)testnet-smoke\.sqlite$/.test(p.databasePath) ||
      p.databasePath === 'backend/data/carecart.sqlite'
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Legacy database cannot be reused',
      });
  });
export type SafetyProfile = z.infer<typeof SafetyProfileSchema>;
/** A copied database keeps its original profile identity while databasePath points at its current host location. */
export function profileFingerprint(raw:unknown) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Safety profile required');
  const profile=raw as Record<string,unknown>,fingerprintDatabasePath=profile.fingerprintDatabasePath;
  if(typeof fingerprintDatabasePath!=='string')return digest(raw);
  if(typeof profile.databasePath!=='string')throw new Error('Safety profile database path required');
  const identity:Record<string,unknown>={};
  for(const [key,value] of Object.entries(profile))if(key!=='fingerprintDatabasePath')identity[key]=key==='databasePath'?fingerprintDatabasePath:value;
  return digest(identity);
}
export function safetyProfile(raw: unknown) {
  const profile = SafetyProfileSchema.parse(raw);
  if (profile.network === 'mainnet') profile.databasePath = resolve(PROJECT_ROOT, profile.databasePath);
  return { profile, fingerprint: profileFingerprint(profile) };
}
