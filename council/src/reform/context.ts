import {D} from '../finance';
import {POLICY} from './policy';
// Rules, current executable figures and typed observations are the protected core.
// All original documents and interventions remain in their append-only archives.
export function reformContext(input:any){
  const c=structuredClone(input),p=input.market;
  if(c.market){delete c.market.books;delete c.market.history;delete c.market.resolution_evidence;}
  if(c.executable_books)for(const [side,book] of Object.entries<any>(c.executable_books)){const asks=book.asks||[],bids=book.bids||[];book.observed_ask_quantity=asks.reduce((n:any,l:any)=>n.plus(l.size),D(0)).toFixed();book.within_voted_limit_quantity=asks.filter((l:any)=>!c.proposal?.max_price||D(l.price).lte(c.proposal.max_price)).reduce((n:any,l:any)=>n.plus(l.size),D(0)).toFixed();book.depth_note='Best ten asks and three bids displayed; complete observed book archived and used by execution.';book.asks=asks.slice(0,10);book.bids=bids.slice(0,3);}
  if(c.history)c.history=c.history.slice(-3).map((e:any)=>({actor:e.actor,kind:e.kind,text:String(e.text||'').slice(0,600)}));
  if(c.sources)c.sources=c.sources.slice(0,6).map((s:any)=>({id:s.id,provider:s.provider,title:String(s.title||'').slice(0,120),fetched_at:s.fetched_at,status:s.status,text:String(s.text).slice(0,1100)}));
  if(c.secretary_results)c.secretary_results=c.secretary_results.slice(0,3).map((s:any)=>({...s,text:String(s.text).slice(0,700)}));
  if(c.independent_forecasts)c.independent_forecasts=c.independent_forecasts.map((f:any)=>({...f,rationale:String(f.rationale||'').slice(0,500),falsifier:String(f.falsifier||'').slice(0,250)}));
  if(c.discussion)c.discussion=c.discussion.map((d:any)=>({actor:d.actor,probability:d.value?.estimated_yes_probability,speech:String(d.value?.speech||'').slice(0,800),objection:String(d.value?.objection||'').slice(0,400),amendment:d.value?.amendment}));
  if(c.positions){
    const groups:Record<string,{cost:string;count:number}>={};
    for(const x of c.positions.filter((x:any)=>x.status==='PENDING')){const key=x.payload.event_group||x.market_id;groups[key]??={cost:'0',count:0};groups[key].cost=D(groups[key].cost).plus(x.cost).toFixed();groups[key].count++;}
    const ordered=Object.entries(groups).sort((a,b)=>D(b[1].cost).cmp(a[1].cost));c.exposure_by_event=Object.fromEntries(ordered.filter(([key],i)=>key===p?.group||i<5));c.other_event_count=Math.max(0,ordered.length-Object.keys(c.exposure_by_event).length);c.total_open_cost=ordered.reduce((n,[,v])=>n.plus(v.cost),D(0)).toFixed();
    const categories:Record<string,{cost:string;count:number}>={};for(const x of c.positions.filter((x:any)=>x.status==='PENDING')){const key=x.payload.category||'unknown';categories[key]??={cost:'0',count:0};categories[key].cost=D(categories[key].cost).plus(x.cost).toFixed();categories[key].count++;}c.exposure_by_category=categories;
    c.positions=c.positions.filter((x:any)=>x.status==='PENDING').sort((a:any,b:any)=>Number(b.payload.event_group===p?.group)-Number(a.payload.event_group===p?.group)).slice(0,8).map((x:any)=>({market_id:x.market_id,question:x.payload.question,group:x.payload.event_group,cost:x.cost,outcome:x.outcome,quantity:x.quantity}));
  }
  c.context_note='Les textes secondaires sont des extraits. Les règles du marché et les chiffres actuels sont conservés. Les originaux sont archivés ; ne déduis aucun fait des passages omis.';
  const fields:{object:any;key:string;min:number}[]=[];
  const add=(object:any,key:string,min:number)=>{if(object&&typeof object[key]==='string')fields.push({object,key,min});};
  for(const x of c.sources||[])add(x,'text',300);
  for(const x of c.secretary_results||[])add(x,'text',200);
  for(const x of c.history||[])add(x,'text',180);
  for(const x of c.independent_forecasts||[]){add(x,'rationale',180);add(x,'falsifier',100);}
  for(const x of c.discussion||[]){add(x,'speech',250);add(x,'objection',150);add(x.amendment,'reason',150);}
  for(const x of c.votes||[])add(x,'speech',250);
  while(JSON.stringify(c).length>POLICY.maximumContextChars){
    const largest=fields.filter(f=>f.object[f.key].length>f.min).sort((a,b)=>(b.object[b.key].length-b.min)-(a.object[a.key].length-a.min))[0];
    if(largest){largest.object[largest.key]=largest.object[largest.key].slice(0,Math.max(largest.min,Math.floor(largest.object[largest.key].length*.7)));continue;}
    if(c.history?.length){c.history.shift();continue;}if(c.memory?.length){c.memory.pop();continue;}
    if(c.positions?.length>1){c.positions.pop();continue;}throw Error('PROTECTED_REFORM_CONTEXT_EXCEEDS_BUDGET');
  }
  return c;
}
