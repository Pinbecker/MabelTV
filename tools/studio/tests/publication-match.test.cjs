'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CompanionJobs } = require('../lib/companion-jobs.cjs');
const { CompanionTorrents } = require('../lib/companion-torrents.cjs');
const { Portal } = require('../lib/portal.cjs');

test('automatic matching uses the release year to distinguish identical film titles', async () => {
  const portal = { current: {device:'pi'}, connect:async()=>{}, searchTitles:async query => {
    assert.equal(query, 'The Matrix');
    return {results:[{title:'The Matrix',year:'1999',tmdb_id:603,media_type:'movie'},
      {title:'The Matrix',year:'2004',tmdb_id:1386216,media_type:'movie'},
      {title:'The Matrix',year:'',tmdb_id:1502836,media_type:'movie'}]};
  }};
  const jobs = new CompanionJobs({}, {}, {}, portal);
  assert.equal((await jobs.match({}, {title:'The Matrix (1999) 1080p'}, {kind:'film'})).tmdb_id,603);
  assert.equal(await jobs.match({}, {title:'The Matrix'}, {kind:'film'}),null);
  assert.equal(await jobs.match({}, {title:'The Matrix 1998'}, {kind:'film'}),null);
});

test('Studio film metadata binds canonical renaming to the completed upload receipt', async () => {
  const portal = new Portal({}); portal.current={base:'http://pi.local',device:'pi'};
  portal.at=async (_base,_route,{body})=>{
    assert.equal(body.studio_upload,'a'.repeat(32));
    return {ok:true,metadata:{tmdb_id:603},publication:{complete:true,file_name:'The Matrix (1999).mp4'}};
  };
  const result=await portal.applyMatch({device:'pi',uploadId:'a'.repeat(32),destination:{kind:'film'},
    match:{device:'pi',title:'The Matrix',year:'1999',media_type:'movie',tmdb_id:603},
    result:{complete:true,file_name:'release.mp4'}});
  assert.equal(result.publication.file_name,'The Matrix (1999).mp4');
});

test('torrent metadata repair after cleanup never downloads again and reports matched title', async () => {
  const remote={id:'a'.repeat(32),metadata_only:true,title:'Release',source:{files:[{index:3,path:'release.mp4'}]},destination:{kind:'film'}};
  const match={title:'The Matrix',tmdb_id:603};
  const jobs={store:{state:{jobs:[{remoteId:remote.id+':3',sourcePath:'removed.mp4',result:{complete:true}}]}},
    run:async (child,state)=>{assert.equal(child.metadata_only,true);state.progress={matchedTitle:match,result:{complete:true,file_name:'The Matrix (1999).mp4'}};}};
  const downloads={download:async()=>{throw Error('Must not download');},cleanup:()=>{throw Error('Must not clean up again');}};
  const state={};await new CompanionTorrents(downloads,jobs).run(remote,state,new AbortController().signal);
  assert.deepEqual(state.progress.matchedTitle,match);
  assert.equal(state.progress.result.file_name,'The Matrix (1999).mp4');
});
