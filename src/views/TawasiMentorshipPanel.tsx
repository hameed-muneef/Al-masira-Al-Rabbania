import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {CalendarClock,UserRound,HeartHandshake,Check,Clock3} from 'lucide-react';
import {authClient} from '../auth';

type Mentor={user_id:string;display_name:string;biography:string;mentor_type:string;qualifications:string;specialties:string[];languages:string[]};
type Profile=Mentor&{directory_visible:boolean;status:string;review_note:string};
type Slot={slot_id:string;starts_at:string;ends_at:string};
type OwnSlot=Slot&{status:'available'|'booked'};
type Request={request_id:string;slot_id:string;mentor_id:string;requester_id:string;topic:string;private_details:string;status:string;mentor_note:string;starts_at:string;ends_at:string;created_at:string};
const statusLabel:Record<string,string>={submitted:'بانتظار مراجعة الإدارة',approved:'معتمد',rejected:'بحاجة إلى تعديل',suspended:'معلّق',pending:'بانتظار رد المرشد',confirmed:'مؤكدة',cancelled:'ملغاة',completed:'مكتملة'};
const typeLabel:Record<string,string>={scholar:'عالم أو طالب علم مؤهل',educator:'مربٍ',mentor:'مرشد تربوي',counselor:'مقدم توجيه عام'};
const messageOf=(error:unknown)=>error instanceof Error?error.message:'تعذر إتمام العملية.';
const fmt=(value:string)=>new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const bounds=()=>{const from=new Date();const to=new Date(from);to.setDate(to.getDate()+90);return[from.toISOString(),to.toISOString()] as const};
const isMissingMentorshipSchema=(error:unknown)=>{
  if(!error||typeof error!=='object')return false;
  const candidate=error as {code?:string;message?:string;details?:string};
  const text=`${candidate.message??''} ${candidate.details??''}`;
  return candidate.code==='PGRST205'||candidate.code==='42P01'||(candidate.code==='PGRST202'&&/tawasi_mentor|tawasi_mentorship/i.test(text));
};

