import {Repository} from '../repository';
import type {Source} from '../domain';
export class ReformRepository extends Repository {
  override claim(at?:string){return super.claim(at,true);}
  override nextJobAt(){return super.nextJobAt(true);}
  private costs=new Map<string,{query:string;calls:number;reads:number;writes:number}>();
  override rows<T=any>(q:string,...args:any[]):T[]{const reads=this.reads,writes=this.writes,result=super.rows<T>(q,...args);if(this.costs){const key=q.replace(/\s+/g,' ').trim(),c=this.costs.get(key)||{query:key,calls:0,reads:0,writes:0};c.calls++;c.reads+=this.reads-reads;c.writes+=this.writes-writes;this.costs.set(key,c);}return result;}
  takeCosts(){const all=[...this.costs.values()],reads=all.sort((a,b)=>b.reads-a.reads).slice(0,5),writes=[...all].sort((a,b)=>b.writes-a.writes).slice(0,5);this.costs.clear();return [...new Map([...reads,...writes].map(q=>[q.query,q])).values()];}

  // Collection caches are transient; only accepted packets pin evidence below.
  document(_source:Source){}
  migrateReform(){for(const q of [
    'CREATE INDEX IF NOT EXISTS jobs_kind_status ON jobs(kind,status,due_at)',
    'CREATE TABLE IF NOT EXISTS r4_packets(id TEXT PRIMARY KEY,market_id TEXT NOT NULL,category TEXT NOT NULL,event_id TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS r4_packets_market ON r4_packets(market_id,at)',
    'CREATE INDEX IF NOT EXISTS r4_packets_event ON r4_packets(event_id,at)',
    'CREATE INDEX IF NOT EXISTS r4_packets_at ON r4_packets(at DESC)',
    'CREATE INDEX IF NOT EXISTS r4_packets_status ON r4_packets(status,at)',
    'CREATE TABLE IF NOT EXISTS r4_evidence(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS r4_evidence_event ON r4_evidence(event_id,at)',
    'CREATE TABLE IF NOT EXISTS r4_forecasts(packet_id TEXT NOT NULL,actor TEXT NOT NULL,phase TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(packet_id,actor,phase))',
    'CREATE INDEX IF NOT EXISTS r4_forecasts_phase ON r4_forecasts(phase,actor,at)',
    'CREATE TRIGGER IF NOT EXISTS r4_forecast_immutable BEFORE UPDATE ON r4_forecasts BEGIN SELECT RAISE(ABORT,\'FORECAST_IMMUTABLE\'); END',
    'CREATE TABLE IF NOT EXISTS r4_outcomes(market_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,observed_at TEXT NOT NULL,resolved_at TEXT,payload TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS r4_outcomes_event ON r4_outcomes(event_id,observed_at DESC)',
    'CREATE INDEX IF NOT EXISTS r4_outcomes_at ON r4_outcomes(observed_at DESC)',
    "CREATE INDEX IF NOT EXISTS r4_outcomes_category ON r4_outcomes(json_extract(payload,'$.category'),observed_at DESC)",
    'CREATE TABLE IF NOT EXISTS r4_cycles(bucket INTEGER NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(bucket,category))',
    'CREATE TABLE IF NOT EXISTS r4_assessments(id TEXT PRIMARY KEY,at TEXT NOT NULL,packet_id TEXT NOT NULL,payload TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS r4_agendas(id TEXT PRIMARY KEY,slot TEXT NOT NULL UNIQUE,status TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS r4_agendas_at ON r4_agendas(at DESC)',
    'CREATE TABLE IF NOT EXISTS r4_models(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,payload TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS r4_usage(day TEXT PRIMARY KEY,reads INTEGER NOT NULL,writes INTEGER NOT NULL,requests INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS r4_recovery(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
  ])this.run(q);}
  eventReviews(){
    const cached=this.cache<[string,string][]>('r4:event_reviews');if(cached)return new Map(cached);
    const rows=this.rows('SELECT event_id,max(at) at FROM r4_packets GROUP BY event_id').map(r=>[r.event_id,r.at] as [string,string]);this.putCache('r4:event_reviews',rows,600);return new Map(rows);
  }
  invalidateScores(){this.run("DELETE FROM transient_cache WHERE (key >= 'r4:scored:' AND key < 'r4:scored;') OR key IN ('r4:comparisons','r4:evaluation','r4:summary')");}
  packet(id:string){const r=this.one('SELECT * FROM r4_packets WHERE id=?',id);return r?{...r,payload:JSON.parse(r.payload)}:null;}
  forecast(packet:string,actor:string,phase='BEFORE'){const r=this.one('SELECT payload FROM r4_forecasts WHERE packet_id=? AND actor=? AND phase=?',packet,actor,phase);return r?JSON.parse(r.payload):null;}
  saveForecast(packet:string,actor:string,phase:string,payload:any,at=new Date().toISOString()){
    this.run('INSERT OR IGNORE INTO r4_forecasts VALUES(?,?,?,?,?)',packet,actor,phase,at,JSON.stringify(payload));
    if(this.one('SELECT o.market_id FROM r4_outcomes o JOIN r4_packets p ON p.market_id=o.market_id WHERE p.id=?',packet))this.invalidateScores();
  }
  memory(event:string,category:string){
    // Exact event first, then verified outcomes in the same domain; no opinion retrieval.
    const result=this.rows('SELECT * FROM r4_outcomes WHERE event_id=? ORDER BY observed_at DESC LIMIT 4',event);
    for(const row of this.rows("SELECT * FROM r4_outcomes WHERE json_extract(payload,'$.category')=? ORDER BY observed_at DESC LIMIT 6",category))if(!result.some(x=>x.market_id===row.market_id))result.push(row);
    return result.slice(0,6).map(x=>({market_id:x.market_id,event:x.event_id,known_at:x.observed_at,...JSON.parse(x.payload)}));
  }
  searchDocuments(request:{event:string;source_kind?:string;station?:string;day?:string}){
    return this.rows('SELECT * FROM r4_evidence WHERE event_id=? ORDER BY at DESC LIMIT 30',request.event).map(x=>JSON.parse(x.payload)).filter(x=>(!request.station||x.station===request.station)&&(!request.day||x.local_day===request.day)&&(!request.source_kind||x.kind===request.source_kind)).slice(0,3);
  }
  page(table:string,after=0,limit=50){
    const extra=['r4_packets','r4_evidence','r4_forecasts','r4_outcomes','r4_cycles','r4_assessments','r4_agendas','r4_models','r4_usage'];
    if(!extra.includes(table))return this.exportPage(table,after,limit);
    const n=Math.min(100,Math.max(1,Math.floor(limit))),rows=this.rows(`SELECT rowid AS export_cursor,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`,Math.max(0,Math.floor(after)),n);
    return {table,rows,next:rows.at(-1)?.export_cursor??after,done:rows.length<n};
  }
}
