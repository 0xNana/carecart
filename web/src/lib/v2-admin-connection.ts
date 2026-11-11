import type {WalletProfile} from './v2-wallet.ts';
type Network='mainnet'|'testnet';
/** Only the public wallet API is retained. Connection neither installs a function-call key nor requests a signature. */
export interface AdminWalletConnector {
 network:Network;
 connect():Promise<{getAccounts(input:{network:Network}):Promise<{accountId:string}[]>;manifest:{features?:{testnet?:boolean;mainnet?:boolean}}}>;
 disconnect(wallet:Awaited<ReturnType<AdminWalletConnector['connect']>>):Promise<void>;
}
export async function connectV2Admin(profile:WalletProfile,factory?:(network:Network)=>Promise<AdminWalletConnector>){
 if(profile.network==='sandbox')throw new Error('Dedicated Sandbox wallet required; do not route it to public testnet');const network=profile.network;
 const connector:AdminWalletConnector=await (factory?factory(network):(async()=>{
  const {NearConnector}=await import('@hot-labs/near-connect');
  const sdk=new NearConnector({network,autoConnect:false,features:{signInWithoutAddKey:true,[network]:true}});
  let connected:Awaited<ReturnType<typeof sdk.connect>>|undefined;
  return {get network(){return sdk.network;},connect:async()=>{connected=await sdk.connect();return connected;},
   disconnect:async()=>{if(connected)await sdk.disconnect(connected);}};
 })());
 const wallet=await connector.connect();
 const verify=async()=>{
  if(connector.network!==network||!wallet.manifest.features?.[network])throw new Error('WALLET_NETWORK_CHANGED');
  const accounts=await wallet.getAccounts({network});
  if(!accounts.some(a=>a.accountId===profile.admin))throw new Error('HUMAN_ADMIN_WALLET_REQUIRED');
  return {accountId:profile.admin,network};
 };
 let identity:Awaited<ReturnType<typeof verify>>;
 try{identity=await verify();}catch(error){await connector.disconnect(wallet);throw error;}
 return {identity,revalidateIdentity:verify,disconnect:()=>connector.disconnect(wallet),
  signingEnabled:false as const,
  // P3B does not activate a public-network human signer, even if the connected account is the admin.
  submit:async()=>{throw new Error('PUBLIC_SIGNING_DISABLED');}};
}
