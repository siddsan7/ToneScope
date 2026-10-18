import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { id } from './contracts.ts';
import type { AssistantService } from './service.ts';
import type { StateStore } from './store.ts';
/** Host-only transport. Bind IPv4 loopback;
 bearer capability never belongs in the webview. */
export function createBroker(service:AssistantService,store:StateStore,token:string,authorizedSessions:ReadonlySet<string>){
 if(Buffer.byteLength(token)<32)throw Error('broker_token_minimum_32_bytes');
 const secret=Buffer.from('Bearer '+token);
 return createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');
res.setHeader('Content-Type','application/json');
const reply=(status:number,data:unknown)=>{res.writeHead(status);
res.end(JSON.stringify(data));
};
 try{const given=Buffer.from(req.headers.authorization??'');
if(req.headers.origin||given.length!==secret.length||!timingSafeEqual(given,secret)){reply(401,{error:'unauthorized'});
return;
}const url=new URL(req.url??'/','http://127.0.0.1');
const session=url.searchParams.get('session_id');
let body:unknown;
 if(req.method==='POST'){const chunks:Buffer[]=[];
let bytes=0;
for await(const chunk of req){const part=Buffer.from(chunk);
bytes+=part.length;
if(bytes>8192){reply(413,{error:'request_bytes_limit'});
return;
}chunks.push(part);
}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
 if(req.method==='POST'&&url.pathname==='/v1/request'){const value=body as {session_id?:string};
if(!value.session_id||!authorizedSessions.has(value.session_id)){reply(403,{error:'session_forbidden'});
return;
}reply(200,await service.run(body));
return;
}
 if(!session||!id.safeParse(session).success||!authorizedSessions.has(session)){reply(403,{error:'session_forbidden'});
return;
}
 const match=/^\/v1\/requests\/([A-Za-z0-9_-]{1,80})(\/cancel)?$/.exec(url.pathname);
 if(match&&req.method==='GET'&&!match[2]){const result=await store.load(session,match[1]);
reply(result?200:404,result??{error:'unknown_request'});
return;
}
 if(match&&req.method==='POST'&&match[2]){service.cancel(session,match[1]);
reply(200,{status:'cancel_requested'});
return;
}
 if(req.method==='DELETE'&&url.pathname==='/v1/session'){await service.deleteSession(session);
reply(200,{status:'deleted'});
return;
}
 reply(404,{error:'unknown_route'});
 }catch(error){if(error instanceof Error&&error.message==='assistant_busy')reply(429,{error:'assistant_busy'});else reply(400,{error:'invalid_or_failed_request'});
}});
}
export async function listenLoopback(server:ReturnType<typeof createBroker>,port=0){await new Promise<void>((resolve,reject)=>{server.once('error',reject);
server.listen(port,'127.0.0.1',resolve);
});
return server.address();
}
