import {FormEvent,useCallback,useEffect,useState} from 'react';
import {authClient} from '../auth';
import '../shares.css';

type Settings={max_per_day:number;max_per_recipient:number;recipient_window_hours:number;max_description_length:number;search_per_hour:number;invitation_ttl_days:number;retention_days:number;allowed_types:string[]};
type Stats={total:number;last_24h:number;by_type:Record<string,number>;blocks:number;open_reports:number;restricted:number};
type EventRow={event:string;created_at:string;details:Record<string,unknown>};
const types:[string,string][]=[['resource','مصدر'],['activity_invitation','دعوة إلى نشاط'],['notification','تنبيه مهم'],['recommendation','توصية تعليمية']];
const fields:[keyof Omit<Settings,'allowed_types'>,string][]=[['max_per_day','الحد اليومي للمشاركات لكل عضو'],['max_per_recipient','الحد لنفس المستلم'],['recipient_window_hours','مدة حساب حد المستلم (ساعات)'],['max_description_length','أقصى طول للوصف'],['search_per_hour','عمليات البحث في الساعة'],['invitation_ttl_days','صلاحية الدعوة (أيام)'],['retention_days','مدة الاحتفاظ (أيام)']];
const messageOf=(value:unknown)=>(value as {message?:string})?.message||'تعذّر تنفيذ العملية.';

export default function ShareAdminPanel(){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [stats,setStats]=useState<Stats|null>(null);
  const [events,setEvents]=useState<EventRow[]>([]);
  const [username,setUsername]=useState('');
  const [hours,setHours]=useState('');
  const [reason,setReason]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    if(!authClient)return;
    const [s,t,e]=await Promise.all([authClient.rpc('admin_get_share_settings'),authClient.rpc('admin_share_stats'),authClient.rpc('admin_list_share_events',{p_limit:20})]);
    if(s.error){setMessage(messageOf(s.error));return}
    setSettings((s.data as Settings[])?.[0]??null);
    setStats((t.data as Stats[])?.[0]??null);
    setEvents((e.data??[]) as EventRow[]);
  },[]);
  useEffect(()=>{void load()},[load]);
  const run=async(action:()=>PromiseLike<{error:unknown}>,ok:string)=>{
    if(busy)return;setBusy(true);
    try{const {error}=await action();if(error)throw error;setMessage(ok);await load()}
    catch(error){setMessage(messageOf(error))}finally{setBusy(false)}
  };
  const save=(event:FormEvent)=>{
    event.preventDefault();if(!settings||!authClient)return;
    void run(()=>authClient!.rpc('admin_save_share_settings',{p_max_per_day:settings.max_per_day,p_max_per_recipient:settings.max_per_recipient,p_recipient_window_hours:settings.recipient_window_hours,p_max_description_length:settings.max_description_length,p_search_per_hour:settings.search_per_hour,p_invitation_ttl_days:settings.invitation_ttl_days,p_retention_days:settings.retention_days,p_allowed_types:settings.allowed_types}),'حُفظت إعدادات المشاركات.');
  };
  const restrict=(restricted:boolean)=>{
    if(!authClient||!username.trim())return;
    void run(()=>authClient!.rpc('admin_set_share_restriction',{p_username:username.trim().toLowerCase(),p_restricted:restricted,p_hours:hours?Number(hours):null,p_reason:reason}),restricted?'قُيّد الحساب.':'رُفع التقييد.');
  };
  return <section className="panel teacher-review-panel" aria-labelledby="shares-admin-title">
    <div className="panel-head"><h2 id="shares-admin-title">المشاركات بين الأعضاء</h2></div>
    {message&&<p className="teacher-notice" role="status">{message}</p>}
    {stats&&<p className="muted">الإجمالي: {stats.total} · آخر 24 ساعة: {stats.last_24h} · حالات الحظر: {stats.blocks} · بلاغات مفتوحة: {stats.open_reports} · حسابات مقيدة: {stats.restricted}{Object.keys(stats.by_type).length>0&&' · '+Object.entries(stats.by_type).map(([key,count])=>`${types.find(([id])=>id===key)?.[1]??key}: ${count}`).join('، ')}</p>}
    {settings&&<form className="shares-form" onSubmit={save}>
      {fields.map(([key,label])=><label key={key}>{label}<input type="number" min={1} value={settings[key]} onChange={event=>setSettings({...settings,[key]:Number(event.target.value)})}/></label>)}
      <fieldset><legend>الأنواع المتاحة</legend>{types.map(([key,label])=><label key={key} className="shares-check"><input type="checkbox" checked={settings.allowed_types.includes(key)} onChange={event=>setSettings({...settings,allowed_types:event.target.checked?[...settings.allowed_types,key]:settings.allowed_types.filter(item=>item!==key)})}/>{label}</label>)}</fieldset>
      <button className="primary-btn" disabled={busy}>حفظ الإعدادات</button>
    </form>}
    <div className="shares-form">
      <h3>تقييد الإرسال لحساب</h3>
      <label>اسم المستخدم<input dir="ltr" value={username} onChange={event=>setUsername(event.target.value)}/></label>
      <label>المدة بالساعات (اتركها فارغة لتقييد مفتوح)<input type="number" min={1} value={hours} onChange={event=>setHours(event.target.value)}/></label>
      <label>السبب<input value={reason} maxLength={500} onChange={event=>setReason(event.target.value)}/></label>
      <div className="shares-actions"><button className="soft-btn" disabled={busy} onClick={()=>restrict(true)}>تقييد</button><button className="soft-btn" disabled={busy} onClick={()=>restrict(false)}>رفع التقييد</button><button className="soft-btn" disabled={busy} onClick={()=>{if(authClient&&window.confirm('سيُحذف كل ما تجاوز مدة الاحتفاظ. متابعة؟'))void run(()=>authClient!.rpc('admin_purge_old_shares'),'نُفّذ تنظيف المشاركات القديمة.')}}>تنظيف المشاركات القديمة</button></div>
    </div>
    {events.length>0&&<details><summary>آخر أحداث التدقيق</summary><ul>{events.map((item,index)=><li key={index}><small>{new Date(item.created_at).toLocaleString('ar-EG')} · {item.event}</small></li>)}</ul></details>}
  </section>;
}
