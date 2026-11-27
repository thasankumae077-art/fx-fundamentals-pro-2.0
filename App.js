import React,{useState,useEffect,useRef,useMemo} from 'react';
import {View,Text,ScrollView,TextInput,TouchableOpacity,RefreshControl,Linking,Share,Alert,StatusBar,Platform,Image,Modal,useWindowDimensions} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const API=process.env.EXPO_PUBLIC_API_URL||'https://fx-fundamentals-pro.onrender.com';
const CUR=['EUR','GBP','AUD','NZD','USD','CAD','CHF','JPY'];
const C={bg:'#0a1128',card:'#111a3a',line:'#1e2a52',tx:'#e6ebff',mut:'#8a96c4',up:'#22c55e',dn:'#ef4444',ac:'#3b82f6'};
const BANKS={USD:['Fed','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'],EUR:['ECB','https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'],GBP:['BoE','https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates'],JPY:['BoJ','https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm'],CHF:['SNB','https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy'],CAD:['BoC','https://www.bankofcanada.ca/core-functions/monetary-policy/'],AUD:['RBA','https://www.rba.gov.au/monetary-policy/rba-board-meetings/'],NZD:['RBNZ','https://www.rbnz.govt.nz/monetary-policy']};
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowAlert:true,shouldShowBanner:true,shouldShowList:true,shouldPlaySound:false,shouldSetBadge:false})});

const store={get:async(k,d)=>{try{const v=await AsyncStorage.getItem('fx:'+k);return v?JSON.parse(v):d}catch{return d}},set:(k,v)=>AsyncStorage.setItem('fx:'+k,JSON.stringify(v)).catch(()=>{})};
async function load(path,key,set){try{const r=await fetch(API+path);if(!r.ok)throw 0;const j=await r.json();set(j);store.set(key,j);return true}catch{const c=await store.get(key,null);if(c)set(c);return false}}

// ---------- maths
const sum=a=>a.reduce((x,y)=>x+y,0),mean=a=>sum(a)/a.length;
const sd=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))};
const cor=(a,b)=>{const ma=mean(a),mb=mean(b),s=sd(a)*sd(b);return s?mean(a.map((x,i)=>(x-ma)*(b[i]-mb)))/s:0};
const zs=v=>{const k=CUR.filter(c=>v[c]!=null),x=k.map(c=>v[c]),m=x.length>1?mean(x):0,s=x.length>1?sd(x):0,o={};CUR.forEach(c=>o[c]=v[c]!=null&&s?(v[c]-m)/s:null);return o};
function analytics(h){
  if(!h?.dates||h.dates.length<70)return null;const n=h.dates.length,t=n-1,L={};
  CUR.forEach(c=>L[c]=h.rates[c].map(Math.log));
  const d=(c,i,k)=>L[c][i]-L[c][i-k];
  const S=(c,i,k)=>{let s=0;CUR.forEach(o=>{if(o!==c)s+=d(o,i,k)});return(s/7-d(c,i,k))*100};
  const str={};[1,5,21,63].forEach(k=>{str[k]={};CUR.forEach(c=>str[k][c]=S(c,t,k))});
  const ser={};CUR.forEach(c=>{ser[c]=[];for(let i=n-60;i<n;i++)ser[c].push(S(c,i,1))});
  const px=(b,q,i)=>h.rates[q][i]/h.rates[b][i];
  return{str,corr:CUR.map(a=>CUR.map(b=>cor(ser[a],ser[b]))),price:(b,q)=>px(b,q,t),chg:(b,q,k)=>px(b,q,t)/px(b,q,t-k)-1,date:h.dates[t],series:(b,q)=>{const o=[];for(let i=n-60;i<n;i++)o.push(px(b,q,i));return o}};
}
function scores(f,A){
  const g=k=>{const o={};CUR.forEach(c=>{const v=parseFloat(f[c]?.[k]);o[c]=isNaN(v)?null:v});return o};
  const st=g('stance'),zr=zs(g('rate')),zg=zs(g('gdp')),zu=zs(g('unemp')),mo=A?zs(A.str[21]):{},out={};
  CUR.forEach(c=>{const p=[st[c]!=null?st[c]*1.2:null,zr[c]!=null?zr[c]*.8:null,zg[c]!=null?zg[c]*.6:null,zu[c]!=null?-zu[c]*.4:null,mo[c]!=null?mo[c]*.8:null];
    out[c]={s:sum(p.map(x=>x||0)),n:p.filter(x=>x!=null).length}});
  return out;
}
const PAIRS=[];CUR.forEach((b,i)=>CUR.slice(i+1).forEach(q=>PAIRS.push([b,q])));
const pairRows=(A,sc)=>PAIRS.map(([b,q])=>{const gap=sc[b].s-sc[q].s;return{name:b+q,b,q,gap,comp:Math.min(sc[b].n,sc[q].n)/5,price:A.price(b,q),d1:A.chg(b,q,1),m1:A.chg(b,q,21),lab:gap>1?'LONG':gap<-1?'SHORT':'NEUTRAL'}}).sort((x,y)=>Math.abs(y.gap)-Math.abs(x.gap));
const pct=x=>x==null?'–':(x>=0?'+':'')+(x*100).toFixed(2)+'%',col=x=>x>0?C.up:x<0?C.dn:C.mut,f2=(x,d=2)=>x==null||isNaN(x)?'–':Number(x).toFixed(d);

// ---------- multi-asset symbol resolver
const ASSET_ALIASES={
  XAUUSD:'XAU/USD',GOLD:'XAU/USD',XAU:'XAU/USD',
  XAGUSD:'XAG/USD',SILVER:'XAG/USD',XAG:'XAG/USD',
  XAUEUR:'XAU/EUR',XAUJPY:'XAU/JPY',
  US30:'US30',DJ30:'US30',DOW:'US30',DJI:'US30',
  NAS100:'NAS100',USTEC:'NAS100',NDX:'NAS100',NASDAQ:'NAS100',
  SPX500:'SPX500',US500:'SPX500',SP500:'SPX500',SPX:'SPX500',
  BTCUSD:'BTC/USD',BTC:'BTC/USD',BITCOIN:'BTC/USD',
  USOIL:'USOIL',WTI:'USOIL',CL:'USOIL',OIL:'USOIL',CRUDE:'USOIL',
  UKOIL:'UKOIL',BRENT:'UKOIL',BZ:'UKOIL'
};
const QUICK_PILLS=['EUR/USD','USD/JPY','GBP/USD','XAU/USD','XAG/USD','US30','NAS100','BTC/USD','USOIL'];

function resolveSymbol(raw){
  const clean=(raw||'').trim().toUpperCase();
  const compact=clean.replace(/[^A-Z0-9]/g,'');
  if(!compact)return null;
  if(ASSET_ALIASES[compact]){
    const sym=ASSET_ALIASES[compact];
    if(sym==='XAU/USD')return{type:'METAL',sym,key:'XAUUSD',base:'XAU',quote:'USD',dp:2,newsTags:['XAUUSD','USD'],calCurs:['USD']};
    if(sym==='XAG/USD')return{type:'METAL',sym,key:'XAGUSD',base:'XAG',quote:'USD',dp:2,newsTags:['XAGUSD','USD'],calCurs:['USD']};
    if(sym==='XAU/EUR')return{type:'METAL_CROSS',sym,key:'XAUEUR',base:'XAU',quote:'EUR',dp:2,newsTags:['XAUUSD','EUR'],calCurs:['EUR','USD']};
    if(sym==='XAU/JPY')return{type:'METAL_CROSS',sym,key:'XAUJPY',base:'XAU',quote:'JPY',dp:0,newsTags:['XAUUSD','JPY'],calCurs:['JPY','USD']};
    if(['US30','NAS100','SPX500'].includes(sym))return{type:'INDEX',sym,key:sym,base:sym,quote:'USD',dp:1,newsTags:[sym,'USD'],calCurs:['USD']};
    if(sym==='BTC/USD')return{type:'CRYPTO',sym,key:'BTCUSD',base:'BTC',quote:'USD',dp:0,newsTags:['BTCUSD','NAS100','USD'],calCurs:['USD']};
    if(sym==='USOIL')return{type:'OIL',sym,key:'USOIL',base:'USOIL',quote:'USD',dp:2,newsTags:['USOIL','CAD','USD'],calCurs:['USD','CAD']};
    if(sym==='UKOIL')return{type:'OIL',sym,key:'UKOIL',base:'UKOIL',quote:'USD',dp:2,newsTags:['UKOIL','USOIL','GBP','USD'],calCurs:['USD','GBP']};
  }
  const letters=clean.replace(/[^A-Z]/g,'');
  if(letters.length===6){
    const b=letters.slice(0,3),q=letters.slice(3,6);
    if(CUR.includes(b)&&CUR.includes(q)&&b!==q){
      return{type:'FX',sym:`${b}/${q}`,key:b+q,base:b,quote:q,dp:q==='JPY'?3:5,newsTags:[b,q],calCurs:[b,q]};
    }
  }
  return null;
}

// ---------- ui bits
const Card=({title,children,style,onLayout})=><View onLayout={onLayout} style={{backgroundColor:C.card,borderRadius:12,padding:12,marginBottom:12,borderWidth:1,borderColor:C.line,...style}}>{title&&<Text style={{color:C.mut,fontSize:11,fontWeight:'700',letterSpacing:1,marginBottom:8}}>{title.toUpperCase()}</Text>}{children}</View>;
const T=({c=C.tx,s=14,w='400',children,style})=><Text style={{color:c,fontSize:s,fontWeight:w,...style}}>{children}</Text>;
const Row=({children,style})=><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',...style}}>{children}</View>;
const Btn=({t,on,primary,style})=><TouchableOpacity onPress={on} style={{backgroundColor:primary?C.ac:C.line,paddingVertical:9,paddingHorizontal:14,borderRadius:8,...style}}><T w='700' s={13}>{t}</T></TouchableOpacity>;
const Inp=({label,v,set,flex=1,kb='numbers-and-punctuation',ph})=><View style={{flex,marginRight:6}}>{label&&<T c={C.mut} s={10}>{label}</T>}<TextInput value={v} onChangeText={set} keyboardType={kb} placeholder={ph} placeholderTextColor={C.mut} style={{color:C.tx,backgroundColor:C.bg,borderRadius:8,borderWidth:1,borderColor:C.line,paddingHorizontal:8,paddingVertical:6,fontSize:13}}/></View>;
const Pills=({opts,val,set})=><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>{opts.map(([k,l])=><TouchableOpacity key={k} onPress={()=>set(k)} style={{paddingHorizontal:12,paddingVertical:6,borderRadius:16,marginRight:6,backgroundColor:val===k?C.ac:C.line}}><T s={12} w='600'>{l}</T></TouchableOpacity>)}</ScrollView>;
const Wait=()=><Card><T c={C.mut}>No data yet. Pull down to refresh (the free Render server may need ~30s to wake up).</T></Card>;
const Note=({children})=><T c={C.mut} s={11} style={{marginBottom:10}}>{children}</T>;

