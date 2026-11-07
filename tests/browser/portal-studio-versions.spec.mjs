import {test,expect} from './test-fixtures.mjs'
import {openStudio} from './studio-fixtures.mjs'

test.use({serviceWorkers:'block'})

test('version deletion selects only the requested file and keeps both unselected initially',async({page},info)=>{
  const {writes}=await openStudio(page)
  await page.evaluate(()=>{
    const film=studioState.items.find(item=>item.title==='Arrival')
    film.versions=[{...film,bytes:18*1024**3},{...film,id:'smaller',name:'Arrival smaller.mp4',bytes:2*1024**3}]
    renderStudioCloud()
  })
  await page.getByRole('button',{name:'Arrival',exact:true}).click()
  await expect(page.getByLabel('iCloud version')).toBeVisible()
  await page.locator('#studioDestinationMore').click()
  await page.locator('#studioDestinationDelete').click()
  await expect(page.locator('#studioCloudDeleteNames input')).toHaveCount(2)
  await expect(page.locator('#studioCloudDeleteConfirm')).toBeDisabled()
  await page.locator('#studioCloudDeleteNames input').first().check()
  await page.screenshot({path:info.outputPath('delete-one-version.png')})
  await page.locator('#studioCloudDeleteConfirm').click()
  const request=writes.find(write=>write.path==='/api/studio/cloud/operation')
  expect(request.items).toHaveLength(1)
  expect(request.items[0].bytes).toBe(18*1024**3)
})

test('already-owned copy offers keep replace and both with its frozen identity',async({page},info)=>{
  const {writes}=await openStudio(page)
  await page.route('**/api/studio/presence',route=>route.fulfill({json:{items:route.request().postDataJSON().ids.map(id=>({id,copies:[{key:'existing',name:'Arrival - different copy.mp4',bytes:2*1024**3,location:'My TV',fingerprint:[123,'1794070000000000123','7']}]}))}}))
  await page.getByRole('button',{name:'Arrival',exact:true}).click()
  await expect(page.locator('#studioVersions')).toContainText('Already on your Pi')
  await page.getByLabel('Existing TV copy action').selectOption('alongside')
  await page.screenshot({path:info.outputPath('existing-pi-copy.png')})
  await page.locator('#studioDestinationSubmit').click()
  await expect(page.locator('#studioDestinationSheet')).toBeHidden()
  expect(writes.find(write=>write.path==='/api/studio/jobs').sources[0].existingCopy).toEqual({key:'existing',mode:'alongside',fingerprint:[123,'1794070000000000123','7']})
})

test('subtitle alternatives can be selected searched and downloaded without a TV playback command',async({page},info)=>{
  const {writes}=await openStudio(page)
  let selected='included'
  const tracks=[{id:'included',label:'Included with download',origin:'included'},{id:'other',label:'Theatrical release',origin:'downloaded'}]
  await page.route('**/api/studio/subtitles/*',async route=>{
    const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();writes.push({path,...body})
    if(path.endsWith('/search'))return route.fulfill({json:{results:[{id:'44',label:'Arrival BluRay 23.976',fps:23.976}]}})
    if(path.endsWith('/select'))selected=body.track
    if(path.endsWith('/download')){selected='new';tracks.push({id:'new',label:'Arrival BluRay 23.976',origin:'downloaded'})}
    return route.fulfill({json:{configured:true,selected,tracks,fingerprint:[123,'12345678901234567','8']}})
  })
  await page.getByRole('button',{name:'Arrival',exact:true}).click()
  await page.locator('#studioDestinationMore').click()
  await page.locator('#studioActionsSheet [data-subtitle-options]').click()
  await expect(page.locator('#subtitleTracks')).toContainText('Included with download')
  await page.locator('#subtitleTracks input[value="other"]').check()
  await expect(page.locator('#subtitleMessage')).toContainText('Saved')
  await page.locator('#subtitleQuery').fill('Arrival BluRay')
  await page.locator('#subtitleQuery').press('Enter')
  await page.locator('#subtitleResults button').click()
  await expect(page.locator('#subtitleTracks')).toContainText('Arrival BluRay 23.976')
  await page.screenshot({path:info.outputPath('subtitle-options.png')})
  expect(writes.some(write=>/play-on-tv|live\/control|lg-tv/.test(write.path))).toBe(false)
})
