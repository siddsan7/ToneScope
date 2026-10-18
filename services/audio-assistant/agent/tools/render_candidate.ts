import { defineTool } from 'eve/tools';
import { renderInput } from '../lib/contracts.ts';
import { boundRequest } from '../lib/eve-binding.ts';
export default defineTool({description:'render_candidate: bounded native audio evidence operation; never applies a change.',inputSchema:renderInput,availableInSubagents:false,async execute(input,ctx){return boundRequest(ctx.session.id).call('render_candidate',input);
}});
