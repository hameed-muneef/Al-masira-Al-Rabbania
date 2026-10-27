import catalog from './learning-videos.json';
export const stationTitles = ['تعلّم المعنى بمصادره', 'عِش مع القرآن', 'في مدرسة النبوة', 'على خطى السلف', 'اجلس مع نفسك', 'عِش المعنى', 'حاسب نفسك'];
export type Resource = {id:string; kind:'source'|'book'|'video'; title:string; author:string; reference:string; url:string; level:'basic'|'extra'};
export type Station = {body:string; sourceIds:string[]};
export type Unit = {id:string; title:string; focus?:string; summary:string; stations:Station[]; resources:Resource[]; status:'draft'|'review'|'approved'|'published'; revision:number; reviewer:string; reviewNote:string};
export type Curriculum = {units:Unit[]; progress:Record<string,number>; archivedUnits?:Unit[]; playlistImported?:boolean; mediaVersion?:number};
export const statusLabels = {draft:'مسودة',review:'قيد المراجعة',approved:'معتمد',published:'منشور'};
export const kindLabels = {source:'مصدر',book:'كتاب',video:'فيديو'};
export function safeUrl(value:string):string|null {
  if(/^\/(?!\/)[a-z0-9/_-]+\.pdf(?:#page=\d+)?$/i.test(value)) return value;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;} catch {return null;}
}
export function unitErrors(unit:Unit):string[] {
  const errors:string[]=[];
  if(!unit.title.trim() || !unit.summary.trim()) errors.push('أكمل عنوان المحطة وهدفها.');
  if(unit.stations.length!==7 || unit.stations.some(s=>!s.body.trim())) errors.push('أكمل نص الخطوات السبع.');
  if(unit.resources.length===0) errors.push('أضف مصدرًا موثقًا على الأقل.');
  if(unit.resources.some(r=>!r.title.trim() || !r.reference.trim() || !r.author.trim() || !safeUrl(r.url))) errors.push('لكل مادة: عنوان، مؤلف أو جهة، مرجع تفصيلي، ورابط HTTP أو HTTPS صالح.');
  if(unit.stations.some(s=>s.sourceIds.some(id=>!unit.resources.some(r=>r.id===id)))) errors.push('يوجد ربط بمصدر محذوف.');
  if(unit.stations.slice(0,4).some(s=>!s.sourceIds.some(id=>unit.resources.some(r=>r.id===id && r.level==='basic')))) errors.push('اربط كل خطوة علمية من الأربع الأولى بمصدر أساسي.');
  return errors;
}
export function reviseUnit(unit:Unit):Unit {return {...unit,status:'draft',reviewer:'',reviewNote:'',revision:unit.revision+1};}
export function transitionUnit(unit:Unit,next:Unit['status'],reviewer='',note=''):Unit {
  if(next==='draft') return {...unit,status:'draft',reviewer:'',reviewNote:''};
  const allowed={review:'draft',approved:'review',published:'approved'};
  if(unit.status!==allowed[next]) throw new Error('أكمل مراحل المراجعة بالترتيب.');
  const errors=unitErrors(unit);if(errors.length) throw new Error(errors.join(' '));
  if(next==='approved' && (!reviewer.trim() || !note.trim())) throw new Error('أدخل اسم المراجع وملاحظته على هذه النسخة.');
  return {...unit,status:next,reviewer:next==='approved'?reviewer.trim():unit.reviewer,reviewNote:next==='approved'?note.trim():unit.reviewNote};
}
export function availableUnits(units:Unit[],progress:Record<string,number>):Unit[] {
  const available:Unit[]=[];
  for(const unit of units){available.push(unit);if((progress[unit.id]??0)<7) break;}
  return available;
}
const source=(id:string,title:string,url:string,reference:string,author='القرآن الكريم'):Resource=>({id,title,url,reference,author,kind:'source',level:'basic'});
const dhariyat=source('purpose','غاية الخلق','https://quran.com/ar/adh-dhariyat/56','الذاريات: ٥٦، والتفسير الميسر');
const returnVerse=source('return','الخلق والرجوع إلى الله','https://quran.com/ar/al-muminun/115','المؤمنون: ١١٥');
const death=source('death','الموت والجزاء','https://quran.com/ar/ali-imran/185','آل عمران: ١٨٥، والتفسير الميسر');
const names=source('names','أسماء الله في خواتيم الحشر','https://quran.com/ar/al-hashr/22-24','الحشر: ٢٢–٢٤');
const attributes=source('attributes','تنزيه الله وإثبات صفاته','https://quran.com/ar/ash-shuraa/11','الشورى: ١١، والتفسير الميسر');
const jibril=source('jibril','حديث جبريل: الإيمان والإسلام والإحسان','https://sunnah.com/bukhari:50','صحيح البخاري، كتاب الإيمان، حديث ٥٠','الإمام البخاري');
const traveler=source('traveler','الاستعداد للآخرة ووصية ابن عمر','https://sunnah.com/bukhari:6416','صحيح البخاري، كتاب الرقاق، حديث ٦٤١٦','الإمام البخاري؛ الأثر عن عبد الله بن عمر');
const beautiful=source('beautiful','فضل إحصاء أسماء الله','https://sunnah.com/bukhari:2736','صحيح البخاري، كتاب الشروط، حديث ٢٧٣٦','الإمام البخاري');
const creed=source('creed','منهج السلف في أسماء الله وصفاته','https://binbaz.org.sa/fatwas/12397/مذهب-اهل-السنة-في-اسماء-الله-وصفاته','فتاوى نور على الدرب: مذهب أهل السنة في أسماء الله وصفاته','عبد العزيز بن باز');
const book=(id:string,title:string,page:string,reference:string):Resource=>({id,title:`تعريف عام بدين الإسلام · ${title}`,author:'علي الطنطاوي',reference,url:`https://shamela.ws/book/37562/${page}`,kind:'book',level:'extra'});
const bookBasic=(id:string,title:string,page:string,reference:string):Resource=>({...book(id,title,page,reference),level:'basic'});
const generalIslam:Resource={id:'general-islam-book',kind:'book',title:'تعريف عام بدين الإسلام',author:'علي الطنطاوي',reference:'الكتاب الكامل · نسخة PDF',url:'/books/general-islam.pdf',level:'basic'};
const lifeJourney:Resource={id:'life-journey-book',kind:'book',title:'رحلة حياة... خطوات في طريق الحياة الطيبة',author:'د. محمد محمد بدري',reference:'دار الصفوة للنشر والتوزيع، الطبعة الأولى ١٤٤٢هـ / ٢٠٢١م · ١٥٤ صفحة',url:'/books/journey-of-life.pdf',level:'basic'};
const knowingAllahBook:Resource={id:'knowing-allah-book',kind:'book',title:'وما قدروا الله حق قدره',author:'عبد العزيز بن ناصر الجليل',reference:'سلسلة وقفات تربوية في ضوء القرآن الكريم، المجلد التاسع عشر · الطبعة الأولى ١٤٣٩هـ · نسخة PDF من ٣٥١ صفحة',url:'/books/wa-ma-qadaru-allah.pdf',level:'extra'};
const allahAnisBook:Resource={id:'allah-anis-book',kind:'book',title:'الله جل جلاله، أنيس المحبين',author:'عبد الملك القاسم',reference:'نسخة PDF من ٥١٣ صفحة',url:'/books/allah-jal-jalalah-anis-al-muhibbin.pdf',level:'basic'};
const goodOpinionBook:Resource={id:'good-opinion-book',kind:'book',title:'حسن الظن بالله',author:'إياد قنيبي',reference:'نسخة PDF من ٢٠٢ صفحة',url:'/books/husn-al-zann-billah.pdf',level:'extra'};
const steadfastBook:Resource={id:'steadfast-book',kind:'book',title:'وما بدلوا تبديلا',author:'ناصر بن سليمان العمر',reference:'نسخة PDF من ١٨٠ صفحة',url:'/books/wa-ma-baddalu-tabdila.pdf',level:'basic'};
const reasonsRejectTruthBook:Resource={id:'reasons-reject-truth-book',kind:'book',title:'الأسباب التي تصد عن قبول الحق',author:'عبد الملك القاسم',reference:'نسخة PDF من ٣٦٧ صفحة',url:'/books/asbab-tasad-an-qabul-al-haqq.pdf',level:'basic'};
const runWithHeartBook:Resource={id:'run-with-heart-book',kind:'book',title:'اركض بقلبك.. روائع مدارج السالكين',author:'عبد الملك القاسم',reference:'نسخة PDF من ٧٠٧ صفحات',url:'/books/arkud-bi-qalbak-madarij-al-salikin.pdf',level:'basic'};
const elixirBook:Resource={id:'elixir-book',kind:'book',title:'الإكسير (خلاصة أعمال القلوب)',author:'عبد الملك القاسم',reference:'نسخة PDF من ٢٨٨ صفحة',url:'/books/al-iksir-khulasa-aamal-al-qulub.pdf',level:'basic'};
const greatnessBook:Resource={id:'greatness-book',kind:'book',title:'ما أعظمك! رحلة في رحاب أسماء الله الحسنى وصفاته العلى',author:'مشعل عبد العزيز الفلاحي',reference:'نسخة PDF من ١٩٢ صفحة',url:'/books/ma-azamaka.pdf',level:'basic'};
const belovedBook:Resource={id:'beloved-book',kind:'book',title:'لو كان بيننا الحبيب ﷺ',author:'أحمد السفيري',reference:'نسخة PDF من ٢٠٦ صفحات',url:'/books/law-kana-baynana.pdf',level:'basic'};
const conductBook:Resource={id:'conduct-book',kind:'book',title:'قواعد في السلوك إلى الله',author:'عز الدين الواسطي',reference:'نسخة PDF من ٣٠٨ صفحات؛ من كلام عز الدين الواسطي',url:'/books/qawaid-al-suluk.pdf',level:'basic'};
const lastJourneyBook:Resource={id:'last-journey-book',kind:'book',title:'الرحلة الأخيرة',author:'عبد الملك القاسم',reference:'نسخة PDF من ١٤١ صفحة',url:'/books/al-rihla-al-akhira.pdf',level:'basic'};
const soulsJourneyBook:Resource={id:'souls-journey-book',kind:'book',title:'رحلة الأرواح',author:'عبد الملك القاسم',reference:'نسخة PDF من ٣٦٣ صفحة',url:'/books/rihlat-al-arwah.pdf',level:'basic'};
const afterDeathBook:Resource={id:'after-death-book',kind:'book',title:'ماذا بعد الموت؟',author:'عمر عبد الكافي',reference:'نسخة PDF من ١٨٥ صفحة',url:'/books/mada-baad-al-mawt.pdf',level:'basic'};
const meetingKingBook:Resource={id:'meeting-king-book',kind:'book',title:'عند لقاء الملك جل جلاله',author:'عبد الملك القاسم',reference:'نسخة PDF من ٣١٨ صفحة',url:'/books/inda-liqaa-al-malik.pdf',level:'basic'};
export function addGoodOpinionBook(unit:Unit):Unit {
  if(unit.id!=='beginning'||unit.resources.some(resource=>resource.id===goodOpinionBook.id))return unit;
  return {...unit,resources:[...unit.resources,goodOpinionBook],stations:unit.stations.map((station,index)=>index===0?{...station,sourceIds:[...station.sourceIds,goodOpinionBook.id]}:station)};
}
export function updateBeginningBooks(unit:Unit):Unit {
  if(unit.id!=='beginning')return unit;
  const books=[generalIslam,lifeJourney,knowingAllahBook,goodOpinionBook];
  const resources=[...books.map(book=>({...book})),...unit.resources.filter(resource=>resource.id!=='why-created-book'&&!books.some(book=>book.id===resource.id))];
  const stations=unit.stations.map((station,index)=>index===0?{...station,body:'ابدأ بقراءة «تعريف عام بدين الإسلام» لتكوين صورة عامة عن الدين، ثم انتقل إلى «رحلة حياة... خطوات في طريق الحياة الطيبة». ويمكنك التوسع بكتابَي «وما قدروا الله حق قدره» و«حسن الظن بالله». دوّن ما تحتاج إلى فهمه أو سؤاله، وميّز بين نصوص الوحي وشرح المؤلفين.',sourceIds:[...books.map(book=>book.id),...station.sourceIds.filter(id=>id.startsWith('journey-video-'))]}:{...station,sourceIds:station.sourceIds.filter(id=>id!=='why-created-book')});
  return {...unit,resources,stations};
}
const st=(body:string,...sourceIds:string[]):Station=>({body,sourceIds});
const knowledgeUnitIds=new Set(['knowing','beautiful-names','attributes','knowing-attributes']);
export function mergeKnowledgeUnits(units:Unit[]):Unit[] {
  const primary=units.find(item=>item.id==='knowing');
  if(!primary)return units;
  const related=units.filter(item=>knowledgeUnitIds.has(item.id));
  if(related.length===1&&primary.title==='معرفة الله وأسماؤه وصفاته')return units;
  const resources=[...new Map(related.flatMap(item=>item.resources).map(resource=>[resource.id,resource])).values()];
  const stations=primary.stations.map((_,index)=>({
    body:[...new Set(related.map(item=>item.stations[index]?.body.trim()).filter((body):body is string=>!!body))].join('\n\n'),
    sourceIds:[...new Set(related.flatMap(item=>item.stations[index]?.sourceIds??[]))]
  }));
  const combined:Unit={...primary,title:'معرفة الله وأسماؤه وصفاته',summary:'نتعلم معرفة الله وأسمائه الحسنى وصفاته من الوحي، ونربط العلم بالدعاء والعبادة والعمل.',resources,stations,status:'draft',reviewer:'',reviewNote:'',revision:Math.max(...related.map(item=>item.revision))+1};
  return units.flatMap(item=>item.id==='knowing'?[combined]:knowledgeUnitIds.has(item.id)?[]:[item]);
}
export function mergeKnowledgeCurriculum(data:Curriculum):Curriculum {
  const progress=Math.max(...[...knowledgeUnitIds].map(id=>data.progress[id]??0));
  return {...data,units:mergeKnowledgeUnits(data.units),progress:{...data.progress,knowing:progress}};
}
const thematicBookUnit=(id:string,title:string,summary:string,resource:Resource|Resource[]):Unit=>{
  const resources=Array.isArray(resource)?resource:[resource];
  const firstResourceTitle=resources[0]?.title??'الكتاب';
  return unit(id,title,summary,resources,[
    st(`ابدأ بقراءة الكتب المخصصة لهذه المحطة قراءة متأنية. ابدأ بـ«${firstResourceTitle}» ثم انتقل إلى البقية حسب الحاجة، ودوّن الفكرة التي تريد التحقق من دليلها، وميّز كلام المؤلف من النص الشرعي.`,...resources.map(r=>r.id)),
    st('راجع الآيات المذكورة في الكتب من المصحف وتفسير موثوق، واقرأها في سياقها.',...resources.map(r=>r.id)),
    st('إذا ورد حديث في القراءة، فتحقق من مصدره وصحته قبل نسبته إلى النبي ﷺ.',...resources.map(r=>r.id)),
    st('تأمل ما أورده المؤلف من أقوال السلف، وراجع نسبتها ومعناها من مصدر موثوق.',...resources.map(r=>r.id)),
    st('ما الفكرة التي اتضحت لك؟ وما السؤال الذي يحتاج إلى مزيد من القراءة أو سؤال أهل العلم؟'),
    st('اختر فائدة عملية مباحة مما قرأت، وحدد خطوة يسيرة تناسب يومك.'),
    st('راجع ما قرأت وما بقي من الصفحات، وسجل رقم صفحتك داخل قارئ الكتاب لتعود إليها.')
  ]);
};
export const learningVideos=catalog.videos;
export const videoResourceId=(videoId:string)=>`journey-video-${videoId}`;
const playlistResources=(unitId:string):Resource[]=>learningVideos.filter(video=>video.unitId===unitId).map(video=>({id:videoResourceId(video.videoId),kind:'video',title:video.title,author:video.author,reference:`${video.playlistTitle} · الفيديو ${video.index} · ${video.group}`,url:`https://www.youtube.com/watch?v=${video.videoId}&list=${video.playlistId}&index=${video.index}`,level:'extra'}));
const unit=(id:string,title:string,summary:string,resources:Resource[],stations:Station[]):Unit=>({id,title,summary,resources:[...resources.map(resource=>({...resource})),...playlistResources(id)],stations:stations.map((station,index)=>({...station,sourceIds:[...station.sourceIds,...learningVideos.filter(video=>video.unitId===id&&video.station===index).map(video=>videoResourceId(video.videoId))]})),status:'draft',revision:1,reviewer:'',reviewNote:''});
export function legacyInitialCurriculum():Curriculum {return {progress:{},playlistImported:true,mediaVersion:12,units:mergeKnowledgeUnits([
  updateBeginningBooks(unit('beginning','البداية · لماذا جئنا؟','نفهم غاية خلقنا، وصلتها بعبادة الله وتوجيه يومنا إليه.',[dhariyat,returnVerse,jibril,traveler,book('book-intro','دين الإسلام','20','فصل دين الإسلام، ص ٢٥'),book('book-beliefs','قواعد العقائد','31','فصل قواعد العقائد، ص ٣٧')],[
    st('تبدأ الرحلة بسؤال الغاية. تدل آية الذاريات على أن غاية خلق الجن والإنس عبادة الله، وتذكر آية المؤمنون بأن الخلق ليس عبثًا وأن الرجوع إليه حق. هذه بداية لفهم مسؤولية الإنسان، ثم ترجمة العلم إلى عمل.','purpose','return'),
    st('اقرأ الذاريات: ٥٦ والمؤمنون: ١١٥ من المصحف المرتبط أدناه. تأمل الصلة بين العبادة والرجوع إلى الله. راجع التفسير الميسر لمعنى الآية، وميّز كلام الله عن الشرح التعليمي.','purpose','return'),
    st('اقرأ حديث جبريل في صحيح البخاري: ٥٠. يجمع بين الإيمان والإسلام والإحسان؛ فالتعلم يتصل بعبادة الله وحده وبالأعمال، مع استحضار مراقبته.','jibril'),
    st('اقرأ وصية ابن عمر في آخر حديث البخاري: ٦٤١٦ عن اغتنام الصحة والحياة. ميّز بين كلام النبي ﷺ أول الحديث ووصية الصحابي بعده؛ وهي تفتح باب المبادرة إلى العمل.','traveler'),
    st('ما الذي يأخذ أكثر وقتي؟ وكيف أستحضر غاية العبادة عند ترتيب أولوياتي؟ تأمل لنفسك دون الحاجة إلى مشاركة إجابة.'),
    st('اختر عملًا نافعًا من يومك، واستحضر فيه نية صالحة، وحدد حقًا واجبًا تحرص على أدائه. هذا اقتراح تطبيقي لا ورد تعبدي جديد.'),
    st('ما الفكرة التي اتضحت لي؟ وما الخطوة التي أريد المحافظة عليها غدًا؟ راجع العمل دون إصدار حكم على إيمانك.')])),
  unit('destination','إلى أين المصير؟','نتعلم الرجوع إلى الله والبعث والجزاء، ونربط ذلك بحسن العمل.',[death,returnVerse,jibril,traveler,lastJourneyBook,soulsJourneyBook,afterDeathBook,meetingKingBook,book('book-afterlife','الإيمان باليوم الآخر','91','فصل الإيمان باليوم الآخر، ص ١٠١')],[
    st('تقرر آية آل عمران أن الموت واقع وأن تمام الجزاء يوم القيامة. والإيمان بالبعث ولقاء الله من المعاني الواردة في حديث جبريل. تعلم المصير يدعو إلى الاستعداد والعمل، مع تجنب التخمين في تفاصيل الغيب. اقرأ كتب «الرحلة الأخيرة»، «رحلة الأرواح»، «ماذا بعد الموت؟»، و«عند لقاء الملك جل جلاله» للتأمل في الموت وما بعده.','death','jibril','last-journey-book','souls-journey-book','after-death-book','meeting-king-book'),
    st('اقرأ آل عمران: ١٨٥ والمؤمنون: ١١٥. تأمل معنى الرجوع إلى الله، وما تصفه الآية بالفوز. ارجع إلى التفسير المرفق لفهم السياق.','death','return'),
    st('اقرأ حديث «كن في الدنيا كأنك غريب، أو عابر سبيل» في البخاري: ٦٤١٦. تأمل قصر الإقامة وما يقتضيه من ترتيب الأولويات.','traveler'),
    st('تأمل وصية ابن عمر باغتنام الصحة والحياة الواردة في المصدر نفسه. اجعل التأمل دافعًا إلى عمل ممكن اليوم، لا إلى إهمال مسؤولياتك.','traveler'),
    st('هل هناك حق أؤخر أداءه أو إصلاح أستطيع البدء به؟ احتفظ بالتفاصيل الخاصة لنفسك.'),
    st('حدد خطوة لإصلاح تقصير أو أداء حق، وخذ بسبب عملي لإنجازها. لا يلزم تسجيل الذنب أو كشفه.'),
    st('هل ساعدني تذكر المصير على ترتيب أولوياتي؟ ما الخطوة التالية الممكنة دون إرهاق؟')]),
  unit('knowing','معرفة الله · التوحيد والإحسان','نتعرف إلى ربنا من وحيه، ونربط المعرفة بالتوحيد والعبادة.',[names,dhariyat,jibril,creed,allahAnisBook,book('book-faith','الإيمان بالله','46','فصل الإيمان بالله، ص ٥٣'),book('book-worship','توحيد الألوهية','57','فصل توحيد الألوهية، ص ٦٥')],[
    st('تعرفنا خواتيم سورة الحشر بالله: وحدانيته وعلمه ورحمته وملكه وخلقه. تُبنى هذه المعرفة على الوحي، ويظهر أثرها في إخلاص العبادة لله واستحضار مراقبته. اقرأ كتاب «الله جل جلاله، أنيس المحبين» للتعرف على الله أحب التعرف.','names','purpose','allah-anis-book'),
    st('اقرأ الحشر: ٢٢–٢٤ بتأنٍّ. لاحظ الأسماء الواردة، ثم راجع تفسيرها. لا تنسب إلى الله اسمًا أو وصفًا لمجرد استحسان لفظه.','names','creed'),
    st('راجع معنى الإحسان في حديث جبريل: عبادة الله مع استحضار رؤيته لعبده. فالمعرفة ليست حفظ معلومات فقط، بل باب إلى إحسان العمل.','jibril'),
    st('اقرأ الشرح المرتبط لمنهج السلف: الاعتماد على ما جاء في القرآن والسنة الصحيحة في باب الأسماء والصفات. النص هنا تلخيص تعليمي، وليس اقتباسًا عن أحد السلف.','creed'),
    st('ما المعنى الذي احتجت إلى فهمه عن ربي؟ وما السؤال الذي أحتاج أن أسأل عنه أهل العلم؟'),
    st('استحضر مراقبة الله في عمل محدد، واجتهد في إتقانه وأمانته. اختر تطبيقًا يناسب حالك.'),
    st('ما الذي تعلمته من النصوص؟ وهل فرّقت بين الدليل وبين التأمل الشخصي؟')]),
  unit('beautiful-names','أسماء الله الحسنى · معرفة ودعاء','نتعلم الأسماء الثابتة ومعانيها، وندعو الله بها.',[names,beautiful,creed,source('dua','دعاء الله بأسمائه','https://quran.com/ar/al-araf/180-186','الأعراف: ١٨٠'),book('book-names','الإيمان بالله','46','فصل الإيمان بالله، ص ٥٣؛ قراءة تكميلية لا تُغني عن النصوص والمراجع الموثقة للأسماء')],[
    st('لله الأسماء الحسنى، ويدعونا القرآن إلى دعائه بها. نبدأ بأسماء وردت في الحشر، ونتعلم معانيها من شرح موثوق. لا نختلق لكل اسم عددًا للذكر أو فضلًا خاصًا بلا دليل.','names','dua'),
    st('اقرأ الأعراف: ١٨٠ وخواتيم الحشر. اختر اسمًا ورد في النص، وراجع معناه قبل ربطه بتأملاتك.','dua','names'),
    st('اقرأ حديث فضل إحصاء أسماء الله في البخاري: ٢٧٣٦. ارجع إلى أهل العلم في شرح الإحصاء؛ لا تعامل عداد التطبيق بوصفه تحقيقًا لهذا الوعد.','beautiful'),
    st('يوضح الشرح المرتبط أن أسماء الله وصفاته تُتلقى من القرآن والسنة. اتبع هذا الأصل عند تعلم اسم أو إضافة مادة تعليمية عنه.','creed'),
    st('ما الاسم الذي تعلمت معناه اليوم؟ وما الفرق بين معناه الموثق وبين ما شعرت به عند تعلمه؟'),
    st('ادع الله باسم ثابت يناسب دعاءك، دون التزام عدد أو صيغة خاصة لم تثبت. هذا تطبيق مقترح للمعنى.'),
    st('هل تعلمت الاسم من دليل صحيح؟ وما الذي أحتاج إلى مراجعته في معناه؟')]),
  unit('attributes','صفات الله · إثبات وتنزيه','نفهم أصل الإيمان بالصفات على منهج السلف، مع تنزيه الله عن مشابهة خلقه.',[attributes,jibril,creed,book('book-attributes','آيات الصفات ضمن توحيد الألوهية','57','فصل توحيد الألوهية، بدءًا من ص ٦٥؛ انظر عنوان آيات الصفات داخل الفصل')],[
    st('يجمع قوله تعالى في الشورى: ١١ بين نفي المماثلة وإثبات السمع والبصر. والمنهج المتبع هنا إثبات ما ثبت في الوحي على الوجه اللائق بالله، دون تحريف أو تعطيل أو تكييف أو تمثيل.','attributes','creed'),
    st('تأمل ختام آية الشورى: ١١. اجمع في فهمك بين التنزيه والإثبات، واقرأ التفسير المرتبط دون تخيل كيفية الصفات.','attributes'),
    st('ارجع إلى حديث جبريل ومعنى الإحسان. استحضار أن الله يرى عبده يصل العلم بحسن العبادة والعمل.','jibril'),
    st('اقرأ شرح ابن باز لمنهج السلف في المصدر المرفق. تعلّم حدود الكلام في هذا الباب، واسأل أهل العلم عما أشكل بدل بناء أحكام على تخيلات.','creed'),
    st('هل أفهم الفرق بين معرفة معنى الصفة والسؤال عن كيفيتها؟ دوّن سؤالك لأهل العلم إن احتجت، دون إلزام بتسجيله هنا.'),
    st('استحضر علم الله وسمعه وبصره في حفظ لسانك وأمانتك، واختر سلوكًا عمليًا تحسنه اليوم.'),
    st('راجع الأصل الذي تعلمته ومصدره. التقدم هنا يعني إتمام التعلم التجريبي، ولا يقيس منزلة إيمانية.')]),
  unit('decree','الإيمان بالقدر','قراءة تمهيدية في باب القدر من كتاب الطنطاوي، مع مراجعة النصوص الشرعية التي يستند إليها.',[bookBasic('book-decree','الإيمان بالقدر','117','فصل الإيمان بالقدر، ص ١٢٧')],[
    st('اقرأ مدخل الفصل لتعرف ترتيب الكاتب للمسائل. تعامل مع كلامه بوصفه شرحًا مؤلفًا، وارجع إلى الدليل الذي يورده داخل الفصل.','book-decree'),
    st('تأمل الآيات التي يذكرها الفصل في سياقها من المصحف، وميّز النص القرآني من شرح الكاتب.','book-decree'),
    st('دوّن مرجع أي حديث يرد في القراءة ثم ارجع إلى مصدره قبل بناء حكم عليه.','book-decree'),
    st('اقرأ عرض الكاتب للمسائل وطريقته في الاستدلال. أي موضع مشكل يحتاج مراجعة أهل العلم، لا تخمينًا في الغيب.','book-decree'),
    st('ما السؤال الذي بقي غير واضح لي في هذا الباب؟ يمكن إبقاؤه خاصًا دون نشره.'),
    st('اختر عملًا مباحًا نافعًا تأخذ بأسبابه، مع التوكل على الله دون ترك المسؤولية.'),
    st('راجع ما فهمته من النصوص وما يحتاج إلى توثيق إضافي أو سؤال أهل العلم.')]),
  unit('unseen','الإيمان بالغيب','قراءة في معنى الغيب وحدود ما يُعلم منه بالخبر الصحيح.',[bookBasic('book-unseen','الإيمان بالغيب','129','فصل الإيمان بالغيب، ص ١٣٩')],[
    st('اقرأ افتتاح فصل الإيمان بالغيب، ولاحظ الفرق بين ما تدركه الحواس وما يُعرف بخبر الوحي.','book-unseen'),
    st('راجع الآيات التي يوردها الكاتب في المصحف، واقرأ سياقها قبل تلخيص المعنى.','book-unseen'),
    st('إذا ورد حديث في الفصل فتحقق من مصدره قبل نسبته إلى النبي ﷺ.','book-unseen'),
    st('تأمل طريقة الكاتب في تناول حدود المعرفة بالغيب، واترك ما لم يثبت فيه خبر.','book-unseen'),
    st('ما الفرق عندي بين الإيمان بما ثبت وبين التخمين في تفاصيل الغيب؟'),
    st('مارس التثبت من المصادر قبل تداول معلومة دينية عن أمر غيبي.'),
    st('راجع مصادر ما قرأت وما الذي تريد الاستفسار عنه.')]),
  unit('messengers','الملائكة والرسل والكتب','قراءة أبواب الوحي والملائكة والرسل والكتب، وربط الإيمان بها بالعلم والعمل.',[bookBasic('book-angels','الملائكة والكتب والرسل','135','فصل الملائكة والكتب والرسل، ص ١٤٥'),bookBasic('book-prophets','الإيمان بالرسل','147','فصل الإيمان بالرسل، ص ١٥٧'),bookBasic('book-scriptures','الإيمان بالكتب','171','فصل الإيمان بالكتب، ص ١٨١')],[
    st('ابدأ بمدخل الفصل الذي يجمع بين الملائكة والكتب والرسل، ثم اقرأ كل باب في موضعه من الكتاب.','book-angels'),
    st('راجع الآيات التي يوردها فصل الرسل والكتب في سياقها من المصحف.','book-prophets','book-scriptures'),
    st('عند قراءة ما يُنسب إلى النبي ﷺ في هذه الأبواب، راجع مصدر الحديث وصحته.','book-prophets'),
    st('تأمل ترتيب أبواب الملائكة والرسل والكتب في الكتاب، وكيف يربط الكاتب بينها، مع التفريق بين النص الشرعي وشرحه.','book-angels','book-prophets','book-scriptures'),
    st('أي سؤال يحتاج إلى توضيح من مصدر موثوق أو من أهل العلم؟'),
    st('اختر فائدة عملية من دراستك للوحي والرسل، وارجع إلى نصها الموثق قبل تطبيقها.'),
    st('راجع ما تعلمته وما تريد استكمال قراءته من هذه الأبواب.')]),
  thematicBookUnit('steadfastness','الثبات على الحق والدين','قراءة في الثبات على الحق والوفاء به، مع مراجعة أدلة الكتاب في مصادرها.',[reasonsRejectTruthBook,steadfastBook]),
  thematicBookUnit('knowing-attributes','معرفة الله وصفاته','قراءة في أسماء الله الحسنى وصفاته العلى، مع الرجوع إلى النصوص وشرحها الموثوق.',greatnessBook),
  thematicBookUnit('prophetic-home','بيت النبوة','قراءة في سيرة النبي ﷺ وهديه، مع التحقق من الروايات ومصادرها.',belovedBook),
  thematicBookUnit('self-purification','التزكية وتربية النفس','قراءة في السلوك إلى الله وتربية النفس، وربط العلم بخطوة عملية.',[runWithHeartBook,elixirBook,conductBook]),
])};}

export const journeyStages=[
  {id:'awakening',title:'رحلة الاستيقاظ والتأسيس',focus:'اليقظة، معرفة الله، التوبة، الاستقامة',summary:'تكوين التصور الصحيح للحياة، وتأسيس الإيمان والعمل بالفرائض.',steps:[
    'ابدأ بسؤال الغاية من الحياة، واقرأ المصادر الأساسية في معرفة الله وأصول الإيمان. ميّز نصوص الوحي من شرح المؤلفين.',
    'اقرأ الآيات المذكورة في مصادر هذه الرحلة من المصحف، وارجع إلى تفسير موثوق لفهم سياقها.',
    'اقرأ ما ورد من سنة النبي ﷺ في موضوع الإيمان والتوبة والاستقامة، وتحقق من مصادر الأحاديث.',
    'راجع ما نقله المؤلفون عن السلف في التأسيس والالتزام بالحق، وتثبت من نسبته ومعناه.',
    'تأمل ما تحتاج إلى تعلمه من أصول الدين والفرائض، وسجل سؤالًا تريد الرجوع فيه إلى أهل العلم.',
    'اختر فرضًا أو حقًا واجبًا تحرص على أدائه اليوم، وخذ بخطوة عملية تعينك على الاستقامة.',
    'راجع ما فهمته وما بقي لديك من أسئلة، واحفظ رقم الصفحة التي وصلت إليها في كل كتاب.'
  ]},
  {id:'knowledge-purification',title:'رحلة العلم والتزكية',focus:'العلم النافع، تزكية النفس، المجاهدة',summary:'الانتقال من المعرفة إلى الممارسة وتهذيب النفس.',steps:[
    'اقرأ في العلم النافع وتزكية النفس وسيرة النبي ﷺ، وحدد المعنى الذي تريد العمل به.',
    'راجع الآيات التي تستند إليها قراءات هذه الرحلة في المصحف وتفسير موثوق.',
    'تأمل الهدي النبوي في التعلم والعمل وتهذيب النفس، وتحقق من الروايات قبل اعتمادها.',
    'اقرأ كلام أهل العلم في السلوك إلى الله مع التفريق بين الدليل والتأمل والتجربة.',
    'ما العادة التي تحتاج إلى تهذيب؟ اختر ما يمكنك إصلاحه دون تسجيل أمر خاص لا تريد حفظه.',
    'حوّل فائدة واحدة من قراءتك إلى عمل يسير تداوم عليه بما يناسب ظروفك.',
    'راجع أثر ما تعلمته، وما تحتاج إلى استكماله من القراءة أو سؤال أهل العلم.'
  ]},
  {id:'rooted-taqwa',title:'رحلة ترسيخ التقوى',focus:'أعمال القلوب، حسن الخلق، التقوى',summary:'تعميق الإخلاص وإصلاح علاقة الإنسان بالله وبالناس.',steps:[
    'اقرأ في أعمال القلوب والثبات على الحق، وميّز النص الشرعي من شرح المؤلف.',
    'راجع الآيات الواردة في قراءات هذه الرحلة وتأمل صلتها بالتقوى وحسن الخلق.',
    'تحقق من الأحاديث المذكورة في المصادر، وتأمل ما تدعو إليه من إخلاص وأمانة.',
    'اقرأ ما نُقل عن السلف في المجاهدة والثبات، مع التثبت من النسبة والسياق.',
    'كيف تؤثر نيتك وخلقك في علاقتك بالله وبالناس؟ أبقِ مراجعتك خاصة إن أحببت.',
    'اختر حقًا لشخص أو خلقًا تريد تحسينه، واتخذ خطوة محددة اليوم.',
    'راجع ما قرأت وما عملت به، واحفظ موضعك في الكتب للعودة إليه.'
  ]},
  {id:'watchfulness-ihsan',title:'رحلة المراقبة والإحسان',focus:'المراقبة، الإحسان',summary:'تنمية حضور القلب وإتقان العبودية في مختلف شؤون الحياة.',steps:[
    'اقرأ في معنى الإحسان واستحضار مراقبة الله، وابدأ بالمصادر الموثقة لهذه الرحلة.',
    'راجع الآيات المتعلقة بعلم الله وقربه من عباده في سياقها وتفسيرها.',
    'ارجع إلى حديث جبريل ومعنى الإحسان، وتحقق من نص الحديث وشرحه.',
    'تأمل كيف ربط أهل العلم بين المعرفة وحضور القلب وإتقان العمل.',
    'في أي عمل تحتاج إلى مزيد من الانتباه والإخلاص؟ راجع نيتك دون حكم على منزلتك الإيمانية.',
    'اختر عملًا من عبادتك أو مسؤولياتك اليومية، واجتهد في إتقانه وأداء حقه.',
    'راجع أثر استحضار المراقبة في يومك، واحفظ موضع قراءتك للمتابعة.'
  ]}
] as const;
export type JourneyStageId=typeof journeyStages[number]['id'];
const legacyStageByUnit:Record<string,JourneyStageId>={
  beginning:'awakening',destination:'awakening',knowing:'awakening','beautiful-names':'awakening',attributes:'awakening','knowing-attributes':'awakening',decree:'awakening',unseen:'awakening',messengers:'awakening',
  'prophetic-home':'knowledge-purification','self-purification':'knowledge-purification',steadfastness:'rooted-taqwa'
};
const resourceStageOverrides:Record<string,JourneyStageId>={
  'good-opinion-book':'rooted-taqwa','steadfast-book':'rooted-taqwa','elixir-book':'rooted-taqwa',
  'allah-anis-book':'watchfulness-ihsan','book-worship':'watchfulness-ihsan',
  'reasons-reject-truth-book':'knowledge-purification'
};
export function journeyStageForLegacyUnit(unitId:string):JourneyStageId{return legacyStageByUnit[unitId]??'knowledge-purification'}
export function organizeJourneyCurriculum(data:Curriculum):Curriculum {
  if(data.units.length===journeyStages.length&&data.units.every((unit,index)=>unit.id===journeyStages[index].id))return data;
  const legacy=data.units;
  const units:Unit[]=journeyStages.map(stage=>{
    const resources=new Map<string,Resource>();
    for(const old of legacy)for(const resource of old.resources){
      const destination=resourceStageOverrides[resource.id]??journeyStageForLegacyUnit(old.id);
      if(destination===stage.id&&!resources.has(resource.id))resources.set(resource.id,resource);
    }
    const books=[...resources.values()].filter(resource=>resource.kind==='book').map(resource=>resource.id);
    const stations:Station[]=stage.steps.map((body,index)=>{
      const linked=legacy.flatMap(old=>old.stations[index]?.sourceIds.filter(id=>resources.has(id))??[]);
      return {body,sourceIds:[...new Set([...linked,...(index<4?books:[])])]};
    });
    return {id:stage.id,title:stage.title,focus:stage.focus,summary:stage.summary,stations,resources:[...resources.values()],status:'draft',revision:1,reviewer:'',reviewNote:''};
  });
  const progress={...data.progress,
    awakening:data.progress.awakening??data.progress.beginning??0,
    'knowledge-purification':data.progress['knowledge-purification']??Math.max(data.progress['prophetic-home']??0,data.progress['self-purification']??0),
    'rooted-taqwa':data.progress['rooted-taqwa']??data.progress.steadfastness??0,
    'watchfulness-ihsan':data.progress['watchfulness-ihsan']??0
  };
  return {...data,mediaVersion:13,units,progress,archivedUnits:[...(data.archivedUnits??[]),...legacy]};
}
const removedResourceIds=new Set(['purpose','jibril','death','names','creed','dua']);
const removedResource=(resource:Resource)=>removedResourceIds.has(resource.id)||resource.id!=='general-islam-book'&&resource.url.startsWith('https://shamela.ws/book/37562/');
export function refreshCurriculumResources(data:Curriculum):Curriculum {
  let generalIslamSeen=false;
  const clean=(units:Unit[])=>units.map(unit=>{
    const resources=unit.resources.flatMap(resource=>{
      if(removedResource(resource))return [];
      if(resource.id==='general-islam-book'){
        if(generalIslamSeen)return [];
        generalIslamSeen=true;
        return [{...generalIslam}];
      }
      return [resource];
    });
    const ids=new Set(resources.map(resource=>resource.id));
    return {...unit,resources,stations:unit.stations.map(station=>({...station,sourceIds:station.sourceIds.filter(id=>ids.has(id))}))};
  });
  const units=clean(data.units);
  generalIslamSeen=false;
  const archivedUnits=data.archivedUnits?clean(data.archivedUnits):undefined;
  return {...data,mediaVersion:14,units,archivedUnits};
}
export function initialCurriculum():Curriculum{return refreshCurriculumResources({...organizeJourneyCurriculum(legacyInitialCurriculum()),archivedUnits:undefined})}
