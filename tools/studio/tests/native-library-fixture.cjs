'use strict';
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../lib/store.cjs');
const id = (number,length=24) => number.toString(16).padStart(length,'0');
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'studio-native-library-'));
  const state = {writes:[],jobs:[],requests:new Map(),lastSearch:null};
  const items = [
    {id:id(1),title:'Arrival',kind:'video',name:'Arrival (2016).mkv',bytes:5*1024**3,modified:'film-v1',remoteId:'cloud-film',metadata:{title:'Arrival',year:'2016',tmdb_id:329865,media_type:'movie',poster_path:'/arrival.jpg',overview:'A linguist investigates a mysterious arrival.'}},
    {id:id(2),title:'The Matrix',kind:'video',name:'The Matrix (1999).mp4',bytes:2*1024**3,modified:'matrix-v1',remoteId:'cloud-matrix',metadata:{title:'The Matrix',year:'1999',tmdb_id:603,media_type:'movie',poster_path:'/matrix.jpg'}},
    {id:'series:'+id(3),title:'Sherlock',kind:'series',name:'Sherlock',bytes:4*1024**3,episode_count:2,metadata:{title:'Sherlock',year:'2010',tmdb_id:19885,media_type:'tv',poster_path:'/sherlock.jpg'}},
  ];
  const episodes = [1,2].map(number => ({id:id(10+number),title:'Sherlock',name:`Sherlock - S0${number}E01 - Episode One.mp4`,path:`TV/Sherlock/Season ${number}/S0${number}E01.mp4`,series:number,episodeNumber:1,bytes:2*1024**3,modified:'episode-v1',remoteId:'cloud-episode-'+number}));
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost'); let body = {};
    if (req.method === 'POST') { const chunks=[]; for await (const chunk of req) chunks.push(chunk); body=JSON.parse(Buffer.concat(chunks)); state.writes.push({path:url.pathname,...body}); }
    const json = value => {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if (url.pathname === '/api/setup') return json({configured:true,device_name:'fixture-pi',tv_name:'Mabel TV'});
    if (url.pathname === '/api/library') return json({channels:[{number:1,name:'Julia Donaldson',folder:'Julia'}],my_tv_folders:['MCU'],my_tv_series:[{id:id(20,32),title:'Sherlock',seasons:[1,2]}]});
    if (url.pathname === '/api/studio/collections') return json({pi:['MCU'],cloud:[]});
    if (url.pathname === '/api/studio/status') return json({jobs:state.jobs,workers:[{online:true}],cloud:{configured:true}});
    if (url.pathname === '/api/studio/cloud') {
      let selected = url.searchParams.has('series') ? episodes : items.filter(item => url.searchParams.get('category') === 'tv' ? item.kind === 'series' : item.kind !== 'series');
      const query = url.searchParams.get('q')?.toLowerCase(); if(query) selected=selected.filter(item=>item.title.toLowerCase().includes(query));
      if(url.searchParams.get('sort')==='size-asc') selected=[...selected].sort((a,b)=>a.bytes-b.bytes);
      return json({configured:true,items:selected,total:selected.length,checked:1});
    }
    if (url.pathname === '/api/studio/torrents/search') {
      const request={id:id(30,32),kind:'torrent-search',status:'queued'};
      const complete={...request,status:'complete',result:{items:[{hash:'a'.repeat(40),title:'Sherlock.S01-S02.1080p.WEBRip',bytes:5e9,seeders:24}]}};
      state.requests.set(request.id,complete); state.lastSearch=request; return json(request);
    }
    if (url.pathname === '/api/studio/torrents/inspect') {
      const request={id:id(31,32),kind:'torrent-inspect',status:'queued'};
      state.requests.set(request.id,{...request,status:'complete',result:{title:'Sherlock',files:[{index:2,path:'Sherlock S01E01.mp4',bytes:2e9,series:1,episodeNumber:1},{index:5,path:'Sherlock S02E01.mkv',bytes:2e9,series:2,episodeNumber:1},{index:8,path:'readme.txt',bytes:300}]}}); return json(request);
    }
    if (url.pathname === '/api/studio/request') return json(state.requests.get(url.searchParams.get('id')));
    if (url.pathname === '/api/studio/originals') return json({available:true,items:body.ids.map(identity=>({deliveryId:id(40,32),title:'Arrival',bytes:5*1024**3})),title:'Arrival'});
    if (url.pathname === '/api/studio/cloud/optimise-preview') return json({compression:body.compression,files:body.ids.map(identity=>({...items[0],id:identity,estimatedBytes:body.compression==='balanced'?3*1024**3:2*1024**3,risky:false}))});
    if (url.pathname === '/api/studio/jobs' || url.pathname === '/api/studio/download-originals') {
      if (state.submitError) {res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:state.submitError}));}
      state.jobs.push({id:id(50+state.jobs.length,32),title:body.sources?.[0]?.type==='torrent'?'Sherlock':'Arrival',source:{type:body.sources?.[0]?.type || 'torrent'},destination:{...body.destination,label:'My TV films'},status:'queued',stage:'queued',created:Date.now()/1000});
      return json({ok:true,ids:[state.jobs.at(-1).id]});
    }
    if (url.pathname === '/api/studio/cloud/operation' || url.pathname === '/api/studio/action') return json({ok:true});
    if (url.pathname === '/api/my-tv/discovery') return json({results:[items[0].metadata]});
    if (url.pathname === '/api/studio/cloud/match') return json({item:items[0]});
    res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Not found"}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const store=new Store(root);Object.assign(store.state.settings,{localUrl:'http://127.0.0.1:'+server.address().port,remoteUrl:'',connectionMode:'local'});store.save();
  return {root,state,items,episodes,close:async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}};
}
module.exports={fixture,id};
