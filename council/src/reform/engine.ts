import {z} from 'zod';
import {CATEGORIES,MEMBERS,SpeechSchema,ChairSchema,VoteSchema,ArbitrationSchema,now,panel,type Category,type Market,type Source,type Proposal,type State,type Env,type MemberId} from '../domain';
import {Markets,normalize,hash,coveragePreference,classify} from '../markets';
import {Azure} from '../azure';
import {D,execute,technicalCheck,tally,arbitrate} from '../finance';
import {nextSlots} from '../schedule';
import {factualText,decisionDeadline} from '../research';
import {POLICY,PolicySchema,type Policy} from './policy';
import {ReformRepository} from './store';
import {ForecastSchema,validateForecast,benchmark,score,calibrate,independentTrainingRows,type ScoredForecast} from './forecast';
import {observations,stationFor,quality,family,anomaly} from './evidence';
import {coverage,healthView} from './telemetry';
import {readiness,evaluationWindows,pairedAblation,fairMissedOpportunities} from './evaluation';
import {allowance} from './allocation';
import {wilson} from './models';

export type Run={id:string;stage:'SHADOW'|'PILOT'|'FULL';status:'READY'|'RUNNING'|'CLOSING'|'FINISHED';created_at:string;started_at:string|null;end_at:string|null;evaluation_cutoff:string|null;policy:Policy;policy_hash:string;code_version:string;last_scan:string|null;qualification:any};
export class ReformEngine {
  markets:Markets;azure:Azure;
  constructor(public repo:ReformRepository,public env:Env,markets?:Markets,azure?:Azure){repo.migrateReform();this.markets=markets||new Markets(repo);this.azure=azure||new Azure(repo,env);}
  run(){return this.repo.get<Run>('reform_run')!;}
  async prepare(id:string,stage:Run['stage']){
    if(this.env.ALLOW_FIXTURES==='true')throw Error('REFORM_LIVE_PROTOCOL_REJECTS_FIXTURE_MODE');
    const old=this.run();if(old){if(old.id!==id||old.stage!==stage)throw Error('REFORM_ID_MISMATCH');if(old.status==='READY'&&old.code_version!==this.activeCode()){old.policy=PolicySchema.parse(POLICY);old.policy_hash=await hash(old.policy);old.code_version=this.activeCode();this.repo.set('reform_run',old);const s=this.repo.state()!;s.initial_eur=stage==='SHADOW'?'0':stage==='PILOT'?old.policy.pilotCapitalEur:old.policy.fullCapitalEur;this.repo.save(s);this.repo.run("DELETE FROM transient_cache WHERE key LIKE 'r4:%'");}return old;}
    const policy=PolicySchema.parse(POLICY),run:Run={id,stage,status:'READY',created_at:now(),started_at:null,end_at:null,evaluation_cutoff:null,policy,policy_hash:await hash(policy),code_version:this.env.CF_VERSION_METADATA?.id||'local-test',last_scan:null,qualification:null};this.repo.set('reform_run',run);
    const state:State={id,mode:'live',status:'READY',initial_eur:stage==='SHADOW'?'0':stage==='PILOT'?policy.pilotCapitalEur:policy.fullCapitalEur,created_at:now(),updated_at:now(),started_at:null,end_at:null,betting_deadline:null,fx:null,last_scan:null,last_cycle:null,emergency_day:'',emergency_count:0,last_emergency:null,last_error:null};this.repo.save(state);return run;
  }
  async start(confirm:string,qualification:any=null){
    const run=this.run();if(confirm!==run.id)throw Error('EXPLICIT_EXPERIMENT_ID_REQUIRED');if(run.status!=='READY')throw Error('START_IS_NEVER_A_RESET');
    if(run.stage!=='SHADOW'&&(!qualification?.eligible||qualification.policy_hash!==run.policy_hash||qualification.code_version!==this.activeCode()))throw Error('QUALIFIED_OUT_OF_SAMPLE_SHADOW_REQUIRED');
    run.code_version=this.env.CF_VERSION_METADATA?.id||'local-test';
    const fx=await this.markets.fx();
    this.repo.atomic(()=>{run.status='RUNNING';run.started_at=now();run.end_at=new Date(Date.now()+run.policy.durationHours*3600000).toISOString();run.evaluation_cutoff=new Date(Date.now()+24*3600000).toISOString();run.qualification=qualification;
      const s=this.repo.state()!;s.status='RUNNING';s.started_at=run.started_at;s.end_at=run.end_at;s.betting_deadline=new Date(Date.parse(run.end_at)-run.policy.settlementMarginHours*3600000).toISOString();s.fx=fx;this.repo.save(s);this.repo.set('reform_run',run);
      if(run.stage!=='SHADOW')this.repo.run('INSERT INTO ledger VALUES(?,?,?,?,?)',run.id+':initial',now(),'INITIAL',D(s.initial_eur).mul(fx.usd_per_eur).toFixed(),run.id);
      this.repo.event(run.id+':start','START',run.stage==='SHADOW'?'L’observation sans mises commence. Chaque prévision sera évaluée après le résultat officiel.':`Le fonds ${run.stage} démarre avec ${s.initial_eur} € entièrement fictifs.`);
      for(const slot of nextSlots(run.started_at,run.end_at,100,run.policy.meetingHours))this.repo.enqueue('r4:slot:'+slot,'R4_SLOT',{slot},slot);
      this.notify(run.id+':start','Expérience '+run.stage+' lancée','Le nouveau protocole commence.');
    });this.tick();return run;
  }
  link(meeting=''){const run=this.run();return this.env.PUBLIC_ORIGIN+'/?phase=4&stage='+run.stage.toLowerCase()+(meeting?'&meeting='+encodeURIComponent(meeting):'');}
  notify(id:string,title:string,text:string,priority=3){this.repo.notify(id,title,text,this.link(),priority);}
  tick(){
    const run=this.run();if(!run||run.status==='READY'||run.status==='FINISHED')return;
    const bucket=Math.floor(Date.now()/(run.policy.scanMinutes*60000));
    if(this.protocolCurrent()&&run.status==='RUNNING'&&Date.now()<Date.parse(this.repo.state()!.betting_deadline!))for(const category of CATEGORIES)this.repo.enqueue(`r4:scan:${bucket}:${category}`,'R4_SCAN',{category,bucket});
    if(this.repo.get('r4:last_tick_bucket')!==bucket){this.repo.set('r4:last_tick_bucket',bucket);this.repo.enqueue('r4:settle:'+bucket,'R4_SETTLE',{});this.repo.enqueue('r4:watch:'+bucket,'R4_WATCH',{});}
    if(Date.now()>=Date.parse(run.end_at!)){
      const pending=run.stage==='SHADOW'?this.repo.one("SELECT p.id FROM r4_packets p JOIN r4_forecasts f ON f.packet_id=p.id WHERE p.status!='SETTLED' LIMIT 1"):this.repo.one("SELECT id FROM positions WHERE status='PENDING' LIMIT 1");run.status=pending?'CLOSING':'FINISHED';this.repo.set('reform_run',run);const s=this.repo.state()!;s.status=run.status;this.repo.save(s);
    }
    if(!this.protocolCurrent()){this.repo.run("UPDATE jobs SET status='PAUSED',error='FROZEN_CODE_VERSION_CHANGED' WHERE status='PENDING' AND kind IN ('R4_SCAN','R4_PREPARE','R4_FORECAST','R4_SLOT','R4_MEETING','R4_SEARCH')");this.repo.event('r4:freeze:'+this.activeCode(),'PROTOCOL_PAUSED','La version active a changé. Nouveaux avis suspendus, règlements conservés.');this.notify('r4:freeze:'+this.activeCode(),'Protocole suspendu','Le code a changé pendant une expérience. Les règlements restent suivis.',4);}
    // Polls may be replaced after an outage. Meetings and forecast snapshots never are.
    this.repo.run("UPDATE jobs SET status='SUPERSEDED',error='A newer scan will observe current facts' WHERE status='PENDING' AND kind='R4_SCAN' AND due_at<?",new Date(Date.now()-run.policy.scanMinutes*60000).toISOString());
    this.repo.prune();
  }
  activeCode(){return this.env.CF_VERSION_METADATA?.id||'local-test';}
  protocolCurrent(){return this.run().status==='READY'||this.run().code_version===this.activeCode();}
  async process(job:any){
    if(!this.protocolCurrent()&&!['R4_SETTLE','R4_WATCH'].includes(job.kind)){this.repo.event('r4:code:'+this.activeCode(),'PROTOCOL_PAUSED','La version active a changé pendant l’expérience. Les nouveaux avis sont suspendus ; les règlements restent surveillés.');throw Error('FROZEN_CODE_VERSION_CHANGED');}
    if(job.kind==='R4_SCAN')return this.scan(job.payload.category,job.payload.bucket);
    if(job.kind==='R4_PREPARE')return this.preparePacket(job.payload.id,job.payload.category);
    if(job.kind==='R4_FORECAST')return this.forecast(job.payload.packet,job.payload.actor);
    if(job.kind==='R4_SLOT')return this.slot(job.payload.slot,job.payload.urgent||false);
    if(job.kind==='R4_MEETING')return this.meeting(job.payload.id);
    if(job.kind==='R4_SETTLE')return this.settle();
    if(job.kind==='R4_WATCH')return this.watch();
    if(job.kind==='R4_SEARCH')return this.search(job.payload.category,job.payload.query);
  }
  async scan(category:Category,bucket:number){
    if(this.run().status!=='RUNNING')return;
    const raw=await this.markets.catalog(category,this.repo.state()!.betting_deadline!),counts:Record<string,number>={},candidates:Market[]=[];
    for(const r of raw)try{const m=normalize(r,category);if(!m.active||Date.parse(m.event_end_at)<=Date.now()||Date.parse(m.event_end_at)>Date.parse(this.repo.state()!.betting_deadline!))throw Error('CALENDAR_OR_CLOSED');candidates.push(m);}catch(e){const k=String(e);counts[k]=(counts[k]||0)+1;}
    const unique=new Map<string,Market>();
    for(const m of candidates.sort((a,b)=>coveragePreference(b)-coveragePreference(a)))if(!unique.has(m.group))unique.set(m.group,m);
    const last=(m:Market)=>this.repo.one('SELECT max(at) at FROM r4_packets WHERE event_id=?',m.group)?.at||'';
    const selected=[...unique.values()].map(m=>({m,last:last(m)})).sort((a,b)=>a.last.localeCompare(b.last)||coveragePreference(b.m)-coveragePreference(a.m)).slice(0,this.run().policy.maximumScanCandidates);
    for(const {m} of selected){this.repo.putMarket(m);this.repo.enqueue(`r4:prepare:${bucket}:${m.id}`,'R4_PREPARE',{id:m.id,category});}
    const data={discovered:raw.length,admissible:candidates.length,events:unique.size,selected:selected.map(x=>({id:x.m.id,question:x.m.question})),exclusions:counts,coverage_note:'Bounded public catalog; relevance and source availability still checked before AI.'};
    this.repo.run('INSERT OR REPLACE INTO r4_cycles VALUES(?,?,?,?,?)',bucket,category,'DONE',now(),JSON.stringify(data));
    this.repo.set('r4:scan:'+category,{at:now(),...data});const run=this.run();run.last_scan=now();this.repo.set('reform_run',run);
  }
  async search(category:Category,query:string){
    if(query.length<3||query.length>160)throw Error('INVALID_MARKET_SEARCH');
    const result=await this.markets.get('https://gamma-api.polymarket.com/public-search?q='+encodeURIComponent(query)+'&limit_per_type=5',600);
    let count=0;for(const event of result.events||[])for(const raw of event.markets||[]){try{const candidate={...raw,events:[event]};if(classify(candidate)!==category)continue;const m=normalize(candidate,category);if(m.active&&Date.parse(m.event_end_at)>Date.now()&&Date.parse(m.event_end_at)<=Date.parse(this.repo.state()!.betting_deadline!)){this.repo.putMarket(m);this.repo.enqueue('r4:search-result:'+m.id+':'+Math.floor(Date.now()/600000),'R4_PREPARE',{id:m.id,category});count++;}}catch{}}
    this.repo.event('r4:search:'+await hash({query,at:Math.floor(Date.now()/600000)}),'RESEARCH',`Recherche du spécialiste : « ${query} ». ${count} marché(s) recevables seront vérifiés.`,category.toUpperCase());
  }
  async collectEvidence(market:Market){
    const sources=await this.markets.evidence(market);let metar:any=null;const category=market.category;
    if(category==='weather'){
      const station=stationFor(market);if(station){const url=`https://aviationweather.gov/api/data/metar?ids=${station.station}&format=json&hours=48`;
        try{const rows=await this.markets.get(url,300);metar=observations(market,rows);sources.push({id:await hash({url,rows}),url,title:'Observations routine METAR '+station.station,provider:'NOAA AWC',fetched_at:this.repo.cache<string>('observed:'+url)||now(),status:'VERIFIED',text:JSON.stringify(metar)});}catch{metar={error:'OBSERVATION_PROVIDER_UNAVAILABLE'};}}
    }
    return {sources,metar};
  }
  async factSignature(sources:Source[],metar:any){
    return hash(sources.filter(s=>s.status==='VERIFIED').map(s=>({provider:s.provider,text:s.provider==='NOAA AWC'?{rules:metar?.rules,extreme:metar?.extreme,yes_impossible:metar?.yes_impossible,observation_time_window:metar?.latest?Math.floor(Date.parse(metar.latest)/10800000):null}:factualText(s.text)})));
  }
  async preparePacket(id:string,category:Category){
    if(this.run().status!=='RUNNING'||Date.now()>=Date.parse(this.repo.state()!.betting_deadline!))return;
    if(this.run().stage!=='SHADOW'&&this.repo.one('SELECT id FROM positions WHERE market_id=?',id))return;
    const market=await this.markets.inspect(id);if(!market.active||market.resolved||market.category!==category||Date.parse(market.event_end_at)<=Date.now())return;
    const {sources,metar}=await this.collectEvidence(market);
    const q=quality(market,sources,metar,Date.now(),this.run().policy),baseline=market.books.YES?benchmark(market.books.YES):null;
    const facts=await this.factSignature(sources,metar),old=this.repo.one('SELECT * FROM r4_packets WHERE market_id=? ORDER BY at DESC LIMIT 1',id);
    if(old){const previous=JSON.parse(old.payload);if(previous.facts===facts&&baseline&&previous.baseline&&Math.abs(previous.baseline.probability-baseline.probability)<.04)return;}
    const packetId=await hash({id,facts,baseline,protocol:this.run().policy_hash});
    const payload={market,sources,quality:q,metar,baseline,facts,policy_hash:this.run().policy_hash,previous:old?JSON.parse(old.payload).analysis||null:null};
    this.repo.putMarket(market);this.repo.run('INSERT OR IGNORE INTO r4_packets VALUES(?,?,?,?,?,?,?)',packetId,id,category,market.group,now(),q.ready&&baseline?'PREPARED':'DATA_PENDING',JSON.stringify(payload));
    for(const source of sources)this.repo.run('INSERT OR IGNORE INTO r4_evidence VALUES(?,?,?,?)',source.id,market.group,now(),JSON.stringify({...source,event:market.group,station:metar?.rules?.station,local_day:metar?.rules?.day,family:family(source.provider),kind:source.provider==='NOAA AWC'?'OBSERVATION':source.provider==='Polymarket'?'RULES':category==='weather'?'FORECAST':'SPORT_STATE'}));
    if(q.ready&&baseline)this.repo.enqueue('r4:forecast:'+packetId+':'+category,'R4_FORECAST',{packet:packetId,actor:category.toUpperCase()});
    else this.repo.event('r4:pending:'+packetId,'DATA_PENDING',`Dossier « ${market.question} » : ${q.essential_missing.join(' ; ')||'Référence de prix indisponible'}. Aucun appel de prévision inutile.`,category.toUpperCase(),null,{packet:packetId});
  }
  blind(packet:any){
    const m=packet.payload.market as Market;
    return {protocol:'reform-v4',market:{id:m.id,question:m.question,category:m.category,description:m.description,outcome_labels:m.outcome_labels,start_at:m.start_at,event_end_at:m.event_end_at},sources:packet.payload.sources,data_quality:packet.payload.quality,
      observations:this.observationSummary(packet.payload.metar),prior_protocol_lessons:this.repo.get('r4:legacy_lessons'),memory:this.repo.memory(m.group,m.category),instruction:'Prévision indépendante du premier outcome, AVANT de voir les prix ou les autres opinions. method_id=judgement sauf modèle statistique fourni et vérifié. Donne un intervalle et une hypothèse réfutable.'};
  }
  async forecast(packetId:string,actor:MemberId){
    if(this.run().status!=='RUNNING'||Date.now()>=Date.parse(this.repo.state()!.betting_deadline!))return;
    const packet=this.repo.packet(packetId);if(!packet||!['PREPARED','CANDIDATE','IN_MEETING'].includes(packet.status))return;
    if(this.repo.forecast(packetId,actor))return;
    let value=await this.azure.ask('r4:independent:'+packetId+':'+actor,actor,'independent_forecast',this.blind(packet),ForecastSchema);
    validateForecast(value,packet.payload.sources.filter((s:Source)=>s.status==='VERIFIED').map((s:Source)=>s.id));
    if(value.method_id!=='judgement'&&!this.repo.one('SELECT id FROM r4_models WHERE id=?',value.method_id))throw Error('UNREGISTERED_STATISTICAL_METHOD');
    if(value.probability!==null&&this.run().evaluation_cutoff&&now()>=this.run().evaluation_cutoff!){
      const train=independentTrainingRows(evaluationWindows(this.scored(actor).filter(r=>r.category===packet.category&&r.method===value.method_id),this.run().evaluation_cutoff!).train);
      const same=train.filter(r=>Math.min(9,Math.floor(r.probability*10))===Math.min(9,Math.floor(value.probability!*10)));
      if(same.length>=this.run().policy.minimumMethodEvents){const adjusted=calibrate(value.probability,train),interval=wilson(same.reduce((n,r)=>n+r.outcome,0),same.length);value={...value,probability:adjusted.probability,lower:Math.min(value.lower??0,interval.lower),upper:Math.max(value.upper??1,interval.upper)};this.repo.set('r4:calibration:'+actor,{at:now(),packet:packetId,training_events:new Set(same.map(r=>r.event)).size,cutoff:this.run().evaluation_cutoff,method:adjusted.method});}
    }
    this.repo.saveForecast(packetId,actor,'BEFORE',value);
    for(const query of value.search_requests)this.repo.enqueue('r4:search:'+await hash({category:packet.category,query,day:now().slice(0,10)}),'R4_SEARCH',{category:packet.category,query});
    if(actor===packet.category.toUpperCase()){
      const p=value.probability,b=packet.payload.baseline;
      const candidate=p!==null&&!value.essential_missing.length&&b&&Math.abs(p-b.probability)>.02&&(this.run().stage==='SHADOW'||this.methodQualified(packet.category,value.method_id));
      this.repo.run('UPDATE r4_packets SET status=? WHERE id=?',candidate?'CANDIDATE':'OBSERVING',packetId);
      if(candidate){const deadline=decisionDeadline(packet.payload.market,this.repo.state()!.betting_deadline!),next=nextSlots(now(),this.repo.state()!.betting_deadline,1,this.run().policy.meetingHours)[0];
        if(!next||deadline<Date.parse(next)){const existing=this.repo.one("SELECT id FROM jobs WHERE kind='R4_SLOT' AND status IN ('PENDING','RUNNING') AND json_extract(payload,'$.urgent')=1 LIMIT 1");if(!existing)this.repo.enqueue('r4:urgent:'+Math.floor(Date.now()/300000),'R4_SLOT',{slot:now(),urgent:true},new Date(Date.now()+45000).toISOString());}}
    }
  }
  scored(actor?:string,phase='BEFORE'):ScoredForecast[]{
    return this.repo.rows("SELECT p.id packet_id,p.market_id,p.event_id,p.category,f.actor,f.at,f.payload forecast,json_extract(p.payload,'$.baseline.probability') baseline,o.payload outcome,o.observed_at FROM r4_forecasts f JOIN r4_packets p ON p.id=f.packet_id JOIN r4_outcomes o ON o.market_id=p.market_id WHERE f.phase=?"+(actor?' AND f.actor=?':' AND f.actor=upper(p.category)')+' ORDER BY f.at,f.packet_id',...(actor?[phase,actor]:[phase])).flatMap(r=>{const f=JSON.parse(r.forecast),o=JSON.parse(r.outcome);if(f.probability===null||!['0','1'].includes(o.payouts.YES)||r.baseline===null||r.at>=o.resolved_at)return [];return [{packet:r.packet_id,event:r.event_id,market:r.market_id,category:r.category,method:f.method_id,at:r.at,resolved_at:r.observed_at,probability:f.probability,baseline:r.baseline,outcome:Number(o.payouts.YES) as 0|1}];});
  }
  qualification(){
    const run=this.run(),rows=this.scored(),test=evaluationWindows(rows,run.evaluation_cutoff||now()).test,cov=this.coverage();
    const methods=[...new Set(test.map(r=>r.category+':'+r.method))].map(key=>{const [category,method]=key.split(':'),rows=test.filter(r=>r.category===category&&r.method===method),result=score(rows);return {category,method,score:result,eligible:result.events>=run.policy.minimumMethodEvents&&result.improvement?.lower95!==null&&result.improvement?.lower95!==undefined&&result.improvement.lower95>0&&result.calibration_error!==null&&result.calibration_error<=run.policy.maximumCalibrationError};});
    const global=readiness(test,run.started_at,cov.fraction,run.policy);
    return {...global,eligible:global.eligible&&methods.some(m=>m.eligible)&&this.protocolCurrent(),reasons:[...global.reasons,...(!this.protocolCurrent()?['Code changé depuis les prévisions : nouvelle observation requise']:[])],methods,code_version:run.code_version,policy_hash:run.policy_hash,train_cutoff:run.evaluation_cutoff,scope:'Resolved, prospectively timestamped forecasts; held-out events only'};
  }
  coverage(){const run=this.run(),until=new Date(Math.min(Date.now(),Date.parse(this.repo.state()?.betting_deadline||run.end_at||now()))).toISOString();return {...coverage(run.started_at,until,this.repo.rows('SELECT bucket,category,status FROM r4_cycles'),CATEGORIES,run.policy.scanMinutes),research_until:until,note:'Coverage measured during the scheduled research window, excluding the planned final settlement margin.'};}
  watch(){
    const run=this.run(),today=now().slice(0,10),usage=this.repo.one('SELECT * FROM r4_usage WHERE day=?',today)||{reads:0,writes:0,requests:0},h=healthView(run.last_scan,run.status==='RUNNING'&&Date.now()<Date.parse(this.repo.state()!.betting_deadline!),usage,Date.now(),run.policy);
    this.repo.set('r4:health',h);if(h.stale){const key='r4:stale:'+Math.floor(Date.now()/1800000);this.repo.event(key,'INCIDENT','La recherche ne progresse plus au rythme attendu. Vérification du réveil et des sources requise.');this.notify(key,'Recherche en retard','Dernière recherche : '+(run.last_scan||'aucune'),4);}
  }
  async settle(){
    const ids=this.repo.rows("SELECT market_id FROM r4_packets WHERE status!='SETTLED' AND json_extract(payload,'$.market.event_end_at')<=? AND EXISTS(SELECT 1 FROM r4_forecasts f WHERE f.packet_id=r4_packets.id) GROUP BY market_id ORDER BY min(at) LIMIT 10",now());
    const cursor=this.repo.get<string>('r4:settlement_cursor')||'';
    const held=this.repo.rows("SELECT market_id FROM positions WHERE status='PENDING' ORDER BY created_at LIMIT 12").map(x=>x.market_id);
    const remaining=this.repo.rows("SELECT DISTINCT market_id FROM r4_packets WHERE status!='SETTLED' AND market_id>? AND json_extract(payload,'$.market.event_end_at')<=? AND EXISTS(SELECT 1 FROM r4_forecasts f WHERE f.packet_id=r4_packets.id) ORDER BY market_id LIMIT 8",cursor,now()).map(x=>x.market_id);
    const selected=[...new Set([...held,...remaining,...(!remaining.length?ids.map(x=>x.market_id):[])])];
    for(const id of selected){try{const m=await this.markets.inspect(id,false);this.repo.run('DELETE FROM meta WHERE key=?','r4:settlement_error:'+id);if(!m.resolved||!m.payouts)continue;
      const prior=this.repo.one('SELECT market_id FROM r4_outcomes WHERE market_id=?',id);
      const known=now(),resolved=m.resolution_evidence?.resolved_at||known;
      this.repo.run('INSERT OR IGNORE INTO r4_outcomes VALUES(?,?,?,?,?)',id,m.group,known,resolved,JSON.stringify({question:m.question,category:m.category,payouts:m.payouts,resolved_at:resolved,evidence:m.resolution_evidence}));
      if(!prior)this.repo.run("DELETE FROM transient_cache WHERE key IN ('r4:comparisons','r4:evaluation','r4:summary')");
      for(const p of this.repo.rows("SELECT * FROM positions WHERE market_id=? AND status='PENDING'",id))this.repo.settle(p,m);
      this.repo.run("UPDATE r4_packets SET status='SETTLED' WHERE market_id=?",id);
      this.repo.event('r4:outcome:'+id,'SETTLEMENT','Résultat officiel disponible pour « '+m.question+' ». La prévision initiale et sa pertinence restent évaluées séparément.','SECRETARY',null,{market_id:id,payouts:m.payouts});
    }catch(e){const key='r4:settlement_error:'+id,old=this.repo.get<any>(key),attempts=(old?.attempts||0)+1;this.repo.set(key,{at:now(),first_at:old?.first_at||now(),attempts,error:String(e)});if(attempts>=3)this.notify('r4:settlement-error:'+id+':'+now().slice(0,10),'Règlement impossible à vérifier','Le fournisseur de résultats ne répond pas correctement pour le marché '+id+'. Aucun paiement inventé.',4);}}
    this.repo.set('r4:settlement_cursor',remaining.at(-1)||'');const s=this.repo.state()!;s.last_cycle=now();this.repo.save(s);this.tick();
  }
  async slot(slot:string,urgent=false){
    if(this.run().status!=='RUNNING')return;
    if(this.repo.one("SELECT id FROM r4_agendas WHERE status='RUNNING' LIMIT 1"))throw Error('R4_MEETING_BUSY');
    if(!urgent&&Date.now()-Date.parse(slot)>300000){this.repo.event('r4:missed:'+slot,'SLOT_MISSED','Créneau ordinaire manqué : une réunion retardée n’est pas présentée comme ponctuelle.','SECRETARY',null,{slot});return;}
    const list=this.repo.rows("SELECT * FROM r4_packets WHERE status='CANDIDATE' AND json_extract(payload,'$.market.event_end_at')>? ORDER BY at",now()).map(r=>({...r,payload:JSON.parse(r.payload)}));
    const agenda:any[]=[],used=new Set();for(const p of list){if(used.has(p.category))continue;const retry=this.repo.get<any>('r4:deferred:'+p.id);if(retry&&retry.policy_hash===this.run().policy_hash&&retry.facts===p.payload.facts)continue;agenda.push(p.id);used.add(p.category);if(agenda.length===3)break;}
    const id='r4:meeting:'+slot;
    if(!agenda.length){this.repo.run('INSERT OR IGNORE INTO r4_agendas VALUES(?,?,?,?,?)',id,slot,'NO_AGENDA',now(),JSON.stringify({summary:'Aucun dossier suffisamment étayé ; aucune discussion artificielle.',coverage:Object.fromEntries(CATEGORIES.map(c=>[c,this.repo.get('r4:scan:'+c)]))}));this.repo.event(id+':bulletin','BULLETIN','Bilan sans réunion : aucun dossier prêt. Les raisons et prochaines recherches sont consultables.');return;}
    this.repo.run('INSERT OR IGNORE INTO r4_agendas VALUES(?,?,?,?,?)',id,slot,'RUNNING',now(),JSON.stringify({agenda,index:0,stage:'INDEPENDENT',deadline:new Date(Date.now()+this.run().policy.maximumMeetingSeconds*1000).toISOString(),urgent,proposal:null,discussion:[],missing:[],votes:[],revised:[]}));
    for(const pid of agenda)this.repo.run("UPDATE r4_packets SET status='IN_MEETING' WHERE id=?",pid);
    this.repo.event(id+':start','MEETING_START',`Le conseil examine ${agenda.length} dossier(s). Les prévisions initiales des membres seront enregistrées avant la révélation des prix et des avis.`, 'SECRETARY',id,{agenda,slot,late_seconds:(Date.now()-Date.parse(slot))/1000});this.notify(id+':start',urgent?'Conseil extraordinaire':'Conseil ordinaire','Le conseil commence.');this.nextMeeting(id,'INDEPENDENT',0);
  }
  nextMeeting(id:string,stage:string,index:number,delay=0){this.repo.enqueue(id+':'+index+':'+stage,'R4_MEETING',{id},new Date(Date.now()+delay).toISOString());}
  meetingRow(id:string){const row=this.repo.one('SELECT * FROM r4_agendas WHERE id=?',id);return row?{...row,payload:JSON.parse(row.payload)}:null;}
  saveMeeting(row:any){this.repo.run('UPDATE r4_agendas SET status=?,payload=? WHERE id=?',row.status,JSON.stringify(row.payload),row.id);}
  endMeeting(row:any,status:string,reason:string){
    row.status=status;row.payload.finished_at=now();row.payload.summary=reason;this.saveMeeting(row);
    for(const id of row.payload.agenda){const p=this.repo.packet(id);if(p?.status==='IN_MEETING'){this.repo.run("UPDATE r4_packets SET status='DEFERRED' WHERE id=?",id);this.repo.set('r4:deferred:'+id,{at:now(),facts:p.payload.facts,policy_hash:this.run().policy_hash,reason});}}
    this.repo.event(row.id+':end','MEETING_END',reason,'SECRETARY',row.id,{status});this.notify(row.id+':end',status==='COMPLETED'?'Conseil terminé':'Incident au conseil',reason,status==='COMPLETED'?3:4);
  }
  nextDossier(row:any){
    row.payload.index++;row.payload.stage='INDEPENDENT';row.payload.proposal=null;row.payload.discussion=[];row.payload.votes=[];row.payload.missing=[];row.payload.retried=false;
    if(row.payload.index>=row.payload.agenda.length)return this.endMeeting(row,'COMPLETED','Les dossiers ont été examinés. Les prévisions, objections et votes sont archivés.');
    this.saveMeeting(row);this.nextMeeting(row.id,'INDEPENDENT',row.payload.index);
  }
  discussionContext(packet:any,meeting:any){
    const p=packet.payload,m=p.market as Market;
    return {protocol:'reform-v4',mode:this.run().stage,market:{...m,books:undefined},executable_books:m.books,proposal:meeting.payload.proposal,
      secretary_results:meeting.payload.secretary_results||[],sources:p.sources,data_quality:p.quality,observations:this.observationSummary(p.metar),
      independent_forecasts:panel(m.category).map(actor=>({actor,...this.repo.forecast(packet.id,actor)})),
      baseline:p.baseline,cash:this.repo.cash(),initial_eur:this.repo.state()!.initial_eur,fx:this.repo.state()!.fx,
      hypothetical_reference_eur:this.run().stage==='SHADOW'?'10':null,
      instruction:this.run().stage==='SHADOW'?'Observation sans mise : le montant de référence de 10 EUR sert seulement à évaluer le dossier et les occasions refusées. Aucun achat ni débit réel du fonds fictif. Évalue le dossier, pas la capacité d’un cash d’observation nul.':'Fonds de paper trading : respecte la réserve et l’enveloppe chiffrée du protocole. Un achat reste soumis au vote et à un contrôle final.',
      anomaly:p.analysis?.probability!==null&&p.baseline?anomaly(p.analysis.probability,p.baseline.probability,{lower:p.analysis.lower,upper:p.analysis.upper}):null,
      positions:this.repo.rows('SELECT * FROM positions').map(x=>({...x,payload:JSON.parse(x.payload)})),memory:this.repo.memory(m.group,m.category),
      history:this.repo.events(0,meeting.id,100).filter(e=>['SPEECH','QUESTION','AMENDMENT'].includes(e.kind)).slice(-8),policy:this.run().policy};
  }
  methodQualified(category:Category,method:string){
    const qualification=this.run().qualification;
    const recent=score(this.scored().filter(r=>r.category===category&&r.method===method).slice(-30));
    if(recent.events>=10&&recent.improvement?.upper95!==null&&recent.improvement?.upper95!==undefined&&recent.improvement.upper95<0)return false;
    return !!qualification?.eligible&&!!qualification?.methods?.some((x:any)=>x.category===category&&x.method===method&&x.eligible);
  }
  budget(packet:any,side:'YES'|'NO'){
    const run=this.run(),state=this.repo.state()!,m=packet.payload.market as Market,f=this.repo.forecast(packet.id,packet.category.toUpperCase()),book=m.books[side];
    if(!book?.asks[0]||f?.probability===null||!f)return {maximum:'0',reason:'Probabilité ou cotation indisponible'};
    const price=D(book.asks[0].price),fee=D(book.fee_rate).mul(price.mul(D(1).minus(price)).pow(book.fee_exponent));
    const spent=this.repo.rows("SELECT cost FROM positions WHERE status='PENDING'").reduce((n,x)=>n.plus(x.cost),D(0)),cluster=this.repo.rows("SELECT cost FROM positions WHERE status='PENDING' AND json_extract(payload,'$.event_group')=?",m.group).reduce((n,x)=>n.plus(x.cost),D(0));
    return allowance({initial:D(state.initial_eur).mul(state.fx!.usd_per_eur).toFixed(),cash:this.repo.cash(),spent:spent.toFixed(),clusterCost:cluster.toFixed(),elapsedFraction:(Date.now()-Date.parse(run.started_at!))/(run.policy.durationHours*3600000),probability:side==='YES'?f.probability:1-f.probability,lower:side==='YES'?f.lower:1-f.upper,price:price.toFixed(),feePerShare:fee.toFixed(),methodQualified:this.methodQualified(m.category,f.method_id)},run.policy);
  }
  observationSummary(metar:any){if(!metar)return null;const {rows,...summary}=metar;if(!rows)return summary;const extreme=rows.find((r:any)=>r.value===metar.extreme);return {...summary,report_count:rows.length,relevant_reports:[...new Map([rows.at(-1),extreme].filter(Boolean).map((r:any)=>[r.at,r])).values()]};}
  rememberAfter(packet:any,actor:MemberId,value:any,key:string){
    const before=this.repo.forecast(packet.id,actor);if(!before||value.estimated_yes_probability==null)return;
    this.repo.saveForecast(packet.id,actor,'REVISION:'+key,{...before,probability:value.estimated_yes_probability,lower:Math.min(before.lower??0,value.estimated_yes_probability),upper:Math.max(before.upper??1,value.estimated_yes_probability),rationale:value.speech});
  }
  verifyCitations(value:any,packet:any){for(const c of value.citations||[]){const source=packet.payload.sources.find((s:Source)=>s.id===c.source_id&&s.status==='VERIFIED');const norm=(x:string)=>x.replace(/\s+/g,' ').trim();if(!source||!norm(source.text).includes(norm(c.quote)))throw Error('UNVERIFIED_CITATION');}}
  speech(key:string,meeting:any,actor:MemberId,value:any,packet:any){
    this.verifyCitations(value,packet);
    for(const request of value.document_requests||[]){const history=/histor|passé|résultat|erreur|succès|leçon/i.test(request),documents=history?this.repo.memory(packet.event_id,packet.category):this.repo.searchDocuments({event:packet.event_id,station:packet.payload.metar?.rules?.station,day:packet.payload.metar?.rules?.day});meeting.payload.secretary_results=documents;this.repo.event(key+':documents:'+request,'DOCUMENT',documents.length?'Le secrétaire retrouve '+documents.length+' document(s) ciblé(s) pour « '+request+' ».':'Aucun document vérifié ne répond à « '+request+' ».','SECRETARY',meeting.id,{request,documents});}
    this.repo.event(key,'SPEECH',value.speech,actor,meeting.id,{...value,market_id:packet.market_id,packet_id:packet.id});this.rememberAfter(packet,actor,value,key);
  }
  async askSpeech(key:string,actor:MemberId,phase:string,context:any,schema:any,meeting:string,packet:any):Promise<any>{
    let value:any=await this.azure.ask(key,actor,phase,context,schema,meeting);
    try{this.verifyCitations(value,packet);}catch{value=await this.azure.ask(key+':citation-repair',actor,phase,{...context,instruction:'Corrige uniquement les citations : identifiant réel et extrait littéral du document. Si aucun extrait ne soutient une affirmation, retire cette affirmation. Aucun nouveau fait.'},schema,meeting);this.verifyCitations(value,packet);}
    return value;
  }
  async meeting(id:string){
    const row=this.meetingRow(id);if(!row||row.status!=='RUNNING')return;
    if(this.run().status!=='RUNNING'||Date.now()>=Date.parse(this.repo.state()!.betting_deadline!))return this.endMeeting(row,'CANCELLED','Fenêtre de décision terminée : aucun nouvel avis ni achat.');
    const payload=row.payload,packet=this.repo.packet(payload.agenda[payload.index]);
    if(!packet||Date.now()>Date.parse(payload.deadline))return this.endMeeting(row,'CANCELLED','Réunion interrompue : dossier indisponible ou durée maximale dépassée.');
    const actors=panel(packet.category),m=packet.payload.market as Market,phase=payload.stage;
    if(Date.now()>=Date.parse(m.event_end_at)){
      this.repo.run("UPDATE r4_packets SET status='EXPIRED' WHERE id=?",packet.id);this.repo.event(id+':expired:'+packet.id,'PROPOSAL_EXPIRED','Le dossier a dépassé son échéance. Aucun achat ne sera exécuté.','SECRETARY',id);return this.nextDossier(row);
    }
    if(phase==='INDEPENDENT'||phase==='INDEPENDENT_RETRY'){
      const missing=actors.filter(actor=>!this.repo.forecast(packet.id,actor));
      const results=await Promise.allSettled(missing.map(actor=>this.forecast(packet.id,actor)));
      payload.missing=actors.filter(actor=>!this.repo.forecast(packet.id,actor));
      if(payload.missing.length&&phase!=='INDEPENDENT_RETRY'){
        payload.stage='INDEPENDENT_RETRY';this.saveMeeting(row);this.notify(id+':pause:'+packet.id,'Conseil suspendu','Un membre est temporairement indisponible. Nouvelle tentative avant décision.',4);this.nextMeeting(id,payload.stage,payload.index,30000);return;
      }
      if(payload.missing.includes('CHAIR')||payload.missing.length>=2)return this.endMeeting(row,'CANCELLED','Président absent ou plusieurs membres indisponibles.');
      // Only now are prices and initial opinions revealed to the permanent members.
      const f=this.repo.forecast(packet.id,packet.category.toUpperCase());if(!f||f.probability===null||f.essential_missing.length){this.repo.run("UPDATE r4_packets SET status='OBSERVING' WHERE id=?",packet.id);return this.nextDossier(row);}
      const prices=(['YES','NO'] as const).flatMap(side=>{const b=m.books[side];if(!b?.asks.length)return [];const px=D(b.asks[0].price),fee=D(b.fee_rate).mul(px.mul(D(1).minus(px)).pow(b.fee_exponent));return [{side,price:px,edge:D(side==='YES'?f.probability:1-f.probability).minus(px).minus(fee)}];}).sort((a,b)=>b.edge.cmp(a.edge));
      if(!prices.length){this.repo.run("UPDATE r4_packets SET status='DATA_PENDING' WHERE id=?",packet.id);return this.nextDossier(row);}
      const choice=prices[0],amount=this.run().stage==='SHADOW'?D(10).mul(this.repo.state()!.fx!.usd_per_eur).toFixed():this.budget(packet,choice.side).maximum;
      payload.proposal={id:id+':'+packet.market_id,meeting_id:id,market_id:packet.market_id,version:1,side:choice.side,amount,max_price:choice.price.toFixed(),status:'DISCUSSING',reason:f.rationale,created_at:now(),estimated_yes_probability:f.probability};
      this.repo.putProposal(payload.proposal);payload.stage='DISCUSS';
      packet.payload.analysis=f;this.repo.run('UPDATE r4_packets SET payload=? WHERE id=?',JSON.stringify(packet.payload),packet.id);
      this.repo.event(id+':reveal:'+packet.id,'FORECAST_REVEAL','Les prévisions initiales indépendantes sont maintenant révélées avec les prix.','SECRETARY',id,{forecasts:actors.map(actor=>({actor,...this.repo.forecast(packet.id,actor)})),baseline:packet.payload.baseline});
    }else if(phase==='DISCUSS'){
      const context=this.discussionContext(packet,row),independents=(['QUANT','RISK','CONTRA'] as MemberId[]).filter(a=>!payload.missing.includes(a));
      const results=await Promise.allSettled(independents.map(async actor=>{const value=await this.askSpeech(`${id}:${packet.id}:discuss:${actor}`,actor,'contradictory_discussion',context,SpeechSchema,id,packet);this.speech(`${id}:${packet.id}:speech:${actor}`,row,actor,value,packet);return {actor,value};}));
      payload.discussion=[];results.forEach((r,i)=>{if(r.status==='fulfilled')payload.discussion.push(r.value);else if(!payload.missing.includes(independents[i]))payload.missing.push(independents[i]);});
      if(payload.missing.length>=2)return this.endMeeting(row,'CANCELLED','Au moins deux membres n’ont pas pu participer au débat.');
      payload.stage='CHAIR';
    }else if(phase==='CHAIR'){
      const v=await this.askSpeech(`${id}:${packet.id}:chair`,'CHAIR','chair_resolution',{...this.discussionContext(packet,row),discussion:payload.discussion,instruction:'Explique les objections non résolues. Corrige une proposition seulement si nécessaire ; une hypothèse fragile peut justifier le refus. Pose une question décisive si utile.'},ChairSchema,id,packet);
      this.speech(`${id}:${packet.id}:chair:speech`,row,'CHAIR',v,packet);
      if(v.amendment)this.amend(row,packet,v.amendment,'CHAIR');
      payload.proposal.estimated_yes_probability=v.estimated_yes_probability;this.repo.putProposal(payload.proposal);
      if(v.question&&actors.includes(v.question_to as MemberId)){payload.question=v.question;payload.question_to=v.question_to;payload.stage='REBUT';this.repo.event(id+':question:'+packet.id,'QUESTION',v.question,'CHAIR',id,{to:v.question_to});}else payload.stage='VOTE';
    }else if(phase==='REBUT'){
      const actor=payload.question_to as MemberId;
      try{const v=await this.askSpeech(`${id}:${packet.id}:rebut`,actor,'answer_objection',{...this.discussionContext(packet,row),question:payload.question},SpeechSchema,id,packet);this.speech(id+':rebut:'+packet.id,row,actor,v,packet);if(v.amendment)this.amend(row,packet,v.amendment,actor);}catch{if(!payload.missing.includes(actor))payload.missing.push(actor);}
      payload.stage='VOTE';
    }else if(['VOTE','VOTE_RETRY','ABSTENTION'].includes(phase)){
      for(const actor of actors){const revision=this.repo.one("SELECT payload FROM r4_forecasts WHERE packet_id=? AND actor=? AND phase LIKE 'REVISION:%' ORDER BY at DESC,rowid DESC LIMIT 1",packet.id,actor),value=revision?JSON.parse(revision.payload):this.repo.forecast(packet.id,actor);if(value)this.repo.saveForecast(packet.id,actor,'AFTER',value);}
      const proposal=payload.proposal as Proposal,round=phase==='ABSTENTION'?2:1;
      const existing=this.repo.rows('SELECT * FROM votes WHERE proposal_id=? AND version=?',proposal.id,proposal.version).map(x=>({...JSON.parse(x.payload),round:x.round}));
      const voters=phase==='ABSTENTION'?existing.filter(v=>v.vote==='ABSTAIN').map(v=>v.member_id):actors.filter(a=>!existing.some(v=>v.member_id===a)&&(phase==='VOTE_RETRY'||!payload.missing.includes(a)));
      await Promise.allSettled(voters.map(async(actor:MemberId)=>{try{const v=await this.azure.ask(`${id}:${packet.id}:v${proposal.version}:vote:${round}:${phase==='VOTE_RETRY'?'recovery:':''}${actor}`,actor,phase==='ABSTENTION'?'abstention_reconsideration':'independent_vote',this.discussionContext(packet,row),VoteSchema,id);
        if(v.proposal_id!==proposal.id||v.proposal_version!==proposal.version)throw Error('VOTE_WRONG_PROPOSAL');
        if(v.vote==='ABSTAIN'&&(v.abstention_reason.length<25||v.reconsider_if.length<15))throw Error('UNJUSTIFIED_ABSTENTION');
        this.repo.run('INSERT OR IGNORE INTO votes VALUES(?,?,?,?,?)',proposal.id,proposal.version,round,actor,JSON.stringify({...v,member_id:actor}));payload.missing=payload.missing.filter((x:string)=>x!==actor);
      }catch{if(!payload.missing.includes(actor))payload.missing.push(actor);}}));
      const votes=this.repo.rows('SELECT * FROM votes WHERE proposal_id=? AND version=? ORDER BY round',proposal.id,proposal.version).map(x=>JSON.parse(x.payload));const latest=[...new Map(votes.map(v=>[v.member_id,v])).values()];payload.votes=latest;
      const absent=actors.filter(actor=>!latest.some(v=>v.member_id===actor));
      if(absent.length&&phase==='VOTE'&&Date.now()+120000<Date.parse(payload.deadline)){payload.stage='VOTE_RETRY';this.saveMeeting(row);this.notify(id+':vote-pause:'+packet.id,'Conseil suspendu','Une tentative de rétablissement précède la décision sur les membres disponibles.',4);this.nextMeeting(id,payload.stage,payload.index,30000);return;}
      const result=tally(actors,latest,proposal,phase==='ABSTENTION');payload.tally=result;
      this.repo.event(`${id}:${packet.id}:v${proposal.version}:votes:${round}`,'VOTES','Les votes individuels sur la proposition exacte sont révélés.','SECRETARY',id,{proposal,votes:latest,tally:result});
      if(result.decision==='REVIEW_ABSTENTION')payload.stage='ABSTENTION';
      else if(result.decision==='TIE')payload.stage='ARBITRATE';
      else if(result.decision==='APPROVE'){payload.stage='EXECUTE';proposal.status='APPROVED';this.repo.putProposal(proposal);}
      else return this.reject(row,packet,result.reason,result.decision);
    }else if(phase==='ARBITRATE'){
      const p=payload.proposal as Proposal,v=await this.azure.ask(`${id}:${packet.id}:arbitrate`,'CHAIR','tie_arbitration',{...this.discussionContext(packet,row),votes:payload.votes,instruction:'Prends du recul. Tu peux APPROVE, REJECT ou CANCEL malgré ton vote initial.'},ArbitrationSchema,id);
      if(v.proposal_id!==p.id||v.proposal_version!==p.version)throw Error('ARBITRATION_WRONG_PROPOSAL');
      const decision=arbitrate(payload.tally,v.decision,true);this.repo.event(id+':arbitrate:'+packet.id,'ARBITRATION',v.speech,'CHAIR',id,{decision});
      if(decision==='APPROVE'){p.status='APPROVED_BY_ARBITRATION';this.repo.putProposal(p);payload.stage='EXECUTE';}else return this.reject(row,packet,v.speech,decision);
    }else if(phase==='EXECUTE'||phase==='MATCH_DELAY'){
      const p=payload.proposal as Proposal,positionId=p.id+':v'+p.version;
      if(this.repo.one('SELECT id FROM positions WHERE id=?',positionId)){this.repo.run("UPDATE r4_packets SET status='INVESTED' WHERE id=?",packet.id);return this.nextDossier(row);}
      const fresh=await this.markets.inspect(p.market_id),{sources,metar:currentMetar}=await this.collectEvidence(fresh);
      const latestFacts=await this.factSignature(sources,currentMetar);
      if(latestFacts!==packet.payload.facts){this.repo.enqueue('r4:fresh-reforecast:'+packet.id,'R4_PREPARE',{id:p.market_id,category:packet.category});return this.reject(row,packet,'Les faits ont changé depuis les prévisions indépendantes : nouveau dossier requis avant toute mise.','FACTS_CHANGED');}
      const q=quality(fresh,sources,currentMetar,Date.now(),this.run().policy);if(!q.ready)return this.reject(row,packet,'Information essentielle actuelle manquante : '+q.essential_missing.join('; '),'DATA_PENDING');
      if(p.side==='YES'&&currentMetar?.yes_impossible)return this.reject(row,packet,'Observation routine : cette tranche est déjà mathématiquement exclue.','TECHNICAL_REJECTION');
      if(fresh.delay_seconds>0&&phase!=='MATCH_DELAY'){payload.stage='MATCH_DELAY';this.saveMeeting(row);this.nextMeeting(id,payload.stage,payload.index,fresh.delay_seconds*1000);return;}
      const fx=this.repo.state()!.fx!.usd_per_eur;
      if(this.run().stage!=='SHADOW'){
        const max=this.budget({...packet,payload:{...packet.payload,market:fresh}},p.side);if(D(p.amount).gt(max.maximum))return this.reject(row,packet,max.reason+' ; montant supérieur à l’enveloppe '+max.maximum,'ALLOCATION_REJECTION');
      }
      const check=technicalCheck(p,fresh,this.run().stage==='SHADOW'?p.amount:this.repo.cash(),this.repo.state()!.betting_deadline!,now(),!!this.repo.one('SELECT id FROM positions WHERE market_id=?',fresh.id));
      if(check)return this.reject(row,packet,check,'TECHNICAL_REJECTION');
      const ex=execute(fresh.books[p.side]!,p.amount,p.max_price,now(),this.run().stage==='SHADOW'?{}:this.repo.consumed(fresh.assets[p.side],fresh.books[p.side]!.evidence));
      if(!ex.fills.length)return this.reject(row,packet,ex.reason,'NON_EXECUTABLE');
      if(this.run().stage==='SHADOW'){
        this.repo.run('INSERT OR IGNORE INTO r4_assessments VALUES(?,?,?,?)',id+':'+packet.id+':hypothetical',now(),packet.id,JSON.stringify({kind:'SHADOW_APPROVAL',proposal:p,execution:ex,reference_eur:'10',factual_reason:p.reason,portfolio_impact:false,book:fresh.books[p.side]}));
        this.repo.event(id+':shadow:'+packet.id,'SHADOW_DECISION','Dossier approuvé en observation : simulation immédiate au carnet archivée, aucune mise débitée.','SECRETARY',id,{proposal:p,execution:ex});
        this.repo.run("UPDATE r4_packets SET status='REVIEWED' WHERE id=?",packet.id);
      }else{this.repo.putMarket(fresh);this.repo.buy(p,fresh,ex,p.reason);this.repo.run("UPDATE r4_packets SET status='INVESTED' WHERE id=?",packet.id);}
      return this.nextDossier(row);
    }
    this.saveMeeting(row);this.nextMeeting(id,payload.stage,payload.index);
  }
  amend(row:any,packet:any,a:any,actor:MemberId){
    const before=row.payload.proposal as Proposal;
    // A new market requires a separate blind forecast and a new agenda; never reuse old probabilities.
    if(a.market_id!==before.market_id){this.repo.enqueue('r4:amend-search:'+a.market_id,'R4_PREPARE',{id:a.market_id,category:packet.category});this.repo.event(row.id+':amend-deferred:'+packet.id,'AMENDMENT_DEFERRED','Le changement de marché nécessite une prévision indépendante et un nouveau dossier.',actor,row.id,{requested:a.market_id});return;}
    if(D(a.amount).lte(0)||D(a.max_price).lte(0)||D(a.max_price).gte(1))throw Error('INVALID_AMENDMENT');
    if(a.side===before.side&&D(a.amount).eq(before.amount)&&D(a.max_price).eq(before.max_price))return;
    before.status='SUPERSEDED';this.repo.putProposal(before);const after={...before,version:before.version+1,side:a.side,amount:a.amount,max_price:a.max_price,reason:a.reason,status:'DISCUSSING'};row.payload.proposal=after;this.repo.putProposal(after);
    this.repo.event(`${row.id}:${packet.id}:amend:${after.version}`,'AMENDMENT',a.reason,actor,row.id,{before,after,votes_invalidated:true});
  }
  async reject(row:any,packet:any,reason:string,status:string){
    const p=row.payload.proposal as Proposal;if(p){p.status=status;this.repo.putProposal(p);}
    let execution:any=null,book:any=null,failure:string|null=null;
    if(p)try{const m=await this.markets.inspect(p.market_id);book=m.books[p.side];if(m.delay_seconds>0)failure='MATCHING_DELAY_NOT_OBSERVED';else if(book)execution=execute(book,D(10).mul(this.repo.state()!.fx!.usd_per_eur).toFixed(),p.max_price,now());else failure='NO_OBSERVABLE_BOOK';}catch{failure='PROVIDER_UNAVAILABLE';}
    this.repo.run('INSERT OR IGNORE INTO r4_assessments VALUES(?,?,?,?)',row.id+':'+packet.id+':rejection',now(),packet.id,JSON.stringify({kind:'REJECTION',proposal:p,reason,ex_ante_review:reason,portfolio_impact:false,observed_book:book,execution,failure,reference_eur:'10'}));
    this.repo.run("UPDATE r4_packets SET status='REVIEWED' WHERE id=?",packet.id);this.repo.event(row.id+':decision:'+packet.id,'DECISION',reason,'SECRETARY',row.id,{status,proposal:p});return this.nextDossier(row);
  }
  comparisons(){
    const cached=this.repo.cache<any>('r4:comparisons');if(cached)return cached;
    const paired=this.repo.rows("SELECT p.market_id market,p.event_id event,b.actor,json_extract(b.payload,'$.probability') before,json_extract(a.payload,'$.probability') after,json_extract(o.payload,'$.payouts.YES') outcome,json_extract(p.payload,'$.baseline.probability') baseline FROM r4_outcomes o JOIN r4_packets p ON p.market_id=o.market_id JOIN r4_forecasts b ON b.packet_id=p.id AND b.phase='BEFORE' JOIN r4_forecasts a ON a.packet_id=b.packet_id AND a.actor=b.actor AND a.phase='AFTER' WHERE json_extract(b.payload,'$.probability') IS NOT NULL AND json_extract(a.payload,'$.probability') IS NOT NULL AND json_extract(o.payload,'$.payouts.YES') IN ('0','1') AND b.at<json_extract(o.payload,'$.resolved_at') AND a.at<json_extract(o.payload,'$.resolved_at')").map(r=>({...r,outcome:Number(r.outcome)}));
    const assessments=this.repo.rows("SELECT a.at,a.payload,json_extract(p.payload,'$.market.question') question,p.market_id,p.event_id,o.payload outcome FROM r4_assessments a JOIN r4_packets p ON p.id=a.packet_id LEFT JOIN r4_outcomes o ON o.market_id=p.market_id ORDER BY a.at").map(r=>{
      const a=JSON.parse(r.payload),o=r.outcome?JSON.parse(r.outcome):null,ex=a.execution,side=a.proposal?.side;
      const payout=o&&side&&ex?D(ex.quantity).mul(o.payouts[side]):null;
      return {market:r.market_id,event:r.event_id,at:r.at,question:r.question,kind:a.kind,reason:a.reason||a.factual_reason,ex_ante_review:a.ex_ante_review||a.factual_reason,executable:!!ex?.fills?.length,cost:ex?ex.spent:null,payout:payout===null?null:payout.toFixed(),profit:payout===null||!ex?null:payout.minus(ex.spent).toFixed(),failure:a.failure||null};
    });
    const feasible=assessments.filter(r=>r.kind==='REJECTION'&&r.executable&&r.payout!==null&&r.cost!==null) as any[];
    const value={paired:pairedAblation(paired),counterfactuals:assessments.slice(-40),feasible_refusals:fairMissedOpportunities(feasible,D(1000).mul(this.repo.state()?.fx?.usd_per_eur||1).toNumber()),cash_benchmark_profit:0,limitations:'Paired before/after measures association, not causal benefit of a role. Counterfactual fills require archived executable books. Costs and payouts are in quote units.'};this.repo.putCache('r4:comparisons',value,86400);return value;
  }
  summary(){
    const run=this.run(),s=this.repo.state()!,fx=s.fx?.usd_per_eur||'1',positions=this.repo.rows('SELECT * FROM positions ORDER BY created_at DESC').map(x=>({...x,payload:JSON.parse(x.payload)}));
    let calls=this.repo.cache<any[]>('r4:call_metrics');if(!calls){calls=this.repo.rows("SELECT actor,meeting_id,status,input_tokens,output_tokens,cached_tokens,estimated_eur FROM calls WHERE id NOT LIKE '%:result'");this.repo.putCache('r4:call_metrics',calls,600);}
    let evaluation=this.repo.cache<any>('r4:evaluation');if(!evaluation){evaluation={score:score(this.scored()),chair:score(this.scored('CHAIR','AFTER')),qualification:this.qualification(),at:now()};this.repo.putCache('r4:evaluation',evaluation,600);}const initialScore=evaluation.score,chair=evaluation.chair;
    const meetings=this.repo.rows('SELECT * FROM r4_agendas ORDER BY at DESC LIMIT 40').map(x=>({...x,payload:JSON.parse(x.payload)}));
    const expected=run.started_at?nextSlots(run.started_at,run.end_at,100,run.policy.meetingHours).filter(t=>Date.parse(t)<=Date.now()):[],ordinary=this.repo.rows("SELECT slot,status,payload,at FROM r4_agendas WHERE json_extract(payload,'$.urgent') IS NOT 1");
    const onTime=ordinary.filter(m=>m.status==='COMPLETED'&&Date.parse(m.at)-Date.parse(m.slot)<=300000&&Date.parse(m.at)>=Date.parse(m.slot)).length;
    const cash=this.repo.cash(),committed=positions.filter(x=>x.status==='PENDING').reduce((n,x)=>n.plus(x.cost),D(0));
    const total=(field:string)=>calls.reduce((n,c)=>n+Number(c[field]||0),0);
    const cost=calls.reduce((n,c)=>{if(c.estimated_eur){const x=JSON.parse(c.estimated_eur);n.min+=Number(x.min);n.max+=Number(x.max);}return n;},{min:0,max:0});
    const late=positions.filter(x=>x.status==='PENDING').map(x=>({market_id:x.market_id,question:x.payload.question,event_end_at:x.payload.end_at,age_hours:Math.max(0,(Date.now()-Date.parse(x.payload.end_at))/3600000)}));
    return {run,active_code_version:this.activeCode(),protocol_current:this.protocolCurrent(),preflight:Object.fromEntries(CATEGORIES.map(c=>[c,this.repo.get('r4:preflight:'+c)])),legacy_lessons:this.repo.get('r4:legacy_lessons'),comparisons:this.comparisons(),members:MEMBERS,mode:run.stage,display_status:run.status==='READY'?'Protocole prêt, lancement explicite requis':run.stage==='SHADOW'?'Prévisions en observation, aucune mise':'Fonds fictif '+run.stage,
      cash_eur:D(cash).div(fx).toFixed(),committed_at_cost_eur:committed.div(fx).toFixed(),profit_eur:positions.filter(x=>x.status==='SETTLED').reduce((n,x)=>n.plus(x.payload.profit),D(0)).div(fx).toFixed(),positions,pending_resolutions:late,settlement_errors:this.repo.rows("SELECT key,value FROM meta WHERE key LIKE 'r4:settlement_error:%'").map(r=>({market_id:r.key.slice('r4:settlement_error:'.length),...JSON.parse(r.value)})),
      score:initialScore,chair_score:chair,qualification:evaluation.qualification,evaluation_at:evaluation.at,coverage:this.coverage(),health:this.repo.get('r4:health'),scans:Object.fromEntries(CATEGORIES.map(c=>[c,this.repo.get('r4:scan:'+c)])),
      meetings,meeting_metrics:{expected:expected.length,completed:ordinary.filter(m=>m.status==='COMPLETED').length,bilans:ordinary.filter(m=>m.status==='NO_AGENDA').length,on_time:onTime,missing:expected.filter(t=>!ordinary.some(m=>m.slot===t))},
      packets:this.repo.rows('SELECT id,market_id,category,event_id,at,status,payload FROM r4_packets ORDER BY at DESC LIMIT 60').map(x=>{const p=JSON.parse(x.payload);return {id:x.id,market_id:x.market_id,category:x.category,event:x.event_id,at:x.at,status:x.status,question:p.market.question,url:p.market.url,quality:p.quality,baseline:p.baseline,observations:p.metar,sources:p.sources.map((s:Source)=>({id:s.id,title:s.title,url:s.url,provider:s.provider,status:s.status,fetched_at:s.fetched_at})),forecast:this.repo.forecast(x.id,x.category.toUpperCase())};}),
      memory:this.repo.rows('SELECT * FROM r4_outcomes ORDER BY observed_at DESC LIMIT 30').map(x=>({...x,payload:JSON.parse(x.payload)})),
      azure:{requests:calls.length,input_tokens:total('input_tokens'),output_tokens:total('output_tokens'),cached_tokens:total('cached_tokens'),unknown:calls.filter(c=>c.status==='UNKNOWN').length,estimated_eur_min:cost.min,estimated_eur_max:cost.max,invoice:false,by_actor:MEMBERS.map(m=>({actor:m.id,requests:calls.filter(c=>c.actor===m.id).length})),by_meeting:[...new Set(calls.map(c=>c.meeting_id).filter(Boolean))].map(id=>({meeting_id:id,requests:calls.filter(c=>c.meeting_id===id).length,input_tokens:calls.filter(c=>c.meeting_id===id).reduce((n,c)=>n+c.input_tokens,0),output_tokens:calls.filter(c=>c.meeting_id===id).reduce((n,c)=>n+c.output_tokens,0)})),scope:run.id},
      limitations:['Une qualification passée ne garantit aucune performance future.','Une fin d’événement n’est pas une garantie de règlement à temps.','Un score sans résultat disponible reste inconnu.','Les domaines sans connecteur adéquat restent explicitement limités.']};
  }
}
