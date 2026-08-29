#pragma once

#include <QObject>
#include <QProcess>
#include <QQueue>
#include <QString>
#include <QTimer>

#include <initializer_list>

class CecTvControl final : public QObject
{
    Q_OBJECT

public:
    explicit CecTvControl(QString osdName, QObject *parent = nullptr);

    [[nodiscard]] bool available() const;
    [[nodiscard]] QString lastPowerStatus() const;

    void turnOn();
    void turnOff();
    void getStatus();

signals:
    void powerStatusChanged(const QString &status);

private:
    struct Command
    {
        QString input;
        QString description;
    };

    void replacePendingCommands(std::initializer_list<Command> commands);
    void startNextCommand();
    void finishCommand(int exitCode, QProcess::ExitStatus exitStatus);
    void failToStart(QProcess::ProcessError error);
    [[nodiscard]] QString detectAdapter() const;
    [[nodiscard]] bool commandOutputHasError(const QString &output) const;

    QString m_osdName;
    QString m_clientPath;
    QString m_adapterPath;
    QString m_lastPowerStatus = QStringLiteral("unknown");
    QQueue<Command> m_pendingCommands;
    Command m_currentCommand;
    QProcess m_process;
    QTimer m_timeout;
    bool m_startFailureHandled = false;
};
