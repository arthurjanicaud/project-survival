import type {Market} from './domain';
// Read only the JSON data embedded in the public organizer page. Never evaluate scripts.
export function blastTimeline(html:string){
 const re=/streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g;let nodes:any[]|null=null;
 for(const match of html.matchAll(re)){const chunk=JSON.parse(match[1]);if(typeof chunk==='string'&&chunk.startsWith('[')){nodes=JSON.parse(chunk);break;}}
 if(!Array.isArray(nodes)||nodes.length>50000)throw Error('BLAST_PUBLIC_TIMELINE_UNAVAILABLE');
 const data=nodes,memo=new Map<number,any>(),visiting=new Set<number>();
 function read(index:any,depth=0):any{
  if(!Number.isInteger(index)||index<0||index>=data.length||depth>40)return null;
  if(memo.has(index))return memo.get(index);if(visiting.has(index))throw Error('BLAST_CYCLIC_DATA');visiting.add(index);
  const v=data[index];let out:any=v;
  if(Array.isArray(v))out=v.every(x=>Number.isInteger(x))?v.map(x=>read(x,depth+1)):null;
  else if(v&&typeof v==='object'){out=Object.create(null);for(const [key,value]of Object.entries(v)){if(!/^_\d+$/.test(key))throw Error('BLAST_DATA_SHAPE_CHANGED');const name=data[Number(key.slice(1))];if(typeof name!=='string'||['__proto__','prototype','constructor'].includes(name))throw Error('BLAST_INVALID_KEY');out[name]=read(value,depth+1);}}
  visiting.delete(index);memo.set(index,out);return out;
 }
 const root=read(0),timeline=root?.loaderData?.['sites/blast/routes/dota._index']?.tournamentTimelineV2;
 if(!Array.isArray(timeline)||!timeline.length)throw Error('BLAST_PUBLIC_TIMELINE_UNAVAILABLE');
 return {provider:'BLAST',game:'Dota 2',tournaments:timeline.filter((t:any)=>typeof t.id==='string'&&typeof t.name==='string'&&Array.isArray(t.matches)).map((t:any)=>({id:t.id,name:t.name,matches:t.matches.filter((m:any)=>m?.metadata?._t==='dota_match').map((m:any)=>({id:m.id,name:m.name,format:m.type,scheduled_at:m.scheduledAt,started_at:m.startedAt??null,has_started:m.hasStarted??null,finished:m.hasFinished??null,team_a:m.teamA?{id:m.teamA.id,name:m.teamA.name}:null,team_b:m.teamB?{id:m.teamB.id,name:m.teamB.name}:null,score_a:m.teamAScore??null,score_b:m.teamBScore??null}))}))};
}
const nameKey=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function blastFacts(data:any,market:Market,at=Date.now()){
 if(data?.provider!=='BLAST'||data.game!=='Dota 2'||!Array.isArray(data.tournaments)||!/\bdota(?:\s*2)?\b/i.test(market.question+' '+market.url)||!/blast[ -]*slam/i.test(market.question+' '+market.description))return null;
 // This connector confirms a complete series, not a map/handicap or live game.
 if(/game\s*\d+|map\s*\d+|handicap|total\s+(maps|games)/i.test(market.question))return null;
 const text=' '+nameKey(market.question)+' ',start=Date.parse(market.start_at||'');if(!Number.isFinite(start))return null;
 const has=(n:any)=>typeof n==='string'&&nameKey(n).length>=2&&text.includes(' '+nameKey(n)+' ');
 const candidates=data.tournaments.filter((t:any)=>/^blast-slam-[a-z0-9-]+$/.test(t.id)).flatMap((t:any)=>t.matches.map((m:any)=>({...m,tournament:{id:t.id,name:t.name}}))).filter((m:any)=>m.id&&m.team_a?.id&&m.team_b?.id&&m.team_a.id!==m.team_b.id&&has(m.team_a.name)&&has(m.team_b.name)&&Math.abs(Date.parse(m.scheduled_at)-start)<=2*3600000&&Date.parse(m.scheduled_at)>at&&m.finished===false&&!m.started_at&&m.has_started!==true&&/^BO[1357]$/.test(m.format));
 const unique=[...new Map(candidates.map((m:any)=>[m.id,m])).values()] as any[];if(unique.length!==1)return null;const fixture=unique[0];
 const history=data.tournaments.flatMap((t:any)=>t.matches.map((m:any)=>({...m,tournament:t.name}))).filter((m:any)=>{const n=Number(m.format?.slice(2)),wins=Math.ceil(n/2),a=m.score_a,b=m.score_b,date=Date.parse(m.started_at||m.scheduled_at);return m.finished===true&&/^BO[1357]$/.test(m.format)&&Number.isFinite(date)&&date<=at&&at-date<45*86400000&&Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&Math.max(a,b)===wins&&Math.min(a,b)<wins;}).sort((a:any,b:any)=>Date.parse(b.started_at||b.scheduled_at)-Date.parse(a.started_at||a.scheduled_at));
 const teams=[fixture.team_a,fixture.team_b].map(team=>({...team,recent_series:[...new Map(history.filter((m:any)=>m.team_a?.id===team.id||m.team_b?.id===team.id).map((m:any)=>[m.id,m])).values()].slice(0,3).map((m:any)=>({id:m.id,tournament:m.tournament,at:m.started_at||m.scheduled_at,team_a:m.team_a.name,team_b:m.team_b.name,score_a:m.score_a,score_b:m.score_b}))}));
 if(teams.some(t=>!t.recent_series.length))return null;
 return {game:'Dota 2',state:'pre',fixture:{id:fixture.id,tournament:fixture.tournament,scheduled_at:fixture.scheduled_at,format:fixture.format,teams:[fixture.team_a,fixture.team_b]},teams,fixture_verified_by_organizer:true,scope:'BLAST published schedule and completed series only',limitation:'No OpenDota rating, confirmed roster, live map telemetry or independently calibrated probability. Results do not settle Polymarket positions.'};
}