// ---------- screens
function Overview({A,sc,fund}){
  const [k,setK]=useState(1);if(!A)return<Wait/>;
  const s=A.str[k],list=CUR.slice().sort((a,b)=>s[b]-s[a]),mx=Math.max(...CUR.map(c=>Math.abs(s[c])))||1;
  const conf=p=>p.comp>=.8?'High':p.comp>=.5?'Medium':'Low';
  return<>
    <T s={24} w='800'>Daily brief</T><Note>The three widest score gaps today. All text below is generated from data (ECB rates to {A.date}, official fundamentals) — it is not editorial advice.</Note>
    {pairRows(A,sc).slice(0,3).map(p=>{const buy=p.gap>0,sr=A.series(p.b,p.q),lo=Math.min(...sr),hi=Math.max(...sr),ra=fund[p.b]?.rate,rb=fund[p.q]?.rate;
      return<Card key={p.name}>
        <Row style={{justifyContent:'flex-start',marginBottom:8}}><T s={17} w='800'>{p.b}/{p.q}</T><T c={buy?C.up:C.dn} w='700' style={{marginHorizontal:10}}>{p.lab==='NEUTRAL'?'Neutral':buy?'↑ Buy bias':'↓ Sell bias'}</T><T c={C.mut} s={12}>· Data confidence {conf(p)}</T></Row>
        <Row style={{alignItems:'flex-end'}}><View><T s={26} w='800'>{f2(p.price,p.q==='JPY'?3:5)}</T><T c={C.mut} s={12}>Daily close · 1D <T c={col(p.d1)} s={12}>{pct(p.d1)}</T> · 1M <T c={col(p.m1)} s={12}>{pct(p.m1)}</T></T></View>
        <View style={{flexDirection:'row',alignItems:'flex-end',height:44,width:'45%'}}>{sr.map((v,i)=><View key={i} style={{flex:1,marginRight:1,height:4+(v-lo)/((hi-lo)||1)*40,backgroundColor:C.ac,opacity:.8}}/>)}</View></Row>
        <View style={{borderTopWidth:1,borderTopColor:C.line,marginTop:10,paddingTop:8}}>
          <T c={C.mut} s={11}>What changed</T><T s={13}>{p.b} {pct(p.m1)} vs {p.q} over 1 month ({pct(p.d1)} today).</T>
          <T c={C.mut} s={11} style={{marginTop:6}}>Why the bias</T><T s={13}>Score gap {f2(p.gap)} ({p.b} {f2(sc[p.b].s)} vs {p.q} {f2(sc[p.q].s)}){ra&&rb?`; policy rates ${f2(ra)}% vs ${f2(rb)}%`:''}.</T></View></Card>})}
    <Card title={`Currency strength`}>
      <Pills opts={[[1,'1D'],[5,'1W'],[21,'1M'],[63,'3M']]} val={k} set={setK}/>
      {list.map(c=><Row key={c} style={{marginBottom:6}}><T w='700' style={{width:40}}>{c}</T><View style={{flex:1,height:14,backgroundColor:C.bg,borderRadius:4,marginHorizontal:8}}><View style={{width:`${Math.abs(s[c])/mx*100}%`,height:14,borderRadius:4,backgroundColor:s[c]>=0?C.up:C.dn}}/></View><T c={col(s[c])} style={{width:60,textAlign:'right'}}>{f2(s[c])}%</T></Row>)}
    </Card>
    <Card title="60-day correlation of daily currency returns">
      <Row><View style={{width:34}}/>{CUR.map(c=><T key={c} c={C.mut} s={9} style={{flex:1,textAlign:'center'}}>{c}</T>)}</Row>
      {CUR.map((a,i)=><Row key={a}><T c={C.mut} s={9} style={{width:34}}>{a}</T>{CUR.map((b,j)=>{const v=A.corr[i][j];return<View key={b} style={{flex:1,height:34,margin:.5,justifyContent:'center',backgroundColor:v>0?`rgba(59,130,246,${Math.abs(v)})`:`rgba(239,68,68,${Math.abs(v)})`}}><T s={9} style={{textAlign:'center'}}>{v.toFixed(1)}</T></View>})}</Row>)}
    </Card></>;
}
function Fundamentals({fx,sc}){
  if(!fx)return<Wait/>;const D=fx.data||{};
  const R=(l,o,u='%')=><Row style={{paddingVertical:3,alignItems:'flex-start'}}><T c={C.mut} s={13}>{l}</T><View style={{alignItems:'flex-end',flex:1,paddingLeft:10}}>
    <T s={13} w='600'>{o?`${f2(o.value)}${u}`:'n/a'}{o?.isNew?<T c={C.up} s={10} w='800'>  NEW</T>:null}</T>
    {!!o&&<T c={o.stale?'#f59e0b':C.mut} s={10} style={{textAlign:'right'}}>{(o.label||o.date)+' · '+(o.src||'')+(o.stale?' · older than expected':'')}</T>}</View></Row>;
  return<>
    <T s={24} w='800'>Fundamentals</T>
    <Note>Filled automatically from the newest official releases — nothing to type. The server re-checks every 30 minutes and the Refresh button forces a re-check; a green NEW tag marks a figure that changed in the last 48 hours, and stance and score recalculate from it. “Older than expected” means no fresher release was found yet. “n/a” is left out of the score, never estimated. Stance is a rule-based proxy from the recent policy-rate change. Research aid, not a trade signal.{fx.updatedAt?` Last checked ${new Date(fx.updatedAt).toLocaleString()}.`:''}{fx.stale?' (Showing stale server cache.)':''}</Note>
    {CUR.map(c=>{const d=D[c]||{};return<Card key={c} title={`${c} · ${BANKS[c][0]}`}>
      {R('Policy rate',d.rate)}{R('CPI y/y',d.cpi)}{R('GDP growth y/y',d.gdp)}{R('Unemployment',d.unemp)}
      <Row style={{paddingVertical:3}}><T c={C.mut} s={13}>Stance (-2..+2)</T><T s={13} w='600'>{d.stance?d.stance.value:'n/a'}</T></Row>{d.stance&&<T c={C.mut} s={10}>{d.stance.basis}</T>}
      <Row style={{marginTop:8}}><T c={col(sc[c].s)} w='700'>Score {f2(sc[c].s)} <T c={C.mut} s={11}>({sc[c].n}/5 inputs)</T></T><TouchableOpacity onPress={()=>Linking.openURL(BANKS[c][1])}><T c={C.ac} s={12}>Meeting calendar ↗</T></TouchableOpacity></Row></Card>})}
  </>;
}
function Scanner({A,sc,fx,cot,send}){
  const [deep,setDeep]=useState(null);
  if(!A)return<Wait/>;
  return<><Note>Reference prices are ECB daily rates ({A.date}), not live quotes. Ranked by |score gap|. LONG/SHORT when gap beyond ±1. Tap a pair for the deep-dive.</Note>
    {pairRows(A,sc).map(p=><TouchableOpacity key={p.name} onPress={()=>setDeep(p)}><Card style={{padding:10,marginBottom:8}}>
      <Row><T w='700' s={16}>{p.b}/{p.q}</T><T c={col(p.gap)} w='700'>{p.lab}</T><T c={col(p.gap)}>gap {f2(p.gap)}</T></Row>
      <Row style={{marginTop:4}}><T c={C.mut} s={12}>Ref {f2(p.price,p.q==='JPY'?3:5)}</T><T c={col(p.d1)} s={12}>1D {pct(p.d1)}</T><T c={col(p.m1)} s={12}>1M {pct(p.m1)}</T><T c={p.comp<.6?C.dn:C.up} s={12}>Data {Math.round(p.comp*100)}%</T></Row></Card></TouchableOpacity>)}
    {deep&&<PairModal p={deep} A={A} sc={sc} fx={fx} cot={cot} send={o=>{setDeep(null);send(o)}} onClose={()=>setDeep(null)}/>}</>;
}
function Macro({d}){
  if(!d)return<Wait/>;const F=d.fred||{},B=d.bls||{};
  const R=(l,o,u='')=><Row key={l} style={{paddingVertical:5}}><T c={C.mut}>{l}</T><T w='700'>{o?`${f2(o.value)}${u}`:'n/a'} <T c={C.mut} s={10}>{o?o.date+' · '+(o.src||''):''}</T></T></Row>;
  const sp=F.us10y&&F.us2y?F.us10y.value-F.us2y.value:null,be=F.us10y&&F.tips10y?F.us10y.value-F.tips10y.value:null;
  return<>
    <Card title="Derived">{R('2s10s spread',sp!=null&&{value:sp},' pp')}{R('10Y real yield (TIPS)',F.tips10y,'%')}{R('10Y breakeven inflation',be!=null&&{value:be},'%')}</Card>
    <Card title="FRED">{R('US 2Y',F.us2y,'%')}{R('US 5Y',F.us5y,'%')}{R('US 10Y',F.us10y,'%')}{R('Broad USD index',F.usdBroad)}{R('WTI $/bbl',F.wti)}{R('Brent $/bbl',F.brent)}{R('Gold',F.gold)}</Card>
    <Card title="BLS">{R('CPI y/y',B.cpiYoY,'%')}{R('Unemployment',B.unemployment,'%')}{R('Nonfarm payrolls m/m (k)',B.payrollsChange)}</Card>
    {d.stale&&<Note>Showing stale server cache.</Note>}{Object.keys(d.errors||{}).length>0&&<Note>Unavailable upstream: {Object.keys(d.errors).join(', ')}</Note>}</>;
}
const CATS=['Top Stories','Central Banks','Currencies','Macro & Rates'];
const AS={USD:['#15803d','$'],EUR:['#2563eb','€'],GBP:['#7e22ce','£'],JPY:['#dc2626','¥'],CHF:['#be123c','₣'],CAD:['#ea580c','C$'],AUD:['#ca8a04','A$'],NZD:['#0d9488','NZ$'],XAUUSD:['#b45309','Au'],XAGUSD:['#64748b','Ag'],US30:['#1d4ed8','DJ'],NAS100:['#0284c7','NDX'],SPX500:['#4338ca','SPX'],BTCUSD:['#d97706','₿'],USOIL:['#374151','WTI'],UKOIL:['#475569','BRN']};
const ASSETS=Object.keys(AS),CF={'Central Banks':['#0f766e','%'],'Currencies':['#9333ea','⇄'],'Macro & Rates':['#c2410c','↗'],'Top Stories':['#334155','◆']};
const relT=n=>{const t=n.time?new Date(n.time):null;if(!t||isNaN(t))return n.publishedAt||'';const s=(Date.now()-t)/1e3,m=s/60,h=m/60,d=h/24,f=Math.floor;return s<60?'just now':m<60?`${f(m)} min ago`:h<24?`${f(h)} hour${f(h)>1?'s':''} ago`:d<7?`${f(d)} day${f(d)>1?'s':''} ago`:t.toLocaleDateString()};
function Thumb({n,style,big}){
  const [bad,setBad]=useState(false);
  if(n.imageUrl&&!bad)return<Image source={{uri:n.imageUrl}} onError={()=>setBad(true)} resizeMode='cover' style={{backgroundColor:C.line,...style}}/>;
  const a=ASSETS.find(c=>n.cur?.includes(c)),[bg,sym]=a?AS[a]:(CF[n.category]||CF['Top Stories']),sm=(style?.width||100)<70,h=[...(n.id||'abcdefabcdef')].slice(0,sm?6:12).map(ch=>ch.charCodeAt(0)%6);
  return<View style={{backgroundColor:bg,overflow:'hidden',justifyContent:'center',alignItems:'center',...style}}>
    <View style={{position:'absolute',left:0,right:0,top:0,bottom:0,flexDirection:'row',alignItems:'flex-end',paddingHorizontal:4}}>{h.map((v,i)=><View key={i} style={{flex:1,marginHorizontal:1,height:`${22+v*9}%`,backgroundColor:'rgba(255,255,255,.15)',borderTopLeftRadius:2,borderTopRightRadius:2}}/>)}</View>
    <Text style={{color:'#fff',fontSize:big?60:sm?20:30,fontWeight:'800'}}>{sym}</Text>
    {big&&<T c='#ffffffcc' s={12} w='800' style={{marginTop:2,letterSpacing:2}}>{a||(n.category||'').toUpperCase()}</T>}</View>}
const Badge=({n})=><View style={{flexDirection:'row'}}><View style={{backgroundColor:C.line,borderRadius:4,paddingHorizontal:6,paddingVertical:2}}><T s={10} w='700'>{(n.source||'News').toUpperCase()}</T></View></View>;
const Chip=({t,c})=><View style={{borderWidth:1,borderColor:c,borderRadius:14,paddingHorizontal:10,paddingVertical:4,marginRight:6,marginBottom:6}}><T c={c} s={12} w='700'>{t}</T></View>;
function Reader({n,onClose}){
  const {width}=useWindowDimensions(),wide=width>=900,tc=t=>t==='Hawkish'?C.up:t==='Dovish'?C.dn:C.mut,ic={HIGH:C.dn,MEDIUM:'#f59e0b',LOW:C.mut};if(!n)return null;
  return<Modal transparent animationType='slide' visible onRequestClose={onClose}><View style={{flex:1,backgroundColor:'rgba(0,0,0,.6)',alignItems:'flex-end'}}>
    <TouchableOpacity activeOpacity={1} onPress={onClose} style={{position:'absolute',top:0,left:0,right:0,bottom:0}}/>
    <View style={{width:wide?480:'100%',height:'100%',backgroundColor:C.bg,borderLeftWidth:1,borderLeftColor:C.line,paddingTop:Platform.OS==='android'?28:8}}>
      <Row style={{padding:12}}><T c={C.mut} s={11} w='700'>ARTICLE</T><TouchableOpacity onPress={onClose}><T s={20}>✕</T></TouchableOpacity></Row>
      <ScrollView contentContainerStyle={{padding:16,paddingTop:0}}>
        <Thumb n={n} big style={{width:'100%',height:200,borderRadius:12}}/>
        <Row style={{justifyContent:'flex-start',marginTop:12}}><Badge n={n}/><T c={C.mut} s={12} style={{marginLeft:8}}>{relT(n)}</T></Row>
        <T s={22} w='800' style={{marginVertical:10}}>{n.title}</T>
        <View style={{flexDirection:'row',flexWrap:'wrap'}}>{(n.cur?.length?n.cur:[]).map(c=><Chip key={c} t={`${c} · ${n.tone||'Neutral'}`} c={tc(n.tone)}/>)}<Chip t={`${n.impact} IMPACT`} c={ic[n.impact]}/>{!!n.driver&&<Chip t={n.driver} c={C.ac}/>}<Chip t={n.category} c={C.ac}/></View>
        <T s={15} style={{marginTop:6,lineHeight:22}}>{n.summary||"This publisher's feed doesn't include a summary. Open the full story for the complete article."}</T>
        <T c={C.mut} s={10} style={{marginTop:10}}>Tone (Hawkish/Dovish/Neutral) and impact are keyword-based labels on the headline, not analysis or a trade signal.</T>
        <Btn primary t={`Read full story at ${n.source||'publisher'} ↗`} on={()=>Linking.openURL(n.url||n.link)} style={{marginTop:16,alignSelf:'flex-start'}}/>
      </ScrollView></View></View></Modal>}
