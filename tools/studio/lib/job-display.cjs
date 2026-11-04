'use strict';
function displayJobs(store, companion) {
  const jobs = store.snapshot().jobs;
  for (const state of companion?.actives?.values() || []) {
    const local = state.local || state.child?.local;
    const job = jobs.find(value => value.id === local?.id);
    if (!job || !state.finishing) continue;
    const value = state.progress || {};
    Object.assign(job, { status: value.status || value.stage || job.status, message: value.message || job.message,
      percent: value.percent ?? null, errorCode: value.errorCode || job.errorCode, remoteStage: true });
  }
  return jobs;
}
module.exports = { displayJobs };
