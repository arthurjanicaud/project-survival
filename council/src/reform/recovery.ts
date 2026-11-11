import {ReformRepository} from './store';
import {hash} from '../markets';
export const BACKUP_TABLES=['meta','documents','markets','ledger','positions','fills','proposals','votes','calls','events','notifications','jobs','r4_packets','r4_evidence','r4_forecasts','r4_outcomes','r4_cycles','r4_assessments','r4_agendas','r4_models','r4_usage'] as const;
export function recoveryStatus(repo:ReformRepository){const r=repo.one("SELECT value FROM r4_recovery WHERE key='manifest'");return r?JSON.parse(r.value):null;}
export function beginRecovery(repo:ReformRepository,manifest:any,confirm:string){
  const existing=recoveryStatus(repo);if(existing){const {read_only,completed,...original}=existing;if(JSON.stringify(original)!==JSON.stringify(manifest))throw Error('RECOVERY_MANIFEST_CHANGED');return {initialized:true,read_only:true,automatic_execution:false,resumed:true};}
  if(!manifest?.state?.run?.id||manifest.state.run.id!==confirm||!manifest.tables||BACKUP_TABLES.some(t=>!Number.isSafeInteger(manifest.tables[t]?.rows)||manifest.tables[t].rows<0))throw Error('INVALID_RECOVERY_MANIFEST');
  for(const table of BACKUP_TABLES)if(!['meta','r4_usage'].includes(table)&&repo.one(`SELECT count(*) n FROM ${table}`)?.n)throw Error('RECOVERY_REQUIRES_EMPTY_OBJECT');
  if(repo.state()?.started_at)throw Error('RECOVERY_CANNOT_REPLACE_AN_EXPERIMENT');
  repo.atomic(()=>{repo.run('DELETE FROM meta');repo.run('DELETE FROM r4_usage');repo.run('DELETE FROM transient_cache');repo.run("INSERT INTO r4_recovery VALUES('manifest',?)",JSON.stringify({...manifest,read_only:true,completed:false}));});
  return {initialized:true,read_only:true,automatic_execution:false};
}
export async function restoreChunk(repo:ReformRepository,table:string,index:number,rows:any[]){
  const manifest=recoveryStatus(repo);if(!manifest)throw Error('RECOVERY_NOT_ACCEPTING_CHUNKS');
  if(!BACKUP_TABLES.includes(table as any)||!Number.isSafeInteger(index)||index<0||!Array.isArray(rows)||rows.length>50)throw Error('INVALID_RECOVERY_CHUNK');
  const digest=await hash(rows),key=table+':'+index,old=repo.one('SELECT value FROM r4_recovery WHERE key=?',key);
  if(old){if(JSON.parse(old.value).digest!==digest)throw Error('RECOVERY_CHUNK_CHANGED');return {duplicate:true};}
  if(manifest.completed)throw Error('RECOVERY_NOT_ACCEPTING_CHUNKS');
  const progress=repo.one('SELECT count(*) n FROM r4_recovery WHERE key LIKE ?',table+':%')?.n||0;
  if(index!==progress)throw Error('RECOVERY_CHUNKS_MUST_BE_ORDERED');
  const columns=repo.rows(`PRAGMA table_info(${table})`),allowed=new Set(columns.map(c=>c.name));
  repo.atomic(()=>{
    for(const row of rows){const keys=Object.keys(row);if(!keys.length||keys.some(k=>!allowed.has(k))||keys.some(k=>row[k]!==null&&!['string','number'].includes(typeof row[k])))throw Error('INVALID_RECOVERY_COLUMNS');
      const primary=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name),current=repo.one(`SELECT * FROM ${table} WHERE ${primary.map(k=>k+'=?').join(' AND ')}`,...primary.map(k=>row[k]));
      if(current){if(JSON.stringify(keys.map(k=>current[k]))!==JSON.stringify(keys.map(k=>row[k])))throw Error('RECOVERY_ROW_CONFLICT');continue;}
      repo.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k]));
    }
    repo.run('INSERT INTO r4_recovery VALUES(?,?)',key,JSON.stringify({digest,rows:rows.length}));
  });return {restored:rows.length,digest};
}
export function finishRecovery(repo:ReformRepository){
  const manifest=recoveryStatus(repo);if(!manifest)throw Error('RECOVERY_NOT_INITIALIZED');
  for(const table of BACKUP_TABLES)if(repo.one(`SELECT count(*) n FROM ${table}`)?.n!==manifest.tables[table].rows)throw Error('RECOVERY_COUNT_MISMATCH:'+table);
  if(repo.state()?.id!==manifest.state.run.id)throw Error('RECOVERY_ID_MISMATCH');
  manifest.completed=true;repo.run("UPDATE r4_recovery SET value=? WHERE key='manifest'",JSON.stringify(manifest));return {verified:true,read_only:true,automatic_execution:false};
}
