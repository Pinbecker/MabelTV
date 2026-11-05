import {test,expect} from './test-fixtures.mjs'
import {openStudio} from './studio-fixtures.mjs'
test.use({serviceWorkers:'block'})
const film={title:'Arrival',media_type:'movie',tmdb_id:329865,year:'2016',poster_path:'/arrival.jpg'}
async function activity(page) {
  await openStudio(page)
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.evaluate(film=>{clearInterval(studioTimer);library.my_tv_library=[];studioState.status.jobs=[{id:'done',title:film.title,matchedTitle:film,source:{type:'torrent'},destination:{kind:'film'},status:'complete'}];renderStudioJobs()},film)
}
test('Activity card opens before slow details, ownership and device cache; no full library refresh',async({page},info)=>{
  await activity(page)
  let membership,metadata,libraryReads=0
  await page.route('**/api/library',route=>{libraryReads++;return route.abort()})
  await page.route('**/api/my-tv/local-title?**',route=>new Promise(resolve=>{membership=()=>route.fulfill({json:{films:[{path:'Arrival.mp4',name:'Arrival.mp4',metadata:film}],series:[]}}).then(resolve)}))
  await page.route('**/api/my-tv/title?**',route=>new Promise(resolve=>{metadata=()=>route.fulfill({json:{...film,overview:'Fresh detail',genres:[],providers:[],seasons:[],on_mabeltv:true}}).then(resolve)}))
  await page.evaluate(()=>{const read=readPortalDataCache;window.releaseTitleCache=null;readPortalDataCache=key=>key.startsWith('my-tv-title-v1:')?new Promise(resolve=>window.releaseTitleCache=()=>resolve(null)):read(key)})
  await page.getByRole('button',{name:'Open Arrival',exact:true}).click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleName')).toHaveText('Arrival')
  await expect(page.locator('#myTvTitleLocalCopy')).toHaveText('Checking Pi copy…')
  await expect(page.locator('#myTvTitleFilmActions')).toBeHidden()
  await page.screenshot({path:info.outputPath('activity-title-pending.png')})
  await expect.poll(()=>Boolean(membership&&metadata)).toBe(true)
  await membership()
  await expect(page.locator('#myTvTitleFilmActions')).toBeVisible()
  await metadata()
  await expect(page.locator('#myTvTitleOverview')).toHaveText('Fresh detail')
  await page.evaluate(()=>window.releaseTitleCache())
  expect(libraryReads).toBe(0)
})
test('fresh cloud-only membership clears stale playback and cannot be overwritten by cached metadata',async({page})=>{
  await activity(page)
  await page.evaluate(film=>{library.my_tv_library=[{path:'Gone.mp4',metadata:film}];const read=readPortalDataCache;readPortalDataCache=key=>key.startsWith('my-tv-title-v1:')?Promise.resolve({schema:1,data:{...film,on_mabeltv:true}}):read(key)},film)
  await page.route('**/api/my-tv/local-title?**',route=>route.fulfill({json:{films:[],series:[]}}))
  await page.route('**/api/my-tv/title?**',route=>route.fulfill({json:{...film,on_mabeltv:false,genres:[],providers:[],seasons:[]}}))
  await page.getByRole('button',{name:'Open Arrival',exact:true}).click()
  await expect(page.locator('#myTvTitleLocalCopy')).not.toHaveText('Checking Pi copy…')
  await expect(page.locator('#myTvTitleFilmActions')).toBeHidden()
  await expect(page.locator('#myTvTitleEyebrow')).not.toContainText('On ')
})
test('failed artwork search is retried on the next Activity tap',async({page})=>{
  await activity(page)
  let searches=0
  await page.route('**/api/my-tv/discovery?**',route=>{searches++;return searches<=2?route.abort():route.fulfill({json:{results:[film]}})})
  const result=await page.evaluate(async()=>{
    studioJobArtCache.clear()
    const job={title:'Arrival (2016)',source:{type:'torrent'},destination:{kind:'film'}}
    const first=await studioResolveJobTitle(job)
    const second=await studioResolveJobTitle(job)
    return [first,second?.tmdb_id]
  })
  expect(result).toEqual([null,film.tmdb_id]);expect(searches).toBe(3)
})
test('write failures are captured without retrying the action or retaining its body',async({page})=>{
  await activity(page)
  let writes=0,diagnostic
  await page.route('**/api/studio/diagnostics',route=>{diagnostic=route.request().postDataJSON();return route.fulfill({json:{ok:true}})})
  await page.route('**/api/studio/jobs',route=>{writes++;return route.fulfill({status:502,contentType:'text/html',body:'Bad gateway'})})
  const message=await page.evaluate(async()=>{try{await api('/api/studio/jobs',{method:'POST',body:JSON.stringify({secret:'never-log-this'})})}catch(e){return e.message}})
  await expect.poll(()=>diagnostic?.events?.length).toBeGreaterThan(0)
  expect(message).toContain('Connection to ');expect(writes).toBe(1)
  expect(JSON.stringify(diagnostic)).not.toContain('never-log-this')
  expect(diagnostic.events.at(-1)).toMatchObject({method:'POST',code:'502',path:'/api/studio/jobs'})
})
test('a temporary busy response recovers with one read retry and no action replay',async({page})=>{
  await activity(page)
  let reads=0
  await page.route('**/api/bootstrap',route=>++reads===1
    ?route.fulfill({status:503,headers:{'Retry-After':'1'},json:{code:'busy',error:'The Pi is busy.'}})
    :route.fulfill({json:{schema_version:12,revisions:{}}}))
  const result=await page.evaluate(()=>api('/api/bootstrap'))
  expect(result.schema_version).toBe(12);expect(reads).toBe(2)
})
