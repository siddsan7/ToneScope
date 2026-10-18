import { eveChannel } from 'eve/channels/eve';
// Eve ingress is disabled. Only the authenticated host broker can start a bounded request.
export default eveChannel({auth:async()=>null});
