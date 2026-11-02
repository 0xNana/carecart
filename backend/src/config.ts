import { KeyPair, type KeyPairString } from 'near-api-js';

/** Legacy deterministic judge route. The explicit manual live adapter is configured separately. */
const CC00_PROVIDER_DECISION: 'pending' | 'disabled' | 'near-ai-cloud' = 'pending';

export type AgentProviderConfiguration =
  | { mode: 'deterministic'; provider: 'none'; reason: 'CC00_PENDING' | 'PROVIDER_DISABLED' }
  | {
      mode: 'provider';
      provider: 'near-ai-cloud';
      baseURL: string;
      apiKey: string;
      model: string;
    };

export interface VaultPaymentConfiguration {
  rpcUrl: string;
  vaultAccountId: string;
  tokenAccountId: string;
  assetCode: string;
  committerAccountId: string;
  committerPrivateKey: string;
  requesterAccountId: string;
  requesterPrivateKey: string;
}

/**
 * Resolve a backend-only testnet payment configuration. An unset configuration keeps the
 * payment route disabled; partial credentials and non-testnet settings fail closed.
 */
export function loadVaultPaymentConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): VaultPaymentConfiguration | null {
  const values = {
    rpcUrl: environment.NEAR_RPC_URL?.trim() ?? '',
    vaultAccountId: environment.VAULT_ID?.trim() ?? '',
    tokenAccountId: environment.TEST_TOKEN_ID?.trim() ?? '',
    committerAccountId: environment.PO_COMMITTER_ACCOUNT_ID?.trim() ?? '',
    committerPrivateKey: environment.PO_COMMITTER_PRIVATE_KEY?.trim() ?? '',
    requesterAccountId: environment.AGENT_ACCOUNT_ID?.trim() ?? '',
    requesterPrivateKey: environment.AGENT_FC_PRIVATE_KEY?.trim() ?? '',
  };
  const paymentSettings = [
    values.vaultAccountId,
    values.tokenAccountId,
    values.committerAccountId,
    values.committerPrivateKey,
    values.requesterAccountId,
    values.requesterPrivateKey,
  ];
  if (paymentSettings.every((value) => value.length === 0)) return null;

  const missing = Object.entries(values)
    .filter(([, value]) => value.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`vault payment configuration is incomplete: ${missing.join(', ')}`);
  }
  if ((environment.NEAR_NETWORK ?? 'testnet').trim() !== 'testnet') {
    throw new Error('CareCart payment configuration currently supports NEAR testnet only');
  }

  let rpcUrl: URL;
  try {
    rpcUrl = new URL(values.rpcUrl);
  } catch {
    throw new Error('NEAR_RPC_URL must be a valid HTTPS URL');
  }
  if (rpcUrl.protocol !== 'https:') {
    throw new Error('NEAR_RPC_URL must use HTTPS for testnet');
  }

  for (const key of [values.committerPrivateKey, values.requesterPrivateKey]) {
    try {
      KeyPair.fromString(key as KeyPairString);
    } catch {
      throw new Error('NEAR signing keys must be valid encoded keypairs');
    }
  }

  return {
    ...values,
    assetCode: environment.VAULT_ASSET_CODE?.trim() || 'CCTEST',
  };
}

/**
 * Resolve only backend-side provider settings. Environment values cannot enable the provider
 * while the human decision in CC-00 is pending.
 */
export function loadAgentProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): AgentProviderConfiguration {
  if (CC00_PROVIDER_DECISION === 'pending') {
    return { mode: 'deterministic', provider: 'none', reason: 'CC00_PENDING' };
  }
  if (CC00_PROVIDER_DECISION === 'disabled') {
    return { mode: 'deterministic', provider: 'none', reason: 'PROVIDER_DISABLED' };
  }

  const baseURL = environment.OPENAI_BASE_URL?.trim();
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const model = environment.OPENAI_MODEL?.trim();
  if (!baseURL || !apiKey || !model) {
    throw new Error('CC-00 approved provider configuration requires base URL, API key, and model');
  }

  const parsedURL = new URL(baseURL);
  if (parsedURL.protocol !== 'https:' || parsedURL.hostname !== 'cloud-api.near.ai') {
    throw new Error('NEAR AI Cloud provider URL must use the verified HTTPS host');
  }

  return { mode: 'provider', provider: 'near-ai-cloud', baseURL, apiKey, model };
}
