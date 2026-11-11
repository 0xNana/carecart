import {test} from 'node:test';import assert from 'node:assert/strict';
import {connectV2Admin,type AdminWalletConnector} from '../src/lib/v2-admin-connection.ts';
const profile={network:'testnet' as const,profileFingerprint:'a'.repeat(64),vault:'vault.testnet',admin:'admin.testnet',token:'token.testnet',decimals:6 as const,codeHash:'1'.repeat(44)};
test('MOCK CONNECTOR: identifies the human admin, rechecks network/account changes and never exposes public signing',async()=>{
 let account='admin.testnet';let disconnected=0;
 const connector:AdminWalletConnector={network:'testnet',connect:async()=>({manifest:{features:{testnet:true}},getAccounts:async()=>[{accountId:account}]}),disconnect:async()=>{disconnected++;}};
 const connected=await connectV2Admin(profile,async()=>connector);assert.equal(connected.identity.accountId,profile.admin);
 await assert.rejects(connected.submit(),/PUBLIC_SIGNING_DISABLED/);account='requester.testnet';await assert.rejects(connected.revalidateIdentity(),/HUMAN_ADMIN/);
 account='admin.testnet';connector.network='mainnet';await assert.rejects(connected.revalidateIdentity(),/NETWORK_CHANGED/);
 await connected.disconnect();assert.equal(disconnected,1);
});
test('MOCK CONNECTOR: connection with the wrong signer is disconnected',async()=>{
 let disconnected=false;const connector:AdminWalletConnector={network:'testnet',connect:async()=>({manifest:{features:{testnet:true}},getAccounts:async()=>[{accountId:'guardian.testnet'}]}),disconnect:async()=>{disconnected=true;}};
 await assert.rejects(connectV2Admin(profile,async()=>connector),/HUMAN_ADMIN/);assert.equal(disconnected,true);
});
