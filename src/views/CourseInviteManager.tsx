import {useEffect,useState} from 'react';
import {UserPlus} from 'lucide-react';
import {authClient} from '../auth';
import MemberInviteBar from './MemberInviteBar';
import ActivityInvitations,{type InviteRow} from './ActivityInvitations';

const isMissingCourseInvites=(error:unknown)=>{
  const candidate=error as {code?:string;message?:string;details?:string}|null;
  const text=`${candidate?.message??''} ${candidate?.details??''}`;
  return candidate?.code==='42883'
    ||(candidate?.code==='PGRST202'&&/course_invitations|invite_course_member|list_course_invites|cancel_course_invite/i.test(text));
};

/**
 * إدارة دعوات مجلس علم واحد داخل بطاقة المجلس نفسها: البحث والإرسال
 * وقائمة الحالات وإلغاء المعلّق. كل التحقق (ملكية المجلس، النشر، السعة،
 * الاكتشاف، الحظر) يجري على الخادم في invite_course_member.
 */
export default function CourseInviteManager({courseId,onChanged}:{courseId:string;onChanged?:()=>void}){
  const [open,setOpen]=useState(false);
  const [rows,setRows]=useState<InviteRow[]>([]);
  const [unavailable,setUnavailable]=useState(false);
  const [error,setError]=useState('');

  const load=async()=>{
    if(!authClient)return;
    const {data,error:listError}=await authClient.rpc('list_course_invites',{p_course_id:courseId});
    if(listError){if(isMissingCourseInvites(listError)){setUnavailable(true);return}setError('تعذر تحميل دعوات المجلس.');return}
    setUnavailable(false);setError('');
    setRows((data??[]) as InviteRow[]);
  };
  useEffect(()=>{if(open)void load()},[open,courseId]);

  const send=async(username:string)=>{
    if(!authClient)throw new Error('تسجيل الدخول مطلوب.');
    const {error:inviteError}=await authClient.rpc('invite_course_member',{p_course_id:courseId,p_username:username.trim(),p_note:''});
    if(inviteError)throw inviteError;
  };
  const cancel=async(inviteId:string)=>{
    if(!authClient)return;
    const {error:cancelError}=await authClient.rpc('cancel_course_invite',{p_invite_id:inviteId});
    if(cancelError)throw cancelError;
    await load();
  };

  return <div className="course-invite-manager">
    <button type="button" className="soft-btn" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <UserPlus size={15}/> {open?'إخفاء دعوات المشاركين':'دعوة مشاركين'}
    </button>
    {open&&(unavailable
      ?<p className="muted small">إدارة دعوات المجالس غير متاحة على هذا الخادم بعد.</p>
      :<>
        <MemberInviteBar actionLabel="دعوة إلى المجلس" hint="ابحث باسم المستخدم، واختر مشاركًا أو أكثر" onInvite={send} onDone={()=>{void load();onChanged?.()}}/>
        {error&&<p className="invite-message error" role="alert">{error}</p>}
        <ActivityInvitations title="دعوات المجلس" rows={rows} onCancel={cancel} showExpiry
          intro="قبول الدعوة يسجّل المشارك مباشرة ما دام التسجيل مفتوحًا وهناك مقعد متاح." emptyText="لم تُرسل دعوات بعد."/>
      </>)}
  </div>;
}
