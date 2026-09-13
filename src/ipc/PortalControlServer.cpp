#include "PortalControlServer.h"

#include "hardware/CecTvControl.h"

#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalSocket>
#include <QMetaObject>
#include <QSet>
#include <QUrl>
#include <QVariant>

namespace
{
constexpr qsizetype maximumCommandBytes = 64 * 1024;

const QSet<QString> &allowedCommands()
{
    static const QSet<QString> commands{
        QStringLiteral("channel-up"), QStringLiteral("channel-down"),
        QStringLiteral("previous-programme"), QStringLiteral("next-programme"),
        QStringLiteral("toggle-pause"), QStringLiteral("toggle-subtitles"),
        QStringLiteral("toggle-widescreen-mode"), QStringLiteral("volume-up"),
        QStringLiteral("volume-down"), QStringLiteral("toggle-mute"),
        QStringLiteral("turn-on"), QStringLiteral("turn-off"),
        QStringLiteral("turn-on-mabel-only"), QStringLiteral("turn-off-mabel-only"),
        QStringLiteral("toggle-power"), QStringLiteral("open-parent-menu"),
        QStringLiteral("open-tv-guide"), QStringLiteral("open-channel-menu"),
        QStringLiteral("close-overlay"), QStringLiteral("restart-programme"),
        QStringLiteral("enter-adult-mode"), QStringLiteral("continue-in-adult-mode"),
        QStringLiteral("return-to-mabeltv"), QStringLiteral("toggle-remote-lock"),
        QStringLiteral("navigate-up"), QStringLiteral("navigate-down"),
        QStringLiteral("navigate-left"), QStringLiteral("navigate-right"),
        QStringLiteral("select"),
    };
    return commands;
}
}

PortalControlServer::PortalControlServer(QObject *parent)
    : QObject(parent)
{
    connect(&m_server, &QLocalServer::newConnection,
            this, &PortalControlServer::acceptConnections);
}

bool PortalControlServer::listen(const QString &path, QObject *rootObject,
                                 CecTvControl *tvControl, QString *error)
{
    m_rootObject = rootObject;
    m_tvControl = tvControl;
    QLocalServer::removeServer(path);
    m_server.setSocketOptions(QLocalServer::UserAccessOption);
    if (m_server.listen(path)) return true;
    if (error) *error = m_server.errorString();
    return false;
}

bool PortalControlServer::takeCommand(QByteArray &buffer, QByteArray *command)
{
    const qsizetype newline = buffer.indexOf('\n');
    if (newline < 0) return false;
    QByteArray value = buffer.left(newline);
    buffer.remove(0, newline + 1);
    if (value.endsWith('\r')) value.chop(1);
    if (command) *command = value.trimmed();
    return true;
}

void PortalControlServer::acceptConnections()
{
    while (m_server.hasPendingConnections()) {
        QLocalSocket *socket = m_server.nextPendingConnection();
        if (socket == nullptr) continue;
        m_buffers.insert(socket, {});
        connect(socket, &QLocalSocket::readyRead, this, [this, socket]() {
            readFrom(socket);
        });
        connect(socket, &QLocalSocket::disconnected, this, [this, socket]() {
            m_buffers.remove(socket);
            socket->deleteLater();
        });
    }
}

void PortalControlServer::readFrom(QLocalSocket *socket)
{
    QByteArray &buffer = m_buffers[socket];
    buffer += socket->readAll();
    if (buffer.size() > maximumCommandBytes) {
        finish(socket, "unsupported\n");
        return;
    }
    QByteArray command;
    if (!takeCommand(buffer, &command)) return;
    dispatch(socket, command);
}

void PortalControlServer::finish(QLocalSocket *socket, const QByteArray &reply)
{
    socket->write(reply);
    socket->flush();
    socket->disconnectFromServer();
}

