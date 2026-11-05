#include "MyTvResumeWriter.h"
#include "StateDatabase.h"
#include <QDebug>
#include <QtConcurrentRun>
#include <utility>

MyTvResumeWriter::MyTvResumeWriter()
{
    m_retry.setSingleShot(true);
    m_retry.setInterval(1000);
    connect(&m_retry, &QTimer::timeout, this, &MyTvResumeWriter::start);
    connect(&m_watcher, &QFutureWatcher<QString>::finished, this, [this] {
        if (!m_busy) return;
        m_busy = false;
        const QString error = m_watcher.result();
        if (!error.isEmpty()) {
            if (!m_pending.contains(m_current.id)) m_pending.insert(m_current.id, m_current);
            qWarning().noquote() << "My TV progress save deferred:" << error;
            m_retry.start();
        } else start();
    });
}

MyTvResumeWriter::~MyTvResumeWriter() { flush(); }

QString MyTvResumeWriter::write(const Bookmark &bookmark)
{
    QString error;
    mabeltv::state::saveMyTvResume(bookmark.database, bookmark.id, bookmark.position,
                                 bookmark.duration, bookmark.updated, &error);
    return error;
}

void MyTvResumeWriter::save(const QString &database, const QString &id, double position,
                          double duration, qint64 updated)
{
    m_pending.insert(id, {database, id, position, duration, updated});
    if (!m_retry.isActive()) start();
}

void MyTvResumeWriter::start()
{
    if (m_busy || m_pending.isEmpty()) return;
    const auto first = m_pending.begin();
    m_current = first.value();
    m_pending.erase(first);
    m_busy = true;
    const Bookmark copy = m_current;
    m_watcher.setFuture(QtConcurrent::run([copy] { return write(copy); }));
}

void MyTvResumeWriter::flush()
{
    m_retry.stop();
    if (m_busy) {
        m_watcher.waitForFinished();
        if (!m_watcher.result().isEmpty() && !m_pending.contains(m_current.id))
            m_pending.insert(m_current.id, m_current);
        m_busy = false;
    }
    const auto pending = std::exchange(m_pending, {});
    for (const auto &bookmark : pending) {
        const QString error = write(bookmark);
        if (!error.isEmpty()) qWarning().noquote() << "Could not flush My TV progress:" << error;
    }
}
