import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import type {DatabaseSync} from 'node:sqlite';
export const stages=['full','shadow','pilot'] as const;
export function key(){const v=process.env.COUNCIL_STATE_KEY||'';if(!/^[a-f0-9]{64}$/i.test(v))throw Error('COUNCIL_STATE_KEY_REQUIRES_32_RANDOM_BYTES_HEX');return Buffer.from(v,'hex');}
export function seal(data:Buffer,scope:string,k=key()){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',k,iv);c.setAAD(Buffer.from('survival-state-v1:'+scope));const b=Buffer.concat([c.update(gzipSync(data)),c.final()]);return Buffer.concat([Buffer.from('SVA1'),iv,c.getAuthTag(),b]);}
export function open(data:Buffer,scope:string,k=key()){if(data.subarray(0,4).toString()!=='SVA1')throw Error('INVALID_STATE_FORMAT');const d=createDecipheriv('aes-256-gcm',k,data.subarray(4,16));d.setAAD(Buffer.from('survival-state-v1:'+scope));d.setAuthTag(data.subarray(16,32));return gunzipSync(Buffer.concat([d.update(data.subarray(32)),d.final()]),{maxOutputLength:512*1024*1024});}
export const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function git(dir:string,args:string[]){return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env.GH_TOKEN?{...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:'AUTHORIZATION: basic '+Buffer.from('x-access-token:'+process.env.GH_TOKEN).toString('base64')}:process.env}).trim();}
export function checkout(dir:string,remote:string,branch='survival-state',bootstrap=false){
 mkdirSync(dir,{recursive:true});if(!existsSync(join(dir,'.git'))){git(dir,['init']);git(dir,['remote','add','origin',remote]);}
 git(dir,['config','user.name','Survival State']);git(dir,['config','user.email','survival-state@users.noreply.github.com']);
 const refs=git(dir,['ls-remote','--heads','origin',branch]);
 if(!refs){if(!bootstrap)throw Error('STATE_BRANCH_MISSING_REFUSE_EMPTY_FUND');git(dir,['checkout','--orphan',branch]);return;}
 git(dir,['fetch','--depth=1','origin',branch]);git(dir,['checkout','-B',branch,'FETCH_HEAD']);
}
export async function github(path:string,method='GET',body?:any,bytes?:Buffer):Promise<any>{
 const token=process.env.GH_TOKEN;if(!token)throw Error('GH_TOKEN_REQUIRED');
 const url=path.startsWith('https://')?path:'https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+path;
 const r=await fetch(url,{method,signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':bytes?'application/octet-stream':'application/json'},body:bytes as any|| (body?JSON.stringify(body):undefined)});
 if(!r.ok)throw Error('GITHUB_STATE_HTTP_'+r.status+':'+(await r.text()).slice(0,160));return r.status===204?null:r.json();
}
export async function restore(dir:string,dataDir:string){
 const m=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));if(m.version!==3)throw Error('STATE_MANIFEST_VERSION');mkdirSync(dataDir,{recursive:true});
 for(const stage of stages){const entry=m.databases[stage];if(!entry)throw Error('MISSING_STAGE_BACKUP');const token=process.env.GH_TOKEN;if(!token)throw Error('GH_TOKEN_REQUIRED');
  const r=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+'/releases/assets/'+entry.asset_id,{signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+token,Accept:'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'}});if(!r.ok)throw Error('BACKUP_DOWNLOAD_'+r.status);
  const b=Buffer.from(await r.arrayBuffer());if(sha(b)!==entry.sha256)throw Error('BACKUP_HASH_MISMATCH');const plain=open(b,stage);if(sha(plain)!==entry.plain_sha256||plain.subarray(0,16).toString()!=='SQLite format 3\0')throw Error('INVALID_SQLITE_BACKUP');const path=join(dataDir,stage+'.sqlite');if(existsSync(path+'-wal'))throw Error('RESTORE_REQUIRES_CLOSED_DATABASE');writeFileSync(path+'.tmp',plain);renameSync(path+'.tmp',path);
 }return m;
}
export function snapshot(db:DatabaseSync,path:string){const temp=resolve(path)+'.snapshot';rmSync(temp,{force:true});db.exec("VACUUM INTO '"+temp.replaceAll("'","''")+"'");const b=readFileSync(temp);rmSync(temp);return b;}
export async function persist(dir:string,databases:Record<string,{db:DatabaseSync,path:string,readonly?:boolean}>,publicFiles:Record<string,unknown>,branch='survival-state'){
 const previous=existsSync(join(dir,'manifest.json'))?JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')):null;
 const manifest:any={version:3,at:new Date().toISOString(),databases:{}};
 const releases=await github('/releases?per_page=100');let release=releases.find((r:any)=>r.tag_name==='council-state');
 if(!release)release=await github('/releases','POST',{tag_name:'council-state',name:'Encrypted council checkpoints',body:'AES-256-GCM encrypted SQLite checkpoints. Public dashboard snapshots are on survival-state. No trading wallet.',prerelease:true});
 for(const [stage,s]of Object.entries(databases)){const old=previous?.databases?.[stage];if(s.readonly&&old){manifest.databases[stage]=old;continue;}const plain=snapshot(s.db,s.path),digest=sha(plain);if(plain.length>512*1024*1024)throw Error('STATE_SIZE_REQUIRES_COMPACTION');if(old?.plain_sha256===digest){manifest.databases[stage]=old;continue;}
  const b=seal(plain,stage);if(b.length>50*1024*1024)throw Error('BACKUP_SIZE_BUDGET_EXCEEDED');const name='checkpoint-'+stage+'-'+Date.now()+'-'+randomBytes(4).toString('hex')+'.enc';
  const asset=await github(release.upload_url.replace('{?name,label}','')+'?name='+name,'POST',undefined,b);manifest.databases[stage]={asset_id:asset.id,sha256:sha(b),plain_sha256:digest,bytes:b.length};
 }
 for(const [path,value] of Object.entries(publicFiles)){if(!/^data\/(full|shadow|pilot)\/(state|events|meetings|meeting-[a-f0-9]{64}|document-[a-f0-9]{64})\.json$/.test(path))throw Error('INVALID_PUBLIC_EXPORT_PATH');mkdirSync(dirnameOf(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),JSON.stringify(value));}
 writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));git(dir,['add','data','manifest.json']);git(dir,['commit','-m','Checkpoint council state [skip ci]']);
 // Publishing the manifest is the commit point; non-fast-forward is fatal.
 git(dir,['push','origin','HEAD:refs/heads/'+branch]);
 // Keep current and two predecessors outside Git history; cleanup follows commit.
 const all=await github('/releases/'+release.id+'/assets?per_page=100');for(const stage of stages){const backups=all.filter((x:any)=>x.name.startsWith('checkpoint-'+stage+'-')).sort((a:any,b:any)=>b.id-a.id);for(const old of backups.slice(3))if(old.id!==manifest.databases[stage].asset_id)try{await github('/releases/assets/'+old.id,'DELETE');}catch{console.error('Old encrypted checkpoint cleanup failed; current checkpoint is safe.');}}
 return manifest;
}
function dirnameOf(p:string){return p.slice(0,Math.max(p.lastIndexOf('/'),p.lastIndexOf('\\')));}
