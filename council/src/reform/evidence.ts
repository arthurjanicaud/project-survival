import type {Market,Source} from '../domain';
import {POLICY,type Policy} from './policy';
import {cities} from '../markets';
export type Fact={source_id:string;provider:string;family:string;url:string;fetched_at:string;observed_at:string|null;kind:'RULES'|'FORECAST'|'OBSERVATION'|'SPORT_STATE'|'HISTORY';event:string;station?:string;local_day?:string;summary:unknown};
export function family(provider:string){return /open.meteo|ecmwf/i.test(provider)?'weather-models-open-meteo':/ESPN/i.test(provider)?'ESPN':/OpenDota/i.test(provider)?'OpenDota':provider;}
export function stationFor(m:Market){return cities.find(c=>new RegExp('\\b'+c.station+'\\b','i').test(m.description+' '+m.resolution_source))||cities.find(c=>c.names.test(m.question));}
export function weatherRules(m:Market){
  const station=stationFor(m);if(!station)return null;
  const range=m.question.match(/between\s+(-?\d+)\s*[-–]\s*(-?\d+)\s*°?\s*([CF])/i);
  const exact=m.question.match(/\bbe\s+(-?\d+)\s*°\s*([CF])/i);
  if(!range&&!exact)return null;
  const lo=Number((range||exact)![1]),hi=range?Number(range[2]):lo,unit=(range?range[3]:exact![2]).toUpperCase();
  if(lo>hi)return null;
  return {station:station.station,timezone:station.tz,day:new Intl.DateTimeFormat('en-CA',{timeZone:station.tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(m.start_at!)),
    metric:/lowest/i.test(m.question)?'min':'max',unit,lower:/or (below|lower|less)/i.test(m.question)?null:lo-.5,upper:/or (above|higher|more)/i.test(m.question)?null:hi+.5,
    controlling_metar:/\broutine\b/i.test(m.description)&&/\bMETAR\b/i.test(m.description)&&new RegExp('\\b'+station.station+'\\b').test(m.description)};
}
export function routineTemperature(raw:string){
  if(!raw||/^\s*SPECI\b/.test(raw))return null;
  const detailed=raw.match(/(?:^|\s)T([01])(\d{3})([01])(\d{3})(?=\s|=|$)/);
  if(detailed)return {celsius:(detailed[1]==='1'?-1:1)*Number(detailed[2])/10,method:'hourly T remark (tenths Celsius)'};
  const body=raw.match(/(?:^|\s)(M?\d{2})\/(?:M?\d{2}|\/)?(?=\s|=|$)/);
  return body?{celsius:body[1].startsWith('M')?-Number(body[1].slice(1)):Number(body[1]),method:'body temperature (whole Celsius)'}:null;
}
export function observations(m:Market,rows:any[],at=Date.now()){
  const rule=weatherRules(m);if(!rule)return {rules:null,rows:[],latest:null,extreme:null,yes_impossible:false};
  const parsed=rows.filter(r=>r.icaoId===rule.station&&r.metarType!=='SPECI'&&!/^SPECI\b/.test(r.rawOb||'')).flatMap(r=>{
    const t=typeof r.obsTime==='number'?r.obsTime*1000:Date.parse(r.obsTime||r.reportTime);
    const reading=routineTemperature(r.rawOb||'');
    if(!Number.isFinite(t)||t>at||!reading||(r.receiptTime&&Date.parse(r.receiptTime)>at))return [];
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:rule.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
    return day===rule.day?[{at:new Date(t).toISOString(),celsius:reading.celsius,value:rule.unit==='F'?reading.celsius*9/5+32:reading.celsius,method:reading.method,raw:r.rawOb,issued_at:r.receiptTime||r.reportTime||null}]:[];
  }).sort((a,b)=>a.at.localeCompare(b.at));
  // Corrections replace an older report at the same observation time, never count both.
  const selected=[...new Map(parsed.sort((a,b)=>Date.parse(a.issued_at||a.at)-Date.parse(b.issued_at||b.at)||Number(/\bCOR\b/.test(a.raw))-Number(/\bCOR\b/.test(b.raw))).map(r=>[r.at,r])).values()].sort((a,b)=>a.at.localeCompare(b.at));
  const extreme=selected.length?(rule.metric==='max'?Math.max(...selected.map(r=>r.value)):Math.min(...selected.map(r=>r.value))):null;
  const impossible=extreme!==null&&rule.controlling_metar&&(rule.metric==='max'&&rule.upper!==null&&extreme>=rule.upper||rule.metric==='min'&&rule.lower!==null&&extreme<rule.lower);
  return {rules:rule,rows:selected,latest:selected.at(-1)?.at||null,extreme,yes_impossible:impossible,limitation:'Conditional on currently published routine reports; corrections can change them. Gaps do not establish a final daily extreme or official resolution.'};
}
export function quality(m:Market,sources:Source[],metar:any,at=Date.now(),policy:Policy=POLICY){
  const independent=sources.filter(s=>s.status==='VERIFIED'&&s.provider!=='Polymarket'&&s.provider!=='Council archive');
  const missing:string[]=[],warnings:string[]=[];const inProgress=Date.parse(m.start_at||m.event_end_at)<=at;
  if(m.rules_complete===false)missing.push('Règles tronquées par le collecteur : document intégral nécessaire');
  if(!m.description||!m.resolution_source)missing.push('Règle de résolution complète et source officielle');
  if(new Set(independent.map(s=>family(s.provider))).size<policy.sourceFamiliesRequired)missing.push('Nombre de familles de sources indépendantes insuffisant');
  if(!independent.length)missing.push('Source extérieure pertinente pour cet événement');
  if(!independent.some(s=>at-Date.parse(s.fetched_at)<=policy.maximumDataAgeSeconds*1000))missing.push('Collecte extérieure récente');
  if(m.category==='weather'){
    if(m.outcome_labels?.YES.toLowerCase()!=='yes'||m.outcome_labels?.NO.toLowerCase()!=='no')missing.push('Correspondance explicite du premier outcome avec Oui et du second avec Non');
    if(!metar?.rules)missing.push('Station, date locale, unité et seuil de température reconnus');
    if(inProgress&&(!metar?.latest||at-Date.parse(metar.latest)>policy.maximumObservationAgeSeconds*1000))missing.push('Observations routine actuelles de la station pendant la journée');
    if(metar?.rules&&!metar.rules.controlling_metar)missing.push('Correspondance prouvée entre observations METAR et règle de règlement');
    warnings.push('La dispersion des modèles météo ne constitue pas une calibration stationnelle.');
  }else if(inProgress&&!independent.some(s=>/"state"\s*:\s*"(in|post)"/.test(s.text)&&at-Date.parse(s.fetched_at)<300000))missing.push('État sportif réellement en direct : score, temps et événement identifié');
  if(m.category==='esport'&&!/dota/i.test(m.question))missing.push('Connecteur spécifique à ce jeu esport non disponible');
  return {ready:missing.length===0,essential_missing:missing,warnings,families:[...new Set(independent.map(s=>family(s.provider)))],in_progress:inProgress};
}
export function anomaly(probability:number,price:number,interval:{lower:number;upper:number}){
  return {large_gap:Math.abs(probability-price)>=.2||price<.01&&probability>=.05||price>.99&&probability<=.95,
    price_outside_interval:price<interval.lower||price>interval.upper,
    required_checks:['Résultat déjà impossible ?','Règles et premier outcome correctement interprétés ?','Observation actuelle disponible ?','Méthode historiquement évaluée ?']};
}
