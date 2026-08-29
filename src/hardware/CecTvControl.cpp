#include "hardware/CecTvControl.h"

#include <QFile>
#include <QRegularExpression>
#include <QStandardPaths>

#include <utility>

#ifdef Q_OS_LINUX
#include <fcntl.h>
#include <linux/cec.h>
#include <sys/ioctl.h>
#include <unistd.h>
#endif

namespace
{
constexpr int cecCommandTimeoutMilliseconds = 15'000;
}

CecTvControl::CecTvControl(QString osdName, QObject *parent)
    : QObject(parent)
    , m_osdName(std::move(osdName))
{
    const QString configuredClient = QString::fromLocal8Bit(qgetenv("MABELTV_CEC_CLIENT"));
    m_clientPath = configuredClient.isEmpty()
        ? QStandardPaths::findExecutable(QStringLiteral("cec-client"))
        : configuredClient;
    m_adapterPath = detectAdapter();

    m_process.setProcessChannelMode(QProcess::MergedChannels);
    connect(&m_process, &QProcess::started, this, [this]() {
        m_process.write(m_currentCommand.input.toUtf8());
        m_process.write("\n");
        m_process.closeWriteChannel();
        m_timeout.start();
    });
    connect(&m_process,
            qOverload<int, QProcess::ExitStatus>(&QProcess::finished),
            this,
            &CecTvControl::finishCommand);
    connect(&m_process, &QProcess::errorOccurred, this, &CecTvControl::failToStart);

    m_timeout.setSingleShot(true);
    m_timeout.setInterval(cecCommandTimeoutMilliseconds);
    connect(&m_timeout, &QTimer::timeout, this, [this]() {
        qWarning().noquote() << "HDMI-CEC command timed out:"
                             << m_currentCommand.description;
        m_process.kill();
    });
}

bool CecTvControl::available() const
{
    return !m_clientPath.isEmpty() && !m_adapterPath.isEmpty();
}

QString CecTvControl::lastPowerStatus() const
{
    return m_lastPowerStatus;
}

void CecTvControl::turnOn()
{
    // Explicit wake followed by Active Source avoids the ambiguous CEC toggle
    // opcode and safely re-selects MabelTV even when the LG is already on.
    replacePendingCommands({
        {QStringLiteral("on 0"), QStringLiteral("wake TV")},
        {QStringLiteral("as"), QStringLiteral("select MabelTV HDMI source")},
    });
}

void CecTvControl::turnOff()
{
    replacePendingCommands({
        {QStringLiteral("standby 0"), QStringLiteral("put TV in standby")},
    });
}

void CecTvControl::getStatus()
{
    m_pendingCommands.enqueue(
        {QStringLiteral("pow 0"), QStringLiteral("query TV power status")});
    startNextCommand();
}

void CecTvControl::replacePendingCommands(std::initializer_list<Command> commands)
{
    m_pendingCommands.clear();
    for (const Command &command : commands) {
        m_pendingCommands.enqueue(command);
    }
    startNextCommand();
}

void CecTvControl::startNextCommand()
{
    if (m_process.state() != QProcess::NotRunning || m_pendingCommands.isEmpty()) {
        return;
    }

    if (m_clientPath.isEmpty()) {
        m_clientPath = QStandardPaths::findExecutable(QStringLiteral("cec-client"));
    }
    if (m_adapterPath.isEmpty()) {
        m_adapterPath = detectAdapter();
    }
    if (!available()) {
        qWarning() << "HDMI-CEC is unavailable; cec-client or a connected CEC adapter was not found";
        m_pendingCommands.clear();
        return;
    }

    m_currentCommand = m_pendingCommands.dequeue();
    m_startFailureHandled = false;
    m_process.start(m_clientPath,
                    {QStringLiteral("-s"),
                     QStringLiteral("-d"), QStringLiteral("1"),
                     QStringLiteral("-t"), QStringLiteral("p"),
                     QStringLiteral("-o"), m_osdName,
                     m_adapterPath},
                    QIODevice::ReadWrite);
}

void CecTvControl::finishCommand(int exitCode, QProcess::ExitStatus exitStatus)
{
    m_timeout.stop();
    const QString output = QString::fromLocal8Bit(m_process.readAll()).trimmed();
    const bool succeeded = exitStatus == QProcess::NormalExit && exitCode == 0
        && !commandOutputHasError(output);
    if (!succeeded) {
        qWarning().noquote() << "HDMI-CEC command failed ("
                             << m_currentCommand.description << "):"
                             << (output.isEmpty() ? QStringLiteral("no diagnostic output")
                                                 : output);
        // Re-detect on the next request in case the HDMI cable moved between
        // the Pi 4's two ports. Existing MabelTV power state is unaffected.
        m_adapterPath.clear();
    } else {
        qInfo().noquote() << "HDMI-CEC command completed:"
                          << m_currentCommand.description;
        if (m_currentCommand.input == QStringLiteral("pow 0")) {
            const QRegularExpression expression(
                QStringLiteral("power status:\\s*([^\\r\\n]+)"),
                QRegularExpression::CaseInsensitiveOption);
            const QRegularExpressionMatch match = expression.match(output);
            if (match.hasMatch()) {
                const QString status = match.captured(1).trimmed().toLower();
                if (status != m_lastPowerStatus) {
                    m_lastPowerStatus = status;
                    emit powerStatusChanged(status);
                }
            }
        }
    }
    startNextCommand();
}

void CecTvControl::failToStart(QProcess::ProcessError error)
{
    if (error != QProcess::FailedToStart || m_startFailureHandled) {
        return;
    }
    m_startFailureHandled = true;
    m_timeout.stop();
    qWarning().noquote() << "Unable to start HDMI-CEC command:"
                         << m_process.errorString();
    m_clientPath.clear();
    m_pendingCommands.clear();
}

QString CecTvControl::detectAdapter() const
{
    const QString configuredDevice = QString::fromLocal8Bit(qgetenv("MABELTV_CEC_DEVICE"));
    if (!configuredDevice.isEmpty()) {
        return configuredDevice;
    }

#ifdef Q_OS_LINUX
    // A Pi 4 exposes one CEC node per HDMI connector. Only the connector with
    // a live HDMI topology has a valid physical address (for example 1.0.0.0).
    for (int index = 0; index < 4; ++index) {
        const QString path = QStringLiteral("/dev/cec%1").arg(index);
        const QByteArray encodedPath = QFile::encodeName(path);
        const int descriptor = open(encodedPath.constData(), O_RDWR | O_CLOEXEC);
        if (descriptor < 0) {
            continue;
        }
        __u16 physicalAddress = CEC_PHYS_ADDR_INVALID;
        const bool connected = ioctl(descriptor, CEC_ADAP_G_PHYS_ADDR,
                                     &physicalAddress) == 0
            && physicalAddress != CEC_PHYS_ADDR_INVALID;
        close(descriptor);
        if (connected) {
            return path;
        }
    }
#endif
    return {};
}

bool CecTvControl::commandOutputHasError(const QString &output) const
{
    return output.contains(QStringLiteral("ERROR:"), Qt::CaseInsensitive)
        || output.contains(QStringLiteral("unable to open"), Qt::CaseInsensitive)
        || output.contains(QStringLiteral("could not open"), Qt::CaseInsensitive)
        || output.contains(QStringLiteral("could not start CEC"), Qt::CaseInsensitive);
}
