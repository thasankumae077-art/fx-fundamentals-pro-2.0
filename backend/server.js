const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000;
const ORIGINS=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const STATIC={'/':'index.html','/index.html':'index.html'}; // whitelist: nothing else is served from disk
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cache={};
async function getText(url,opt={},tries=4){let e;for(let i=0;i<tries;i++){try{const r=await fetch(url,{...opt,headers:{'User-Agent':'FXFundamentalsPro/1.0',...(opt.headers||{})},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}catch(x){e=x;await sleep(500*2**i)}}throw e}
const flight={};
async function cached(key,ttl,fn,force){const c=cache[key];if(c&&Date.now()-c.t<(force?Math.min(ttl,6e4):ttl))return{...c.v,stale:false,fetchedAt:c.t};try{const v=await(flight[key]??=fn().finally(()=>{delete flight[key]}));cache[key]={t:Date.now(),v};return{...v,stale:false,fetchedAt:cache[key].t}}catch(e){if(c)return{...c.v,stale:true,fetchedAt:c.t,error:e.message};throw e}}

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

// ---- Cross-asset prices & 60d correlations (Metals, Indices, Crypto, Crude Oil)
const YF_ASSETS={
  XAUUSD:'GC=F',
  XAGUSD:'SI=F',
  US30:'^DJI',
  NAS100:'^NDX',
  SPX500:'^GSPC',
  BTCUSD:'BTC-USD',
  USOIL:'CL=F',
  UKOIL:'BZ=F',
  USD:'DX-Y.NYB',
  CAD:'CAD=X'
};
async function yfSeries(ticker){
  const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=4mo&interval=1d`;
  const j=JSON.parse(await getText(u,{headers:{'User-Agent':UA}},2));
  const res=j?.chart?.result?.[0];
  const ts=res?.timestamp||[],cl=res?.indicators?.quote?.[0]?.close||[];
  const pts=[];
  for(let i=0;i<ts.length;i++){
    if(cl[i]!=null&&!isNaN(cl[i]))pts.push({d:new Date(ts[i]*1000).toISOString().slice(0,10),v:+cl[i]});
  }
  if(pts.length<25)throw new Error('insufficient points for '+ticker);
  return pts;
}
function logRets(pts,len=60){
  const s=pts.slice(-(len+1)),r=[];
  for(let i=1;i<s.length;i++)r.push(Math.log(s[i].v/s[i-1].v));
  return r;
}
function corrArr(a,b){
  const n=Math.min(a.length,b.length);
  if(n<15)return null;
  const x=a.slice(-n),y=b.slice(-n);
  const mx=x.reduce((s,v)=>s+v,0)/n,my=y.reduce((s,v)=>s+v,0)/n;
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){const vx=x[i]-mx,vy=y[i]-my;num+=vx*vy;dx+=vx*vx;dy+=vy*vy}
  const den=Math.sqrt(dx*dy);
  return den?+(num/den).toFixed(2):0;
}
async function multiAssets(){
  const keys=Object.keys(YF_ASSETS),series={},rets={},data={},corr={};
  const rs=await Promise.allSettled(keys.map(k=>yfSeries(YF_ASSETS[k])));
  keys.forEach((k,i)=>{
    if(rs[i].status==='fulfilled'){
      const pts=rs[i].value;
      series[k]=pts;
      rets[k]=logRets(pts,60);
      const last=pts.at(-1).v,prev1=pts.at(-2)?.v,prev21=pts[Math.max(0,pts.length-22)]?.v;
      data[k]={
        price:+last.toFixed(4),
        date:pts.at(-1).d,
        d1:prev1?+(last/prev1-1).toFixed(4):null,
        m1:prev21?+(last/prev21-1).toFixed(4):null
      };
    }
  });
  // Invert CAD=X (USD/CAD) so CAD represents CAD strength
  if(rets.CAD)rets.CAD=rets.CAD.map(v=>-v);
  keys.forEach(a=>{
    if(!rets[a])return;
    corr[a]={};
    keys.forEach(b=>{
      if(a!==b&&rets[b])corr[a][b]=corrArr(rets[a],rets[b]);
    });
  });
  return{data,corr,updatedAt:Date.now(),source:'Yahoo Finance daily closes (60d rolling log-return correlations)'};
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
const Q=[
  {cat:'Central Banks',q:'"central bank" OR Fed OR ECB OR "Bank of England" OR "Bank of Japan" interest rates'},
  {cat:'Currencies',q:'forex OR "currency markets" OR "US dollar" OR euro OR yen OR sterling'},
  {cat:'Macro & Rates',q:'inflation OR CPI OR "nonfarm payrolls" OR "Treasury yields" OR GDP'},
  {cat:'Macro & Rates',q:'site:reuters.com inflation OR economy OR "interest rates"'},
  {cat:'Currencies',q:'site:reuters.com forex OR currencies OR dollar'},
  ...[
    ['USD','"US dollar" OR "Federal Reserve" OR "dollar index"'],
    ['EUR','euro OR ECB OR eurozone OR EUR/USD'],
    ['GBP','sterling OR "Bank of England" OR GBP/USD'],
    ['JPY','yen OR "Bank of Japan" OR USD/JPY'],
    ['CHF','"Swiss franc" OR SNB OR "Swiss National Bank"'],
    ['CAD','"Canadian dollar" OR loonie OR "Bank of Canada"'],
    ['AUD','"Australian dollar" OR RBA OR "Reserve Bank of Australia"'],
    ['NZD','"New Zealand dollar" OR RBNZ OR kiwi'],
    ['XAUUSD','gold price OR XAUUSD OR bullion'],
    ['XAGUSD','silver price OR XAGUSD'],
    ['US30','Dow Jones OR US30 OR DJIA'],
    ['NAS100','Nasdaq 100 OR NAS100 OR NDX tech stocks'],
    ['SPX500','S&P 500 OR SPX500 OR Wall Street'],
    ['BTCUSD','bitcoin OR BTCUSD OR crypto market'],
    ['USOIL','WTI crude oil OR USOIL OR OPEC oil price'],
    ['UKOIL','Brent crude oil OR UKOIL']
  ].map(([tag,q])=>({cat:'Top Stories',tag,q}))
];
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const YF=q=>`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${q}&region=US&lang=en-US`;
const DIRECT=[
  ['https://www.fxstreet.com/rss/news','FXStreet','Top Stories'],
  ['https://www.fxempire.com/api/v1/en/articles/rss/news','FXEmpire','Top Stories'],
  ['https://www.investing.com/rss/news_1.rss','Investing.com','Top Stories'],
  ['https://www.investing.com/rss/news_11.rss','Investing.com','Top Stories'],
  ['https://www.dailyfx.com/feeds/market-news','DailyFX','Top Stories'],
  [YF('GC=F'),'Yahoo Finance','Top Stories','XAUUSD'],
  [YF('SI=F'),'Yahoo Finance','Top Stories','XAGUSD'],
  [YF('^DJI,^NDX,^GSPC'),'Yahoo Finance','Top Stories','NAS100'],
  [YF('BTC-USD'),'Yahoo Finance','Top Stories','BTCUSD'],
  [YF('CL=F,BZ=F'),'Yahoo Finance','Top Stories','USOIL'],
  [YF('EURUSD=X,GBPUSD=X,JPY=X,CHF=X,CAD=X,AUDUSD=X,NZDUSD=X'),'Yahoo Finance','Top Stories'],
  ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664','CNBC',null],
  ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258','CNBC',null],
  ['https://feeds.content.dowjones.io/public/rss/mw_marketpulse','MarketWatch',null],
  ['https://feeds.content.dowjones.io/public/rss/mw_topstories','MarketWatch',null]
];
const FEEDS=[['USD','https://www.federalreserve.gov/feeds/press_all.xml','Federal Reserve'],['EUR','https://www.ecb.europa.eu/rss/press.html','ECB'],['GBP','https://www.bankofengland.co.uk/rss/news','Bank of England'],['JPY','https://www.boj.or.jp/en/rss/whatsnew.xml','Bank of Japan'],['CHF','https://www.snb.ch/public/en/rss/pressrel','SNB'],['CAD','https://www.bankofcanada.ca/content_type/press-releases/feed/','Bank of Canada'],['AUD','https://www.rba.gov.au/rss/rss-cb-media-releases.xml','RBA'],['NZD','https://www.rbnz.govt.nz/feeds/news','RBNZ']];
const DRV_HI=[['Intervention',/interven(e|tion)|emergency (rate|meeting|cut|hike)/i],['Rate decision',/rate decision|rate (hike|cut)s?|\b(raises?|cuts?|holds?|lifts?|slashes|keeps|leaves|hikes?) (its |the )?(key |benchmark |policy |interest |cash )?rates?\b|interest[- ]rate (decision|announcement)|policy rate|monetary policy (decision|meeting|statement)|\bfomc\b|\bmpc\b|rba board|official cash rate|\bocr\b/i],['Central bank speech',/\b(fed|federal reserve|ecb|boe|bank of england|boj|bank of japan|rba|reserve bank|rbnz|boc|bank of canada|snb|swiss national bank)\b.*\b(says?|said|signals?|warns?|hints?|flags?|speech|testimony|remarks|statement|minutes|chair|governor)\b|\b(powell|lagarde|bailey|ueda|macklem|bullock|schlegel|breman)\b/i],['CPI / inflation',/\bcpi\b|\bpce\b|inflation|consumer prices?|producer prices?|\bppi\b/i],['GDP',/\bgdp\b|gross domestic product/i],['NFP / jobs',/non-?farm|\bnfp\b|payrolls?|unemployment|jobless (rate|claims)|jobs report|employment (data|report|change)|labou?r market/i],['OPEC / Inventories',/\b(opec|opec\+|eia|crude inventories|oil stockpiles)\b/i]];
const DRV_MED=[['Rate expectations',/(rate[- ])?(cut|hike)s? (bets|expectations|odds|hopes)|rate expectations|pricing in|fed funds futures/i],['PMI',/\bpmi\b|purchasing managers/i],['Retail sales',/retail sales/i],['Trade balance',/trade (balance|deficit|surplus|gap)|current account/i],['Consumer confidence',/(consumer|business) (confidence|sentiment)|\bzew\b|\bifo\b|michigan/i],['Bond yields',/\byields?\b|treasur(y|ies)|\bgilts?\b|\bbunds?\b|\bjgbs?\b|bond (market|sell-?off|rally)/i],['Analyst forecast',/forecast|outlook|predict|analysts?|strategists?|price target|projection/i],['Market sentiment',/risk (appetite|sentiment|aversion)|risk-(on|off)|safe[- ]haven|market sentiment|volatility|\bvix\b/i]];
const driverOf=t=>{for(const[n,r]of DRV_HI)if(r.test(t))return[n,'HIGH'];for(const[n,r]of DRV_MED)if(r.test(t))return[n,'MEDIUM'];return[null,'LOW']};

const tone=t=>{const h=/hike|raises? (interest )?rates?|hawkish|higher for longer|hotter|accelerat|\bbeats?\b/i.test(t),d=/\bcuts?\b|dovish|\beases?\b|easing|cools?|slows?|\bmiss(es)?\b/i.test(t);return h&&!d?'Hawkish':d&&!h?'Dovish':'Neutral'};
const move=t=>{const u=/\b(rall(y|ies|ied)|surg\w*|jump\w*|climb\w*|gains?|rises?|rose|record high|soar\w*|strengthen\w*|firms?|advances?|rebound\w*|higher)\b/i.test(t),d=/\b(falls?|fell|drops?|dropped|slump\w*|slid\w*|slides|declin\w*|tumbl\w*|sinks?|weaken\w*|lower|loses|losses|plung\w*|slips?|retreats?)\b/i.test(t);return u&&!d?'Up':d&&!u?'Down':'Flat'};

const SPORT=/\b(football|soccer|cricket|premier league|champions league|onefootball|nfl|nba|mlb|nhl|la liga|serie a|bundesliga|touchdown|quarterback)\b/i,AMBIG=/\b(match(es)?|goals?|transfers?)\b/i,FIN=/\b(forex|fx|currency|currencies|rates?|inflation|cpi|gdp|fed|ecb|boe|boj|snb|rba|yields?|treasur\w*|central bank|bonds?|gold|silver|dollar|euro|yen|sterling|payrolls?|econom\w*|markets?|nasdaq|dow|s&p|bitcoin|crypto|oil|wti|brent|opec)\b/i;
const noise=(t,sm='')=>SPORT.test(t+' '+sm)||(AMBIG.test(t)&&!FIN.test(t));
const CURX={
  USD:/\b(usd|u\.?s\.? dollar|dollar index|greenback|fed\b|federal reserve|fomc|powell|treasur)|(?<!canadian |australian |new zealand |hong kong )\bdollar\b/i,
  EUR:/\b(eur\b|euro\b|ecb|lagarde|eurozone)/i,
  GBP:/\b(gbp|sterling|pound|boe\b|bank of england|bailey)/i,
  JPY:/\b(jpy|yen|boj\b|bank of japan|ueda)/i,
  CHF:/\b(chf|franc|snb\b|swiss)/i,
  CAD:/\b(cad\b|loonie|bank of canada|canadian)/i,
  AUD:/\b(aud\b|aussie|rba\b|australia)/i,
  NZD:/\b(nzd|kiwi|rbnz|new zealand)/i,
  XAUUSD:/\b(gold|bullion|xau|xauusd)\b/i,
  XAGUSD:/\b(silver|xag|xagusd)\b/i,
  US30:/\b(dow|dow jones|us30|djia|dj30)\b/i,
  NAS100:/\b(nasdaq|nas100|ndx|ustec|tech stocks)\b/i,
  SPX500:/\b(s&p 500|s&p|spx500|spx|us500|wall street)\b/i,
  BTCUSD:/\b(bitcoin|btc|btcusd|crypto|cryptocurrency)\b/i,
  USOIL:/\b(wti|usoil|crude oil|oil prices?|opec)\b/i,
  UKOIL:/\b(brent|ukoil|north sea oil)\b/i
};
const detectCur=t=>Object.keys(CURX).filter(c=>CURX[c].test(t)).slice(0,6);
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
  if(fresh.length){news=[...fresh,...news].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,450);
    if(idx.size>3000){idx.clear();news.forEach(n=>idx.set(n.id,n))}
    const msg=`event: news\ndata: ${JSON.stringify(fresh.map(present))}\n\n`;clients.forEach(c=>c.write(msg))}
  enrich(fresh).catch(()=>{});
}
const loop=()=>pollNews().catch(()=>{}).finally(()=>setTimeout(loop,9e5));const firstPoll=loop();

// ---- Fundamentals (auto)
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
const smemo={};const memo=(k,ttl,fn)=>{const c=smemo[k];if(c&&Date.now()-c.t<ttl)return c.p;const p=Promise.resolve().then(fn);smemo[k]={t:Date.now(),p};p.catch(()=>{if(smemo[k]?.p===p)delete smemo[k]});return p};
async function bisFetch(freq,n){
  const a=Object.values(BIS).join('+'),urls=[`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/${freq}.${a}?lastNObservations=${n}&format=csv`,`https://stats.bis.org/api/v1/data/WS_CBPOL/${freq}.${a}?lastNObservations=${n}&format=csv`,`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/${freq}.${a}?lastNObservations=${n}`];let err;
  for(const u of urls)for(const ac of['text/csv','application/vnd.sdmx.data+csv;version=1.0.0']){try{
    const L=(await getText(u,{headers:{Accept:ac}},1)).trim().split(/\r?\n/),h=csvRow(L[0]).map(x=>x.split(':')[0].trim()),ai=h.indexOf('REF_AREA'),ti=h.indexOf('TIME_PERIOD'),vi=h.indexOf('OBS_VALUE');
    if(ai<0||ti<0||vi<0)throw new Error('unexpected columns '+h.slice(0,5));
    const by={};for(const l of L.slice(1)){const p=csvRow(l),v=parseFloat(p[vi]);if(!isNaN(v))(by[p[ai].split(':')[0].trim()]??=[]).push([iso(p[ti]),v])}
    if(!Object.keys(by).length)throw new Error('no rows');for(const k in by)by[k].sort((x,y)=>x[0].localeCompare(y[0]));return by}catch(e){err=`BIS ${freq} ${u.split('/')[4]} ${ac.slice(0,6)}: ${e.message}`}}
  throw new Error(err)}
const bis=f=>memo('bis'+f,18e5,()=>bisFetch(f,f==='D'?240:9));
const IMFC={USD:'USA',EUR:'EURO',GBP:'GBR',JPY:'JPN',CHF:'CHE',CAD:'CAN',AUD:'AUS',NZD:'NZL'};
async function imf(ind,code){const j=JSON.parse(await getText(`https://www.imf.org/external/datamapper/api/v1/${ind}/${code}`,{headers:{'User-Agent':UA}},2)),o=j.values?.[ind]?.[code]||{},y=new Date().getFullYear(),ks=Object.keys(o).map(Number).filter(k=>k<=y&&o[k]!=null).sort();if(!ks.length)throw new Error('IMF empty');return ks.map(k=>[`${k}-01-01`,+o[k]])}
function rbaDate(x){const m=(x||'').trim().match(/^(\d{1,2})[-\/ ]([A-Za-z]{3}|\d{1,2})[-\/ ](\d{4})$/);if(!m)return null;const mo=isNaN(m[2])?MON.findIndex(n=>n.toLowerCase()===m[2].toLowerCase())+1:+m[2];return mo?`${m[3]}-${String(mo).padStart(2,'0')}-${m[1].padStart(2,'0')}`:null}
async function rbaCsv(tbl,sid,rx){
  const L=(await memo('rba'+tbl,36e5,()=>getText(`https://www.rba.gov.au/statistics/tables/csv/${tbl}-data.csv`,{headers:{'User-Agent':UA}},2))).split(/\r?\n/).map(csvRow),si=L.findIndex(r=>/^series id$/i.test((r[0]||'').trim())),ti=L.findIndex(r=>/^title$/i.test((r[0]||'').trim()));
  if(si<0)throw new Error(`RBA ${tbl}: Series ID row not found`);let col=L[si].findIndex(x=>x.trim()===sid);if(col<0&&rx&&ti>=0)col=L[ti].findIndex(x=>rx.test(x));if(col<0)throw new Error(`RBA ${tbl}: column ${sid} not found`);
  const o=[];for(const r of L.slice(si+1)){const d=rbaDate(r[0]),v=parseFloat(r[col]);if(d&&!isNaN(v))o.push([d,v])}if(!o.length)throw new Error(`RBA ${tbl}: no rows`);return o}
async function statcan(vec,n=16){const j=JSON.parse(await getText('https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':UA},body:JSON.stringify([{vectorId:vec,latestN:n}])},2)),p=j?.[0]?.object?.vectorDataPoint;if(!p?.length)throw new Error('StatCan empty');return p.map(x=>[x.refPer,+x.value]).filter(x=>!isNaN(x[1]))}
async function onsQ(path){const j=JSON.parse(await getText(`https://www.ons.gov.uk/${path}/data`,{},2)),o=(j.quarters||[]).map(m=>{const[y,q]=m.date.split(' ');return[`${y}-${String(+q.slice(1)*3-2).padStart(2,'0')}-01`,+m.value]}).filter(p=>!isNaN(p[1]));if(!o.length)throw new Error('ONS quarters empty');return o}
async function oecdCpi(area,freq){const t=await memo(`oecd${area}${freq}`,216e5,()=>getText(`https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/${area}.${freq}.N.CPI.PA._T.N.GY?startPeriod=${new Date().getFullYear()-2}&dimensionAtObservation=AllDimensions&format=csvfilewithlabels`,{headers:{'User-Agent':UA}},1)),L=t.trim().split(/\r?\n/),h=csvRow(L[0]),ti=h.indexOf('TIME_PERIOD'),vi=h.indexOf('OBS_VALUE');if(ti<0||vi<0)throw new Error('OECD: unexpected columns');const o=L.slice(1).map(csvRow).map(r=>[iso(r[ti]),parseFloat(r[vi])]).filter(p=>!isNaN(p[1]));if(!o.length)throw new Error('OECD empty');return o}
const TEN={USD:'united states',EUR:'euro area',GBP:'united kingdom',JPY:'japan',CHF:'switzerland',CAD:'canada',AUD:'australia',NZD:'new zealand'},TEC={rate:/^interest rate$/i,cpi:/^inflation rate$/i,gdp:/^gdp annual growth rate$/i,unemp:/^unemployment rate$/i};
async function te(c,m){const j=await memo('te'+c,216e5,async()=>JSON.parse(await getText(`https://api.tradingeconomics.com/country/${encodeURIComponent(TEN[c])}?c=guest:guest&f=json`,{headers:{'User-Agent':UA}},1))),r=Array.isArray(j)&&j.find(x=>TEC[m].test(x.Category||x.Title||''));if(!r||r.LatestValue==null||!r.LatestValueDate)throw new Error('not available on TE guest tier');return[[String(r.LatestValueDate).slice(0,10),+r.LatestValue]]}
const age=p=>(Date.now()-new Date(p.at(-1)[0]))/864e5;
async function pick(chain,diag,label,maxAge){
  let best=null,imfR=null;
  for(const[src,fn]of chain){try{let p=await fn();if(!p?.length){diag.push(`${label} ${src}: empty`);continue}p=[...p].sort((a,b)=>a[0].localeCompare(b[0]));
    if(/IMF/.test(src)){imfR??={pts:p,src};continue}
    const lim=/proxy/.test(src)?150:maxAge;if(age(p)<=lim)return{pts:p,src,stale:false};
    diag.push(`${label} ${src}: latest ${p.at(-1)[0]} is older than ${lim}d`);if(!best||p.at(-1)[0]>best.pts.at(-1)[0])best={pts:p,src,stale:true}}catch(e){diag.push(`${label} ${src}: ${e.message}`)}}
  return best||(imfR&&age(imfR.pts)<=420?{...imfR,stale:true}:null)}
