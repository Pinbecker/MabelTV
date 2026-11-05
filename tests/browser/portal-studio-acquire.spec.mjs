import {test, expect} from './test-fixtures.mjs'
import {openStudio} from './studio-fixtures.mjs'

test.use({serviceWorkers: 'block'})
const film = {title:'Arrival', media_type:'movie', tmdb_id:329865, year:'2016', runtime:116, poster_path:'/explore-100.jpg'}
const show = {title:'Ludwig', media_type:'tv', tmdb_id:96724, year:'2024', seasons:[]}
async function titleRoutes(page, title, cloudOwned = false) {
  await page.route('**/api/studio/cloud?**', route => new URL(route.request().url()).searchParams.has('tmdb_id')
    ? route.fulfill({json:{items:cloudOwned?[{metadata:title}]:[], total:cloudOwned?1:0}}) : route.fallback())
  await page.route('**/api/my-tv/title?**', route => route.fulfill({json:{...title,on_mabeltv:false,genres:[],providers:[],seasons:[]}}))
  await page.evaluate(async title => {library.my_tv_library=[];library.my_tv_series=[];await openMyTvTitle(title)}, title)
}

test('cloud to TV offers Compatibility only and submits compatibility intent',async({page})=>{
  const {writes}=await openStudio(page)
  await page.getByRole('button',{name:'Arrival',exact:true}).click()
  await page.locator('#studioCompression').selectOption('compatible')
  await page.locator('#studioCloudCopiesField label').filter({hasText:/^Original$/}).click()
  await page.locator('#studioDestinationSubmit').click()
  await expect.poll(()=>writes.find(write=>write.path==='/api/studio/jobs')).toBeTruthy()
  const job=writes.find(write=>write.path==='/api/studio/jobs')
  expect(job.destination.preparationIntent).toBe('compatible')
  expect(job.destination.compression).toBe('compact') // Normal profile field; intent controls the actual preparation route.
  await page.evaluate(()=>openStudioDestination([{type:'iplayer',title:'A programme',pid:'m0000001'}]))
  await expect(page.locator('#studioCompression option[value="compatible"]')).toHaveCount(0)
})

test('Get searches both sources without changing the visible iPlayer search',async({page},info)=>{
  await openStudio(page)
  let torrentQuery='', bbcQuery=''
  await page.route('**/api/studio/torrents/search',route=>{torrentQuery=route.request().postDataJSON().query;return route.fulfill({json:{id:'torrent',kind:'torrent-search',status:'complete',result:{items:[]}}})})
  await page.route('**/api/studio/iplayer',route=>{bbcQuery=route.request().postDataJSON().query;return route.fulfill({json:{id:'bbc',status:'complete',result:{items:[{pid:'m0000001',title:'Ludwig',series:1,episodeNumber:1}]}}})})
  await page.evaluate(()=>$('#studioIplayerSearch').value='Keep this search')
  await titleRoutes(page,show)
  await page.getByRole('button',{name:'Get this title',exact:true}).click()
  await expect(page.locator('#studioTorrentSearch')).toHaveValue('Ludwig')
  await expect(page.locator('#studioIplayerOffer')).toBeVisible()
  expect(torrentQuery).toBe('Ludwig');expect(bbcQuery).toBe('Ludwig')
  await expect(page.locator('#studioIplayerSearch')).toHaveValue('Keep this search')
  await page.screenshot({path:info.outputPath('iplayer-match.png'),animations:'disabled'})
  await page.locator('#studioIplayerOfferDismiss').click()
  await expect(page.locator('#studioTorrentResults')).toContainText('No results found')
  await expect(page.locator('#studioTorrentSearch')).toHaveValue('Ludwig')
})

test('iPlayer match uses the existing episode and destination flow',async({page})=>{
  await openStudio(page,{online:true})
  await page.route('**/api/studio/torrents/search',route=>route.fulfill({json:{id:'torrent',kind:'torrent-search',status:'complete',result:{items:[]}}}))
  await titleRoutes(page,show)
  await page.getByRole('button',{name:'Get this title'}).click()
  await page.locator('#studioIplayerOfferDownload').click()
  await expect(page.locator('#studioEpisodesSheet')).toBeVisible()
  await page.locator('#studioEpisodes input[type="checkbox"]').first().check()
  await page.locator('#studioEpisodesContinue').click()
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  await expect(page.locator('#studioLibraryType')).toHaveValue('series')
})

test('Get stays hidden for a cloud-owned title',async({page})=>{
  await openStudio(page);await titleRoutes(page,film,true)
  await expect(page.locator('#myTvTitleGet')).toBeHidden()
})

