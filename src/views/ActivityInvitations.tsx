import {useCallback,useEffect,useState} from 'react';
import {CalendarClock,Check,Inbox,LoaderCircle,UserPlus,X} from 'lucide-react';
import {authClient} from '../auth';
import '../invitations.css';

export type InviteRow={
  invite_id:string;
  invitee_username?:string|null;
  invitee_name?:string|null;
  status:string;
  created_at?:string|null;
  decided_at?:string|null;
  expires_at?:string|null;
  topic?:string|null;
  starts_at?:string|null;
};

export const inviteStatusLabel:Record<string,string>={
  pending:'بانتظار الرد',accepted:'مقبولة',declined:'معتذرة',cancelled:'ملغاة',expired:'منتهية',
};

const messageOf=(error:unknown)=>{
  const candidate=error as {message?:string;details?:string}|null;
  return candidate?.message||candidate?.details||'تعذر إتمام العملية.';
};
const fmt=(value?:string|null)=>value?new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
const statusLabel=(status:string)=>inviteStatusLabel[status]??status;

/** عدّادات الحالات المشتركة بين كل الأنشطة. */
export function InviteSummary({rows}:{rows:InviteRow[]}){
  const count=(status:string)=>rows.filter(row=>row.status===status).length;
  return <div className="invite-summary" aria-label="ملخص الدعوات">
    <span className="invite-chip total">الإجمالي <b>{rows.length}</b></span>
    <span className="invite-chip pending">بانتظار الرد <b>{count('pending')}</b></span>
    <span className="invite-chip accepted">مقبولة <b>{count('accepted')}</b></span>
    <span className="invite-chip declined">معتذرة <b>{count('declined')}</b></span>
    {(count('cancelled')+count('expired'))>0&&<span className="invite-chip muted">ملغاة/منتهية <b>{count('cancelled')+count('expired')}</b></span>}
  </div>;
}

type ActivityProps={
  title:string;
  rows:InviteRow[];
  onCancel?:(inviteId:string)=>Promise<void>;
  busy?:boolean;
  emptyText?:string;
  intro?:string;
  showExpiry?:boolean;
};

/**
 * قائمة دعوات النشاط كما يراها المنظّم: الحالات والعدّادات وإلغاء المعلّق.
 * تعمل مع أي نشاط يمرر صفوفه ودالة الإلغاء الخاصة به.
 */
export default function ActivityInvitations({title,rows,onCancel,busy=false,emptyText='لم تُرسل دعوات بعد.',intro,showExpiry=false}:ActivityProps){
  const [cancelling,setCancelling]=useState('');
  const [error,setError]=useState('');

  const cancel=async(inviteId:string)=>{
    if(!onCancel||cancelling)return;
    setCancelling(inviteId);setError('');
    try{await onCancel(inviteId)}
    catch(caught){setError(messageOf(caught))}
    finally{setCancelling('')}
  };

  return <div className="invite-panel">
    <div className="invite-panel-head"><h4><UserPlus size={16} aria-hidden="true"/> {title}</h4></div>
    {intro&&<p className="muted small">{intro}</p>}
    <InviteSummary rows={rows}/>
    {error&&<p className="invite-message error" role="alert">{error}</p>}
    {rows.length===0?<p className="invite-state"><Inbox size={16}/> {emptyText}</p>:<ul className="invite-list">
      {rows.map(row=>{
        const name=row.invitee_name||'عضو';
        return <li key={row.invite_id}>
          <div className="invite-list-main">
            <strong>{name}</strong>
            {row.invitee_username&&<bdi dir="ltr" className="muted small">@{row.invitee_username}</bdi>}
            {row.topic&&<span className="invite-topic">{row.topic}</span>}
            <small className="muted">
              {row.starts_at?<>موعد الجلسة: {fmt(row.starts_at)} · </>:null}
              {showExpiry&&row.expires_at?<>تنتهي: {fmt(row.expires_at)} · </>:null}
              أُرسلت: {fmt(row.created_at)}
            </small>
          </div>
          <div className="invite-list-actions">
            <span className={`invite-status status-${row.status}`}>{statusLabel(row.status)}</span>
            {onCancel&&row.status==='pending'&&<button type="button" className="soft-btn" disabled={busy||Boolean(cancelling)} onClick={()=>void cancel(row.invite_id)}>
              {cancelling===row.invite_id?<LoaderCircle size={14} className="spin"/>:<X size={14}/>} إلغاء
            </button>}
          </div>
        </li>;
      })}
    </ul>}
  </div>;
}

type ReceivedProps={
  activityType:'study_circle'|'course'|'tawasi_session';
  title?:string;
  intro?:string;
  emptyText?:string;
  onChanged?:()=>void;
};

