import { join, resolve, relative, sep } from 'node:path';
import { PROJECT_ROOT } from '../profiles/storage';
import { safetyProfile } from '../near/safety-profile';
import { NEAR_USDC } from '../intents/settlement';
import { syntheticLocalCatalog } from '../procurement/v2-catalog';
import { V2ProcurementStore } from '../procurement/v2-store';
import { ReplenishmentWorkflow } from '../workflow/cases';

/** API, inventory, and observer processes must never receive signing credentials. */
export function assertNoSigningCredentials(env:NodeJS.ProcessEnv) {
  for(const [key,value] of Object.entries(env)) if(value &&
    (/PRIVATE_KEY|SECRET_KEY|MNEMONIC|(?:^|_)SEED(?:_|$)/i.test(key) || /(?:ADMIN|GUARDIAN|TREASURY|REQUESTER|COMMITTER|DEPLOYER|RECOVERY).*(?:SECRET|SEED)/i.test(key)))
      throw new Error('Signing/custody credentials are forbidden in the operations process');
}
export function localOperationsProfile(name='workspace') {
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name))throw new Error('Invalid local workspace');
  const directory=resolve(PROJECT_ROOT,'backend/data/local-v2/local-operations');
  const path=join(directory,name,'state.sqlite');
  if(relative(directory,path).startsWith(`..${sep}`))throw new Error('Local-only database required');
  // Fictitious public identities and proposed native-USDC terms. No RPC, account lookup or signer.
  const {profile}=safetyProfile({version:2,network:'mainnet',rpcUrl:'https://rpc.mainnet.near.org',
    ...Object.fromEntries(['vault','admin','guardian','treasury','committer','requester'].map(role=>[role,`${role}.local-ops.near`])),
    token:NEAR_USDC,decimals:6,committerPublicKey:`ed25519:${'1'.repeat(32)}`,requesterPublicKey:`ed25519:${'2'.repeat(32)}`,
    maxKeyAllowanceYocto:'10000000000000000000000',codeHash:'1'.repeat(44),databasePath:path});
  return profile;
}
export function openLocalOperations(name='workspace') {
  const profile=localOperationsProfile(name);
  const catalog=syntheticLocalCatalog(['a','b','c'].map((c,i)=>({id:`mn-supplier-${i+1}`,account:`supplier-${c}.local-ops.near`,destination:'Near'})));
  const store=new V2ProcurementStore(profile,catalog);const workflow=new ReplenishmentWorkflow(store);
  return {store,workflow,close(){workflow.close();store.close();}};
}
