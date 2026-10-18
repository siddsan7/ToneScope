import { defineSandbox,type SandboxSession } from 'eve/sandbox';
import { defineSandboxProvider } from 'eve/sandbox/provider';
// A real deny provider: builds an inert artifact and never creates or resumes compute.
const DisabledSandbox=defineSandboxProvider<Record<string,never>,Record<string,never>,{disabled:true},Record<string,never>,SandboxSession>({name:'tonescope-disabled',environment(){return {async prepare(){return {disabled:true as const};},async start(){throw Error('sandbox_disabled');},async resume(){throw Error('sandbox_disabled');}};}});
export const environment=DisabledSandbox.environment();
export default defineSandbox(async()=>{throw new Error('sandbox_disabled');});
