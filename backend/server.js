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
async function fred(id){const rows=(await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id)).trim().split(/\r?\n/).slice(1).map(l=>l.split(',')).filter(p=>p[1]&&p[1]!=='.');const a=rows.at(-1),b=rows.at(-2);return{date:a[0],value:+a[1],prev:b?+b[1]:null}}
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
// ---- News
const Q={USD:'Federal Reserve OR "US dollar" OR "nonfarm payrolls"',EUR:'ECB OR euro OR eurozone inflation',GBP:'"Bank of England" OR sterling OR UK inflation',JPY:'"Bank of Japan" OR yen OR Japan intervention',CHF:'"Swiss National Bank" OR "Swiss franc"',CAD:'"Bank of Canada" OR "Canadian dollar"',AUD:'"Reserve Bank of Australia" OR "Australian dollar"',NZD:'RBNZ OR "New Zealand dollar"'};
const HI=/rate decision|rate (hike|cut)|(raises|cuts|holds|lifts|slashes) (interest )?rates?|\bcpi\b|nfp|nonfarm|payrolls|intervention|emergency|fomc|\bmpc\b|surprise/i;
const MED=/gdp|employment|unemployment|jobs|retail sales|pmi|minutes|speech|governor|powell|lagarde|bailey|ueda|testimony|inflation|central bank/i;
const triage=t=>HI.test(t)?'HIGH':MED.test(t)?'MEDIUM':'LOW';
const dec=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
function parseRss(x){return[...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{const g=t=>{const r=m[1].match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`));return r?dec(r[1].trim()):''};const d=new Date(g('pubDate'));return{title:g('title'),link:g('link'),source:g('source'),time:isNaN(d)?new Date().toISOString():d.toISOString()}})}
let news=[];const ids=new Set(),clients=new Set();let lastPoll=null;
async function pollNews(){
  const fresh=[];
  const rs=await Promise.allSettled(Object.entries(Q).map(async([cur,q])=>({cur,items:parseRss(await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q+' when:2d')}&hl=en-US&gl=US&ceid=US:en`,{},2))})));
  for(const r of rs){if(r.status!=='fulfilled')continue;for(const it of r.value.items){const norm=it.title.toLowerCase().replace(/ - [^-]+$/,'').replace(/[^a-z0-9]/g,'');const id=crypto.createHash('md5').update(norm).digest('hex').slice(0,12);
    const ex=news.find(n=>n.id===id)||fresh.find(n=>n.id===id);if(ex){if(!ex.cur.includes(r.value.cur))ex.cur.push(r.value.cur);continue}
    if(ids.has(id))continue;ids.add(id);fresh.push({id,...it,cur:[r.value.cur],impact:triage(it.title)})}}
  lastPoll=new Date().toISOString();
  if(fresh.length){news=[...fresh,...news].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,400);
    const keep=new Set(news.map(n=>n.id));for(const i of ids)if(!keep.has(i)&&ids.size>2000)ids.delete(i);
    const msg=`event: news\ndata: ${JSON.stringify(fresh)}\n\n`;clients.forEach(c=>c.write(msg))}
}
const loop=()=>pollNews().catch(()=>{}).finally(()=>setTimeout(loop,30000));loop();
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
    if(p==='/api/news')return send(res,200,{items:news,lastPoll});
    if(p==='/api/news/status')return send(res,200,{count:news.length,high:news.filter(n=>n.impact==='HIGH').length,lastPoll,clients:clients.size});
    if(p==='/api/news/stream'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write(': connected\n\n');clients.add(res);const hb=setInterval(()=>res.write(': hb\n\n'),25000);return req.on('close',()=>{clearInterval(hb);clients.delete(res)})}
    if(STATIC[p])return send(res,200,fs.readFileSync(path.join(__dirname,'public',STATIC[p])),'text/html; charset=utf-8');
    send(res,404,{error:'Not found'});
  }catch(e){send(res,502,{error:'Upstream unavailable',detail:e.message})}
}).listen(PORT,()=>console.log('FX API on',PORT));
