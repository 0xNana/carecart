import { describe, expect, it } from 'vitest';
import { roleCredentials } from './role-credentials';
describe('process credential isolation', () => {
  it('loads only the selected restricted credential and rejects legacy crossover or human custody secrets', () => {
    expect(roleCredentials('committer', { SAFETY_COMMITTER_PRIVATE_KEY: 'local-fixture' })).toEqual({ committer: 'local-fixture' });
    expect(roleCredentials('requester', { SAFETY_REQUESTER_PRIVATE_KEY: 'requester', SAFETY_COMMITTER_PRIVATE_KEY: 'committer' })).toEqual({ requester: 'requester' });
    expect(() => roleCredentials('requester', { SAFETY_REQUESTER_PRIVATE_KEY: 'requester', PO_COMMITTER_PRIVATE_KEY: 'legacy-committer' })).toThrow(/Separate/);
    expect(() => roleCredentials('committer', { SAFETY_COMMITTER_PRIVATE_KEY: 'committer', ADMIN_PRIVATE_KEY: 'never-log-this' })).toThrow(/Human custody/);
    expect(() => roleCredentials('requester', {})).toThrow(/required/);
  });
  it.each(['committer','requester'] as const)('rejects guardian custody material in the %s worker',role=>{
    const credential=role==='committer'?{SAFETY_COMMITTER_PRIVATE_KEY:'local-fixture'}:{SAFETY_REQUESTER_PRIVATE_KEY:'local-fixture'};
    expect(()=>roleCredentials(role,{...credential,GUARDIAN_PRIVATE_KEY:'fixture-never-log'})).toThrow(/Human custody/);
  });
});
