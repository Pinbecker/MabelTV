import {test,expect} from './test-fixtures.mjs'
import {openStudio} from './studio-fixtures.mjs'
test.use({serviceWorkers:'block'})

test('cloud selection, selection ticks and sorting keep the same poster elements',async({page})=>{
 await openStudio(page)
 await page.evaluate(()=>{window.posters=new Map([...document.querySelectorAll('[data-cloud-id]')].map(row=>[row.dataset.cloudId,row.querySelector('img')]))})
 await page.locator('#studioCloudSelect').click()
 await page.getByRole('button',{name:'Arrival',exact:true}).click()
 await expect(page.getByRole('button',{name:'Arrival',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.evaluate(()=>{studioState.items.reverse();renderStudioCloud()})
 expect(await page.evaluate(()=>[...document.querySelectorAll('[data-cloud-id]')].every(row=>row.querySelector('img')===window.posters.get(row.dataset.cloudId)))).toBe(true)
 await page.locator('#studioCloudSelect').click()
 await expect(page.locator('.studio-file-tick:not(.hidden)')).toHaveCount(0)
 expect(await page.evaluate(()=>[...document.querySelectorAll('[data-cloud-id]')].every(row=>row.querySelector('img')===window.posters.get(row.dataset.cloudId)))).toBe(true)
})

test('provider refreshes and film-card updates retain loaded images',async({page})=>{
 await openStudio(page)
 const result=await page.evaluate(()=>{
  const title={title:'Arrival',media_type:'movie',tmdb_id:329865,year:'2016',poster_path:'/explore-100.jpg',providers:[{provider_id:8,name:'Netflix',type:'flatrate'}]}
  myTvProviderSummaries['movie:329865']={providers:title.providers,sources:[],checked:Date.now()}
  const host=document.createElement('span');document.body.append(host);renderMyTvProviderBadges(host,title)
  const logo=host.querySelector('img'),strip=host.firstChild
  for(let i=0;i<20;i++)refreshMyTvProviderBadges()
  const sameBadge=host.querySelector('img')===logo&&host.firstChild===strip
  renderMyTvTitleDetail(title,false);const poster=$('#myTvTitlePoster img')
  for(let i=0;i<5;i++)renderMyTvTitleDetail({...title},false)
  return {sameBadge,samePoster:poster===$('#myTvTitlePoster img')}
 })
 expect(result).toEqual({sameBadge:true,samePoster:true})
})

test('Activity uses existing local Matrix artwork immediately without title searches',async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('mabeltv-experience-theme','light'))
 await openStudio(page)
 let searches=0
 const actions=[]
 await page.route('**/api/studio/action',route=>{actions.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}})})
 await page.route('**/api/my-tv/artwork/tmdb-603.jpg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#164e37"/><text x="50" y="80" text-anchor="middle" fill="white">MATRIX</text></svg>'}))
 await page.route('**/api/my-tv/discovery?**',route=>{searches++;return route.fulfill({json:{results:[]}})})
 await page.getByRole('button',{name:'Activity',exact:true}).click()
 await page.evaluate(()=>{
  clearInterval(studioTimer)
  library.my_tv_library=[{name:'The Matrix (1999).mp4',path:'The Matrix (1999).mp4',metadata:{tmdb_id:603,title:'The Matrix',year:'1999',poster:'tmdb-603.jpg'}}]
  studioState.status.jobs=[{id:'matrix',title:'The Matrix (1999) 1080p BrRip',source:{type:'torrent'},destination:{kind:'film'},status:'complete',stage:'complete',created:1,updated:1,
   matchedTitle:{tmdb_id:603,media_type:'movie',title:'The Matrix',year:'1999'},result:{complete:true,kind:'my_tv',file_name:'The Matrix (1999).mp4'}}]
  renderStudioJobs();window.matrixImage=document.querySelector('[data-studio-job="matrix"] img')
 })
 const row=page.locator('[data-studio-job="matrix"]')
 await expect(row.locator('img')).toHaveAttribute('src','/api/my-tv/artwork/tmdb-603.jpg')
 await expect.poll(()=>row.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0)
 await page.screenshot({path:info.outputPath('activity-history-closed.png')})
 await page.evaluate(()=>renderStudioJobs())
 expect(await row.locator('img').evaluate(img=>img===window.matrixImage)).toBe(true)
 expect(searches).toBe(0)
 const surface=row.locator('.studio-job-surface'),box=await surface.boundingBox()
 await page.mouse.move(box.x+box.width-25,box.y+20);await page.mouse.down()
 await page.mouse.move(box.x+box.width-125,box.y+20,{steps:8});await page.mouse.up()
 await expect(row).toHaveClass(/history-open/)
 await expect(page.locator('#myTvTitleSheet')).toBeHidden()
 await page.screenshot({path:info.outputPath('activity-history-swipe.png')})
 await row.getByRole('button',{name:'Remove The Matrix from Activity'}).click()
 await expect(row).toHaveCount(0)
 expect(actions).toEqual([{id:'matrix',action:'dismiss'}])
 expect(await page.evaluate(()=>library.my_tv_library[0].path)).toBe('The Matrix (1999).mp4')
})
