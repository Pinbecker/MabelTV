#pragma once

#include <QByteArray>
#include <QHash>
#include <QLocalServer>
#include <QObject>

class CecTvControl;
class QLocalSocket;

class PortalControlServer final : public QObject
{
public:
    explicit PortalControlServer(QObject *parent = nullptr);

    bool listen(const QString &path, QObject *rootObject, CecTvControl *tvControl,
                QString *error = nullptr);

    static bool takeCommand(QByteArray &buffer, QByteArray *command);

private:
    void acceptConnections();
    void readFrom(QLocalSocket *socket);
    void dispatch(QLocalSocket *socket, const QByteArray &command);
    static void finish(QLocalSocket *socket, const QByteArray &reply);

    QLocalServer m_server;
    QHash<QLocalSocket *, QByteArray> m_buffers;
    QObject *m_rootObject = nullptr;
    CecTvControl *m_tvControl = nullptr;
};
