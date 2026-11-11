import test from 'node:test';import assert from 'node:assert/strict';
import {preflightTestnetMvp} from './preflight-testnet-mvp.mjs';
import {buildTestnetPlan} from './plan-testnet-mvp.mjs';
function fixture({chain='testnet',balance='100000000000000000000000000',errorAt,occupied=false}={}){
 const plan=buildTestnetPlan(),requests=[];
 const transport=async(url,options)=>{
  assert.equal(url,'https://test.rpc.fastnear.com');const request=JSON.parse(options.body);requests.push(request);const {method,params}=request;
  if(errorAt===method)return {ok:false,status:503};
  let result;
  if(method==='status')result={chain_id:chain};
  else if(method==='block')result={header:{hash:'finalized-fixture-block',height:123}};
  else if(method==='EXPERIMENTAL_protocol_config')result={protocol_version:82,runtime_config:{storage_amount_per_byte:'10000000000000000000'}};
  else if(method==='gas_price'){assert.deepEqual(params,['finalized-fixture-block']);result={gas_price:'100000000'};}
  else if(method==='query'){
   assert.equal(params.block_id,'finalized-fixture-block');
   if(plan.newAccounts.includes(params.account_id)&&!occupied)return {ok:true,json:async()=>({error:{cause:{name:'UNKNOWN_ACCOUNT'}}})};
   if(params.request_type==='view_account')result={amount:balance,locked:'0',storage_usage:100,code_hash:'fixture-code'};
   else if(params.request_type==='view_access_key_list')result={keys:[{public_key:'fixture-public-key',access_key:{permission:'FullAccess'}}]};
   else if(params.request_type==='call_function'){const value=params.method_name==='ft_metadata'?{symbol:'CCTEST',decimals:0}:params.method_name==='is_paused'?false:{per_order_cap:'2000'};result={result:[...Buffer.from(JSON.stringify(value))]};}
   else throw Error('Unexpected query');
  }else throw Error('Forbidden RPC '+method);
  return {ok:true,json:async()=>({result})};
 };return {transport,requests};
}
test('anchors all public reads to one finalized testnet block and cannot mark setup executable',async()=>{
 const f=fixture(),r=await preflightTestnetMvp(f);assert.equal(r.network,'testnet');assert.equal(r.readyToExecute,false);assert.equal(r.publicTransactionsSubmitted,0);
 assert.equal(r.accounts.filter(a=>!a.exists).length,6);assert.equal(r.legacyViews.legacyTokenMetadata.symbol,'CCTEST');
 assert(r.blockers.some(s=>s.includes('public keys')));assert(f.requests.every(r=>['status','block','query','gas_price','EXPERIMENTAL_protocol_config'].includes(r.method)));
});
test('rejects mainnet or alternate RPC before account queries and never retries on another network',async()=>{
 const f=fixture({chain:'mainnet'});await assert.rejects(preflightTestnetMvp(f),/chain mismatch/);assert.equal(f.requests.length,1);
 await assert.rejects(preflightTestnetMvp({rpc:'https://rpc.mainnet.near.org',transport:f.transport}),/Pinned/);assert.equal(f.requests.length,1);
});
test('fails closed on RPC errors and flags funding shortfall or existing fresh accounts',async()=>{
 await assert.rejects(preflightTestnetMvp(fixture({errorAt:'query'})),/HTTP 503/);
 const low=await preflightTestnetMvp(fixture({balance:'100'}));assert(low.blockers.some(s=>s.includes('Parent balance')));
 const occupied=await preflightTestnetMvp(fixture({occupied:true}));assert(occupied.blockers.some(s=>s.includes('already exists')));assert.equal(occupied.readyToExecute,false);
});
