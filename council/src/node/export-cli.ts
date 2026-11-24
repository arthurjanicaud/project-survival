import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,openSync,writeSync,closeSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {BACKUP_TABLES} from '../reform/recovery';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: export-cli.ts database.sqlite new-output-directory');
const target=resolve(output);if(existsSync(target))throw Error('EXPORT_REFUSES_EXISTING_DIRECTORY');mkdirSync(target,{recursive:true});const db=new DatabaseSync(resolve(input),{readOnly:true});db.exec('BEGIN');const manifest:any={at:new Date().toISOString(),tables:{}};
try{for(const table of BACKUP_TABLES){const jsonFile=join(target,table+'.json'),csvFile=join(target,table+'.csv'),j=openSync(jsonFile,'wx'),c=openSync(csvFile,'wx');let n=0;writeSync(j,'[');
 try{const statement=db.prepare('SELECT * FROM '+table);const columns=statement.columns().map(x=>x.name),csv=(x:unknown)=>'"'+String(x??'').replaceAll('"','""')+'"';writeSync(c,columns.map(csv).join(',')+'\n');for(const row of statement.iterate()){if(n)writeSync(j,',');writeSync(j,JSON.stringify(row));writeSync(c,columns.map(k=>csv(row[k])).join(',')+'\n');n++;}writeSync(j,']');}finally{closeSync(j);closeSync(c);}manifest.tables[table]={rows:n,json_sha256:createHash('sha256').update(readFileSync(jsonFile)).digest('hex'),csv_sha256:createHash('sha256').update(readFileSync(csvFile)).digest('hex')};}
 db.exec('COMMIT');writeFileSync(join(target,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({exported_tables:BACKUP_TABLES.length,path:target,source_read_only:true}));}finally{db.close();}