const EU=(ds,q)=>()=>eurostat(ds,q),UNQ=g=>`geo=${g}&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT`,GDQ=g=>`geo=${g}&unit=CLV_PCH_SM&s_adj=SCA&na_item=B1GQ`,CPQ=g=>`geo=${g}&coicop=CP00&unit=RCH_A`,EAG=['EA','EA20','EA21'];
const PRI={
 rate:{USD:[['FRED DFEDTARU',()=>fredPts('DFEDTARU')],['FRED FEDFUNDS',()=>fredPts('FEDFUNDS')]],EUR:[['ECB deposit facility rate',ecbDfr]],GBP:[['BoE Bank Rate',boe]],CAD:[['BoC target rate',()=>boc('V39079')]],AUD:[['RBA cash rate target (F1)',()=>rbaCsv('f1','FIRMMCRT',/cash rate target/i)]]},
 cpi:{USD:[['FRED CPIAUCSL (y/y)',async()=>yoy(await fredPts('CPIAUCSL'))]],EUR:EAG.map(g=>[`Eurostat HICP ${g}`,EU('prc_hicp_manr',CPQ(g))]),GBP:[['ONS CPI D7G7',()=>ons('economy/inflationandpriceindices/timeseries/d7g7/mm23')],['Eurostat HICP UK',EU('prc_hicp_manr',CPQ('UK'))]],JPY:[['OECD CPI JPN (monthly)',()=>oecdCpi('JPN','M')]],CHF:[['Eurostat HICP CH',EU('prc_hicp_manr',CPQ('CH'))],['OECD CPI CHE (monthly)',()=>oecdCpi('CHE','M')]],CAD:[['StatCan CPI v41690973 (y/y)',async()=>yoy(await statcan(41690973,16))],['BoC CPI index (y/y)',async()=>yoy(await boc('V41690973'))]],AUD:[['RBA G1 year-ended CPI (quarterly)',()=>rbaCsv('g1','GCPIAGYP',/all groups.*(year|annual)/i)],['OECD CPI AUS (quarterly)',()=>oecdCpi('AUS','Q')]],NZD:[['OECD CPI NZL (quarterly)',()=>oecdCpi('NZL','Q')]]},
 unemp:{USD:[['FRED UNRATE',()=>fredPts('UNRATE')],['Eurostat une_rt_m US',EU('une_rt_m',UNQ('US'))]],EUR:EAG.map(g=>[`Eurostat une_rt_m ${g}`,EU('une_rt_m',UNQ(g))]),GBP:[['ONS MGSX',()=>ons('employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms')]],JPY:[['Eurostat une_rt_m JP',EU('une_rt_m',UNQ('JP'))]],CHF:[['Eurostat une_rt_m CH',EU('une_rt_m',UNQ('CH'))]],CAD:[['StatCan LFS v2062815',()=>statcan(2062815,16)]],AUD:[['RBA H5 unemployment rate',()=>rbaCsv('h5','GLFSURSA',/unemployment rate.*season/i)]]},
 gdp:{USD:[['FRED GDPC1 (y/y)',async()=>yoy(await fredPts('GDPC1'))]],EUR:EAG.map(g=>[`Eurostat GDP ${g}`,EU('namq_10_gdp',GDQ(g))]),GBP:[['ONS ABMI quarterly (y/y)',async()=>yoy(await onsQ('economy/grossdomesticproductgdp/timeseries/abmi/ukea'))]],CHF:[['Eurostat GDP CH',EU('namq_10_gdp',GDQ('CH'))]],CAD:[['StatCan real GDP v65201210 (y/y)',async()=>yoy(await statcan(65201210,16))]],AUD:[['RBA H1 GDP year-ended',()=>rbaCsv('h1','GGDPECCVPSYP',/(gross domestic product|gdp).*(year|through)/i)]]}};
