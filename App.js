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
      <ScrollView horizontal><View><Row>{[null,...CUR].map((c,i)=><T key={i} s={10} c={C.mut} style={{width:42,textAlign:'center'}}>{c||''}</T>)}</Row>{CUR.map((a,i)=><Row key={a}><T s={10} w='700' style={{width:42}}>{a}</T>{CUR.map((b,j)=>{const v=A.corr[i][j];return<View key={b} style={{width:42,height:30,margin:1,backgroundColor:v>.5?'#166534':v<-.5?'#991b1b':C.line,alignItems:'center',justifyContent:'center',borderRadius:3}}><T s={10}>{f2(v)}</T></View>})}</Row>)}</View></ScrollView>
    </Card>
  </>;
}

function Strength({A,sc}){
  const [period,setPeriod]=useState(21);if(!A)return<Wait/>;
  const vals=A.str[period],order=CUR.slice().sort((a,b)=>vals[b]-vals[a]),max=Math.max(...CUR.map(c=>Math.abs(vals[c])))||1;
  return<>
    <T s={24} w='800'>Currency strength</T><Note>Relative performance against the other seven currencies, based on daily exchange-rate history.</Note>
    <Pills opts={[[1,'1D'],[5,'1W'],[21,'1M'],[63,'3M']]} val={period} set={setPeriod}/>
    <Card title="Currency ranking">
      {order.map((c,i)=><View key={c} style={{marginBottom:12}}>
        <Row><T w='700'>{i+1}. {c}</T><T c={col(vals[c])} w='700'>{f2(vals[c])}%</T></Row>
        <View style={{height:12,backgroundColor:C.bg,borderRadius:5,marginTop:5,overflow:'hidden'}}><View style={{height:12,width:`${Math.abs(vals[c])/max*100}%`,backgroundColor:vals[c]>=0?C.up:C.dn,borderRadius:5}}/></View>
      </View>)}
    </Card>
    <Card title="Fundamental score">
      {CUR.slice().sort((a,b)=>sc[b].s-sc[a].s).map(c=><Row key={c} style={{paddingVertical:6,borderBottomWidth:1,borderBottomColor:C.line}}><T w='700'>{c}</T><T c={col(sc[c].s)}>{f2(sc[c].s)} · {sc[c].n}/5 inputs</T></Row>)}
    </Card>
  </>;
}

function Scanner({A,sc}){
  const [filter,setFilter]=useState('ALL');if(!A)return<Wait/>;
  const rows=pairRows(A,sc).filter(p=>filter==='ALL'||p.lab===filter);
  return<>
    <T s={24} w='800'>Pair scanner</T><Note>Ranks the 28 major pairs by the difference between the two currencies' composite fundamental scores.</Note>
    <Pills opts={ [['ALL','All pairs'],['LONG','Long bias'],['SHORT','Short bias'],['NEUTRAL','Neutral']] } val={filter} set={setFilter}/>
    <Card>
      <Row style={{paddingBottom:8,borderBottomWidth:1,borderBottomColor:C.line}}>{['Pair','Bias','Gap','1D','1M'].map(x=><T key={x} c={C.mut} s={10} w='700' style={{flex:1}}>{x}</T>)}</Row>
      {rows.map(p=><Row key={p.name} style={{paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.line}}>
        <T w='700' style={{flex:1}}>{p.name}</T><T c={p.lab==='LONG'?C.up:p.lab==='SHORT'?C.dn:C.mut} s={11} w='700' style={{flex:1}}>{p.lab}</T><T style={{flex:1}}>{f2(p.gap)}</T><T c={col(p.d1)} style={{flex:1}}>{pct(p.d1)}</T><T c={col(p.m1)} style={{flex:1}}>{pct(p.m1)}</T>
      </Row>)}
    </Card>
  </>;
}

