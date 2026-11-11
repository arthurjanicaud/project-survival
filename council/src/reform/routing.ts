import type {Env} from '../domain';
export function reformTarget(stage:string|null,env:Env){
  if(!['shadow','pilot','full'].includes(stage||'shadow'))throw Error('INVALID_REFORM_STAGE');
  const name=stage||'shadow',id=name==='shadow'?env.REFORM_SHADOW_ID:name==='pilot'?env.REFORM_PILOT_ID:env.REFORM_FULL_ID;
  if(!id||!/^survival-[a-z0-9-]{1,60}$/.test(id))throw Error('REFORM_NOT_CONFIGURED');return {id,stage:name.toUpperCase() as 'SHADOW'|'PILOT'|'FULL'};
}
