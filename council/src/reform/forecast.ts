import {z} from 'zod';
export const ForecastSchema=z.object({
  probability:z.number().min(0).max(1).nullable(),lower:z.number().min(0).max(1).nullable(),upper:z.number().min(0).max(1).nullable(),
  method_id:z.enum(['judgement','weather-residual-v1','sport-ratings-v1']),data_confidence:z.enum(['LOW','MEDIUM','HIGH']),
  evidence_ids:z.array(z.string().max(100)).max(8),essential_missing:z.array(z.string().max(200)).max(6),
  rationale:z.string().min(30).max(1200),falsifier:z.string().min(15).max(500),search_requests:z.array(z.string().max(160)).max(2),
}).strict();
export type Forecast=z.infer<typeof ForecastSchema>;
export function validateForecast(f:Forecast,sourceIds:string[]){
  if(f.probability===null){if(f.lower!==null||f.upper!==null)throw Error('UNKNOWN_PROBABILITY_HAS_NO_INTERVAL');}
  else if(f.lower===null||f.upper===null||f.lower>f.probability||f.probability>f.upper)throw Error('INVALID_PROBABILITY_INTERVAL');
  if(f.evidence_ids.some(id=>!sourceIds.includes(id)))throw Error('UNVERIFIED_FORECAST_SOURCE');
  if(f.probability!==null&&!f.evidence_ids.length)throw Error('PROBABILITY_REQUIRES_EVIDENCE');
  return f;
}
export type ScoredForecast={packet?:string;event:string;market:string;at:string;resolved_at:string;probability:number;baseline:number;outcome:0|1;method:string;category:string};
export function score(rows:ScoredForecast[]){
  const unique=[...new Map([...rows].sort((a,b)=>a.at.localeCompare(b.at)).map(r=>[r.market+':'+r.method,r])).values()];
  if(!unique.length)return {n:0,events:0,brier:null,baseline_brier:null,calibration_error:null,improvement:null,bins:[]};
  const bins=Array.from({length:10},(_,i)=>{const rs=unique.filter(r=>Math.min(9,Math.floor(r.probability*10))===i);return {from:i/10,to:(i+1)/10,n:rs.length,predicted:rs.length?rs.reduce((n,r)=>n+r.probability,0)/rs.length:null,observed:rs.length?rs.reduce((n,r)=>n+r.outcome,0)/rs.length:null};});
  const brier=unique.reduce((n,r)=>n+(r.probability-r.outcome)**2,0)/unique.length,baseline=unique.reduce((n,r)=>n+(r.baseline-r.outcome)**2,0)/unique.length;
  // Cluster errors at the EVENT level: variants of a fixture are not independent.
  const groups=new Map<string,number[]>();for(const r of unique){const a=groups.get(r.event)||[];a.push((r.baseline-r.outcome)**2-(r.probability-r.outcome)**2);groups.set(r.event,a);}
  const improvements=[...groups.values()].map(xs=>xs.reduce((n,x)=>n+x,0)/xs.length),mean=improvements.reduce((n,x)=>n+x,0)/improvements.length;
  const se=improvements.length>1?Math.sqrt(improvements.reduce((n,x)=>n+(x-mean)**2,0)/(improvements.length-1)/improvements.length):null;
  return {n:unique.length,events:groups.size,brier,baseline_brier:baseline,calibration_error:bins.reduce((n,b)=>n+b.n*Math.abs((b.predicted||0)-(b.observed||0)),0)/unique.length,
    improvement:{mean,lower95:se===null?null:mean-1.96*se,upper95:se===null?null:mean+1.96*se,approximation:'event-cluster normal interval; unreliable for small or dependent samples'},bins};
}
export function chronologicalSplit(rows:ScoredForecast[],cutoff:string){
  // Training sees only labels actually available by the cutoff; event leakage is excluded.
  const train=rows.filter(r=>r.at<cutoff&&r.resolved_at<=cutoff),seen=new Set(train.map(r=>r.event));
  return {train,test:rows.filter(r=>r.at>=cutoff&&!seen.has(r.event))};
}
export function independentTrainingRows(rows:ScoredForecast[]){return [...new Map([...rows].sort((a,b)=>a.at.localeCompare(b.at)).map(r=>[r.category+':'+r.method+':'+r.event,r])).values()];}
export function calibrate(probability:number,train:ScoredForecast[],priorWeight=10){
  train=independentTrainingRows(train);
  const bin=Math.min(9,Math.floor(probability*10)),matches=train.filter(r=>Math.min(9,Math.floor(r.probability*10))===bin);
  return {probability:(matches.reduce((n,r)=>n+r.outcome,0)+priorWeight*probability)/(matches.length+priorWeight),n:matches.length,method:'beta-bin shrinkage, fitted on training labels only'};
}
export function benchmark(yes:{bids:{price:string}[];asks:{price:string}[]}){
  const bid=Number(yes.bids[0]?.price),ask=Number(yes.asks[0]?.price);
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask>1||bid>ask)return null;
  return {probability:(bid+ask)/2,lower:bid,upper:ask,method:'quoted YES bid/ask midpoint, forecast benchmark only; never a simulated fill'};
}
