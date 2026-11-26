import React,{useState,useEffect,useRef,useMemo} from 'react';
import {View,Text,ScrollView,TextInput,TouchableOpacity,RefreshControl,Linking,Share,Alert,StatusBar,Platform,Image,useWindowDimensions} from 'react-native';
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
  const S=(c,i,k)=>{let s=0;CUR.forEach(o=>{if(o!==c)s+=d(o,i,k)});return(s/7-d(c,i,k))*100}; // currency vs basket of the other 7
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
  const R=(l,o,u='%')=><Row style={{paddingVertical:3}}><T c={C.mut} s={13}>{l}</T><T s={13} w='600'>{o?`${f2(o.value)}${u}`:'n/a'} <T c={C.mut} s={10}>{o?.date||''}</T></T></Row>;
  return<>
    <T s={24} w='800'>Fundamentals</T>
    <Note>Filled automatically — nothing to type. Sources: {fx.sources}. “n/a” means no recent official figure was found; it is left out of the score (never estimated). Stance is a rule-based proxy from the recent policy-rate change, not a statement by the bank. Research aid, not a trade signal.{fx.stale?' (Showing stale server cache.)':''}</Note>
    {CUR.map(c=>{const d=D[c]||{};return<Card key={c} title={`${c} · ${BANKS[c][0]}`}>
      {R('Policy rate',d.rate)}{R('CPI y/y',d.cpi)}{R('GDP growth y/y',d.gdp)}{R('Unemployment',d.unemp)}
      <Row style={{paddingVertical:3}}><T c={C.mut} s={13}>Stance (-2..+2)</T><T s={13} w='600'>{d.stance?d.stance.value:'n/a'}</T></Row>{d.stance&&<T c={C.mut} s={10}>{d.stance.basis}</T>}
      <Row style={{marginTop:8}}><T c={col(sc[c].s)} w='700'>Score {f2(sc[c].s)} <T c={C.mut} s={11}>({sc[c].n}/5 inputs)</T></T><TouchableOpacity onPress={()=>Linking.openURL(BANKS[c][1])}><T c={C.ac} s={12}>Meeting calendar ↗</T></TouchableOpacity></Row></Card>})}
  </>;
}
function Scanner({A,sc}){
  if(!A)return<Wait/>;
  return<><Note>Reference prices are ECB daily rates ({A.date}), not live quotes. Ranked by |score gap|. LONG/SHORT when gap beyond ±1.</Note>
    {pairRows(A,sc).map(p=><Card key={p.name} style={{padding:10,marginBottom:8}}>
      <Row><T w='700' s={16}>{p.b}/{p.q}</T><T c={col(p.gap)} w='700'>{p.lab}</T><T c={col(p.gap)}>gap {f2(p.gap)}</T></Row>
      <Row style={{marginTop:4}}><T c={C.mut} s={12}>Ref {f2(p.price,p.q==='JPY'?3:5)}</T><T c={col(p.d1)} s={12}>1D {pct(p.d1)}</T><T c={col(p.m1)} s={12}>1M {pct(p.m1)}</T><T c={p.comp<.6?C.dn:C.up} s={12}>Data {Math.round(p.comp*100)}%</T></Row></Card>)}</>;
}
function Macro({d}){
  if(!d)return<Wait/>;const F=d.fred||{},B=d.bls||{};
  const R=(l,o,u='')=><Row key={l} style={{paddingVertical:5}}><T c={C.mut}>{l}</T><T w='700'>{o?`${f2(o.value)}${u}`:'n/a'} <T c={C.mut} s={10}>{o?.date||''}</T></T></Row>;
  const sp=F.us10y&&F.us2y?F.us10y.value-F.us2y.value:null,be=F.us10y&&F.tips10y?F.us10y.value-F.tips10y.value:null;
  return<>
    <Card title="Derived">{R('2s10s spread',sp!=null&&{value:sp},' pp')}{R('10Y real yield (TIPS)',F.tips10y,'%')}{R('10Y breakeven inflation',be!=null&&{value:be},'%')}</Card>
    <Card title="FRED">{R('US 2Y',F.us2y,'%')}{R('US 5Y',F.us5y,'%')}{R('US 10Y',F.us10y,'%')}{R('Broad USD index',F.usdBroad)}{R('WTI $/bbl',F.wti)}{R('Brent $/bbl',F.brent)}{R('Gold',F.gold)}</Card>
    <Card title="BLS">{R('CPI y/y',B.cpiYoY,'%')}{R('Unemployment',B.unemployment,'%')}{R('Nonfarm payrolls m/m (k)',B.payrollsChange)}</Card>
    {d.stale&&<Note>Showing stale server cache.</Note>}{Object.keys(d.errors||{}).length>0&&<Note>Unavailable upstream: {Object.keys(d.errors).join(', ')}</Note>}</>;
}
function News({news}){
  const [cur,setCur]=useState('ALL'),[imp,setImp]=useState('ALL'),[sel,setSel]=useState(null);
  const L=news.filter(n=>(cur==='ALL'||n.cur.includes(cur))&&(imp==='ALL'||n.impact===imp)).slice(0,120);
  const ic={HIGH:C.dn,MEDIUM:'#f59e0b',LOW:C.mut};
  return<><T s={24} w='800' style={{marginBottom:8}}>News</T>
    {sel&&<Card style={{borderColor:C.ac}}>
      {!!sel.img&&<Image source={{uri:sel.img}} style={{width:'100%',height:160,borderRadius:8,marginBottom:10}} resizeMode='cover'/>}
      <Row style={{justifyContent:'flex-start',marginBottom:6}}><T c={ic[sel.impact]} s={11} w='800' style={{marginRight:8}}>{sel.impact} IMPACT</T><T c={C.ac} s={11}>{sel.cur.join(' ')}</T></Row>
      <T s={18} w='700'>{sel.title}</T><T c={C.mut} s={11} style={{marginVertical:6}}>{sel.source} · {new Date(sel.time).toLocaleString()}</T>
      <T s={14}>{sel.summary||'The publisher shares no summary in its feed. Open the full article for the complete text.'}</T>
      <Row style={{justifyContent:'flex-start',marginTop:10}}><Btn primary t='Read full article ↗' on={()=>Linking.openURL(sel.link)} style={{marginRight:8}}/><Btn t='Close' on={()=>setSel(null)}/></Row></Card>}
    <Pills opts={[['ALL','All'],...CUR.map(c=>[c,c])]} val={cur} set={setCur}/><Pills opts={['ALL','HIGH','MEDIUM','LOW'].map(x=>[x,x])} val={imp} set={setImp}/>
    {!L.length&&<Wait/>}
    {L.map(n=><TouchableOpacity key={n.id} onPress={()=>setSel(n)}><Card style={{padding:10,marginBottom:8}}><Row style={{marginBottom:4,justifyContent:'flex-start'}}><T c={ic[n.impact]} s={10} w='800' style={{marginRight:8}}>{n.impact}</T><T c={C.ac} s={10}>{n.cur.join(' ')}</T></Row><T s={14}>{n.title}</T>{!!n.summary&&<T c={C.mut} s={12} style={{marginTop:3}} >{n.summary.slice(0,140)}…</T>}<T c={C.mut} s={10} style={{marginTop:4}}>{n.source} · {new Date(n.time).toLocaleString()}</T></Card></TouchableOpacity>)}</>;
}
function Risk(){
  const [v,setV]=useState({bal:'10000',risk:'1',entry:'',stop:'',target:'',pip:'10',size:'0.0001'});const u=k=>x=>setV({...v,[k]:x});
  const n=k=>parseFloat(v[k]),ok=['bal','risk','entry','stop','pip','size'].every(k=>!isNaN(n(k)));
  const sp=ok?Math.abs(n('entry')-n('stop'))/n('size'):null,cash=ok?n('bal')*n('risk')/100:null,lots=ok&&sp>0?cash/(sp*n('pip')):null,rr=!isNaN(n('target'))&&ok&&sp>0?Math.abs(n('target')-n('entry'))/Math.abs(n('entry')-n('stop')):null;
  return<Card title="Position size">
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

// ---------- app shell
const NAV=[['Analysis',[[0,'Daily brief','◐'],[1,'Fundamentals','◎'],[2,'Currency pairs','⇄'],[3,'Macro & rates','▤']]],['Market',[[4,'News','☰']]],['Tools',[[5,'Risk calculator','▣'],[6,'Trade journal','✎']]]];
const TABS=['Brief','Scores','Pairs','Macro','News','Risk','Journal'];
export default function App(){
  const {width}=useWindowDimensions(),wide=width>=900;
  const [tab,setTab]=useState(0),[hist,setHist]=useState(null),[dash,setDash]=useState(null),[fx,setFx]=useState(null),[news,setNews]=useState([]),[conn,setConn]=useState('…'),[busy,setBusy]=useState(false),[trades,setTrades]=useState([]);
  const seen=useRef(null);
  const loadNews=async()=>{
    try{const r=await fetch(API+'/api/news');if(!r.ok)throw 0;const items=(await r.json()).items||[];
      if(seen.current)items.filter(i=>i.impact==='HIGH'&&!seen.current.has(i.id)).slice(0,3).forEach(i=>Notifications.scheduleNotificationAsync({content:{title:'HIGH impact · '+i.cur.join('/'),body:i.title},trigger:null}).catch(()=>{}));
      seen.current=new Set([...(seen.current||[]),...items.map(i=>i.id)]);setNews(items);store.set('news',items);return true}
    catch{const c=await store.get('news',[]);setNews(c);return false}};
  const refresh=async()=>{setBusy(true);const ok=await Promise.all([load('/api/history','hist',setHist),load('/api/dashboard','dash',setDash),load('/api/fundamentals','fx',setFx),loadNews()]);setConn(ok.every(Boolean)?'LIVE':ok.some(Boolean)?'PARTIAL':'OFFLINE · cached');setBusy(false)};
  useEffect(()=>{(async()=>{setTrades(await store.get('trades',[]));
    if(Platform.OS!=='web'){try{await Notifications.setNotificationChannelAsync('news',{name:'High-impact news',importance:Notifications.AndroidImportance.HIGH});await Notifications.requestPermissionsAsync()}catch{}}
    refresh()})();const i=setInterval(loadNews,30000);return()=>clearInterval(i)},[]);
  const fund=useMemo(()=>{const o={};CUR.forEach(c=>{const d=fx?.data?.[c]||{};o[c]={stance:d.stance?.value,rate:d.rate?.value,gdp:d.gdp?.value,unemp:d.unemp?.value}});return o},[fx]);
  const A=useMemo(()=>analytics(hist),[hist]),sc=useMemo(()=>scores(fund,A),[fund,A]);
  const dot=conn==='LIVE'?C.up:conn.startsWith('OFF')?C.dn:'#f59e0b';
  const status=<Row style={{justifyContent:'flex-start'}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:dot,marginRight:6}}/><T c={C.mut} s={11}>{conn}</T></Row>;
  const body=<ScrollView style={{flex:1}} contentContainerStyle={{padding:wide?24:12,maxWidth:1100,width:'100%',alignSelf:'center'}} keyboardShouldPersistTaps='handled' refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={C.ac} colors={[C.ac]}/>}>
    {tab===0&&<Overview A={A} sc={sc} fund={fund}/>}{tab===1&&<Fundamentals fx={fx} sc={sc}/>}{tab===2&&<Scanner A={A} sc={sc}/>}{tab===3&&<Macro d={dash}/>}{tab===4&&<News news={news}/>}{tab===5&&<Risk/>}{tab===6&&<Journal trades={trades} setTrades={setTrades}/>}</ScrollView>;
  const warn=<T c='#f59e0b' s={10} style={{paddingHorizontal:wide?24:14,paddingVertical:6}}>ECB data = daily reference rates, not live quotes · Scores are research aids, not trade signals.</T>;
  if(wide)return<View style={{flex:1,flexDirection:'row',backgroundColor:C.bg}}>
    <View style={{width:250,backgroundColor:'#070d20',borderRightWidth:1,borderRightColor:C.line,padding:14}}>
      <T s={16} w='800' style={{marginBottom:18}}>FX Fundamentals <T c={C.ac}>Pro</T></T>
      {NAV.map(([sec,items])=><View key={sec} style={{marginBottom:14}}><T c={C.mut} s={11} w='700' style={{marginBottom:6}}>{sec}</T>{items.map(([i,l,g])=><TouchableOpacity key={i} onPress={()=>setTab(i)} style={{flexDirection:'row',padding:10,borderRadius:8,backgroundColor:tab===i?C.card:'transparent'}}><T c={tab===i?C.ac:C.mut} style={{width:24}}>{g}</T><T c={tab===i?C.tx:C.mut} w={tab===i?'700':'400'}>{l}</T></TouchableOpacity>)}</View>)}
      <View style={{flex:1}}/>{status}</View>
    <View style={{flex:1}}><Row style={{borderBottomWidth:1,borderBottomColor:C.line,paddingRight:24}}>{warn}<Btn t={busy?'Refreshing…':'Refresh'} on={refresh} style={{paddingVertical:6}}/></Row>{body}</View></View>;
  return<View style={{flex:1,backgroundColor:C.bg,paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||24):8}}>
    <StatusBar barStyle='light-content' backgroundColor={C.bg}/>
    <Row style={{paddingHorizontal:14,paddingBottom:2}}><T s={18} w='800'>FX Fundamentals <T c={C.ac}>Pro</T></T>{status}</Row>{warn}{body}
    <Row style={{backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.line,paddingBottom:10}}>{TABS.map((t,i)=><TouchableOpacity key={t} onPress={()=>setTab(i)} style={{flex:1,alignItems:'center',paddingVertical:12}}><T s={10} w='700' c={tab===i?C.ac:C.mut}>{t}</T></TouchableOpacity>)}</Row></View>;
}
