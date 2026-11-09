import {DurableObject} from 'cloudflare:workers';
import {Repository} from './repository';
import {Engine} from './engine';
import {CONFIG,now,type Env} from './domain';
import {D} from './finance';
import {boardTarget} from './routing';
import {Markets} from './markets';
import {nextAlarm} from './scheduling';

const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
async function authorized(r:Request,env:Env){
  if(!env.ADMIN_TOKEN)return false;
  const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await digest(r.headers.get('authorization')||''),b=await digest('Bearer '+env.ADMIN_TOKEN);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export class Council extends DurableObject<Env>{
  repo:Repository; engine:Engine; private processing=false;
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);this.repo=new Repository(ctx.storage.sql,f=>ctx.storage.transactionSync(f));this.engine=new Engine(this.repo,env);
    this.repo.onEvent=id=>ctx.waitUntil(Promise.resolve().then(()=>{
      const event=this.repo.one('SELECT * FROM events WHERE id=?',id);if(!event)return;
      event.details=JSON.parse(event.details);
      for(const socket of ctx.getWebSockets())try{socket.send(JSON.stringify({type:'events',events:[event]}));}catch{socket.close(1011,'Reconnect');}
    }));
  }
  async fetch(r:Request){
    const u=new URL(r.url),path=u.pathname;
    const objectId=r.headers.get('x-board-id')||this.env.EXPERIMENT_ID;
    this.engine.prepare(objectId.startsWith('recovery-')?(this.repo.state()?.id||objectId):objectId,r.headers.get('x-board-mode')==='test'?'test':r.headers.get('x-board-mode')==='validation'?'validation':'live');
    try{
      if(this.repo.get('recovery_readonly')&&r.method!=='GET')return json({error:'RECOVERY_IS_READ_ONLY'},403);
      if(path==='/api/ws'){
        if(r.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WEBSOCKET_REQUIRED'},426);
        const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);return new Response(null,{status:101,webSocket:pair[0]});
      }
      if(path==='/api/health')return json({state:this.repo.state(),health:this.repo.get('health'),research_collector:this.repo.get('research_collector'),storage_bytes:this.ctx.storage.sql.databaseSize,scheduler:{alarm_at:await this.ctx.storage.getAlarm(),processing:this.processing}});
      if(path==='/api/state'){const reads=this.repo.reads,writes=this.repo.writes,out=json(this.engine.summary());out.headers.set('X-Survival-SQL-Reads',String(this.repo.reads-reads));out.headers.set('X-Survival-SQL-Writes',String(this.repo.writes-writes));return out;}
      if(path==='/api/events')return json({events:this.repo.events(Math.max(0,Number(u.searchParams.get('after'))||0),u.searchParams.get('meeting')||undefined,100)});
      if(path==='/api/meeting')return json({meeting:this.repo.meeting(u.searchParams.get('id')||''),events:this.repo.events(0,u.searchParams.get('id')||'',300)});
      if(path==='/api/meetings')return json({meetings:this.repo.rows('SELECT * FROM meetings WHERE created_at<? ORDER BY created_at DESC LIMIT 25',u.searchParams.get('before')||now()).map(m=>({...m,payload:JSON.parse(m.payload)}))});
      if(path==='/api/document'){
        const d=this.repo.one('SELECT * FROM documents WHERE id=?',u.searchParams.get('id')||'');return d?json(d):json({error:'NOT_FOUND'},404);
      }
      if(path==='/tick'){this.engine.tick();await this.arm();return json({ok:true});}
      if(path==='/admin/preflight'&&r.method==='POST'){
        this.repo.enqueue('preflight:'+now(),'PREFLIGHT',{});await this.arm();return json({queued:true},202);
      }
      if(path==='/admin/start'&&r.method==='POST'){
        const b:any=await r.json();if(b.confirm!==this.repo.state()!.id) return json({error:'EXPLICIT_EXPERIMENT_ID_REQUIRED'},400);
        const s=await this.engine.start();await this.arm();return json(s);
      }
      if(path==='/admin/tick'&&r.method==='POST'){this.engine.tick();await this.arm();return json({ok:true});}
      if(path==='/admin/reconcile'&&r.method==='POST'){
        if(!this.repo.state()?.started_at)throw Error('EXPERIMENT_NOT_STARTED');
        this.engine.expireDossiers();this.repo.enqueue('manual-reconcile:'+now(),'SETTLE',{});await this.arm();return json({queued:true});
      }
      if(path==='/admin/retry-analyses'&&r.method==='POST'){
        if(this.repo.state()?.mode!=='test'||this.repo.state()?.status!=='RUNNING')throw Error('RUNNING_TEST_REQUIRED');
        const failed=this.repo.rows("SELECT id FROM dossiers WHERE status='TECHNICAL_ERROR' ORDER BY updated_at LIMIT 20"),at=now();
        for(const d of failed)this.repo.enqueue('analysis-recovery:'+at+':'+d.id,'ANALYZE_RETRY',{id:d.id});
        this.repo.event('analysis-recovery:'+at,'RECOVERY',`${failed.length} analyses techniques seront reprises avec des carnets actualisés. Les incidents précédents restent dans le journal.`);
        await this.arm();return json({queued:failed.length});
      }
      if(path==='/admin/export-page')return json(this.repo.exportPage(u.searchParams.get('table')||'',Number(u.searchParams.get('after'))||0,Number(u.searchParams.get('limit'))||100));
      if(path==='/admin/export')return json(this.repo.export());
      if(path==='/admin/resolution-check'){
        const id=u.searchParams.get('market_id')||'';if(!/^\d+$/.test(id))throw Error('VALID_MARKET_ID_REQUIRED');
        return json(await new Markets(this.repo).resolutionDiagnostic(id));
      }
      if(path==='/admin/validation-packet'){
        const m=await this.engine.markets.inspect(u.searchParams.get('market_id')||'');this.repo.putMarket(m);
        const sources=await this.engine.markets.evidence(m),research=sources.filter(s=>['ESPN','OpenDota'].includes(s.provider)).map(s=>({url:s.url,...this.repo.cache<any>('research:'+s.url)})).filter(r=>r.data);
        return json({market:m,sources,research});
      }
      if(path==='/admin/rehearsal'&&r.method==='POST'){
        if(this.repo.state()!.mode!=='validation'||this.repo.state()!.status!=='READY')throw Error('EMPTY_VALIDATION_INSTANCE_REQUIRED');
        const b:any=await r.json();if(!/^\d+$/.test(String(b.market_id)))throw Error('VALID_MARKET_ID_REQUIRED');
        const main=this.env.COUNCIL.get(this.env.COUNCIL.idFromName(this.env.EXPERIMENT_ID));
        const packet=await main.fetch(new Request('https://internal/admin/validation-packet?market_id='+b.market_id,{headers:{'x-board-id':this.env.EXPERIMENT_ID}}));
        if(!packet.ok)throw Error('REAL_VALIDATION_PACKET_UNAVAILABLE');const p:any=await packet.json();
        const fx=await this.engine.markets.fx(),s=this.repo.state()!;s.fx=fx;s.started_at=now();s.end_at=new Date(Date.now()+168*3600000).toISOString();s.betting_deadline=new Date(Date.parse(s.end_at)-6*3600000).toISOString();s.status='RUNNING';
        this.repo.atomic(()=>{this.repo.save(s);this.repo.run('INSERT INTO ledger VALUES(?,?,?,?,?)',s.id+':initial',now(),'INITIAL',D(s.initial_eur).mul(fx.usd_per_eur).toFixed(),s.id);});
        this.repo.putMarket(p.market);for(const source of p.sources)this.repo.document(source);
        for(const feed of p.research||[])this.repo.putCache('research:'+feed.url,{fetched_at:feed.fetched_at,data:feed.data},Math.max(1,Math.floor((3600000-(Date.now()-Date.parse(feed.fetched_at)))/1000)));
        this.repo.putDossier({id:p.market.id,market_id:p.market.id,category:p.market.category,status:'PENDING',priority:60,hash:'rehearsal:'+now(),payload:{source_ids:p.sources.filter((s:any)=>s.status==='VERIFIED').map((s:any)=>s.id)}});
        this.repo.enqueue(s.id+':rehearsal','REHEARSAL',{id:p.market.id});await this.arm();return json({queued:true,mode:'validation',production_started:false,instance:s.id});
      }
      if(path==='/admin/research'&&r.method==='POST'){
        const b:any=await r.json(),url=new URL(b.url),age=Date.now()-Date.parse(b.fetched_at);
        if(!['site.api.espn.com','api.opendota.com'].includes(url.hostname)||url.protocol!=='https:'||url.username||url.password||age< -5000||age>3600000||JSON.stringify(b.data).length>4000000)throw Error('INVALID_RESEARCH_FEED');
        if(url.hostname==='site.api.espn.com'&&!/^\/apis\/site\/v2\/sports\/(basketball|soccer|tennis)\/[a-z0-9.]+\/scoreboard$/.test(url.pathname))throw Error('INVALID_RESEARCH_PATH');
        if(url.hostname==='api.opendota.com'&&!/^\/api\/teams(?:\/\d+\/matches)?$/.test(url.pathname))throw Error('INVALID_RESEARCH_PATH');
        this.repo.putCache('research:'+url.href,{fetched_at:b.fetched_at,data:b.data},Math.max(1,Math.floor((3600000-age)/1000)));
        const old=this.repo.get<any>('research_collector')||{};this.repo.set('research_collector',{at:now(),last_source:url.hostname,last_fetched_at:b.fetched_at,full_at:b.batch_kind==='full'?now():old.full_at||null,opendota_at:url.hostname==='api.opendota.com'?now():old.opendota_at||null});this.repo.run('DELETE FROM meta WHERE key=?','source_demand:'+url.href);return json({accepted:true});
      }
      if(path==='/admin/research-demands')return json({requests:this.repo.sourceDemands()});
      if(path==='/admin/notification-outbox')return json({notifications:this.repo.rows("SELECT id,payload FROM notifications WHERE status='PENDING' ORDER BY created_at LIMIT 20").map(n=>({id:n.id,...JSON.parse(n.payload)})),topic:this.env.NTFY_TOPIC});
      if(path==='/admin/notification-ack'&&r.method==='POST'){const b:any=await r.json();if(typeof b.id!=='string')throw Error('INVALID_ID');const row=this.repo.one('SELECT payload FROM notifications WHERE id=?',b.id);if(row){const p=JSON.parse(row.payload);p.sent_at=now();p.delivery='github-relay';this.repo.run("UPDATE notifications SET status='SENT',payload=?,error=NULL WHERE id=?",JSON.stringify(p),b.id);}return json({ok:true});}
      if(path==='/admin/notifications/test'&&r.method==='POST'){
        if(!this.env.NTFY_TOPIC)return json({error:'NTFY_NOT_CONFIGURED'},409);
        this.repo.notify('notification-test:'+now(),'PROJECT SURVIVAL — test','Test technique : aucune expérience lancée.',this.env.PUBLIC_ORIGIN+'/?phase=3');
        await this.engine.notifications();return json({sent:this.repo.one("SELECT count(*) n FROM notifications WHERE status='SENT'").n,topic:this.env.NTFY_TOPIC});
      }
      if(path==='/admin/restore'&&r.method==='POST'){
        // Restore only into an empty, explicitly named recovery object. Never reset a running fund.
        if(!objectId.startsWith('recovery-')||this.repo.state()?.status!=='READY'||this.repo.one('SELECT count(*) n FROM ledger').n)throw Error('RESTORE_REQUIRES_EMPTY_RECOVERY_OBJECT');
        const request:any=await r.json(),b=request.backup;if(b?.schema_version!==3||!Array.isArray(b.meta))throw Error('INVALID_BACKUP');
        const allowed=['meta','documents','markets','dossiers','meetings','proposals','votes','events','ledger','positions','fills','counterfactuals','jobs','calls','notifications'];
        for(const t of allowed)if(!Array.isArray(b[t]))throw Error('INCOMPLETE_BACKUP');
        const restored=b.meta.find((v:any)=>v.key==='state');if(!restored||JSON.parse(restored.value).id!==request.confirm_id)throw Error('BACKUP_ID_MISMATCH');
        this.repo.atomic(()=>{for(const t of allowed){for(const row of b[t]){
          const keys=Object.keys(row);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw Error('INVALID_COLUMN');
          this.repo.run(`INSERT OR REPLACE INTO ${t} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k]));
        }}this.repo.set('recovery_readonly',true);});return json({restored:true,read_only:true,automatic_execution:false});
      }
      return json({error:'NOT_FOUND'},404);
    }catch(e){return json({error:this.engine.errorCode(e)},400);}
  }
  async arm(){
    if(this.repo.get('recovery_readonly'))return;
    const j=this.repo.one("SELECT min(CASE WHEN status='RUNNING' THEN lease_until ELSE due_at END) at FROM jobs WHERE status IN ('PENDING','RUNNING')");
    if(j?.at){const old=await this.ctx.storage.getAlarm(),due=nextAlarm(old,Date.parse(j.at),Date.now(),this.processing);if(due!==null){await this.ctx.storage.setAlarm(due);if(old!==null&&old<Date.now()-5000)this.repo.event('alarm-recovery:'+old,'RECOVERY','Le contrôle périodique a réarmé un réveil technique périmé. Les tâches reprennent sans réinitialiser le portefeuille.','SECRETARY',null,{previous_alarm_at:new Date(old).toISOString(),new_alarm_at:new Date(due).toISOString()});}}
  }
  async alarm(){
    if(this.repo.get('recovery_readonly')){await this.ctx.storage.deleteAlarm();return;}
    if(this.processing){await this.ctx.storage.setAlarm(Date.now()+5000);return;}
    this.processing=true;
    const from=this.repo.one('SELECT max(seq) seq FROM events')?.seq||0;
    let job:any=null,renewal:ReturnType<typeof setInterval>|null=null;
    try{
      this.engine.tick();job=this.repo.claim();
      if(job){
        // The persisted lease and alarm survive isolates, crashes and deploys.
        await this.ctx.storage.setAlarm(Date.parse(job.lease_until)+100);
        renewal=setInterval(()=>{
          const old=job.lease_until,until=new Date(Date.now()+120000).toISOString();
          this.repo.run("UPDATE jobs SET lease_until=? WHERE id=? AND status='RUNNING' AND lease_until=?",until,job.id,old);job.lease_until=until;
          this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(until)+100));
        },30000);
        if(job.kind==='PREFLIGHT')await this.engine.preflight();else await this.engine.process(job);
        if(renewal){clearInterval(renewal);renewal=null;}
        this.repo.complete(job);
        const h=this.repo.get<any>('health')||{successful:0,failed:0};h.successful++;h.last_success=now();this.repo.set('health',h);
      }
    }catch(e){
      const code=this.engine.errorCode(e);
      if(job&&['MEETING_BUSY','MEETING_PENDING_DOSSIERS','MEETING_DATA_PENDING'].includes(code)){this.repo.retry(job,code,15);return;}
      const h=this.repo.get<any>('health')||{successful:0,failed:0};h.failed++;h.last_failure={at:now(),code,job:job?.kind};this.repo.set('health',h);
      if(job){
        const circuit=this.repo.get<any>('azure_circuit'),recoveryWait=circuit?.open_until?Math.max(0,(Date.parse(circuit.open_until)-Date.now())/1000)+1:0;
        if(job.attempt<3&&job.kind!=='ANALYZE')this.repo.retry(job,code,Math.max(recoveryWait,Math.min(120,15*2**job.attempt)));
        else{
          this.repo.run("UPDATE jobs SET status='FAILED',lease_until=NULL,error=? WHERE id=?",code,job.id);
          if(job.kind==='MEETING'){const m=this.repo.meeting(job.payload.id);if(m&&['RUNNING','PAUSED'].includes(m.status))this.engine.endMeeting(m,'CANCELLED','Incident technique : '+code+'. Les fonds restent intacts.');}
        }
        this.repo.event(job.id+':error:'+job.attempt,'INCIDENT','Incident technique : '+code,'SECRETARY',job.payload?.id?.startsWith('meeting:')?job.payload.id:null,{job:job.kind,attempt:job.attempt});
        if(!job.kind.startsWith('NOTIFY'))this.repo.notify('incident:'+job.id,'Incident technique',code,this.env.PUBLIC_ORIGIN+'/?phase=3',4);
      }
    }finally{
      if(renewal)clearInterval(renewal);
      this.processing=false;
      const events=this.repo.events(from,undefined,100);
      if(events.length)for(const socket of this.ctx.getWebSockets())try{socket.send(JSON.stringify({type:'events',events}));}catch{socket.close(1011,'Reconnect');}
      this.repo.set('quota',{at:now(),storage_bytes:this.ctx.storage.sql.databaseSize,rows_read_last_step:this.repo.reads,rows_written_last_step:this.repo.writes,warning:this.ctx.storage.sql.databaseSize>CONFIG.quotaWarningBytes});
      this.repo.reads=0;this.repo.writes=0;
      await this.ctx.storage.deleteAlarm();await this.arm();
    }
  }
  webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){if(message==='ping')ws.send('pong');}
  webSocketClose(ws:WebSocket,code:number){ws.close(code,'Closed');}
}
export default {
  async fetch(r:Request,env:Env){
    const u=new URL(r.url),admin=u.pathname.startsWith('/admin/');
    if(r.method==='OPTIONS')return new Response(null,{headers:cors(r,env)});
    if(admin&&!await authorized(r,env))return json({error:'UNAUTHORIZED'},401);
    if(!admin&&!u.pathname.startsWith('/api/'))return json({error:'NOT_FOUND'},404);
    let target;try{target=boardTarget(u,admin,env);}catch(e){return json({error:(e as Error).message},400);}
    const headers=new Headers(r.headers);headers.set('x-board-id',target.id);headers.set('x-board-mode',target.mode);
    const mirror=admin&&u.pathname==='/admin/research'&&target.id===env.EXPERIMENT_ID&&env.TEST_EXPERIMENT_ID?r.clone():null;
    const stub=env.COUNCIL.get(env.COUNCIL.idFromName(target.id));let response=await stub.fetch(new Request(r,{headers}));
    if(response.status===101)return response;
    if(response.ok&&mirror){
      // Share only public research. Financial state, model calls and memories
      // remain in separate Durable Objects with separate journals.
      const h=new Headers(headers);h.set('x-board-id',env.TEST_EXPERIMENT_ID!);h.set('x-board-mode','test');
      const shared=await env.COUNCIL.get(env.COUNCIL.idFromName(env.TEST_EXPERIMENT_ID!)).fetch(new Request(mirror,{headers:h}));
      if(!shared.ok)return json({error:'TEST_RESEARCH_DELIVERY_FAILED'},502);await shared.body?.cancel();
    }
    if(response.ok&&admin&&u.pathname==='/admin/research-demands'&&target.id===env.EXPERIMENT_ID&&env.TEST_EXPERIMENT_ID){
      const body:any=await response.json(),h=new Headers(headers);h.set('x-board-id',env.TEST_EXPERIMENT_ID);h.set('x-board-mode','test');
      const extra=await env.COUNCIL.get(env.COUNCIL.idFromName(env.TEST_EXPERIMENT_ID)).fetch(new Request(r.url,{headers:h}));
      if(extra.ok){const b:any=await extra.json();body.requests=[...new Map([...body.requests,...b.requests].map((d:any)=>[d.url,d])).values()];}
      response=json(body);
    }
    if(response.ok&&admin&&u.pathname==='/admin/notification-outbox'&&target.id===env.EXPERIMENT_ID&&env.TEST_EXPERIMENT_ID){
      const body:any=await response.json(),h=new Headers(headers);h.set('x-board-id',env.TEST_EXPERIMENT_ID);h.set('x-board-mode','test');
      const extra=await env.COUNCIL.get(env.COUNCIL.idFromName(env.TEST_EXPERIMENT_ID)).fetch(new Request(r.url,{headers:h}));
      if(extra.ok){const b:any=await extra.json();body.notifications.push(...b.notifications.map((n:any)=>({...n,instance:env.TEST_EXPERIMENT_ID})));}
      response=json(body);
    }
    const out=new Response(response.body,response);for(const [k,v]of Object.entries(cors(r,env)))out.headers.set(k,v);return out;
  },
  async scheduled(_c:ScheduledController,env:Env,ctx:ExecutionContext){
    for(const id of [env.EXPERIMENT_ID,env.TEST_EXPERIMENT_ID].filter(Boolean) as string[])ctx.waitUntil(env.COUNCIL.get(env.COUNCIL.idFromName(id)).fetch(new Request('https://internal/tick',{headers:{'x-board-id':id,'x-board-mode':id===env.TEST_EXPERIMENT_ID?'test':'live'}})));
  },
} satisfies ExportedHandler<Env>;
function cors(r:Request,env:Env):Record<string,string>{const origin=r.headers.get('Origin');return origin&&(origin===env.PUBLIC_ORIGIN||/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin))?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,OPTIONS','Vary':'Origin'}:{};}
