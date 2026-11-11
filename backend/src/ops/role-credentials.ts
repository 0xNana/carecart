/** Selects only the requested restricted role credential from the environment. Human custody and legacy v1 secrets are forbidden. */
export function roleCredentials(role: 'committer' | 'requester', environment: NodeJS.ProcessEnv = process.env) {
  const committer = environment.SAFETY_COMMITTER_PRIVATE_KEY?.trim();
  const requester = environment.SAFETY_REQUESTER_PRIVATE_KEY?.trim();
  if ((role === 'committer' && environment.AGENT_FC_PRIVATE_KEY) ||
      (role === 'requester' && environment.PO_COMMITTER_PRIVATE_KEY))
    throw new Error('Separate workers must not receive the other role credential');
  if (Object.entries(environment).some(([name, value]) => value &&
    /(?:ADMIN|GUARDIAN|TREASURY|DEPLOYER|RECOVERY).*(?:PRIVATE_KEY|SECRET|SEED|MNEMONIC)/i.test(name)))
    throw new Error('Human custody credentials are forbidden in backend workers');
  const key = role === 'committer' ? committer : requester;
  if (!key) throw new Error('Isolated restricted role credential required');
  return role === 'committer' ? { committer: key } : { requester: key };
}
