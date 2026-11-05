import { test, expect } from './test-fixtures.mjs'
import { openStudio } from './studio-fixtures.mjs'
test.use({ serviceWorkers: 'block' })

test('Activity replaces a release name when its canonical match arrives', async ({ page }) => {
  const { jobs } = await openStudio(page)
  jobs.push({ id: 'named', title: 'The.Matrix.1999.1080p.BrRip.x264.YIFY', source: {type:'torrent'},
    status:'complete', destination:{kind:'film'}, created:10 })
  await page.getByRole('button', { name:'Activity', exact:true }).click()
  const row = page.locator('[data-studio-job="named"]')
  await expect(row).toBeVisible()
  jobs[0].matchedTitle = {title:'The Matrix',tmdb_id:603,media_type:'movie',year:'1999'}
  await page.getByRole('button', { name:'BBC iPlayer', exact:true }).click()
  await page.getByRole('button', { name:'Activity', exact:true }).click()
  await expect(row.locator('strong')).toHaveText('The Matrix')
})
test('Activity stays compact and displays an error once', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('mabeltv-experience-theme', 'light'))
  const { jobs } = await openStudio(page)
  jobs.push({id:'matrix',title:'The Matrix',status:'failed',error:'Download could not finish.',destination:{kind:'film',label:'My TV films'},created:10},
    {id:'done',title:'Arrival',status:'complete',message:'Saved to iCloud and available on TV',destination:{kind:'film',label:'My TV films'},created:9})
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.locator('#studioJobs details')).toHaveCount(0)
  await expect(page.locator('[data-studio-job="matrix"]')).toContainText('Download could not finish.')
  expect((await page.locator('[data-studio-job="matrix"]').innerText()).match(/Download could not finish\./g)).toHaveLength(1)
  expect((await page.locator('[data-studio-job="matrix"]').boundingBox()).height).toBeLessThan(155)
  expect((await page.locator('[data-studio-job="done"]').boundingBox()).height).toBeLessThan(85)
  await page.screenshot({ animations: 'disabled', path: info.outputPath('activity-light.png') })
  await page.evaluate(() => window.MabelExperienceTheme.set('dark'))
  await page.screenshot({ animations: 'disabled', path: info.outputPath('activity-dark.png') })
  await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click()
  await expect(page.locator('#studioIplayerRefresh')).toHaveCount(0)
})

test('a downloaded compressed file can continue to TV without approving further compression', async ({ page }, info) => {
  const { jobs, writes } = await openStudio(page)
  jobs.push({ id: 'review', title: 'The Matrix', status: 'failed', errorCode: 'QUALITY_REVIEW', error: 'Confirm compression or keep the existing copy.', destination: {kind: 'film', label: 'My TV films'} })
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  const row = page.locator('[data-studio-job="review"]')
  await expect(row).toContainText('not yet on TV')
  await expect(row.getByRole('button', { name: 'Compress anyway', exact: true })).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  expect((await row.boundingBox()).height).toBeLessThan(155)
  await page.screenshot({animations:'disabled',path:info.outputPath('downloaded-before-delivery.png')})
  await row.getByRole('button', { name: 'Continue to My TV', exact: true }).click()
  expect(writes.find(write => write.path === '/api/studio/action')).toEqual({path:'/api/studio/action',id:'review',action:'resume'})
})

test('an explicit cloud recompression still asks for consent and cancellation preserves the file', async ({page}) => {
 const {jobs,writes}=await openStudio(page)
 jobs.push({id:'review',title:'Existing film',status:'failed',errorCode:'QUALITY_REVIEW',destination:{kind:'icloud',optimiseCloud:true}})
 await page.getByRole('button',{name:'Activity',exact:true}).click()
 const row=page.locator('[data-studio-job="review"]')
 await expect(row).toContainText('Already in iCloud')
 await row.getByRole('button',{name:'Compress anyway',exact:true}).click()
 await expect(page.locator('#portalConfirmationSheet')).toBeVisible()
 await page.locator('#portalConfirmationCancel').click()
 expect(writes.some(write=>write.path==='/api/studio/action')).toBe(false)
})
