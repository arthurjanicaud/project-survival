import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {storage} from './storage';
import {ReformRepository} from '../reform/store';
import {stages} from './persistence';
import {BACKUP_TABLES} from '../reform/recovery';
export function importArchive(input:string,destination:string){
 mkdirSync(destination,{recursive:true});const result:any={};
 for(const stage of stages){const source=join(input,stage),manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8')),path=join(destination,stage+'.sqlite');if(existsSync(path))throw Error('IMPORT_REFUSES_EXISTING_DATABASE');
  const s=storage(path),repo=new ReformRepository(s.sql,s.atomic);repo.migrateReform();
  if(manifest.state.run.stage.toLowerCase()!==stage)throw Error('ARCHIVE_STAGE_MISMATCH');
  s.atomic(()=>{for(const [table,entry]of Object.entries(manifest.tables)as [string,any][]){if(!BACKUP_TABLES.includes(table as any))throw Error('INVALID_TABLE');const data=readFileSync(join(source,entry.file));if(createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error('ARCHIVE_HASH_MISMATCH');const rows=gunzipSync(data).toString().trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));if(rows.length!==entry.rows)throw Error('ARCHIVE_ROW_COUNT');for(const row of rows){const columns=Object.keys(row);if(columns.some(k=>!/^[_a-z]+$/.test(k)))throw Error('INVALID_COLUMN');repo.run('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...columns.map(k=>row[k]));}}});
  const run=repo.get<any>('reform_run'),scope={id:run.id,started_at:run.started_at,end_at:run.end_at,policy_hash:run.policy_hash},value={run:scope,ledger:repo.rows('SELECT * FROM ledger ORDER BY id'),positions:repo.rows('SELECT * FROM positions ORDER BY id'),fills:repo.rows('SELECT * FROM fills ORDER BY id')};
  result[stage]={run:scope,financial_sha256:createHash('sha256').update(JSON.stringify(value)).digest('hex'),sqlite_integrity:s.db.prepare('PRAGMA integrity_check').get()};s.db.close();
 }return result;
}
if(process.argv[2]&&process.argv[3])console.log(JSON.stringify(importArchive(resolve(process.argv[2]),resolve(process.argv[3]))));
