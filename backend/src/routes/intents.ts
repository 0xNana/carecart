import type {FastifyInstance} from 'fastify';
/** Legacy simulation URLs are retired. Intents domain/settlement harnesses remain test-only or separately gated. */
export function registerIntentsRoutes(app:FastifyInstance){
 for(const path of ['/api/intents/config','/api/intents/preview','/api/intents/dry-quote'])app.route({method:['GET','POST'],url:path,handler:async(_request,reply)=>reply.header('Cache-Control','no-store').code(410).send({error:{code:'SIMULATION_RETIRED',message:'Use the authenticated CareCart application. No simulation or settlement was initiated.'}})});
}
