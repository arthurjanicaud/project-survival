import {POLICY,type Policy} from './policy';
export function coverage(start:string|null,until:string,cycles:{bucket:number;category:string;status:string}[],categories:readonly string[],minutes=10){
  if(!start)return {expected:0,complete:0,fraction:0,missing:[] as number[]};
  const first=Math.floor(Date.parse(start)/(minutes*60000)),last=Math.floor(Date.parse(until)/(minutes*60000))-1,groups=new Map<number,Set<string>>();
  for(const c of cycles)if(c.status==='DONE'){const a=groups.get(c.bucket)||new Set();a.add(c.category);groups.set(c.bucket,a);}
  const missing:number[]=[];let complete=0;
  for(let b=first;b<=last;b++){if(categories.every(c=>groups.get(b)?.has(c)))complete++;else missing.push(b);}
  return {expected:Math.max(0,last-first+1),complete,fraction:last>=first?complete/(last-first+1):0,missing};
}
export function healthView(lastScan:string|null,active:boolean,usage:{reads:number;writes:number;requests:number},at=Date.now(),p:Policy=POLICY){
  const age=lastScan?(at-Date.parse(lastScan))/60000:null;
  return {age_minutes:age,stale:active&&(age===null||age>p.staleScanMinutes),quota:{reads:usage.reads/p.freeRowsReadDaily,writes:usage.writes/p.freeRowsWrittenDaily,requests:usage.requests/p.freeRequestsDaily},
    limitations:'Local counters cover this isolated runtime, not other applications or the whole Cloudflare account.'};
}
