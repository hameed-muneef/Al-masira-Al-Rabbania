import {useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,LogOut,ShieldCheck} from 'lucide-react';
import type {User} from '@supabase/supabase-js';
import LearningJourney from './LearningJourney';
import {initialCurriculum,type Curriculum} from './curriculum';
import {authClient} from './auth';
import {fetchPlatformCurriculum,savePlatformCurriculum} from './platform-curriculum';
import './admin.css';
import {cleanupRemovedBooks} from './resource-cleanup';

export default function AdminDashboard({user}:{user:User}){
  const [curriculum,setCurriculum]=useState<Curriculum>(initialCurriculum);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState(false);
  const [status,setStatus]=useState<'saved'|'saving'|'error'>('saved');
  const saveQueue=useRef<Promise<void>>(Promise.resolve());
  const saveRevision=useRef(0);
  const [retryLoad,setRetryLoad]=useState(0);
  const [cleanupMessage,setCleanupMessage]=useState('');
  const [cleaning,setCleaning]=useState(false);
  const cleanup=async()=>{setCleaning(true);try{const remaining=await cleanupRemovedBooks();setCleanupMessage(remaining?'توجد ملفات أخرى بانتظار التنظيف. اضغط لإكمال التنظيف.':'')}catch(error){setCleanupMessage(error instanceof Error?error.message:'تعذر تنظيف الملفات.')}finally{setCleaning(false)}};
  useEffect(()=>{if(!loading&&!loadError)void cleanup()},[loading,loadError]);
  useEffect(()=>{let active=true;setLoading(true);setLoadError(false);fetchPlatformCurriculum().then(value=>{if(active&&value)setCurriculum(value)}).catch(()=>{if(active)setLoadError(true)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[retryLoad]);
  const update=(next:Curriculum)=>{
    setCurriculum(next);setStatus('saving');
    const revision=++saveRevision.current;
    saveQueue.current=saveQueue.current.catch(()=>{}).then(()=>savePlatformCurriculum(next,user.id));
    saveQueue.current.then(()=>{if(saveRevision.current===revision){setStatus('saved');void cleanup()}}).catch(()=>{if(saveRevision.current===revision)setStatus('error')});
  };
  return <div className="admin-page" dir="rtl"><header className="admin-header"><div className="admin-identity"><span className="admin-mark"><ShieldCheck size={22}/></span><span><strong>لوحة إدارة الربانيون</strong><small>{user.email}</small></span></div><div className="admin-header-actions"><a href="/"><ArrowRight size={17}/> واجهة المستخدم</a><button onClick={()=>authClient?.auth.signOut()}><LogOut size={17}/> خروج</button></div></header><main className="admin-content"><div className="admin-intro"><div><span className="admin-eyebrow"><BookOpen size={15}/> إدارة المحتوى</span><h1>المنهج والموارد</h1><p>حرّر المحطات ومصادرها هنا. تُحفظ التعديلات في قاعدة البيانات ويظهر المنهج المحدث للمستخدمين بعد إعادة تحميل الصفحة.</p></div><div className="admin-save-controls"><span className={'admin-save '+status} role="status">{status==='saved'?'محفوظ في السحابة':status==='saving'?'جارٍ الحفظ…':'تعذر الحفظ'}</span>{status==='error'&&!loadError&&<button onClick={()=>update(curriculum)}>إعادة الحفظ</button>}</div></div>{loading?<p className="admin-loading">جارٍ تحميل المنهج…</p>:loadError?<div className="admin-loading"><p>تعذر تحميل المنهج المشترك. لم يُفتح المحرر حتى لا تستبدل محتوى محفوظًا.</p><button className="primary" onClick={()=>setRetryLoad(x=>x+1)}>إعادة المحاولة</button></div>:<><div className="admin-cleanup-controls">{cleanupMessage&&<div className="admin-cleanup-warning" role="status"><p>{cleanupMessage}</p><button className="soft-btn" disabled={cleaning||status!=='saved'} onClick={()=>void cleanup()}>إعادة محاولة تنظيف الملفات</button></div>}{cleaning&&<p role="status">جارٍ التحقق من الملفات غير المستخدمة وتنظيفها…</p>}</div><fieldset className="admin-editor-fieldset" disabled={status==='saving'||cleaning}><LearningJourney admin value={curriculum} onChange={update}/></fieldset></>}</main></div>;
}
