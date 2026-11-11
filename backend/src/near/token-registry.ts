/** Reviewed publisher addresses + finalized read observations dated 2026-11-06. No symbol-based authenticity inference. */
export const PUBLIC_TOKENS={
 mainnet:{account:'17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',codeHash:'DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q',decimals:6,kind:'native-usdc',financialValue:true},
 testnet:{account:'3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',codeHash:'EoAUFWELjD9gYzsjKDXYRmHDHf1RJ95jaKNSYE6v9b2z',decimals:6,kind:'public-testnet-test-token',financialValue:false},
} as const;
export function publicToken(network:'mainnet'|'testnet',account:string){const token=PUBLIC_TOKENS[network];if(account!==token.account)throw new Error('Unsupported or wrong-network token contract');return token;}
export function verifyTokenObservation(network:'mainnet'|'testnet',account:string,codeHash:string,metadata:{decimals?:number;symbol?:string;spec?:string}){
 const token=publicToken(network,account);if(codeHash!==token.codeHash)throw new Error('Token code identity changed; independent review required');if(metadata.decimals!==token.decimals)throw new Error('Token decimals mismatch');if(metadata.symbol!=='USDC'||metadata.spec!=='ft-1.0.0')throw new Error('Token metadata/interface mismatch');return token;
}
