import QtQuick

QtObject {
    id: queue
    property var jobs: []
    property int active: 0
    property int limit: 4
    function enqueue(callback) {
        const job = { started: false, finished: false, run: callback }
        jobs = jobs.concat([job])
        Qt.callLater(pump)
        return job
    }
    function pump() {
        for (const job of jobs.slice()) {
            if (active >= limit) break
            if (job.started || job.finished) continue
            job.started = true; active++; job.run()
        }
    }
    function release(job) {
        if (!job || job.finished) return
        job.finished = true
        if (job.started) active--
        jobs = jobs.filter(value => value !== job)
        Qt.callLater(pump)
    }
}