function Fundamentals({fund,setFund}){
  const [edit,setEdit]=useState(false);
  const [draft,setDraft]=useState(fund||{});
  useEffect(()=>setDraft(fund||{}),[fund]);
  const fields=[['rate','Policy rate %'],['gdp','GDP growth %'],['unemp','Unemployment %'],['stance','Central bank stance (-2 to +2)']];
  const save=()=>{setFund(draft);store.set('fund',draft);setEdit(false)};
  return<>
    <T s={24} w='800'>Fundamentals</T><Note>Central-bank policy and macroeconomic inputs used by the currency scoring model. Edit values to reflect your own research.</Note>
    {CUR.map(c=><Card key={c} title={c}>
      {fields.map(([k,l])=><Row key={k} style={{marginBottom:7}}><T c={C.mut} s={12}>{l}</T><T w='700'>{draft[c]?.[k]??'–'}</T></Row>)}
      {edit&&<View style={{marginTop:8}}>{fields.map(([k,l])=><Inp key={k} label={l} v={String(draft[c]?.[k]??'')} set={v=>setDraft(old=>({...old,[c]:{...old[c],[k]:v}}))}/>)}</View>}
      {BANKS[c]&&<TouchableOpacity onPress={()=>Linking.openURL(BANKS[c][1])}><T c={C.ac} s={11}>Official source: {BANKS[c][0]} ↗</T></TouchableOpacity>}
    </Card>)}
    <Btn t={edit?'Save fundamentals':'Edit fundamentals'} primary on={()=>edit?save():setEdit(true)}/>
  </>;
}

function Macro({fund}){
  return<>
    <T s={24} w='800'>Macro dashboard</T><Note>Official central-bank policy links and the latest macro inputs available in the app.</Note>
    {CUR.map(c=><Card key={c} title={c}>
      <Row><T w='700'>{BANKS[c]?.[0]||c}</T><T>{fund[c]?.rate!=null?`${fund[c].rate}% policy rate`:'No rate entered'}</T></Row>
      <TouchableOpacity onPress={()=>BANKS[c]&&Linking.openURL(BANKS[c][1])}><T c={C.ac} s={12}>Open official central-bank source ↗</T></TouchableOpacity>
    </Card>)}
  </>;
}

function News(){
  const [items,setItems]=useState([]),[busy,setBusy]=useState(false);
  const refresh=async()=>{setBusy(true);await load('/api/news','news',setItems);setBusy(false)};
  useEffect(()=>{refresh()},[]);
  return<>
    <T s={24} w='800'>Market news</T><Note>Latest headlines supplied by the connected backend.</Note>
    <Btn t="Refresh news" on={refresh} primary/>
    {busy&&<Wait/>}
    {items?.length?items.map((n,i)=><TouchableOpacity key={n.url||i} onPress={()=>n.url&&Linking.openURL(n.url)}>
      <Card><T w='700'>{n.title||n.headline||'Market update'}</T><T c={C.mut} s={11} style={{marginTop:6}}>{n.source||n.publisher||''} · {n.publishedAt||n.date||''}</T><T c={C.ac} s={11} style={{marginTop:6}}>Read article ↗</T></Card>
    </TouchableOpacity>):<Wait/>}
  </>;
}

function Risk(){
  const [balance,setBalance]=useState('10000'),[risk,setRisk]=useState('1'),[entry,setEntry]=useState('1.0850'),[stop,setStop]=useState('1.0800'),[rr,setRr]=useState('3');
  const b=Number(balance),r=Number(risk),e=Number(entry),s=Number(stop),ratio=Number(rr);
  const cash=b*r/100,dist=Math.abs(e-s),units=dist?cash/dist:0;
  return<>
    <T s={24} w='800'>Risk calculator</T><Note>Calculate risk amount, stop distance, position units and target price.</Note>
    <Card title="Trade parameters">
      <Inp label="Account balance ($)" v={balance} set={setBalance}/>
      <Inp label="Risk per trade (%)" v={risk} set={setRisk}/>
      <Inp label="Entry price" v={entry} set={setEntry}/>
      <Inp label="Stop-loss price" v={stop} set={setStop}/>
      <Inp label="Risk-to-reward ratio" v={rr} set={setRr}/>
    </Card>
    <Card title="Position results">
      <Row><T c={C.mut}>Risk amount</T><T c={C.dn} w='800'>${f2(cash)}</T></Row>
      <Row><T c={C.mut}>Stop distance</T><T w='700'>{f2(dist,5)}</T></Row>
      <Row><T c={C.mut}>Position units (approx.)</T><T w='700'>{f2(units,0)}</T></Row>
      <Row><T c={C.mut}>Potential profit</T><T c={C.up} w='800'>${f2(cash*ratio)}</T></Row>
      <Row><T c={C.mut}>Take-profit price</T><T w='700'>{f2(e+(e>=s?1:-1)*dist*ratio,5)}</T></Row>
    </Card>
    <Note>Position sizing depends on instrument contract size, pip value, account currency and broker specifications. Verify the calculated volume before placing a trade.</Note>
  </>;
}