const TAIL={
 rate:c=>[['BIS daily policy rate',async()=>{const s=(await bis('D'))[BIS[c]];if(!s)throw new Error('area missing');return s}],['BIS monthly policy rate',async()=>{const s=(await bis('M'))[BIS[c]];if(!s)throw new Error('area missing');return s}],['TradingEconomics (guest)',()=>te(c,'rate')],...CCs[c].flatMap(k=>['IRSTCB01','IRSTCI01','IR3TIB01'].map(p=>[`OECD ${p} rate proxy`,()=>fredPts(`${p}${k}M156N`)]))],
 cpi:c=>{const f=FQ[c]||'M';return[['TradingEconomics (guest)',()=>te(c,'cpi')],...(I3[c]?[[`FRED ${I3[c]}CPIALL${f}INMEI (y/y)`,async()=>yoy(await fredPts(`${I3[c]}CPIALL${f}INMEI`))]]:[]),...CCs[c].map(k=>[`OECD CPALTT01${k}`,()=>fredPts(`CPALTT01${k}${f}659N`)]),['IMF WEO annual estimate (last resort)',()=>imf('PCPIPCH',IMFC[c])]]},
 unemp:c=>[['TradingEconomics (guest)',()=>te(c,'unemp')],...CCs[c].flatMap(k=>['M','Q'].flatMap(f=>[['LRHUTTTT','156S'],['LRUNTTTT','156S']].map(([p,x])=>[`OECD ${p}${k}${f}`,()=>fredPts(`${p}${k}${f}${x}`)]))),['IMF WEO annual estimate (last resort)',()=>imf('LUR',IMFC[c])]],
 gdp:c=>[['TradingEconomics (guest)',()=>te(c,'gdp')],...CCs[c].flatMap(k=>[[`OECD NAEXKP01${k} y/y`,()=>fredPts(`NAEXKP01${k}Q659S`)],[`OECD NAEXKP01${k} 4q compounded`,async()=>compound(await fredPts(`NAEXKP01${k}Q657S`))]]),['IMF WEO annual estimate (last resort)',()=>imf('NGDP_RPCH',IMFC[c])]]};
