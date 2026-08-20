#include "MediaIndex.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QProcess>
#include <QSaveFile>
#include <QStandardPaths>

#include <utility>

namespace
{
constexpr int cacheSchemaVersion = 1;

MediaInspection inspectionFromJson(const QJsonObject &object)
{
    return MediaInspection{
        object.value(QStringLiteral("usable")).toBool(true),
        object.value(QStringLiteral("inspected")).toBool(false),
        object.value(QStringLiteral("duration_seconds")).toDouble(0.0),
        object.value(QStringLiteral("video_codec")).toString(),
        object.value(QStringLiteral("error")).toString(),
    };
}

QJsonObject inspectionToJson(const QFileInfo &file, const MediaInspection &inspection)
{
    return QJsonObject{
        {QStringLiteral("size"), static_cast<double>(file.size())},
        {QStringLiteral("modified_utc_ms"),
         static_cast<double>(file.lastModified().toUTC().toMSecsSinceEpoch())},
        {QStringLiteral("usable"), inspection.usable},
        {QStringLiteral("inspected"), inspection.inspected},
        {QStringLiteral("duration_seconds"), inspection.durationSeconds},
        {QStringLiteral("video_codec"), inspection.videoCodec},
        {QStringLiteral("error"), inspection.error},
    };
}
} // namespace

MediaIndex::MediaIndex(QString cachePath)
    : m_cachePath(std::move(cachePath))
    , m_ffprobePath(QStandardPaths::findExecutable(QStringLiteral("ffprobe")))
{
    load();
}

MediaInspection MediaIndex::inspect(const QString &mediaPath)
{
    const QFileInfo file(mediaPath);
    const QString key = file.absoluteFilePath();
    const QJsonObject cached = m_entries.value(key).toObject();
    const qint64 cachedSize = static_cast<qint64>(cached.value(QStringLiteral("size")).toDouble(-1.0));
    const qint64 cachedModified = static_cast<qint64>(
        cached.value(QStringLiteral("modified_utc_ms")).toDouble(-1.0));
    if (!cached.isEmpty() && cachedSize == file.size()
        && cachedModified == file.lastModified().toUTC().toMSecsSinceEpoch()) {
        return inspectionFromJson(cached);
    }

    const MediaInspection inspection = runProbe(key);
    m_entries.insert(key, inspectionToJson(file, inspection));
    m_dirty = true;
    return inspection;
}

MediaInspection MediaIndex::inspectCached(const QString &mediaPath)
{
    const QFileInfo file(mediaPath);
    const QString key = file.absoluteFilePath();
    const QJsonObject cached = m_entries.value(key).toObject();
    const qint64 cachedSize = static_cast<qint64>(cached.value(QStringLiteral("size")).toDouble(-1.0));
    const qint64 cachedModified = static_cast<qint64>(
        cached.value(QStringLiteral("modified_utc_ms")).toDouble(-1.0));
    if (!cached.isEmpty() && cachedSize == file.size()
        && cachedModified == file.lastModified().toUTC().toMSecsSinceEpoch()) {
        return inspectionFromJson(cached);
    }

    // Startup must never wait several seconds per file before systemd receives
    // READY. Admit a readable video provisionally, then let the controller's
    // background validation publish the fully checked library atomically.
    m_pendingInspections = true;
    return MediaInspection{true, false, 0.0, QString(), QStringLiteral("validation pending")};
}

bool MediaIndex::hasPendingInspections() const
{
    return m_pendingInspections;
}

bool MediaIndex::save()
{
    if (m_cachePath.isEmpty() || !m_dirty) {
        return true;
    }

    for (auto iterator = m_entries.begin(); iterator != m_entries.end();) {
        if (!QFileInfo::exists(iterator.key())) {
            iterator = m_entries.erase(iterator);
        } else {
            ++iterator;
        }
    }

    QDir().mkpath(QFileInfo(m_cachePath).absolutePath());
    QSaveFile cache(m_cachePath);
    if (!cache.open(QIODevice::WriteOnly)) {
        return false;
    }

    const QJsonObject root{
        {QStringLiteral("schema_version"), cacheSchemaVersion},
        {QStringLiteral("entries"), m_entries},
    };
    cache.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
    if (!cache.commit()) {
        return false;
    }
    m_dirty = false;
    return true;
}

QString MediaIndex::cachePath() const
{
    return m_cachePath;
}

void MediaIndex::load()
{
    if (m_cachePath.isEmpty()) {
        return;
    }

    QFile cache(m_cachePath);
    if (!cache.open(QIODevice::ReadOnly)) {
        return;
    }

    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(cache.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        return;
    }

    const QJsonObject root = document.object();
    if (root.value(QStringLiteral("schema_version")).toInt() == cacheSchemaVersion) {
        m_entries = root.value(QStringLiteral("entries")).toObject();
    }
}

MediaInspection MediaIndex::runProbe(const QString &mediaPath) const
{
    if (m_ffprobePath.isEmpty()) {
        return MediaInspection{true,
                               false,
                               0.0,
                               QString(),
                               QStringLiteral("ffprobe is unavailable; validation was skipped")};
    }

    QProcess process;
    process.start(m_ffprobePath,
                  {QStringLiteral("-v"),
                   QStringLiteral("error"),
                   QStringLiteral("-select_streams"),
                   QStringLiteral("v:0"),
                   QStringLiteral("-show_entries"),
                   QStringLiteral("stream=codec_name:format=duration"),
                   QStringLiteral("-of"),
                   QStringLiteral("json"),
                   mediaPath});
    if (!process.waitForStarted(3000) || !process.waitForFinished(8000)) {
        process.kill();
        process.waitForFinished(1000);
        return MediaInspection{false,
                               true,
                               0.0,
                               QString(),
                               QStringLiteral("ffprobe timed out")};
    }

    if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
        const QString error = QString::fromUtf8(process.readAllStandardError()).trimmed();
        return MediaInspection{false,
                               true,
                               0.0,
                               QString(),
                               error.isEmpty() ? QStringLiteral("ffprobe rejected the file") : error};
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(process.readAllStandardOutput(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return MediaInspection{false,
                               true,
                               0.0,
                               QString(),
                               QStringLiteral("ffprobe returned invalid metadata")};
    }

    const QJsonObject root = document.object();
    const QJsonArray streams = root.value(QStringLiteral("streams")).toArray();
    if (streams.isEmpty()) {
        return MediaInspection{false,
                               true,
                               0.0,
                               QString(),
                               QStringLiteral("no video stream was found")};
    }

    bool durationValid = false;
    const double duration = root.value(QStringLiteral("format"))
                                .toObject()
                                .value(QStringLiteral("duration"))
                                .toString()
                                .toDouble(&durationValid);
    return MediaInspection{true,
                           true,
                           durationValid ? duration : 0.0,
                           streams.at(0).toObject().value(QStringLiteral("codec_name")).toString(),
                           QString()};
}
