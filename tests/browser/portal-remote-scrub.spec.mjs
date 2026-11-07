import {test,expect} from './test-fixtures.mjs'
test.use({serviceWorkers:'block'})

test('prewarmed previews paint immediately across the programme and survive closing Scrub',async({page},info)=>{
  const state={available:true,standby:false,paused:false,seek_supported:true,seek_available:true,
    seek_token:'d'.repeat(64),playback_position:90,playback_duration:640,programme:'The Grinch'}
  const requests=[],commands=[]
  await page.route('**/api/live',route=>route.fulfill({json:state}))
  await page.route('**/api/live/control',route=>{commands.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}})})
  await page.route('**/api/live/seek-preview?**',route=>{
    requests.push(route.request().url())
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="144"><rect width="2048" height="144" fill="#526e56"/></svg>'})
  })
  await page.goto('/#live');await page.evaluate(value=>renderRemoteState(value),state)
  await expect.poll(()=>page.evaluate(()=>scrubPreview.cache.size)).toBe(8)
  expect(requests.every(url=>new URL(url).searchParams.get('warm')==='1')).toBe(true)
  const warmed=requests.length
  await page.locator('#remoteScrubOpen').click()
  for(const position of [0,90,330,630]){
    const immediate=await page.locator('#remoteScrubRange').evaluate((input,value)=>{
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}))
      return !document.querySelector('#remoteScrubPreviewImage').classList.contains('hidden')
        && document.querySelector('#remoteScrubPreviewMessage').classList.contains('hidden')
    },position)
    expect(immediate).toBe(true)
  }
  expect(requests).toHaveLength(warmed)
  expect(commands).toHaveLength(0)
  await page.locator('#remoteScrubClose').click();await page.locator('#remoteScrubOpen').click()
  await page.setViewportSize({width:340,height:740})
  const row=await page.locator('.tv-remote-transport-row:visible').boundingBox()
  expect(row.height).toBe(70)
  expect(await page.locator('.remote-scrub-limits').count()).toBe(0)
  const elapsed=await page.locator('.remote-scrub-elapsed').boundingBox(),clock=await page.locator('#remoteScrubClock').boundingBox()
  expect(elapsed.x+elapsed.width+4).toBeLessThanOrEqual(clock.x)
  expect(await page.locator('#remoteScrubClock').textContent()).toMatch(/^Ends /)
  await page.screenshot({path:info.outputPath('scrub-clean-times-narrow.png')})
  expect(requests).toHaveLength(warmed)
})

test('a stalled preview request times out and recovers without another gesture',async({page})=>{
  // Exercise the real 18-second network deadline plus its retry, not a larger app timeout.
  test.setTimeout(45000)
  const state={available:true,standby:false,paused:true,seek_supported:true,seek_available:true,
    seek_token:'e'.repeat(64),playback_position:20,playback_duration:60,programme:'The Grinch'}
  let stalled=true
  await page.route('**/api/live',route=>route.fulfill({json:state}))
  await page.route('**/api/live/seek-preview?**',route=>{
    if(stalled)return
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="144"><rect width="2048" height="144" fill="#526e56"/></svg>'})
  })
  await page.goto('/#live');await page.evaluate(value=>renderRemoteState(value),state)
  await page.locator('#remoteScrubOpen').click()
  await page.locator('#remoteScrubRange').evaluate(input=>{input.value='20';input.dispatchEvent(new Event('input',{bubbles:true}))})
  await expect(page.locator('#remoteScrubPreviewMessage')).toHaveText('Preview unavailable',{timeout:21000})
  stalled=false
  await expect(page.locator('#remoteScrubPreviewImage')).toBeVisible({timeout:9000})
  await expect(page.locator('#remoteScrubPreviewMessage')).toBeHidden()
})

for(const myTv of [false,true]) test(`scrub cancels upward and resumes when returned to the bar in ${myTv?'My TV':'Mabel TV'}`,async({page},info)=>{
  const state={available:true,standby:false,my_tv_mode:myTv,paused:true,seek_supported:true,
    seek_available:true,seek_token:'c'.repeat(64),playback_position:900,playback_duration:7200,programme:'The Grinch'}
  const commands=[]
  await page.route('**/api/live',route=>route.fulfill({json:state}))
  await page.route('**/api/live/seek-preview?**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="144"><rect width="2048" height="144" fill="#3e6c70"/></svg>'}))
  await page.route('**/api/live/control',async route=>{
    const body=route.request().postDataJSON();commands.push(body);state.playback_position=body.position
    await route.fulfill({json:{ok:true}})
  })
  await page.goto('/#live');await page.evaluate(value=>renderRemoteState(value),state)
  await page.locator('#remoteScrubOpen').click()
  const range=page.locator('#remoteScrubRange'),box=await range.boundingBox(),y=box.y+box.height/2
  const start=async()=>{await page.mouse.move(box.x+box.width*.2,y);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,y,{steps:3})}
  await start();expect(commands).toHaveLength(0)
  await page.mouse.move(box.x+box.width*.7,y-110,{steps:3})
  await expect(page.locator('#remoteScrubCancelHint')).toBeVisible()
  await expect(page.locator('#remoteScrubClock')).toHaveText('Release to cancel')
  await page.screenshot({path:info.outputPath(`scrub-cancel-${myTv?'mytv':'mabel'}.png`)})
  await page.mouse.up()
  await expect(range).toHaveValue('900')
  await expect(page.locator('#remoteScrubPreview')).toBeHidden()
  expect(commands).toHaveLength(0)
  // A second drag can leave the bar, return, then commit once on release.
  await start();await page.mouse.move(box.x+box.width*.7,y-110,{steps:3})
  await page.mouse.move(box.x+box.width*.7,y,{steps:3})
  await expect(page.locator('#remoteScrubCancelHint')).toBeHidden()
  await page.mouse.up()
  await expect.poll(()=>commands.length).toBe(1)
  expect(commands[0].position).toBeGreaterThan(4000)
  await expect(range).toBeEnabled()
  // An interrupted touch must never fall through to the native change event.
  await start();await range.dispatchEvent('pointercancel');await page.mouse.up()
  expect(commands).toHaveLength(1)
  // Closing while another finger is dragging cancels without seeking.
  await start();await page.locator('#remoteScrubClose').evaluate(button=>button.click());await page.mouse.up()
  await expect(page.locator('#remoteScrubPanel')).toBeHidden()
  expect(commands).toHaveLength(1)
})

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
  // Change the server's programme and let the normal status poll deliver it.
  // Calling the renderer directly could race an already-in-flight old response.
  state.seek_token='b'.repeat(64);state.playback_position=0;state.paused=true
  await expect(page.locator('#remoteScrubPanel')).toBeHidden()
  await range.dispatchEvent('change')
  expect(commands).toHaveLength(1)
  await page.locator('#remoteScrubOpen').click()
  await expect(page.locator('#remoteScrubClock')).toContainText('Paused')
  await page.locator('#remoteScrubClose').click()
  await expect(page.locator('#remoteTransportButtons')).toBeVisible()
  state.seek_available=false;state.standby=true
  await expect(page.locator('#remoteScrubOpen')).toBeDisabled()
  expect(commands).toHaveLength(1)
})
