"""Rebuild static contract/traceability seeds. Does not award completion."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def save(path, obj):
    p = ROOT / path
    if path == 'delivery/pr-manifest.json' and p.exists():
        return  # Never reset durable task status while refreshing contract seeds.
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2) + '\n', encoding='utf-8')

ranges = {
    'inputDb':(-24,24,0,'dB'), 'thresholdDb':(-60,0,-18,'dBFS'),
    'ratio':(1,20,4,'ratio'), 'attackMs':(.1,100,10,'ms'),
    'releaseMs':(10,2000,150,'ms'), 'kneeDb':(0,24,6,'dB'),
    'makeupDb':(-24,24,0,'dB'), 'lowDb':(-18,18,0,'dB'),
    'midDb':(-18,18,0,'dB'), 'highDb':(-18,18,0,'dB'),
    'midHz':(20,20000,1000,'Hz'), 'midQ':(.2,10,.707,'Q'),
    'driveDb':(0,36,6,'dB'), 'toneHz':(20,20000,5000,'Hz'),
    'outputDb':(-24,24,0,'dB'),
    'crossoverLowHz':(20,76800,200,'Hz'),
    'crossoverHighHz':(40,86400,2000,'Hz')
}
properties = {k:{'type':'number','minimum':v[0],'maximum':v[1],'default':v[2]} for k,v in ranges.items()}
properties.update({k:{'type':'boolean','default':False} for k in ('compressor','equalizer','drive','multiband')})
properties['oversampling']={'type':'integer','enum':[1,2,4],'default':1}
properties['order']={'type':'array','minItems':3,'maxItems':3,'uniqueItems':True,'items':{'type':'integer','enum':[0,1,2]}}
save('libs/contracts/session.schema.json', {
    '$schema':'https://json-schema.org/draft/2020-12/schema', '$id':'urn:tonescope:session:1',
    'type':'object','additionalProperties':False,'required':['schema_version','parameters'],
    'properties':{'schema_version':{'const':1},'source':{'type':'string','maxLength':32768},
                  'source_sha256':{'type':'string','pattern':'^[0-9a-f]{64}$'},
                  'ui':{'type':'object','additionalProperties':False,'properties':{
                      'selection_start':{'type':'number','minimum':0,'maximum':1},
                      'selection_end':{'type':'number','minimum':0,'maximum':1},
                      'audition':{'enum':['dry','wet','residual']},'rms_match':{'type':'boolean'}}},
                  'parameters':{'type':'object','additionalProperties':False,'properties':properties}}
})
save('libs/contracts/parameters.json', {'schema_version':1,'sample_rate_hz':[44100,48000,96000],
    'parameters':[{'id':k,'minimum':v[0],'maximum':v[1],'default':v[2],'unit':v[3],
                   'smoothing_ms':15,'sample_rate_constraint':'Hz values <= 0.45 * sample rate' if v[3]=='Hz' else None} for k,v in ranges.items()]})
titles=['Repository charter','Reproducible toolchain','Contracts and parameter registry','Evaluation skeleton',
        'Headless engine and renderer','Windows live device shell','File transport and dry recorder',
        'EQ and smooth parameters','Compressor','Oversampled overdrive','Metering and analysis transport',
        'Integrated effects interface','Fair A/B and alignment','Time/frequency microscope',
        'Residual and dynamics views','Three-band processing','Reorderable graph','Sessions export and recovery',
        'Accessible interaction and usability','Adversarial and performance hardening','Windows release packaging',
        'AI tool contracts and fixtures','Assistant service and UI','AI evaluation and ablations',
        'AI qualification','Portfolio evidence and learning']
deps=[[],[0],[1],[2],[2,3],[4],[4,5],[4],[4],[7],[4],[5,6,7,8,9,10],[9,10,11],[10,12],[8,12,13],[7,8,12],[9,15],[13,14,15,16],[17],[16,17],[18,19],[3,17],[21],[22],[20,23],[20,24]]
save('delivery/pr-manifest.json', {'schema_version':1,'base_commit':'22fe89a',
    'tasks':[{'id':f'PR-{i:02}','title':t,'depends_on':[f'PR-{d:02}' for d in deps[i]],
              'status':'planned','evidence':[]} for i,t in enumerate(titles)]})

if __name__ == '__main__':
    print('Wrote static schema, parameter and dependency seeds; no checks awarded.')
