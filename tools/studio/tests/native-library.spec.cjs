'use strict';
const {test,expect,_electron:electron}=require('@playwright/test');
const path=require('node:path');
const {fixture,id}=require('./native-library-fixture.cjs');
async function launch() {
  const f=await fixture(),env={...process.env,STUDIO_TEST_DATA:f.root};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve(__dirname,'..')],env});const page=await app.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://image.tmdb.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="342" height="513" fill="#496c61"/><circle cx="171" cy="200" r="70" fill="#acc0a2"/></svg>'}));
  await expect(page.locator('#connection-label')).toContainText('Connected');
  return {...f,app,page,errors,close:async()=>{await app.close();await f.close();}};
}
test('iCloud library is native, preserves artwork on selection and sends a frozen compatibility-only copy',async()=>{
  const f=await launch();try {
    const {page,app,state}=f;
    await page.locator('[data-view="cloud"]').click();
    await expect(page.locator('#page-title')).toHaveText('iCloud library');
    await expect(page.locator('.library-card')).toHaveCount(2);
    expect(app.windows()).toHaveLength(1);expect(page.url()).toBe('studio://app/index.html');
    expect(await page.locator('iframe,webview').count()).toBe(0);
    expect(await page.evaluate(()=>typeof window.require)).toBe('undefined');
    await page.locator('.library-card img').first().evaluate(image=>window.firstPoster=image);
    await page.locator('#cloud-select').click();await page.locator('.library-card').first().click();
    expect(await page.locator('.library-card img').first().evaluate(image=>image===window.firstPoster)).toBe(true);
    await page.screenshot({path:'test-results/native-cloud.png'});
    await page.locator('#cloud-select').click();await page.getByRole('button',{name:'Arrival',exact:true}).click();
    await expect(page.locator('#library-send')).toBeVisible();
    await expect(page.locator('#library-destination [data-field="compression"] option')).toHaveCount(4);
    await expect(page.locator('#library-destination [data-field="compression"]')).toHaveValue('compatible');
    await page.screenshot({path:'test-results/native-cloud-send.png'});
    await page.getByRole('button',{name:'Send to My TV',exact:true}).click();
    await expect(page.locator('#view-queue')).toBeVisible();
    await expect(page.locator('#queue-list')).toContainText('Arrival');
    const job=state.writes.find(write=>write.path==='/api/studio/jobs');
    expect(job.sources[0]).toEqual({type:'cloud',id:id(1),bytes:5*1024**3,modified:'film-v1',remoteId:'cloud-film'});
    expect(job.destination).toMatchObject({kind:'film',cloudCopies:'original',preparationIntent:'compatible'});
    expect(job.replaceCloudOriginal).toBe(false);expect(f.errors).toEqual([]);
  } finally {await f.close();}
});
test('native Find anything searches, inspects and selects torrent episodes without opening any portal window',async()=>{
  const f=await launch();try {
    const {page,app,state}=f;
    await page.locator('[data-view="torrents"]').click();
    await page.locator('#torrent-query').fill('Sherlock');await page.locator('#torrent-query').press('Enter');
    await expect(page.locator('#torrent-results .studio-spinner')).toBeVisible();
    await expect(page.locator('.torrent-result')).toHaveCount(1);
    await page.screenshot({path:'test-results/native-search-results.png'});
    await page.locator('.torrent-result').click();
    await expect(page.locator('.torrent-result-tail .studio-spinner')).toBeVisible();
    await expect(page.locator('#library-send')).toBeVisible();
    await expect(page.locator('#library-send-files .library-file')).toHaveCount(2);
    await expect(page.locator('#library-file-count')).toContainText('0 selected');
    await page.locator('#library-select-all').click();
    await page.locator('#library-destination [data-field="series"]').selectOption(id(20,32));
    await page.locator('#library-destination [data-field="season"]').selectOption('1');
    await page.locator('#library-destination [data-field="compression"]').selectOption('balanced');
    await page.screenshot({path:'test-results/native-torrent-send.png'});
    await page.getByRole('button',{name:'Send to My TV · 2',exact:true}).click();
    await expect(page.locator('#view-queue')).toBeVisible();
    const job=state.writes.find(write=>write.path==='/api/studio/jobs');
    expect(job.sources).toEqual([{type:'torrent',request:id(31,32),files:[2,5]}]);
    expect(job.destination).toMatchObject({kind:'series',compression:'balanced',preserveSeasons:true,cloudCopies:'optimised'});
    expect(app.windows()).toHaveLength(1);expect(f.errors).toEqual([]);
  } finally {await f.close();}
});
test('native cloud settings preview optimisation, cancel deletion and recover original with compatibility intent',async()=>{
  const f=await launch();try {
    const {page,state}=f;
    await page.locator('[data-view="cloud"]').click();await page.getByRole('button',{name:'Arrival',exact:true}).click();
    await page.getByRole('button',{name:'Media settings'}).click();
    await page.locator('[data-cloud-action="optimise"]').click();
    await expect(page.locator('#cloud-optimise-sizes')).toContainText('≈ 2.0 GB');
    await page.locator('#cloud-optimise-profile').selectOption('balanced');
    await expect(page.locator('#cloud-optimise-sizes')).toContainText('≈ 3.0 GB');
    await page.screenshot({path:'test-results/native-optimise.png'});
    await page.locator('#cloud-optimise-start').click();
    const job=state.writes.find(write=>write.path==='/api/studio/jobs');
    expect(job.destination).toMatchObject({kind:'icloud',optimiseCloud:true,compression:'balanced'});
    expect(job.replaceCloudOriginal).toBe(true);
    await page.locator('[data-view="cloud"]').click();await page.getByRole('button',{name:'Arrival',exact:true}).click();
    await page.getByRole('button',{name:'Media settings'}).click();await page.locator('[data-cloud-action="delete"]').click();
    await page.locator('.library-confirm [data-cancel]').click();
    expect(state.writes.some(write=>write.path==='/api/studio/cloud/operation')).toBe(false);
    await page.locator('[data-cloud-action="original"]').click();
    await expect(page.locator('#library-send')).toBeVisible();
    await expect(page.locator('#library-destination [data-field="compression"]')).toHaveCount(0);
    await page.getByRole('button',{name:'Download original',exact:true}).click();
    const recovered=state.writes.find(write=>write.path==='/api/studio/download-originals');
    expect(recovered).toMatchObject({ids:[id(40,32)],mode:'alongside',destination:{preparationIntent:'compatible',cloudCopies:'original'}});
    expect(f.errors).toEqual([]);
  } finally {await f.close();}
});
test('native series selection, clear search and minimum-size layouts retain one Studio shell',async()=>{
  const f=await launch();try {
    const {page,app}=f;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1040,720));
    await page.locator('[data-view="cloud"]').click();await page.locator('#cloud-category').selectOption('tv');
    await page.getByRole('button',{name:'Sherlock',exact:true}).click();
    await page.locator('#library-season').selectOption('1');await expect(page.locator('#library-send-files .library-file')).toHaveCount(1);
    await page.screenshot({path:'test-results/native-series-compact.png'});
    expect(await page.locator('#library-send').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await page.getByRole('button',{name:'Close media',exact:true}).click();
    await page.locator('[data-view="torrents"]').click();await page.locator('#torrent-query').fill('Sherlock');await page.locator('#torrent-query').press('Enter');
    await page.getByRole('button',{name:'Clear download search'}).click();
    await expect(page.locator('#torrent-results')).toContainText('Find a film or series');
    await expect(page.locator('.torrent-result')).toHaveCount(0);
    expect(app.windows()).toHaveLength(1);expect(f.errors).toEqual([]);
  } finally {await f.close();}
});

