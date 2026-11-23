import {calibrate,independentTrainingRows,type ScoredForecast} from './forecast';
export function learningProfile(rows:ScoredForecast[],category:string,method:string,at:string){
  // Labels must have been available then, not merely resolved later in hindsight.
  const past=independentTrainingRows(rows.filter(r=>r.category===category&&r.method===method&&r.at<at&&r.resolved_at<at).map(r=>({...r,probability:r.raw_probability??r.probability}))).sort((a,b)=>a.resolved_at.localeCompare(b.resolved_at));
  const cut=Math.floor(past.length*.65),train=past.slice(0,cut),boundary=past[cut]?.at;
  const held=past.slice(cut).filter(r=>boundary&&r.at>=boundary&&train.every(t=>t.resolved_at<r.at));
  const loss=(rs:ScoredForecast[],adjust:boolean)=>rs.length?rs.reduce((s,r)=>s+((adjust?calibrate(r.probability,train).probability:r.probability)-r.outcome)**2,0)/rs.length:null;
  const before=loss(held,false),after=loss(held,true),validated=past.length>=30&&train.length>=15&&held.length>=10&&after!==null&&before!==null&&after+.005<before;
  return {as_of:at,category,method,events:past.length,validation_events:held.length,raw_brier:before,adjusted_brier:after,enabled:validated,
    average_predicted:past.length?past.reduce((s,r)=>s+r.probability,0)/past.length:null,observed_rate:past.length?past.reduce((s,r)=>s+r.outcome,0)/past.length:null,
    correction:validated?'Calibration des probabilités validée sur des événements ultérieurs distincts.':'Mémoire factuelle disponible ; amélioration de calibration non démontrée.',training:past};
}
export function learnedForecast(value:any,profile:ReturnType<typeof learningProfile>){
  const {training,...evidence}=profile;
  if(value.probability===null||!profile.enabled)return {...value,learning:evidence};
  const corrected=calibrate(value.probability,training).probability;
  return {...value,raw_probability:value.probability,probability:corrected,lower:Math.min(value.lower,corrected),upper:Math.max(value.upper,corrected),learning:evidence};
}