const qtr=(m,c)=>m==='gdp'||(m==='cpi'&&FQ[c])||(m==='unemp'&&c==='NZD'),MAXA=(m,c)=>m==='rate'?9999:qtr(m,c)?200:90;
const plabel=(m,c,d,src)=>{const y=d.slice(0,4),mo=+d.slice(5,7);return/IMF/.test(src)?`${y} annual est.`:m==='rate'?`as of ${d}`:qtr(m,c)?`Q${Math.ceil(mo/3)} ${y}`:`${MON[mo-1]} ${y}`};
async function fundamentals(){
  const cur=Object.keys(BIS),diag=[],prev=cache.f?.v?.data||null,now=Date.now(),MS=['rate','cpi','gdp','unemp'];
  const val=(m,c,r)=>{if(!r)return null;const[d,v]=r.pts.at(-1),o={value:+v.toFixed(2),date:d,label:plabel(m,c,d,r.src),src:r.src,stale:!!r.stale},p=prev?.[c]?.[m];
    if(p){const ch=p.date!==o.date||p.value!==o.value;o.since=ch?now:p.since;o.isNew=!!o.since&&now-o.since<48*36e5}return o};
  const rows=await Promise.all(cur.map(async c=>{
    const rs=await Promise.all(MS.map(m=>pick([...(PRI[m][c]||[]),...TAIL[m](c)],diag,`${c} ${m}`,MAXA(m,c)))),o={};MS.forEach((m,i)=>o[m]=val(m,c,rs[i]));
    const r=rs[0];if(r){const last=r.pts.at(-1),cut=new Date(last[0]).getTime()-190*864e5,old=r.pts.find(p=>new Date(p[0])>=cut)||r.pts[0],d=last[1]-old[1];
      o.stance={value:d>=.5?2:d>.05?1:d<=-.5?-2:d<-.05?-1:0,basis:`derived from policy-rate change ${d>=0?'+':''}${d.toFixed(2)}pp since ${old[0]}`}}
    return[c,o]}));
  const data=Object.fromEntries(rows);
  if(cur.every(c=>MS.every(m=>!data[c][m])))throw new Error('No fundamentals source reachable: '+[...new Set(diag)].slice(0,6).join(' | '));
  const missing=[];cur.forEach(c=>MS.forEach(m=>{if(!data[c][m])missing.push(c+'.'+m)}));
  return{data,updatedAt:now,missing,errors:{detail:[...new Set(diag)]},sources:'Official feeds first (Fed/FRED, ECB, BoE, BoC, RBA, StatCan, ONS, Eurostat), then BIS/OECD/TradingEconomics guest; IMF annual estimates only as a last resort.'}}