test('native Activity shows pre-conversion downloads, speed and stable artwork and routes pause to the server',async()=>{
  const f=await launch();try {
    const {page,state}=f;
    state.jobs.push({id:id(71,32),title:'Arrival',source:{type:'torrent'},match:{title:'Arrival',tmdb_id:329865,media_type:'movie',poster_path:'/arrival.jpg'},destination:{kind:'film',label:'My TV films'},status:'active',stage:'downloading',percent:12,message:'Downloading · 1500 KB/s'});
    await page.locator('[data-view="queue"]').click();
    await expect(page.locator('#queue-list')).toContainText('1500 KB/s');
    await expect(page.locator('#queue-list .job-percent')).toHaveText('12%');
    await page.locator('#queue-list img').evaluate(image=>window.activityPoster=image);
    state.jobs[0].percent=22;state.jobs[0].message='Downloading · 2000 KB/s';
    await page.locator('[data-view="queue"]').click();
    await expect(page.locator('#queue-list .job-percent')).toHaveText('22%');
    expect(await page.locator('#queue-list img').evaluate(image=>image===window.activityPoster)).toBe(true);
    await page.locator('#queue-list [data-job-action="pause"]').click();
    expect(state.writes.find(write=>write.path==='/api/studio/action')).toMatchObject({id:id(71,32),action:'pause'});
    expect(f.errors).toEqual([]);
  } finally {await f.close();}
});

test('native cloud rejects changed files visibly and keeps the selected sheet available for retry',async()=>{
  const f=await launch();try {
    const {page}=f;
    await page.locator('[data-view="cloud"]').click();await page.getByRole('button',{name:'Arrival',exact:true}).click();
    f.state.submitError='The selected iCloud copy changed. Open it again.';
    await page.getByRole('button',{name:'Send to My TV',exact:true}).click();
    await expect(page.locator('#library-send-error')).not.toBeEmpty();
    await expect(page.locator('#library-send')).toBeVisible();
    await expect(page.getByRole('button',{name:'Send to My TV',exact:true})).toBeEnabled();
    expect(f.errors).toEqual([]);
  } finally {await f.close();}
});
