import {test,expect} from './test-fixtures.mjs'
import {openStudio} from './studio-fixtures.mjs'
test.use({serviceWorkers:'block'})

test('all search fields have one clear cross and Studio reuses the Home control style',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('mabeltv-experience-theme','light'))
  await openStudio(page)
  await page.getByRole('button',{name:'BBC iPlayer',exact:true}).click()
  await page.locator('#studioIplayerSearch').fill('Ludwig')
  const result=await page.evaluate(()=>{
    $('#homeFilmSearch').value='Arrival';MabelPortalUI.syncSearchFields()
    const style=id=>{const s=getComputedStyle(document.querySelector(id));return [s.width,s.height,s.borderRadius,s.backgroundColor,s.color]}
    return {missing:[...document.querySelectorAll('input[type="search"]')].filter(input=>input.closest('.portal-search').querySelectorAll('button[type="button"]').length!==1).map(input=>input.id),home:style('#homeFilmSearchClear'),studio:style('#studioIplayerSearchForm button')}
  })
  expect(result.missing).toEqual([]);expect(result.studio).toEqual(result.home)
  await expect(page.locator('#studioIplayerSearchForm button[type="submit"]')).toHaveCount(0)
  await page.screenshot({path:info.outputPath('iplayer-clear-light.png')})
})

test('iPlayer submits with Enter and clearing discards a delayed search response',async({page})=>{
  const {writes}=await openStudio(page)
  await page.getByRole('button',{name:'BBC iPlayer',exact:true}).click()
  let release
  await page.route('**/api/studio/iplayer',route=>new Promise(resolve=>{release=()=>route.fulfill({json:{id:'late',status:'complete',result:{items:[{pid:'m0000001',title:'Ludwig',series:1,episodeNumber:1}]}}}).then(resolve)}))
  await page.locator('#studioIplayerSearch').fill('Ludwig')
  await page.locator('#studioIplayerSearch').press('Enter')
  await expect.poll(()=>Boolean(release)).toBe(true)
  await page.locator('#studioIplayerSearchForm button').click()
  await expect(page.locator('#studioIplayerSearch')).toHaveValue('')
  await expect(page.locator('#studioIplayerSearch')).toBeFocused()
  await expect(page.locator('#studioIplayerSearchForm button')).toBeHidden()
  await release()
  await expect(page.locator('#studioIplayerGrid')).toContainText('Search BBC iPlayer')
  expect(await page.evaluate(()=>studioState.request)).toBe(null)
  expect(writes.filter(item=>item.path==='/api/studio/jobs')).toHaveLength(0)
})

test('Find anything can be cleared while loading and late results do not return',async({page})=>{
  await openStudio(page)
  await page.getByRole('button',{name:'Find anything',exact:true}).click()
  let release
  await page.route('**/api/studio/torrents/search',route=>new Promise(resolve=>{release=()=>route.fulfill({json:{id:'late',kind:'torrent-search',status:'complete',result:{items:[]}}}).then(resolve)}))
  await page.locator('#studioTorrentSearch').fill('Arrival')
  await page.locator('#studioTorrentSearch').press('Enter')
  await expect.poll(()=>Boolean(release)).toBe(true)
  await expect(page.locator('#studioTorrentSearchForm button')).toBeEnabled()
  await page.locator('#studioTorrentSearchForm button').click()
  await release()
  await expect(page.locator('#studioTorrentSearch')).toHaveValue('')
  await expect(page.locator('#studioTorrentResults')).toContainText('Find a film or series')
  await expect(page.locator('#studioTorrentResults .studio-spinner')).toHaveCount(0)
})

test('clearing completed torrent results restores the empty search layout',async({page})=>{
  await openStudio(page)
  await page.getByRole('button',{name:'Find anything',exact:true}).click()
  await page.route('**/api/studio/torrents/search',route=>route.fulfill({json:{id:'done',kind:'torrent-search',status:'complete',result:{items:[{hash:'test',title:'Arrival',bytes:1000,seeders:5}]}}}))
  await page.locator('#studioTorrentSearch').fill('Arrival')
  await page.locator('#studioTorrentSearch').press('Enter')
  await expect(page.locator('#studioTorrentResults')).toHaveClass(/has-results/)
  await page.locator('#studioTorrentSearchForm button').click()
  await expect(page.locator('#studioTorrentResults')).not.toHaveClass(/has-results/)
  await expect(page.locator('#studioTorrentResults')).toContainText('Find a film or series')
})

for(const [tab,input,form,endpoint] of [
  ['BBC iPlayer','studioIplayerSearch','studioIplayerSearchForm','iplayer'],
  ['Find anything','studioTorrentSearch','studioTorrentSearchForm','torrents/search']
]) test(`${tab} ignores a failed request after the search is cleared`,async({page})=>{
  await openStudio(page)
  await page.getByRole('button',{name:tab,exact:true}).click()
  let release
  await page.route(`**/api/studio/${endpoint}`,route=>new Promise(resolve=>{release=()=>route.fulfill({status:500,json:{error:'Search failed'}}).then(resolve)}))
  await page.locator('#'+input).fill('Arrival')
  await page.locator('#'+input).press('Enter')
  await expect.poll(()=>Boolean(release)).toBe(true)
  await page.locator(`#${form} button`).click()
  await release()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#'+input)).toHaveValue('')
  await expect(page.locator('#studioError')).toBeHidden()
})

test('cloud filtering clears back to the catalogue and title-match Enter never submits a download',async({page})=>{
  const {writes}=await openStudio(page)
  await page.locator('#studioCloudSearch').fill('Arrival')
  await expect(page.locator('.studio-file')).toHaveCount(1)
  await page.locator('#studioCloudSearch').locator('..').getByRole('button').click()
  await expect(page.locator('.studio-file')).toHaveCount(9)
  await page.evaluate(()=>openStudioDestination([{type:'iplayer',pid:'m0000001',title:'Ludwig'}]))
  await page.evaluate(()=>$('#studioMatchSection').classList.remove('hidden'))
  await page.locator('#studioMatchQuery').fill('Ludwig')
  await page.locator('#studioMatchQuery').press('Enter')
  expect(writes.filter(item=>item.path==='/api/studio/jobs')).toHaveLength(0)
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
})
