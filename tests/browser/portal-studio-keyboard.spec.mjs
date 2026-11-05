import { test, expect } from './test-fixtures.mjs'
import { openStudio } from './studio-fixtures.mjs'

test.use({ serviceWorkers:'block' })

test('new collection stays visible above an overlaid keyboard without shrinking the film card', async ({page}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('mabeltv-experience-theme','light')
    let height=innerHeight, top=0
    Object.defineProperties(visualViewport, {height:{get:()=>height},offsetTop:{get:()=>top}})
    window.studioTestKeyboard=(nextHeight, nextTop=0)=>{
      height=nextHeight;top=nextTop
      visualViewport.dispatchEvent(new Event('resize'))
      visualViewport.dispatchEvent(new Event('scroll'))
    }
  })
  const {writes}=await openStudio(page)
  await page.getByRole('button',{name:'Arrival',exact:true}).click()
  const sheet=page.locator('#studioDestinationSheet'), panel=sheet.locator('.watch-film-panel')
  const before=await panel.boundingBox()
  await page.locator('#studioTargetCollection').selectOption('__new__')
  const input=page.locator('#studioNewCollectionName'), create=page.locator('#studioCreateCollection')
  await expect(input).toBeFocused()
  await page.evaluate(()=>window.studioTestKeyboard(420))
  await expect(sheet).toHaveClass(/studio-keyboard-open/)
  await expect.poll(async()=>Math.round((await input.boundingBox()).y+(await input.boundingBox()).height)).toBeLessThanOrEqual(397)
  const after=await panel.boundingBox()
  expect(after.height).toBeCloseTo(before.height,0)
  expect(after.y).toBeCloseTo(before.y,0)
  expect((await create.boundingBox()).y+(await create.boundingBox()).height).toBeLessThanOrEqual(397)
  await input.fill('Island films')
  await page.evaluate(()=>window.studioTestKeyboard(380,40))
  await expect(input).toHaveValue('Island films')
  await expect.poll(async()=>Math.round((await input.boundingBox()).y+(await input.boundingBox()).height)).toBeLessThanOrEqual(397)
  // Draw only the occluded region for a visual proof; no OS keyboard is emulated.
  await page.addStyleTag({content:'#studioDestinationSheet::after {content:"Keyboard area (simulated)";position:fixed;inset:420px 0 0;background:#c5c7ce;color:#24272d;padding:24px;z-index:99;text-align:center;pointer-events:none;} '})
  await page.screenshot({path:info.outputPath('collection-keyboard.png'),animations:'disabled'})
  await create.click()
  await expect(page.locator('#studioTargetCollection')).toHaveValue('Island films')
  expect(writes.find(value=>value.path==='/api/studio/collections')).toMatchObject({name:'Island films',scope:'pi'})
  await page.evaluate(()=>window.studioTestKeyboard(innerHeight))
  await expect(sheet).not.toHaveClass(/studio-keyboard-open/)
  expect((await panel.boundingBox()).height).toBeCloseTo(before.height,0)
  await page.locator('#studioDestinationClose').click()
  await expect(sheet).not.toBeVisible()
})
