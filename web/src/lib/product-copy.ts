/** Presentation only. Persisted events, API codes and payment evidence stay unchanged. */
const labels: Record<string, string> = {
 FinancialExecutionDisabled:'Payments unavailable', QuoteExpired:'Offer expired', SupplierNotApproved:'Supplier is not approved',
 HardCapExceeded:'Amount is above the payment limit', InsufficientSpendable:'Not enough funds available',
 Opened:'Low stock', InventoryRecorded:'Stock updated', ForecastEvaluated:'Supply need checked',
 QuotesAvailable:'Supplier offers ready', SupplierSelected:'Offer selected', PoDrafted:'Order prepared',
 CommitmentPending:'Order awaiting confirmation', PoCommitted:'Order confirmed',
 PaymentRequestPending:'Payment awaiting confirmation', AwaitingHumanApproval:'Waiting for payment review',
 DispatchInProgress:'Payment being processed', SameChainConfirmed:'Payment confirmed', SourceDispatched:'Payment sent · recipient confirmation pending',
 DestinationSettled:'Payment confirmed', RequiresReconciliation:'Check payment status', Unobserved:'Not checked yet',
 AuthorizeCommitment:'Confirm order', AuthorizePayment:'Review payment', PendingApproval:'Waiting for payment review',
 Receive:'Stock received', Dispense:'Stock dispensed', Consume:'Consumption recorded', AdjustUp:'Stock increased', AdjustDown:'Stock decreased',
 Reserve:'Stock reserved', Release:'Reservation released', Unusable:'Stock marked unusable', ConfirmInbound:'Delivery confirmed', CancelInbound:'Delivery cancelled',
 InventoryEvaluated:'Stock checked', InventoryEvaluationFailed:'Stock check failed', OrderProposalLinked:'Replenishment started',
 AutonomyConfigured:'Monitoring settings updated', SyntheticCatalogSnapshot:'Sample offers updated',
 Authorized:'Approved', Executing:'Processing', Observed:'Checked', Completed:'Completed', Failed:'Failed',
 Running:'In progress', Stale:'Needs attention', Healthy:'Online', Missing:'Not reported', Disabled:'Off',
 NotObserved:'Not checked yet', NotConfigured:'Not set up', UnknownSupplier:'Supplier not approved',
 InsufficientFunds:'Not enough funds', DailyLimitExceeded:'Daily payment limit reached', Paused:'Paused',
 Rejected:'Declined', Refunded:'Refunded', Cancelled:'Cancelled', Expired:'Expired',
 Submitted:'Submitted · awaiting verification', Paid:'Payment confirmed', Prepared:'Ready for review',
};
export function statusLabel(value:string){return labels[value]??value.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');}
export function stockActionLabel(kind:string){return ({Receive:'Receive Stock',Dispense:'Dispense Stock',Consume:'Record Consumption',AdjustUp:'Adjust Stock (increase)',AdjustDown:'Adjust Stock (decrease)',Reserve:'Reserve stock',Release:'Release reservation',Unusable:'Mark unusable',ConfirmInbound:'Confirm expected delivery',CancelInbound:'Cancel expected delivery'} as Record<string,string>)[kind]??statusLabel(kind);}
export function unitLabel(unit:string,count=2){
 if(unit==='each')return count===1?'item':'items';
 if(count===1)return unit;
 return ({box:'boxes',pack:'packs',bag:'bags'} as Record<string,string>)[unit]??unit+'s';
}
export function displayTime(value:string|number|null|undefined){
 if(value===null||value===undefined||value==='')return 'Not recorded';
 const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(): 'Not recorded';
}
/** Public links only for explicitly identified testnet receipts, never fixtures or Sandbox. */
export function testnetTransactionUrl(execution:string,profile:string,evidence:string|null){
 if(execution!=='public-rpc'||profile!=='testnet'||!evidence)return null;
 try{const hash=JSON.parse(evidence).transactionHash;return typeof hash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash)?'https://testnet.nearblocks.io/txns/'+hash:null;}catch{return null;}
}
export function actionError(cause:unknown,fallback='The action could not be completed. Refresh and try again.'){
 const code=cause instanceof Error?cause.message:String(cause??'');
 if(code==='CASE_OR_SERVICE_EVIDENCE_INVALID')return fallback;
 if(/AUTH_|IDENTITY_|SESSION_|401/.test(code))return 'Your session has expired. Sign in again to continue.';
 if(/PERMISSION|OPERATOR_REQUIRED|MEMBERSHIP|403/.test(code))return 'Your clinic role does not allow this action.';
 if(/INSUFFICIENT|NEGATIVE|AVAILABLE_STOCK/.test(code))return 'There is not enough available stock. Check the quantity and unit.';
 if(/DUPLICATE|RECEIPT_ALREADY|REFERENCE_ALREADY/.test(code))return 'This reference is already recorded. Check stock activity before trying again.';
 if(/STALE|PROFILE_MISMATCH|CONTEXT_CHANGED|NONCE|CSRF/.test(code))return 'The records or session changed. Refresh before trying again.';
 if(/RATE_LIMIT|429/.test(code))return 'Too many requests. Wait a minute before trying again.';
 if(/INVALID|UNIT|QUANTITY/.test(code))return 'Check the quantity, unit and required fields.';
 return fallback;
}
