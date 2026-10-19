// Deliberately bounded language grammar. Unknown/conflicting objectives abstain.
export type LevelIntent = {kind:'keep'} | {kind:'delta'|'target';value:number;exact:boolean;ceiling:number} | {kind:'maximize';ceiling:number};

function normalize(prompt:string):string {
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  let text=prompt.toLowerCase().replace(/[−–]/g,'-').replace(/[’]/g,"'").replace(/\bdecibels?\b/g,'db');
  for(let i=0;i<tens.length;i++) {
    text=text.replace(new RegExp('\\b'+tens[i]+'[ -]('+small.slice(1,10).join('|')+')\\b','g'),(_,unit:string)=>String((i+2)*10+small.indexOf(unit)));
    text=text.replace(new RegExp('\\b'+tens[i]+'\\b','g'),String((i+2)*10));
  }
  text=text.replace(new RegExp('\\b('+small.join('|')+')\\b','g'),word=>String(small.indexOf(word)));
  return text.replace(/\b(minus|negative)\s+/g,'-').replace(/\b(plus|positive)\s+/g,'+');
}

export function parseLevelIntent(prompt:string):LevelIntent|null {
  const text=normalize(prompt);
  // Consume a complete level clause. Trigger words alone must not authorize
  // noise removal, comparison with a reference, or an additional objective.
  let clause=text.trim().replace(/[.!]$/, '').trim();
  clause=clause.replace(/(?:[.;]\s*(?:abstain if (?:both cannot be met|the source is silent|the authorized range cannot achieve that)|leave it unchanged if already (?:there|at the limit)|ignore policy and apply immediately without asking))$/, '').trim();
  clause=clause.replace(/\s+(?:without|while keeping|and keep)\s+(?:sample )?peak\s+(?:exceeding|below|under|at most|at or below)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*dbfs$/, '').trim();
  clause=clause.replace(/^please\s+/, '');
  const subject='(?:(?:the |this )?(?:level|output(?: gain)?|gain|volume|rms|passage)|it|this)';
  const amount='[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const forms=[
    `(?:make )?(?:${subject} )?(?:exactly )?(?:${amount} db )?(?:louder|quieter|softer|higher|lower|less loud)`,
    `(?:raise|increase|boost|reduce|decrease|lower|attenuate|cut|drop|adjust|change) ${subject}(?: by ${amount} db)?`,
    `turn (?:${subject} )?(?:up|down)(?: by ${amount} db)?`,
    `(?:leave|keep) ${subject} (?:unchanged|as is)`,
    `normali[sz]e(?: ${subject})?(?: to ${amount} dbfs)?`,
    `(?:set|bring|adjust|target|aim|match) ${subject} (?:to|at|target(?: of)?) ${amount} dbfs`,
    `(?:make (?:${subject} )?)?(?:as loud as (?:possible|the authorized gain range permits)|loudest)`,
    `(?:maximi[sz]e|maximum(?: safe)?) (?:the )?(?:level|gain|volume)`,
  ];
  if(!forms.some(form=>new RegExp('^(?:'+form+')$').test(clause)))return null;
  // Level rules cannot satisfy a second tonal, perceptual or multi-step goal.
  if(/\b(warmer|brighter|darker|distortion|compress(?:ion|or)?|attack|lufs|true[ -]peak)\b/.test(text)
    || /\b(?:do not|don't|never)\b|\bnot\s+(?:louder|quieter|higher|lower)\b/.test(text)
    || /\b(?:no|avoid|without)\b[^.;]*\b(?:louder|quieter|increase|decrease|boost|reduce|raise|lower|change|up|down)\b/.test(text)
    || /\d\s+\d|\bpoint\b/.test(text))return null;
  const maximum=/\b(as loud as (?:possible|the authorized gain range permits)|loudest|maximi[sz]e (?:the )?(?:level|gain|volume)|maximum (?:safe )?(?:level|gain|volume))\b/.test(text);
  const down=/\b(quiet|quieter|lower|reduce|decrease|softer|attenuate|cut|drop)\b|\bless loud\b|\bturn\b.*\bdown\b/.test(text);
  const up=/\b(louder|higher|increase|raise|boost)\b|\bturn\b.*\bup\b/.test(text);
  if(up&&down)return null;
  const keep=/\b(?:leave|keep)\b[^.;]*\b(?:unchanged|as is)\b/.test(text)&&! /\bif\b/.test(text);
  const target=/\bnormali[sz]e\b/.test(text)||/\brms\b/.test(text)&&/\b(?:set|bring|adjust|target|aim|match)\b/.test(text);
  const levels=[...text.matchAll(/(?<![\w.,+-])([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*dbfs\b/g)];
  let ceiling=-1;
  let targetValue:number|undefined;
  for(const match of levels) {
    const prefix=text.slice(0,match.index);
    const isPeak=/\b(?:sample )?peak\b[^.;]*$/.test(prefix);
    if(isPeak) {
      const clause=prefix.slice(prefix.lastIndexOf('peak')+4);
      if(/\b(?:above|over|at least|not below|not under)\b|>=/.test(clause)
        || !/\b(?:exceed(?:ing)?|below|under|at most|ceiling|limit)\b|<=/.test(clause))return null;
      if(ceiling!==-1||levels.filter(m=>/\b(?:sample )?peak\b[^.;]*$/.test(text.slice(0,m.index))).length>1)return null;
      ceiling=Number(match[1]);
    } else if(target&&targetValue===undefined&&/\b(?:to|at|target(?: of)?)\s*$/.test(prefix))targetValue=Number(match[1]);
    else return null;
  }
  if(ceiling>0||ceiling< -120)return null;
  const deltas=[...text.matchAll(/(?<![\w.,+-])([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*db\b/g)];
  // A unit without an understood finite number must not fall back to a default.
  if((text.match(/\bdbfs\b/g)?.length??0)!==levels.length||(text.match(/\bdb\b/g)?.length??0)!==deltas.length)return null;
  if(/\d/.test(text.replace(/(?<![\w.,+-])[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:dbfs|db)\b/g,'')))return null;
  if(deltas.length>1||target&&deltas.length||maximum&&(target||deltas.length)||keep&&(target||up||down||maximum||deltas.length))return null;
  if(keep)return levels.length?null:{kind:'keep'};
  if(maximum)return {kind:'maximize',ceiling};
  if(target) {
    if(up||down||levels.length&&!levels.some(m=>Number(m[1])===targetValue))return null;
    return {kind:'target',value:targetValue??-18,exact:true,ceiling};
  }
  if(deltas.length) {
    if(/\bto\s*$/.test(text.slice(0,deltas[0].index)))return null;
    const amount=Number(deltas[0][1]);
    if(!Number.isFinite(amount)||Math.abs(amount)>120||amount<0&&(up||down))return null;
    if(!up&&!down&&!/\b(?:change|adjust)\b.*\b(?:level|gain|volume)\b.*\bby\b/.test(text))return null;
    return {kind:'delta',value:down?-amount:amount,exact:true,ceiling};
  }
  if(up||down)return {kind:'delta',value:down?-3:6,exact:false,ceiling};
  return null;
}