function Journal(){
  const [items,setItems]=useState([]),[pair,setPair]=useState('EURUSD'),[direction,setDirection]=useState('BUY'),[result,setResult]=useState(''),[notes,setNotes]=useState('');
  useEffect(()=>{store.get('journal',[]).then(setItems)},[]);
  const add=()=>{if(!result.trim())return;const next=[{id:Date.now(),pair,direction,result,notes,date:new Date().toLocaleString()},...items];setItems(next);store.set('journal',next);setResult('');setNotes('')};
  const remove=id=>{const next=items.filter(x=>x.id!==id);setItems(next);store.set('journal',next)};
  return<>
    <T s={24} w='800'>Trading journal</T><Note>Record trades and review your execution.</Note>
    <Card title="New trade">
      <Inp label="Pair" v={pair} set={setPair} kb="default"/>
      <Pills opts={ [['BUY','Buy'],['SELL','Sell']] } val={direction} set={setDirection}/>
      <Inp label="Result (account currency)" v={result} set={setResult}/>
      <TextInput value={notes} onChangeText={setNotes} placeholder="Setup, reasoning, mistakes, lessons..." placeholderTextColor={C.mut} multiline style={{minHeight:70,color:C.tx,backgroundColor:C.bg,padding:10,borderRadius:8,marginTop:8}}/>
      <Btn t="Save trade" primary on={add}/>
    </Card>
    {items.map(x=><Card key={x.id}>
      <Row><T w='700'>{x.pair} · {x.direction}</T><T c={Number(x.result)>=0?C.up:C.dn} w='700'>{x.result}</T></Row>
      <T c={C.mut} s={10}>{x.date}</T>
      {x.notes&&<T s={12} style={{marginTop:8}}>{x.notes}</T>}
      <TouchableOpacity onPress={()=>remove(x.id)}><T c={C.dn} s={11} style={{marginTop:8}}>Delete</T></TouchableOpacity>
    </Card>)}
  </>;
}

function SessionBar(){
  const [now,setNow]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t)},[]);
  const utc=now.getUTCHours()+now.getUTCMinutes()/60;
  const sessions=[['Sydney',21,6],['Tokyo',0,9],['London',8,17],['New York',13,22]];
  const active=sessions.filter(([n,a,b])=>a<b?utc>=a&&utc<b:utc>=a||utc<b).map(x=>x[0]);
  return<Card title="Trading sessions">
    <Row><T s={12} c={C.mut}>UTC {now.toISOString().slice(11,19)}</T><T s={12} c={C.up}>{active.length?active.join(' · ')+' open':'Major sessions closed'}</T></Row>
  </Card>;
}

