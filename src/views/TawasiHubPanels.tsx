import {FormEvent,useCallback,useEffect,useState} from 'react';
import {authClient} from '../auth';

type CircleRef={id:string;name:string};
type RequestRow={id:string;group_id:string;user_id:string;requested_at:string;status:'pending'|'accepted'|'rejected'};
const messageOf=(value:unknown)=>value instanceof Error&&value.message?value.message:(value as {message?:string})?.message||'تعذّر تنفيذ العملية، حاول مرة أخرى.';
const day=(value:string)=>new Date(value).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'});
const statusText={pending:'بانتظار الموافقة',accepted:'مقبول',rejected:'مرفوض'};

export function TawasiInvitesPanel({userId,circles,onChanged}:{userId:string;circles:CircleRef[];onChanged:()=>void}){
  const [rows,setRows]=useState<RequestRow[]>([]);
  const [link,setLink]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const say=(text:string,error=false)=>{setMessage(text);setFailed(error)};
  const load=useCallback(async()=>{
    if(!authClient)return;
    const {data,error}=await authClient.from('group_join_requests').select('id,group_id,user_id,requested_at,status').order('requested_at',{ascending:false}).limit(100);
    if(error){say(messageOf(error),true);return}
    setRows((data??[]) as RequestRow[]);
  },[]);
  useEffect(()=>{void load()},[load]);
  const nameOf=(groupId:string)=>circles.find(circle=>circle.id===groupId)?.name??'مجلس';
  const incoming=rows.filter(row=>row.user_id!==userId&&row.status==='pending');
  const mine=rows.filter(row=>row.user_id===userId);
  const join=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    const code=link.match(/[A-Za-z2-9]{20}/g)?.pop();
    if(!code){say('الصق رابط الدعوة كاملًا أو رمزه.',true);return}
    setBusy(true);
    try{const {error}=await authClient.rpc('request_group_join',{p_code:code});if(error)throw error;setLink('');say('أُرسل طلب الانضمام، وينتظر موافقة صاحب المجلس.');await load()}
    catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  const decide=async(id:string,approve:boolean)=>{
    if(!authClient||busy)return;setBusy(true);
    try{const {error}=await authClient.rpc('decide_group_join_request',{p_request_id:id,p_approve:approve});if(error)throw error;say(approve?'قُبل الطلب وأُضيف العضو.':'رُفض الطلب.');await load();onChanged()}
    catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  return <section className="panel tawasi-hub-panel" aria-label="الدعوات">
    <h2>الدعوات</h2>
    {message&&<p className={`circles-notice${failed?' error':''}`} role={failed?'alert':'status'}>{message}</p>}
    <form className="circle-session-form" onSubmit={event=>void join(event)}>
      <label>وصلتك دعوة؟ الصق رابطها هنا<input dir="ltr" value={link} onChange={event=>setLink(event.target.value)} placeholder="https://alrabbaniyun.com/invite/…"/></label>
      <button className="primary" disabled={busy||!link.trim()}>طلب الانضمام</button>
    </form>
    <h3>طلبات تنتظر قرارك</h3>
    {incoming.length===0?<p className="muted small">لا طلبات انضمام جديدة إلى مجالسك.</p>:<ul className="course-list">{incoming.map(row=><li key={row.id}><div><strong>{nameOf(row.group_id)}</strong><p className="muted small">طلب انضمام · {day(row.requested_at)}</p></div><div className="course-actions"><button className="soft-btn" disabled={busy} onClick={()=>void decide(row.id,true)}>قبول</button><button className="soft-btn" disabled={busy} onClick={()=>void decide(row.id,false)}>رفض</button></div></li>)}</ul>}
    {mine.length>0&&<><h3>طلباتي للانضمام</h3><ul className="course-list">{mine.map(row=><li key={row.id}><div><strong>{nameOf(row.group_id)}</strong><p className="muted small">{day(row.requested_at)} · {statusText[row.status]}</p></div></li>)}</ul></>}
  </section>;
}

type Session={id:string;title:string|null;starts_at:string;status:string};
export function TawasiHistoryPanel({circles}:{circles:CircleRef[]}){
  const [items,setItems]=useState<{id:string;title:string;at:string}[]|null>(null);
  const key=circles.map(circle=>circle.id).join(',');
  useEffect(()=>{
    if(!authClient)return;
    let live=true;
    void Promise.all(circles.map(async circle=>{
      const {data}=await authClient!.rpc('list_circle_sessions_with_agenda',{p_circle_id:circle.id});
      return ((data??[]) as Session[]).map(session=>({id:session.id,title:session.title||circle.name,at:session.starts_at}));
    })).then(lists=>{if(live)setItems(lists.flat().sort((a,b)=>b.at.localeCompare(a.at)))});
    return()=>{live=false};
  },[key]);
  return <section className="panel tawasi-hub-panel" aria-label="السجل">
    <h2>السجل</h2>
    {items===null?<p className="muted small" role="status">جارٍ التحميل…</p>:items.length===0?<p className="muted small">لا مجالس سابقة بعد.</p>:<ul className="course-list">{items.map(item=><li key={item.id}><div><strong>{item.title}</strong><p className="muted small">{day(item.at)}</p></div></li>)}</ul>}
  </section>;
}
