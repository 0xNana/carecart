import type {SafetyVaultClient} from './safety-client';
export type VaultReader=Pick<SafetyVaultClient,'profile'|'readOnly'|'injectedReads'|'canonicalOrder'|'view'|'approvalReview'|'revalidateApproval'|'finalTransaction'>;
