/** One process, one restricted credential. Human custody secrets never enter these workers. */
export function roleCredentials(role: 'committer' | 'requester', environment: NodeJS.ProcessEnv = process.env) {
  const committer = environment.SAFETY_COMMITTER_PRIVATE_KEY?.trim();
  const requester = environment.SAFETY_REQUESTER_PRIVATE_KEY?.trim();
  if ((role === 'committer' && (requester || environment.AGENT_FC_PRIVATE_KEY)) ||
      (role === 'requester' && (committer || environment.PO_COMMITTER_PRIVATE_KEY)))
    throw new Error('Separate workers must not receive the other role credential');
  if (Object.entries(environment).some(([name, value]) => value &&
    /(?:ADMIN|TREASURY|DEPLOYER|RECOVERY).*(?:PRIVATE_KEY|SECRET|SEED|MNEMONIC)/i.test(name)))
    throw new Error('Human custody credentials are forbidden in backend workers');
  const key = role === 'committer' ? committer : requester;
  if (!key) throw new Error('Isolated restricted role credential required');
  return role === 'committer' ? { committer: key } : { requester: key };
}
