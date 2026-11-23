export function publicResearchUrl(url:URL){
  if(url.protocol!=='https:'||url.username||url.password)return false;
  if(url.hostname==='site.api.espn.com')return /^\/apis\/site\/v2\/sports\/(basketball|soccer|tennis)\/[a-z0-9.]+\/scoreboard$/.test(url.pathname);
  if(url.hostname==='api.opendota.com')return /^\/api\/teams(?:\/\d+\/matches)?$/.test(url.pathname);
  if(url.hostname==='site.web.api.espn.com')return url.pathname==='/apis/common/v3/search'&&!!url.searchParams.get('query')&&url.searchParams.get('query')!.length<=120&&url.searchParams.get('type')==='player'&&url.searchParams.get('limit')==='5'&&[...url.searchParams.keys()].every(k=>['query','type','limit'].includes(k));
  if(url.hostname==='sports.core.api.espn.com')return /^\/v2\/sports\/tennis\/(athletes\/\d+|leagues\/(atp|wta)\/seasons\/\d{4}\/types\/\d+\/athletes\/\d+\/statistics(?:\/\d+)?)$/.test(url.pathname)&&[...url.searchParams.keys()].every(k=>['lang','region'].includes(k));
  return false;
}
