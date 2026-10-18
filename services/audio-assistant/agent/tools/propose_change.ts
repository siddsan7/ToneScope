import { defineTool } from 'eve/tools';
import { proposalSchema } from '../lib/contracts.ts';
import { boundRequest } from '../lib/eve-binding.ts';
export default defineTool({description:'propose_change: bounded native audio evidence operation; never applies a change.',inputSchema:proposalSchema,availableInSubagents:false,async execute(input,ctx){return boundRequest(ctx.session.id).call('propose_change',input);
}});
