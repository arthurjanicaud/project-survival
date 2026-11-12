import type {ReformRepository} from './store';
import type {Policy} from './policy';
export const RESEARCH_KINDS=['R4_SCAN','R4_PREPARE','R4_FORECAST','R4_SEARCH'];
export function nextUtcReset(at=Date.now()){const d=new Date(at);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1);}
export function researchPermit(repo:ReformRepository,job:any,p:Policy,at=Date.now()){
  const day=new Date(at).toISOString().slice(0,10),usage=repo.one('SELECT * FROM r4_usage WHERE day=?',day)||{reads:0,writes:0};
  const pressure=Math.max(usage.reads/p.freeRowsReadDaily,usage.writes/p.freeRowsWrittenDaily);
  const old=repo.get<any>('r4:research_pacing');
  if(pressure<.8){if(old?.mode&&old.mode!=='NORMAL')repo.set('r4:research_pacing',{mode:'NORMAL',at:new Date(at).toISOString()});return {allowed:true,mode:'NORMAL',seconds:0};}
  const mode=pressure>=.9?'RESERVED':'PACED';
  if(old?.mode!==mode||old?.day!==day)repo.set('r4:research_pacing',{mode,day,at:new Date(at).toISOString(),reason:'Local storage budget; other applications are not included.'});
  if(!RESEARCH_KINDS.includes(job.kind))return {allowed:true,mode,seconds:0};
  if(mode==='RESERVED')return {allowed:false,mode,seconds:Math.max(60,Math.ceil((nextUtcReset(at)-at)/1000))};
  // Under pressure retain a small, fair research stream, instead of suspending every domain.
  const window=Math.floor(at/1800000),key='r4:pace:'+day,state=repo.get<any>(key),counts=state?.window===window?state.counts:{};
  const category=job.payload.category||String(job.payload.actor||'shared').toLowerCase(),slot=job.kind+':'+category;
  if(counts[slot])return {allowed:false,mode,seconds:Math.max(30,Math.ceil(((window+1)*1800000-at)/1000))};
  counts[slot]=1;repo.set(key,{window,counts});return {allowed:true,mode,seconds:0};
}
export function storageQuotaError(error:unknown){return /Exceeded allowed rows (read|written).*Durable Objects free tier/i.test(String(error));}
export function quotaResponse(at=Date.now()){
  const reset=new Date(nextUtcReset(at)).toISOString();
  return Response.json({error:'STORAGE_DAILY_QUOTA_EXCEEDED',provider:'Cloudflare',quota_reset_at:reset,retry_at:new Date(at+300000).toISOString(),message:'Le quota quotidien de stockage Cloudflare est atteint. Les données sont conservées. La reprise sera retentée automatiquement après la remise à zéro du quota.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'300'}});
}

export function knownStoragePause(until:string|undefined,at=Date.now()){const end=Date.parse(until||'');return Number.isFinite(end)&&at<end;}