type ReceivedRow={
  activity_type:string;invitation_id:string;activity_id:string;activity_title:string;
  inviter_name:string;status:string;created_at:string;expires_at:string|null;
};

const isMissingLayer=(error:unknown)=>{
  const candidate=error as {code?:string;message?:string;details?:string}|null;
  const text=`${candidate?.message??''} ${candidate?.details??''}`;
  return candidate?.code==='42883'
    ||(candidate?.code==='PGRST202'&&/list_my_activity_invitations|respond_activity_invitation/i.test(text));
};

/**
 * الدعوات الواردة للعضو، مفلترة على نوع النشاط. تُقرأ من الطبقة الموحّدة
 * list_my_activity_invitations، فلا يحتاج كل نشاط إلى منطق استقبال خاص.
 * إن لم تكن الطبقة مطبّقة على الخادم بعد، تُخفى بهدوء مع بقاء بقية الصفحة.
 */
export function ReceivedInvitations({activityType,title='دعوات وصلتك',intro,emptyText='لا دعوات واردة الآن.',onChanged}:ReceivedProps){
  const [rows,setRows]=useState<ReceivedRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [unavailable,setUnavailable]=useState(false);
  const [refresh,setRefresh]=useState(0);

  const load=useCallback(async()=>{
    if(!authClient){setLoading(false);return}
    setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.rpc('list_my_activity_invitations',{p_activity_type:activityType});
      if(loadError){if(isMissingLayer(loadError)){setUnavailable(true);return}throw loadError}
      setUnavailable(false);
      setRows((data??[]) as ReceivedRow[]);
    }catch(caught){setError(messageOf(caught))}
    finally{setLoading(false)}
  },[activityType]);

  useEffect(()=>{void load()},[load,refresh]);

  const respond=async(invitationId:string,accept:boolean)=>{
    if(!authClient||busy)return;
    setBusy(invitationId);setError('');setNotice('');
    try{
      const {data,error:responseError}=await authClient.rpc('respond_activity_invitation',{
        p_activity_type:activityType,p_invitation_id:invitationId,p_accept:accept,
      });
      if(responseError)throw responseError;
      const result=String(data??'');
      const messages:Record<string,string>={
        accepted:'قُبلت الدعوة، وتحدّثت حالة مشاركتك.',
        already_registered:'أنت مسجل في هذا النشاط بالفعل.',
        declined:'رُفضت الدعوة، وأُبلغ المنظّم.',
        expired:'انتهت صلاحية الدعوة.',
        unavailable:'الموعد أو النشاط لم يعد متاحًا.',
      };
      setNotice(messages[result]??(accept?'قُبلت الدعوة.':'رُفضت الدعوة.'));
      setRefresh(value=>value+1);
      onChanged?.();
    }catch(caught){setError(messageOf(caught))}
    finally{setBusy('')}
  };

  if(unavailable)return null;

  return <div className="invite-panel received">
    <div className="invite-panel-head"><h4><Inbox size={16} aria-hidden="true"/> {title}</h4>
      <button type="button" className="soft-btn" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>تحديث</button>
    </div>
    {intro&&<p className="muted small">{intro}</p>}
    {loading?<p className="invite-state" role="status"><LoaderCircle size={15} className="spin"/> جارٍ تحميل الدعوات…</p>
      :error?<p className="invite-message error" role="alert">{error}</p>
      :rows.length===0?<p className="invite-state"><Inbox size={16}/> {emptyText}</p>
      :<ul className="invite-list">
        {rows.map(row=><li key={row.invitation_id}>
          <div className="invite-list-main">
            <strong>{row.activity_title}</strong>
            <small className="muted">من {row.inviter_name} · أُرسلت {fmt(row.created_at)}</small>
            {row.expires_at&&<small className="muted">تنتهي {fmt(row.expires_at)}</small>}
          </div>
          <div className="invite-list-actions">
            <button type="button" className="soft-btn" disabled={Boolean(busy)} onClick={()=>void respond(row.invitation_id,true)}>
              {busy===row.invitation_id?<LoaderCircle size={14} className="spin"/>:<Check size={14}/>} قبول
            </button>
            <button type="button" className="soft-btn" disabled={Boolean(busy)} onClick={()=>void respond(row.invitation_id,false)}>
              <X size={14}/> اعتذار
            </button>
          </div>
        </li>)}
      </ul>}
    {notice&&<p className="invite-message ok" role="status">{notice}</p>}
  </div>;
}

/** شارة موعد قادم تُستخدم في بطاقات الأنشطة. */
export function InviteSlotBadge({startsAt}:{startsAt:string}){
  return <span className="invite-slot-badge"><CalendarClock size={14} aria-hidden="true"/>{fmt(startsAt)}</span>;
}
