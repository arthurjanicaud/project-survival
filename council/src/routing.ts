import type {Env,State} from './domain';

// Only one deployed, allowlisted test can be public or scheduled. Query strings
// cannot create arbitrary Durable Objects or turn a rehearsal into production.
export function boardTarget(u:URL,admin:boolean,env:Pick<Env,'EXPERIMENT_ID'|'TEST_EXPERIMENT_ID'>):{id:string;mode:State['mode']}{
  const selector=u.searchParams.get('experiment');
  if(selector&&selector!=='test')throw Error('INVALID_EXPERIMENT_SELECTOR');
  const instance=admin?u.searchParams.get('instance'):null;
  if(selector==='test'&&!env.TEST_EXPERIMENT_ID)throw Error('TEST_NOT_CONFIGURED');
  const id=instance||(selector==='test'?env.TEST_EXPERIMENT_ID!:env.EXPERIMENT_ID);
  if(id===env.TEST_EXPERIMENT_ID){
    if(!/^test-[a-zA-Z0-9-]{1,60}$/.test(id))throw Error('INVALID_TEST_CONFIGURATION');
    return {id,mode:'test'};
  }
  if(instance&&!/^(validation|recovery)-[a-zA-Z0-9-]{1,60}$/.test(instance))throw Error('INVALID_INSTANCE');
  return {id,mode:instance?'validation':'live'};
}
