import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import HomeView from './views/HomeView';
import {replacePeriodTasks,updateDayRecords} from './weekly-planning';
import {load,today,type State,type View} from './app-state';
import {uid} from './id';
import {BookOpen,CalendarDays,Heart,Settings2,Home,Compass,ChevronLeft,ArrowRight,Check,ShieldCheck} from 'lucide-react';
import AuthScreen from './AuthScreen';
import {authClient} from './auth';
import {checkAdminAccess,type AdminAccess} from './admin-access';
import {fetchCloudState,saveCloudState} from './cloud-state';
import {fetchPlatformCurriculum} from './platform-curriculum';
import type {User} from '@supabase/supabase-js';

const LearningJourney=lazy(()=>import('./LearningJourney'));
const AdminDashboard=lazy(()=>import('./AdminDashboard'));
const DayPlanner=lazy(()=>import('./DayPlanner'));
const StrongGoals=lazy(()=>import('./StrongGoals'));
const TasksPanel=lazy(()=>import('./views/TasksPanel'));
const WeeklyPlanner=lazy(()=>import('./views/WeeklyPlanner'));
const MonthlyPlanner=lazy(()=>import('./views/MonthlyPlanner'));
const ReflectionView=lazy(()=>import('./views/ReflectionView'));
const WirdsView=lazy(()=>import('./views/WirdsView'));
const SettingsView=lazy(()=>import('./views/SettingsView'));
const loadingView=<div className="auth-loading" dir="rtl" role="status">جارٍ تحميل الصفحة…</div>;
const newReflection=(text:string)=>({id:uid(),date:today(),text});

const crumbs:Record<View,string>={home:'الرئيسية',day:'يومي مع الله',week:'أسبوعي مع الله',month:'شهري مع الله',goals:'المؤمن القوي',learn:'السير إلى الله',reflect:'محاسبة النفس',wird:'زكِّ نفسك',settings:'الإعدادات'};

export default function App(){
  const [user,setUser]=useState<User|null>(null);
  const [authReady,setAuthReady]=useState(!authClient);
  const [demo,setDemo]=useState(false);
  const [adminCheck,setAdminCheck]=useState<{userId:string;status:AdminAccess}>({userId:'',status:'checking'});
  const [adminRetry,setAdminRetry]=useState(0);
  const adminAccess=adminCheck.userId===user?.id?adminCheck.status:'checking';
  useEffect(()=>{
    if(!authClient)return;
    const client=authClient;
    client.auth.getUser().then(({data})=>{setUser(data.user);setAuthReady(true)}).catch(()=>setAuthReady(true));
    const {data}=client.auth.onAuthStateChange((_event,session)=>{setUser(session?.user??null);setAuthReady(true)});
    return()=>data.subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    if(!user||!authClient)return;
    let active=true;
    const client=authClient;
    setAdminCheck({userId:user.id,status:'checking'});
    checkAdminAccess(()=>client.rpc('is_admin')).then(status=>{if(active)setAdminCheck({userId:user.id,status})});
    return()=>{active=false};
  },[user?.id,adminRetry]);
  if(!authReady)return <div className="auth-loading" dir="rtl">جارٍ التحقق من حسابك…</div>;
  const adminPath=/^\/admin\/?$/.test(window.location.pathname);
  if(!user&&(!demo||adminPath))return <AuthScreen admin={adminPath} allowDemo={!adminPath} onDemo={()=>setDemo(true)}/>;
  if(adminPath&&adminAccess==='checking')return <div className="auth-loading" dir="rtl" role="status">جارٍ التحقق من صلاحية الإدارة…</div>;
  if(adminPath&&adminAccess!=='allowed')return <main className="auth-loading" dir="rtl"><section className="admin-access-card" aria-labelledby="admin-access-title"><h1 id="admin-access-title">{adminAccess==='error'?'تعذّر التحقق من صلاحية الإدارة':'هذا الحساب لا يملك صلاحية الإدارة'}</h1><p>الحساب الحالي: <bdi>{user?.email}</bdi></p>{adminAccess==='error'?<p role="alert">لم نتمكن من الحصول على نتيجة من خدمة الصلاحيات. تحقق من الاتصال ثم أعد المحاولة؛ لا يعني هذا أن حسابك غير معتمد.</p>:<p>تسجيل الدخول وحده لا يمنح صلاحية الإدارة. يجب اعتماد هذا البريد في قائمة المشرفين وربطه بحساب الإدارة في قاعدة البيانات. تأكيد البريد وحده لا يكفي.</p>}<div className="admin-access-actions"><button className="primary" onClick={()=>setAdminRetry(value=>value+1)}>إعادة التحقق</button><a className="soft-btn" href="/">العودة إلى المنصة</a><button className="soft-btn" onClick={()=>authClient?.auth.signOut()}>تسجيل الخروج</button></div></section></main>;
  if(adminPath&&user)return <Suspense fallback={loadingView}><AdminDashboard user={user}/></Suspense>;
  return <Workspace key={user?.id??'local'} user={user} admin={adminAccess==='allowed'} onLeave={()=>setDemo(false)}/>;
}

