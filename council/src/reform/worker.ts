import {DurableObject} from 'cloudflare:workers';
import {Engine} from '../engine';
import {nextAlarm} from '../scheduling';
import {now,type Env} from '../domain';
import {normalize,coveragePreference} from '../markets';
import {POLICY} from './policy';
import {researchPermit,storageQuotaError,nextUtcReset} from './read-budget';
import {reformTarget} from './routing';
import {z} from 'zod';
import {recoveryStatus,beginRecovery,restoreChunk,finishRecovery,BACKUP_TABLES} from './recovery';
import {ReformRepository} from './store';
import {ReformEngine} from './engine';
import {recordJobIncident,deliverNotificationJob} from './incidents';
const json=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
export class ReformCouncil extends DurableObject<Env>{
  repo!:ReformRepository;engine!:ReformEngine;legacy!:Engine;processing=false;private storageBlockedUntil=0;private lastApiMeasure=0;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);}
  initialize(){if(this.engine)return;const repo=new ReformRepository(this.ctx.storage.sql,f=>this.ctx.storage.transactionSync(f)),engine=new ReformEngine(repo,this.env),legacy=new Engine(repo,this.env);this.repo=repo;this.engine=engine;this.legacy=legacy;}
  async fetch(r:Request){
    const u=new URL(r.url),path=u.pathname;
    // Inspection must remain possible when the provider forbids writes. No
    // migrations, prepare(), telemetry writes or alarms on this private path.
    if(path==='/admin/storage-diagnostic'){
      const rows=(q:string,...args:any[])=>this.ctx.storage.sql.exec(q,...args).toArray();
      return json({at:now(),meta:rows("SELECT key,value FROM meta WHERE key IN ('reform_run','state','r4:last_storage_cycle','r4:last_storage_request','r4:technical_repair','r4:research_pacing')"),usage:rows('SELECT * FROM r4_usage ORDER BY day DESC LIMIT 3'),jobs:rows('SELECT kind,status,count(*) n FROM jobs GROUP BY kind,status'),cache:rows('SELECT count(*) n,min(expires_at) oldest,max(expires_at) newest FROM transient_cache')});
    }
    this.initialize();
    try{
      const target=reformTarget(r.headers.get('x-reform-stage'),this.env),recovery=r.headers.get('x-reform-recovery');
      if(recovery){
        if(!/^recovery-r4-[a-zA-Z0-9-]{1,50}$/.test(recovery))throw Error('INVALID_RECOVERY_ID');
        if(!recoveryStatus(this.repo))await this.engine.prepare(recovery,'SHADOW');
        if(path==='/admin/restore-begin'&&r.method==='POST'){const body:any=await r.json();return json(beginRecovery(this.repo,body.manifest,body.confirm));}
        if(path==='/admin/restore-chunk'&&r.method==='POST'){const body:any=await r.json();return json(await restoreChunk(this.repo,body.table,body.index,body.rows));}
        if(path==='/admin/restore-finish'&&r.method==='POST')return json(finishRecovery(this.repo));
        if(path==='/admin/recovery-state'&&r.method==='GET')return json({recovery:recoveryStatus(this.repo),state:this.engine.summary()});
        if(path==='/admin/export-page'&&r.method==='GET')return json(this.repo.page(u.searchParams.get('table')||'',Number(u.searchParams.get('after'))||0,Number(u.searchParams.get('limit'))||50));
        throw Error('RECOVERY_IS_READ_ONLY');
      }
      await this.engine.prepare(target.id,target.stage);
      const backup=this.repo.get<any>('r4:backup_lock'),locked=backup&&Date.parse(backup.until)>Date.now();
      if(path==='/admin/export-begin'&&r.method==='POST'){
        if(this.processing||locked)return json({error:'WORK_OR_BACKUP_IN_PROGRESS_RETRY'},409);
        const lock=locked?backup:{id:crypto.randomUUID(),until:new Date(Date.now()+600000).toISOString()};this.repo.set('r4:backup_lock',lock);
        return json({lock,state:this.engine.summary(),counts:Object.fromEntries(BACKUP_TABLES.map(t=>[t,this.repo.one('SELECT count(*) n FROM '+t).n]))});
      }
      if(path==='/admin/export-end'&&r.method==='POST'){const b:any=await r.json();if(backup?.id!==b.id)throw Error('BACKUP_LOCK_MISMATCH');this.repo.run('DELETE FROM meta WHERE key=?','r4:backup_lock');await this.arm();return json({released:true});}
      if(locked&&path==='/tick')return json({paused_for_consistent_backup:true,until:backup.until});
      if(locked&&!['/admin/export-page','/api/state','/api/health','/api/events','/api/meeting','/api/document','/admin/qualification'].includes(path))return json({error:'CONSISTENT_BACKUP_IN_PROGRESS'},423);
      if(path==='/tick'){this.engine.tick();await this.arm();return json({ok:true});}
      if(path==='/api/health')return json({state:this.repo.state(),run:this.engine.run(),health:this.repo.get('r4:health'),storage_bytes:this.ctx.storage.sql.databaseSize,scheduler:{alarm_at:await this.ctx.storage.getAlarm(),processing:this.processing},last_storage_cycle:this.repo.get('r4:last_storage_cycle'),technical_repair:this.repo.get('r4:technical_repair'),research_pacing:this.repo.get('r4:research_pacing'),research_collector:this.repo.get('research_collector')});
      if(path==='/api/state'){
        const cached=this.repo.cache('r4:summary');if(cached)return json(cached);const data={...this.engine.summary(),generated_at:now()};this.repo.putCache('r4:summary',data,60);return json(data);
      }
      if(path==='/api/events')return json({events:this.repo.events(Math.max(0,Number(u.searchParams.get('after'))||0),u.searchParams.get('meeting')||undefined,100)});
      if(path==='/api/meeting'){const id=u.searchParams.get('id')||'';return json({meeting:this.engine.meetingRow(id),events:this.repo.events(0,id,300)});}
      if(path==='/api/document'){const row=this.repo.one('SELECT payload FROM r4_evidence WHERE id=?',u.searchParams.get('id')||'');return row?json(JSON.parse(row.payload)):json({error:'NOT_FOUND'},404);}
      if(path==='/admin/seed-history'&&r.method==='POST'){
        if(this.engine.run().status!=='READY'||(this.engine.run().stage!=='SHADOW'&&this.engine.run().policy.requireQualification))throw Error('HISTORY_SEED_ONLY_BEFORE_LAUNCH');
        const body:any=await r.json();if(body.origin_experiment!=='survival-003'||typeof body.source_sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.source_sha256)||JSON.stringify(body).length>20000||!Array.isArray(body.lessons)||body.lessons.length>10)throw Error('INVALID_LEGACY_HISTORY');
        if(this.repo.get('r4:legacy_lessons'))throw Error('HISTORY_ALREADY_SEEDED');this.repo.set('r4:legacy_lessons',body);return json({stored:true,validation_samples_added:0});
      }
      if(path==='/admin/probe-azure'&&r.method==='POST')return json({azure:await this.engine.azure.ask('r4:probe:'+now(),'CHAIR','connectivity_probe',{protocol:'reform-v4',instruction:'Test technique, réponds ok true. Aucun investissement.'},z.object({ok:z.boolean()}).strict()),experiment_started:this.engine.run().started_at!==null});
      if(path==='/admin/query-costs')return json({cycle:this.repo.get('r4:last_storage_cycle'),request:this.repo.get('r4:last_storage_request')});
      if(path==='/admin/qualification')return json(this.engine.qualification());
      if(path==='/admin/archive-observation'&&r.method==='POST'){const body:any=await r.json();const result=this.engine.archiveObservation(body.confirm);await this.arm();return json(result);}
      if(path==='/admin/start'&&r.method==='POST'){
        const body:any=await r.json();let qualification=null;
        if(this.engine.run().policy.requireQualification&&target.stage!=='SHADOW'){
          const peer=this.env.REFORM!.get(this.env.REFORM!.idFromName(this.env.REFORM_SHADOW_ID!));
          const response=await peer.fetch(new Request('https://internal/admin/qualification',{headers:{'x-reform-stage':'shadow'}}));if(!response.ok)throw Error('SHADOW_QUALIFICATION_UNAVAILABLE');qualification=await response.json();
          if(target.stage==='FULL'){
            const pilot=this.env.REFORM!.get(this.env.REFORM!.idFromName(this.env.REFORM_PILOT_ID!));const response=await pilot.fetch(new Request('https://internal/api/state',{headers:{'x-reform-stage':'pilot'}}));const data:any=await response.json();
            if(data.run?.status!=='FINISHED'||data.run?.code_version!==this.engine.activeCode()||data.run?.policy_hash!==this.engine.run().policy_hash||!data.positions?.length||data.positions?.some((p:any)=>p.status!=='SETTLED')||Number(data.profit_eur)<0)throw Error('COMPLETED_NONNEGATIVE_PILOT_REQUIRED');
          }
        }
        const result=await this.engine.start(body.confirm,qualification);await this.arm();return json(result);
      }
      if(path==='/admin/export-page')return json(this.repo.page(u.searchParams.get('table')||'',Number(u.searchParams.get('after'))||0,Number(u.searchParams.get('limit'))||50));
      if(path==='/admin/research-demands')return json({requests:this.repo.sourceDemands()});
      if(path==='/admin/research'&&r.method==='POST'){
        if(this.engine.run().status==='READY'&&Date.now()>Date.parse(this.repo.get<string>('r4:preflight_until')||'1970-01-01'))return json({ignored:'NOT_STARTED'});
        const b:any=await r.json(),url=new URL(b.url),age=Date.now()-Date.parse(b.fetched_at);
        if(!Number.isFinite(age)||age< -5000||age>3600000||url.protocol!=='https:'||url.username||url.password||!['site.api.espn.com','api.opendota.com'].includes(url.hostname)||JSON.stringify(b.data).length>4000000)throw Error('INVALID_RESEARCH_FEED');
        if(url.hostname==='site.api.espn.com'&&!/^\/apis\/site\/v2\/sports\/(basketball|soccer|tennis)\/[a-z0-9.]+\/scoreboard$/.test(url.pathname))throw Error('INVALID_RESEARCH_PATH');
        if(url.hostname==='api.opendota.com'&&!/^\/api\/teams(?:\/\d+\/matches)?$/.test(url.pathname))throw Error('INVALID_RESEARCH_PATH');
        this.repo.putCache('research:'+url.href,{fetched_at:b.fetched_at,data:b.data},Math.max(1,Math.floor((3600000-age)/1000)));
        this.repo.run('DELETE FROM meta WHERE key=?','source_demand:'+url.href);const previous=this.repo.get<any>('research_collector')||{};this.repo.set('research_collector',{...previous,at:now(),last_fetched_at:b.fetched_at,...(b.batch_kind==='full'?{full_at:now()}:{}),...(url.hostname==='api.opendota.com'?{opendota_at:now()}: {})});return json({stored:true});
      }
      if(path==='/admin/notification-outbox')return json({topic:this.env.NTFY_TOPIC,notifications:this.repo.rows("SELECT * FROM notifications WHERE status='PENDING' AND id NOT GLOB 'r4:incident:notify:*' ORDER BY created_at LIMIT 10").map(n=>({...JSON.parse(n.payload),id:n.id,phase:4,stage:target.stage.toLowerCase()}))});
      if(path==='/admin/notification-ack'&&r.method==='POST'){const b:any=await r.json();const row=this.repo.one('SELECT payload FROM notifications WHERE id=?',b.id);if(row)this.repo.run("UPDATE notifications SET status='SENT',payload=? WHERE id=?",JSON.stringify({...JSON.parse(row.payload),sent_at:now()}),b.id);return json({ok:true});}
      if(path==='/admin/tick'&&r.method==='POST'){this.engine.tick();await this.arm();return json({ok:true});}
      if(path==='/admin/preflight'&&r.method==='POST'){
        this.repo.set('r4:preflight_until',new Date(Date.now()+1800000).toISOString());const run=this.engine.run();for(const category of ['weather','football','basketball','tennis','esport'])this.repo.enqueue('r4:preflight:'+now()+':'+category,'R4_PREFLIGHT',{category});await this.arm();return json({queued:true,experiment_started:run.started_at!==null});
      }
      return json({error:'NOT_FOUND'},404);
    }catch(e){return json({error:e instanceof Error?e.message:'UNKNOWN_ERROR'},400);}
    finally{if(!r.headers.get('x-reform-recovery'))this.measure();}
  }
  measure(kind='API'){if(kind==='API'&&Date.now()-this.lastApiMeasure<60000)return;try{const backup=this.repo.get<any>('r4:backup_lock');if(backup&&Date.parse(backup.until)>Date.now())return;this.lastApiMeasure=Date.now();const day=now().slice(0,10),reads=this.repo.reads,writes=this.repo.writes;const queries=this.repo.takeCosts();this.repo.reads=0;this.repo.writes=0;this.repo.set(kind==='API'?'r4:last_storage_request':'r4:last_storage_cycle',{at:now(),kind,rows_read:reads,rows_written:writes,queries});this.repo.run('INSERT INTO r4_usage VALUES(?,?,?,1) ON CONFLICT(day) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes,requests=requests+1',day,reads,writes);}catch(e){if(!storageQuotaError(e))throw e;}}

  async arm(){
    const next={at:this.repo.nextJobAt()};if(!next?.at)return;
    const due=nextAlarm(await this.ctx.storage.getAlarm(),Date.parse(next.at),Date.now(),this.processing);if(due!==null)await this.ctx.storage.setAlarm(due);
  }
  async alarm(){
    if(Date.now()<this.storageBlockedUntil)return;
    try{this.initialize();const run=this.engine.run();if(run)await this.engine.prepare(run.id,run.stage);}catch(e){if(storageQuotaError(e)){this.storageBlockedUntil=nextUtcReset();return;}throw e;}
    if(recoveryStatus(this.repo)){await this.ctx.storage.deleteAlarm();return;}
    const backup=this.repo.get<any>('r4:backup_lock');if(backup&&Date.parse(backup.until)>Date.now()){await this.ctx.storage.setAlarm(Date.parse(backup.until)+100);return;}
    if(this.processing){await this.ctx.storage.setAlarm(Date.now()+5000);return;}this.processing=true;let job:any=null,timer:ReturnType<typeof setInterval>|null=null;
    try{
      this.engine.tick();job=this.repo.claim();if(!job)return;
      await this.ctx.storage.setAlarm(Date.parse(job.lease_until)+100);
      timer=setInterval(()=>{const old=job.lease_until;job.lease_until=new Date(Date.now()+120000).toISOString();this.repo.run("UPDATE jobs SET lease_until=? WHERE id=? AND status='RUNNING' AND lease_until=?",job.lease_until,job.id,old);this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(job.lease_until)+100));},30000);
      const permit=researchPermit(this.repo,job,this.engine.run().policy);
      if(!permit.allowed){this.repo.retry(job,permit.mode==='PACED'?'READ_BUDGET_PACING':'READ_BUDGET_RESERVED',permit.seconds);this.repo.run("UPDATE jobs SET attempt=max(0,attempt-1) WHERE id=? AND status='PENDING'",job.id);return;}
      if(job.kind==='R4_PREFLIGHT'){
        const category=job.payload.category,deadline=new Date(Date.now()+6*86400000).toISOString(),markets=await this.engine.markets.catalog(category,deadline);let usable=0;const errors:any[]=[],checks:any[]=[];
        const candidates=markets.flatMap(raw=>{try{const m=normalize(raw,category);return m.active&&Date.parse(m.event_end_at)>Date.now()?[m]:[];}catch(e){return [];}}).sort((a,b)=>coveragePreference(b)-coveragePreference(a));
        for(const candidate of candidates.slice(0,6))try{this.repo.putMarket(candidate);const m=await this.engine.markets.inspect(candidate.id),result=await this.engine.collectEvidence(m);checks.push({id:m.id,question:m.question,books:Object.keys(m.books),observations:result.metar?{reports:result.metar.rows?.length||0,latest:result.metar.latest||null,error:result.metar.error||null}:null});if(result.sources.some(s=>s.provider!=='Polymarket'&&s.status==='VERIFIED')){usable++;break;}else errors.push({id:candidate.id,sources:result.sources.filter(s=>s.status!=='VERIFIED').map(s=>({provider:s.provider,error:s.text})),observations:result.metar?.error||null});}catch(e){errors.push({id:candidate.id,error:String(e)});}
        this.repo.set('r4:preflight:'+category,{at:now(),discovered:markets.length,normalized:candidates.length,usable,checks,errors,limitation:'Provider connectivity is not predictive qualification.'});
      }else if(job.kind==='NOTIFY'||job.kind==='NOTIFY_RELAY'){
        // The scheduled GitHub relay drains the persistent outbox. Dispatching
        // a new workflow for every item causes retry storms when GitHub fails.
        await deliverNotificationJob(this.env.NTFY_DELIVERY,job,id=>this.legacy.notifications(id));
      }
      else await this.engine.process(job);
      this.repo.complete(job);this.repo.set('r4:last_job',{at:now(),kind:job.kind,status:'DONE'});
    }catch(e){const error=e instanceof Error?e.message:String(e);
      if(storageQuotaError(e)){this.storageBlockedUntil=nextUtcReset();return;}
      if(job&&error==='R4_MEETING_BUSY'){this.repo.retry(job,error,15);return;}
      if(job&&job.attempt<3)this.repo.retry(job,error,Math.min(120,15*2**job.attempt));
      else if(job){this.repo.run("UPDATE jobs SET status='FAILED',lease_until=NULL,error=? WHERE id=?",error.slice(0,240),job.id);if(job.kind==='R4_MEETING'){const meeting=this.engine.meetingRow(job.payload.id);if(meeting)this.engine.endMeeting(meeting,'CANCELLED','Incident technique : '+error);}}
      recordJobIncident(this.repo,job,error,this.engine.link());
    }finally{if(timer)clearInterval(timer);this.processing=false;if(Date.now()>=this.storageBlockedUntil){this.measure(job?.kind||'ALARM');await this.ctx.storage.deleteAlarm();await this.arm();}}
  }
}
