// Offline proposal only. No network, keychain, credentials, subprocess or transaction submission.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {baseEncode}=createRequire(new URL('../backend/package.json',import.meta.url))('near-api-js');
export function buildTestnetPlan({artifactDirectory=resolve(root,'artifacts/safety-v2')}={}){
const accounts={vault:'safety-v2.carecart.testnet',token:'token-v2.carecart.testnet',admin:'admin.carecart.testnet',guardian:'guardian-v2.carecart.testnet',treasury:'treasury.carecart.testnet',committer:'committer-v2.carecart.testnet',requester:'agent-v2.carecart.testnet'};
const suppliers=['medsupply-a.carecart.testnet','medsupply-b.carecart.testnet','medsupply-v2-c.carecart.testnet'];
function artifact(name){const path=resolve(artifactDirectory,name),bytes=readFileSync(path),hash=createHash('sha256').update(bytes).digest();new WebAssembly.Module(bytes);return {path,bytes:bytes.length,sha256:hash.toString('hex'),codeHash:baseEncode(hash),minimumCodeStorageYocto:(BigInt(bytes.length)*10n**19n).toString()};}
const artifacts={vault:artifact('carecart_safety_vault.wasm'),token:artifact('carecart_test_ft.wasm')};
const policy={auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'};
const calls=[];
function call(signer,receiver,method,args,depositYocto='1',gasTgas=120){calls.push({signer,receiver,method,args,depositYocto,gasTgas,authorization:'NOT AUTHORIZED'});}
call(accounts.token,accounts.token,'new_test_usdc',{owner_id:accounts.treasury,total_supply:'100000000'},'0',100);
call(accounts.vault,accounts.vault,'new',{admin:accounts.admin,guardian:accounts.guardian,treasury:accounts.treasury,token:accounts.token,policy},'0',100);
call(accounts.admin,accounts.vault,'fund_storage',{},'100000000000000000000000');
for(const supplier of suppliers)call(accounts.admin,accounts.vault,'set_supplier',{supplier,allowed:true});
for(const role of ['committer','requester'])call(accounts.admin,accounts.vault,'set_role',{account:accounts[role],role,allowed:true});
for(const account_id of [accounts.vault,...suppliers])call(accounts.treasury,accounts.token,'storage_deposit',{account_id,registration_only:true},'10000000000000000000000',100);
call(accounts.treasury,accounts.token,'ft_transfer_call',{receiver_id:accounts.vault,amount:'5000000',msg:'deposit'});
const profile={version:2,network:'testnet',rpcUrl:'https://test.rpc.fastnear.com',...accounts,decimals:6,
 committerPublicKey:'ed25519:ESpXAHMCBfrZNhtW8GrweayeeMnmoL8j25fUpe4cUFDZ',requesterPublicKey:'ed25519:CxJkkdPs6M7bpFJuyELJSBJaeUtWtV5Ed5qdqHi2CN64',
 maxKeyAllowanceYocto:'200000000000000000000000',codeHash:artifacts.vault.codeHash,testToken:{symbol:'CCUSD',codeHash:artifacts.token.codeHash},databasePath:resolve(root,'backend/data/testnet-v2/offline-demo/state.sqlite')};
const sourceInputs=Object.fromEntries(['contracts/carecart-safety-vault/src/lib.rs','contracts/test-ft/src/lib.rs','contracts/Cargo.lock','rust-toolchain.toml'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
return {version:1,status:'APPROVAL REQUIRED; NOT EXECUTABLE',network:'testnet',rpc:profile.rpcUrl,publicSigningEnabled:false,mainnetAllowed:false,accounts,suppliers,artifacts,sourceInputs,
 artifactSourceProvenance:'Current files hashed separately; a reproducible build match is not claimed',
 testAsset:{symbol:'CCUSD',decimals:6,issuer:'CareCart test fixture; NOT Circle USDC',initialSupplyAtomic:'100000000',initialVaultDepositAtomic:'5000000'},policy,
 newAccounts:[accounts.vault,accounts.token,accounts.guardian,accounts.committer,accounts.requester,suppliers[2]],
 resources:{vaultAccountBudgetYocto:(BigInt(artifacts.vault.minimumCodeStorageYocto)+10n**24n).toString(),tokenAccountBudgetYocto:(BigInt(artifacts.token.minimumCodeStorageYocto)+5n*10n**23n).toString(),otherNewAccountBudgetYocto:'250000000000000000000000',humanSetupGasReserveYocto:'500000000000000000000000',gasPriceVerified:false,storageByteCostAssumedYocto:'10000000000000000000',realMoneyRequired:false},
 restrictedKeys:[{account:accounts.committer,receiver:accounts.vault,methods:['commit_purchase_order'],maxAllowanceYocto:profile.maxKeyAllowanceYocto},{account:accounts.requester,receiver:accounts.vault,methods:['request_payment'],maxAllowanceYocto:profile.maxKeyAllowanceYocto}],
 setupCalls:calls,unpauseIncluded:false,smoke:{amountAtomic:'1500000',supplier:suppliers[0],methods:['commit_purchase_order','request_payment'],publicSubmissionAuthorized:false},
 blockers:['Owner has not approved these accounts, artifacts, deposits or operations','New account existence, controller custody and public keys require independent review','Demo public keys are fixtures; never install them as reviewed operational keys','Paused fresh vault must be independently verified before a separately approved unpause','Genuine tenant-to-vault execution is not activated','Above-10 human payment and daily-cap execution cannot be demonstrated from the unchanged initial 5-token accepted ceiling','No cross-chain public execution adapter is activated'],
 offlineWorkspace:{profile,suppliers}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length&&!(args.length===2&&args[0]==='--artifacts'))throw Error('Usage: node scripts/plan-testnet-mvp.mjs [--artifacts DIRECTORY] (offline JSON proposal only)');
 console.log(JSON.stringify(buildTestnetPlan(args.length?{artifactDirectory:resolve(args[1])}:{}),null,2));
}
