export function getArchivePageAfterResult(currentPage:number,resultCount:number):number{
  return currentPage>0&&resultCount===0?0:currentPage;
}
