import {authClient} from './auth';
import {uploadedBookPath} from './resource-management';

const bucket='journey-books';
const maxBytes=50*1024*1024;

export function isUploadedBookUrl(url:string):boolean{
  if(!authClient)return false;
  const {data}=authClient.storage.from(bucket).getPublicUrl('');
  return uploadedBookPath(url,data.publicUrl)!==null;
}

export async function uploadBookPdf(file:File):Promise<string>{
  if(!authClient)throw new Error('خدمة رفع الكتب غير مفعّلة.');
  if(!file.name.toLowerCase().endsWith('.pdf')||(file.type&&file.type!=='application/pdf'))throw new Error('اختر ملف PDF فقط.');
  if(file.size===0||file.size>maxBytes)throw new Error('حجم ملف PDF يجب ألا يتجاوز ٥٠ ميغابايت.');
  const signature=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());
  if(signature!=='%PDF-')throw new Error('الملف المختار ليس PDF صالحًا.');
  const path=`${crypto.randomUUID()}.pdf`;
  const {error}=await authClient.storage.from(bucket).upload(path,file,{contentType:'application/pdf',upsert:false});
  if(error)throw new Error(`تعذر رفع الكتاب: ${error.message}`);
  return authClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
