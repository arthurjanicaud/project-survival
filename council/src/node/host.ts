import {createServer} from 'node:http';
import {timingSafeEqual,createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {storage} from './storage';
import {stages,persist} from './persistence';
import {ReformRuntime} from '../reform/runtime';
import type {Env} from '../domain';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
if(existsSync(join(root,'.env'))){const local=parseEnv(readFileSync(join(root,'.env'),'utf8'));for(const [k,v] of Object.entries(local))if(process.env[k]===undefined)process.env[k]=v;}
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n));
export async function host(options:{dataDir:string;stateDir?:string;port?:number;seconds?:number;publish?:boolean}){
 const dir=resolve(options.dataDir);mkdirSync(dir,{recursive:true});
 // O_EXCL protects against two local processes. Hosted runs are also serialized by workflow concurrency.
 const lock=join(dir,'host.lock');const {openSync,closeSync}=await import('node:fs');const fd=openSync(lock,'wx');
 const dbs:Record<string,ReturnType<typeof storage>&{path:string;readonly?:boolean}>={},runtimes:Record<string,ReformRuntime>={};let closing=false,publicationError:unknown=null,lastPublish=0,chain=Promise.resolve();
 const configured:Partial<Env>={STORAGE_BACKEND:'github-sqlite',REFORM_ACTIVE_MODE:'true',REFORM_IMPROVEMENTS:'true',REFORM_FULL_ID:'survival-004-active',REFORM_SHADOW_ID:'survival-004-shadow',REFORM_PILOT_ID:'survival-005-actions-pilot',EXPERIMENT_ID:'survival-004-active',AZURE_DEPLOYMENT:process.env.COUNCIL_AZURE_DEPLOYMENT||process.env.AZURE_OPENAI_DEPLOYMENT_PHASE3||'gpt-6.1-sol-3',AZURE_ENDPOINT:process.env.AZURE_OPENAI_ENDPOINT,AZURE_KEY:process.env.COUNCIL_NO_LLM==='true'?undefined:process.env.AZURE_OPENAI_API_KEY,PUBLIC_ORIGIN:'https://project-survival.pages.dev',NTFY_DELIVERY:'github-relay',NTFY_TOPIC:process.env.COUNCIL_NTFY_TOPIC,CF_VERSION_METADATA:{id:process.env.COUNCIL_CODE_VERSION?'github-sqlite:'+process.env.COUNCIL_CODE_VERSION+':'+(process.env.COUNCIL_AZURE_DEPLOYMENT||process.env.AZURE_OPENAI_DEPLOYMENT_PHASE3||'gpt-6.1-sol-3'):process.env.GITHUB_SHA||'github-node-local'}};
 for(const stage of stages){const path=join(dir,stage+'.sqlite'),s=storage(path);dbs[stage]={...s,path};let alarm:number|null=null;
  const ctx={storage:{sql:s.sql,transactionSync:s.atomic,getAlarm:async()=>alarm,setAlarm:async(n:number)=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}},waitUntil:(p:Promise<unknown>)=>p.catch(e=>console.error(String(e)))} as unknown as DurableObjectState;
  const runtime=new ReformRuntime(ctx,configured as Env);runtime.initialize();const run=runtime.engine.run();dbs[stage].readonly=!!run&&(run.status==='FINISHED'||!!run.stopped_at);
  if(run){if(run.stage.toLowerCase()!==stage)throw Error('STATE_STAGE_MISMATCH');(configured as any)['REFORM_'+stage.toUpperCase()+'_ID']=run.id;}
  runtimes[stage]=runtime;
 }
 const ns={idFromName:(id:string)=>id,get:(id:string)=>({fetch:(r:Request)=>{const target=Object.values(runtimes).find(x=>x.engine.run()?.id===id);if(!target)throw Error('LOCAL_PEER_NOT_FOUND');return target.fetch(r);}})};
 (configured as Env).REFORM=ns as any;
 for(const stage of stages){const rt=runtimes[stage];rt.repo.run("DELETE FROM meta WHERE key='r4:backup_lock'");rt.repo.set('runtime:backend','github-sqlite');if(!dbs[stage].readonly)rt.repo.set('r4:research_pacing',{mode:'NORMAL',backend:'github-sqlite',at:new Date().toISOString()});await rt.engine.prepare((configured as any)['REFORM_'+stage.toUpperCase()+'_ID'],stage.toUpperCase() as any);}
 function clean(value:any){let text=JSON.stringify(value);for(const [name,v]of Object.entries(process.env)){if(typeof v==='string'&&v.length>=8&&/(?:_KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL|NTFY_TOPIC)$/.test(name))text=text.replaceAll(JSON.stringify(v).slice(1,-1),'[REDACTED]');}return JSON.parse(text);}

 const archivedFiles:Record<string,Record<string,unknown>>={};
 function publicFiles(){const out:Record<string,unknown>={};for(const stage of stages){const rt=runtimes[stage],prefix='data/'+stage+'/';if(archivedFiles[stage]){Object.assign(out,archivedFiles[stage]);continue;}const state={...rt.engine.summary(),generated_at:new Date().toISOString(),transport:{backend:'github-actions',delivery:'published-snapshots',poll_seconds:15,continuous_connection:false}};out[prefix+'state.json']=clean(state);out[prefix+'events.json']=clean({events:rt.repo.rows('SELECT * FROM events ORDER BY seq DESC LIMIT 500').reverse().map(e=>({...e,details:JSON.parse(e.details)})),scope:'latest 500 events; complete meeting replays and encrypted archive retain history'});const meetings=rt.repo.rows('SELECT id FROM r4_agendas ORDER BY at');out[prefix+'meetings.json']=meetings;
   for(const m of meetings)out[prefix+'meeting-'+createHash('sha256').update(m.id).digest('hex')+'.json']=clean({meeting:rt.engine.meetingRow(m.id),events:rt.repo.events(0,m.id,100000)});
   for(const d of rt.repo.rows('SELECT id,payload FROM r4_evidence'))out[prefix+'document-'+createHash('sha256').update(d.id).digest('hex')+'.json']=clean(JSON.parse(d.payload));
   if(rt.engine.run().status==='FINISHED'||rt.engine.run().stopped_at)archivedFiles[stage]=Object.fromEntries(Object.entries(out).filter(([k])=>k.startsWith(prefix)));
  }return out;}
 async function checkpoint(force=false){if(!options.publish||(!force&&Date.now()-lastPublish<30000))return;chain=chain.then(async()=>{if(!force&&Date.now()-lastPublish<30000)return;await persist(options.stateDir!,dbs,publicFiles());lastPublish=Date.now();});try{await chain;}catch(e){publicationError=e;closing=true;throw e;}}
 function authorized(value:string|undefined){const expected='Bearer '+(process.env.COUNCIL_ADMIN_TOKEN||'');return !!process.env.COUNCIL_ADMIN_TOKEN&&!!value&&Buffer.byteLength(value)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));}
 const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url||'/','http://127.0.0.1'),stage=u.searchParams.get('stage')||'full';if(!stages.includes(stage as any)){res.writeHead(400).end();return;}
  if(!(req.method==='GET'&&u.pathname.startsWith('/api/'))&&!authorized(req.headers.authorization)){res.writeHead(401).end();return;}
  if(closing){res.writeHead(503).end();return;}
  if(u.pathname==='/admin/start'){res.writeHead(403).end(JSON.stringify({error:'START_NOT_AVAILABLE_IN_MIGRATION_HOST'}));return;}
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4500000)throw Error('BODY_TOO_LARGE');chunks.push(chunk);}
  const headers=new Headers({'x-reform-stage':stage,'content-type':'application/json'});const request=new Request(u,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined});let r:Response;
  if(u.pathname==='/api/health')r=Response.json({state:runtimes[stage].repo.state(),run:runtimes[stage].engine.run(),research_collector:runtimes[stage].repo.get('research_collector'),backend:'github-sqlite'});
  else if(u.pathname==='/admin/research-demands')r=Response.json({requests:[...new Map(Object.values(runtimes).filter(rt=>rt.engine.run().status!=='FINISHED'&&!rt.engine.run().stopped_at).flatMap(rt=>rt.repo.sourceDemands()).map(x=>[x.url,x])).values()]});
  else if(u.pathname==='/admin/research'&&req.method==='POST'){for(const [s,rt] of Object.entries(runtimes)){if(dbs[s].readonly)continue;const copy=request.clone();copy.headers.set('x-reform-stage',s);const x=await rt.fetch(copy);if(!x.ok)throw Error('RESEARCH_IMPORT_FAILED');}r=Response.json({stored:true});}
  else if(u.pathname==='/admin/notification-outbox'){const notifications:any[]=[];for(const [s,rt]of Object.entries(runtimes)){if(dbs[s].readonly)continue;const r=await rt.fetch(new Request('http://localhost/admin/notification-outbox',{headers:{'x-reform-stage':s}}));notifications.push(...(await r.json() as any).notifications);}r=Response.json({topic:process.env.COUNCIL_NTFY_TOPIC,notifications});}
  else r=await runtimes[stage].fetch(request);
  res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'});res.end(await r.text());
 }catch(e){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:String(e)}));}});
 await new Promise<void>(r=>server.listen(options.port||8790,'127.0.0.1',r));console.log(JSON.stringify({host:'github-sqlite',port:options.port||8790,started_competition:false}));
 const until=Date.now()+(options.seconds??240)*1000;
 try{await checkpoint(true);while(!closing&&Date.now()<until){let work=false;for(const stage of stages){if(closing||Date.now()>=until)break;const rt=runtimes[stage];if(dbs[stage].readonly)continue;rt.engine.tick();const next=rt.repo.nextJobAt();if(rt.engine.run().status!=='FINISHED'&&!rt.engine.run().stopped_at&&next&&Date.parse(next)<=Date.now()){work=true;await rt.alarm();await checkpoint();}}if(!work)await sleep(1000);}if(publicationError)throw publicationError;writeFileSync(join(dir,'validation.json'),JSON.stringify({at:new Date().toISOString(),readiness:runtimes.pilot.engine.readiness(),no_start:true,azure_disabled:process.env.COUNCIL_NO_LLM==='true'}));await checkpoint(true);}
 finally{closing=true;await new Promise<void>(r=>server.close(()=>r()));for(const s of Object.values(dbs))s.db.close();closeSync(fd);rmSync(lock,{force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))host({dataDir:process.env.COUNCIL_DATA_DIR||join(root,'data/actions'),stateDir:process.env.COUNCIL_STATE_DIR,seconds:Number(process.env.COUNCIL_RUN_SECONDS||240),publish:process.env.COUNCIL_PUBLISH==='true'}).catch(e=>{console.error(String(e));process.exitCode=1;});
