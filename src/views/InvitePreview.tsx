import {useEffect,useState} from 'react';
import {authClient} from '../auth';
import '../circles.css';

type Preview={status:'valid';group:{name:string;kind:string;goal:string;starts_on:string|null;ends_on:string|null;member_limit:number;member_count:number}}|{status:'invalid'};

export default function InvitePreview({code,user}:{code:string;user:{id:string}|null}){
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState('');
  const [requestStatus,setRequestStatus]=useState('');
  const [requestSent,setRequestSent]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    if(!authClient){setError('خدمة الحلقات غير مفعّلة.');return}
    authClient.rpc('resolve_group_invite',{p_code:code}).then(({data,error:requestError})=>{
      if(!active)return;
      if(requestError)setError('تعذّر التحقق من الدعوة؛ حاول لاحقًا.');
      else setPreview(data as Preview);
    });
    return()=>{active=false};
  },[code]);
  const requestJoin=async()=>{
    if(!authClient||!user||busy)return;
    setBusy(true);setRequestStatus('');
    const {error:requestError}=await authClient.rpc('request_group_join',{p_code:code});
    setRequestStatus(requestError?requestError.message:'أُرسل طلب الانضمام. تنتظر موافقة مسؤول الحلقة، ولم تصبح عضوًا بعد.');
    if(!requestError)setRequestSent(true);
    setBusy(false);
  };
  return <main className="circle-preview" dir="rtl"><section className="panel">
    <span className="eyebrow">التواصي</span>
    <h1>دعوة إلى حلقة خاصة</h1>
    {error?<p role="alert">{error}</p>:!preview?<p role="status">جارٍ التحقق من الرابط…</p>:preview.status==='invalid'?<p role="alert">الرابط غير صالح أو انتهت صلاحيته.</p>:<>
      <h2>{preview.group.name}</h2>
      {preview.group.goal&&<p>{preview.group.goal}</p>}
      <p>الأعضاء: {preview.group.member_count} من {preview.group.member_limit}</p>
      <p className="muted">فتح الرابط لا يمنح العضوية. يراجع مؤسس الحلقة طلبك ويقبل أو يرفض.</p>
      {user?<button className="primary" type="button" disabled={busy||requestSent} onClick={()=>void requestJoin()}>{busy?'جارٍ الإرسال…':requestSent?'أُرسل الطلب':'طلب الانضمام'}</button>:<button className="primary" type="button" onClick={()=>{sessionStorage.setItem('rabbani-pending-invite',window.location.pathname);window.location.assign('/')}}>تسجيل الدخول لطلب الانضمام</button>}
      {requestStatus&&<p role="status">{requestStatus}</p>}
    </>}
    <a className="soft-btn" href="/">العودة إلى الربانيون</a>
  </section></main>;
}
