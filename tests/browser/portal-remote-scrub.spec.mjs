import {test,expect} from './test-fixtures.mjs'
test.use({serviceWorkers:'block'})

for(const myTv of [false,true]) test(`remote scrub seeks ${myTv?'My TV':'Mabel TV'} only on release and rejects stale programme`,async({page},info)=>{
  if(myTv)await page.addInitScript(()=>localStorage.setItem('mabeltv-experience-theme','light'))
  const state={available:true,standby:false,my_tv_mode:myTv,paused:false,seek_supported:true,
    seek_available:true,seek_token:'a'.repeat(64),playback_position:1245,playback_duration:7200,
    programme:'The Grinch',channel_number:6,channel_name:'Christmas films',subtitles_available:true,subtitles_visible:false}
  const commands=[]
  const previews=[]
  await page.route('**/api/live/seek-preview?**',route=>{
    previews.push(route.request().url())
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="135"><rect width="1920" height="135" fill="#3e6c70"/><path d="M0 135 L120 15 L240 135 Z" fill="#153b41"/><circle cx="160" cy="40" r="15" fill="#eedda9"/></svg>'})
  })
  await page.route('**/api/live',route=>route.fulfill({json:state}))
  await page.route('**/api/live/control',async route=>{
    const body=route.request().postDataJSON();commands.push(body)
    if(body.command==='seek')state.playback_position=body.position
    await route.fulfill({json:{ok:true}})
  })
  await page.goto('/#live')
  await page.evaluate(value=>renderRemoteState(value),state)
  await expect(page.locator('#remoteScrubOpen')).toBeEnabled()
  await expect(page.locator('#remoteScrubOpen')).toBeVisible()
  await expect(page.locator('#remoteKeyboard')).toHaveCount(0)
  await page.screenshot({path:info.outputPath(`remote-controls-${myTv?'mytv':'mabel'}.png`)})
  const before=await page.locator('#view-live .tv-remote-transport-row').boundingBox()
  await page.locator('#remoteScrubOpen').click()
  const range=page.locator('#remoteScrubRange')
  await expect(range).toBeVisible()
  await expect(page.locator('#remoteTransportButtons')).toBeHidden()
  await expect(page.locator('#remoteScrubDuration')).toHaveText('2:00:00')
  await expect(page.locator('#remoteScrubClock')).toContainText('Ends')
  expect(commands).toHaveLength(0)
  await range.evaluate(input=>{input.value='3200';input.dispatchEvent(new Event('input',{bubbles:true}))})
  await expect(page.locator('#remoteScrubPosition')).toHaveText('53:20')
  expect(commands).toHaveLength(0)
  await expect(page.locator('#remoteScrubPreviewImage')).toBeVisible()
  expect(await page.locator('#remoteScrubPreviewImage').evaluate(async node=>{
    const image=new Image();image.src=node.style.backgroundImage.slice(5,-2);await image.decode();return image.naturalWidth;
  })).toBe(1920)
  await expect(page.locator('#remoteScrubPreviewTime')).toHaveText('53:20')
  expect(previews.length).toBeGreaterThan(0)
  await page.screenshot({path:info.outputPath(`remote-preview-${myTv?'mytv':'mabel'}.png`)})
  await page.setViewportSize({width:340,height:740})
  for(const position of [0,7190]){
    await range.evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}))},position)
    const preview=await page.locator('#remoteScrubPreview').boundingBox()
    expect(preview.x).toBeGreaterThanOrEqual(0)
    expect(preview.x+preview.width).toBeLessThanOrEqual(340)
  }
  await page.screenshot({path:info.outputPath(`remote-preview-narrow-${myTv?'mytv':'mabel'}.png`)})
  await page.setViewportSize({width:393,height:852})
  await range.evaluate(input=>{input.value='3200';input.dispatchEvent(new Event('input',{bubbles:true}))})
  await range.dispatchEvent('change')
  await expect.poll(()=>commands.length).toBe(1)
  expect(commands[0]).toEqual({command:'seek',position:3200,token:'a'.repeat(64)})
  await expect(range).toBeEnabled()
  await expect(page.locator('#remoteScrubPreview')).toBeHidden()
  const after=await page.locator('#view-live .tv-remote-transport-row').boundingBox()
  expect(after.height).toBe(before.height)
  await page.screenshot({path:info.outputPath(`remote-scrub-${myTv?'mytv':'mabel'}.png`)})
  state.seek_token='b'.repeat(64);state.playback_position=0
  await page.evaluate(value=>renderRemoteState(value),state)
  await expect(page.locator('#remoteScrubPanel')).toBeHidden()
  await range.dispatchEvent('change')
  expect(commands).toHaveLength(1)
  state.paused=true
  await page.evaluate(value=>renderRemoteState(value),state)
  await page.locator('#remoteScrubOpen').click()
  await expect(page.locator('#remoteScrubClock')).toContainText('Paused')
  await page.locator('#remoteScrubClose').click()
  await expect(page.locator('#remoteTransportButtons')).toBeVisible()
  state.seek_available=false;state.standby=true
  await page.evaluate(value=>renderRemoteState(value),state)
  await expect(page.locator('#remoteScrubOpen')).toBeDisabled()
  expect(commands).toHaveLength(1)
})
