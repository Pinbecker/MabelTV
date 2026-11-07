import {test,expect} from './test-fixtures.mjs'
test.use({serviceWorkers:'block'})

test('Pi bin shows space and deletes only its confirmed snapshot without a TV command',async({page},info)=>{
  if(info.project.name==='iphone-chromium')await page.addInitScript(()=>localStorage.setItem('mabeltv-experience-theme','light'))
  let items=[{id:'12345678-abcdef01',display_name:'Old film copy',channel_name:'My TV',bytes:3*1024**3,fingerprint:'111111'}]
  const writes=[]
  await page.route('**/api/library',async route=>{
    const response=await route.fetch(),data=await response.json()
    await route.fulfill({json:{...data,recycle:items}})
  })
  await page.route('**/api/manage',async route=>{
    const body=route.request().postDataJSON();writes.push(body)
    if(body.action==='empty-bin')items=[]
    await route.fulfill({json:{ok:true,refreshed:true}})
  })
  await page.goto('/#settings/help')
  await page.locator('#settingsRecycleBin').click()
  await expect(page.locator('#bin')).toContainText('Old film copy')
  await expect(page.locator('#recycleSummary')).toContainText('3.0 GB')
  await page.screenshot({path:info.outputPath('pi-bin.png')})
  await page.locator('#emptyRecycleBin').click()
  await expect(page.getByText('Empty the Pi bin?',{exact:true})).toBeVisible()
  expect(writes).toHaveLength(0)
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click()
  await page.locator('#emptyRecycleBin').click()
  await page.getByRole('button',{name:'Empty bin',exact:true}).last().click()
  await expect(page.locator('#bin')).toContainText('Nothing in the recycle bin')
  expect(writes).toEqual([{action:'empty-bin',confirmed:true,items:[{id:'12345678-abcdef01',bytes:3*1024**3,fingerprint:'111111'}]}])
  await expect(page.locator('#emptyRecycleBin')).toBeDisabled()
})
