import Fastify from 'fastify';
import type {DatabaseHandle} from '../src/db';
import {registerInventoryRoutes} from '../src/routes/inventory';
import {registerPurchaseOrderRoutes} from '../src/routes/purchase-orders';
import {registerAgentRoutes} from '../src/routes/agent';
import {registerLiveAgent, type ManualAi} from '../src/routes/live-agent';
import {registerPaymentRoutes} from '../src/routes/payments';
import type {VaultPaymentAdapter} from '../src/payments/adapter';

/** In-process historical handler tests / ephemeral Sandbox only. No listen method is exposed.
 * Public production routes are tested separately through src/server.ts. */
export function legacyHandlerFixture({database,clock=()=>new Date(),paymentAdapter,manualAi}:{
 database:DatabaseHandle;clock?:()=>Date;paymentAdapter?:VaultPaymentAdapter;manualAi?:ManualAi;
}) {
 const app=Fastify({logger:false});
 registerInventoryRoutes(app,database,clock);registerPurchaseOrderRoutes(app,database,clock);
 registerAgentRoutes(app,database,clock);registerLiveAgent(app,database,manualAi);registerPaymentRoutes(app,paymentAdapter);
 return {inject:app.inject.bind(app),ready:app.ready.bind(app),close:app.close.bind(app)};
}
