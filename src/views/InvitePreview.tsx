import {useEffect,useState} from 'react';
import {authClient} from '../auth';
import '../circles.css';

type CircleInfo={id:string;title:string;kind:string;category:string;mode:string;starts_on:string|null;ends_on:string|null;pace_target:number|null;pace_unit:string;pace_period:string;member_count:number};
type Preview={status:'valid';circle:CircleInfo}|{status:'invalid'};

export default function InvitePreview({code,user}:{code:string;user:{id:string}|null}){
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState('');
  const [requestStatus,setRequestStatus]=useState('');
  const [requestSent,setRequestSent]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    if(!authClient){setError('خدمة المدارسة غير مفعّلة.');return}
    authClient.rpc('resolve_study_invite',{p_code:code}).then(({data,error:requestError})=>{
      if(!active)return;
      if(requestError)setError('تعذّر التحقق من الدعوة؛ حاول لاحقًا.');
      else setPreview(data as Preview);
    });
    return()=>{active=false};
  },[code]);
  const requestJoin=async()=>{
    if(!authClient||!user||busy)return;
    setBusy(true);setRequestStatus('');
    const {error:requestError}=await authClient.rpc('request_study_join',{p_code:code,p_note:''});
    setRequestStatus(requestError?requestError.message:'أُرسل طلب الانضمام إلى المدارسة. تنتظر موافقة منشئها أو المشرف.');
    if(!requestError){setRequestSent(true);try{sessionStorage.removeItem('rabbani-pending-invite')}catch{}}
    setBusy(false);
  };
  return <main className="circle-preview" dir="rtl"><section className="panel">
    <span className="eyebrow">المدارسة</span>
    <h1>دعوة إلى مدارسة علمية</h1>
    {error?<p role="alert">{error}</p>:!preview?<p role="status">جارٍ التحقق من الرابط…</p>:preview.status==='invalid'?<p role="alert">الرابط غير صالح أو انتهت صلاحيته.</p>:<>
      <h2>{preview.circle.title}</h2>
      {preview.circle.kind&&<p className="muted">النوع: {preview.circle.kind === 'book' ? 'كتاب' : preview.circle.kind === 'series' ? 'سلسلة دروس' : preview.circle.kind === 'lectures' ? 'محاضرات' : 'موضوع علمي'}</p>}
      {preview.circle.member_count>0&&<p>الأعضاء: {preview.circle.member_count}</p>}
      <p className="muted">فتح الرابط لا يمنح العضوية. يُرسل طلبك إلى منشئ المدارسة أو المشرف لاتخاذ القرار.</p>
      {user?<button className="primary" type="button" disabled={busy||requestSent} onClick={()=>void requestJoin()}>{busy?'جارٍ الإرسال…':requestSent?'أُرسل طلبك — انتظر الموافقة':'طلب الانضمام'}</button>:<button className="primary" type="button" onClick={()=>{try{sessionStorage.setItem('rabbani-pending-invite',window.location.pathname)}catch{}window.location.assign('/')}}>تسجيل الدخول لطلب الانضمام</button>}
      {requestStatus&&<p role="status">{requestStatus}</p>}
    </>}
    <a className="soft-btn" href="/">العودة إلى المنصة</a>
  </section></main>;
}