function Calendar({events,setEvents}){
  const [selected,setSelected]=useState(null),[day,setDay]=useState('ALL'),[impact,setImpact]=useState('ALL'),[currency,setCurrency]=useState('ALL'),[loading,setLoading]=useState(false);
  const [calendarDate,setCalendarDate]=useState(new Date().toISOString().slice(0,10));
  const refresh=async()=>{setLoading(true);await load('/api/calendar','calendar',setEvents);setLoading(false)};
  useEffect(()=>{if(!events?.length)refresh()},[]);
  const rows=useMemo(()=>{let a=Array.isArray(events)?events:(events?.events||[]);return a.filter(e=>(day==='ALL'||String(e.date||e.datetime||'').slice(0,10)===day)&&(impact==='ALL'||String(e.impact||e.importance||'').toUpperCase().includes(impact))&&(currency==='ALL'||String(e.currency||e.country||'').toUpperCase()===currency)).sort((x,y)=>new Date(x.datetime||x.date||0)-new Date(y.datetime||y.date||0))},[events,day,impact,currency]);
  const wide=useWindowDimensions().width>900;
  const {width}=useWindowDimensions();
  // Compact fixed columns plus a flexible Event column. On desktop the table
  // expands to the available main-panel width; smaller screens can still scroll.
  const tableAvailableWidth=wide?Math.max(0,Math.min(width-250,1480)-48-220-14):Math.max(0,width-24);
  const COL={time:58,currency:70,impact:76,event:0,detail:64,actual:76,forecast:76,previous:76};
  const FIXED_COL_WIDTH=COL.time+COL.currency+COL.impact+COL.detail+COL.actual+COL.forecast+COL.previous;
  const TABLE_WIDTH=Math.max(FIXED_COL_WIDTH+180,tableAvailableWidth);
  COL.event=TABLE_WIDTH-FIXED_COL_WIDTH;
  const cell=(width,align='left')=>({width,flexShrink:0,textAlign:align,paddingHorizontal:6});
  const heading=(label,w)=> <Text style={{...cell(w),color:C.mut,fontSize:10,fontWeight:'700',paddingVertical:9}}>{label}</Text>;
  const value=(v)=>v==null||v===''?'–':String(v);
  const eventName=e=>e.event||e.title||e.name||'Economic event';
  const eventTime=e=>{const d=new Date(e.datetime||e.date);return isNaN(d)?value(e.time):d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})};
  const impactLabel=e=>String(e.impact||e.importance||'').toUpperCase();
  const impactColor=e=>impactLabel(e).includes('HIGH')||impactLabel(e).includes('RED')?C.dn:impactLabel(e).includes('MED')||impactLabel(e).includes('ORANGE')? '#f59e0b':C.mut;
  return<>
    <T s={24} w='800'>Economic calendar</T>
    <Note>Economic releases and central-bank events. Select View in the Detail column to open release figures and commonly affected currency pairs.</Note>
    <Row style={{marginBottom:8,flexWrap:'wrap',gap:6}}>
      <Btn t="Refresh calendar" primary on={refresh}/>
      <Btn t="Today" on={()=>setDay(new Date().toISOString().slice(0,10))}/>
      <Btn t="All dates" on={()=>setDay('ALL')}/>
    </Row>
    <Card title="Calendar filters">
      <Row style={{flexWrap:'wrap',gap:8}}>
        <View style={{flex:1,minWidth:120}}>
          <T c={C.mut} s={10}>Date</T>
          <TextInput value={calendarDate} onChangeText={v=>{setCalendarDate(v);setDay(v)}} placeholder="YYYY-MM-DD" placeholderTextColor={C.mut} style={{color:C.tx,backgroundColor:C.bg,padding:8,borderRadius:6}}/>
        </View>
        <View style={{flex:1,minWidth:120}}>
          <T c={C.mut} s={10}>Currency</T>
          <ScrollView horizontal>{['ALL',...CUR].map(c=><TouchableOpacity key={c} onPress={()=>setCurrency(c)} style={{padding:7,backgroundColor:currency===c?C.ac:C.line,borderRadius:6,marginRight:4}}><T s={10}>{c}</T></TouchableOpacity>)}</ScrollView>
        </View>
        <View style={{flex:1,minWidth:120}}>
          <T c={C.mut} s={10}>Impact</T>
          <ScrollView horizontal>{['ALL','HIGH','MEDIUM','LOW'].map(c=><TouchableOpacity key={c} onPress={()=>setImpact(c)} style={{padding:7,backgroundColor:impact===c?C.ac:C.line,borderRadius:6,marginRight:4}}><T s={10}>{c}</T></TouchableOpacity>)}</ScrollView>
        </View>
      </Row>
    </Card>
    <Card style={{padding:0,overflow:'hidden'}}>
      <ScrollView horizontal scrollEnabled={TABLE_WIDTH>tableAvailableWidth+1} showsHorizontalScrollIndicator={TABLE_WIDTH>tableAvailableWidth+1} contentContainerStyle={{width:TABLE_WIDTH}}>
        <View style={{width:TABLE_WIDTH}}>
          <Row style={{backgroundColor:'#17234a',borderBottomWidth:1,borderBottomColor:C.line}}>
            {heading('Time',COL.time)}
            {heading('Currency',COL.currency)}
            {heading('Impact',COL.impact)}
            {heading('Event',COL.event)}
            {heading('Detail',COL.detail)}
            {heading('Actual',COL.actual)}
            {heading('Forecast',COL.forecast)}
            {heading('Previous',COL.previous)}
          </Row>
          {rows.map((e,i)=><Row key={e.id||e.eventId||i} style={{borderBottomWidth:1,borderBottomColor:C.line,minHeight:43}}>
            <Text style={{...cell(COL.time),color:C.mut,fontSize:10}}>{eventTime(e)}</Text>
            <Text style={{...cell(COL.currency),color:C.tx,fontSize:11,fontWeight:'700'}}>{value(e.currency||e.country)}</Text>
            <Text style={{...cell(COL.impact),color:impactColor(e),fontSize:10,fontWeight:'700'}}>{impactLabel(e)||'–'}</Text>
            <Text numberOfLines={2} style={{...cell(COL.event),color:C.tx,fontSize:11}}>{eventName(e)}</Text>
            <View style={{...cell(COL.detail),alignItems:'flex-start',justifyContent:'center'}}>
              <TouchableOpacity onPress={()=>setSelected(e)} style={{backgroundColor:C.ac,paddingHorizontal:8,paddingVertical:5,borderRadius:5}}>
                <Text style={{color:'#fff',fontSize:10,fontWeight:'700'}}>View</Text>
              </TouchableOpacity>
            </View>
            <Text style={{...cell(COL.actual),color:C.tx,fontSize:11}}>{value(e.actual)}</Text>
            <Text style={{...cell(COL.forecast),color:C.tx,fontSize:11}}>{value(e.forecast)}</Text>
            <Text style={{...cell(COL.previous),color:C.tx,fontSize:11}}>{value(e.previous)}</Text>
          </Row>)}
          {!rows.length&&<View style={{padding:20}}><T c={C.mut}>No calendar events match these filters.</T></View>}
        </View>
      </ScrollView>
    </Card>
    <Note>All eight columns fit on desktop; smaller screens can scroll horizontally. Select View in the Detail column to open release figures and commonly affected currency pairs.</Note>
    <Modal visible={!!selected} transparent animationType="fade" onRequestClose={()=>setSelected(null)}>
      <View style={{flex:1,backgroundColor:'#000b',justifyContent:'center',padding:18}}>
        <View style={{backgroundColor:C.card,borderRadius:14,padding:18,borderWidth:1,borderColor:C.line,maxHeight:'85%'}}>
          <Row><T s={17} w='800'>Event details</T><TouchableOpacity onPress={()=>setSelected(null)}><T c={C.mut} s={20}>×</T></TouchableOpacity></Row>
          {selected&&<ScrollView style={{marginTop:12}}>
            <T s={16} w='700'>{eventName(selected)}</T>
            <T c={C.mut} s={12} style={{marginTop:4}}>{value(selected.currency||selected.country)} · {eventTime(selected)} · {impactLabel(selected)}</T>
            <View style={{height:1,backgroundColor:C.line,marginVertical:12}}/>
            {[['Actual',selected.actual],['Forecast',selected.forecast],['Previous',selected.previous],['Revised',selected.revised],['Date',selected.date||selected.datetime],['Country',selected.country],['Currency',selected.currency],['Source',selected.source],['Description',selected.description||selected.detail]].filter(x=>x[1]!=null&&x[1]!=='').map(([k,v])=><Row key={k} style={{paddingVertical:7,borderBottomWidth:1,borderBottomColor:C.line,alignItems:'flex-start'}}><T c={C.mut} s={12} style={{width:90}}>{k}</T><T s={12} style={{flex:1}}>{String(v)}</T></Row>)}
            <View style={{marginTop:12}}>
              <T c={C.mut} s={11} w='700'>COMMONLY AFFECTED PAIRS</T>
              <T s={12} style={{marginTop:5}}>{(selected.currency||selected.country||'').toUpperCase()==='USD'?'EUR/USD · GBP/USD · USD/JPY · AUD/USD · USD/CAD · USD/CHF':(selected.currency||selected.country||'').toUpperCase()==='EUR'?'EUR/USD · EUR/GBP · EUR/JPY · EUR/CHF':(selected.currency||selected.country||'').toUpperCase()==='GBP'?'GBP/USD · EUR/GBP · GBP/JPY · GBP/CHF':(selected.currency||selected.country||'').toUpperCase()==='JPY'?'USD/JPY · EUR/JPY · GBP/JPY · AUD/JPY':`${selected.currency||selected.country||'Relevant currency'} crosses and major pairs`}</T>
            </View>
          </ScrollView>}
          <Btn t="Close" primary on={()=>setSelected(null)} style={{marginTop:14}}/>
        </View>
      </View>
    </Modal>
  </>;
}

