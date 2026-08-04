#include "Logging.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMessageLogContext>
#include <QMutex>
#include <QMutexLocker>
#include <QTextStream>
#include <QThread>

#include <memory>

namespace
{
constexpr qint64 maximumLogBytes = 2 * 1024 * 1024;
constexpr int retainedLogFiles = 5;

struct LoggingState
{
    QFile file;
    QMutex mutex;
};

std::unique_ptr<LoggingState> state;

QString levelName(QtMsgType type)
{
    switch (type) {
    case QtDebugMsg:
        return QStringLiteral("DEBUG");
    case QtInfoMsg:
        return QStringLiteral("INFO ");
    case QtWarningMsg:
        return QStringLiteral("WARN ");
    case QtCriticalMsg:
        return QStringLiteral("ERROR");
    case QtFatalMsg:
        return QStringLiteral("FATAL");
    }
    return QStringLiteral("UNKWN");
}

void rotateLogs(const QString &path)
{
    for (int index = retainedLogFiles - 1; index >= 1; --index) {
        const QString source = QStringLiteral("%1.%2").arg(path).arg(index);
        const QString destination = QStringLiteral("%1.%2").arg(path).arg(index + 1);
        if (QFileInfo::exists(source)) {
            QFile::remove(destination);
            QFile::rename(source, destination);
        }
    }

    if (QFileInfo::exists(path)) {
        const QString firstArchive = path + QStringLiteral(".1");
        QFile::remove(firstArchive);
        QFile::rename(path, firstArchive);
    }
}

bool openLogFile(LoggingState &loggingState, const QString &path)
{
    loggingState.file.setFileName(path);
    return loggingState.file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text);
}

void messageHandler(QtMsgType type, const QMessageLogContext &context, const QString &message)
{
    if (!state) {
        return;
    }

    QMutexLocker lock(&state->mutex);
    if (state->file.size() >= maximumLogBytes) {
        const QString path = state->file.fileName();
        state->file.close();
        rotateLogs(path);
        openLogFile(*state, path);
    }

    QTextStream stream(&state->file);
    stream << QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs) << " " << levelName(type)
           << " [" << QThread::currentThreadId() << "]";
    if (context.category != nullptr && *context.category != '\0') {
        stream << " [" << context.category << "]";
    }
    stream << " " << message << "\n";
    stream.flush();
}
} // namespace

namespace Logging
{
bool initialize(const QString &directoryPath)
{
    shutdown();
    if (!QDir().mkpath(directoryPath)) {
        return false;
    }

    const QString path = QDir(directoryPath).filePath(QStringLiteral("mabeltv.log"));
    if (QFileInfo(path).size() >= maximumLogBytes) {
        rotateLogs(path);
    }

    auto newState = std::make_unique<LoggingState>();
    if (!openLogFile(*newState, path)) {
        return false;
    }

    state = std::move(newState);
    qInstallMessageHandler(messageHandler);
    return true;
}

void shutdown()
{
    qInstallMessageHandler(nullptr);
    if (state) {
        QMutexLocker lock(&state->mutex);
        state->file.flush();
        state->file.close();
    }
    state.reset();
}

QString currentLogPath()
{
    if (!state) {
        return QString();
    }
    QMutexLocker lock(&state->mutex);
    return state->file.fileName();
}
} // namespace Logging