function Side({title,items,pick}){return items.length?<Card title={title}>{items.map(n=><TouchableOpacity key={n.id} onPress={()=>pick(n)}><Row style={{alignItems:'flex-start',paddingVertical:8}}><View style={{flex:1,paddingRight:10}}><T s={13} w='600'>{n.title}</T><T c={C.mut} s={10} style={{marginTop:3}}>{n.source} · {relT(n)}</T></View><Thumb n={n} style={{width:56,height:56,borderRadius:8}}/></Row></TouchableOpacity>)}</Card>:null}
const IMPC={HIGH:['#7f1d1d','#fecaca','HIGH IMPACT'],MEDIUM:['#78350f','#fde68a','MEDIUM IMPACT']};
const ImpactTag=({n})=>IMPC[n.impact]?<View style={{flexDirection:'row',alignItems:'center'}}><View style={{backgroundColor:IMPC[n.impact][0],borderRadius:4,paddingHorizontal:6,paddingVertical:2,marginRight:6}}><T s={10} w='800' c={IMPC[n.impact][1]}>{IMPC[n.impact][2]}</T></View>{!!n.driver&&<T c={C.mut} s={11}>{n.driver}</T>}</View>:null;
function ImpactSummary({asset,news}){
  const cut=Date.now()-72*36e5,items=news.filter(n=>n.cur?.includes(asset)&&new Date(n.time)>=cut),nonFx=!CUR.includes(asset),W={HIGH:3,MEDIUM:2,LOW:1};
  let net=0,tot=0,up=0,dn=0;
  items.forEach(n=>{const mv=n.move==='Up'?1:n.move==='Down'?-1:0,tn=n.tone==='Hawkish'?1:n.tone==='Dovish'?-1:0,onNonFx=n.cur?.some(c=>!CUR.includes(c)),b=Math.sign(nonFx?mv:tn+(onNonFx?0:mv));net+=W[n.impact]*b;tot+=W[n.impact]*Math.abs(b);if(b>0)up++;if(b<0)dn++});
  const r=tot?net/tot:0,bias=up+dn<2||Math.abs(r)<.3?'Mixed / Neutral':r>0?(nonFx?'Bullish':'Bullish / Hawkish'):(nonFx?'Bearish':'Bearish / Dovish'),bc=bias.startsWith('Bull')?C.up:bias.startsWith('Bear')?C.dn:'#f59e0b';
  const grp=k=>{const m={};items.filter(n=>n.impact===k&&n.driver).forEach(n=>(m[n.driver]??=[]).push(n));return Object.entries(m).sort((x,y)=>y[1].length-x[1].length).slice(0,3)},hi=grp('HIGH'),md=grp('MEDIUM');
  const fmt=g=>g.map(([d,x])=>`${d} (${x.length})`).join(' · '),cl=t=>t.length>90?t.slice(0,90)+'…':t;
  const Bul=({children})=><Row style={{alignItems:'flex-start',justifyContent:'flex-start',marginTop:6}}><T c={C.mut} style={{width:14}}>•</T><T s={13} style={{flex:1}}>{children}</T></Row>;
  return<Card style={{borderLeftWidth:4,borderLeftColor:bc}}>
    <Row><T s={17} w='800'>{asset} Impact Summary</T><View style={{borderWidth:1,borderColor:bc,borderRadius:12,paddingHorizontal:10,paddingVertical:3}}><T c={bc} s={12} w='800'>{bias}</T></View></Row>
    {!items.length?<T c={C.mut} s={13} style={{marginTop:8}}>No {asset} headlines in the last 72 hours.</T>:<>
      <Bul><T w='700'>🔴 High impact: </T>{hi.length?`${fmt(hi)} — latest “${cl(hi[0][1][0].title)}”`:'no high-impact drivers in the current feed.'}</Bul>
      <Bul><T w='700'>🟠 Medium impact: </T>{md.length?`${fmt(md)} — latest “${cl(md[0][1][0].title)}”`:'no medium-impact drivers in the current feed.'}</Bul>
      <Bul><T w='700'>Basis: </T>{up} bullish vs {dn} bearish of {items.length} headlines tagged {asset} (last 72h, impact-weighted).</Bul></>}
    <T c={C.mut} s={10} style={{marginTop:8}}>Auto-generated from headline keywords — not analysis or a trade signal.</T></Card>}
