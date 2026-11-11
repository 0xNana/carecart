import { afterEach,expect,it,vi } from 'vitest';
import { openAiTransport } from '../agent/live';import { procurementToolDefinitions,toolSchemas } from './tools';
afterEach(()=>vi.unstubAllGlobals());
it('MOCKED PROVIDER TRANSPORT: reuses NEAR adapter with only strict v2 domain tool definitions',async()=>{
 let body:Record<string,unknown>={};
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{body=JSON.parse(String(init.body));return Response.json({id:'fixture-response',object:'chat.completion',created:1,model:'fixture-model',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'ignored'}}]});}));
 const transport=openAiTransport({apiKey:'fixture-not-real',model:'fixture-model',baseURL:'https://cloud-api.near.ai/v1'},procurementToolDefinitions);
 await transport.complete([{role:'system',content:'fixture'}],'fixture-model',Object.keys(toolSchemas));
 const tools=body.tools as {function:{name:string;strict:boolean;parameters:{additionalProperties:boolean;properties:Record<string,unknown>}}}[];
 expect(tools.map(t=>t.function.name)).toEqual(Object.keys(toolSchemas));expect(tools.every(t=>t.function.strict&&t.function.parameters.additionalProperties===false)).toBe(true);
 expect(JSON.stringify(tools)).not.toContain('submit_payment');expect(JSON.stringify(tools)).not.toContain('draft_purchase_order');
});
