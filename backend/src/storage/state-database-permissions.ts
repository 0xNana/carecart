import { chmodSync, readFileSync, statSync } from 'node:fs';

const SHARED_STATE_GROUP = 'carecart-payments';

/**
 * Keep state databases owner-only by default. On the EC2 host, explicitly allow
 * the two isolated payment service accounts to share only files assigned to the
 * carecart-payments group.
 */
export function secureStateDatabase(path: string): void {
  const requestedGroup = process.env.CARECART_SHARED_STATE_GROUP;
  if (!requestedGroup) {
    chmodSync(path, 0o600);
    return;
  }
  if (requestedGroup !== SHARED_STATE_GROUP)
    throw new Error('Unsupported shared state database group');

  const group = readFileSync('/etc/group', 'utf8')
    .split('\n')
    .map((line) => line.split(':'))
    .find(([name]) => name === SHARED_STATE_GROUP);
  const groupId = Number(group?.[2]);
  if (!Number.isSafeInteger(groupId))
    throw new Error('Shared state database group is unavailable');

  if (!process.getgid || !process.getgroups)
    throw new Error('Shared state database group checks require POSIX process groups');
  const memberships = new Set([process.getgid(), ...process.getgroups()]);
  if (!memberships.has(groupId))
    throw new Error('Process is not a member of the shared state database group');
  if (statSync(path).gid !== groupId)
    throw new Error('State database group ownership mismatch');

  chmodSync(path, 0o660);
}
