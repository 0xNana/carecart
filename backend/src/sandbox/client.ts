import {JsonRpcProvider,type SerializedReturnValue} from 'near-api-js';
import type {VaultReader} from '../near/vault-reader';import type {SafetyVaultClient} from '../near/safety-client';
import {SafetyOrderSchema} from '../near/commitments';import {sandboxProfile,type SandboxProfile} from './profile';
/** Actual loopback RPC, never an injected response or public testnet/mainnet alias. No signer exists here. */
export class SandboxVaultClient implements VaultReader {
 readonly profile:SandboxProfile;readonly readOnly=true;readonly injectedReads=false;readonly rpc:JsonRpcProvider;
 constructor(raw:SandboxProfile){this.profile=sandboxProfile(raw);this.rpc=new JsonRpcProvider({url:this.profile.rpcUrl});}
 async verify(){const p=this.profile;const status=await this.rpc.viewNodeStatus();
  // Genesis identity comes from status; historical height zero need not be queryable.
  if(status.chain_id!==p.chainId||status.genesis_hash!==p.genesisHash)throw new Error('Sandbox chain/genesis mismatch');
  const vault=await this.rpc.viewAccount({accountId:p.vault,blockQuery:{finality:'final'}});if(vault.code_hash!==p.codeHash)throw new Error('Sandbox code mismatch');
  const meta=await this.rpc.callFunction<{decimals:number;symbol:string}>({contractId:p.token,method:'ft_metadata',args:{},blockQuery:{finality:'final'}});
  if(!meta||meta.decimals!==6||meta.symbol!=='CCUSD')throw new Error('Sandbox test token mismatch');
  const state=await this.view<Record<string,unknown>>('get_state',{});if(state.profile!=='testnet')throw new Error('Sandbox contract namespace mismatch');
  for(const role of ['admin','guardian','treasury','token'] as const)if(state[role]!==p[role])throw new Error('Sandbox authority mismatch');
 }
 async view<T extends SerializedReturnValue>(method:string,args:Record<string,unknown>):Promise<T>{
  const result=await this.rpc.callFunction<T>({contractId:this.profile.vault,method,args,blockQuery:{finality:'final'}});if(result==null)throw new Error('Sandbox canonical record unavailable');return result;
 }
 async canonicalOrder(poId:string){if(!/^sb-po-[a-f0-9]{56}$/.test(poId))throw new Error('Sandbox PO namespace required');await this.verify();
  const order=SafetyOrderSchema.parse(await this.view('get_purchase_order',{po_id:poId}));if(order.profile!=='testnet'||order.token!==this.profile.token||order.po_id!==poId)throw new Error('Sandbox canonical PO mismatch');return order;}
 async finalTransaction(txHash:string){if(!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash))throw new Error('Sandbox transaction hash required');await this.verify();
  return this.rpc.viewTransactionStatusWithReceipts({txHash,accountId:this.profile.admin,waitUntil:'FINAL'});}
 async approvalReview():Promise<Awaited<ReturnType<SafetyVaultClient['approvalReview']>>>{throw new Error('Sandbox cannot prove a real Base quote or payout');}
 async revalidateApproval():Promise<Awaited<ReturnType<SafetyVaultClient['approvalReview']>>>{throw new Error('Sandbox cannot prove a real Base quote or payout');}
}