test('uncertain iPlayer titles and remakes are not offered',async({page})=>{
  await openStudio(page)
  const matches=await page.evaluate(film=>[
    studioConfidentIplayerItems(film,[{pid:'m0000001',title:'Arrival',duration:6960,synopsis:'A different film from 1996'}]).length,
    studioConfidentIplayerItems(film,[{pid:'m0000001',title:'Arrival: Behind the scenes',duration:6960,synopsis:'2016'}]).length,
    studioConfidentIplayerItems(film,[{pid:'m0000001',title:'Arrival',duration:6960,synopsis:'Science fiction film (2016)'}]).length,
    studioConfidentIplayerItems({title:'Ludwig',media_type:'tv'},[{pid:'m0000001',title:'Ludwig',series:null,episodeNumber:null}]).length,
  ],film)
  expect(matches).toEqual([0,0,1,0])
})

for(const early of [false,true]) test(`Office Christmas Party offers the exact BBC film without a year in its synopsis${early?' from an early Get tap':''}`,async({page})=>{
 await openStudio(page)
 const title={title:'Office Christmas Party',media_type:'movie',tmdb_id:384682,year:'2016',runtime:105,poster_path:'/explore-100.jpg'}
 await page.route('**/api/studio/torrents/search',route=>route.fulfill({json:{id:'torrent',kind:'torrent-search',status:'complete',result:{items:[]}}}))
 await page.route('**/api/studio/iplayer',route=>route.fulfill({json:{id:'bbc-office',status:'complete',result:{items:[{
  pid:'m0033ttb',title:'Office Christmas Party',episode:'',channel:'BBC One',duration:6000,series:null,episodeNumber:null,
  synopsis:'A bank manager throws an epic Christmas party to land a big client and save his branch.'}]}}}))
 await page.route('**/api/my-tv/title?**',route=>route.fulfill({json:{...title,on_mabeltv:false,genres:[],providers:[]}}))
 await page.evaluate(()=>$('#studioIplayerSearch').value='Keep my iPlayer search')
 if(early) await page.evaluate(title=>studioGetTitle({...title,runtime:undefined}),title)
 else {await titleRoutes(page,title);await page.getByRole('button',{name:'Get this title',exact:true}).click()}
 await expect(page.locator('#studioIplayerOffer')).toBeVisible()
 await expect(page.locator('#studioIplayerOfferTitle')).toHaveText(title.title)
 await expect(page.locator('#studioTorrentSearch')).toHaveValue(title.title)
 await expect(page.locator('#studioIplayerSearch')).toHaveValue('Keep my iPlayer search')
})

test('iPlayer confidence rejects wrong runtimes, structured remake years and ambiguous exact films',async({page})=>{
 await openStudio(page)
 const values=await page.evaluate(()=>{
  const title={title:'Office Christmas Party',media_type:'movie',year:'2016',runtime:105}
  const film={pid:'m0033ttb',title:title.title,series:null,duration:6000}
  return [studioConfidentIplayerItems(title,[{...film,duration:900}]).length,
   studioConfidentIplayerItems(title,[{...film,year:1996}]).length,
   studioConfidentIplayerItems(title,[film,{...film,pid:'m0000001'}]).length]
 })
 expect(values).toEqual([0,0,0])
})

test('a delayed iPlayer match cannot interrupt a different query or navigation',async({page})=>{
  await openStudio(page)
  await titleRoutes(page,show)
  await page.route('**/api/studio/iplayer',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({json:{id:'late',status:'complete',result:{items:[{pid:'m0000001',title:'Ludwig',series:1,episodeNumber:1}]}}})})
  await page.getByRole('button',{name:'Get this title'}).click()
  await page.locator('#studioTorrentSearch').fill('Another query')
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.waitForTimeout(700)
  await expect(page.locator('#studioIplayerOffer')).toBeHidden()
  await expect(page.locator('#studioTorrentSearch')).toHaveValue('Another query')
})

for(const onPi of [true,false]) test('Activity opens a fresh '+(onPi?'playable':'cloud-only')+' title card',async({page})=>{
  await openStudio(page)
  const fresh=await page.evaluate(()=>library)
  fresh.my_tv_library=onPi?[{name:'Arrival.mp4',path:'Arrival.mp4',bytes:100,metadata:film}]:[]
  fresh.my_tv_series=[]
  await page.route('**/api/my-tv/local-title?**',route=>route.fulfill({json:{films:fresh.my_tv_library,series:[]}}))
  await page.route('**/api/my-tv/title?**',route=>route.fulfill({json:{...film,on_mabeltv:onPi,local:onPi?{kind:'film',path:'Arrival.mp4'}:null,genres:[],seasons:[],providers:[]}}))
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.evaluate(film=>{clearInterval(studioTimer);library.my_tv_library=[];studioState.status.jobs=[{id:'done',title:film.title,matchedTitle:film,source:{type:'torrent'},destination:{kind:'film'},status:'complete'}];renderStudioJobs()},film)
  await page.getByRole('button',{name:'Open Arrival',exact:true}).click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleName')).toHaveText('Arrival')
  if(onPi) await expect(page.locator('#myTvTitleFilmActions')).toBeVisible()
  else await expect(page.locator('#myTvTitleFilmActions')).toBeHidden()
})
