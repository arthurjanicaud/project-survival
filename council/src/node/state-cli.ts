import {resolve} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {checkout,restore} from './persistence';
const p=resolve('../.env');if(existsSync(p))for(const [k,v]of Object.entries(parseEnv(readFileSync(p,'utf8'))))if(process.env[k]===undefined)process.env[k]=v;
const state=resolve(process.env.COUNCIL_STATE_DIR||'../data/state-checkout'),data=resolve(process.env.COUNCIL_DATA_DIR||'../data/actions');
checkout(state,'https://github.com/'+(process.env.GITHUB_REPOSITORY||'arthurjanicaud/project-survival')+'.git','survival-state',process.argv[2]==='bootstrap');
if(process.argv[2]!=='bootstrap')await restore(state,data);
console.log(JSON.stringify({state_restored:process.argv[2]!=='bootstrap',no_start:true}));
