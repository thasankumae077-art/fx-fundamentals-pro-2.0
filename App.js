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

// ---------- ui bits
const Card=({title,children,style})=><View style={{backgroundColor:C.card,borderRadius:12,padding:12,marginBottom:12,borderWidth:1,borderColor:C.line,...style}}>{title&&<Text style={{color:C.mut,fontSize:11,fontWeight:'700',letterSpacing:1,marginBottom:8}}>{title.toUpperCase()}</Text>}{children}</View>;
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
  const R=(l,o,u='%')=><Row style={{paddingVertical:3}}><T c={C.mut} s={13}>{l}</T><T s={13} w='600'>{o?`${f2(o.value)}${u}`:'n/a'} <T c={C.mut} s={10}>{o?o.date+' · '+(o.src||''):''}</T></T></Row>;
  return<>
    <T s={24} w='800'>Fundamentals</T>
    <Note>Filled automatically — nothing to type. Sources: {fx.sources}. “n/a” means no recent official figure was found; it is left out of the score (never estimated). Stance is a rule-based proxy from the recent policy-rate change, not a statement by the bank. Research aid, not a trade signal.{fx.stale?' (Showing stale server cache.)':''}</Note>
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
const AS={USD:['#15803d','$'],EUR:['#2563eb','€'],GBP:['#7e22ce','£'],JPY:['#dc2626','¥'],CHF:['#be123c','₣'],CAD:['#ea580c','C$'],AUD:['#ca8a04','A$'],NZD:['#0d9488','NZ$'],XAUUSD:['#b45309','Au'],XAGUSD:['#64748b','Ag']};
const ASSETS=Object.keys(AS),CF={'Central Banks':['#0f766e','%'],'Currencies':['#9333ea','⇄'],'Macro & Rates':['#c2410c','↗'],'Top Stories':['#334155','◆']};
const relT=n=>{const t=n.time?new Date(n.time):null;if(!t||isNaN(t))return n.publishedAt||'';const s=(Date.now()-t)/1e3,m=s/60,h=m/60,d=h/24,f=Math.floor;return s<60?'just now':m<60?`${f(m)} min ago`:h<24?`${f(h)} hour${f(h)>1?'s':''} ago`:d<7?`${f(d)} day${f(d)>1?'s':''} ago`:t.toLocaleDateString()};
function Thumb({n,style,big}){
  const [bad,setBad]=useState(false);
  if(n.imageUrl&&!bad)return<Image source={{uri:n.imageUrl}} onError={()=>setBad(true)} resizeMode='cover' style={{backgroundColor:C.line,...style}}/>;
  const a=['XAUUSD','XAGUSD',...CUR].find(c=>n.cur?.includes(c)),[bg,sym]=a?AS[a]:(CF[n.category]||CF['Top Stories']),sm=(style?.width||100)<70,h=[...(n.id||'abcdefabcdef')].slice(0,sm?6:12).map(ch=>ch.charCodeAt(0)%6);
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
  const cut=Date.now()-72*36e5,items=news.filter(n=>n.cur?.includes(asset)&&new Date(n.time)>=cut),metal=asset.startsWith('XA'),W={HIGH:3,MEDIUM:2,LOW:1};
  let net=0,tot=0,up=0,dn=0;
  items.forEach(n=>{const mv=n.move==='Up'?1:n.move==='Down'?-1:0,tn=n.tone==='Hawkish'?1:n.tone==='Dovish'?-1:0,onMetal=n.cur?.some(c=>c.startsWith('XA')),b=Math.sign(metal?mv:tn+(onMetal?0:mv));net+=W[n.impact]*b;tot+=W[n.impact]*Math.abs(b);if(b>0)up++;if(b<0)dn++});
  const r=tot?net/tot:0,bias=up+dn<2||Math.abs(r)<.3?'Mixed / Neutral':r>0?(metal?'Bullish':'Bullish / Hawkish'):(metal?'Bearish':'Bearish / Dovish'),bc=bias.startsWith('Bull')?C.up:bias.startsWith('Bear')?C.dn:'#f59e0b';
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
function News({news,trades}){
  const {width}=useWindowDimensions(),wide=width>=900,[cat,setCat]=useState('Top Stories'),[asset,setAsset]=useState(null),[imp,setImp]=useState('ALL'),[sel,setSel]=useState(null);
  const inCat=n=>cat==='Top Stories'||n.category===cat,inImp=n=>imp==='ALL'||n.impact===imp,inAsset=n=>!asset||n.cur?.includes(asset);
  const L=news.filter(n=>inCat(n)&&inImp(n)&&inAsset(n)),cnt=x=>news.filter(n=>inCat(n)&&inImp(n)&&n.cur?.includes(x)).length,impCnt=k=>news.filter(n=>inCat(n)&&inAsset(n)&&(k==='ALL'||n.impact===k)).length;
  const lead=L.find(n=>n.imageUrl&&n.impact==='HIGH')||L.find(n=>n.imageUrl)||L[0];
  const sub=lead?L.filter(n=>n.id!==lead.id&&(n.category===lead.category||n.cur?.some(c=>lead.cur?.includes(c)))).slice(0,3):[];
  const used=new Set([lead?.id,...sub.map(n=>n.id)]),rest=L.filter(n=>!used.has(n.id)),highs=rest.filter(n=>n.impact==='HIGH').slice(0,30),meds=rest.filter(n=>n.impact==='MEDIUM').slice(0,30),others=imp==='ALL'?rest.filter(n=>n.impact==='LOW').slice(0,20):[];
  const hi=news.filter(n=>n.impact==='HIGH'),movers=(hi.length?hi:news).slice(0,8);
  const mine=new Set(trades.flatMap(t=>[t.pair.slice(0,3),t.pair.slice(3,6),t.pair])),picks=mine.size?news.filter(n=>n.cur?.some(c=>mine.has(c))&&!movers.includes(n)).slice(0,5):[];
  const story=n=><TouchableOpacity key={n.id} onPress={()=>setSel(n)}><Row style={{alignItems:'flex-start',paddingVertical:12,borderTopWidth:1,borderTopColor:C.line}}><View style={{flex:1,paddingRight:12}}><Row style={{justifyContent:'flex-start',flexWrap:'wrap'}}><View style={{marginRight:8}}><Badge n={n}/></View><ImpactTag n={n}/></Row><T s={15} w='700' style={{marginTop:6}}>{n.title}</T><T c={C.mut} s={11} style={{marginTop:4}}>{relT(n)}</T></View><Thumb n={n} style={{width:92,height:92,borderRadius:12}}/></Row></TouchableOpacity>;
  const sec=(emoji,title,color,items)=>items.length?<View style={{marginTop:16}}><Row style={{borderLeftWidth:4,borderLeftColor:color,paddingLeft:10}}><T s={17} w='800'>{emoji} {title}</T><T c={C.mut} s={12}>{items.length} stories</T></Row>{items.map(story)}</View>:null;
  const main=<View style={{flex:1,width:'100%'}}>
    {!!asset&&<ImpactSummary asset={asset} news={news}/>}
    {!lead&&(asset||imp!=='ALL'?<Card><T c={C.mut}>No stories match these filters yet — try “All Impact”, “Top Stories” or another asset.</T></Card>:<Wait/>)}
    {lead&&<Card style={{padding:0,overflow:'hidden'}}><TouchableOpacity activeOpacity={.85} onPress={()=>setSel(lead)}><Thumb n={lead} big style={{width:'100%',height:wide?240:180}}/>
      <View style={{padding:14}}><Row style={{justifyContent:'flex-start',flexWrap:'wrap'}}><View style={{marginRight:8}}><Badge n={lead}/></View><ImpactTag n={lead}/></Row><T s={22} w='800' style={{marginTop:8}}>{lead.title}</T><T c={C.mut} s={12} style={{marginTop:4}}>{relT(lead)}</T></View></TouchableOpacity>
      {sub.map(r=><TouchableOpacity key={r.id} onPress={()=>setSel(r)} style={{borderTopWidth:1,borderTopColor:C.line,paddingHorizontal:14,paddingVertical:10}}><T s={14} w='600'>{r.title}</T><T c={C.mut} s={11} style={{marginTop:2}}>{r.source} · {relT(r)}</T></TouchableOpacity>)}</Card>}
    {sec('🔴','High Impact News','#ef4444',highs)}{sec('🟠','Medium Impact News','#f59e0b',meds)}{sec('📰','Other market news',C.mut,others)}</View>;
  const side=<View style={{width:wide?320:'100%',marginLeft:wide?20:0,marginTop:wide?0:12}}><Side title='Market movers' items={movers} pick={setSel}/><Side title='Picks for you · from your journal pairs' items={picks} pick={setSel}/></View>;
  return<><T s={24} w='800'>News</T><Note>Google News searches, FXStreet, CNBC, MarketWatch and central-bank feeds, refreshed every 15 minutes. Impact, tone and bias labels are keyword-based, not advice.</Note>
    <Pills opts={CATS.map(c=>[c,c])} val={cat} set={setCat}/>
    <Pills opts={[['ALL',`All Impact (${impCnt('ALL')})`],['HIGH',`🔴 High Impact (${impCnt('HIGH')})`],['MEDIUM',`🟠 Medium Impact (${impCnt('MEDIUM')})`]]} val={imp} set={setImp}/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
      <TouchableOpacity onPress={()=>setAsset(null)} style={{paddingHorizontal:12,paddingVertical:7,borderRadius:16,marginRight:6,backgroundColor:!asset?'#e6ebff':C.card,borderWidth:1,borderColor:C.line}}><T s={12} w='700' c={!asset?C.bg:C.tx}>All assets</T></TouchableOpacity>
      {ASSETS.map(x=>{const on=asset===x,k=cnt(x);return<TouchableOpacity key={x} onPress={()=>setAsset(on?null:x)} style={{flexDirection:'row',alignItems:'center',paddingLeft:10,paddingRight:6,paddingVertical:6,borderRadius:16,marginRight:6,backgroundColor:on?'#e6ebff':C.card,borderWidth:1,borderColor:on?'#e6ebff':C.line}}>
        <View style={{width:8,height:8,borderRadius:4,backgroundColor:AS[x][0],marginRight:6}}/><T s={12} w='700' c={on?C.bg:C.tx}>{x}</T>
        <View style={{minWidth:22,marginLeft:6,paddingHorizontal:6,paddingVertical:1,borderRadius:10,backgroundColor:on?C.bg:k?C.ac:C.line,alignItems:'center'}}><T s={11} w='800' c={on||k?'#fff':C.mut}>{k}</T></View></TouchableOpacity>})}</ScrollView>
    {asset&&<Row style={{marginBottom:10}}><T c={C.mut} s={13}>Showing <T w='700'>{L.length}</T> stories tagged <T w='700'>{asset}</T></T><Btn t='Clear ✕' on={()=>setAsset(null)} style={{paddingVertical:5}}/></Row>}
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
const IST=5.5*36e5,p2=n=>String(n).padStart(2,'0');
const ist=t=>{const d=new Date(t+IST);return{h:d.getUTCHours(),m:d.getUTCMinutes(),s:d.getUTCSeconds(),wd:d.getUTCDay(),day:d.getUTCDate(),mon:d.getUTCMonth(),md:d.getUTCHours()*60+d.getUTCMinutes()}};
const SESS=[['Tokyo',330,870],['London',810,1350],['New York',1110,210]];
const inR=(m,s,e)=>s<e?m>=s&&m<e:m>=s||m<e;
const closedWk=i=>(i.wd===6&&i.md>=210)||i.wd===0||(i.wd===1&&i.md<210);
const act=(s,t)=>{const i=ist(t);return!closedWk(i)&&inR(i.md,s[1],s[2])};
const nextOpen=t=>{const t0=Math.floor(t/6e4)*6e4;for(let k=1;k<=8200;k++){const x=t0+k*6e4;for(const s of SESS)if(act(s,x)&&!act(s,x-6e4))return{name:s[0],t:x}}return null};
const fmtCd=ms=>{const s=Math.max(0,Math.floor(ms/1e3)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}d ${p2(h)}h`:h?`${p2(h)}h ${p2(m)}m`:`${p2(m)}m ${p2(s%60)}s`};
const hm=m=>`${p2(Math.floor(m/60))}:${p2(m%60)}`;
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
const verdict=e=>e.better===true?1:e.better===false?-1:0;
const istDateKey=t=>{const d=new Date(new Date(t).getTime()+IST);return `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())}`};
const keyDate=k=>new Date(`${k}T00:00:00Z`);
const addDays=(k,n)=>{const d=keyDate(k);d.setUTCDate(d.getUTCDate()+n);return `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())}`};
const todayKey=()=>istDateKey(new Date().toISOString());
const dayLabel=k=>{const d=keyDate(k);return `${WD[d.getUTCDay()]} ${MN[d.getUTCMonth()]} ${d.getUTCDate()}`};
const parseFFDate=v=>{const d=new Date(v);return isNaN(d)?null:d.toISOString()};
function csvCells(line){const out=[];let s='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'&&line[i+1]==='"'&&q){s+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){out.push(s);s=''}else s+=c}out.push(s);return out}
function normalizeImportedCalendar(raw){
  let rows=[];
  if(Array.isArray(raw))rows=raw;
  else if(typeof raw==='string'&&raw.trim().startsWith('['))rows=JSON.parse(raw);
  else if(typeof raw==='string'){
    const ls=raw.trim().split(/\r?\n/),heads=csvCells(ls.shift()).map(x=>x.trim().toLowerCase());
    rows=ls.map(l=>Object.fromEntries(csvCells(l).map((v,i)=>[heads[i],v])));
  }else if(raw&&Array.isArray(raw.items))rows=raw.items;
  return rows.map((e,i)=>{
    const get=(...keys)=>{for(const k of keys){const v=e[k]??e[k.toLowerCase()];if(v!=null&&v!=='')return v}return null};
    const currency=String(get('currency','country')||'').toUpperCase(),title=String(get('title','event')||'Untitled event'),timestamp=parseFFDate(get('timestamp','date','datetime'));
    if(!MAJ.includes(currency)||!timestamp)return null;
    const actual=get('actual'),forecast=get('forecast'),a=num(actual),f=num(forecast),lower=/unemployment|jobless|claims|deficit|inventor/i.test(title);
    const better=actual==null||forecast==null||!Number.isFinite(a)||!Number.isFinite(f)||a===f?null:(lower?a<f:a>f);
    return{id:String(get('id')||`import-${i}-${timestamp}`),title,currency,impact:/high/i.test(String(get('impact')||''))?'High':/medium/i.test(String(get('impact')||''))?'Medium':'Low',timestamp,actual,forecast,previous:get('previous'),better};
  }).filter(Boolean);
}
function EconCalendar({cal,fx}){
  const {width}=useWindowDimensions(),wide=width>=1050,now=useNow();
  const [cur,setCur]=useState('ALL'),[imp,setImp]=useState('ALL'),[search,setSearch]=useState(''),[range,setRange]=useState('This Week'),[anchor,setAnchor]=useState(todayKey()),[picked,setPicked]=useState(null),[detail,setDetail]=useState(null),[importOpen,setImportOpen]=useState(false),[paste,setPaste]=useState(''),[localItems,setLocalItems]=useState([]);
  const all=[...(cal?.items||[]),...localItems],today=todayKey(),todayD=keyDate(today),weekday=todayD.getUTCDay(),weekStart=addDays(today,-((weekday+6)%7));
  const bounds=()=>{
    if(range==='Today')return[today,today];
    if(range==='Tomorrow')return[addDays(today,1),addDays(today,1)];
    if(range==='Yesterday')return[addDays(today,-1),addDays(today,-1)];
    if(range==='This Week')return[weekStart,addDays(weekStart,6)];
    if(range==='Next Week')return[addDays(weekStart,7),addDays(weekStart,13)];
    if(range==='Last Week')return[addDays(weekStart,-7),addDays(weekStart,-1)];
    if(range==='Selected Day')return[picked||today,picked||today];
    return[weekStart,addDays(weekStart,6)];
  };
  const [from,to]=bounds();
  const filtered=all.filter(e=>{const k=istDateKey(e.timestamp);return k>=from&&k<=to&&(cur==='ALL'||e.currency===cur)&&(imp==='ALL'||e.impact===imp)&&(!search||`${e.title} ${e.currency}`.toLowerCase().includes(search.toLowerCase()))}).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  const grouped={};filtered.forEach(e=>{const k=istDateKey(e.timestamp);(grouped[k]??=[]).push(e)});
  const first=keyDate(`${anchor.slice(0,7)}-01`),offset=first.getUTCDay(),days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const rates=MAJ.map(c=>({c,v:fx?.data?.[c]?.rate?.value})).filter(x=>x.v!=null&&!isNaN(Number(x.v))).sort((a,b)=>Number(b.v)-Number(a.v));
  const next=all.filter(e=>e.impact==='High'&&new Date(e.timestamp)>now).sort((a,b)=>a.timestamp.localeCompare(b.timestamp))[0];
  const jumpNext=()=>{if(next){const k=istDateKey(next.timestamp);setPicked(k);setAnchor(k);setRange('Selected Day');setCur('ALL');setImp('ALL')}};
  const dc={High:'#ef4444',Medium:'#f59e0b',Low:'#eab308'};
  const ranges=['Today','Tomorrow','This Week','Next Week','Yesterday','Last Week'];
  const importData=()=>{try{const rows=normalizeImportedCalendar(paste);if(!rows.length)throw new Error('No valid events found. Check the JSON/CSV headers and currency/date fields.');setLocalItems(rows);setImportOpen(false);setRange('This Week');setPicked(null);setPaste('');Alert.alert('Import complete',`${rows.length} events loaded locally.`)}catch(e){Alert.alert('Import failed',e.message)}};
  const dateCells=Array.from({length:offset},(_,i)=>({blank:true,key:`blank-${i}`})).concat(Array.from({length:days},(_,i)=>{const k=`${first.getUTCFullYear()}-${p2(first.getUTCMonth()+1)}-${p2(i+1)}`;return{key:k,day:i+1}}));
  const eventPairs=c=>({USD:'EURUSD · GBPUSD · AUDUSD · NZDUSD · USDJPY · USDCHF · USDCAD',EUR:'EURUSD · EURGBP · EURJPY · EURCHF · EURAUD · EURCAD · EURNZD',GBP:'GBPUSD · EURGBP · GBPJPY · GBPCHF · GBPAUD · GBPCAD · GBPNZD',JPY:'USDJPY · EURJPY · GBPJPY · AUDJPY · CADJPY · CHFJPY · NZDJPY',CHF:'USDCHF · EURCHF · GBPCHF · AUDCHF · CADCHF · NZDCHF',CAD:'USDCAD · EURCAD · GBPCAD · AUDCAD · NZDCAD',AUD:'AUDUSD · EURAUD · GBPAUD · AUDJPY · AUDCAD · AUDNZD',NZD:'NZDUSD · EURNZD · GBPNZD · AUDNZD · NZDJPY · NZDCAD'}[c]||'');

  const COL={time:54,currency:52,impact:68,detail:58,actual:66,forecast:66,previous:66};
  const MIN_W=680;
  const cell=(w,align='left')=>({width:w,flexShrink:0,textAlign:align,paddingHorizontal:5});
  const evStyle={flex:1,minWidth:150,paddingHorizontal:6};

  const EventRow=({e})=>{
    const d=ist(new Date(e.timestamp).getTime()),v=verdict(e);
    return<View style={{width:'100%',flexDirection:'row',alignItems:'center',minHeight:42,paddingVertical:7,borderTopWidth:1,borderTopColor:C.line,backgroundColor:C.bg}}>
      <T s={11} w='700' c={C.mut} style={cell(COL.time)}>{p2(d.h)}:{p2(d.m)}</T>
      <T s={11} w='800' c={C.ac} style={cell(COL.currency)}>{e.currency}</T>
      <View style={{...cell(COL.impact),flexDirection:'row',alignItems:'center'}}>
        <View style={{width:7,height:7,borderRadius:4,backgroundColor:dc[e.impact]||C.mut,marginRight:5}}/>
        <T s={10} c={dc[e.impact]||C.mut}>{e.impact}</T>
      </View>
      <T s={12} style={evStyle}>{e.title}</T>
      <View style={{width:COL.detail,flexShrink:0,paddingHorizontal:4}}>
        <TouchableOpacity accessibilityRole='button' accessibilityLabel={`View details for ${e.title}`} onPress={()=>setDetail(e)} style={{alignSelf:'flex-start',paddingVertical:4,paddingHorizontal:8,borderRadius:6,backgroundColor:'#1d315f',borderWidth:1,borderColor:'#2d4b85'}}>
          <T s={10} w='700' c='#bfdbfe'>View</T>
        </TouchableOpacity>
      </View>
      <T s={11} w='700' c={v>0?C.up:v<0?C.dn:C.tx} style={cell(COL.actual,'right')}>{e.actual??'—'}</T>
      <T s={11} c={C.mut} style={cell(COL.forecast,'right')}>{e.forecast??'—'}</T>
      <T s={11} c={C.mut} style={cell(COL.previous,'right')}>{e.previous??'—'}</T>
    </View>;
  };

  const side=<View style={{width:wide?235:'100%',marginRight:wide?12:0}}>
    <Card title='Month at a glance'>
      <Row style={{marginBottom:10}}>
        <TouchableOpacity onPress={()=>setAnchor(k=>{const d=keyDate(`${k.slice(0,7)}-01`);d.setUTCMonth(d.getUTCMonth()-1);return `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-01`})}><T s={20}>‹</T></TouchableOpacity>
        <T w='800'>{MN[first.getUTCMonth()]} {first.getUTCFullYear()}</T>
        <TouchableOpacity onPress={()=>setAnchor(k=>{const d=keyDate(`${k.slice(0,7)}-01`);d.setUTCMonth(d.getUTCMonth()+1);return `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-01`})}><T s={20}>›</T></TouchableOpacity>
      </Row>
      <View style={{flexDirection:'row',flexWrap:'wrap'}}>
        {WD.map(x=><T key={x} s={10} c={C.mut} style={{width:'14.28%',textAlign:'center',paddingVertical:5}}>{x[0]}</T>)}
        {dateCells.map(x=><TouchableOpacity key={x.key} disabled={x.blank} onPress={()=>{setPicked(x.key);setRange('Selected Day')}} style={{width:'14.28%',height:32,alignItems:'center',justifyContent:'center',borderRadius:7,backgroundColor:x.key===picked?'#1d4ed8':x.key===today?'#1e3a5f':'transparent'}}><T s={11} c={x.blank?C.mut:x.key===picked?'#fff':C.tx}>{x.day||''}</T></TouchableOpacity>)}
      </View>
    </Card>
    <Card title='Quick date ranges'>
      <View style={{flexDirection:'row',flexWrap:'wrap'}}>
        {ranges.map(r=><TouchableOpacity key={r} onPress={()=>{setRange(r);setPicked(null)}} style={{paddingHorizontal:8,paddingVertical:6,margin:2,borderRadius:7,backgroundColor:range===r?C.ac:C.line}}><T s={11} w='700'>{r}</T></TouchableOpacity>)}
        <TouchableOpacity onPress={jumpNext} style={{paddingHorizontal:10,paddingVertical:6,margin:2,borderRadius:7,backgroundColor:'#14532d',borderWidth:1,borderColor:C.up}}><T s={11} w='800' c='#bbf7d0'>↗ Up Next</T></TouchableOpacity>
      </View>
    </Card>
    <Card title='Central bank policy rates'>
      <Note>Live values from Fundamentals API · sorted high to low</Note>
      {rates.length?rates.map(x=><Row key={x.c} style={{paddingVertical:4}}><T w='700' s={12}>{x.c}</T><T w='700' s={12} c={C.up}>{f2(x.v)}%</T></Row>):<T s={12} c={C.mut}>Policy rates unavailable.</T>}
    </Card>
    <Card title='Legend'>
      <Row style={{justifyContent:'flex-start',marginBottom:5}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dc.High,marginRight:7}}/><T s={11}>High impact</T></Row>
      <Row style={{justifyContent:'flex-start',marginBottom:5}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dc.Medium,marginRight:7}}/><T s={11}>Medium impact</T></Row>
      <Row style={{justifyContent:'flex-start',marginBottom:5}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dc.Low,marginRight:7}}/><T s={11}>Low impact</T></Row>
      <T s={11} c={C.up}>Green number · better than forecast</T>
      <T s={11} c={C.dn}>Red number · worse than forecast</T>
    </Card>
    <Btn t='Import FF JSON/CSV' on={()=>setImportOpen(true)}/>
  </View>;

  const main=<View style={{flex:1,minWidth:0}}>
    <T s={22} w='800'>Economic calendar</T>
    <Note>{range}: {dayLabel(from)} – {dayLabel(to)} · Times shown in IST (Asia/Kolkata). {cal?.source||'Waiting for calendar data.'}{cal?.warning?` · ${cal.warning}`:''}{cal?.stale?' · Showing stale cache.':''}</Note>
    <Pills opts={[['ALL','All'],...MAJ.map(c=>[c,c])]} val={cur} set={setCur}/>
    <Pills opts={[['ALL','All'],['High','High'],['Medium','Medium'],['Low','Low']]} val={imp} set={setImp}/>
    <TextInput value={search} onChangeText={setSearch} placeholder='⌕  Search Events' placeholderTextColor={C.mut} style={{color:C.tx,backgroundColor:C.card,borderWidth:1,borderColor:C.line,borderRadius:8,paddingHorizontal:12,paddingVertical:9,marginBottom:10}}/>

    <Card style={{padding:0,overflow:'hidden'}}>
      <ScrollView horizontal={!wide} showsHorizontalScrollIndicator contentContainerStyle={{width:wide?'100%':undefined,minWidth:wide?'100%':MIN_W}}>
        <View style={{width:'100%',minWidth:wide?0:MIN_W}}>
          <View style={{width:'100%',flexDirection:'row',alignItems:'center',paddingVertical:10,backgroundColor:'#172448',borderBottomWidth:1,borderBottomColor:C.line}}>
            <T s={10} w='800' c={C.mut} style={cell(COL.time)}>TIME</T>
            <T s={10} w='800' c={C.mut} style={cell(COL.currency)}>CCY</T>
            <T s={10} w='800' c={C.mut} style={cell(COL.impact)}>IMPACT</T>
            <T s={10} w='800' c={C.mut} style={evStyle}>EVENT</T>
            <T s={10} w='800' c={C.mut} style={cell(COL.detail)}>DETAIL</T>
            <T s={10} w='800' c={C.mut} style={cell(COL.actual,'right')}>ACTUAL</T>
            <T s={10} w='800' c={C.mut} style={cell(COL.forecast,'right')}>FCST</T>

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

// ---------- app shell
const NAV=[['Analysis',[[0,'Daily brief','◐'],[1,'Fundamentals','◎'],[2,'Currency pairs','⇄'],[3,'Macro & rates','▤']]],['Market',[[4,'News','☰'],[7,'Economic calendar','◷']]],['Tools',[[5,'Risk calculator','▣'],[6,'Trade journal','✎']]]];
const TABS=[['Brief',0],['Scores',1],['Pairs',2],['Macro',3],['News',4],['Cal',7],['Risk',5],['Journal',6]];
export default function App(){
  const {width}=useWindowDimensions(),wide=width>=900;
  const [tab,setTab]=useState(0),[hist,setHist]=useState(null),[dash,setDash]=useState(null),[fx,setFx]=useState(null),[cal,setCal]=useState(null),[cot,setCot]=useState(null),[news,setNews]=useState([]),[conn,setConn]=useState('…'),[busy,setBusy]=useState(false),[trades,setTrades]=useState([]),[pre,setPre]=useState(null);
  const seen=useRef(null);
  const loadNews=async()=>{
    try{const r=await fetch(API+'/api/news');if(!r.ok)throw 0;const items=(await r.json()).items||[];
      if(seen.current)items.filter(i=>i.impact==='HIGH'&&!seen.current.has(i.id)).slice(0,3).forEach(i=>Notifications.scheduleNotificationAsync({content:{title:'HIGH impact · '+i.cur.join('/'),body:i.title},trigger:null}).catch(()=>{}));
      seen.current=new Set([...(seen.current||[]),...items.map(i=>i.id)]);setNews(items);store.set('news',items);return true}
    catch{const c=await store.get('news',[]);setNews(c);return false}};
  const refresh=async()=>{setBusy(true);const ok=await Promise.all([load('/api/history','hist',setHist),load('/api/dashboard','dash',setDash),load('/api/fundamentals','fx',setFx),load('/api/calendar','cal',setCal),load('/api/cot','cot',setCot),loadNews()]);setConn(ok.every(Boolean)?'LIVE':ok.some(Boolean)?'PARTIAL':'OFFLINE · cached');setBusy(false)};
  useEffect(()=>{(async()=>{setTrades(await store.get('trades',[]));
    if(Platform.OS!=='web'){try{await Notifications.setNotificationChannelAsync('news',{name:'High-impact news',importance:Notifications.AndroidImportance.HIGH});await Notifications.requestPermissionsAsync()}catch{}}
    refresh()})();const i=setInterval(loadNews,30000),j=setInterval(()=>load('/api/calendar','cal',setCal),3e5);return()=>{clearInterval(i);clearInterval(j)}},[]);
  const fund=useMemo(()=>{const o={};CUR.forEach(c=>{const d=fx?.data?.[c]||{};o[c]={stance:d.stance?.value,rate:d.rate?.value,gdp:d.gdp?.value,unemp:d.unemp?.value}});return o},[fx]);
  const A=useMemo(()=>analytics(hist),[hist]),sc=useMemo(()=>scores(fund,A),[fund,A]);
  const send=o=>{setPre({...o,n:Date.now()});setTab(5)};
  const dot=conn==='LIVE'?C.up:conn.startsWith('OFF')?C.dn:'#f59e0b';
  const status=<Row style={{justifyContent:'flex-start'}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dot,marginRight:6}}/><T c={C.mut} s={11}>{conn}</T></Row>;
  const body=<ScrollView style={{flex:1}} contentContainerStyle={{padding:wide?24:12,maxWidth:1100,width:'100%',alignSelf:'center'}} keyboardShouldPersistTaps='handled' refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={C.ac} colors={[C.ac]}/>}>
    {(tab===0||tab===4)&&<NextHigh cal={cal}/>}
    {tab===0&&<Overview A={A} sc={sc} fund={fund}/>}{tab===1&&<Fundamentals fx={fx} sc={sc}/>}{tab===2&&<Scanner A={A} sc={sc} fx={fx} cot={cot} send={send}/>}{tab===3&&<Macro d={dash}/>}{tab===4&&<News news={news} trades={trades}/>}{tab===5&&<Risk pre={pre}/>}{tab===6&&<Journal trades={trades} setTrades={setTrades}/>}{tab===7&&<EconCalendar cal={cal} fx={fx}/>}</ScrollView>;
  const warn=<T c='#f59e0b' s={10} style={{paddingHorizontal:wide?24:14,paddingVertical:6}}>ECB data = daily reference rates, not live quotes · Scores are research aids, not trade signals.</T>;
  if(wide)return<View style={{flex:1,flexDirection:'row',backgroundColor:C.bg}}>
    <View style={{width:250,backgroundColor:'#070d20',borderRightWidth:1,borderRightColor:C.line,padding:14}}>
      <T s={16} w='800' style={{marginBottom:18}}>FX Fundamentals <T c={C.ac}>Pro</T></T>
      {NAV.map(([sec,items])=><View key={sec} style={{marginBottom:14}}><T c={C.mut} s={11} w='700' style={{marginBottom:6}}>{sec}</T>{items.map(([i,l,g])=><TouchableOpacity key={i} onPress={()=>setTab(i)} style={{flexDirection:'row',padding:10,borderRadius:8,backgroundColor:tab===i?C.card:'transparent'}}><T c={tab===i?C.ac:C.mut} style={{width:24}}>{g}</T><T c={tab===i?C.tx:C.mut} w={tab===i?'700':'400'}>{l}</T></TouchableOpacity>)}</View>)}
      <View style={{flex:1}}/>{status}</View>
    <View style={{flex:1}}><SessionBar/><Row style={{borderBottomWidth:1,borderBottomColor:C.line,paddingRight:24}}>{warn}<Btn t={busy?'Refreshing…':'Refresh'} on={refresh} style={{paddingVertical:6}}/></Row>{body}</View></View>;
  return<View style={{flex:1,backgroundColor:C.bg,paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||24):8}}>
    <StatusBar barStyle='light-content' backgroundColor={C.bg}/>
    <Row style={{paddingHorizontal:14,paddingBottom:4}}><T s={18} w='800'>FX Fundamentals <T c={C.ac}>Pro</T></T>{status}</Row><SessionBar/>{warn}{body}
    <Row style={{backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.line,paddingBottom:10}}>{TABS.map(([t,i])=><TouchableOpacity key={t} onPress={()=>setTab(i)} style={{flex:1,alignItems:'center',paddingVertical:12}}><T s={9} w='700' c={tab===i?C.ac:C.mut}>{t}</T></TouchableOpacity>)}</Row></View>;
}