const TABS=[['Overview',0],['Strength',1],['Scanner',2],['Fundamentals',3],['Macro',4],['News',5],['Risk',6],['Journal',7],['Calendar',8]];
export default function App(){
  const [tab,setTab]=useState(0),[history,setHistory]=useState(null),[fund,setFund]=useState({}),[events,setEvents]=useState([]),[news,setNews]=useState([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(null);
  const [width,setWidth]=useState(0);
  const win=useWindowDimensions(),wide=win.width>900;
  const refresh=async()=>{
    setBusy(true);setStatus(null);
    const results=await Promise.all([
      load('/api/history','history',setHistory),
      load('/api/fundamentals','fund',setFund),
      load('/api/calendar','calendar',setEvents),
      load('/api/news','news',setNews)
    ]);
    setStatus(results.every(Boolean)?'Live data connected':'Some data is cached or unavailable');
    setBusy(false);
  };
  useEffect(()=>{store.get('fund',{}).then(setFund);store.get('calendar',[]).then(setEvents);store.get('news',[]).then(setNews);refresh()},[]);
  const A=useMemo(()=>analytics(history),[history]),sc=useMemo(()=>scores(fund,A),[fund,A]);
  const body=()=>{
    if(tab===0)return <Overview A={A} sc={sc} fund={fund}/>;
    if(tab===1)return <Strength A={A} sc={sc}/>;
    if(tab===2)return <Scanner A={A} sc={sc}/>;
    if(tab===3)return <Fundamentals fund={fund} setFund={setFund}/>;
    if(tab===4)return <Macro fund={fund}/>;
    if(tab===5)return <News/>;
    if(tab===6)return <Risk/>;
    if(tab===7)return <Journal/>;
    if(tab===8)return <Calendar events={events} setEvents={setEvents}/>;
    return <Overview A={A} sc={sc} fund={fund}/>;
  };
  const warn=status&&<T c={status.includes('connected')?C.up:'#f59e0b'} s={10} style={{marginLeft:8}}>{status}</T>;
  return <View style={{flex:1,backgroundColor:C.bg,paddingTop:Platform.OS==='web'?8:StatusBar.currentHeight||25}}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
    <Row style={{paddingHorizontal:14,paddingVertical:8}}>
      <T s={18} w='800'>FX Fundamentals <T c={C.ac}>Pro</T></T>
      <Row><TouchableOpacity onPress={refresh} style={{padding:8}}><T c={C.ac} s={12} w='700'>{busy?'Refreshing…':'↻ Refresh'}</T></TouchableOpacity>{warn}</Row>
    </Row>
    <SessionBar/>
    <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={C.ac}/>} contentContainerStyle={{paddingHorizontal:wide?24:12,paddingBottom:24,alignItems:'center'}}>
      <View style={{maxWidth:1480,width:'100%'}}>
        {wide&&<Row style={{alignItems:'flex-start',gap:14}}>
          <View style={{width:220}}>
            <T c={C.mut} s={10} w='700' style={{marginBottom:8}}>NAVIGATION</T>
            {TABS.map(([t,i])=><TouchableOpacity key={t} onPress={()=>setTab(i)} style={{paddingVertical:12,paddingHorizontal:12,marginBottom:4,borderRadius:8,backgroundColor:tab===i?C.ac:C.card,borderWidth:1,borderColor:tab===i?C.ac:C.line}}>
              <T s={12} w='700' c={tab===i?'#fff':C.mut}>{t}</T>
            </TouchableOpacity>)}
          </View>
          <View style={{flex:1,minWidth:0}}>{body()}</View>
        </Row>}
        {!wide&&body()}
      </View>
    </ScrollView>
    {!wide&&<Row style={{backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.line,paddingBottom:10}}>{TABS.map(([t,i])=><TouchableOpacity key={t} onPress={()=>setTab(i)} style={{flex:1,alignItems:'center',paddingVertical:12}}><T s={9} w='700' c={tab===i?C.ac:C.mut}>{t}</T></TouchableOpacity>)}</Row>}
  </View>;
}
