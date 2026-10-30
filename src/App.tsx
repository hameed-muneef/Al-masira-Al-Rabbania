import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import HomeView from './views/HomeView';
import {replacePeriodTasks,updateDayRecords} from './weekly-planning';
import {load,today,type State,type View} from './app-state';
import {displayName,fetchProfile,saveProfile,type Profile} from './user-profile';
import {uid} from './id';
import {hijriDate} from './hijri';
import {BookOpen,CalendarDays,Heart,Settings2,Home,Compass,ChevronLeft,ArrowRight,Check,ShieldCheck,Users,GraduationCap,Bell,Library,UserRound} from 'lucide-react';
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
const CirclesView=lazy(()=>import('./views/CirclesView'));
const TodayTasksView=lazy(()=>import('./views/TodayTasksView'));
const TeacherView=lazy(()=>import('./views/TeacherView'));
const CoursesView=lazy(()=>import('./views/CoursesView'));
const StudyTracksView=lazy(()=>import('./views/StudyTracksView'));
const ProfileView=lazy(()=>import('./views/ProfileView'));
const InvitePreview=lazy(()=>import('./views/InvitePreview'));
const loadingView=<div className="auth-loading" dir="rtl" role="status">جارٍ تحميل الصفحة…</div>;
const newReflection=(text:string)=>({id:uid(),date:today(),text});

