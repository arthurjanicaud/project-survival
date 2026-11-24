import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,statSync} from 'node:fs';
import {dirname} from 'node:path';
export function storage(path:string){
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 const sql={exec(q:string,...args:any[]){const s=db.prepare(q),read=s.columns().length>0;const rows=read?s.all(...args):[];const info=read?null:s.run(...args);return {toArray:()=>rows,rowsRead:rows.length,rowsWritten:Number(info?.changes||0)};},get databaseSize(){return statSync(path).size;}};
 return {db,sql,atomic:<T>(f:()=>T):T=>{db.exec('BEGIN IMMEDIATE');try{const r=f();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
