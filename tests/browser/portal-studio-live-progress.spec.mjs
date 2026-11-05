import { test, expect } from './test-fixtures.mjs'
import { openStudio } from './studio-fixtures.mjs'
import fs from 'node:fs'
test.use({ serviceWorkers: 'block' })

test('download progress retains its artwork and buttons while speed changes', async ({page}, info) => {
  await page.addInitScript(() => localStorage.setItem('mabeltv-experience-theme','light'))
  await openStudio(page)
  let searches = 0
  await page.route('**/api/my-tv/discovery?**', route => {
    searches++
    return route.fulfill({json:{results:[{title:'Raiders of the Lost Ark',year:'1981',media_type:'movie',tmdb_id:85,poster_path:'/explore-100.jpg'}]}})
  })
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.evaluate(() => {
    clearInterval(studioTimer)
    studioState.status.jobs = [{id:'indiana',title:'Indiana Jones and the Raiders of the Lost Ark (1981) 1080p BrRip',source:{type:'torrent'},destination:{kind:'film'},status:'active',stage:'downloading',percent:36,message:'Downloading · 5733 KB/s'}]
    renderStudioJobs()
  })
  const row=page.locator('[data-studio-job="indiana"]')
  await expect(row).toContainText('5733 KB/s')
  await expect(row.locator('img')).toHaveCount(1)
  await row.locator('img').evaluate(img => { window.retainedArtwork=img; window.retainedPause=img.closest('article').querySelector('button') })
  await page.evaluate(() => { Object.assign(studioState.status.jobs[0],{percent:37,message:'Downloading · 6230 KB/s'});renderStudioJobs() })
  await expect(row).toContainText('37%')
  await expect(row).toContainText('6230 KB/s')
  expect(await row.locator('img').evaluate(img => img === window.retainedArtwork)).toBe(true)
  expect(await row.getByRole('button',{name:'Pause',exact:true}).evaluate(button => button === window.retainedPause)).toBe(true)
  await page.evaluate(() => { studioState.status.jobs[0].message='Downloading · 0 KB/s';renderStudioJobs() })
  await expect(row).toContainText('0 KB/s')
  expect(searches).toBe(1)
  expect((await row.boundingBox()).height).toBeLessThan(130)
  await page.screenshot({path:info.outputPath('activity-speed-artwork.png'),animations:'disabled'})
  await page.evaluate(() => { Object.assign(studioState.status.jobs[0],{stage:'preparing',percent:5});renderStudioJobs() })
  await expect(row).not.toContainText('KB/s')
  await expect(row).toContainText('preparing for My TV')
})

test('Activity uses matched TV artwork',async({page})=>{
  await openStudio(page)
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.evaluate(()=>{
    studioState.status.jobs=[{id:'tv',title:'Ludwig S01E01',matchedTitle:{title:'Ludwig',media_type:'tv',poster_path:'/explore-101.jpg'},source:{type:'torrent'},destination:{kind:'series'},status:'active',stage:'downloading',percent:7,message:'Downloading · 500 KB/s'}]
    renderStudioJobs()
  })
  await expect(page.locator('[data-studio-job="tv"] img')).toHaveCount(1)
  await expect(page.locator('[data-studio-job="tv"]')).toContainText('500 KB/s')
})

test('System and help shows the loaded portal build, independent of server version', async({page})=>{
  await openStudio(page)
  await page.evaluate(()=>{library.system.version='development';renderStatus()})
  const release=fs.readFileSync('../../scripts/pi/service-worker.js','utf8').match(/const SHELL_RELEASE = '(\d+)'/)[1]
  await expect(page.locator('#systemDetails')).toContainText('Build '+release)
  await page.evaluate(()=>{library.system.version='a-newer-server-release';renderStatus()})
  await expect(page.locator('#systemDetails')).toContainText('Build '+release)
  await expect(page.locator('#systemDetails')).not.toContainText('a-newer-server-release')
})


test('ambiguous artwork stays generic without holding the download',async({page})=>{
  await openStudio(page)
  await page.route('**/api/my-tv/discovery?**',route=>route.fulfill({json:{results:[
    {title:'The Thing',year:'1982',media_type:'movie',poster_path:'/explore-100.jpg'},
    {title:'The Thing',year:'2011',media_type:'movie',poster_path:'/explore-101.jpg'}
  ]}}))
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.evaluate(async()=>{
    studioState.status.jobs=[{id:'ambiguous',title:'The Thing',source:{type:'torrent'},destination:{kind:'film'},status:'active',stage:'downloading',percent:12,message:'Downloading · 950 KB/s'}]
    renderStudioJobs()
    await Promise.all(studioJobArtCache.values())
  })
  const row=page.locator('[data-studio-job="ambiguous"]')
  await expect(row.locator('img')).toHaveCount(0)
  await expect(row).toContainText('950 KB/s')
  await expect(row).toContainText('12%')
  await expect(row.getByRole('button',{name:'Pause',exact:true})).toBeEnabled()
})

for (const [release,title,id] of [
 ['Deadpool.and.Wolverine.2024.1080p.AMZN.WEBRip','Deadpool & Wolverine',533535],
 ['Wallace & Gromit: A Grand Day Out','A Grand Day Out',530],
 ['Wallace & Gromit: The Wrong Trousers','The Wrong Trousers',531],
 ['Wallace & Gromit: A Close Shave','A Close Shave',532],
 ['Wallace & Gromit: A Matter of Loaf and Death','A Matter of Loaf and Death',14447]
]) test('Activity poster recognises '+title,async({page})=>{
 await openStudio(page)
 await page.route('**/api/my-tv/discovery?**',route=>route.fulfill({json:{results:[{title,tmdb_id:id,media_type:'movie',year:id===533535?'2024':'1990',poster_path:'/explore-100.jpg'}]}}))
 await page.getByRole('button',{name:'Activity',exact:true}).click()
 await page.evaluate(({release,id})=>{
  studioState.status.jobs=[{id:'poster',title:release,source:{type:id===533535?'torrent':'iplayer'},destination:{kind:id===533535?'film':'mabel'},status:'complete'}]
  renderStudioJobs()
 },{release,id})
 await expect(page.locator('[data-studio-job="poster"] img')).toHaveCount(1)
})

test('a pending file lock explains automatic retry without reporting a failed TV delivery',async({page})=>{
 await openStudio(page)
 await page.getByRole('button',{name:'Activity',exact:true}).click()
 await page.evaluate(()=>{
  studioState.status.jobs=[{id:'lock',title:'Film',source:{type:'torrent'},destination:{kind:'film'},status:'active',stage:'saving-cloud',percent:100,message:'1 of 1 · iCloud file is busy. Retrying automatically.'}]
  renderStudioJobs()
 })
 const row=page.locator('[data-studio-job="lock"]')
 await expect(row).toContainText('On My TV · saving to iCloud')
 await expect(row).toContainText('Retrying automatically.')
 await expect(row.locator('progress')).toHaveCount(0)
 await expect(row.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0)
 await expect(row.getByRole('button',{name:'Pause',exact:true})).toBeVisible()
})
