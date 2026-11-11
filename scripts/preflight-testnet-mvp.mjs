// Credential-free, read-only public testnet inspection. Never imports wallet configuration.
import {buildTestnetPlan} from './plan-testnet-mvp.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const RPC='https://test.rpc.fastnear.com';
class MissingAccount extends Error{}
export async function preflightTestnetMvp({rpc=RPC,transport=fetch,artifactDirectory}={}){
 if(rpc!==RPC)throw Error('Pinned testnet RPC required; no fallback');
 const requests=[];
 async function read(method,params){
  if(!['status','block','gas_price','EXPERIMENTAL_protocol_config','query'].includes(method))throw Error('Read-only RPC required');
  if(method==='query'&&!['view_account','view_access_key_list','call_function'].includes(params.request_type))throw Error('Read-only query required');
  requests.push({method,...(method==='query'?{requestType:params.request_type,accountId:params.account_id,view:params.method_name}: {})});
  const response=await transport(RPC,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'carecart-testnet-readonly-preflight',method,params})});
  if(!response.ok)throw Error('Public testnet RPC HTTP '+response.status);
  const value=await response.json();if(value.error){
   if(method==='query'&&['view_account','view_access_key_list'].includes(params.request_type)&&[value.error.cause?.name,value.error.data?.name,value.error.data?.cause?.name].includes('UNKNOWN_ACCOUNT'))throw new MissingAccount('Unknown testnet account');
   throw Error('Public testnet read rejected: '+method);
  }
  if(value.result===undefined)throw Error('Missing public testnet read result');return value.result;
 }
 const plan=buildTestnetPlan(artifactDirectory?{artifactDirectory}:{}),status=await read('status',[]);
 if(status.chain_id!=='testnet')throw Error('RPC chain mismatch; mainnet fallback forbidden');
 const block=await read('block',{finality:'final'}),blockId=block.header?.hash;
 if(typeof blockId!=='string'||!Number.isSafeInteger(block.header?.height))throw Error('Finalized block identity required');
 const [protocol,gas]=await Promise.all([read('EXPERIMENTAL_protocol_config',{block_id:blockId}),read('gas_price',[blockId])]);
 const storageByte=protocol.runtime_config?.storage_amount_per_byte;
 if(!/^[1-9][0-9]*$/.test(storageByte??'')||!/^[1-9][0-9]*$/.test(gas.gas_price??''))throw Error('Verified storage and gas prices required');
 const names=[...new Set(['carecart.testnet',...Object.values(plan.accounts),...plan.suppliers,'vault.carecart.testnet','token.carecart.testnet'])];
 const accounts=[];
 for(const accountId of names){
  try{
   const account=await read('query',{request_type:'view_account',block_id:blockId,account_id:accountId});
   if(!/^[0-9]+$/.test(account.amount??'')||!Number.isSafeInteger(account.storage_usage))throw Error('Invalid public account balance');
   const access=await read('query',{request_type:'view_access_key_list',block_id:blockId,account_id:accountId});
   if(!Array.isArray(access.keys))throw Error('Public access-key evidence missing');
   accounts.push({accountId,exists:true,balanceYocto:account.amount,lockedYocto:account.locked,storageBytes:account.storage_usage,codeHash:account.code_hash,
    conservativeUnstakedYocto:(BigInt(account.amount)>BigInt(account.storage_usage)*BigInt(storageByte)?BigInt(account.amount)-BigInt(account.storage_usage)*BigInt(storageByte):0n).toString(),
    accessKeys:access.keys.map(k=>({publicKey:k.public_key,permission:k.access_key.permission}))});
  }catch(error){if(!(error instanceof MissingAccount))throw error;accounts.push({accountId,exists:false});}
 }
 const byId=new Map(accounts.map(a=>[a.accountId,a])),newAccountStates=plan.newAccounts.map(a=>byId.get(a));
 const blockers=[];
 for(const accountId of ['carecart.testnet',plan.accounts.admin,plan.accounts.treasury,...plan.suppliers.slice(0,2)])if(!byId.get(accountId)?.exists)blockers.push('Required existing account missing: '+accountId);
 for(const a of newAccountStates)if(a.exists)blockers.push('Fresh account already exists; do not create/deploy blindly: '+a.accountId);
 const freshResources=plan.newAccounts.map(accountId=>({accountId,proposedFundingYocto:accountId===plan.accounts.vault?(BigInt(plan.artifacts.vault.bytes)*BigInt(storageByte)+10n**24n).toString():accountId===plan.accounts.token?(BigInt(plan.artifacts.token.bytes)*BigInt(storageByte)+5n*10n**23n).toString():plan.resources.otherNewAccountBudgetYocto}));
 const parentBudget=freshResources.reduce((n,a)=>n+BigInt(a.proposedFundingYocto),0n);
 const parent=byId.get('carecart.testnet');if(parent?.exists&&BigInt(parent.conservativeUnstakedYocto)<parentBudget)blockers.push('Parent balance is below proposed new-account funding; owner funding review required');
 const nativeViews={};
 async function view(accountId,method,args={}){const r=await read('query',{request_type:'call_function',block_id:blockId,account_id:accountId,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')});return JSON.parse(Buffer.from(r.result).toString('utf8'));}
 if(byId.get('token.carecart.testnet')?.exists)nativeViews.legacyTokenMetadata=await view('token.carecart.testnet','ft_metadata');
 if(byId.get('vault.carecart.testnet')?.exists){nativeViews.legacyPolicy=await view('vault.carecart.testnet','get_policy');nativeViews.legacyPaused=await view('vault.carecart.testnet','is_paused');}
 blockers.push('Actual fresh-account creation keys, restricted role public keys and controller custody are not approved/verified','Source/build provenance and stage-specific public transaction authorization remain required');
 return {observedAt:new Date().toISOString(),readOnly:true,network:'testnet',rpc:RPC,block:{hash:blockId,height:block.header.height},protocolVersion:protocol.protocol_version,storageByteCostYocto:storageByte,gasPriceYoctoPerGas:gas.gas_price,
  accounts,legacyViews:nativeViews,resources:{freshAccounts:freshResources,parentNewAccountFundingYocto:parentBudget.toString(),estimatedSetupGasUpperBoundYocto:(plan.setupCalls.reduce((n,c)=>n+BigInt(c.gasTgas)*10n**12n,0n)*BigInt(gas.gas_price)).toString(),gasEstimateExcludesAccountCreationKeyInstallationAndRefunds:true},
  requests,blockers,publicTransactionsSubmitted:0,signingEnabled:false,readyToExecute:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length&&!(args.length===2&&args[0]==='--artifacts'))throw Error('Usage: node scripts/preflight-testnet-mvp.mjs [--artifacts DIRECTORY] (read-only testnet only)');
 try{console.log(JSON.stringify(await preflightTestnetMvp(args.length?{artifactDirectory:resolve(args[1])}:{}),null,2));}catch(error){console.error('Read-only testnet preflight failed: '+error.message);process.exitCode=1;}
}
