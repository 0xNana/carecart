import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {StockDashboard} from '../src/lib/inventory.ts';

test('overview projects real stock and incoming quantities, respects recording permission and does not invent payment confirmation',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'carecart-overview-ui-'));
 try{
  symlinkSync(resolve('node_modules'),join(folder,'node_modules'),'dir');
  const source=ts.transpileModule(readFileSync('src/components/clinic-overview.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
   .replace(/import Link from ['"]next\/link['"];?/,'import {createElement} from "react"; const Link=({children,...props})=>createElement("a",props,children);')
   .replaceAll('@/lib/product-copy',pathToFileURL(resolve('src/lib/product-copy.ts')).href);
  writeFileSync(join(folder,'overview.mjs'),source);
  const {ClinicOverview}=await import(pathToFileURL(join(folder,'overview.mjs')).href);
  const item={id:'gloves',sku:'GLOVES',name:'Medical gloves (synthetic)',clinicId:'clinic',storeroomId:'main',baseUnit:'box',packSize:10,source:'synthetic',balance:{onHand:4,reserved:0,available:4,incoming:10,inventoryPosition:14,expired:0},forecast:{basis:'baseline',dailyDemand:4,leadTimeDays:5,safetyStock:8,reorderPoint:28,targetStock:48,shortage:true,daysOfSupply:1},movements:[]};
  const data:StockDashboard={tenant:{clinicId:'clinic',syntheticDemo:true},dataOrigin:'synthetic',financialExecution:false,profileFingerprint:'a'.repeat(64),config:{monitoring:false,automaticCases:false,automaticPreparation:false,financialExecution:false,intervalSeconds:30},trackedSkus:1,lowStock:1,criticalStock:1,items:[item],obligations:[],jobs:[],runs:[],caseStates:[],
   deliveries:[{orderId:'incoming',productId:'gloves',caseId:null,expected:10,received:2,remaining:8,confirmedIncoming:0,unverifiedIncoming:8,confirmationReference:null},{orderId:'received',productId:'gloves',caseId:null,expected:10,received:10,remaining:0,confirmedIncoming:0,unverifiedIncoming:0,confirmationReference:null}]};
  const writable=renderToStaticMarkup(createElement(ClinicOverview,{data,canRecord:true}));
  for(const text of ['Monitoring off','Needs your attention','8 boxes remaining','Awaiting supplier confirmation','/app/inventory#receive','/app/inventory#consume'])assert.ok(writable.includes(text),text);
  assert.doesNotMatch(writable,/Payment confirmed|Monitoring active|10 boxes remaining/);
  const readonly=renderToStaticMarkup(createElement(ClinicOverview,{data,canRecord:false}));
  assert.doesNotMatch(readonly,/#receive|#consume/);assert.match(readonly,/View inventory/);
  const empty=renderToStaticMarkup(createElement(ClinicOverview,{data:{...data,items:[],trackedSkus:0,lowStock:0,deliveries:[]},canRecord:true}));
  assert.match(empty,/No stock alerts/);assert.match(empty,/No deliveries expected/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
