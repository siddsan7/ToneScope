import { defineTool } from 'eve/tools';
import { emptyInput } from '../lib/contracts.ts';
import { boundRequest } from '../lib/eve-binding.ts';
export default defineTool({description:'get_measurements: bounded native audio evidence operation; never applies a change.',inputSchema:emptyInput,availableInSubagents:false,async execute(input,ctx){return boundRequest(ctx.session.id).call('get_measurements',input);
}});
