import type { RequestTools } from './service.ts';
const requests=new Map<string,RequestTools>();
/** Only a trusted host provider binds an Eve runtime session to an already authorized request. */
export function bindEveSession(sessionId:string,tools:RequestTools){if(requests.has(sessionId))throw Error('session_already_bound');
requests.set(sessionId,tools);
return ()=>requests.delete(sessionId);
}
export function boundRequest(sessionId:string){const tools=requests.get(sessionId);
if(!tools)throw Error('unauthorized_eve_session');
tools.check();
return tools;
}
