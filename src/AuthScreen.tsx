import {useState,type FormEvent} from 'react';
import {ArrowLeft,BookOpen,Eye,EyeOff,LockKeyhole,Mail,ShieldCheck} from 'lucide-react';
import {authClient} from './auth';
import './auth.css';

export default function AuthScreen({onDemo,allowDemo=true,admin=false}:{onDemo:()=>void;allowDemo?:boolean;admin?:boolean}){
  const [mode,setMode]=useState<'login'|'register'>(admin?'login':'register');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [visible,setVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const switchMode=(next:'login'|'register')=>{setMode(next);setError('');setMessage('');setPassword('');setConfirm('')};
  async function submit(event:FormEvent){
    event.preventDefault();setError('');setMessage('');
    if(!authClient){setError('إنشاء الحسابات غير مفعّل بعد. يمكنك استكشاف النسخة المحلية أدناه.');return}
    if(mode==='register'&&password!==confirm){setError('كلمتا المرور غير متطابقتين.');return}
    setBusy(true);
    try{
      if(mode==='register'){
        const {data,error}=await authClient.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:window.location.origin+(admin?'/admin':'/')}});
        if(error)throw error;
        if(!data.session)setMessage(admin?'افتح رسالة التأكيد في بريدك، ثم عُد إلى صفحة /admin لتسجيل الدخول بصلاحية المشرف.':'تم إرسال رسالة تأكيد إلى بريدك الإلكتروني. افتحها لتفعيل حسابك ثم سجّل الدخول.');
      }else{
        const {error}=await authClient.auth.signInWithPassword({email:email.trim(),password});
        if(error)throw error;
      }
    }catch(err){setError(err instanceof Error?err.message:'تعذّر إكمال العملية. حاول مرة أخرى.')}finally{setBusy(false)}
  }
  return <main className="auth-page" dir="rtl">
    <div className="auth-shell">
      <section className="auth-form-side" aria-labelledby="auth-title">
        <div className="auth-logo"><span><BookOpen size={25}/></span><div><strong>الرَّبَّانِيُّون</strong><small>{admin?'بوابة إدارة المنصة':'علمٌ يُثمر إيمانًا، وإيمانٌ يُثمر عملًا'}</small></div></div>
        <div className="auth-form-wrap">
          <nav className="auth-role-switch" aria-label="اختيار الواجهة"><a href="/" aria-current={!admin?'page':undefined}>واجهة المستخدم</a><a href="/admin" aria-current={admin?'page':undefined}>دخول المشرف</a></nav>
          <span className="auth-eyebrow">{admin?'مدخل المشرفين':'مسيرتك تبدأ هنا'}</span>
          <h1 id="auth-title">{admin?(mode==='register'?'إنشاء حساب المشرف':'دخول المشرف'):mode==='register'?'أنشئ حسابك':'مرحبًا بعودتك'}</h1>
          <p className="auth-lead">{admin?'سجّل بالبريد المخصص للإدارة. تُفعّل الصلاحية بعد تأكيد البريد والتحقق من اعتماده.':mode==='register'?'خطوة صغيرة اليوم، وأثر يبقى معك كل يوم.':'أكمل ما بدأت، وتابع خطواتك في العلم والعمل.'}</p>
          <div className="auth-tabs" role="group" aria-label="طريقة الدخول"><button type="button" className={mode==='register'?'selected':''} onClick={()=>switchMode('register')}>إنشاء حساب</button><button type="button" className={mode==='login'?'selected':''} onClick={()=>switchMode('login')}>تسجيل الدخول</button></div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="auth-email">البريد الإلكتروني</label><div className="auth-input"><Mail size={18}/><input id="auth-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" required dir="ltr"/></div>
            <label htmlFor="auth-password">كلمة المرور</label><div className="auth-input"><LockKeyhole size={18}/><input id="auth-password" type={visible?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='register'?'new-password':'current-password'} minLength={6} placeholder="ستة أحرف على الأقل" required/><button type="button" aria-label={visible?'إخفاء كلمة المرور':'إظهار كلمة المرور'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
            {mode==='register'&&<><label htmlFor="auth-confirm">تأكيد كلمة المرور</label><div className="auth-input"><LockKeyhole size={18}/><input id="auth-confirm" type={visible?'text':'password'} value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" placeholder="أعد كتابة كلمة المرور" required/></div></>}
            {error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="auth-success" role="status">{message}</p>}
            <button className="auth-submit" type="submit" disabled={busy||!authClient}>{busy?'جارٍ المتابعة...':mode==='register'?'إنشاء الحساب':'الدخول إلى حسابي'}<ArrowLeft size={18}/></button>
          </form>
          {!authClient&&<div className="auth-setup"><ShieldCheck size={19}/><p>الحسابات الحقيقية بانتظار ربط خدمة المصادقة. يمكنك الآن استخدام النسخة التجريبية على هذا الجهاز.</p></div>}
          {allowDemo&&<button className="auth-demo" onClick={onDemo}>استكشاف المنصة دون حساب <ArrowLeft size={17}/></button>}
        </div>
        <p className="auth-foot">الربانيون · مساحة تعينك على تنظيم يومك ومسيرتك</p>
      </section>
      <aside className="auth-story"><div className="auth-story-top"><span className="auth-star">✦</span><span>مساحة للعلم والعمل</span></div><div className="auth-story-center"><div className="auth-arch"><BookOpen size={60} strokeWidth={1.25}/></div><span className="auth-story-kicker">رحلة تتجدد كل يوم</span><h2>اعلم، واعمل،<br/>واثبت على الطريق.</h2><p>خطّط ليومك، تابع أهدافك، واقرأ ما ينفعك في مكان واحد يرافقك في مسيرتك إلى الله.</p></div><div className="auth-story-bottom"><span>يومي مع الله</span><span>السير إلى الله</span><span>المؤمن القوي</span></div></aside>
    </div>
  </main>
}
