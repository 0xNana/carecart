/** CC-00 is unresolved; a human must choose a provider and approved live model first. */
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
