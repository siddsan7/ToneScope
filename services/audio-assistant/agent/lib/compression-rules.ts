import type { Snapshot, Measurement, Patch, Proposal, RequestInput } from './contracts.ts';
import type { RequestTools } from './service.ts';

// Dispatch broadly, then accept only the complete bounded grammar below.
export const isCompressionRequest=(prompt:string)=>/compress|contrast|hard[- ]soft|soft passage|hard passage/i.test(prompt);
type Context=Snapshot & {
 passages?:{origin:'manual';soft:[number,number];hard:[number,number]};
 processing?:{compressor:boolean;multiband:boolean;equalizer:boolean;drive:boolean};
};
const number='(?:\\d+(?:\\.\\d+)?|zero|two|three|six)';
const intent=new RegExp(`^(?:please )?reduce the hard[- ]soft rms contrast by (${number}) db while preserving the soft passage level(?: and keeping (?:the )?sample peak (?:below|at or below) -1 dbfs)?[.!]?$`);
const words:Record<string,number>={zero:0,two:2,three:3,six:6};
const abstain=(reason:string)=>({status:'abstain' as const,reason});
export async function runCompressionRules(request:RequestInput,snapshot:Snapshot,measurements:Measurement[],tools:Pick<RequestTools,'render'|'compare'>){
 const match=intent.exec(request.prompt.toLowerCase().trim().replace(/\s+/g,' '));
 if(!match)return abstain('The compression baseline requires an explicit hard-soft RMS contrast reduction while preserving the soft passage level.');
 const target=words[match[1]]??Number(match[1]);
 if(!Number.isFinite(target)||target<0)return abstain('The requested contrast reduction is invalid.');
 const s=snapshot as Context,p=s.passages,top=s.processing;
 if(!p||p.origin!=='manual'||!top||!top.compressor||top.multiband||top.equalizer||top.drive)return abstain('Manual passages and an enabled full-band compressor without other processing are required.');
 const intervals=[p.soft,p.hard];
 if(intervals.some(x=>!Array.isArray(x)||x.length!==2||x.some(v=>!Number.isSafeInteger(v))||x[0]<s.selection_samples[0]||x[1]>s.selection_samples[1]||x[1]<=x[0])||Math.max(p.soft[0],p.hard[0])<Math.min(p.soft[1],p.hard[1]))return abstain('The manual passages must be disjoint and inside the selection.');
 const control=(stage:string,id:string,unit:string)=>{const found=s.parameters.filter(x=>x.stage_id===stage&&x.parameter_id===id&&x.unit===unit);const x=found[0];return found.length===1&&typeof x.value==='number'&&Number.isFinite(x.value)&&Number.isFinite(x.min)&&Number.isFinite(x.max)&&x.min<=x.value&&x.value<=x.max?x:undefined;};
 const threshold=control('compressor','thresholdDb','dBFS'),ratio=control('compressor','ratio','ratio'),attack=control('compressor','attackMs','ms'),release=control('compressor','releaseMs','ms');
 const zero=[control('input','inputDb','dB'),control('output','outputDb','dB'),control('compressor','makeupDb','dB'),control('compressor','kneeDb','dB')];
 if(!threshold||threshold.value!==0||!ratio||Number(ratio.value)<=1||!attack||Number(attack.value)<=0||Number(attack.value)>20||!release||Number(release.value)<=0||Number(release.value)>200||zero.some(x=>!x||x.value!==0))return abstain('The compression baseline requires an uncompressed baseline and fixed neutral gains, hard knee, ratio and bounded timing.');
 const metric=(data:Measurement[],id:string,unit:string)=>{const found=data.filter(x=>x.measurement_id===id&&x.unit===unit);return found.length===1&&Number.isFinite(found[0].value)?found[0]:undefined;};
 const ids=['rms_dbfs','peak_dbfs','soft_rms_dbfs','soft_peak_dbfs','hard_rms_dbfs','hard_peak_dbfs','hard_soft_contrast_db'];
 const evidence=ids.map(id=>metric(measurements,id,id==='hard_soft_contrast_db'?'dB':'dBFS'));
 if(evidence.some(x=>!x))return abstain('Complete calibrated overall and passage measurements are required.');
 const [overall,peak,soft,softPeak,hard,hardPeak,contrast]=evidence as Measurement[];
 if(soft.value<=-180||hard.value<=-180||hard.value<=soft.value||Math.abs(contrast.value-(hard.value-soft.value))>1e-5||overall.value>peak.value||soft.value>softPeak.value||hard.value>hardPeak.value)return abstain('The passage energy or contrast evidence is invalid.');
 if(peak.value> -1||softPeak.value>peak.value+1e-5||hardPeak.value>peak.value+1e-5)return abstain('The baseline sample peak exceeds the supported ceiling.');
 if(target===0)return {status:'noop' as const,reason:'The requested contrast reduction leaves the compressor unchanged.'};
 const slope=1-1/Number(ratio.value);
 let value=hard.value-target/slope;
 const feasible=(v:number)=>Number.isFinite(v)&&v>=threshold.min&&v<=threshold.max&&v>=soft.value;
 if(!feasible(value))return abstain('The requested reduction cannot preserve the soft passage within the authorized threshold range.');
 for(let attempt=0;attempt<2;attempt++){
  const patch:Patch[]=[{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dBFS',value}];
  const preview=await tools.render({parameter_patch:patch});
  const comparison=await tools.compare({preview_id:preview.preview_id});
  const softDelta=metric(comparison,'soft_rms_delta_db','dB'),hardDelta=metric(comparison,'hard_rms_delta_db','dB'),contrastDelta=metric(comparison,'contrast_delta_db','dB');
  const candidatePeak=metric(preview.measurements,'preview_peak_dbfs','dBFS');
  const candidateSoft=metric(preview.measurements,'preview_soft_rms_dbfs','dBFS'),candidateHard=metric(preview.measurements,'preview_hard_rms_dbfs','dBFS');
  if(!softDelta||!hardDelta||!contrastDelta||!candidatePeak||!candidateSoft||!candidateHard)return abstain('Complete rendered passage evidence is required.');
  if(Math.abs((hardDelta.value-softDelta.value)-contrastDelta.value)>1e-5||Math.abs(candidateSoft.value-soft.value-softDelta.value)>1e-5||Math.abs(candidateHard.value-hard.value-hardDelta.value)>1e-5)return abstain('Rendered passage evidence is inconsistent.');
  if(Math.abs(softDelta.value)>.5||candidatePeak.value> -1+.05)return abstain('The rendered candidate violates soft passage preservation or sample peak limits.');
  const achieved=-contrastDelta.value;
  if(Math.abs(achieved-target)<=.5){
   const proposal:Proposal={schema_version:1,request_id:request.request_id,session_revision:s.session_revision,source_sha256:s.source_sha256,base_graph_sha256:s.base_graph_sha256,selection_samples:s.selection_samples,hypotheses:['A bounded threshold adjustment reduces the measured hard-soft contrast.'],evidence_refs:evidence as Measurement[],parameter_patch:patch,expected_tradeoffs:['Compression changes the hard passage envelope; compare before accepting.'],limitations:['Deterministic passage RMS baseline; no perceptual or transient quality judgment.'],requires_user_acceptance:true};
   return {status:'ready' as const,preview_id:preview.preview_id,proposal};
  }
  value+=(achieved-target)/slope;
  if(!feasible(value))break;
 }
 return abstain('The bounded rendered candidates did not meet the requested contrast reduction.');
}
