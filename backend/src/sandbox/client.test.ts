import {afterEach,expect,it,vi} from 'vitest';
import {JsonRpcProvider} from 'near-api-js';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PROJECT_ROOT} from '../profiles/storage';
import {SandboxVaultClient} from './client';
import {sandboxProfile} from './profile';

afterEach(()=>vi.restoreAllMocks());

function fixture(){
 const p=sandboxProfile({version:2,environment:'sandbox',network:'testnet',chainId:'local-sandbox',genesisHash:'1'.repeat(44),
  rpcUrl:'http://127.0.0.1:4000',vault:'vault.testnet',token:'token.testnet',decimals:6,tokenSymbol:'CCUSD',
  admin:'admin.testnet',guardian:'guardian.testnet',treasury:'treasury.testnet',committer:'committer.testnet',requester:'agent.testnet',
  committerPublicKey:'ed25519:'+'1'.repeat(43),requesterPublicKey:'ed25519:'+'2'.repeat(43),maxKeyAllowanceYocto:'20000000000000000000000',
  codeHash:'3'.repeat(44),databasePath:join(PROJECT_ROOT,'backend/data/sandbox-v2','client-'+randomUUID(),'state.sqlite')});
 const status=vi.spyOn(JsonRpcProvider.prototype,'viewNodeStatus').mockResolvedValue({chain_id:p.chainId,genesis_hash:p.genesisHash} as never);
 const block=vi.spyOn(JsonRpcProvider.prototype,'viewBlock').mockResolvedValue({header:{hash:p.genesisHash}} as never);
 const account=vi.spyOn(JsonRpcProvider.prototype,'viewAccount').mockResolvedValue({code_hash:p.codeHash} as never);
 const call=vi.spyOn(JsonRpcProvider.prototype,'callFunction').mockImplementation(async({method})=>{
  if(method==='ft_metadata')return {decimals:6,symbol:'CCUSD'};
  if(method==='get_state')return {profile:'testnet',admin:p.admin,guardian:p.guardian,treasury:p.treasury,token:p.token};
  throw new Error('Unexpected Sandbox read');
 });
 return {p,status,block,account,call,client:new SandboxVaultClient(p)};
}

it('MOCK RPC: binds the node-reported genesis without requiring an available historical block zero',async()=>{
 const f=fixture();f.block.mockRejectedValue(new Error('Block either has never been observed on the node or has been garbage collected'));
 await expect(f.client.verify()).resolves.toBeUndefined();
 expect(f.block).not.toHaveBeenCalled();
 expect(f.account).toHaveBeenCalledWith({accountId:f.p.vault,blockQuery:{finality:'final'}});
});

it('MOCK RPC: a matching block-zero response cannot override a mismatching node genesis',async()=>{
 const f=fixture();f.status.mockResolvedValue({chain_id:f.p.chainId,genesis_hash:'4'.repeat(44)} as never);
 await expect(f.client.verify()).rejects.toThrow('Sandbox chain/genesis mismatch');
 expect(f.account).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
});

it('MOCK RPC: missing genesis identity fails closed before contract or token reads',async()=>{
 const f=fixture();f.status.mockResolvedValue({chain_id:f.p.chainId} as never);
 await expect(f.client.verify()).rejects.toThrow('Sandbox chain/genesis mismatch');
 expect(f.account).not.toHaveBeenCalled();
});

it('MOCK RPC: public chain identity cannot use a matching local genesis fixture',async()=>{
 const f=fixture();f.status.mockResolvedValue({chain_id:'mainnet',genesis_hash:f.p.genesisHash} as never);
 await expect(f.client.verify()).rejects.toThrow('Sandbox chain/genesis mismatch');
 expect(f.account).not.toHaveBeenCalled();
});
