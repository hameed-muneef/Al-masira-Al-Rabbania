import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {authClient} from '../auth';

type Track={track_id:string;track_title:string;track_book_title:string;track_description:string;track_course_id:string|null;track_circle_id:string|null;track_station_id:string|null;track_created_at:string};
type Part={part_id:string;part_position:number;part_title:string;part_content:string;part_question:string};

export default function StudyTracksView({user,courseId,circleId}:{user:{id:string}|null;courseId?:string|null;circleId?:string|null}){
  const [tracks,setTracks]=useState<Track[]>([]);
  const [selectedTrack,setSelectedTrack]=useState<string|null>(null);
  const [parts,setParts]=useState<Part[]>([]);
  const [completed,setCompleted]=useState<Set<number>>(new Set());
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const loadTracks=async()=>{
    if(!authClient){setLoading(false);return}
    setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.rpc('list_study_tracks',{p_course_id:courseId??null,p_circle_id:circleId??null});
      if(loadError)throw loadError;
      setTracks((data??[]) as Track[]);
      if((data??[]).length&&!selectedTrack)setSelectedTrack((data as Track[])[0].track_id);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل مسارات الدراسة.')}
    finally{setLoading(false)}
  };
  const loadParts=async(trackId:string)=>{
    if(!authClient)return;
    try{
      const {data,error:loadError}=await authClient.rpc('list_study_parts',{p_track_id:trackId});
      if(loadError)throw loadError;
      setParts((data??[]) as Part[]);
      // load progress
      const {data:prog}=await authClient.from('study_progress').select('part_position').eq('track_id',trackId).eq('user_id',user?.id??'');
      setCompleted(new Set((prog??[]).map((p:any)=>p.part_position)));
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل الأجزاء.')}
  };
  useEffect(()=>{void loadTracks()},[courseId,circleId]);
  useEffect(()=>{if(selectedTrack)void loadParts(selectedTrack)},[selectedTrack]);
  const markComplete=async(trackId:string,pos:number)=>{
    if(!authClient)return;
    try{
      const {error:rpcError}=await authClient.rpc('mark_study_part_complete',{p_track_id:trackId,p_part_position:pos});
      if(rpcError)throw rpcError;
      setCompleted(current=>new Set(current).add(pos));
      setNotice('تم تسجيل إكمال الجزء.');
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تسجيل الإكمال.')}
  };
  if(loading)return <p role="status">جارٍ تحميل مسارات الدراسة…</p>;
  return <div className="teacher-view study-tracks-view">
    <div className="page-intro"><span className="eyebrow">المدارسة</span><h1>مسارات دراسة</h1><p>ادرس كتابًا أو موضوعًا على أجزاء، وأجب عن أسئلته، وتابع تقدمك.</p></div>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {notice&&<p className="teacher-notice" role="status">{notice}</p>}
    {tracks.length===0?<section className="panel"><h2>لا توجد مسارات</h2><p className="muted">لم يُنشئ أي مسار دراسة بعد.</p></section>:<>
      <div className="circles-toolbar">
        <select value={selectedTrack??''} onChange={e=>setSelectedTrack(e.target.value)} aria-label="مسار الدراسة">{tracks.map(t=><option key={t.track_id} value={t.track_id}>{t.track_title}{t.track_book_title?` — ${t.track_book_title}`:''}</option>)}</select>
        <button className="soft-btn" onClick={()=>void loadTracks()}><RefreshCw size={15}/> تحديث</button>
      </div>
      {selectedTrack&&parts.length===0&&<p className="muted">لا أجزاء في هذا المسار.</p>}
      <ul className="course-list">{parts.map(p=>(
        <li key={p.part_id}>
          <div><strong>{p.part_position}. {p.part_title}</strong>{p.part_content&&<p className="muted small">{p.part_content}</p>}{p.part_question&&<p><strong>سؤال:</strong> {p.part_question}</p>}</div>
          <button className={completed.has(p.part_position)?'soft-btn':'primary'} disabled={completed.has(p.part_position)} onClick={()=>{if(selectedTrack)void markComplete(selectedTrack,p.part_position)}}>{completed.has(p.part_position)?'مكتمل':'تحديد كمكتمل'}</button>
        </li>
      ))}</ul>
    </>}
  </div>;
}
