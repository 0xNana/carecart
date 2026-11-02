import { describe, expect, it } from 'vitest';
import { roleCredentials } from './role-credentials';
describe('process credential isolation', () => {
  it('loads only the selected restricted credential and rejects shared or human custody secrets', () => {
    expect(roleCredentials('committer', { SAFETY_COMMITTER_PRIVATE_KEY: 'local-fixture' })).toEqual({ committer: 'local-fixture' });
    expect(() => roleCredentials('requester', { SAFETY_REQUESTER_PRIVATE_KEY: 'requester', SAFETY_COMMITTER_PRIVATE_KEY: 'committer' })).toThrow(/Separate/);
    expect(() => roleCredentials('committer', { SAFETY_COMMITTER_PRIVATE_KEY: 'committer', ADMIN_PRIVATE_KEY: 'never-log-this' })).toThrow(/Human custody/);
    expect(() => roleCredentials('requester', {})).toThrow(/required/);
  });
});