setTimeout(()=>cached('f',18e5,fundamentals).catch(()=>{}),4000);
setInterval(()=>cached('f',0,fundamentals,true).catch(()=>{}),18e5);

// ---- Economic calendar (Forex Factory public feed via faireconomy.media) + CFTC COT
const CAL_THIS=['https://nfs.faireconomy.media/ff_calendar_thisweek.json','https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json'],CAL_NEXT=['https://nfs.faireconomy.media/ff_calendar_nextweek.json','https://cdn-nfs.faireconomy.media/ff_calendar_nextweek.json'],MAJ=['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD'];
async function firstJson(urls){let e;for(const u of urls){try{return JSON.parse(await getText(u,{headers:{'User-Agent':UA}},2))}catch(x){e=x}}throw e}
async function calendar(){
  const[w,n]=await Promise.allSettled([firstJson(CAL_THIS),firstJson(CAL_NEXT)]);
  if(w.status!=='fulfilled'||!Array.isArray(w.value))throw new Error('Calendar feed unavailable: '+(w.reason?.message||'bad format'));
  const raw=[...w.value,...(n.status==='fulfilled'&&Array.isArray(n.value)?n.value:[])];
  const items=raw.filter(e=>MAJ.includes(e.country||e.currency)&&e.date).map(e=>({title:e.title,currency:e.country||e.currency,impact:/^(high|medium|low)$/i.test(e.impact||'')?e.impact[0].toUpperCase()+e.impact.slice(1).toLowerCase():'Low',timestamp:(d=>isNaN(d)?null:d.toISOString())(new Date(e.date)),forecast:e.forecast||null,previous:e.previous||null,actual:e.actual||null}));
  const ok=items.filter(e=>e.timestamp).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  if(!ok.length)throw new Error('Calendar feed returned no events');
  return{items:ok,source:'Forex Factory public calendar feed (faireconomy.media). Actuals appear only if the feed supplies them.'}}
