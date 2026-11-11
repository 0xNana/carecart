import {gloves,type Product} from './ledger';
export const clinicProducts:Product[]=[gloves,
 {...gloves,id:'mn-item-2',sku:'SYRINGE-EACH',name:'Sterile syringes (synthetic)',baseUnit:'each',baselineDailyDemand:6,leadTimeDays:3,safetyStock:12,targetStock:60},
 {...gloves,id:'mn-item-3',sku:'MASK-BOX',name:'Medical masks (synthetic)',packSize:5,baselineDailyDemand:2,leadTimeDays:4,safetyStock:4,targetStock:30},
 {...gloves,id:'mn-item-4',sku:'GAUZE-PACK',name:'Sterile gauze (synthetic)',baseUnit:'pack',baselineDailyDemand:3,safetyStock:6,targetStock:45},
 {...gloves,id:'mn-item-5',sku:'SWAB-BOX',name:'Alcohol swabs (synthetic)',baselineDailyDemand:1,leadTimeDays:7,safetyStock:4,targetStock:24},
 {...gloves,id:'mn-item-6',sku:'SALINE-BAG',name:'Saline bags (synthetic)',baseUnit:'bag',packSize:12,baselineDailyDemand:2,leadTimeDays:3,safetyStock:6,targetStock:36}];
export const openingQuantities=[30,72,40,60,30,48];
/** Trusted, synthetic catalog: base-unit prices, exact packs and reviewed supplier identities. */
export function syntheticOffers(products:Product[],supplierCount:number){return products.flatMap((p,index)=>Array.from({length:supplierCount},(_,rank)=>({
 productId:p.id,supplierId:`mn-supplier-${rank+1}`,account:`supplier-${String.fromCharCode(97+rank)}.local-ops.near`,
 price:(BigInt([50000,10000,70000,30000,60000,500000][index])*BigInt(100+rank*20)/100n).toString(),
 pack:p.packSize,minimum:p.packSize*(rank===1?2:1),available:1000,unit:p.baseUnit,leadTimeDays:p.leadTimeDays,source:'synthetic' as const})));}