const NF0={cat:'Top Stories',asset:null,imp:'ALL',q:''};
const ALIAS={usd:'USD',dollar:'USD',greenback:'USD',eur:'EUR',euro:'EUR',gbp:'GBP',pound:'GBP',sterling:'GBP',jpy:'JPY',yen:'JPY',chf:'CHF',franc:'CHF',cad:'CAD',loonie:'CAD',aud:'AUD',aussie:'AUD',nzd:'NZD',kiwi:'NZD',gold:'XAUUSD',xau:'XAUUSD',silver:'XAGUSD',xag:'XAGUSD',dow:'US30',us30:'US30',nasdaq:'NAS100',nas100:'NAS100',spx:'SPX500',spx500:'SPX500',btc:'BTCUSD',bitcoin:'BTCUSD',oil:'USOIL',wti:'USOIL',usoil:'USOIL',brent:'UKOIL',ukoil:'UKOIL'};
function News({news,trades,nf,setNf}){
  const {width}=useWindowDimensions(),wide=width>=900,{cat,asset,imp,q}=nf,setCat=v=>setNf({...nf,cat:v}),setAsset=v=>setNf({...nf,asset:v}),setImp=v=>setNf({...nf,imp:v}),setQ=v=>setNf({...nf,q:v}),[sel,setSel]=useState(null);
  const toks=q.toLowerCase().split(/\s+/).filter(Boolean);
  const inQ=n=>!toks.length||toks.every(t=>`${n.title} ${n.summary||''} ${n.source||''} ${n.driver||''} ${(n.cur||[]).join(' ')}`.toLowerCase().includes(t)||(ALIAS[t]&&n.cur?.includes(ALIAS[t])));
  const inCat=n=>cat==='Top Stories'||n.category===cat,inImp=n=>imp==='ALL'||n.impact===imp,inAsset=n=>!asset||n.cur?.includes(asset);
  const L=news.filter(n=>inCat(n)&&inImp(n)&&inAsset(n)&&inQ(n)),cnt=x=>news.filter(n=>inCat(n)&&inImp(n)&&inQ(n)&&n.cur?.includes(x)).length,impCnt=k=>news.filter(n=>inCat(n)&&inAsset(n)&&inQ(n)&&(k==='ALL'||n.impact===k)).length;
  const lead=L.find(n=>n.imageUrl&&n.impact==='HIGH')||L.find(n=>n.imageUrl)||L[0];
  const sub=lead?L.filter(n=>n.id!==lead.id&&(n.category===lead.category||n.cur?.some(c=>lead.cur?.includes(c)))).slice(0,3):[];
  const used=new Set([lead?.id,...sub.map(n=>n.id)]),rest=L.filter(n=>!used.has(n.id)),highs=rest.filter(n=>n.impact==='HIGH').slice(0,30),meds=rest.filter(n=>n.impact==='MEDIUM').slice(0,30),others=imp==='ALL'?rest.filter(n=>n.impact==='LOW').slice(0,20):[];
  const hi=news.filter(n=>n.impact==='HIGH'),movers=(hi.length?hi:news).slice(0,8);
  const mine=new Set(trades.flatMap(t=>[t.pair.slice(0,3),t.pair.slice(3,6),t.pair])),picks=mine.size?news.filter(n=>n.cur?.some(c=>mine.has(c))&&!movers.includes(n)).slice(0,5):[];
  const story=n=><TouchableOpacity key={n.id} onPress={()=>setSel(n)}><Row style={{alignItems:'flex-start',paddingVertical:12,borderTopWidth:1,borderTopColor:C.line}}><View style={{flex:1,paddingRight:12}}><Row style={{justifyContent:'flex-start',flexWrap:'wrap'}}><View style={{marginRight:8}}><Badge n={n}/></View><ImpactTag n={n}/></Row><T s={15} w='700' style={{marginTop:6}}>{n.title}</T><T c={C.mut} s={11} style={{marginTop:4}}>{relT(n)}</T></View><Thumb n={n} style={{width:92,height:92,borderRadius:12}}/></Row></TouchableOpacity>;
  const sec=(emoji,title,color,items)=>items.length?<View style={{marginTop:16}}><Row style={{borderLeftWidth:4,borderLeftColor:color,paddingLeft:10}}><T s={17} w='800'>{emoji} {title}</T><T c={C.mut} s={12}>{items.length} stories</T></Row>{items.map(story)}</View>:null;
  const main=<View style={{flex:1,width:'100%'}}>
    {!!asset&&<ImpactSummary asset={asset} news={news}/>}
    {!lead&&(asset||q||imp!=='ALL'?<Card><T c={C.mut}>No stories match these filters yet — try “All Impact”, “Top Stories” or another asset.</T></Card>:<Wait/>)}
    {lead&&<Card style={{padding:0,overflow:'hidden'}}><TouchableOpacity activeOpacity={.85} onPress={()=>setSel(lead)}><Thumb n={lead} big style={{width:'100%',height:wide?240:180}}/>
      <View style={{padding:14}}><Row style={{justifyContent:'flex-start',flexWrap:'wrap'}}><View style={{marginRight:8}}><Badge n={lead}/></View><ImpactTag n={lead}/></Row><T s={22} w='800' style={{marginTop:8}}>{lead.title}</T><T c={C.mut} s={12} style={{marginTop:4}}>{relT(lead)}</T></View></TouchableOpacity>
      {sub.map(r=><TouchableOpacity key={r.id} onPress={()=>setSel(r)} style={{borderTopWidth:1,borderTopColor:C.line,paddingHorizontal:14,paddingVertical:10}}><T s={14} w='600'>{r.title}</T><T c={C.mut} s={11} style={{marginTop:2}}>{r.source} · {relT(r)}</T></TouchableOpacity>)}</Card>}
    {sec('🔴','High Impact News','#ef4444',highs)}{sec('🟠','Medium Impact News','#f59e0b',meds)}{sec('📰','Other market news',C.mut,others)}</View>;
  const side=<View style={{width:wide?320:'100%',marginLeft:wide?20:0,marginTop:wide?0:12}}><Side title='Market movers' items={movers} pick={setSel}/><Side title='Picks for you · from your journal pairs' items={picks} pick={setSel}/></View>;
  return<><T s={24} w='800'>News</T><Note>Google News searches, FXStreet, CNBC, MarketWatch and central-bank feeds, refreshed every 15 minutes. Impact, tone and bias labels are keyword-based, not advice.</Note>
    <Row style={{marginBottom:10}}><View style={{flex:1,flexDirection:'row',alignItems:'center',backgroundColor:C.card,borderWidth:1,borderColor:C.line,borderRadius:10,paddingHorizontal:10}}><Text style={{marginRight:6}}>🔍</Text>
      <TextInput value={q} onChangeText={setQ} placeholder='Search headlines: Fed, CPI, gold, Nasdaq, oil, bitcoin…' placeholderTextColor={C.mut} style={{flex:1,color:C.tx,paddingVertical:9,fontSize:14}}/>{!!q&&<TouchableOpacity onPress={()=>setQ('')}><T c={C.mut} s={16}>✕</T></TouchableOpacity>}</View>
      {(q||asset||imp!=='ALL'||cat!=='Top Stories')&&<Btn t='Reset filters' on={()=>setNf(NF0)} style={{marginLeft:8,paddingVertical:9}}/>}</Row>
    <Pills opts={CATS.map(c=>[c,c])} val={cat} set={setCat}/>
    <Pills opts={[['ALL',`All Impact (${impCnt('ALL')})`],['HIGH',`🔴 High Impact (${impCnt('HIGH')})`],['MEDIUM',`🟠 Medium Impact (${impCnt('MEDIUM')})`]]} val={imp} set={setImp}/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
      <TouchableOpacity onPress={()=>setAsset(null)} style={{paddingHorizontal:12,paddingVertical:7,borderRadius:16,marginRight:6,backgroundColor:!asset?'#e6ebff':C.card,borderWidth:1,borderColor:C.line}}><T s={12} w='700' c={!asset?C.bg:C.tx}>All assets</T></TouchableOpacity>
      {ASSETS.map(x=>{const on=asset===x,k=cnt(x);return<TouchableOpacity key={x} onPress={()=>setAsset(on?null:x)} style={{flexDirection:'row',alignItems:'center',paddingLeft:10,paddingRight:6,paddingVertical:6,borderRadius:16,marginRight:6,backgroundColor:on?'#e6ebff':C.card,borderWidth:1,borderColor:on?'#e6ebff':C.line}}>
        <View style={{width:8,height:8,borderRadius:4,backgroundColor:AS[x][0],marginRight:6}}/><T s={12} w='700' c={on?C.bg:C.tx}>{x}</T>
        <View style={{minWidth:22,marginLeft:6,paddingHorizontal:6,paddingVertical:1,borderRadius:10,backgroundColor:on?C.bg:k?C.ac:C.line,alignItems:'center'}}><T s={11} w='800' c={on||k?'#fff':C.mut}>{k}</T></View></TouchableOpacity>})}</ScrollView>
    {(asset||q)&&<T c={C.mut} s={13} style={{marginBottom:10}}>Showing <T w='700'>{L.length}</T> stories{asset?<> tagged <T w='700'>{asset}</T></>:null}{q?<> matching “<T w='700'>{q}</T>”</>:null}</T>}
    <View style={{flexDirection:wide?'row':'column',alignItems:'flex-start'}}>{main}{side}</View><Reader n={sel} onClose={()=>setSel(null)}/></>;
}
function Risk({pre}){
  const [v,setV]=useState({bal:'10000',risk:'1',entry:'',stop:'',target:'',pip:'10',size:'0.0001'});const u=k=>x=>setV({...v,[k]:x});useEffect(()=>{if(pre)setV(x=>({...x,entry:String(pre.entry),size:String(pre.size),stop:'',target:''}))},[pre?.n]);
  const n=k=>parseFloat(v[k]),ok=['bal','risk','entry','stop','pip','size'].every(k=>!isNaN(n(k)));
  const sp=ok?Math.abs(n('entry')-n('stop'))/n('size'):null,cash=ok?n('bal')*n('risk')/100:null,lots=ok&&sp>0?cash/(sp*n('pip')):null,rr=!isNaN(n('target'))&&ok&&sp>0?Math.abs(n('target')-n('entry'))/Math.abs(n('entry')-n('stop')):null;
  return<Card title={'Position size'+(pre?.pair?' · '+pre.pair:'')}>
    <Row style={{marginBottom:8}}><Inp label='Balance' v={v.bal} set={u('bal')}/><Inp label='Risk %' v={v.risk} set={u('risk')}/></Row>
    <Row style={{marginBottom:8}}><Inp label='Entry' v={v.entry} set={u('entry')}/><Inp label='Stop' v={v.stop} set={u('stop')}/><Inp label='Target' v={v.target} set={u('target')}/></Row>
    <Row style={{marginBottom:12}}><Inp label='Pip value / lot (acct ccy)' v={v.pip} set={u('pip')}/><Inp label='Pip size (JPY 0.01)' v={v.size} set={u('size')}/></Row>
    <Row><T c={C.mut}>Risk amount</T><T w='700'>{f2(cash)}</T></Row><Row><T c={C.mut}>Stop (pips)</T><T w='700'>{f2(sp,1)}</T></Row>
    <Row><T c={C.mut}>Position size (lots)</T><T w='700' c={C.ac} s={18}>{f2(lots)}</T></Row><Row><T c={C.mut}>Reward : risk</T><T w='700'>{rr==null?'–':'1 : '+f2(rr)}</T></Row></Card>;
}
function stats(t){const r=t.map(x=>x.r),w=sum(r.filter(x=>x>0)),l=-sum(r.filter(x=>x<0));let e=0,pk=0,dd=0;r.forEach(x=>{e+=x;pk=Math.max(pk,e);dd=Math.max(dd,pk-e)});return{n:r.length,wr:r.length?r.filter(x=>x>0).length/r.length*100:0,tot:sum(r),pf:l?w/l:w?Infinity:0,ex:r.length?sum(r)/r.length:0,dd}}
function Journal({trades,setTrades}){
  const [p,setP]=useState({pair:'',side:'LONG',r:'',thesis:''}),[bk,setBk]=useState('');const S=stats(trades);
  const save=t=>{setTrades(t);store.set('trades',t)};
  const add=()=>{const r=parseFloat(p.r);if(!p.pair||isNaN(r))return Alert.alert('Enter a pair and an R result');save([...trades,{id:Date.now(),date:new Date().toISOString().slice(0,10),...p,pair:p.pair.toUpperCase(),r}]);setP({...p,pair:'',r:'',thesis:''})};
  const csv=()=>Share.share({message:'date,pair,side,r,thesis\n'+trades.map(t=>[t.date,t.pair,t.side,t.r,'"'+(t.thesis||'').replace(/"/g,'""')+'"'].join(',')).join('\n')});
  const restore=()=>{try{const j=JSON.parse(bk);if(!Array.isArray(j))throw 0;save(j);setBk('');Alert.alert('Restored',j.length+' trades')}catch{Alert.alert('Invalid backup JSON')}};
  return<>
    <Card title="Stats"><Row><T c={C.mut}>Trades</T><T>{S.n}</T></Row><Row><T c={C.mut}>Win rate</T><T>{f2(S.wr,1)}%</T></Row><Row><T c={C.mut}>Total R</T><T c={col(S.tot)}>{f2(S.tot)}</T></Row><Row><T c={C.mut}>Profit factor</T><T>{S.pf===Infinity?'∞':f2(S.pf)}</T></Row><Row><T c={C.mut}>Expectancy (R)</T><T c={col(S.ex)}>{f2(S.ex)}</T></Row><Row><T c={C.mut}>Max drawdown (R)</T><T c={C.dn}>{f2(S.dd)}</T></Row></Card>
    <Card title="Log trade"><Row style={{marginBottom:8}}><Inp label='Pair' v={p.pair} set={x=>setP({...p,pair:x})} kb='default' ph='EURUSD'/><Inp label='R result' v={p.r} set={x=>setP({...p,r:x})}/><Btn t={p.side} on={()=>setP({...p,side:p.side==='LONG'?'SHORT':'LONG'})}/></Row><Inp label='Thesis' v={p.thesis} set={x=>setP({...p,thesis:x})} kb='default'/><Btn primary t='Add trade' on={add} style={{marginTop:8}}/></Card>
    <Card title="Backup"><Row style={{justifyContent:'flex-start'}}><Btn t='Export CSV' on={csv} style={{marginRight:8}}/><Btn t='Export JSON' on={()=>Share.share({message:JSON.stringify(trades)})}/></Row><TextInput value={bk} onChangeText={setBk} placeholder='Paste JSON backup here' placeholderTextColor={C.mut} multiline style={{color:C.tx,backgroundColor:C.bg,borderRadius:8,padding:8,marginTop:8,minHeight:44}}/><Btn t='Restore' on={restore} style={{marginTop:8}}/></Card>
    {trades.slice().reverse().map(t=><Card key={t.id} style={{padding:10,marginBottom:6}}><Row><T w='700'>{t.pair} <T c={C.mut} s={11}>{t.side} · {t.date}</T></T><T c={col(t.r)} w='700'>{t.r>0?'+':''}{t.r}R</T></Row>{!!t.thesis&&<T c={C.mut} s={12}>{t.thesis}</T>}<TouchableOpacity onPress={()=>save(trades.filter(x=>x.id!==t.id))}><T c={C.dn} s={11}>Delete</T></TouchableOpacity></Card>)}
  </>;
}

// ---------- time / sessions (IST)
// ==SESS-START
const IST=5.5*36e5,p2=n=>String(n).padStart(2,'0');
const ist=t=>{const d=new Date(t+IST);return{h:d.getUTCHours(),m:d.getUTCMinutes(),s:d.getUTCSeconds(),wd:d.getUTCDay(),day:d.getUTCDate(),mon:d.getUTCMonth(),md:d.getUTCHours()*60+d.getUTCMinutes()}};
const SESS=[['Tokyo',330,870],['London',810,1350],['New York',1110,210]];
const inR=(m,s,e)=>s<e?m>=s&&m<e:m>=s||m<e;
const closedWk=i=>(i.wd===6&&i.md>=210)||i.wd===0||(i.wd===1&&i.md<210);
const act=(s,t)=>{const i=ist(t);return!closedWk(i)&&inR(i.md,s[1],s[2])};
const nextOpen=t=>{const t0=Math.floor(t/6e4)*6e4;for(let k=1;k<=8200;k++){const x=t0+k*6e4;for(const s of SESS)if(act(s,x)&&!act(s,x-6e4))return{name:s[0],t:x}}return null};
const fmtCd=ms=>{const s=Math.max(0,Math.floor(ms/1e3)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}d ${p2(h)}h`:h?`${p2(h)}h ${p2(m)}m`:`${p2(m)}m ${p2(s%60)}s`};
const hm=m=>`${p2(Math.floor(m/60))}:${p2(m%60)}`;
// ==SESS-END
const useNow=()=>{const [t,setT]=useState(Date.now());useEffect(()=>{const i=setInterval(()=>setT(Date.now()),1000);return()=>clearInterval(i)},[]);return t};
function SessionBar(){
  const now=useNow(),i=ist(now),mk=Math.floor(now/6e4),no=useMemo(()=>nextOpen(mk*6e4),[mk]),on=SESS.map(s=>act(s,now)),ov=on[1]&&on[2];
  const Pl=({t,live,hi})=><View style={{flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:live?C.up:C.line,backgroundColor:hi&&live?'#14532d':'transparent',borderRadius:12,paddingHorizontal:8,paddingVertical:2,marginRight:6,marginVertical:2}}><View style={{width:7,height:7,borderRadius:4,backgroundColor:live?C.up:C.mut,marginRight:5}}/><T s={10} w='700' c={live?C.up:C.mut}>{t}</T></View>;
  return<View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',paddingHorizontal:14,paddingVertical:5,backgroundColor:'#0d1636',borderBottomWidth:1,borderBottomColor:C.line}}>
    <T s={13} w='800' style={{marginRight:10}}>{p2(i.h)}:{p2(i.m)}:{p2(i.s)} IST</T>
    {SESS.map((s,k)=><Pl key={s[0]} live={on[k]} t={`${s[0]} ${hm(s[1])}–${hm(s[2])} ${on[k]?'OPEN':'CLOSED'}`}/>)}
    <Pl hi live={ov} t={`London–NY overlap 18:30–22:30 ${ov?'ACTIVE':'—'}`}/>
    {!!no&&<T c={C.mut} s={11}>{closedWk(i)?'Weekend · ':''}Next open: <T s={11} w='700'>{no.name}</T> in {fmtCd(no.t-now)}</T>}</View>}
function NextHigh({cal}){
  const now=useNow();if(!cal)return null;
  const nx=(cal.items||[]).filter(e=>e.impact==='High'&&new Date(e.timestamp)>now)[0];
  return<View style={{backgroundColor:'#3b0d0d',borderWidth:1,borderColor:'#7f1d1d',borderRadius:10,padding:10,marginBottom:12}}>
    {nx?<T s={13} w='700'>🔴 Next High-Impact: {nx.currency} {nx.title} in {fmtCd(new Date(nx.timestamp)-now)} <T c='#fecaca' w='400' s={12}>· Forecast {nx.forecast||'–'} vs Prev {nx.previous||'–'}</T></T>:<T c={C.mut} s={13}>No further high-impact releases on this week's calendar.</T>}</View>}
const MAJ=['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD'],WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const num=s=>{if(s==null||s==='')return NaN;const m=String(s).trim().match(/^(-?[\d.,]+)\s*([KMBT%]?)/i);if(!m)return NaN;return parseFloat(m[1].replace(/,/g,''))*({K:1e3,M:1e6,B:1e9,T:1e12}[m[2].toUpperCase()]||1)};
const verdict=e=>{const a=num(e.actual),f=num(e.forecast);if(isNaN(a)||isNaN(f)||a===f)return 0;return((a>f)!==/unemployment|jobless|claims|deficit/i.test(e.title))?1:-1};
function EconCalendar({cal}){
  const [cur,setCur]=useState('ALL'),[imp,setImp]=useState('ALL'),now=useNow();
  if(!cal)return<Wait/>;
  const L=(cal.items||[]).filter(e=>(cur==='ALL'||e.currency===cur)&&(imp==='ALL'||e.impact===imp)),days={};
  L.forEach(e=>{const d=ist(new Date(e.timestamp).getTime()),k=`${WD[d.wd]} ${d.day} ${MN[d.mon]}`;(days[k]??=[]).push(e)});
  const dc={High:C.dn,Medium:'#f59e0b',Low:C.mut};
  return<><T s={24} w='800'>Economic calendar</T><Note>All times in IST (Asia/Kolkata). {cal.source} Actual is green if better than forecast, red if worse (for unemployment, claims and deficits lower is better).{cal.stale?' Showing stale cache.':''}</Note>
    <Pills opts={[['ALL','All'],...MAJ.map(c=>[c,c])]} val={cur} set={setCur}/>
    <Pills opts={[['ALL','All'],['High','🔴 High Impact'],['Medium','🟠 Medium Impact']]} val={imp} set={setImp}/>
    {!L.length&&<Card><T c={C.mut}>No events match these filters.</T></Card>}
    {Object.entries(days).map(([day,ev])=><Card key={day} title={day}>
      <Row style={{paddingBottom:4}}><T c={C.mut} s={10} style={{width:48}}>IST</T><T c={C.mut} s={10} style={{flex:1}}>EVENT</T><View style={{width:156,flexDirection:'row'}}>{['ACTUAL','FCST','PREV'].map(h=><T key={h} c={C.mut} s={10} style={{flex:1,textAlign:'right'}}>{h}</T>)}</View></Row>
      {ev.map((e,i)=>{const d=ist(new Date(e.timestamp).getTime()),past=new Date(e.timestamp)<now,v=verdict(e);
        return<Row key={i} style={{alignItems:'flex-start',paddingVertical:9,borderTopWidth:1,borderTopColor:C.line,opacity:past?.7:1}}>
          <T s={13} w='700' style={{width:48}}>{p2(d.h)}:{p2(d.m)}</T>
          <View style={{flex:1,paddingRight:6}}><Row style={{justifyContent:'flex-start'}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dc[e.impact],marginRight:6}}/><T c={C.ac} s={12} w='800'>{e.currency}</T></Row><T s={13}>{e.title}</T></View>
          <View style={{width:156,flexDirection:'row'}}><T s={12} w='800' c={v>0?C.up:v<0?C.dn:C.tx} style={{flex:1,textAlign:'right'}}>{e.actual||'—'}</T><T s={12} style={{flex:1,textAlign:'right'}}>{e.forecast||'—'}</T><T s={12} c={C.mut} style={{flex:1,textAlign:'right'}}>{e.previous||'—'}</T></View></Row>})}</Card>)}</>}
function LineChart({data,color,h=140}){
  const [w,setW]=useState(0),lo=Math.min(...data),hi=Math.max(...data),X=i=>i*(w/(data.length-1)),Y=v=>h-6-(v-lo)/((hi-lo)||1)*(h-12);
  return<View onLayout={e=>setW(e.nativeEvent.layout.width)} style={{height:h,backgroundColor:C.bg,borderRadius:8,overflow:'hidden',borderWidth:1,borderColor:C.line}}>
    {w>0&&data.slice(1).map((v,i)=>{const x1=X(i),y1=Y(data[i]),x2=X(i+1),y2=Y(v),len=Math.hypot(x2-x1,y2-y1);return<View key={i} style={{position:'absolute',left:(x1+x2)/2-len/2,top:(y1+y2)/2-1,width:len+1,height:2,backgroundColor:color,transform:[{rotate:`${Math.atan2(y2-y1,x2-x1)}rad`}]}}/>})}</View>}
function PairModal({p,A,sc,fx,cot,send,onClose}){
  const {width}=useWindowDimensions(),wide=width>=900,b=p.b,q=p.q,D=fx?.data||{},K=cot?.data||{},ser=A.series(b,q),dp=q==='JPY'?3:5,jpy=b==='JPY'||q==='JPY';
  const perf=[['1D',1],['1W',5],['1M',21],['3M',63]].map(([l,k])=>[l,A.chg(b,q,k)]),up=ser[ser.length-1]>=ser[0];
  const FR=[['Policy rate %',c=>D[c]?.rate?.value],['CPI y/y %',c=>D[c]?.cpi?.value],['GDP y/y %',c=>D[c]?.gdp?.value],['Unemployment %',c=>D[c]?.unemp?.value],['Stance (-2..+2)',c=>D[c]?.stance?.value],['Composite score',c=>sc[c].s]];
  const ok=x=>x!=null&&!isNaN(x),cb=K[b],cq=K[q],pB=cb&&cb.oi?cb.net/cb.oi*100:null,pQ=cq&&cq.oi?cq.net/cq.oi*100:null,gapC=ok(pB)&&ok(pQ)?pB-pQ:null;
  const verdictC=p.lab==='NEUTRAL'?['Fundamental bias is neutral, so there is no alignment to test.',C.mut]:gapC==null?['COT data unavailable for one or both currencies.',C.mut]:Math.sign(gapC)===Math.sign(p.gap)?[`✓ Aligned: institutions are net-longer ${gapC>0?b:q} relative to ${gapC>0?q:b}, matching the ${p.lab} fundamental bias.`,C.up]:[`✗ Diverging: institutions are net-longer ${gapC>0?b:q}, against the ${p.lab} fundamental bias.`,C.dn];
  const Cell=({children,c,w=1,al='right',b:bold})=><T s={13} c={c} w={bold?'700':'400'} style={{flex:w,textAlign:al}}>{children}</T>;
  const n0=x=>x==null?'n/a':Math.round(x).toLocaleString('en-US');
  return<Modal transparent animationType='slide' visible onRequestClose={onClose}><View style={{flex:1,backgroundColor:'rgba(0,0,0,.6)',alignItems:'flex-end'}}>
    <TouchableOpacity activeOpacity={1} onPress={onClose} style={{position:'absolute',top:0,left:0,right:0,bottom:0}}/>
    <View style={{width:wide?560:'100%',height:'100%',backgroundColor:C.bg,borderLeftWidth:1,borderLeftColor:C.line,paddingTop:Platform.OS==='android'?28:8}}>
      <Row style={{padding:12}}><T s={20} w='800'>{b}/{q} <T c={col(p.gap)} s={14}>{p.lab}</T></T><TouchableOpacity onPress={onClose}><T s={20}>✕</T></TouchableOpacity></Row>
      <ScrollView contentContainerStyle={{padding:16,paddingTop:0}}>
        <Card title='60-day price (ECB daily reference)'><T s={24} w='800'>{f2(p.price,dp)}</T><View style={{marginVertical:8}}><LineChart data={ser} color={up?C.up:C.dn}/></View>
          <Row><T c={C.mut} s={11}>60d low {f2(Math.min(...ser),dp)}</T><T c={C.mut} s={11}>60d high {f2(Math.max(...ser),dp)}</T></Row>
          <Row style={{marginTop:10}}>{perf.map(([l,v])=><View key={l} style={{alignItems:'center',flex:1}}><T c={C.mut} s={11}>{l}</T><T c={col(v)} w='700'>{pct(v)}</T></View>)}</Row></Card>
        <Card title='Fundamentals & rate differential'>
          <Row style={{marginBottom:6}}><Cell al='left' w={1.6} c={C.mut}> </Cell><Cell c={C.mut} b>{b}</Cell><Cell c={C.mut} b>{q}</Cell><Cell c={C.mut} b>Diff</Cell></Row>
          {FR.map(([l,fn])=>{const x=fn(b),y=fn(q),d=ok(x)&&ok(y)?x-y:null;return<Row key={l} style={{paddingVertical:4,borderTopWidth:1,borderTopColor:C.line}}><Cell al='left' w={1.6} c={C.mut}>{l}</Cell><Cell>{ok(x)?f2(x):'n/a'}</Cell><Cell>{ok(y)?f2(y):'n/a'}</Cell><Cell c={col(d)} b>{d==null?'–':(d>0?'+':'')+f2(d)}</Cell></Row>})}
          <T c={C.mut} s={10} style={{marginTop:6}}>Stance is a rule-based proxy from the recent policy-rate change. Scores are research aids, not trade signals.</T></Card>
        <Card title='Institutional positioning (CFTC COT, non-commercial)'>
          {!cot?<T c={C.mut}>COT data not loaded yet — pull to refresh.</T>:<>
          <Row style={{marginBottom:6}}><Cell al='left' w={1.6} c={C.mut}> </Cell><Cell c={C.mut} b>{b}{b==='USD'?' (DXY)':''}</Cell><Cell c={C.mut} b>{q}{q==='USD'?' (DXY)':''}</Cell></Row>
          {[['Net contracts',x=>n0(x?.net)],['Weekly change',x=>x?.change==null?'n/a':(x.change>0?'+':'')+n0(x.change)],['Net % of open interest',x=>x&&x.oi?f2(x.net/x.oi*100,1)+'%':'n/a'],['Report date',x=>x?.date||'n/a']].map(([l,fn])=><Row key={l} style={{paddingVertical:4,borderTopWidth:1,borderTopColor:C.line}}><Cell al='left' w={1.6} c={C.mut}>{l}</Cell><Cell c={l==='Net contracts'&&cb?col(cb.net):undefined}>{fn(cb)}</Cell><Cell c={l==='Net contracts'&&cq?col(cq.net):undefined}>{fn(cq)}</Cell></Row>)}
          <T s={13} c={verdictC[1]} w='700' style={{marginTop:10}}>{verdictC[0]}</T></>}
          <T c={C.mut} s={10} style={{marginTop:6}}>Weekly report published Fridays (positions as of Tuesday). Positioning is context, not a signal.</T></Card>
        <Btn primary t='Send to Risk Calculator →' on={()=>send({pair:b+q,entry:f2(p.price,dp),size:jpy?'0.01':'0.0001'})} style={{alignSelf:'flex-start'}}/>
      </ScrollView></View></View></Modal>}

// ---------- weekly picks & multi-asset trade opinion (rules-based, from live data)
const wkKey=t=>{const d=new Date(t+IST),diff=(d.getUTCDay()+6)%7;return new Date(d.getTime()-diff*864e5).toISOString().slice(0,10)};
const TAGS={Stance:'Hawkish vs. Dovish Spread',Rate:'Rate Differential',GDP:'Stronger GDP',CPI:'Sticky CPI',Unemp:'Tighter Labour Market',Mom:'1M Momentum'};
const okN=x=>x!=null&&!isNaN(x);

function relatedNewsFor(tags,news){
  if(!news?.length||!tags?.length)return[];
  const w={HIGH:3,MEDIUM:2,LOW:1};
  return news
    .filter(n=>n.cur?.some(c=>tags.includes(c)))
    .sort((a,b)=>(w[b.impact]||0)-(w[a.impact]||0)||String(b.time).localeCompare(String(a.time)))
    .slice(0,3);
}

function breakdown(b,q,dir,D,A){
  const g=(c,m)=>D[c]?.[m]?.value,out=[],F=(c,m)=>okN(g(c,m))?f2(g(c,m)):'n/a';
  const add=(k,d,th,detail)=>{if(okN(d))out.push({k,tag:TAGS[k],detail,fav:Math.abs(d)<th?0:d*dir>0?1:-1})};
  add('Stance',g(b,'stance')-g(q,'stance'),1,`Central bank stance: ${b} (${g(b,'stance')??'n/a'}) vs ${q} (${g(q,'stance')??'n/a'})`);
  add('Rate',g(b,'rate')-g(q,'rate'),.5,`Policy rate spread: ${b} ${F(b,'rate')}% vs ${q} ${F(q,'rate')}% (${okN(g(b,'rate'))&&okN(g(q,'rate'))?(g(b,'rate')-g(q,'rate')>=0?'+':'')+f2(g(b,'rate')-g(q,'rate'))+'%':'n/a'})`);
  add('GDP',g(b,'gdp')-g(q,'gdp'),.5,`GDP growth y/y: ${b} ${F(b,'gdp')}% vs ${q} ${F(q,'gdp')}%`);
  add('CPI',g(b,'cpi')-g(q,'cpi'),.5,`CPI y/y divergence: ${b} ${F(b,'cpi')}% vs ${q} ${F(q,'cpi')}%`);
  add('Unemp',g(q,'unemp')-g(b,'unemp'),.5,`Unemployment strength: ${b} ${F(b,'unemp')}% vs ${q} ${F(q,'unemp')}% (lower = stronger)`);
  add('Mom',A.str[21][b]-A.str[21][q],.5,`1M basket momentum: ${b} ${f2(A.str[21][b])}% vs ${q} ${f2(A.str[21][q])}%`);
  return out;
}

function evaluateNonFx(meta,dir,{A,sc,fx,dash,assets}){
  const D=fx?.data||{},usd=D.USD||{},cad=D.CAD||{},F=dash?.fred||{},B=dash?.bls||{};
  const ad=assets?.data?.[meta.key]||null,corrMap=assets?.corr?.[meta.key]||{};
  const usdScore=sc.USD?.s||0,usdStance=usd.stance?.value??0,usdRate=usd.rate?.value,usdCpi=usd.cpi?.value??B.cpiYoY?.value,usdGdp=usd.gdp?.value,usdUnemp=usd.unemp?.value??B.unemployment?.value;
  const tips10=F.tips10y?.value,m1=ad?.m1!=null?ad.m1*100:null,d1=ad?.d1!=null?ad.d1*100:null;
  const fb=[],risk=[];
  let modelScore=0;

  if(meta.type==='METAL'||meta.type==='METAL_CROSS'){
    const isCross=meta.type==='METAL_CROSS',qCur=meta.quote,qScore=sc[qCur]?.s||0,qRate=D[qCur]?.rate?.value;
    // Lower USD/quote score + dovish Fed/CB + sticky CPI + safe-haven flows = bullish precious metals
    const rateFactor=-usdStance*1.1 + (okN(tips10)?(2.0-tips10)*0.4:0);
    const usdFactor=-qScore*0.75;
    const inflFactor=okN(usdCpi)?(usdCpi-2.2)*0.45:0;
    const havenFactor=A?((A.str[21].CHF+A.str[21].JPY)/2)*0.25:0;
    const momFactor=okN(m1)?Math.max(-1.5,Math.min(1.5,m1*0.2)):0;
    modelScore=rateFactor+usdFactor+inflFactor+havenFactor+momFactor;

    fb.push({k:'Rate',tag:'Fed Rate & Real Yield Trajectory',fav:rateFactor*dir>0.25?1:rateFactor*dir<-0.25?-1:0,detail:`Fed rate ${okN(usdRate)?f2(usdRate)+'%':'n/a'} (stance ${usdStance}), 10Y TIPS real yield ${okN(tips10)?f2(tips10)+'%':'n/a'} (${usdStance<=0?'dovish/easing tailwind for non-yielding metals':'hawkish rate headwind'})`});
    fb.push({k:'USD',tag:`${qCur} Fundamental Pressure`,fav:usdFactor*dir>0.25?1:usdFactor*dir<-0.25?-1:0,detail:`${qCur} composite score ${f2(qScore)}${isCross&&okN(qRate)?` (rate ${f2(qRate)}%)`:''} — ${qScore<0?`weaker ${qCur} lifts ${meta.sym}`:`stronger ${qCur} weighs on ${meta.sym}`}`});
    fb.push({k:'CPI',tag:'US Inflation Hedge Demand',fav:inflFactor*dir>0.15?1:inflFactor*dir<-0.15?-1:0,detail:`US CPI y/y at ${okN(usdCpi)?f2(usdCpi)+'%':'n/a'} (${okN(usdCpi)&&usdCpi>=2.5?'elevated inflation supports bullion hedge':'contained inflation reduces hedge urgency'})`});
    fb.push({k:'Haven',tag:'Safe-Haven Flows (CHF/JPY)',fav:havenFactor*dir>0.15?1:havenFactor*dir<-0.15?-1:0,detail:`1M CHF/JPY safe-haven basket avg ${A?f2((A.str[21].CHF+A.str[21].JPY)/2)+'%':'n/a'}`});
    if(okN(m1))fb.push({k:'Mom',tag:'1M Price Momentum',fav:m1*dir>0.5?1:m1*dir<-0.5?-1:0,detail:`${meta.sym} 1M return ${m1>=0?'+':''}${f2(m1)}% (1D ${d1>=0?'+':''}${f2(d1)}%)`});

    const cUsd=corrMap.USD??-0.55;
    risk.push(`60-day rolling correlation vs USD basket: ${cUsd>=0?'+':''}${f2(cUsd)} (inverse USD sensitivity amplifies FOMC/CPI spikes).`);
    if(meta.key==='XAGUSD')risk.push('Silver carries ~1.5–2x higher beta than Gold due to dual industrial + monetary demand.');
  } else if(meta.type==='INDEX'){
    const rateFactor=-usdStance*1.15;
    const gdpFactor=okN(usdGdp)?(usdGdp-1.8)*0.6:0;
    const labFactor=okN(usdUnemp)?(4.6-usdUnemp)*0.5:0;
    const momFactor=okN(m1)?Math.max(-1.5,Math.min(1.5,m1*0.25)):0;
    modelScore=rateFactor+gdpFactor+labFactor+momFactor;

    fb.push({k:'Fed',tag:'Fed Policy Stance & Rate Pressure',fav:rateFactor*dir>0.25?1:rateFactor*dir<-0.25?-1:0,detail:`Fed rate ${okN(usdRate)?f2(usdRate)+'%':'n/a'} (stance ${usdStance}) — ${usdStance<=0?(meta.key==='NAS100'?'dovish Fed lowers discount rates, bullish growth/tech':'supportive liquidity backdrop'):'restrictive policy pressures equity multiples'}`});
    fb.push({k:'GDP',tag:'US GDP Growth y/y',fav:gdpFactor*dir>0.2?1:gdpFactor*dir<-0.2?-1:0,detail:`US real GDP growth ${okN(usdGdp)?f2(usdGdp)+'%':'n/a'} y/y (${okN(usdGdp)&&usdGdp>=2?'healthy earnings expansion':'softening growth trend'})`});
    fb.push({k:'Unemp',tag:'US Labour Market Health',fav:labFactor*dir>0.2?1:labFactor*dir<-0.2?-1:0,detail:`US unemployment at ${okN(usdUnemp)?f2(usdUnemp)+'%':'n/a'} (${okN(usdUnemp)&&usdUnemp<=4.3?'resilient consumer demand':'cooling labour conditions'})`});
    if(okN(m1))fb.push({k:'Mom',tag:'1M Index Momentum',fav:m1*dir>0.5?1:m1*dir<-0.5?-1:0,detail:`${meta.sym} 1M performance ${m1>=0?'+':''}${f2(m1)}% (1D ${d1>=0?'+':''}${f2(d1)}%)`});

    const cNdx=corrMap.NAS100,cAu=corrMap.XAUUSD;
    if(meta.key!=='NAS100'&&okN(cNdx))risk.push(`60-day correlation with NAS100 is ${cNdx>=0?'+':''}${f2(cNdx)} — broad US equity beta is shared across indices.`);
    if(okN(cAu))risk.push(`60-day correlation with Gold (XAU/USD) is ${cAu>=0?'+':''}${f2(cAu)}.`);
    risk.push(meta.key==='NAS100'?'High duration sensitivity: upside surprises in US 10Y yields or CPI hit tech valuations hardest.':'Cyclical/value tilt: sensitive to ISM/GDP revisions and credit spreads.');
  } else if(meta.type==='CRYPTO'){
    const liqFactor=-usdStance*1.2 - usdScore*0.5;
    const momFactor=okN(m1)?Math.max(-1.5,Math.min(1.5,m1*0.12)):0;
    const riskApp=A?((A.str[21].AUD+A.str[21].NZD-A.str[21].JPY-A.str[21].CHF)/4)*0.3:0;
    modelScore=liqFactor+momFactor+riskApp;

    fb.push({k:'Liq',tag:'Global Liquidity & USD Rate Cycle',fav:liqFactor*dir>0.25?1:liqFactor*dir<-0.25?-1:0,detail:`Fed rate ${okN(usdRate)?f2(usdRate)+'%':'n/a'} (stance ${usdStance}), USD score ${f2(usdScore)} — ${usdStance<=0&&usdScore<=0?'easing USD liquidity tailwind for BTC':'tight USD liquidity headwind'}`});
    fb.push({k:'Risk',tag:'FX Risk-On vs Safe-Haven Appetite',fav:riskApp*dir>0.15?1:riskApp*dir<-0.15?-1:0,detail:`1M AUD/NZD vs JPY/CHF risk spread ${A?f2((A.str[21].AUD+A.str[21].NZD-A.str[21].JPY-A.str[21].CHF)/2)+'%':'n/a'}`});
    if(okN(m1))fb.push({k:'Mom',tag:'1M Crypto Momentum',fav:m1*dir>1?1:m1*dir<-1?-1:0,detail:`BTC/USD 1M return ${m1>=0?'+':''}${f2(m1)}% (1D ${d1>=0?'+':''}${f2(d1)}%)`});

    const cNdx=corrMap.NAS100??0.45,cAu=corrMap.XAUUSD??0.2;
    risk.push(`60-day correlation: ${cNdx>=0?'+':''}${f2(cNdx)} with NAS100 and ${cAu>=0?'+':''}${f2(cAu)} with Gold (XAU/USD).`);
    risk.push('High volatility asset: US CPI, NFP, and FOMC rate path shifts trigger outsized weekend and intraday swings.');
  } else if(meta.type==='OIL'){
    const cadScore=sc.CAD?.s||0,cadGdp=cad.gdp?.value;
    const growthFactor=(okN(usdGdp)?(usdGdp-1.8)*0.45:0)+(okN(cadGdp)?(cadGdp-1.5)*0.35:0);
    const petroFactor=cadScore*0.55;
    const usdFactor=-usdScore*0.45;
    const momFactor=okN(m1)?Math.max(-1.5,Math.min(1.5,m1*0.2)):0;
    modelScore=growthFactor+petroFactor+usdFactor+momFactor;

    fb.push({k:'Growth',tag:'Global / North American GDP Outlook',fav:growthFactor*dir>0.2?1:growthFactor*dir<-0.2?-1:0,detail:`US GDP y/y ${okN(usdGdp)?f2(usdGdp)+'%':'n/a'}, Canada GDP y/y ${okN(cadGdp)?f2(cadGdp)+'%':'n/a'} — ${growthFactor>=0?'expanding industrial fuel demand':'sluggish demand outlook'}`});
    fb.push({k:'Petro',tag:'Petro-Currency (CAD) Strength',fav:petroFactor*dir>0.2?1:petroFactor*dir<-0.2?-1:0,detail:`CAD composite score ${f2(cadScore)} (BoC rate ${okN(cad.rate?.value)?f2(cad.rate.value)+'%':'n/a'}) — ${cadScore>0?'CAD strength confirms energy terms-of-trade':'CAD softness signals crude headwinds'}`});
    fb.push({k:'USD',tag:'USD Inverse Pricing Pressure',fav:usdFactor*dir>0.2?1:usdFactor*dir<-0.2?-1:0,detail:`USD composite score ${f2(usdScore)} (${usdScore<0?'softer dollar supports USD-denominated crude':'strong dollar caps crude upside'})`});
    if(okN(m1))fb.push({k:'Mom',tag:'1M Crude Momentum',fav:m1*dir>0.5?1:m1*dir<-0.5?-1:0,detail:`${meta.sym} 1M return ${m1>=0?'+':''}${f2(m1)}% (1D ${d1>=0?'+':''}${f2(d1)}%)`});

    const cCad=corrMap.CAD??0.4;
    risk.push(`60-day correlation with CAD strength: ${cCad>=0?'+':''}${f2(cCad)} — avoid stacking unhedged CAD and Oil exposure.`);
    risk.push('Weekly EIA crude inventories, OPEC+ quota headlines, and geopolitical supply shocks can override macro trends.');
  }

  const eff=modelScore*dir;
  const verdict=Math.abs(modelScore)<=0.45?['Neutral — mixed macro drivers for this asset',C.mut]:eff>0?['Supported by macro & cross-asset drivers',C.up]:['Against current macro & cross-asset drivers',C.dn];
  return{modelScore,verdict,fb,risk,price:ad?.price??null,d1:ad?.d1??null,m1:ad?.m1??null};
}

function opine(str,bias,note,{A,sc,fx,cal,news,snap,dash,assets}){
  const meta=resolveSymbol(str);
  if(!meta)return{err:'Enter a valid FX pair (e.g. EUR/USD, NZD/CHF), Metal (XAU/USD, XAG/USD), Index (US30, NAS100, SPX500), Crypto (BTC/USD), or Oil (USOIL, UKOIL).'};
  const dir=bias==='Long'?1:-1,D=fx?.data||{},now=Date.now();
  const relNews=relatedNewsFor(meta.newsTags,news);
  const ev=(cal?.items||[]).filter(e=>e.impact==='High'&&meta.calCurs.includes(e.currency)&&new Date(e.timestamp)>now).slice(0,6).map(e=>{const d=ist(new Date(e.timestamp).getTime());return`${e.currency} ${e.title} — ${WD[d.wd]} ${p2(d.h)}:${p2(d.m)} IST (in ${fmtCd(new Date(e.timestamp)-now)}) · fcst ${e.forecast||'–'} vs prev ${e.previous||'–'}`});

  if(meta.type==='FX'){
    const b=meta.base,q=meta.quote,gap=sc[b].s-sc[q].s,eff=gap*dir,fb=breakdown(b,q,dir,D,A),nf=fb.filter(x=>x.fav===1).length,na=fb.filter(x=>x.fav===-1).length,comp=Math.min(sc[b].n,sc[q].n)/5;
    const verdict=Math.abs(gap)<=1?['Neutral — no clear fundamental edge for this pair',C.mut]:eff>0?['Supported by the fundamental scores',C.up]:['Against the fundamental scores',C.dn];
    const i=CUR.indexOf(b),j=CUR.indexOf(q),cbq=A.corr[i][j],risk=[];
    const top=c=>{const k=CUR.indexOf(c);return CUR.map((x,m)=>[x,A.corr[k][m]]).filter(([x])=>x!==b&&x!==q).sort((x,y)=>Math.abs(y[1])-Math.abs(x[1]))[0]};
    [b,q].forEach(c=>{const t=top(c);if(t&&Math.abs(t[1])>=.5)risk.push(`${c} strength is ${t[1]>0?'positively':'negatively'} correlated with ${t[0]} (${t[1]>0?'+':''}${t[1].toFixed(2)}, 60d) — a second trade on ${t[0]} would ${t[1]>0?'stack':'partly hedge'} the same risk.`)});
    if(cbq>.5)risk.push(`${b} and ${q} strength have been moving together (corr +${cbq.toFixed(2)}), which tends to mute the pair.`);else risk.push(`${b} vs ${q} strength correlation is ${cbq>0?'+':''}${cbq.toFixed(2)} (60d) — no unusual co-movement.`);
    const ex={[b]:dir,[q]:-dir};[...(snap?.long||[]),...(snap?.short||[])].filter(p=>p.type==='FX').forEach(p=>{if(p.b===b&&p.q===q)return;const d2=p.dir||1,e2={[p.b]:d2,[p.q]:-d2},sh=Object.keys(ex).filter(c=>e2[c]&&e2[c]===ex[c]);if(sh.length)risk.push(`Same-direction ${sh.join('/')} exposure as this week's ${d2>0?'long':'short'} pick ${p.pair}.`)});
    const hn=news.filter(n=>n.impact==='HIGH'&&n.cur?.some(c=>c===b||c===q)&&Date.now()-new Date(n.time)<72*36e5);
    if(hn.length)risk.push(`${hn.length} high-impact headline(s) tagged ${b}/${q} in the last 72h.`);
    if(comp<.6)risk.push(`Only ${Math.round(comp*100)}% of score inputs available for this pair — treat the score cautiously.`);
    return{meta,sym:meta.sym,bias,note,gap,verdict,fb,ev,risk,relNews,sum:`Your ${bias} ${meta.sym} idea: composite ${b} ${f2(sc[b].s)} vs ${q} ${f2(sc[q].s)} (gap ${f2(gap)}); ${nf} factor(s) support it, ${na} contradict it.`};
  }

  const nonFx=evaluateNonFx(meta,dir,{A,sc,fx,dash,assets});
  const nf=nonFx.fb.filter(x=>x.fav===1).length,na=nonFx.fb.filter(x=>x.fav===-1).length;
  return{meta,sym:meta.sym,bias,note,gap:nonFx.modelScore,verdict:nonFx.verdict,fb:nonFx.fb,ev,risk:nonFx.risk,relNews,sum:`Your ${bias} ${meta.sym} idea: macro & cross-asset model score ${nonFx.modelScore>=0?'+':''}${f2(nonFx.modelScore)}; ${nf} driver(s) support it, ${na} contradict it.`};
}

function Picks({A,sc,fx,cal,news,dash,assets,scrollRef}){
  const [snap,setSnap]=useState(null);
  const [form,setForm]=useState({pair:'',bias:'Long',note:''});
  const [res,setRes]=useState(null);
  const [flash,setFlash]=useState(false);
  const opinionY=useRef(0);
  const wk=wkKey(Date.now()),D=fx?.data||{},rows=useMemo(()=>A?pairRows(A,sc):[],[A,sc]);

  const build=()=>{
    // 1. FX Setups
    const mkFx=p=>{
      const d=Math.sign(p.gap);
      const bd=breakdown(p.b,p.q,d,D,A);
      const favReasons=bd.filter(x=>x.fav===1).map(x=>x.detail);
      if(!favReasons.length)favReasons.push(`Composite score gap of ${f2(p.gap)} (${p.b} ${f2(sc[p.b].s)} vs ${p.q} ${f2(sc[p.q].s)})`);
      return{type:'FX',category:'FX',pair:p.b+'/'+p.q,b:p.b,q:p.q,dir:d,gap:p.gap,price:p.price,dp:p.q==='JPY'?3:5,comp:p.comp,tags:bd.filter(x=>x.fav===1).map(x=>x.tag),reasons:favReasons.slice(0,4),newsTags:[p.b,p.q]};
    };
    const okFx=rows.filter(p=>p.comp>=.6);
    const fxLongs=okFx.filter(p=>p.gap>1).sort((x,y)=>y.gap-x.gap).slice(0,2).map(mkFx);
    const fxShorts=okFx.filter(p=>p.gap<-1).sort((x,y)=>x.gap-y.gap).slice(0,2).map(mkFx);

    // 2. Non-FX Setups (Metals, Indices, Crypto, Oil)
    const nonFxSyms=['XAU/USD','XAG/USD','US30','NAS100','BTC/USD','USOIL'];
    const nonFxAll=nonFxSyms.map(sym=>{
      const meta=resolveSymbol(sym);
      const evLong=evaluateNonFx(meta,1,{A,sc,fx,dash,assets});
      const score=evLong.modelScore;
      const d=score>=0?1:-1;
      const evDir=d===1?evLong:evaluateNonFx(meta,-1,{A,sc,fx,dash,assets});
      const favReasons=evDir.fb.filter(x=>x.fav===1).map(x=>x.detail);
      if(!favReasons.length)favReasons.push(...evDir.fb.slice(0,2).map(x=>x.detail));
      return{type:meta.type,category:meta.type==='METAL'?'Metals':meta.type==='INDEX'?'Indices':meta.type==='CRYPTO'?'Crypto':'Energy',pair:meta.sym,key:meta.key,dir:d,gap:score,price:evDir.price,dp:meta.dp,comp:1,tags:evDir.fb.filter(x=>x.fav===1).map(x=>x.tag),reasons:favReasons.slice(0,4),newsTags:meta.newsTags};
    });

    const nonFxLongs=nonFxAll.filter(x=>x.gap>0.35).sort((a,b)=>b.gap-a.gap).slice(0,3);
    const nonFxShorts=nonFxAll.filter(x=>x.gap<-0.35).sort((a,b)=>a.gap-b.gap).slice(0,3);

    return{week:wk,at:Date.now(),long:[...fxLongs,...nonFxLongs],short:[...fxShorts,...nonFxShorts]};
  };

  const refresh=()=>{const n=build();setSnap(n);store.set('picks_v10',n)};
  useEffect(()=>{if(!A||!fx)return;let off=false;(async()=>{const s=await store.get('picks_v10',null);if(off)return;if(s&&s.week===wk)setSnap(s);else refresh()})();return()=>{off=true}},[!!A,!!fx,!!assets,wk]);

  if(!A||!fx)return<Wait/>;

  const run=(pair,bias,note)=>{
    const out=opine(pair,bias,note,{A,sc,fx,cal,news,snap,dash,assets});
    setRes(out);
    setFlash(true);
    setTimeout(()=>setFlash(false),1200);
    if(scrollRef?.current&&opinionY.current>0){
      setTimeout(()=>scrollRef.current.scrollTo({y:Math.max(0,opinionY.current-16),animated:true}),60);
    }
  };

  const impBadge=imp=>imp==='HIGH'?['#7f1d1d','#fecaca','HIGH']:imp==='MEDIUM'?['#78350f','#fde68a','MED']:[C.line,C.mut,'LOW'];

  const NewsSnippet=({items})=>{
    if(!items?.length)return<T c={C.mut} s={11} style={{marginTop:4}}>No recent matching headlines in the live feed.</T>;
    return<View style={{marginTop:8,paddingTop:8,borderTopWidth:1,borderTopColor:C.line}}>
      <T c={C.mut} s={10} w='700' style={{marginBottom:4}}>RELATED LIVE NEWS CATALYSTS</T>
      {items.map(n=>{const[bg,fg,lb]=impBadge(n.impact);return<TouchableOpacity key={n.id} onPress={()=>n.url&&Linking.openURL(n.url)} style={{flexDirection:'row',alignItems:'flex-start',marginBottom:5}}>
        <View style={{backgroundColor:bg,borderRadius:4,paddingHorizontal:5,paddingVertical:1,marginRight:6,marginTop:2}}><T s={9} w='800' c={fg}>{lb}</T></View>
        <View style={{flex:1}}><T s={12} w='600'>{n.title}</T><T c={C.mut} s={10}>{n.source} · {relT(n)}</T></View>
      </TouchableOpacity>})}
    </View>;
  };

  const card=(p,L)=>{
    const bias=L?'Long':'Short';
    let liveGap=null,livePx=p.price;
    if(p.type==='FX'){
      const cur=rows.find(r=>r.b===p.b&&r.q===p.q);
      liveGap=cur?cur.gap:null;
      if(cur)livePx=cur.price;
    }else{
      const meta=resolveSymbol(p.pair);
      if(meta){const ev=evaluateNonFx(meta,p.dir,{A,sc,fx,dash,assets});liveGap=ev.modelScore;if(ev.price!=null)livePx=ev.price}
    }
    const still=liveGap!=null&&Math.sign(liveGap)===Math.sign(p.gap)&&Math.abs(liveGap)>(p.type==='FX'?1:0.35);
    const matchingNews=relatedNewsFor(p.newsTags||[p.b,p.q],news);

    return<Card key={p.pair}>
      <Row>
        <Row style={{justifyContent:'flex-start'}}>
          <T s={17} w='800'>{p.pair}</T>
          {p.category&&<View style={{backgroundColor:C.line,borderRadius:5,paddingHorizontal:6,paddingVertical:2,marginLeft:8}}><T s={10} w='700' c={C.mut}>{p.category.toUpperCase()}</T></View>}
        </Row>
        <View style={{backgroundColor:L?'#14532d':'#7f1d1d',borderRadius:6,paddingHorizontal:8,paddingVertical:2}}>
          <T s={11} w='800' c={L?'#bbf7d0':'#fecaca'}>{bias.toUpperCase()}</T>
        </View>
      </Row>
      <T c={C.mut} s={12} style={{marginVertical:4}}>
        {livePx!=null?`Ref ${f2(livePx,p.dp??2)} · `:''}score {p.gap>=0?'+':''}{f2(p.gap)} at snapshot{liveGap!=null?`, ${liveGap>=0?'+':''}${f2(liveGap)} now`:''} · <T c={still?C.up:'#f59e0b'} s={12} w='700'>{still?'still valid':'weakened'}</T>
      </T>

      <View style={{marginTop:4,marginBottom:4}}>
        <T c={C.mut} s={10} w='700' style={{marginBottom:3}}>WHY IT'S A TOP {bias.toUpperCase()} PICK</T>
        {(p.reasons||[]).map((r,idx)=><Row key={idx} style={{alignItems:'flex-start',justifyContent:'flex-start',marginBottom:2}}>
          <T c={L?C.up:C.dn} s={12} w='800' style={{width:14}}>•</T>
          <T s={12} style={{flex:1}}>{r}</T>
        </Row>)}
      </View>

      <NewsSnippet items={matchingNews}/>

      <Btn primary t={`Get opinion (${bias.toUpperCase()} ${p.pair}) →`} on={()=>{setForm({pair:p.pair,bias,note:''});run(p.pair,bias,'')}} style={{alignSelf:'flex-start',marginTop:8}}/>
    </Card>;
  };

  const d=new Date(wk+'T00:00:00Z');
  return<>
    <T s={24} w='800'>Weekly top picks</T>
    <Note>Multi-asset macro setups ranked across 28 FX pairs, Precious Metals (XAU/USD, XAG/USD), US Indices (US30, NAS100), Crypto (BTC/USD), and Crude Oil (USOIL). Week of {WD[1]} {d.getUTCDate()} {MN[d.getUTCMonth()]} {d.getUTCFullYear()} (IST). Research aid only, not financial advice.</Note>
    <Row style={{marginBottom:10}}><T c={C.mut} s={12}>{snap?`Snapshot taken ${new Date(snap.at).toLocaleString()}`:'Building snapshot…'}</T><Btn t='Recompute now' on={refresh} style={{paddingVertical:5}}/></Row>

    {snap&&<>
      <T s={16} w='800' style={{marginBottom:8}}>🟢 Top long setups</T>
      {snap.long.length?snap.long.map(p=>card(p,true)):<Card><T c={C.mut}>No asset currently meets the Long threshold.</T></Card>}
      <T s={16} w='800' style={{marginVertical:8}}>🔴 Top short setups</T>
      {snap.short.length?snap.short.map(p=>card(p,false)):<Card><T c={C.mut}>No asset currently meets the Short threshold.</T></Card>}
    </>}

    <View onLayout={e=>{opinionY.current=e.nativeEvent.layout.y}}>
      <Card title='Multi-asset trade idea → data-backed opinion' style={flash?{borderColor:C.ac,borderWidth:2}:undefined}>
        <T c={C.mut} s={10} style={{marginBottom:5}}>QUICK-SELECT SYMBOL</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
          {QUICK_PILLS.map(sym=>{const active=form.pair.toUpperCase()===sym;return<TouchableOpacity key={sym} onPress={()=>{setForm(f=>({...f,pair:sym}));run(sym,form.bias,form.note)}} style={{paddingHorizontal:10,paddingVertical:5,borderRadius:14,marginRight:6,backgroundColor:active?C.ac:C.bg,borderWidth:1,borderColor:active?C.ac:C.line}}><T s={12} w='700' c={active?'#fff':C.tx}>{sym}</T></TouchableOpacity>})}
        </ScrollView>
        <Row style={{marginBottom:8}}>
          <Inp label='Pair / Asset (e.g. EUR/USD, XAU/USD, NAS100, BTC/USD, USOIL)' v={form.pair} set={v=>setForm({...form,pair:v})} kb='default' flex={2} ph='XAU/USD'/>
          <Btn t={form.bias} on={()=>{const nb=form.bias==='Long'?'Short':'Long';setForm({...form,bias:nb});if(form.pair.trim())run(form.pair,nb,form.note)}} style={{alignSelf:'flex-end',backgroundColor:form.bias==='Long'?'#14532d':'#7f1d1d'}}/>
        </Row>
        <Inp label='Your note / thesis (optional)' v={form.note} set={v=>setForm({...form,note:v})} kb='default' ph='e.g. FOMC rate cut expectations'/>
        <Btn primary t='Generate opinion' on={()=>run(form.pair,form.bias,form.note)} style={{alignSelf:'flex-start',marginTop:10}}/>
      </Card>

      {res&&(res.err?<Card><T c={C.dn}>{res.err}</T></Card>:<Card style={{borderLeftWidth:4,borderLeftColor:res.verdict[1],borderColor:flash?C.ac:C.line}}>
        <Row>
          <T s={18} w='800'>{res.bias.toUpperCase()} {res.sym}</T>
          <View style={{backgroundColor:C.line,borderRadius:6,paddingHorizontal:8,paddingVertical:2}}><T s={10} w='700' c={C.mut}>{res.meta.type}</T></View>
        </Row>
        <T c={res.verdict[1]} w='700' s={14} style={{marginTop:4}}>{res.verdict[0]}</T>
        <T s={13} style={{marginTop:6}}>{res.sum}</T>
        {!!res.note&&<T c={C.mut} s={12} style={{marginTop:6}}>Your note: “{res.note}”</T>}

        <T c={C.mut} s={11} w='700' style={{marginTop:12}}>PLAIN-ENGLISH RATIONALE & FACTORS ({res.bias.toUpperCase()})</T>
        {res.fb.map(x=><T key={x.k} s={13} c={x.fav>0?C.up:x.fav<0?C.dn:C.mut} style={{marginTop:4}}>{x.fav>0?'✓':x.fav<0?'✗':'•'} <T w='700' c={x.fav>0?C.up:x.fav<0?C.dn:C.tx}>{x.tag}:</T> {x.detail}</T>)}

        <NewsSnippet items={res.relNews}/>

        <T c={C.mut} s={11} w='700' style={{marginTop:12}}>RISKS & CORRELATIONS</T>
        {res.risk.map((r,i)=><T key={i} s={13} style={{marginTop:3}}>• {r}</T>)}

        <T c={C.mut} s={11} w='700' style={{marginTop:12}}>UPCOMING HIGH-IMPACT EVENTS ({res.meta.calCurs.join(' / ')})</T>
        {cal?(res.ev.length?res.ev.map((e,i)=><T key={i} s={13} style={{marginTop:3}}>🔴 {e}</T>):<T s={13} c={C.mut} style={{marginTop:2}}>None on this week's calendar.</T>):<T s={13} c={C.mut} style={{marginTop:2}}>Calendar not loaded.</T>}

        <T c={C.mut} s={10} style={{marginTop:12}}>Auto-generated from live macro scores, rate spreads, cross-asset correlations, news feed, and economic calendar using fixed rules. Objective context only — not financial advice.</T>
      </Card>)}
    </View>
  </>;
}

// ---------- app shell
const NAV=[['Analysis',[[0,'Daily brief','◐'],[8,'Weekly top picks','★'],[1,'Fundamentals','◎'],[2,'Currency pairs','⇄'],[3,'Macro & rates','▤']]],['Market',[[4,'News','☰'],[7,'Economic calendar','◷']]],['Tools',[[5,'Risk calculator','▣'],[6,'Trade journal','✎']]]];
const TABS=[['Brief',0],['Picks',8],['Scores',1],['Pairs',2],['Macro',3],['News',4],['Calendar',7],['Risk',5],['Journal',6]];
export default function App(){
  const {width}=useWindowDimensions(),wide=width>=900;
  const scrollRef=useRef(null);
  const [tab,setTab]=useState(0),[hist,setHist]=useState(null),[dash,setDash]=useState(null),[fx,setFx]=useState(null),[cal,setCal]=useState(null),[cot,setCot]=useState(null),[assets,setAssets]=useState(null),[news,setNews]=useState([]),[conn,setConn]=useState('…'),[busy,setBusy]=useState(false),[trades,setTrades]=useState([]),[pre,setPre]=useState(null),[nf,setNfS]=useState(NF0);
  const setNf=v=>{setNfS(v);store.set('newsf',v)};
  const seen=useRef(null);
  const loadNews=async()=>{
    try{const r=await fetch(API+'/api/news');if(!r.ok)throw 0;const items=(await r.json()).items||[];
      if(seen.current)items.filter(i=>i.impact==='HIGH'&&!seen.current.has(i.id)).slice(0,3).forEach(i=>Notifications.scheduleNotificationAsync({content:{title:'HIGH impact · '+i.cur.join('/'),body:i.title},trigger:null}).catch(()=>{}));
      seen.current=new Set([...(seen.current||[]),...items.map(i=>i.id)]);setNews(items);store.set('news',items);return true}
    catch{const c=await store.get('news',[]);setNews(c);return false}};
  const refresh=async(force)=>{setBusy(true);const q=force===true?'?force=1':'';const ok=await Promise.all([load('/api/history','hist',setHist),load('/api/dashboard','dash',setDash),load('/api/fundamentals'+q,'fx',setFx),load('/api/calendar'+q,'cal',setCal),load('/api/cot','cot',setCot),load('/api/assets'+q,'assets',setAssets),loadNews()]);setConn(ok.every(Boolean)?'LIVE':ok.some(Boolean)?'PARTIAL':'OFFLINE · cached');setBusy(false)};
  useEffect(()=>{(async()=>{setTrades(await store.get('trades',[]));const f=await store.get('newsf',null);if(f)setNfS({...NF0,...f});
    if(Platform.OS!=='web'){try{await Notifications.setNotificationChannelAsync('news',{name:'High-impact news',importance:Notifications.AndroidImportance.HIGH});await Notifications.requestPermissionsAsync()}catch{}}
    refresh()})();const i=setInterval(loadNews,30000),j=setInterval(()=>load('/api/calendar','cal',setCal),3e5),k=setInterval(()=>load('/api/fundamentals','fx',setFx),18e5);return()=>{clearInterval(i);clearInterval(j);clearInterval(k)}},[]);
  const fund=useMemo(()=>{const o={};CUR.forEach(c=>{const d=fx?.data?.[c]||{};o[c]={stance:d.stance?.value,rate:d.rate?.value,gdp:d.gdp?.value,unemp:d.unemp?.value}});return o},[fx]);
  const A=useMemo(()=>analytics(hist),[hist]),sc=useMemo(()=>scores(fund,A),[fund,A]);
  const send=o=>{setPre({...o,n:Date.now()});setTab(5)};
  const dot=conn==='LIVE'?C.up:conn.startsWith('OFF')?C.dn:'#f59e0b';
  const status=<Row style={{justifyContent:'flex-start'}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dot,marginRight:6}}/><T c={C.mut} s={11}>{conn}</T></Row>;
  const body=<ScrollView ref={scrollRef} style={{flex:1}} contentContainerStyle={{padding:wide?24:12,maxWidth:1100,width:'100%',alignSelf:'center'}} keyboardShouldPersistTaps='handled' refreshControl={<RefreshControl refreshing={busy} onRefresh={()=>refresh(true)} tintColor={C.ac} colors={[C.ac]}/>}>
    {(tab===0||tab===4)&&<NextHigh cal={cal}/>}
    {tab===0&&<Overview A={A} sc={sc} fund={fund}/>}{tab===1&&<Fundamentals fx={fx} sc={sc}/>}{tab===2&&<Scanner A={A} sc={sc} fx={fx} cot={cot} send={send}/>}{tab===3&&<Macro d={dash}/>}{tab===4&&<News news={news} trades={trades} nf={nf} setNf={setNf}/>}{tab===5&&<Risk pre={pre}/>}{tab===6&&<Journal trades={trades} setTrades={setTrades}/>}{tab===7&&<EconCalendar cal={cal}/>}{tab===8&&<Picks A={A} sc={sc} fx={fx} cal={cal} news={news} dash={dash} assets={assets} scrollRef={scrollRef}/>}</ScrollView>;
  const warn=<T c='#f59e0b' s={10} style={{paddingHorizontal:wide?24:14,paddingVertical:6}}>ECB data = daily reference rates, not live quotes · Scores are research aids, not trade signals.</T>;
  if(wide)return<View style={{flex:1,flexDirection:'row',backgroundColor:C.bg}}>
    <View style={{width:250,backgroundColor:'#070d20',borderRightWidth:1,borderRightColor:C.line,padding:14}}>
      <T s={16} w='800' style={{marginBottom:18}}>FX Fundamentals <T c={C.ac}>Pro</T></T>
      {NAV.map(([sec,items])=><View key={sec} style={{marginBottom:14}}><T c={C.mut} s={11} w='700' style={{marginBottom:6}}>{sec}</T>{items.map(([i,l,g])=><TouchableOpacity key={i} onPress={()=>setTab(i)} style={{flexDirection:'row',padding:10,borderRadius:8,backgroundColor:tab===i?C.card:'transparent'}}><T c={tab===i?C.ac:C.mut} style={{width:24}}>{g}</T><T c={tab===i?C.tx:C.mut} w={tab===i?'700':'400'}>{l}</T></TouchableOpacity>)}</View>)}
      <View style={{flex:1}}/>{status}</View>
    <View style={{flex:1}}><SessionBar/><Row style={{borderBottomWidth:1,borderBottomColor:C.line,paddingRight:24}}>{warn}<Btn t={busy?'Refreshing…':'Refresh'} on={()=>refresh(true)} style={{paddingVertical:6}}/></Row>{body}</View></View>;
  return<View style={{flex:1,backgroundColor:C.bg,paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||24):8}}>
    <StatusBar barStyle='light-content' backgroundColor={C.bg}/>
    <Row style={{paddingHorizontal:14,paddingBottom:4}}><T s={18} w='800'>FX Fundamentals <T c={C.ac}>Pro</T></T>{status}</Row><SessionBar/>{warn}{body}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.line}} contentContainerStyle={{paddingBottom:10}}>{TABS.map(([t,i])=><TouchableOpacity key={t} onPress={()=>setTab(i)} style={{paddingHorizontal:15,paddingVertical:12}}><T s={11} w='700' c={tab===i?C.ac:C.mut}>{t}</T></TouchableOpacity>)}</ScrollView></View>;
}