export default function TawasiMentorshipPanel({userId,always=false}:{userId:string;always?:boolean}){
  const [profile,setProfile]=useState<Profile|null>(null);
  const [mentors,setMentors]=useState<Mentor[]>([]);
  const [requests,setRequests]=useState<Request[]>([]);
  const [mySlots,setMySlots]=useState<OwnSlot[]>([]);
  const [slots,setSlots]=useState<Record<string,Slot[]>>({});
  const [expanded,setExpanded]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [schemaUnavailable,setSchemaUnavailable]=useState(false);
  const [notice,setNotice]=useState('');
  const [slotDraft,setSlotDraft]=useState({starts_at:'',ends_at:''});
  const [booking,setBooking]=useState<{slot:Slot;mentor:Mentor}|null>(null);
  const [bookingDraft,setBookingDraft]=useState({topic:'',private_details:''});

  const load=useCallback(async()=>{
    if(!authClient)return;
    setLoading(true);setError('');
    try{
      const [profileResult,mentorResult,requestResult]=await Promise.all([
        authClient.rpc('get_my_tawasi_mentor_profile'),
        authClient.rpc('list_tawasi_mentors'),
        authClient.rpc('list_my_tawasi_mentorship_requests'),
      ]);
      const failed=[profileResult.error,mentorResult.error,requestResult.error].find(Boolean);
      if(failed){if(isMissingMentorshipSchema(failed)){setSchemaUnavailable(true);return}throw failed}
      setSchemaUnavailable(false);
      const own=((profileResult.data??[]) as Profile[])[0]??null;
      setProfile(own);setMentors((mentorResult.data??[]) as Mentor[]);setRequests((requestResult.data??[]) as Request[]);
      if(own?.status==='approved'){
        const {data,error:slotError}=await authClient.rpc('list_my_tawasi_mentor_slots');if(slotError)throw slotError;setMySlots((data??[]) as OwnSlot[]);
      }else setMySlots([]);
    }catch(caught){setError(messageOf(caught))}finally{setLoading(false)}
  },[]);
  useEffect(()=>{void load()},[load]);

  const toggleSlots=async(mentor:Mentor)=>{
    if(expanded===mentor.user_id){setExpanded(null);return}setExpanded(mentor.user_id);setBooking(null);
    if(slots[mentor.user_id])return;
    const[from,to]=bounds();
    try{const {data,error:loadError}=await authClient!.rpc('list_tawasi_mentor_slots',{p_mentor_id:mentor.user_id,p_from:from,p_to:to});if(loadError)throw loadError;setSlots(current=>({...current,[mentor.user_id]:(data??[]) as Slot[]}))}
    catch(caught){setError(messageOf(caught))}
  };
  const addSlot=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;setBusy(true);setError('');setNotice('');
    try{const startsAt=new Date(slotDraft.starts_at);const endsAt=new Date(slotDraft.ends_at);if(!slotDraft.starts_at||!slotDraft.ends_at||!Number.isFinite(+startsAt)||!Number.isFinite(+endsAt))throw new Error('اختر وقت بداية ونهاية صحيحين.');const {error:saveError}=await authClient.rpc('create_tawasi_mentor_slot',{p_starts_at:startsAt.toISOString(),p_ends_at:endsAt.toISOString()});if(saveError)throw saveError;setSlotDraft({starts_at:'',ends_at:''});setNotice('أُضيف الموعد المتاح.');setSlots({});await load();}catch(caught){setError(messageOf(caught))}finally{setBusy(false)}
  };
  const cancelSlot=async(slotId:string)=>{if(!authClient||busy)return;setBusy(true);setError('');setNotice('');try{const{error:saveError}=await authClient.rpc('cancel_tawasi_mentor_slot',{p_slot_id:slotId});if(saveError)throw saveError;setNotice('أُلغي الموعد المتاح مع الاحتفاظ بسجله.');await load()}catch(caught){setError(messageOf(caught))}finally{setBusy(false)}};
  const submitBooking=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||!booking||busy)return;setBusy(true);setError('');setNotice('');
    try{const {error:saveError}=await authClient.rpc('request_tawasi_mentorship',{p_slot_id:booking.slot.slot_id,p_topic:bookingDraft.topic.trim(),p_private_details:bookingDraft.private_details.trim()});if(saveError)throw saveError;setBooking(null);setBookingDraft({topic:'',private_details:''});setNotice('أُرسل طلب الجلسة للمرشد. تفاصيل طلبك خاصة بينكما.');await load();setSlots({});}
    catch(caught){setError(messageOf(caught))}finally{setBusy(false)}
  };
  const review=async(requestId:string,decision:'confirm'|'reject')=>{
    if(!authClient||busy)return;setBusy(true);setError('');setNotice('');
    try{const {error:saveError}=await authClient.rpc('review_tawasi_mentorship_request',{p_request_id:requestId,p_decision:decision,p_mentor_note:''});if(saveError)throw saveError;setNotice(decision==='confirm'?'تأكد الموعد.':'رُفض الطلب وأُعيد الموعد إلى قائمة المتاح.');await load();setSlots({});}
    catch(caught){setError(messageOf(caught))}finally{setBusy(false)}
  };
  const cancel=async(requestId:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');setNotice('');
    try{const {error:saveError}=await authClient.rpc('cancel_tawasi_mentorship_request',{p_request_id:requestId});if(saveError)throw saveError;setNotice('أُلغي الطلب.');await load();setSlots({});}
    catch(caught){setError(messageOf(caught))}finally{setBusy(false)}
  };

  if(!always&&!loading&&!error&&(schemaUnavailable||(mentors.length===0&&requests.length===0&&!profile)))return null;
  return <section className="panel tawasi-mentorship" aria-labelledby="tawasi-mentorship-title">
    <div className="panel-head"><HeartHandshake size={20}/><h2 id="tawasi-mentorship-title">طلب جلسة مع مرشد معتمد</h2></div>
    <p className="muted tawasi-mentorship-intro">يمكنك طلب جلسة خاصة مع أحد المرشدين المعتمدين. تفاصيل الطلب لا تظهر للعامة.</p>
    {error&&<p className="circles-notice error" role="alert">{error} <button className="soft-btn" type="button" onClick={()=>void load()}>إعادة المحاولة</button></p>}
    {notice&&<p className="circles-notice" role="status">{notice}</p>}
    {loading?<p className="tawasi-loading" role="status">جارٍ تحميل المرشدين والجلسات…</p>:schemaUnavailable?null:<>
      {profile&&profile.status!=='rejected'?<div className="tawasi-mentor-status"><strong>ملف المرشد: {statusLabel[profile.status]??profile.status}</strong>{profile.review_note&&<p>{profile.review_note}</p>}
        {profile.status==='approved'&&<form className="tawasi-slot-form" onSubmit={event=>void addSlot(event)}><label>بداية التوفر<input required type="datetime-local" value={slotDraft.starts_at} onChange={event=>setSlotDraft(current=>({...current,starts_at:event.target.value}))}/></label><label>نهاية التوفر<input required type="datetime-local" value={slotDraft.ends_at} onChange={event=>setSlotDraft(current=>({...current,ends_at:event.target.value}))}/></label><button className="soft-btn" disabled={busy}><CalendarClock size={16}/> إضافة موعد متاح</button></form>}
        {profile.status==='approved'&&<div className="tawasi-own-slots"><h4>مواعيدك</h4>{mySlots.length===0?<p className="muted">لم تضف مواعيد متاحة بعد.</p>:mySlots.map(slot=><div key={slot.slot_id}><span>{fmt(slot.starts_at)} – {fmt(slot.ends_at)} · {slot.status==='booked'?'عليه طلب':'متاح'}</span>{slot.status==='available'&&<button className="soft-btn" disabled={busy} onClick={()=>void cancelSlot(slot.slot_id)}>إلغاء الموعد</button>}</div>)}</div>}
      </div>:null}
      {mentors.length===0&&!schemaUnavailable&&<p className="muted">لا يوجد مشايخ معتمدون متاحون الآن.</p>}
      {mentors.length>0&&<div className="tawasi-mentor-list"><h3>المرشدون المعتمدون</h3>{mentors.map(mentor=><article className="tawasi-mentor-card" key={mentor.user_id}>
        <div><h4><UserRound size={17}/>{mentor.display_name}</h4><span className="circles-role">{typeLabel[mentor.mentor_type]??mentor.mentor_type}</span><p>{mentor.biography||'مرشد معتمد في التواصي الفردي.'}</p><p><strong>المؤهلات:</strong> {mentor.qualifications}</p>{mentor.specialties.length>0&&<p><strong>مجالاته:</strong> {mentor.specialties.join('، ')}</p>}</div>
        <button className="soft-btn" type="button" aria-expanded={expanded===mentor.user_id} onClick={()=>void toggleSlots(mentor)}><Clock3 size={16}/>{expanded===mentor.user_id?'إخفاء المواعيد':'عرض المواعيد'}</button>
        {expanded===mentor.user_id&&<div className="tawasi-slot-list">{(slots[mentor.user_id]??[]).length===0?<p className="muted">لا توجد مواعيد متاحة خلال التسعين يومًا القادمة.</p>:(slots[mentor.user_id]??[]).map(slot=><div key={slot.slot_id}><span>{fmt(slot.starts_at)} – {fmt(slot.ends_at)}</span><button className="primary" type="button" disabled={mentor.user_id===userId||busy} onClick={()=>{setBooking({slot,mentor});setBookingDraft({topic:'',private_details:''})}}>طلب الجلسة</button></div>)}</div>}
      </article>)}</div>}
      {requests.length>0&&<div className="tawasi-request-list"><h3>جلساتي وطلباتي</h3>{requests.map(request=>{const mentor=mentors.find(item=>item.user_id===request.mentor_id);const isMentor=request.mentor_id===userId;return <article key={request.request_id}><div><strong>{isMentor?`طلب من عضو · ${request.topic}`:`جلسة مع ${mentor?.display_name??'مرشد'}`}</strong><span className={`tawasi-request-status status-${request.status}`}>{statusLabel[request.status]??request.status}</span><small>{fmt(request.starts_at)} – {fmt(request.ends_at)}</small><p className="tawasi-private-details">{request.private_details}</p>{request.mentor_note&&<p>{request.mentor_note}</p>}</div><div className="tawasi-request-actions">{isMentor&&request.status==='pending'&&<><button className="soft-btn" disabled={busy} onClick={()=>void review(request.request_id,'confirm')}><Check size={15}/> تأكيد</button><button className="soft-btn" disabled={busy} onClick={()=>void review(request.request_id,'reject')}>اعتذار</button></>}{['pending','confirmed'].includes(request.status)&&<button className="soft-btn" disabled={busy} onClick={()=>void cancel(request.request_id)}>إلغاء الطلب</button>}</div></article>})}</div>}
    </>}
    {booking&&<form className="tawasi-booking-form" onSubmit={event=>void submitBooking(event)}><h3>طلب جلسة مع {booking.mentor.display_name}</h3><p>{fmt(booking.slot.starts_at)}</p><label>مجال طلب التوجيه<input required minLength={2} maxLength={120} value={bookingDraft.topic} onChange={event=>setBookingDraft(current=>({...current,topic:event.target.value}))}/></label><label>تفاصيل خاصة بالطلب<textarea maxLength={2000} rows={3} value={bookingDraft.private_details} onChange={event=>setBookingDraft(current=>({...current,private_details:event.target.value}))}/></label><div><button className="primary" disabled={busy}>إرسال الطلب</button><button className="soft-btn" type="button" onClick={()=>setBooking(null)}>إلغاء</button></div></form>}
  </section>;
}