function Workspace({user,admin,onLeave}:{user:User|null;admin:boolean;onLeave:()=>void}){
  const storageKey=user?`rabbani-v1-user-${user.id}`:'rabbani-v1';
  const [state,setState]=useState<State>(()=>load(storageKey));
  const [view,setView]=useState<View>('home');
  const [toast,setToast]=useState('');
  const [cloudReady,setCloudReady]=useState(!user);
  const [cloudWritable,setCloudWritable]=useState(false);
  const [syncStatus,setSyncStatus]=useState<'saved'|'saving'|'offline'>('saved');
  const [retrySync,setRetrySync]=useState(0);
  const pendingKey=`${storageKey}-pending`;
  const saveQueue=useRef<Promise<void>>(Promise.resolve());
  const saveRevision=useRef(0);
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(state))}catch{setToast('تعذر حفظ البيانات على هذا الجهاز. صدّر بياناتك قبل إغلاق الصفحة.')}},[state,storageKey]);
  useEffect(()=>{
    if(!user)return;
    let active=true;
    fetchCloudState(user.id).then(remote=>{if(active){if(remote&&!localStorage.getItem(pendingKey))setState(remote);setCloudWritable(true)}}).catch(()=>{if(active){setCloudWritable(false);setSyncStatus('offline')}}).finally(()=>{if(active)setCloudReady(true)});
    return()=>{active=false};
  },[user,storageKey,pendingKey,retrySync]);
  useEffect(()=>{
    if(!user||!cloudReady)return;
    localStorage.setItem(pendingKey,'1');
    const revision=++saveRevision.current;
    if(!cloudWritable)return;
    const timer=window.setTimeout(()=>{
      setSyncStatus('saving');
      saveQueue.current=saveQueue.current.catch(()=>{}).then(()=>saveCloudState(user.id,state));
      saveQueue.current.then(()=>{if(saveRevision.current===revision){localStorage.removeItem(pendingKey);setSyncStatus('saved')}}).catch(()=>setSyncStatus('offline'));
    },650);
    return()=>window.clearTimeout(timer);
  },[state,user,cloudReady,cloudWritable,pendingKey]);
  useEffect(()=>{
    if(!user||!cloudReady)return;
    let active=true;
    fetchPlatformCurriculum().then(shared=>{if(active&&shared)setState(current=>({...current,curriculum:{...shared,progress:current.curriculum?.progress??{}}}))}).catch(()=>{if(active)setToast('تعذر تحميل المنهج المشترك؛ يعرض التطبيق النسخة المحفوظة مؤقتًا.')});
    return()=>{active=false};
  },[user?.id,cloudReady]);
  const update=(fn:(s:State)=>State)=>setState(fn);
  const navigate=(v:View)=>{setView(v);window.scrollTo({top:0,behavior:'smooth'})};
  const notify=(t:string)=>{setToast(t);setTimeout(()=>setToast(''),2600)};
  if(!cloudReady)return <div className="auth-loading" dir="rtl">جارٍ تحميل بيانات حسابك…</div>;
  return <div className="app"><aside className="sidebar"><button className="brand" onClick={()=>navigate('home')}><span className="brand-mark"><BookOpen size={26}/></span><span><strong>الرَّبَّانِيُّون</strong><small>علمٌ يُثمر إيمانًا، وإيمانٌ يُثمر عملًا</small></span></button><div className="side-label">مسيرتك</div><nav><button className={view==='home'?'active':''} onClick={()=>navigate('home')}><Home size={19}/>الرئيسية</button><button className={['day','week','month','goals'].includes(view)?'active':''} onClick={()=>navigate('day')}><CalendarDays size={19}/>حياتي مع الله</button><button className={view==='learn'?'active':''} onClick={()=>navigate('learn')}><BookOpen size={19}/>السير إلى الله</button><button className={['reflect','wird'].includes(view)?'active':''} onClick={()=>navigate('reflect')}><Heart size={19}/>حاسب نفسك</button></nav><div className="side-bottom"><button onClick={()=>navigate('settings')}><Settings2 size={18}/> الإعدادات</button><button className="session-button" onClick={async()=>{if(user)await authClient?.auth.signOut();else onLeave()}}>{user?'تسجيل الخروج':'العودة إلى صفحة الدخول'}</button><p>﴿وَلَٰكِنْ كُونُوا رَبَّانِيِّينَ﴾<br/><span>آل عمران: 79</span></p></div></aside><main className={view==="learn"?"main main-learning":"main"}><header className="topbar"><div className="crumb"><span>الربانيون</span><ChevronLeft size={15}/><strong>{crumbs[view]}</strong></div><div className="top-actions">{admin&&<a className="admin-entry" href="/admin"><ShieldCheck size={15}/> لوحة الإدارة</a>}<div className="top-date">{user&&(syncStatus==='offline'?<button className="cloud-status offline" onClick={()=>setRetrySync(x=>x+1)}>تعذر الاتصال · إعادة المحاولة</button>:<span className={'cloud-status '+syncStatus}>{syncStatus==='saved'?'محفوظ في السحابة':'جارٍ الحفظ…'}</span>)}{new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}</div></div></header><div className="content">{view!=='home'&&<button className="back" onClick={()=>navigate('home')}><ArrowRight size={16}/>العودة للرئيسية</button>}
    <Suspense fallback={loadingView}>
    {view==='home'&&<HomeView navigate={navigate}/>}
    {view==='day'&&<DayPlanner scheduledTasks={state.tasks.filter(task=>task.period==='weekly'||task.period==='monthly')} onWeek={()=>navigate('week')} onMonth={()=>navigate('month')} records={state.dayRecords} dailyTasks={state.tasks.filter(task=>task.period==='daily')} onRecords={dayRecords=>update(s=>updateDayRecords(s,dayRecords))} plan={state.dayPlan} prayers={state.prayers} onPlan={dayPlan=>update(s=>({...s,dayPlan}))} onPrayer={(name,time)=>update(s=>({...s,prayers:{...s.prayers,[name]:time}}))} onReflect={()=>navigate('reflect')} extraTasks={<details className="panel legacy-tasks"><summary>أنشطة إضافية محفوظة وخطوات أهدافي</summary><p className="muted small">أنشطتك السابقة وخطوات الأهداف المضافة إلى اليوم محفوظة هنا.</p>{view==='day'&&<TasksPanel period="daily" tasks={state.tasks.filter(t=>t.period==='daily')} prayers={state.prayers} onPrayer={(name,time)=>update(s=>({...s,prayers:{...s.prayers,[name]:time}}))} onTasks={tasks=>update(s=>replacePeriodTasks(s,'daily',tasks))}/>}</details>}/>}
    {view==='week'&&<WeeklyPlanner tasks={state.tasks.filter(t=>t.period==='weekly')} onTasks={tasks=>update(s=>replacePeriodTasks(s,'weekly',tasks))}/>}
    {view==='month'&&<MonthlyPlanner tasks={state.tasks.filter(t=>t.period==='monthly')} onTasks={tasks=>update(s=>replacePeriodTasks(s,'monthly',tasks))}/>}
    {view==='goals'&&<StrongGoals goals={state.goals} onGoals={goals=>update(s=>({...s,goals}))}/>}
    {view==='learn'&&<LearningJourney key='reader' value={state.curriculum} onChange={curriculum=>update(s=>({...s,curriculum}))}/>}
    {view==='reflect'&&<ReflectionView reflections={state.reflections} onAdd={text=>{update(s=>({...s,reflections:[newReflection(text),...s.reflections]}));notify('حُفظت المراجعة')}} onDelete={id=>update(s=>({...s,reflections:s.reflections.filter(x=>x.id!==id)}))} navigate={navigate}/>}
    {view==='wird'&&<WirdsView wirds={state.wirds} onWirds={wirds=>update(s=>({...s,wirds}))} notify={notify} navigate={navigate}/>}
    {view==='settings'&&<SettingsView state={state} onReplace={setState} notify={notify}/>}
    </Suspense>
  </div><footer>الربانيون · نسخة أولية للتجربة والتطوير <span>لا تتضمن محتوى شرعيًا معتمدًا بعد</span></footer></main>{toast&&<div className="toast"><Check size={16}/>{toast}</div>}<nav className="mobile-nav"><button className={view==='home'?'active':''} onClick={()=>navigate('home')}><Home size={21}/>الرئيسية</button><button className={['day','week','month','goals'].includes(view)?'active':''} onClick={()=>navigate('day')}><CalendarDays size={21}/>حياتي</button><button className={view==='learn'?'active':''} onClick={()=>navigate('learn')}><Compass size={21}/>السير</button><button className={['reflect','wird'].includes(view)?'active':''} onClick={()=>navigate('reflect')}><Heart size={21}/>المحاسبة</button></nav></div>;
}


