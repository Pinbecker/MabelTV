#pragma once
#include <QFutureWatcher>
#include <QMap>
#include <QObject>
#include <QTimer>

// One database writer, with at most one waiting bookmark per film. SQLite and
// fsync never run on the GUI/render coordinator's thread during playback.
class MyTvResumeWriter final : public QObject
{
public:
    MyTvResumeWriter();
    ~MyTvResumeWriter() override;
    void save(const QString &database, const QString &id, double position,
              double duration, qint64 updated);
    void flush();
private:
    struct Bookmark { QString database, id; double position, duration; qint64 updated; };
    static QString write(const Bookmark &bookmark);
    void start();
    QMap<QString, Bookmark> m_pending;
    Bookmark m_current;
    QFutureWatcher<QString> m_watcher;
    QTimer m_retry;
    bool m_busy = false;
};
