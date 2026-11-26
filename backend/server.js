const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000;
const ORIGINS=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const STATIC={'/':'index.html','/index.html':'index.html'}; // whitelist: nothing else is served from disk
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cache={};
async function getText(url,opt={},tries=4){let e;for(let i=0;i<tries;i++){try{const r=await fetch(url,{...opt,headers:{'User-Agent':'FXFundamentalsPro/1.0',...(opt.headers||{})},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}catch(x){e=x;await sleep(500*2**i)}}throw e}
async function cached(key,ttl,fn){const c=cache[key];if(c&&Date.now()-c.t<ttl)return{...c.v,stale:false,fetchedAt:c.t};try{const v=await fn();cache[key]={t:Date.now(),v};return{...v,stale:false,fetchedAt:cache[key].t}}catch(e){if(c)return{...c.v,stale:true,fetchedAt:c.t,error:e.message};throw e}}

// ---- ECB history (daily reference rates; units of currency per 1 EUR)
async function ecb(){
  const start=new Date(Date.now()-320*864e5).toISOString().slice(0,10);
  const csv=await getText(`https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+CHF+CAD+AUD+NZD.EUR.SP00.A?format=csvdata&startPeriod=${start}`);
  const lines=csv.trim().split(/\r?\n/),h=lines[0].split(','),ci=h.indexOf('CURRENCY'),ti=h.indexOf('TIME_PERIOD'),vi=h.indexOf('OBS_VALUE');
  if(ci<0||ti<0||vi<0)throw new Error('Unexpected ECB format');
  const by={},dates=new Set();
  for(const l of lines.slice(1)){const p=l.split(',');const v=parseFloat(p[vi]);if(!isNaN(v)){(by[p[ci]]??={})[p[ti]]=v;dates.add(p[ti])}}
  const ds=[...dates].sort(),rates={EUR:ds.map(()=>1)};
  for(const c of Object.keys(by)){let last=null;rates[c]=ds.map(d=>(last=by[c][d]??last))}
  const first=ds.findIndex((_,i)=>Object.keys(rates).every(c=>rates[c][i]!=null));
  for(const c of Object.keys(rates))rates[c]=rates[c].slice(first);
  return{source:'ECB euro foreign exchange reference rates (daily, not live quotes)',dates:ds.slice(first),rates};
}
// ---- FRED + BLS
const FRED={us2y:'DGS2',us5y:'DGS5',us10y:'DGS10',tips10y:'DFII10',usdBroad:'DTWEXBGS',wti:'DCOILWTICO',brent:'DCOILBRENTEU',gold:'GOLDAMGBD228NLBM'};
async function fred(id,tries){const rows=(await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id,{},tries)).trim().split(/\r?\n/).slice(1).map(l=>l.split(',')).filter(p=>p[1]&&p[1]!=='.');const a=rows.at(-1),b=rows.at(-2);return{date:a[0],value:+a[1],prev:b?+b[1]:null}}
async function bls(){
  const t=await getText('https://api.bls.gov/publicAPI/v1/timeseries/data/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seriesid:['CUUR0000SA0','LNS14000000','CES0000000001'],startyear:String(new Date().getFullYear()-2),endyear:String(new Date().getFullYear())})});
  const j=JSON.parse(t),S={};for(const s of j.Results.series)S[s.seriesID]=s.data.filter(d=>d.value!=='-');
  const cpi=S.CUUR0000SA0,u=S.LNS14000000,n=S.CES0000000001,o={};
  const prev=cpi.find(d=>d.period===cpi[0].period&&+d.year===+cpi[0].year-1);
  if(prev)o.cpiYoY={value:+((cpi[0].value/prev.value-1)*100).toFixed(2),date:`${cpi[0].year}-${cpi[0].period}`};
  o.unemployment={value:+u[0].value,prev:+u[1].value,date:`${u[0].year}-${u[0].period}`};
  o.payrollsChange={value:Math.round(n[0].value-n[1].value),date:`${n[0].year}-${n[0].period}`,unit:'thousands, m/m'};
  return o;
}
async function dashboard(){
  const out={fred:{},bls:null,errors:{}};
  const keys=Object.keys(FRED),rs=await Promise.allSettled([...keys.map(k=>fred(FRED[k])),bls()]);
  keys.forEach((k,i)=>{const r=rs[i];r.status==='fulfilled'?out.fred[k]=r.value:(out.fred[k]=null,out.errors[k]=r.reason.message)});
  const b=rs[keys.length];b.status==='fulfilled'?out.bls=b.value:out.errors.bls=b.reason.message;
  if(Object.values(out.fred).every(v=>!v)&&!out.bls)throw new Error('All upstream sources failed');
  return out;
}
// ---- News (Google News RSS searches + FXStreet/CNBC/MarketWatch + central-bank feeds). Refreshed every 15 min.
const Q=[{cat:'Central Banks',q:'"central bank" OR Fed OR ECB OR "Bank of England" OR "Bank of Japan" interest rates'},{cat:'Currencies',q:'forex OR "currency markets" OR "US dollar" OR euro OR yen OR sterling'},{cat:'Macro & Rates',q:'inflation OR CPI OR "nonfarm payrolls" OR "Treasury yields" OR GDP'},{cat:'Macro & Rates',q:'site:reuters.com inflation OR economy OR "interest rates"'},{cat:'Currencies',q:'site:reuters.com forex OR currencies OR dollar'},
 ...[['USD','"US dollar" OR "Federal Reserve" OR "dollar index"'],['EUR','euro OR ECB OR eurozone OR EUR/USD'],['GBP','sterling OR "Bank of England" OR GBP/USD'],['JPY','yen OR "Bank of Japan" OR USD/JPY'],['CHF','"Swiss franc" OR SNB OR "Swiss National Bank"'],['CAD','"Canadian dollar" OR loonie OR "Bank of Canada"'],['AUD','"Australian dollar" OR RBA OR "Reserve Bank of Australia"'],['NZD','"New Zealand dollar" OR RBNZ OR kiwi'],['XAUUSD','gold price OR XAUUSD OR bullion'],['XAGUSD','silver price OR XAGUSD']].map(([tag,q])=>({cat:'Top Stories',tag,q}))];
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const YF=q=>`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${q}&region=US&lang=en-US`;
const DIRECT=[['https://www.fxstreet.com/rss/news','FXStreet','Top Stories'],['https://www.fxempire.com/api/v1/en/articles/rss/news','FXEmpire','Top Stories'],['https://www.investing.com/rss/news_1.rss','Investing.com','Top Stories'],['https://www.investing.com/rss/news_11.rss','Investing.com','Top Stories'],['https://www.dailyfx.com/feeds/market-news','DailyFX','Top Stories'],[YF('GC=F'),'Yahoo Finance','Top Stories','XAUUSD'],[YF('SI=F'),'Yahoo Finance','Top Stories','XAGUSD'],[YF('EURUSD=X,GBPUSD=X,JPY=X,CHF=X,CAD=X,AUDUSD=X,NZDUSD=X'),'Yahoo Finance','Top Stories'],['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664','CNBC',null],['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258','CNBC',null],['https://feeds.content.dowjones.io/public/rss/mw_marketpulse','MarketWatch',null],['https://feeds.content.dowjones.io/public/rss/mw_topstories','MarketWatch',null]];
const FEEDS=[['USD','https://www.federalreserve.gov/feeds/press_all.xml','Federal Reserve'],['EUR','https://www.ecb.europa.eu/rss/press.html','ECB'],['GBP','https://www.bankofengland.co.uk/rss/news','Bank of England'],['JPY','https://www.boj.or.jp/en/rss/whatsnew.xml','Bank of Japan'],['CHF','https://www.snb.ch/public/en/rss/pressrel','SNB'],['CAD','https://www.bankofcanada.ca/content_type/press-releases/feed/','Bank of Canada'],['AUD','https://www.rba.gov.au/rss/rss-cb-media-releases.xml','RBA'],['NZD','https://www.rbnz.govt.nz/feeds/news','RBNZ']];
const DRV_HI=[['Intervention',/interven(e|tion)|emergency (rate|meeting|cut|hike)/i],['Rate decision',/rate decision|rate (hike|cut)s?|\b(raises?|cuts?|holds?|lifts?|slashes|keeps|leaves|hikes?) (its |the )?(key |benchmark |policy |interest |cash )?rates?\b|interest[- ]rate (decision|announcement)|policy rate|monetary policy (decision|meeting|statement)|\bfomc\b|\bmpc\b|rba board|official cash rate|\bocr\b/i],['Central bank speech',/\b(fed|federal reserve|ecb|boe|bank of england|boj|bank of japan|rba|reserve bank|rbnz|boc|bank of canada|snb|swiss national bank)\b.*\b(says?|said|signals?|warns?|hints?|flags?|speech|testimony|remarks|statement|minutes|chair|governor)\b|\b(powell|lagarde|bailey|ueda|macklem|bullock|schlegel|breman)\b/i],['CPI / inflation',/\bcpi\b|\bpce\b|inflation|consumer prices?|producer prices?|\bppi\b/i],['GDP',/\bgdp\b|gross domestic product/i],['NFP / jobs',/non-?farm|\bnfp\b|payrolls?|unemployment|jobless (rate|claims)|jobs report|employment (data|report|change)|labou?r market/i]];
const DRV_MED=[['Rate expectations',/(rate[- ])?(cut|hike)s? (bets|expectations|odds|hopes)|rate expectations|pricing in|fed funds futures/i],['PMI',/\bpmi\b|purchasing managers/i],['Retail sales',/retail sales/i],['Trade balance',/trade (balance|deficit|surplus|gap)|current account/i],['Consumer confidence',/(consumer|business) (confidence|sentiment)|\bzew\b|\bifo\b|michigan/i],['Bond yields',/\byields?\b|treasur(y|ies)|\bgilts?\b|\bbunds?\b|\bjgbs?\b|bond (market|sell-?off|rally)/i],['Analyst forecast',/forecast|outlook|predict|analysts?|strategists?|price target|projection/i],['Market sentiment',/risk (appetite|sentiment|aversion)|risk-(on|off)|safe[- ]haven|market sentiment|volatility|\bvix\b/i]];
const driverOf=t=>{for(const[n,r]of DRV_HI)if(r.test(t))return[n,'HIGH'];for(const[n,r]of DRV_MED)if(r.test(t))return[n,'MEDIUM'];return[null,'LOW']};


const triage=t=>driverOf(t)[1];
const tone=t=>{const h=/hike|raises? (interest )?rates?|hawkish|higher for longer|hotter|accelerat|\bbeats?\b/i.test(t),d=/\bcuts?\b|dovish|\beases?\b|easing|cools?|slows?|\bmiss(es)?\b/i.test(t);return h&&!d?'Hawkish':d&&!h?'Dovish':'Neutral'};
const move=t=>{const u=/\b(rall(y|ies|ied)|surg\w*|jump\w*|climb\w*|gains?|rises?|rose|record high|soar\w*|strengthen\w*|firms?|advances?|rebound\w*|higher)\b/i.test(t),d=/\b(falls?|fell|drops?|dropped|slump\w*|slid\w*|slides|declin\w*|tumbl\w*|sinks?|weaken\w*|lower|loses|losses|plung\w*|slips?|retreats?)\b/i.test(t);return u&&!d?'Up':d&&!u?'Down':'Flat'};

const SPORT=/\b(football|soccer|cricket|premier league|champions league|onefootball|nfl|nba|mlb|nhl|la liga|serie a|bundesliga|touchdown|quarterback)\b/i,AMBIG=/\b(match(es)?|goals?|transfers?)\b/i,FIN=/\b(forex|fx|currency|currencies|rates?|inflation|cpi|gdp|fed|ecb|boe|boj|snb|rba|yields?|treasur\w*|central bank|bonds?|gold|silver|dollar|euro|yen|sterling|payrolls?|econom\w*|markets?)\b/i;
const noise=(t,sm='')=>SPORT.test(t+' '+sm)||(AMBIG.test(t)&&!FIN.test(t));
const CURX={USD:/\b(usd|u\.?s\.? dollar|dollar index|greenback|fed\b|federal reserve|fomc|powell|treasur)|(?<!canadian |australian |new zealand |hong kong )\bdollar\b/i,EUR:/\b(eur\b|euro\b|ecb|lagarde|eurozone)/i,GBP:/\b(gbp|sterling|pound|boe\b|bank of england|bailey)/i,JPY:/\b(jpy|yen|boj\b|bank of japan|ueda)/i,CHF:/\b(chf|franc|snb\b|swiss)/i,CAD:/\b(cad\b|loonie|bank of canada|canadian)/i,AUD:/\b(aud\b|aussie|rba\b|australia)/i,NZD:/\b(nzd|kiwi|rbnz|new zealand)/i,XAUUSD:/\b(gold|bullion|xau|xauusd)\b/i,XAGUSD:/\b(silver|xag|xagusd)\b/i};
const detectCur=t=>Object.keys(CURX).filter(c=>CURX[c].test(t)).slice(0,5);
const classify=t=>/central bank|\bfed\b|fomc|\becb\b|\bboe\b|\bboj\b|\bsnb\b|\brba\b|rbnz|rate (cut|hike|decision)|powell|lagarde|bailey|ueda|monetary policy/i.test(t)?'Central Banks':/inflation|\bcpi\b|\bgdp\b|payroll|yield|treasur|jobs report|unemployment|\bpmi\b|retail sales|recession/i.test(t)?'Macro & Rates':/forex|\bfx\b|dollar|\beuro\b|\byen\b|sterling|\bpound\b|franc|loonie|aussie|kiwi|currenc/i.test(t)?'Currencies':'Top Stories';
const dec=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
const summ=(d,t)=>{const x=dec((d||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();return x&&!x.toLowerCase().startsWith(t.replace(/ - [^-]+$/,'').toLowerCase().slice(0,30))?x.slice(0,500):''};
const fix=u=>{if(!u)return null;u=u.trim();if(u.startsWith('//'))u='https:'+u;u=u.replace(/^http:\/\//i,'https://');return/^https:\/\//.test(u)?u:null};
function parseRss(x,src){return[...x.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(m=>{
  const b=m[1],g=t=>{const r=b.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`));return r?dec(r[1].trim()):''};
  const d=new Date(g('pubDate')||g('dc:date')),title=g('title'),raw=g('description')||g('content:encoded');
  const im=(b.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/)||b.match(/<enclosure[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/)||b.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i)||raw.match(/<img[^>]+src=["']([^"']+)["']/)||[])[1];
  return{title,link:g('link'),source:g('source')||src||'',summary:summ(raw,title),img:fix(im),time:isNaN(d)?new Date().toISOString():d.toISOString()}})}
const META=['og:image:secure_url','og:image','twitter:image','twitter:image:src'];
function pickMeta(t){for(const k of META){const m=t.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`,'i'))||t.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`,'i'));if(m){const u=fix(dec(m[1]));if(u&&!/logo|favicon|placeholder/i.test(u))return u}}return null}
async function head(r){let s='';const rd=r.body.getReader(),d=new TextDecoder();while(s.length<250000){const{done,value}=await rd.read();if(done)break;s+=d.decode(value,{stream:true})}rd.cancel().catch(()=>{});return s}
async function ogImage(u){try{const r=await fetch(u,{headers:{'User-Agent':UA,Accept:'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(6000)});return pickMeta(await head(r))}catch{return null}}
// Google News article links -> publisher URL. Old tokens are base64 URLs; new ones need Google's batchexecute endpoint.
const gnId=l=>(l.match(/news\.google\.com\/(?:rss\/)?articles\/([^?#]+)/)||[])[1];
function legacyDecode(id){let b=Buffer.from(id.replace(/-/g,'+').replace(/_/g,'/'),'base64');if(b[0]===8&&b[1]===0x13&&b[2]===0x22)b=b.subarray(3);if(b.length>3&&b[b.length-3]===0xd2&&b[b.length-2]===1&&b[b.length-1]===0)b=b.subarray(0,-3);const len=b[0],u=(len>=0x80?b.subarray(2,len+1):b.subarray(1,len+1)).toString('latin1');return/^https?:\/\//.test(u)?u:null}
async function gnResolve(id){
  const l=legacyDecode(id);if(l)return l;
  const H={'User-Agent':UA,Cookie:'CONSENT=YES+cb; SOCS=CAI'},html=await getText(`https://news.google.com/rss/articles/${id}`,{headers:H},1);
  const sg=(html.match(/data-n-a-sg="([^"]+)"/)||[])[1],ts=(html.match(/data-n-a-ts="([^"]+)"/)||[])[1];if(!sg||!ts)throw new Error('no signature');
  const inner=JSON.stringify(['garturlreq',[['X','X',['X','X'],null,null,1,1,'US:en',null,1,null,null,null,null,null,0,1],'X','X',1,[1,1,1],1,1,null,0,0,null,0],id,+ts,sg]);
  const r=await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute',{method:'POST',headers:{...H,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'f.req='+encodeURIComponent(JSON.stringify([[['Fbv4je',inner,null,'generic']]])),signal:AbortSignal.timeout(8000)}),t=await r.text();
  try{return JSON.parse(JSON.parse(t.split('\n\n')[1].slice(0,-2))[0][2])[1]}catch{const m=t.match(/garturlres\\+",\\+"(https?:[^"\\]+)/);return m?m[1]:null}}
async function enrich(items){
  const gl=items.filter(i=>gnId(i.link||'')).sort((a,b)=>b.time.localeCompare(a.time)).slice(0,30);
  for(let k=0;k<gl.length;k+=3)await Promise.all(gl.slice(k,k+3).map(async i=>{try{const u=await gnResolve(gnId(i.link));if(u&&!/news\.google\.com/.test(u))i.link=u}catch{}}));
  const todo=items.filter(i=>!i.img&&i.link&&!/news\.google\.com/.test(i.link)).slice(0,40);
  for(let k=0;k<todo.length;k+=6)await Promise.all(todo.slice(k,k+6).map(async i=>{i.img=await ogImage(i.link)}))}
const rel=iso=>{const s=(Date.now()-new Date(iso))/1e3,m=s/60,h=m/60,d=h/24,f=Math.floor;return s<60?'just now':m<60?`${f(m)} min ago`:h<24?`${f(h)} hour${f(h)>1?'s':''} ago`:d<7?`${f(d)} day${f(d)>1?'s':''} ago`:new Date(iso).toISOString().slice(0,10)};
const present=n=>({id:n.id,title:n.title,source:n.source,publishedAt:rel(n.time),time:n.time,url:n.link,link:n.link,imageUrl:n.img||null,category:n.category,summary:n.summary,impact:n.impact,driver:n.driver||null,tone:n.tone,move:n.move||'Flat',cur:n.cur,currencies:n.cur});
let news=[];const idx=new Map(),clients=new Set();let lastPoll=null;
async function pollNews(){
  const jobs=[...Q.map(({cat,q,tag})=>({url:`https://news.google.com/rss/search?q=${encodeURIComponent(q+' when:2d')}&hl=en-US&gl=US&ceid=US:en`,cat,tag,src:''})),...DIRECT.map(([url,src,cat,tag])=>({url,src,cat,tag,gen:cat===null})),...FEEDS.map(([cur,url,src])=>({url,src,cat:'Central Banks',tag:cur}))];
  const rs=await Promise.allSettled(jobs.map(async j=>({j,items:parseRss(await getText(j.url,{headers:{'User-Agent':UA}},2),j.src)}))),fresh=[];
  for(const r of rs){if(r.status!=='fulfilled')continue;const{j,items}=r.value;
    for(const it of items){if(!it.title||noise(it.title,it.summary)||Date.now()-new Date(it.time)>7*864e5)continue;
      const text=it.title+' '+it.summary,tags=[...new Set([...(j.tag?[j.tag]:[]),...detectCur(text)])],cat=!j.cat||j.cat==='Top Stories'?classify(text):j.cat;
      if(j.gen&&cat==='Top Stories'&&!tags.length)continue;
      const norm=it.title.toLowerCase().replace(/ - [^-]+$/,'').replace(/[^a-z0-9]/g,''),id=crypto.createHash('md5').update(norm).digest('hex').slice(0,12),ex=idx.get(id);
      if(ex){tags.forEach(t=>{if(!ex.cur.includes(t))ex.cur.push(t)});if(!ex.img&&it.img)ex.img=it.img;continue}
      const[driver,impact]=driverOf(it.title),o={id,...it,category:cat,cur:tags,impact,driver,tone:tone(text),move:move(it.title)};idx.set(id,o);fresh.push(o)}}
  lastPoll=new Date().toISOString();
  if(fresh.length){news=[...fresh,...news].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,400);
    if(idx.size>3000){idx.clear();news.forEach(n=>idx.set(n.id,n))}
    const msg=`event: news\ndata: ${JSON.stringify(fresh.map(present))}\n\n`;clients.forEach(c=>c.write(msg))}
  enrich(fresh).catch(()=>{}); // resolves Google links + fetches og:image in the background; items update in place
}
const loop=()=>pollNews().catch(()=>{}).finally(()=>setTimeout(loop,9e5));const firstPoll=loop();
// ---- Fundamentals (auto). Every metric has a chain of sources tried in order; first fresh one wins. Missing = null, never estimated.
const BIS={USD:'US',EUR:'XM',GBP:'GB',JPY:'JP',CHF:'CH',CAD:'CA',AUD:'AU',NZD:'NZ'};
const CCs={USD:['US'],EUR:['EZ','EA19'],GBP:['GB'],JPY:['JP'],CHF:['CH'],CAD:['CA'],AUD:['AU'],NZD:['NZ']};
const I3={USD:'USA',GBP:'GBR',JPY:'JPN',CHF:'CHE',CAD:'CAN',AUD:'AUS',NZD:'NZL'},FQ={AUD:'Q',NZD:'Q'},MON='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '),MONI={};'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').forEach((m,i)=>MONI[m]=String(i+1).padStart(2,'0'));
const iso=d=>/^\d{4}-\d{2}$/.test(d)?d+'-01':/^(\d{4})-Q(\d)$/.test(d)?d.slice(0,4)+'-'+String(d[6]*3-2).padStart(2,'0')+'-01':d;
const ago=n=>new Date(Date.now()-n*864e5);
function csvRow(l){const o=[];let c='',q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===','&&!q){o.push(c);c=''}else c+=ch}o.push(c);return o}
async function fredPts(id){const r=(await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id,{},1)).trim().split(/\r?\n/).slice(1).map(l=>l.split(',')).filter(p=>p[1]&&p[1]!=='.'&&!isNaN(+p[1])).map(p=>[p[0],+p[1]]);if(!r.length)throw new Error(id+' empty');return r}
const yoy=p=>{const[d,v]=p.at(-1),t=new Date(d).getTime()-365*864e5,b=p.find(x=>Math.abs(new Date(x[0])-t)<25*864e5);if(!b)throw new Error('no year-ago point');return[[d,(v/b[1]-1)*100]]};
const compound=p=>{if(p.length<4)throw new Error('<4 quarters');return[[p.at(-1)[0],(p.slice(-4).reduce((a,x)=>a*(1+x[1]/100),1)-1)*100]]};
async function eurostat(ds,q){const j=JSON.parse(await getText(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${ds}?format=JSON&lang=EN&${q}&lastTimePeriod=14`,{},2));const ix=j.dimension.time.category.index,o=[];for(const t of Object.keys(ix)){const v=j.value[ix[t]];if(v!=null)o.push([iso(t),v])}o.sort((a,b)=>a[0].localeCompare(b[0]));if(!o.length)throw new Error(ds+' empty');return o}
async function boc(id){const j=JSON.parse(await getText(`https://www.bankofcanada.ca/valet/observations/${id}/json?start_date=${ago(520).toISOString().slice(0,10)}`,{},2));return j.observations.map(o=>[o.d,+o[id].v]).filter(p=>!isNaN(p[1]))}
async function boe(){const f=ago(300);const t=await getText(`https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${String(f.getDate()).padStart(2,'0')}/${MON[f.getMonth()]}/${f.getFullYear()}&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`,{headers:{'User-Agent':'Mozilla/5.0 (compatible; FXFundamentalsPro/1.0)'}},2);
  const o=t.trim().split(/\r?\n/).slice(1).map(l=>csvRow(l)).map(p=>[new Date(p[0].trim()+' UTC'),+p[1]]).filter(p=>!isNaN(p[0])&&!isNaN(p[1])).map(([d,v])=>[d.toISOString().slice(0,10),v]);if(!o.length)throw new Error('BoE empty');return o}
async function ecbDfr(){const t=await getText(`https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=${ago(300).toISOString().slice(0,10)}`,{},2),L=t.trim().split(/\r?\n/),h=L[0].split(','),ti=h.indexOf('TIME_PERIOD'),vi=h.indexOf('OBS_VALUE'),o=L.slice(1).map(l=>l.split(',')).map(p=>[p[ti],+p[vi]]).filter(p=>!isNaN(p[1]));if(!o.length)throw new Error('ECB DFR empty');return o}
async function ons(path){const j=JSON.parse(await getText(`https://www.ons.gov.uk/${path}/data`,{},2));const o=(j.months||[]).map(m=>{const[y,mo]=m.date.split(' ');return[`${y}-${MONI[mo.toUpperCase()]}-01`,+m.value]}).filter(p=>!isNaN(p[1]));if(!o.length)throw new Error('ONS empty');return o}
async function bisAll(){
  const a=Object.values(BIS).join('+'),urls=[`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.${a}?lastNObservations=9&format=csv`,`https://stats.bis.org/api/v1/data/WS_CBPOL/M.${a}?lastNObservations=9&format=csv`,`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.${a}?lastNObservations=9`];let err;
  for(const u of urls)for(const ac of ['text/csv','application/vnd.sdmx.data+csv;version=1.0.0']){try{
    const L=(await getText(u,{headers:{Accept:ac}},1)).trim().split(/\r?\n/),h=csvRow(L[0]).map(x=>x.split(':')[0].trim()),ai=h.indexOf('REF_AREA'),ti=h.indexOf('TIME_PERIOD'),vi=h.indexOf('OBS_VALUE');
    if(ai<0||ti<0||vi<0)throw new Error('unexpected columns '+h.slice(0,5));
    const by={};for(const l of L.slice(1)){const p=csvRow(l),v=parseFloat(p[vi]);if(!isNaN(v))(by[p[ai].split(':')[0].trim()]??=[]).push([iso(p[ti]),v])}
    if(!Object.keys(by).length)throw new Error('no rows');for(const k in by)by[k].sort((x,y)=>x[0].localeCompare(y[0]));return by}catch(e){err=`BIS ${u.split('/')[4]} ${ac.slice(0,6)}: ${e.message}`}}
  throw new Error(err)}
const IMFC={USD:'USA',EUR:'EURO',GBP:'GBR',JPY:'JPN',CHF:'CHE',CAD:'CAN',AUD:'AUS',NZD:'NZL'},DBN={AUD:'AU',NZD:'NZ'};
async function imf(ind,code){const j=JSON.parse(await getText(`https://www.imf.org/external/datamapper/api/v1/${ind}/${code}`,{headers:{'User-Agent':UA}},2)),o=j.values?.[ind]?.[code]||{},y=new Date().getFullYear(),ks=Object.keys(o).map(Number).filter(k=>k<=y&&o[k]!=null).sort();if(!ks.length)throw new Error('IMF empty');return ks.map(k=>[`${k}-01-01`,+o[k]])}
function rbaDate(x){const m=(x||'').trim().match(/^(\d{1,2})[-\/ ]([A-Za-z]{3}|\d{1,2})[-\/ ](\d{4})$/);if(!m)return null;const mo=isNaN(m[2])?MON.findIndex(n=>n.toLowerCase()===m[2].toLowerCase())+1:+m[2];return mo?`${m[3]}-${String(mo).padStart(2,'0')}-${m[1].padStart(2,'0')}`:null}
async function rbaCpi(){
  const L=(await getText('https://www.rba.gov.au/statistics/tables/csv/g1-data.csv',{headers:{'User-Agent':UA}},2)).split(/\r?\n/).map(csvRow),
    sid=L.findIndex(r=>/^series id$/i.test((r[0]||'').trim())),ti=L.findIndex(r=>/^title$/i.test((r[0]||'').trim()));if(sid<0)throw new Error('RBA: Series ID row not found');
  let col=L[sid].findIndex(x=>x.trim()==='GCPIAGYP');if(col<0&&ti>=0)col=L[ti].findIndex(x=>/all groups/i.test(x)&&/(year|annual)/i.test(x));if(col<0)throw new Error('RBA: year-ended CPI column not found');
  const o=[];for(const r of L.slice(sid+1)){const d=rbaDate(r[0]),v=parseFloat(r[col]);if(d&&!isNaN(v))o.push([d,v])}if(!o.length)throw new Error('RBA: no rows');return o}
async function dbn(path){const j=JSON.parse(await getText(`https://api.db.nomics.world/v22/series/${path}?observations=1`,{headers:{'User-Agent':UA}},2)),d=j.series?.docs?.[0];if(!d)throw new Error('DBnomics empty');const o=d.period.map((p,i)=>[iso(p),+d.value[i]]).filter(p=>!isNaN(p[1]));if(!o.length)throw new Error('DBnomics no obs');return o}
const fresh=p=>Date.now()-new Date(p.at(-1)[0])<400*864e5;
async function pick(chain,diag,label,need){for(const[src,fn]of chain){try{const p=await fn();if(p?.length&&(!need||fresh(p)))return{pts:p,src};diag.push(`${label} ${src}: ${p?.length?'stale':'empty'}`)}catch(e){diag.push(`${label} ${src}: ${e.message}`)}}return null}
const POLS={USD:[['FRED DFEDTARU',()=>fredPts('DFEDTARU')],['FRED FEDFUNDS',()=>fredPts('FEDFUNDS')]],EUR:[['ECB DFR',ecbDfr]],GBP:[['BoE Bank Rate',boe]],CAD:[['BoC target rate',()=>boc('V39079')]]};
const CPIS={USD:[['FRED CPIAUCSL',async()=>yoy(await fredPts('CPIAUCSL'))]],EUR:[['Eurostat HICP',()=>eurostat('prc_hicp_manr','geo=EA&coicop=CP00&unit=RCH_A')]],GBP:[['ONS CPI D7G7',()=>ons('economy/inflationandpriceindices/timeseries/d7g7/mm23')]],CAD:[['BoC CPI index',async()=>yoy(await boc('V41690973'))]],AUD:[['RBA G1 year-ended CPI (quarterly)',rbaCpi]]};
const UNS={USD:[['FRED UNRATE',()=>fredPts('UNRATE')]],EUR:['EA20','EA21','EA'].map(g=>[`Eurostat une_rt_m ${g}`,()=>eurostat('une_rt_m',`geo=${g}&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT`)]),GBP:[['ONS MGSX',()=>ons('employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms')]]};
const GDPS={USD:[['FRED GDPC1 y/y',async()=>yoy(await fredPts('GDPC1'))]],EUR:[['Eurostat namq_10_gdp',()=>eurostat('namq_10_gdp','geo=EA&unit=CLV_PCH_SM&s_adj=SCA&na_item=B1GQ')]]};
async function fundamentals(){
  const cur=Object.keys(BIS),diag=[];let bp;const bm=()=>bp??=bisAll();
  const imfT=(ind,c)=>[['IMF WEO annual estimate (last resort)',()=>imf(ind,IMFC[c])]];
  const chains={
    rate:c=>[...(POLS[c]||[]),['BIS WS_CBPOL',async()=>{const s=(await bm())[BIS[c]];if(!s)throw new Error('area missing');return s}],...CCs[c].flatMap(k=>['IRSTCB01','IRSTCI01','IR3TIB01'].map(p=>[`OECD ${p} rate proxy`,()=>fredPts(`${p}${k}M156N`)]))],
    cpi:c=>{const f=FQ[c]||'M';return[...(CPIS[c]||[]),...(I3[c]?[[`FRED ${I3[c]}CPIALL${f}INMEI (y/y from index)`,async()=>yoy(await fredPts(`${I3[c]}CPIALL${f}INMEI`))]]:[]),...CCs[c].map(k=>[`OECD CPALTT01${k}`,()=>fredPts(`CPALTT01${k}${f}659N`)]),...(DBN[c]?[['DBnomics IMF/CPI y/y',()=>dbn(`IMF/CPI/Q.${DBN[c]}.PCPI_PC_CP_A_PT`)],['DBnomics IMF/CPI index (y/y)',async()=>yoy(await dbn(`IMF/CPI/Q.${DBN[c]}.PCPI_IX`))]]:[]),...imfT('PCPIPCH',c)]},
    unemp:c=>[...(UNS[c]||[]),...CCs[c].flatMap(k=>['M','Q'].flatMap(f=>[['LRHUTTTT','156S'],['LRUNTTTT','156S']].map(([p,x])=>[`OECD ${p}${k}${f}`,()=>fredPts(`${p}${k}${f}${x}`)]))),...imfT('LUR',c)],
    gdp:c=>[...(GDPS[c]||[]),...CCs[c].flatMap(k=>[[`OECD NAEXKP01${k} y/y`,()=>fredPts(`NAEXKP01${k}Q659S`)],[`OECD NAEXKP01${k} 4q compounded`,async()=>compound(await fredPts(`NAEXKP01${k}Q657S`))]]),...imfT('NGDP_RPCH',c)]};
  const val=r=>r&&{value:+r.pts.at(-1)[1].toFixed(2),date:r.pts.at(-1)[0],src:r.src};
  const rows=await Promise.all(cur.map(async c=>{const r=await pick(chains.rate(c),diag,c+' rate',false),o={rate:null,cpi:null,gdp:null,unemp:null};
    const px=r&&r.src.includes('proxy')&&!fresh(r.pts)?null:r;o.rate=val(px);
    if(px){const last=px.pts.at(-1),cut=new Date(last[0]).getTime()-190*864e5,old=px.pts.find(p=>new Date(p[0])>=cut)||px.pts[0],d=last[1]-old[1];
      o.stance={value:d>=.5?2:d>.05?1:d<=-.5?-2:d<-.05?-1:0,basis:`derived from policy-rate change ${d>=0?'+':''}${d.toFixed(2)}pp since ${old[0]}`}}
    for(const m of['cpi','gdp','unemp'])o[m]=val(await pick(chains[m](c),diag,`${c} ${m}`,true));return[c,o]}));
  const data=Object.fromEntries(rows);
  if(cur.every(c=>!data[c].rate&&!data[c].cpi&&!data[c].gdp&&!data[c].unemp))throw new Error('No fundamentals source reachable: '+[...new Set(diag)].slice(0,6).join(' | '));
  const missing=[];cur.forEach(c=>['rate','cpi','gdp','unemp'].forEach(m=>{if(!data[c][m])missing.push(c+'.'+m)}));
  return{data,missing,errors:{detail:[...new Set(diag)]},sources:'ECB, BoE, BoC, ONS, Eurostat, BIS, FRED (OECD/BLS series). Each value shows its own source and date.'}}
// ---- HTTP
const send=(res,code,body,type='application/json')=>{res.writeHead(code,{'Content-Type':type});res.end(typeof body==='string'?body:JSON.stringify(body))};
http.createServer(async(req,res)=>{
  const o=req.headers.origin;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Strict-Transport-Security','max-age=15552000');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'");res.setHeader('Cross-Origin-Resource-Policy','same-site');
  if(o&&ORIGINS.includes(o)){res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin')}
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  const p=new URL(req.url,'http://x').pathname;
  try{
    if(p==='/api/health')return send(res,200,{ok:true,uptime:process.uptime(),time:new Date().toISOString()});
    if(p==='/api/history')return send(res,200,await cached('h',36e5,ecb));
    if(p==='/api/dashboard')return send(res,200,await cached('d',3e5,dashboard));
    if(p==='/api/fundamentals')return send(res,200,await cached('f',18e5,fundamentals));
    if(p==='/api/news'){if(!news.length)await firstPoll.catch(()=>{});return send(res,200,{items:news.filter(n=>!noise(n.title,n.summary)).map(present),lastPoll,cacheSeconds:900})}
    if(p==='/api/news/status')return send(res,200,{count:news.length,high:news.filter(n=>n.impact==='HIGH').length,lastPoll,clients:clients.size});
    if(p==='/api/news/stream'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write(': connected\n\n');clients.add(res);const hb=setInterval(()=>res.write(': hb\n\n'),25000);return req.on('close',()=>{clearInterval(hb);clients.delete(res)})}
    if(STATIC[p])return send(res,200,fs.readFileSync(path.join(__dirname,'public',STATIC[p])),'text/html; charset=utf-8');
    send(res,404,{error:'Not found'});
  }catch(e){send(res,502,{error:'Upstream unavailable',detail:e.message})}
}).listen(PORT,()=>console.log('FX API on',PORT));
