import {CONFIG,type Market,type Source} from './domain';

export type Review={market_id:string;at:string;facts:string;price:string|null;status:string;lesson_seq?:number};
// Transport timestamps and cache refreshes are not new evidence.
export function factualText(text:string):string{
  try{const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['updated','updated_at','fetched_at','generated_at','lastUpdated','last_update_timestamp'].includes(k)).map(([k,x])=>[k,clean(x)])):v;return JSON.stringify(clean(JSON.parse(text)));}catch{return text;}
}
export function needsReview(old:Review|null,facts:string,price:string|null,at=Date.now(),lessonSeq=0){
  if(!old)return true;
  const age=at-Date.parse(old.at);
  if(old.status==='TECHNICAL_ERROR')return age>=CONFIG.technicalRetryMinutes*60000;
  if(age<CONFIG.reviewDebounceMinutes*60000)return false;
  if(price&&old.price&&Math.abs(Number(price)-Number(old.price))>=CONFIG.reviewPriceMove)return true;
  return facts!==old.facts||lessonSeq>(old.lesson_seq||0);
}
export function decisionDeadline(m:Market,bettingDeadline:string,at=Date.now()){
  const futureStart=m.start_at&&Date.parse(m.start_at)>at?Date.parse(m.start_at):Infinity;
  return Math.min(futureStart,Date.parse(m.event_end_at),Date.parse(bettingDeadline))-CONFIG.decisionLeadSeconds*1000;
}
export function independentFacts(sources:Source[]){return sources.filter(s=>s.status==='VERIFIED'&&s.provider!=='Polymarket'&&s.provider!=='Council archive');}
export function sourceFreshness(m:Market,sources:Source[],at=Date.now()){
  const external=independentFacts(sources),inPlay=m.category!=='weather'&&!!m.start_at&&Date.parse(m.start_at)<=at;
  const maxAge=inPlay?CONFIG.inPlaySourceSeconds:CONFIG.meetingSourceSeconds;
  return {in_play:inPlay,verified_external:external.length,fresh:external.some(s=>at-Date.parse(s.fetched_at)<=maxAge*1000&&(!inPlay||/"state"\s*:\s*"(in|post)"/.test(s.text))),maximum_age_seconds:maxAge,oldest_source_at:external.map(s=>s.fetched_at).sort()[0]||null};
}
