import {createPublicKey,verify} from 'node:crypto';
import {createRequire} from 'node:module';
const {baseDecode}=createRequire(new URL('../backend/package.json',import.meta.url))('near-api-js');
/** Public Ed25519 signatures and secret keys share an encoding length. Exempt only valid signed transaction evidence. */
export function verifiedTransactionSignatures(buffer){
 const signatures=new Set();let value;try{value=JSON.parse(buffer.toString('utf8'));}catch{return signatures;}
 function walk(node){
  if(!node||typeof node!=='object')return;
  if(typeof node.signature==='string'&&node.signature.startsWith('ed25519:')&&typeof node.public_key==='string'&&node.public_key.startsWith('ed25519:')&&typeof node.hash==='string'){
   try{
    const key=baseDecode(node.public_key.slice(8)),signature=baseDecode(node.signature.slice(8)),hash=baseDecode(node.hash);
    if(key.length===32&&signature.length===64&&hash.length===32&&verify(null,hash,createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key]),format:'der',type:'spki'}),signature))signatures.add(node.signature);
   }catch{/* Invalid evidence remains subject to the normal secret detector. */}
  }
  for(const child of Object.values(node))walk(child);
 }
 walk(value);return signatures;
}