void PortalControlServer::dispatch(QLocalSocket *socket, const QByteArray &rawCommand)
{
    const QString command = QString::fromUtf8(rawCommand);
    if (command.startsWith(QLatin1Char('{'))) {
        const QJsonDocument request = QJsonDocument::fromJson(rawCommand);
        const QJsonObject object = request.object();
        const QString operation = object.value(QStringLiteral("command")).toString();
        if (request.isObject() && operation == QStringLiteral("play-external")) {
            const QFileInfo requested(object.value(QStringLiteral("path")).toString());
            const QString path = requested.canonicalFilePath();
            const QString usbRoot = QDir::cleanPath(QStringLiteral("/media/mabeltv-usb"))
                + QDir::separator();
            static const QSet<QString> mediaSuffixes{
                QStringLiteral("mp4"), QStringLiteral("m4v"), QStringLiteral("mkv"),
                QStringLiteral("mov"), QStringLiteral("webm"), QStringLiteral("avi"),
                QStringLiteral("mpg"), QStringLiteral("mpeg"),
            };
            if (requested.isFile() && path.startsWith(usbRoot)
                && mediaSuffixes.contains(requested.suffix().toLower())) {
                QMetaObject::invokeMethod(
                    m_rootObject, "portalExternalPlayback", Qt::QueuedConnection,
                    Q_ARG(QVariant, QUrl::fromLocalFile(path)),
                    Q_ARG(QVariant, object.value(QStringLiteral("title")).toString()));
                finish(socket, "ok\n");
            } else {
                finish(socket, "unsupported\n");
            }
            return;
        }
        if (request.isObject() && operation == QStringLiteral("play-programme")) {
            QMetaObject::invokeMethod(
                m_rootObject, "portalPlayChannelProgramme", Qt::QueuedConnection,
                Q_ARG(QVariant, object.value(QStringLiteral("channel")).toInt()),
                Q_ARG(QVariant, object.value(QStringLiteral("file")).toString()),
                Q_ARG(QVariant, object.value(QStringLiteral("position")).toDouble(0.0)));
            finish(socket, "ok\n");
            return;
        }
        if (request.isObject()
            && operation == QStringLiteral("save-channel-film-position")) {
            QMetaObject::invokeMethod(
                m_rootObject, "portalSetChannelFilmPosition", Qt::QueuedConnection,
                Q_ARG(QVariant, object.value(QStringLiteral("channel")).toInt()),
                Q_ARG(QVariant, object.value(QStringLiteral("file")).toString()),
                Q_ARG(QVariant, object.value(QStringLiteral("position")).toDouble(0.0)),
                Q_ARG(QVariant, object.value(QStringLiteral("duration")).toDouble(0.0)));
            finish(socket, "ok\n");
            return;
        }
        if (request.isObject() && operation == QStringLiteral("play-adult-film")) {
            QMetaObject::invokeMethod(
                m_rootObject, "portalPlayAdultFilm", Qt::QueuedConnection,
                Q_ARG(QVariant, object.value(QStringLiteral("file")).toString()),
                Q_ARG(QVariant, object.value(QStringLiteral("position")).toDouble(0.0)));
            finish(socket, "ok\n");
            return;
        }
        if (request.isObject() && operation == QStringLiteral("tune-channel")) {
            const int channel = object.value(QStringLiteral("channel")).toInt(-1);
            if (channel > 0) {
                QMetaObject::invokeMethod(m_rootObject, "portalTuneChannel",
                                          Qt::QueuedConnection,
                                          Q_ARG(QVariant, channel));
                finish(socket, "ok\n");
            } else {
                finish(socket, "unsupported\n");
            }
            return;
        }
    }

    if (command == QStringLiteral("status")) {
        m_tvControl->getStatus();
        QJsonObject status{
            {QStringLiteral("mode"), QStringLiteral("kids")},
            {QStringLiteral("volume"), m_rootObject->property("portalVolume").toInt()},
            {QStringLiteral("muted"), m_rootObject->property("portalMuted").toBool()},
            {QStringLiteral("remote_locked"),
             m_rootObject->property("portalRemoteLocked").toBool()},
            {QStringLiteral("standby"), m_rootObject->property("portalStandby").toBool()},
            {QStringLiteral("connected_tv_available"), m_tvControl->available()},
            {QStringLiteral("connected_tv_power"), m_tvControl->lastPowerStatus()},
            {QStringLiteral("subtitles_available"),
             m_rootObject->property("portalSubtitlesAvailable").toBool()},
            {QStringLiteral("subtitles_visible"),
             m_rootObject->property("portalSubtitlesVisible").toBool()},
            {QStringLiteral("widescreen_available"),
             m_rootObject->property("portalWidescreenAvailable").toBool()},
            {QStringLiteral("widescreen_enabled"),
             m_rootObject->property("portalWidescreenEnabled").toBool()},
            {QStringLiteral("adult_handoff_available"),
             m_rootObject->property("portalAdultHandoffAvailable").toBool()},
        };
        QObject *adultMode = m_rootObject->findChild<QObject *>(
            QStringLiteral("mabeltvAdultMode"));
        if (adultMode != nullptr && adultMode->property("active").toBool()) {
            status.insert(QStringLiteral("mode"), QStringLiteral("adult"));
            status.insert(QStringLiteral("playing"), adultMode->property("playing").toBool());
            status.insert(QStringLiteral("programme"),
                          adultMode->property("currentFilmName").toString());
            QObject *adultPlayer = m_rootObject->findChild<QObject *>(
                QStringLiteral("mabeltvAdultPlayer"));
            status.insert(QStringLiteral("paused"), adultPlayer != nullptr
                && adultPlayer->property("paused").toBool());
            if (adultPlayer != nullptr) {
                status.insert(QStringLiteral("playback_position"),
                              adultPlayer->property("playbackPosition").toDouble());
                status.insert(QStringLiteral("playback_duration"),
                              adultPlayer->property("playbackDuration").toDouble());
            }
        }
        finish(socket, QJsonDocument(status).toJson(QJsonDocument::Compact) + '\n');
        return;
    }

    if (allowedCommands().contains(command)) {
        QMetaObject::invokeMethod(m_rootObject, "portalCommand", Qt::QueuedConnection,
                                  Q_ARG(QVariant, command));
        finish(socket, "ok\n");
        return;
    }
    finish(socket, "unsupported\n");
}
