import { defineTool } from 'eve/tools';
import { previewInput } from '../lib/contracts.ts';
import { boundRequest } from '../lib/eve-binding.ts';
export default defineTool({description:'compare_candidate: bounded native audio evidence operation; never applies a change.',inputSchema:previewInput,availableInSubagents:false,async execute(input,ctx){return boundRequest(ctx.session.id).call('compare_candidate',input);
}});
