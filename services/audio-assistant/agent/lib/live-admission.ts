import {createHash} from 'node:crypto';
import {z} from 'zod';
import {id,hash,type RequestInput} from './contracts.ts';
import {jsonDigest,type LivePolicy} from './live-policy.ts';
export const admissionRole=z.enum(['scored','setup','lifecycle']);
export const admissionsSchema=z.array(z.object({request_id:id,prompt_sha256:hash,role:admissionRole}).strict()).min(1).max(180).superRefine((rows,ctx)=>{if(new Set(rows.map(r=>r.request_id)).size!==rows.length)ctx.addIssue({code:'custom',message:'duplicate_request_identity'});for(const [role,cap] of [['scored',168],['setup',6],['lifecycle',6]] as const)if(rows.filter(r=>r.role===role).length>cap)ctx.addIssue({code:'custom',message:'admission_role_ceiling'});});
export type Admissions=z.infer<typeof admissionsSchema>;
export const promptDigest=(prompt:string)=>createHash('sha256').update(prompt,'utf8').digest('hex');
export const normalizeAdmissions=(raw:unknown)=>admissionsSchema.parse(raw).sort((a,b)=>a.request_id<b.request_id?-1:a.request_id>b.request_id?1:0);
export const admissionsDigest=(raw:unknown)=>jsonDigest(normalizeAdmissions(raw));
/** Complete consent-bound schedule; host may narrow admitted roles without changing its digest. */
export class AdmissionGuard{
 readonly digest:string;
 private rows:Admissions;
 private roles:ReadonlySet<z.infer<typeof admissionRole>>;
 constructor(raw:unknown,roles:ReadonlyArray<z.infer<typeof admissionRole>>=['scored','setup','lifecycle']){this.rows=normalizeAdmissions(raw);this.digest=admissionsDigest(this.rows);this.roles=new Set(z.array(admissionRole).min(1).max(3).parse(roles));}
 validate(policy:LivePolicy,request:RequestInput){if(policy.admissions_sha256!==this.digest)throw Error('admission_manifest_digest_mismatch');const entry=this.rows.find(e=>e.request_id===request.request_id);if(!entry||!this.roles.has(entry.role)||entry.prompt_sha256!==promptDigest(request.prompt))throw Error('request_not_scheduled');return entry.role;}
}
