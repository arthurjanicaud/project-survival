import {D} from '../finance';
import type {Policy} from './policy';
import {score,type ScoredForecast} from './forecast';
export function readiness(rows:ScoredForecast[],startedAt:string|null,coverage:number,p:Policy,at=Date.now()){
  const result=score(rows),reasons:string[]=[];
  if(!startedAt||at-Date.parse(startedAt)<p.shadowMinimumHours*3600000)reasons.push('Période minimale de prévisions sans mises non accomplie');
  if(result.events<p.minimumResolvedEvents)reasons.push('Nombre insuffisant d’événements distincts réglés');
  if(coverage<p.minimumCoverage)reasons.push('Couverture technique insuffisante');
  if(result.calibration_error===null||result.calibration_error>p.maximumCalibrationError)reasons.push('Probabilités insuffisamment calibrées');
  if(result.improvement?.lower95===null||result.improvement?.lower95===undefined||result.improvement.lower95<=0)reasons.push('Amélioration hors échantillon face au marché non démontrée');
  return {eligible:reasons.length===0,reasons,score:result,warning:'Eligibility is a research gate, not proof of future profitability. Methods and data coverage must also qualify.'};
}
export function evaluationWindows(rows:ScoredForecast[],policyCutoff:string){
  const train=rows.filter(r=>r.at<policyCutoff&&r.resolved_at<=policyCutoff),events=new Set(train.map(r=>r.event));
  return {train,test:rows.filter(r=>r.at>=policyCutoff&&!events.has(r.event))};
}
export function pairedAblation(rows:{market:string;event:string;actor:string;before:number;after:number;outcome:number;baseline:number}[]){
  return [...new Set(rows.map(r=>r.actor))].map(actor=>{const a=rows.filter(r=>r.actor===actor);return {actor,n:a.length,events:new Set(a.map(r=>r.event)).size,before_brier:a.reduce((n,r)=>n+(r.before-r.outcome)**2,0)/a.length,after_brier:a.reduce((n,r)=>n+(r.after-r.outcome)**2,0)/a.length,market_brier:a.reduce((n,r)=>n+(r.baseline-r.outcome)**2,0)/a.length};});
}
export function fairMissedOpportunities(rows:{market:string;event:string;at:string;cost:number|string;payout:number|string;reason:string}[],capital:number){
  // A feasible benchmark portfolio, not the sum of repeated 10-EUR observations.
  const unique=[...new Map([...rows].sort((a,b)=>b.at.localeCompare(a.at)).map(r=>[r.market,r])).values()].sort((a,b)=>a.at.localeCompare(b.at));
  let cash=D(capital);const selected:typeof rows=[];
  for(const r of unique){if(D(r.cost).lte(cash)){cash=cash.minus(r.cost);selected.push(r);}}
  return {initial:capital,committed:D(capital).minus(cash).toNumber(),payout:selected.reduce((n,r)=>n.plus(r.payout),D(0)).toNumber(),profit:selected.reduce((n,r)=>n.plus(r.payout).minus(r.cost),D(0)).toNumber(),selected,limitations:'All stakes reserved simultaneously; no hindsight selection, no assumed reuse before known settlement. Initial rationale remains separate from outcome.'};
}