const COT_MK={EUR:'099741',GBP:'096742',JPY:'097741',CHF:'092741',CAD:'090741',AUD:'232741',NZD:'112741',USD:'098662'};
async function cot(){
  const codes=Object.values(COT_MK).map(c=>`'${c}'`).join(','),url=`https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${encodeURIComponent(`cftc_contract_market_code in(${codes})`)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}&$limit=64`;
  const rows=JSON.parse(await getText(url,{headers:{'User-Agent':UA,Accept:'application/json'}},3));
  if(!Array.isArray(rows)||!rows.length)throw new Error('CFTC returned no rows');
  const n=x=>x==null||x===''?NaN:+String(x).replace(/,/g,''),by={},pick=(r,...k)=>{for(const f of k)if(r[f]!=null)return n(r[f]);return NaN};
  for(const r of rows){const k=Object.keys(COT_MK).find(c=>COT_MK[c]===String(r.cftc_contract_market_code).trim());if(k)(by[k]??=[]).push(r)}
  const data={},net=r=>pick(r,'noncomm_positions_long_all','lev_money_positions_long_all','lev_money_positions_long')-pick(r,'noncomm_positions_short_all','lev_money_positions_short_all','lev_money_positions_short');
  for(const[k,rs]of Object.entries(by)){rs.sort((a,b)=>String(b.report_date_as_yyyy_mm_dd).localeCompare(String(a.report_date_as_yyyy_mm_dd)));const r=rs[0],pv=rs[1],L=pick(r,'noncomm_positions_long_all','lev_money_positions_long_all','lev_money_positions_long'),S=pick(r,'noncomm_positions_short_all','lev_money_positions_short_all','lev_money_positions_short'),oi=pick(r,'open_interest_all');
    if(isNaN(L)||isNaN(S))continue;let ch=pick(r,'change_in_noncomm_long_all','change_in_lev_money_long_all','change_in_lev_money_long')-pick(r,'change_in_noncomm_short_all','change_in_lev_money_short_all','change_in_lev_money_short');
    if(isNaN(ch)&&pv)ch=net(r)-net(pv);
    data[k]={date:String(r.report_date_as_yyyy_mm_dd).slice(0,10),long:L,short:S,net:L-S,change:isNaN(ch)?null:ch,oi:isNaN(oi)?null:oi,market:r.market_and_exchange_names||null}}
  if(!Object.keys(data).length)throw new Error('CFTC fields not recognised');
  return{data,missing:Object.keys(COT_MK).filter(k=>!data[k]),source:'CFTC Commitments of Traders (futures only). Net = non-commercial long − short; weekly change vs prior report. USD = ICE US Dollar Index. Published Fridays for Tuesday positions.'}}