const crumbs:Record<View,string>={home:'الرئيسية',day:'يومي مع الله',tasks:'مركز المهام',week:'أسبوعي مع الله',month:'شهري مع الله',goals:'المؤمن القوي',learn:'السير إلى الله',reflect:'محاسبة النفس',wird:'زكِّ نفسك',circles:'التواصي',teacher:'بوابة الشيخ والمعلم',courses:'مجالس العلم',study:'المدارسة',profile:'حسابي',settings:'الإعدادات'};

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
  const inviteMatch=window.location.pathname.match(/^\/invite\/([A-Za-z2-9]{20})$/);
  if(inviteMatch)return <Suspense fallback={loadingView}><InvitePreview code={inviteMatch[1]} user={user}/></Suspense>;
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
  const [notifications,setNotifications]=useState<{id:string;kind:string;title:string;body:string;link:string;read_at:string|null;created_at:string}[]>([]);
  const [unreadCount,setUnreadCount]=useState(0);
  const [showNotifications,setShowNotifications]=useState(false);
  const [profile,setProfile]=useState<Profile|null>(null);
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
  const loadNotifications=async()=>{
    if(!user||!authClient)return;
    if(profile?.notification_preferences?.enabled===false){setNotifications([]);setUnreadCount(0);return}
    try{
      const {data}=await authClient.rpc('list_notifications',{p_limit:30});
      setNotifications((data??[]) as any);
      const {data:count}=await authClient.rpc('unread_notification_count');
      setUnreadCount(Number(count??0));
    }catch{/* جرس الإشعارات لا يوقف الاستخدام */}
  };
  useEffect(()=>{void loadNotifications()},[user?.id,profile?.notification_preferences?.enabled]);
  useEffect(()=>{
    if(!user){setProfile(null);return}
    let active=true;
    fetchProfile(user.id).then(loaded=>{
      if(!active)return;
      setProfile(loaded);
      let draft='';
      try{draft=sessionStorage.getItem('rabbani-profile-draft')??''}catch{}
      if(!draft)return;
      try{
        const parsed=JSON.parse(draft) as {firstName:string;lastName:string;country:string;age:number};
        if(!parsed.firstName||!parsed.lastName||!parsed.country)return;
        sessionStorage.removeItem('rabbani-profile-draft');
        saveProfile({firstName:parsed.firstName,lastName:parsed.lastName,country:parsed.country,age:parsed.age??null,gender:''})
          .then(()=>fetchProfile(user.id)).then(fresh=>{if(active)setProfile(fresh)})
          .catch(()=>{});
      }catch{}
    }).catch(()=>{});
    return()=>{active=false};
  },[user?.id]);
  useEffect(()=>{
    const topDate=document.querySelector<HTMLElement>('.top-date');
    if(!topDate||topDate.querySelector('.hijri-inline'))return;
    const label=document.createElement('span');
    label.className='hijri-inline';
    label.textContent=hijriDate(new Date())??'';
    topDate.prepend(label);
  });
  if(!cloudReady)return <div className="auth-loading" dir="rtl">جارٍ تحميل بيانات حسابك…</div>;
  return <div className="app"><aside className="sidebar"><button className="brand" onClick={()=>navigate('home')}><span className="brand-mark"><BookOpen size={26}/></span><span><strong>الرَّبَّانِيُّون</strong><small>علمٌ يُثمر إيمانًا، وإيمانٌ يُثمر عملًا</small></span></button><div className="side-label">مسيرتك</div><nav><button className={view==='home'?'active':''} onClick={()=>navigate('home')}><Home size={19}/>الرئيسية</button><button className={['day','week','month','goals'].includes(view)?'active':''} onClick={()=>navigate('day')}><CalendarDays size={19}/>حياتي مع الله</button><button className={view==='learn'?'active':''} onClick={()=>navigate('learn')}><BookOpen size={19}/>السير إلى الله</button><button className={['reflect','wird'].includes(view)?'active':''} onClick={()=>navigate('reflect')}><Heart size={19}/>حاسب نفسك</button><button className={view==='circles'?'active':''} onClick={()=>navigate('circles')}><Users size={19}/>التواصي الخاص</button><button className={view==='courses'?'active':''} onClick={()=>navigate('courses')}><GraduationCap size={19}/>مجالس العلم</button><button className={view==='study'?'active':''} onClick={()=>navigate('study')}><Library size={19}/>المدارسة</button></nav><div className="side-bottom"><button onClick={()=>navigate('profile')}><UserRound size={18}/> {user?'حسابي':'الملف الشخصي'}</button><button onClick={()=>navigate('settings')}><Settings2 size={18}/> الإعدادات</button><button className="session-button" onClick={async()=>{if(user)await authClient?.auth.signOut();else onLeave()}}>{user?'تسجيل الخروج':'العودة إلى صفحة الدخول'}</button><p>﴿وَلَٰكِنْ كُونُوا رَبَّانِيِّينَ﴾<br/><span>آل عمران: 79</span></p></div></aside><main className={view==="learn"?"main main-learning":"main"}><header className="topbar"><div className="crumb"><span>الربانيون</span><ChevronLeft size={15}/><strong>{crumbs[view]}</strong></div><div className="top-actions">{admin&&<a className="admin-entry" href="/admin"><ShieldCheck size={15}/> لوحة الإدارة</a>}{user&&<button className="user-chip" onClick={()=>navigate('profile')} aria-label={`حسابي: ${displayName(profile,user.email)}`}><span className="user-chip-avatar" aria-hidden="true">{displayName(profile,user.email).trim().charAt(0)}</span><span className="user-chip-name">{displayName(profile,user.email)}</span></button>}<button className="soft-btn" style={{position:'relative'}} onClick={()=>setShowNotifications(v=>!v)} aria-label="الإشعارات" aria-expanded={showNotifications}>{unreadCount>0&&<span style={{position:'absolute',top:-4,insetInlineEnd:-4,background:'#a64137',color:'#fff',borderRadius:999,padding:'0 6px',fontSize:11,fontWeight:700}}>{unreadCount}</span>}<Bell size={18}/></button>{showNotifications&&<div className="panel" style={{position:'absolute',insetInlineEnd:24,top:90,zIndex:20,maxWidth:360,width:'90vw',maxHeight:400,overflow:'auto'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3 style={{margin:0}}>الإشعارات</h3><button className="soft-btn" onClick={async()=>{if(authClient){await authClient.rpc('mark_all_notifications_read');await loadNotifications()}}}>تحديد الكل كمقروء</button></div>{notifications.length===0?<p className="muted">لا إشعارات.</p>:<ul style={{listStyle:'none',padding:0,margin:0}}>{notifications.map(n=><li key={n.id} style={{padding:'8px 0',borderBottom:'1px solid var(--color-border)',opacity:n.read_at?0.6:1}}><strong>{n.title}</strong><p className="muted small" style={{margin:0}}>{n.body}</p><small className="muted">{new Date(n.created_at).toLocaleString('ar-EG')}</small>{!n.read_at&&<button className="soft-btn" onClick={async()=>{if(authClient){await authClient.rpc('mark_notification_read',{p_notification_id:n.id});await loadNotifications()}}}>تحديد كمقروء</button>}</li>)}</ul>}</div>}<div className="top-date">{user&&(syncStatus==='offline'?<button className="cloud-status offline" onClick={()=>setRetrySync(x=>x+1)}>تعذر الاتصال · إعادة المحاولة</button>:<span className={'cloud-status '+syncStatus}>{syncStatus==='saved'?'محفوظ في السحابة':'جارٍ الحفظ…'}</span>)}{new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}</div></div></header><div className="content">{view!=='home'&&<button className="back" onClick={()=>navigate('home')}><ArrowRight size={16}/>العودة للرئيسية</button>}
    <Suspense fallback={loadingView}>
    {view==='home'&&<HomeView navigate={navigate} admin={admin}/>}
    {view==='tasks'&&<TodayTasksView userId={user?.id} tasks={state.tasks} goals={state.goals} taskSchedules={state.taskSchedules??{}} onTaskSchedules={taskSchedules=>update(s=>({...s,taskSchedules}))} onTasks={tasks=>update(s=>({...s,tasks}))} onGoals={goals=>update(s=>({...s,goals}))} onBack={()=>navigate('day')}/>}
    {view==='day'&&<DayPlanner scheduledTasks={state.tasks.filter(task=>task.period==='weekly'||task.period==='monthly')} confirmedTasks={Object.entries(state.taskSchedules??{}).flatMap(([id,schedule])=>schedule.confirmedDate&&schedule.confirmedSlot?[{id,title:schedule.title,date:schedule.confirmedDate,slot:schedule.confirmedSlot}]:[])} onWeek={()=>navigate('week')} onMonth={()=>navigate('month')} records={state.dayRecords} dailyTasks={state.tasks.filter(task=>task.period==='daily')} onRecords={dayRecords=>update(s=>updateDayRecords(s,dayRecords))} plan={state.dayPlan} prayers={state.prayers} onPlan={dayPlan=>update(s=>({...s,dayPlan}))} onPrayer={(name,time)=>update(s=>({...s,prayers:{...s.prayers,[name]:time}}))} onReflect={()=>navigate('reflect')} extraTasks={<details className="panel legacy-tasks"><summary>أنشطة إضافية محفوظة وخطوات أهدافي</summary><p className="muted small">أنشطتك السابقة وخطوات الأهداف المضافة إلى اليوم محفوظة هنا.</p>{view==='day'&&<TasksPanel period="daily" tasks={state.tasks.filter(t=>t.period==='daily')} prayers={state.prayers} onPrayer={(name,time)=>update(s=>({...s,prayers:{...s.prayers,[name]:time}}))} onTasks={tasks=>update(s=>replacePeriodTasks(s,'daily',tasks))}/>}</details>}/>}
    {view==='week'&&<WeeklyPlanner tasks={state.tasks.filter(t=>t.period==='weekly')} onTasks={tasks=>update(s=>replacePeriodTasks(s,'weekly',tasks))}/>}
    {view==='month'&&<MonthlyPlanner tasks={state.tasks.filter(t=>t.period==='monthly')} onTasks={tasks=>update(s=>replacePeriodTasks(s,'monthly',tasks))}/>}
    {view==='goals'&&<StrongGoals goals={state.goals} onGoals={goals=>update(s=>({...s,goals}))}/>}
    {view==='learn'&&<LearningJourney key='reader' value={state.curriculum} onChange={curriculum=>update(s=>({...s,curriculum}))}/>}
    {view==='reflect'&&<ReflectionView reflections={state.reflections} onAdd={text=>{update(s=>({...s,reflections:[newReflection(text),...s.reflections]}));notify('حُفظت المراجعة')}} onDelete={id=>update(s=>({...s,reflections:s.reflections.filter(x=>x.id!==id)}))} navigate={navigate}/>}
    {view==='wird'&&<WirdsView wirds={state.wirds} onWirds={wirds=>update(s=>({...s,wirds}))} notify={notify} navigate={navigate}/>}
    {view==='circles'&&<CirclesView user={user}/>}
    {view==='teacher'&&<TeacherView user={user} navigate={navigate}/>}
    {view==='courses'&&<CoursesView user={user} navigate={navigate}/>}
    {view==='study'&&<StudyTracksView user={user}/>}
    {view==='profile'&&<ProfileView user={user} notify={notify} onProfileSaved={()=>{}}/>}
    {view==='settings'&&<SettingsView state={state} onReplace={setState} notify={notify} onOpenProfile={()=>navigate('profile')}/>}
    </Suspense>
  </div><footer>الربانيون · نسخة أولية للتجربة والتطوير <span>لا تتضمن محتوى شرعيًا معتمدًا بعد</span></footer></main>{toast&&<div className="toast"><Check size={16}/>{toast}</div>}<nav className="mobile-nav"><button className={view==='home'?'active':''} onClick={()=>navigate('home')}><Home size={21}/>الرئيسية</button><button className={['day','week','month','goals'].includes(view)?'active':''} onClick={()=>navigate('day')}><CalendarDays size={21}/>حياتي</button><button className={view==='learn'?'active':''} onClick={()=>navigate('learn')}><Compass size={21}/>السير</button><button className={['reflect','wird'].includes(view)?'active':''} onClick={()=>navigate('reflect')}><Heart size={21}/>المحاسبة</button><button className={view==='circles'?'active':''} onClick={()=>navigate('circles')}><Users size={21}/>التواصي</button><button className={view==='courses'?'active':''} onClick={()=>navigate('courses')}><GraduationCap size={21}/>مجالس</button><button className={view==='settings'?'active':''} onClick={()=>navigate('settings')}><Settings2 size={21}/>الإعدادات</button></nav></div>;
}


