#pragma once

#include <QJsonObject>
#include <QString>

struct MediaInspection
{
    bool usable = true;
    bool inspected = false;
    double durationSeconds = 0.0;
    QString videoCodec;
    QString error;
};

class MediaIndex
{
public:
    explicit MediaIndex(QString cachePath = QString());

    [[nodiscard]] MediaInspection inspect(const QString &mediaPath);
    [[nodiscard]] MediaInspection inspectCached(const QString &mediaPath);
    [[nodiscard]] bool hasPendingInspections() const;
    [[nodiscard]] bool save();
    [[nodiscard]] QString cachePath() const;

private:
    void load();
    MediaInspection runProbe(const QString &mediaPath) const;

    QString m_cachePath;
    QString m_ffprobePath;
    QJsonObject m_entries;
    bool m_dirty = false;
    bool m_pendingInspections = false;
};
