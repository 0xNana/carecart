import {dirname,relative,resolve,sep} from 'node:path';
import {lstatSync} from 'node:fs';
import {safetyProfile} from '../near/safety-profile';
import {PROJECT_ROOT} from './storage';
import {z} from 'zod';

/** Explicit preparation profile; no credentials, RPC, database creation or public activation. */
export function testnetProfile(raw:unknown){
 const bound=safetyProfile(raw),p=bound.profile;
 if(p.network!=='testnet'||!p.testToken||p.rpcUrl!=='https://test.rpc.fastnear.com')throw new Error('Pinned testnet CCUSD profile required; no network fallback');
 const root=resolve(PROJECT_ROOT,'backend/data/testnet-v2'),path=resolve(PROJECT_ROOT,p.databasePath),suffix=relative(root,path);
 if(!suffix||suffix==='..'||suffix.startsWith('..'+sep)||!suffix.endsWith('.sqlite')||path!==p.databasePath)throw new Error('Dedicated absolute testnet-v2 database required');
 for(let at=path;;at=dirname(at)){
  try{const s=lstatSync(at);if(s.isSymbolicLink()||(s.isFile()&&s.nlink>1))throw new Error('Testnet state links forbidden');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(dirname(at)===at)break;
 }
 return bound;
}

export function testnetPreparation(raw:unknown){
 const value=z.object({profile:z.unknown(),suppliers:z.array(z.string().regex(/\.testnet$/)).length(3)}).strict().parse(raw);
 if(new Set(value.suppliers).size!==3)throw new Error('Three distinct testnet suppliers required');
 return {profile:testnetProfile(value.profile).profile,suppliers:value.suppliers};
}
export type TestnetPreparation=ReturnType<typeof testnetPreparation>;
