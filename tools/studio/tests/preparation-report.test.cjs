'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparationReport } = require('../lib/preparation-report.cjs');
const { recordProvenance } = require('../lib/provenance.cjs');
const { profileSnapshot, reconcileSnapshot } = require('../lib/backup.cjs');

test('before/after report remains in delivery provenance and recovery after working files are removed', async () => {
  const report=preparationReport({sourceAnalysis:{bytes:100000,codec:'mpeg4',width:720,height:304,fps:24},
    analysis:{bytes:99000,codec:'h264',width:720,height:406,fps:24},converted:true,compression:'compatible',
    encoding:{encoder:'h264_qsv',videoBitrate:1000000}},'compatible','mytv',Date.now()-1000);
  assert.equal(report.sizeChangePercent,-1.0000000000000009);
  assert.equal(report.sizeChangeBytes,-1000);assert.ok(report.elapsedMs>=1000);
  const local={id:'test',status:'complete',sourcePath:'removed.avi',preparationReport:report,
    cloudPreparationReport:report,sourceFingerprint:{size:100000},destination:{compression:'compact'},
    result:{complete:true},workingRemoved:true};
  const snapshot=profileSnapshot({snapshot:()=>({version:1,sourceId:'a'.repeat(32),settings:{},jobs:[local]})});
  const restored=reconcileSnapshot(snapshot,()=>false);
  assert.deepEqual(restored.jobs[0].preparationReport,report);
  assert.deepEqual(restored.jobs[0].cloudPreparationReport,report);
  let payload;
  await recordProvenance({id:'remote',claim:'claim',destination:{kind:'film'}},local,
    {api:async(_route,options)=>{payload=options.body;}},undefined);
  assert.deepEqual(payload.provenance.preparationReport,report);
  assert.deepEqual(payload.provenance.cloudPreparationReport,report);
  assert.equal(payload.provenance.encoding.encoder,'h264_qsv');
});
