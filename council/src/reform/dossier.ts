import {CONFIG,type Market,type Source} from '../domain';
import {D} from '../finance';
import {quality} from './evidence';
import type {Policy} from './policy';
export function observationCore(metar:any){
  if(!metar)return null;
  const {rows,...summary}=metar;if(!Array.isArray(rows))return summary;
  const extreme=rows.find((r:any)=>r.value===metar.extreme);
  return {...summary,report_count:rows.length,relevant_reports:[...new Map([rows.at(-1),extreme].filter(Boolean).map((r:any)=>[r.at,r])).values()]};
}
export function scopedSource(source:Source,market:Market,metar:any):Source{
  let facts:any=null;
  if(source.status==='VERIFIED'&&source.provider!=='Polymarket'&&source.provider!=='NOAA AWC')try{
    facts=JSON.parse(source.text);
    if(facts.forecast?.time&&metar?.rules?.day){const i=facts.forecast.time.indexOf(metar.rules.day);facts={...facts,forecast:i<0?null:Object.fromEntries(Object.entries(facts.forecast).map(([k,v])=>[k,Array.isArray(v)?v[i]:v]))};}
    if(Array.isArray(facts))facts=facts.slice(0,2);
    if(facts.periods)facts={...facts,periods:facts.periods.filter((p:any)=>!metar?.rules?.day||p.startTime?.slice(0,10)===metar.rules.day).slice(0,2)};
    if(JSON.stringify(facts).length>6500)facts={available_in_archive:true,reason:'Use a targeted document request; the complete structured fact is too large.'};
  }catch{facts={parseable:false,reason:'Source is prose or truncated JSON; no values inferred.'};}
  return {...source,market_id:market.id,structured:{market_id:market.id,event_id:market.group,...(source.provider==='NOAA AWC'?{kind:'OBSERVATION',...observationCore(metar)}:{kind:source.provider==='Polymarket'?'RULES':'EXTERNAL_FACTS',facts})}};
}
export function freshDossier(m:Market,sources:Source[],metar:any,p:Policy,at=Date.now()){
  const result=quality(m,sources,metar,at,p),missing=[...result.essential_missing];
  if(!m.active||m.resolved||!Number.isFinite(Date.parse(m.event_end_at))||Date.parse(m.event_end_at)<=at)missing.push('Événement fermé ou terminé');
  const books=Object.values(m.books);
  if(!m.books.YES?.asks.length||!m.books.YES.bids.length||!books.some(b=>b.asks.reduce((n,l)=>n.plus(l.size),D(0)).gte(b.minimum)))missing.push('Carnet achetable au minimum réel et référence OUI indisponibles');
  for(const b of books){const age=at-Date.parse(b.observed_at);if(!Number.isFinite(age)||age< -5000||age>CONFIG.maxBookAgeSeconds*1000)missing.push('Carnet périmé ou horodatage invalide');}
  if(sources.some(s=>s.status==='VERIFIED'&&(!Number.isFinite(Date.parse(s.fetched_at))||Date.parse(s.fetched_at)>at+5000)))missing.push('Date de collecte invalide ou située dans le futur');
  if(sources.some(s=>s.market_id&&s.market_id!==m.id||s.structured?.market_id&&s.structured.market_id!==m.id))missing.push('Document associé à un autre marché');
  return {...result,ready:missing.length===0,essential_missing:[...new Set(missing)]};
}
export function livePacket(packet:any){return packet.payload.live?{...packet,payload:{...packet.payload,...packet.payload.live}}:packet;}
