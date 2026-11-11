import {roleCredentials} from '../ops/role-credentials';
import {localOperationsProfile,assertNoSigningCredentials} from '../operations/local';
import {digest} from '../intents/settlement';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {InventoryLedger,gloves} from './ledger';
import type {TenantBinding} from './model';
import {InventoryMonitor} from './monitor';
import {V2ProcurementStore,type InventoryQuoteSource} from '../procurement/v2-store';
import {ReplenishmentWorkflow} from '../workflow/cases';
import {clinicProducts,openingQuantities,syntheticOffers} from './catalog';
import {testnetProfile} from '../profiles/testnet';
import type {SafetyProfile} from '../near/safety-profile';

export const offers=syntheticOffers([gloves],2);
/** Separate clinic and Playground workspaces share the same ledger and P1/P2 engine. */
export function openInventoryOperations(name='inventory-runtime',clock=()=>Date.now(),options:{dataset?:'clinic'|'playground';tenant?:TenantBinding;testnet?:{profile:SafetyProfile;suppliers:string[]};financialWorker?:'committer'|'requester'}={}){
 if(options.financialWorker){
  if(!options.testnet||!options.tenant||process.env.CARECART_TENANT_FINANCIAL_MODE!=='near-testnet')throw new Error('Explicit owned testnet financial worker required');
  roleCredentials(options.financialWorker);
 }else{assertNoSigningCredentials(process.env);}
 const clinic=options.dataset==='clinic',products=(clinic?clinicProducts:[gloves]).map(p=>options.tenant?{...p,clinicId:options.tenant.clinicId,storeroomId:options.tenant.storeroomId}:p),quotes=clinic?syntheticOffers(products,3):structuredClone(offers);
 const profile=options.testnet?testnetProfile(options.testnet.profile).profile:localOperationsProfile(name),fingerprint=digest(profile);
 if(options.testnet){
  if(options.testnet.suppliers.length!==3||new Set(options.testnet.suppliers).size!==3||options.testnet.suppliers.some(s=>!s.endsWith('.testnet')))throw new Error('Three independent reviewed testnet suppliers required');
  for(const offer of quotes)offer.account=options.testnet.suppliers[Number(offer.supplierId.split('-').at(-1))-1];
 }
 mkdirSync(dirname(profile.databasePath),{recursive:true});
 const inventory=new InventoryLedger(profile.databasePath,fingerprint,products,clock,undefined,options.tenant);
 try{
  const catalogDefinition={dataset:clinic?'clinic':'playground',source:'synthetic',offers:quotes};
  inventory.registerCatalog(catalogDefinition,'synthetic-catalog');
  const offerFor=(itemId:string,supplierId:string,leadTime:number)=>{
   const p=inventory.product(itemId);const offer=quotes.find(o=>o.productId===itemId&&o.supplierId===supplierId);
   if(!offer||offer.unit!==p.baseUnit||offer.pack!==p.packSize||offer.leadTimeDays!==leadTime)throw new Error('Supplier product units/lead time unavailable');
   return offer;
  };
  const quantityFor=(amount:number,offer:typeof quotes[number])=>{
   const q=Math.ceil(Math.max(amount,offer.minimum)/offer.pack)*offer.pack;
   if(!Number.isSafeInteger(q)||q<=0||q>offer.available)throw new Error('Supplier pack/minimum/stock invalid');return q;
  };
  const current=(itemId:string)=>{const f=inventory.forecast(itemId);return {onHand:Math.max(0,f.inventoryPosition),reorderPoint:f.reorderPoint,usageUnits:f.dailyDemand*30};};
  const source:InventoryQuoteSource={current,currentQuote(itemId,supplierId,leadTime){const f=inventory.forecast(itemId),offer=offerFor(itemId,supplierId,leadTime);return {recommendedQuantity:quantityFor(f.recommendedQuantity,offer),leadTimeDemand:f.leadTimeDemand};},
   snapshot(eventId,itemId){const f=inventory.evaluation(eventId,itemId);return {onHand:Math.max(0,f.inventoryPosition),reorderPoint:f.reorderPoint,usageUnits:f.dailyDemand*30};},
   quote(eventId,itemId,supplierId,leadTime){const f=inventory.evaluation(eventId,itemId),offer=offerFor(itemId,supplierId,leadTime);
    return {recommendedQuantity:quantityFor(f.recommendedQuantity,offer),leadTimeDemand:f.leadTimeDemand,expiresAt:new Date(Date.parse(f.issuedAt)+3600000).toISOString()};}};
  const suppliers=[...new Map(quotes.map(o=>[o.supplierId,{id:o.supplierId,account:o.account,destination:'Near'}])).values()];
  const catalog={version:1,profile:options.testnet?'testnet-ccusd-v2':'local-usdc-v2',token:profile.token,decimals:6,asset:options.testnet?'CCUSD':'USDC',
   items:products.map((p,i)=>({id:p.id,name:p.name,onHand:i===0?12:openingQuantities[i],reorderPoint:p.baselineDailyDemand*p.leadTimeDays+p.safetyStock,usageUnits:p.baselineDailyDemand*30})),suppliers,
   entries:quotes.map(o=>({itemId:o.productId,supplierId:o.supplierId,unitPriceAtomic:o.price,leadTimeDays:o.leadTimeDays}))};
  const store=new V2ProcurementStore(profile,catalog,source),workflow=new ReplenishmentWorkflow(store),monitor=new InventoryMonitor(inventory,workflow);
  inventory.db.transaction(()=>{
   const seeded=inventory.db.prepare("SELECT 1 FROM inventory_audit WHERE json_extract(body_json,'$.type')='ClinicRuntimeInitialized'").get();
   if(clinic&&!seeded)inventory.configure({...inventory.config(),monitoring:false,automaticCases:false,automaticPreparation:false},'synthetic-seed');
   if(!options.tenant||options.tenant.syntheticDemo)products.forEach((p,i)=>inventory.move({id:i===0?'opening-gloves':'opening-'+p.sku,productId:p.id,kind:'Opening',quantity:clinic?openingQuantities[i]:12,unit:'base',source:'synthetic'},'synthetic-seed'));
   if(clinic&&!seeded)inventory.audit('ClinicRuntimeInitialized',{products:products.map(p=>p.id),financialExecution:false},'synthetic-seed');
  }).immediate();
  return {name,inventory,store,workflow,monitor,refreshCatalog:(actor:string)=>inventory.refreshCatalog(actor),close(){workflow.close();store.close();inventory.close();}};
 }catch(error){inventory.close();throw error;}
}
