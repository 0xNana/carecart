export interface OwnershipWallet {
 manifest:{features?:{signMessage?:boolean;testnet?:boolean}};
 getAccounts(input:{network:'testnet'}):Promise<{accountId:string}[]>;
 signMessage(input:{message:string;recipient:string;nonce:Uint8Array;network:'testnet';signerId:string}):Promise<{accountId:string;publicKey:string;signature:string}>;
}
export async function connectOwnershipWallet(factory?:()=>Promise<{network:string;wallet:OwnershipWallet;disconnect:()=>Promise<void>}>){
 const connection=await (factory?factory():(async()=>{const {NearConnector}=await import('@hot-labs/near-connect');const connector=new NearConnector({network:'testnet',autoConnect:false,features:{signMessage:true,signInWithoutAddKey:true,testnet:true}});const wallet=await connector.connect();return {get network(){return connector.network;},wallet,disconnect:()=>connector.disconnect(wallet)};})());
 const validate=()=>{if(connection.network!=='testnet'||!connection.wallet.manifest.features?.testnet||!connection.wallet.manifest.features?.signMessage||typeof connection.wallet.signMessage!=='function')throw new Error('This wallet cannot prove NEP-413 ownership on testnet. No transaction fallback is available.');};
 try{validate();const accounts=await connection.wallet.getAccounts({network:'testnet'});if(!accounts[0]?.accountId)throw new Error('Select a testnet account');return {accountId:accounts[0].accountId,disconnect:connection.disconnect,async prove(challenge:{accountId:string;network:string;payload:{message:string;recipient:string;nonce:string}}){validate();if(challenge.network!=='testnet'||challenge.accountId!==accounts[0].accountId)throw new Error('Wallet challenge context changed');const current=await connection.wallet.getAccounts({network:'testnet'});if(!current.some(a=>a.accountId===challenge.accountId))throw new Error('Wallet account changed');return connection.wallet.signMessage({...challenge.payload,nonce:Uint8Array.from(atob(challenge.payload.nonce),c=>c.charCodeAt(0)),network:'testnet',signerId:challenge.accountId});}};}catch(e){await connection.disconnect();throw e;}
}
/** CLI signatures are public proof, never a private key or a transaction. Backend NEP-413 verification remains mandatory. */
export function parseOwnershipProof(text:string,challenge:{id:string;accountId:string}){
 const p=JSON.parse(text) as {challengeId:string;accountId:string;publicKey:string;signature:string};
 if(!p||typeof p!=='object'||Object.keys(p).sort().join(',')!=='accountId,challengeId,publicKey,signature'||p.challengeId!==challenge.id||p.accountId!==challenge.accountId||!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.publicKey)||!/^[A-Za-z0-9+/]{86}==$/.test(p.signature))throw new Error('Exact public NEP-413 proof required');
 return p;
}