// ---- HTTP
const send=(res,code,body,type='application/json')=>{res.writeHead(code,{'Content-Type':type});res.end(typeof body==='string'?body:JSON.stringify(body))};
http.createServer(async(req,res)=>{
  const o=req.headers.origin;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Strict-Transport-Security','max-age=15552000');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'");res.setHeader('Cross-Origin-Resource-Policy','same-site');
  if(o&&ORIGINS.includes(o)){res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin')}
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  const U=new URL(req.url,'http://x'),p=U.pathname,force=U.searchParams.get('force')==='1';
  try{
    if(p==='/api/health')return send(res,200,{ok:true,uptime:process.uptime(),time:new Date().toISOString()});
    if(p==='/api/history')return send(res,200,await cached('h',36e5,ecb));
    if(p==='/api/assets')return send(res,200,await cached('assets',18e5,multiAssets,force));
    if(p==='/api/dashboard')return send(res,200,await cached('d',3e5,dashboard));
    if(p==='/api/fundamentals')return send(res,200,await cached('f',18e5,fundamentals,force));
    if(p==='/api/calendar')return send(res,200,await cached('c',18e5,calendar,force));
    if(p==='/api/cot')return send(res,200,await cached('cot',432e5,cot));
    if(p==='/api/news'){if(!news.length)await firstPoll.catch(()=>{});return send(res,200,{items:news.filter(n=>!noise(n.title,n.summary)).map(present),lastPoll,cacheSeconds:900})}
    if(p==='/api/news/status')return send(res,200,{count:news.length,high:news.filter(n=>n.impact==='HIGH').length,lastPoll,clients:clients.size});
    if(p==='/api/news/stream'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write(': connected\n\n');clients.add(res);const hb=setInterval(()=>res.write(': hb\n\n'),25000);return req.on('close',()=>{clearInterval(hb);clients.delete(res)})}
    if(STATIC[p])return send(res,200,fs.readFileSync(path.join(__dirname,'public',STATIC[p])),'text/html; charset=utf-8');
    send(res,404,{error:'Not found'});
  }catch(e){send(res,502,{error:'Upstream unavailable',detail:e.message})}
}).listen(PORT,()=>console.log('FX API on',PORT));
