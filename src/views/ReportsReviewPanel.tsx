import {useEffect,useState} from 'react';
import {authClient} from '../auth';

type Report={report_id:string;reporter_id:string;target_type:string;target_id:string;reason:string;details:string;report_status:string;created_at:string};
const reasonLabel:Record<string,string>={spam:'رسائل مزعجة',harassment:'مضايقة',inappropriate:'محتوى غير لائق',misinformation:'معلومات مضللة',privacy:'خصوصية',other:'أخرى'};

export default function ReportsReviewPanel(){
  const [reports,setReports]=useState<Report[]>([]);
  const [status,setStatus]=useState('open');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const [shareContent,setShareContent]=useState<Record<string,string>>({});
  const viewShare=async(id:string)=>{
    if(!authClient)return;
    const {data,error:rpcError}=await authClient.rpc('admin_review_reported_share',{p_report_id:id});
    if(rpcError){setError(rpcError.message);return}
    const row=(data as {share_type:string;sender_username:string;recipient_username:string;ref_title:string;description:string}[])?.[0];
    setShareContent(prev=>({...prev,[id]:row?`من @${row.sender_username} إلى @${row.recipient_username} · ${row.share_type} · ${row.ref_title}${row.description?' · '+row.description:''}`:'غير متاح'}));
  };
  const load=async()=>{
    if(!authClient)return;setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.rpc('list_reports',{p_status:status||null});
      if(loadError)throw loadError;
      setReports((data??[]) as Report[]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل الإبلاغات.')}
    finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[status]);
  const review=async(id:string,next:string,note:string)=>{
    if(!authClient||busy)return;setBusy(id);
    try{
      const {error:rpcError}=await authClient.rpc('review_report',{p_report_id:id,p_status:next,p_admin_note:note});
      if(rpcError)throw rpcError;
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر مراجعة الإبلاغ.')}
    finally{setBusy(null)}
  };
  return <section className="panel teacher-review-panel" aria-labelledby="reports-title">
    <div className="panel-head"><h2 id="reports-title">الإبلاغات</h2></div>
    <div className="circles-toolbar">
      <label>الحالة<select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">مفتوحة</option><option value="reviewed">تمت مراجعتها</option><option value="dismissed">مرفوضة</option><option value="actioned">تم الإجراء</option><option value="">الكل</option></select></label>
      <button className="soft-btn" onClick={()=>void load()}>تحديث</button>
    </div>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {loading?<p role="status">جارٍ تحميل الإبلاغات…</p>:reports.length===0?<p className="muted">لا توجد إبلاغات.</p>:
      <ul className="managed-resources">{reports.map(r=>(
        <li key={r.report_id}>
          <div className="managed-resource-title"><strong>{reasonLabel[r.reason]??r.reason}</strong><small>{r.target_type} · {r.target_id} · {new Date(r.created_at).toLocaleString('ar-EG')}</small>{r.details&&<small>{r.details}</small>}</div>
          {r.target_type==='share'&&<div><button className="soft-btn" onClick={()=>void viewShare(r.report_id)}>عرض محتوى المشاركة (يُسجَّل في سجل التدقيق)</button>{shareContent[r.report_id]&&<small>{shareContent[r.report_id]}</small>}</div>}<div className="managed-resource-actions">
            <button className="soft-btn" disabled={busy===r.report_id} onClick={()=>void review(r.report_id,'reviewed','')}>مراجعة</button>
            <button className="soft-btn" disabled={busy===r.report_id} onClick={()=>void review(r.report_id,'dismissed','')}>رفض</button>
            <button className="soft-btn" disabled={busy===r.report_id} onClick={()=>void review(r.report_id,'actioned','')}>إجراء</button>
          </div>
        </li>
      ))}</ul>}
  </section>;
}
