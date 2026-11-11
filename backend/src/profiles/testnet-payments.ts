import {z} from 'zod';
import {join} from 'node:path';
import {digest} from '../intents/settlement';
import {SafetyProfileSchema,type SafetyProfile} from '../near/safety-profile';
import {PROJECT_ROOT} from './storage';
import {testnetProfile} from './testnet';

/** Owner-operated configuration, never an HTTP/model capability or a transaction permit. */
const Configuration=z.object({version:z.literal(1),ownerApproved:z.literal(true),clinicId:z.uuid(),profile:SafetyProfileSchema,suppliers:z.array(z.string()).length(3)}).strict();
export type TestnetPayments=z.infer<typeof Configuration>;
export function testnetPayments(raw:unknown):TestnetPayments {
 const c=Configuration.parse(raw),p=testnetProfile(c.profile).profile;
 if(p.vault!=='safety-v2.carecart.testnet'||p.token!=='token-v2.carecart.testnet'||p.codeHash!=='BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3'||p.testToken?.codeHash!=='8SHC5cfTSwdgKTtuCJPnsgNCj8Q9P3LpsAhLNDpMd6FW'||
  p.admin!=='admin.carecart.testnet'||p.guardian!=='guardian-v2.carecart.testnet'||p.treasury!=='treasury.carecart.testnet'||p.committer!=='committer-v2.carecart.testnet'||p.requester!=='agent-v2.carecart.testnet'||
  BigInt(p.maxKeyAllowanceYocto)>200_000_000_000_000_000_000_000n||p.databasePath!==join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',c.clinicId,'state.sqlite')||
  digest(c.suppliers)!==digest(['medsupply-a.carecart.testnet','medsupply-b.carecart.testnet','medsupply-v2-c.carecart.testnet']))throw new Error('Exact reviewed testnet payment release, authorities, suppliers and clinic path required');
 return {...c,profile:p};
}
export function assertTestnetPayments(profile:SafetyProfile,clinicId:string,raw:unknown):void{
 const c=testnetPayments(raw);if(c.clinicId!==clinicId||digest(c.profile)!==digest(profile))throw new Error('Clinic testnet payment configuration mismatch');
}
