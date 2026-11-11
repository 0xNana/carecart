import {z} from 'zod';import {resolve,relative,sep,dirname} from 'node:path';import {lstatSync} from 'node:fs';
import {PROJECT_ROOT} from '../profiles/storage';import {NEAR_USDC} from '../intents/settlement';import type {SafetyProfile} from '../near/safety-profile';
const account=z.string().max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/);
const hash=z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,50}$/);
const schema=z.object({version:z.literal(2),environment:z.literal('sandbox'),network:z.literal('testnet'),chainId:z.string().min(1).max(128),genesisHash:hash,
 rpcUrl:z.url(),vault:account,token:account,decimals:z.literal(6),tokenSymbol:z.literal('CCUSD'),admin:account,guardian:account,treasury:account,committer:account,requester:account,
 committerPublicKey:z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),requesterPublicKey:z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
 maxKeyAllowanceYocto:z.string().regex(/^[1-9][0-9]{0,23}$/),codeHash:hash,databasePath:z.string().min(1)}).strict();
export type SandboxProfile=z.infer<typeof schema>;
const branded=new WeakSet<object>();
export function sandboxProfile(raw:unknown):SandboxProfile{
 const p=schema.parse(raw);const u=new URL(p.rpcUrl);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.username||u.password||u.search||u.hash||['mainnet','testnet'].includes(p.chainId)||p.token===NEAR_USDC)
  throw new Error('Genuine isolated loopback Sandbox identity required');
 const roles=[p.admin,p.guardian,p.treasury,p.committer,p.requester,p.vault,p.token];
 if(p.token!=='token.testnet')throw new Error('Only the explicitly deployed local Sandbox test token is supported');
 if(new Set(roles).size!==roles.length||p.committerPublicKey===p.requesterPublicKey||BigInt(p.maxKeyAllowanceYocto)>200_000_000_000_000_000_000_000n)throw new Error('Sandbox roles must remain separate');
 const root=resolve(PROJECT_ROOT,'backend/data/sandbox-v2');const path=resolve(p.databasePath);const part=relative(root,path);
 if(!part||part==='..'||part.startsWith('..'+sep)||!path.endsWith('.sqlite'))throw new Error('Dedicated Sandbox database required');
 for(let at=path;;at=dirname(at)){try{const s=lstatSync(at);if(s.isSymbolicLink()||(s.isFile()&&s.nlink>1))throw new Error('Sandbox database links forbidden');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(dirname(at)===at)break;}
 p.databasePath=path;Object.freeze(p);branded.add(p);return p;
}
export function isSandboxProfile(p:SafetyProfile):p is SandboxProfile{return branded.has(p);}
