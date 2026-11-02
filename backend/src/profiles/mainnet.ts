import { resolve } from 'node:path';
import { z } from 'zod';
import { NEAR_USDC } from '../intents/settlement';
import { SafetyProfileSchema, safetyProfile } from '../near/safety-profile';
import { MAINNET_DATABASE_PATH, PROJECT_ROOT, assertMainnetDatabasePath, isMainnetDatabasePath } from './storage';
export { MAINNET_DATABASE_PATH, PROJECT_ROOT } from './storage';

const fields = SafetyProfileSchema.shape;
const DeploymentSchema = z.object({
  vault: fields.vault, admin: fields.admin, guardian: fields.guardian, treasury: fields.treasury,
  committer: fields.committer, requester: fields.requester,
  committerPublicKey: fields.committerPublicKey, requesterPublicKey: fields.requesterPublicKey,
  maxKeyAllowanceYocto: fields.maxKeyAllowanceYocto, codeHash: fields.codeHash,
}).strict();
const ManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: z.literal('mainnet-usdc-v2'),
  network: z.literal('mainnet'),
  rpc: z.object({ url: z.literal('https://rpc.mainnet.near.org'), chainId: z.literal('mainnet') }).strict(),
  token: z.object({
    accountId: z.literal(NEAR_USDC), symbol: z.literal('USDC'), decimals: z.literal(6),
    oneClickAssetId: z.literal(`nep141:${NEAR_USDC}`),
  }).strict(),
  databasePath: z.literal(MAINNET_DATABASE_PATH),
  explorers: z.object({ near: z.literal('https://nearblocks.io'), base: z.literal('https://basescan.org') }).strict(),
  deployment: DeploymentSchema.nullable(),
}).strict();
export type MainnetManifest = z.infer<typeof ManifestSchema>;

/** Candidate inspection is read-only; no identities are invented for the owner. */
export function mainnetManifest(raw: unknown): MainnetManifest {
  const manifest = ManifestSchema.parse(raw);
  assertMainnetDatabasePath(manifest.databasePath);
  if (manifest.deployment) mainnetSafetyProfile(manifest);
  return manifest;
}

/** Produces the existing v2 ABI profile only after all G0B identity fields are present. */
export function mainnetSafetyProfile(raw: unknown) {
  const m = ManifestSchema.parse(raw);
  if (!m.deployment) throw new Error('G0B deployment identities, reviewed keys and code hash are required');
  return safetyProfile({
    version: 2, network: m.network, rpcUrl: m.rpc.url, token: m.token.accountId,
    decimals: m.token.decimals, databasePath: resolve(PROJECT_ROOT, m.databasePath), ...m.deployment,
  });
}

/** Run before opening a DB: environment changes cannot repurpose the CCTEST prototype. */
export function assertPrototypeProfile(environment: NodeJS.ProcessEnv = process.env): void {
  if ((environment.CARECART_PROFILE ?? 'testnet-cctest') !== 'testnet-cctest' ||
      (environment.NEAR_NETWORK ?? 'testnet') !== 'testnet' ||
      isMainnetDatabasePath(environment.CARECART_DATABASE_PATH ?? '')) {
    throw new Error('Prototype runtime supports testnet-cctest only; mainnet requires its separate manifest and release gates');
  }
}
