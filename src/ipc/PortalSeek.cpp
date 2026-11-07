#include "PortalSeek.h"
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QMetaObject>
#include <QObject>
#include <QUrl>
#include <QVariant>
#include <algorithm>
#include <cmath>

namespace {
QObject *activePlayer(QObject *root)
{
    if (!root || root->property("portalStandby").toBool()
        || root->property("poweringOff").toBool()
        || root->property("introPlaying").toBool()
        || root->property("filmCountdownActive").toBool()
        || root->property("openingMyTvMode").toBool()) return nullptr;
    auto *family = root->findChild<QObject *>(QStringLiteral("mabeltvFamilyMedia"));
    if (family && family->property("active").toBool()) {
        if (family->property("kind").toString() != QStringLiteral("storytime")
            || !family->property("ready").toBool() || family->property("ended").toBool()) return nullptr;
        return root->findChild<QObject *>(QStringLiteral("mabeltvFamilyPlayer"));
    }
    auto *myTv = root->findChild<QObject *>(QStringLiteral("mabeltvMyTvMode"));
    if (myTv && myTv->property("active").toBool()) {
        if (!myTv->property("playing").toBool() || myTv->property("stopping").toBool()) return nullptr;
        return root->findChild<QObject *>(QStringLiteral("mabeltvMyTvPlayer"));
    }
    return root->findChild<QObject *>(QStringLiteral("mabeltvPlayer"));
}
}

QJsonObject PortalSeek::status(QObject *root)
{
    QJsonObject result{{QStringLiteral("seek_supported"), true}, {QStringLiteral("seek_available"), false}};
    QObject *player = activePlayer(root);
    if (!player) return result;
    const double duration = player->property("playbackDuration").toDouble();
    const double position = player->property("playbackPosition").toDouble();
    const QUrl source = player->property("source").toUrl();
    if (source.isEmpty() || !std::isfinite(duration) || duration <= 0 || !std::isfinite(position)
        || (player->property("status").toString() != QStringLiteral("Playing") && !player->property("paused").toBool())) return result;
    // The source and generation bind a seek to this playback, including replay
    // of the same file. No private filesystem path is exposed to the portal.
    const QByteArray identity = QByteArray::number(QCoreApplication::applicationPid()) + '\0'
        + player->objectName().toUtf8() + '\0' + source.toEncoded() + '\0'
        + QByteArray::number(player->property("playbackGeneration").toULongLong());
    result.insert(QStringLiteral("seek_available"), true);
    // Local IPC only: the Library may prepare thumbnails, but must not forward
    // this private path in the public live-status response.
    result.insert(QStringLiteral("seek_file"), source.toLocalFile());
    result.insert(QStringLiteral("seek_token"), QString::fromLatin1(QCryptographicHash::hash(identity, QCryptographicHash::Sha256).toHex()));
    result.insert(QStringLiteral("playback_position"), std::clamp(position, 0.0, duration));
    result.insert(QStringLiteral("playback_duration"), duration);
    return result;
}

bool PortalSeek::apply(QObject *root, double position, const QString &token)
{
    const QJsonObject current = status(root);
    if (!std::isfinite(position) || position < 0 || token.isEmpty()
        || !current.value(QStringLiteral("seek_available")).toBool()
        || current.value(QStringLiteral("seek_token")).toString() != token) return false;
    QObject *player = activePlayer(root);
    const double maximum = std::max(0.0, current.value(QStringLiteral("playback_duration")).toDouble() - 0.1);
    return player && QMetaObject::invokeMethod(player, "seekAbsolute", Qt::DirectConnection,
        Q_ARG(double, std::min(position, maximum)));
}
