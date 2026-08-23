#include "core/TvController.h"
#include "diagnostics/Logging.h"
#include "media/MpvVideo.h"
#include "media/SoundEffects.h"

#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QCursor>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkInterface>
#include <QLocalServer>
#include <QLocalSocket>
#include <QProcess>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSet>
#include <QStandardPaths>
#include <QSurfaceFormat>
#include <QSysInfo>
#include <QTimer>
#include <QUrl>
#include <QWindow>

#ifdef MABELTV_HAVE_SYSTEMD
#include <systemd/sd-daemon.h>
#endif

#ifdef Q_OS_LINUX
#include <QSocketNotifier>

#include <csignal>
#include <fcntl.h>
#include <unistd.h>
#endif

#include <mpv/client.h>

#include <algorithm>
#include <locale.h>
#include <memory>

namespace
{
QUrl findStartupIntro(const QString &mediaRoot)
{
    const QSet<QString> supportedExtensions{
        QStringLiteral("mp4"),
        QStringLiteral("m4v"),
        QStringLiteral("mkv"),
        QStringLiteral("mov"),
        QStringLiteral("webm"),
        QStringLiteral("avi"),
        QStringLiteral("mpg"),
        QStringLiteral("mpeg"),
    };
    const QDir introDirectory(QDir(mediaRoot).filePath(QStringLiteral("Intro")));
    const QFileInfoList candidates = introDirectory.entryInfoList(
        QDir::Files | QDir::Readable, QDir::Name | QDir::IgnoreCase);
    for (const QFileInfo &candidate : candidates) {
        const QString baseName = candidate.completeBaseName();
        if ((baseName.compare(QStringLiteral("KidsTV"), Qt::CaseInsensitive) == 0
             || baseName.compare(QStringLiteral("MabelTV"), Qt::CaseInsensitive) == 0)
            && supportedExtensions.contains(candidate.suffix().toLower())) {
            return QUrl::fromLocalFile(candidate.absoluteFilePath());
        }
    }
    return {};
}

bool ownerSetupComplete(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return false;
    }
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    return document.isObject()
        && document.object().value(QStringLiteral("setup_complete")).toBool(false);
}

QString ownerTvName(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return QStringLiteral("KidsTV");
    }
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    if (!document.isObject()) {
        return QStringLiteral("KidsTV");
    }
    const QString tvName = document.object().value(QStringLiteral("tv_name"))
                               .toString().trimmed();
    return tvName.isEmpty() || tvName.size() > 42
        ? QStringLiteral("KidsTV")
        : tvName;
}

QString configurationValue(const QString &path, const QString &wantedKey)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return {};
    }
    while (!file.atEnd()) {
        const QString line = QString::fromUtf8(file.readLine()).trimmed();
        const qsizetype separator = line.indexOf(QLatin1Char('='));
        if (separator > 0 && line.left(separator).trimmed() == wantedKey) {
            return line.mid(separator + 1).trimmed();
        }
    }
    return {};
}

QString firstLanAddress()
{
    QString fallback;
    for (const QHostAddress &address : QNetworkInterface::allAddresses()) {
        if (address.protocol() != QAbstractSocket::IPv4Protocol || address.isLoopback()) {
            continue;
        }
        const QString value = address.toString();
        const quint32 ipv4 = address.toIPv4Address();
        const bool privateUse = (ipv4 & 0xff000000U) == 0x0a000000U
            || (ipv4 & 0xfff00000U) == 0xac100000U
            || (ipv4 & 0xffff0000U) == 0xc0a80000U;
        if (privateUse) {
            return value;
        }
        if (fallback.isEmpty()) {
            fallback = value;
        }
    }
    return fallback;
}

bool hasArgument(int argc, char *argv[], const char *argument)
{
    return std::any_of(argv + 1, argv + argc, [argument](const char *value) {
        return QByteArray(value) == QByteArray(argument);
    });
}

#ifdef Q_OS_LINUX
int reloadSignalPipe[2] = {-1, -1};

void requestLibraryReload(int)
{
    const char request = 'R';
    if (reloadSignalPipe[1] >= 0) {
        const ssize_t ignored = write(reloadSignalPipe[1], &request, sizeof(request));
        Q_UNUSED(ignored);
    }
}

void requestCleanShutdown(int)
{
    const char request = 'Q';
    if (reloadSignalPipe[1] >= 0) {
        const ssize_t ignored = write(reloadSignalPipe[1], &request, sizeof(request));
        Q_UNUSED(ignored);
    }
}
#endif

void notifyService(const char *state)
{
#ifdef MABELTV_HAVE_SYSTEMD
    sd_notify(0, state);
#else
    Q_UNUSED(state);
#endif
}

int runLibmpvSelfTest(int argc, char *argv[])
{
    QCoreApplication application(argc, argv);
    setlocale(LC_NUMERIC, "C");

    mpv_handle *handle = mpv_create();
    if (handle == nullptr) {
        return 1;
    }

    mpv_set_option_string(handle, "vo", "null");
    mpv_set_option_string(handle, "ao", "null");
    mpv_set_option_string(handle, "terminal", "no");
    const int result = mpv_initialize(handle);
    mpv_terminate_destroy(handle);
    return result < 0 ? 2 : 0;
}
} // namespace

int main(int argc, char *argv[])
{
    if (hasArgument(argc, argv, "--self-test")) {
        return runLibmpvSelfTest(argc, argv);
    }

    const bool forceOpenGlEs2 = qEnvironmentVariableIntValue("MABELTV_FORCE_GLES2") != 0;
    if (forceOpenGlEs2) {
        // Debian 13 currently ships a libmpv OpenGL render-API regression
        // (upstream mpv #17217): an unreclaimable GL fence is allocated for
        // every embedded frame. The Pi service pairs this GLES 2 request with
        // Mesa version/extension overrides so the affected GL sync path is not
        // exposed to libmpv. This remains a supported renderer for both Qt
        // Quick and libmpv on the Pi.
        QSurfaceFormat format = QSurfaceFormat::defaultFormat();
        format.setRenderableType(QSurfaceFormat::OpenGLES);
        format.setVersion(2, 0);
        format.setProfile(QSurfaceFormat::NoProfile);
        QSurfaceFormat::setDefaultFormat(format);
    }

    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);

    QGuiApplication application(argc, argv);
    // Qt adopts the user's regional locale during application construction,
    // while libmpv requires the process-wide numeric locale to remain C.
    setlocale(LC_NUMERIC, "C");
    QCoreApplication::setApplicationName(QStringLiteral("KidsTV"));
    QCoreApplication::setApplicationVersion(QStringLiteral(MABELTV_VERSION));
    QCoreApplication::setOrganizationName(QStringLiteral("MabelTV"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("KidsTV child-friendly television player"));
    parser.addHelpOption();
    parser.addVersionOption();
    const QCommandLineOption fullscreenOption(QStringLiteral("fullscreen"),
                                               QStringLiteral("Open directly in full-screen mode."));
    const QCommandLineOption channelsOption(QStringLiteral("channels"),
                                             QStringLiteral("Path to channels.json."),
                                             QStringLiteral("file"));
    const QCommandLineOption settingsOption(QStringLiteral("settings"),
                                             QStringLiteral("Path to settings.json."),
                                             QStringLiteral("file"));
    const QCommandLineOption mediaRootOption(QStringLiteral("media-root"),
                                              QStringLiteral("Root directory containing channel folders."),
                                              QStringLiteral("directory"));
    const QCommandLineOption stateOption(QStringLiteral("state"),
                                         QStringLiteral("Path to persistent television state."),
                                         QStringLiteral("file"));
    const QCommandLineOption logDirectoryOption(QStringLiteral("log-dir"),
                                                QStringLiteral("Directory for rotating diagnostic logs."),
                                                QStringLiteral("directory"));
    parser.addOption(fullscreenOption);
    parser.addOption(channelsOption);
    parser.addOption(settingsOption);
    parser.addOption(mediaRootOption);
    parser.addOption(stateOption);
    parser.addOption(logDirectoryOption);
    parser.addPositionalArgument(QStringLiteral("media"),
                                 QStringLiteral("Local video file to play."),
                                 QStringLiteral("[media]"));
    parser.process(application);

    if (qEnvironmentVariableIntValue("MABELTV_HIDE_CURSOR") != 0) {
        QGuiApplication::setOverrideCursor(QCursor(Qt::BlankCursor));
    }

    QUrl startupMedia;
    if (!parser.positionalArguments().isEmpty()) {
        const QFileInfo mediaFile(parser.positionalArguments().constFirst());
        startupMedia = QUrl::fromLocalFile(mediaFile.absoluteFilePath());
    }

    qmlRegisterType<MpvVideo>("MabelTV", 1, 0, "MpvVideo");
    qmlRegisterType<SoundEffects>("MabelTV", 1, 0, "SoundEffects");
    qmlRegisterUncreatableType<TvController>("MabelTV",
                                             1,
                                             0,
                                             "TvController",
                                             QStringLiteral("TvController is supplied by the application"));

    const QString currentDirectory = QDir::currentPath();
    const QString channelsPath = parser.isSet(channelsOption)
        ? parser.value(channelsOption)
        : QDir(currentDirectory).filePath(QStringLiteral("config/examples/channels.json"));
    const QString settingsPath = parser.isSet(settingsOption)
        ? parser.value(settingsOption)
        : QDir(currentDirectory).filePath(QStringLiteral("config/examples/settings.json"));
    const QString mediaRoot = parser.isSet(mediaRootOption)
        ? parser.value(mediaRootOption)
        : QDir(QStandardPaths::writableLocation(QStandardPaths::MoviesLocation))
              .filePath(QStringLiteral("MabelTV"));
    const QString statePath = parser.isSet(stateOption)
        ? parser.value(stateOption)
        : QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
              .filePath(QStringLiteral("state.json"));
    const QString logDirectory = parser.isSet(logDirectoryOption)
        ? parser.value(logDirectoryOption)
        : QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
              .filePath(QStringLiteral("logs"));
    const QString ownerPath = qEnvironmentVariable(
        "MABELTV_OWNER", QStringLiteral("/var/lib/mabeltv/owner.json"));
    const QString tvDisplayName = ownerTvName(ownerPath);
    const QString libraryConfigurationPath = qEnvironmentVariable(
        "MABELTV_LIBRARY_CONFIG", QStringLiteral("/etc/mabeltv/library.conf"));
    const QString setupCode = configurationValue(libraryConfigurationPath,
                                                   QStringLiteral("MABELTV_SETUP_CODE"));
    const bool firstRunSetupRequired = !setupCode.isEmpty() && !ownerSetupComplete(ownerPath);
    const QString libraryUrl = QStringLiteral("http://%1.local:8080")
                                   .arg(QSysInfo::machineHostName().toLower());
    const QString lanAddress = firstLanAddress();
    const QString libraryIpUrl = lanAddress.isEmpty()
        ? QString()
        : QStringLiteral("http://%1:8080").arg(lanAddress);
    const QString setupQrPath = QStringLiteral("/run/mabeltv/setup-qr.png");
    const QUrl setupQrUrl = firstRunSetupRequired && QFileInfo::exists(setupQrPath)
        ? QUrl::fromLocalFile(setupQrPath)
        : QUrl();

    Logging::initialize(logDirectory);
    qInfo().noquote() << "Starting KidsTV" << tvDisplayName
                      << QCoreApplication::applicationVersion();
    qInfo().noquote() << "Channels:" << QDir::toNativeSeparators(channelsPath);
    qInfo().noquote() << "Settings:" << QDir::toNativeSeparators(settingsPath);
    qInfo().noquote() << "Media root:" << QDir::toNativeSeparators(mediaRoot);
    qInfo().noquote() << "State:" << QDir::toNativeSeparators(statePath);
    if (forceOpenGlEs2) {
        qInfo() << "Using OpenGL ES 2 compatibility mode for the libmpv fence-leak workaround";
    }
    const QUrl startupIntro = findStartupIntro(mediaRoot);
    if (startupIntro.isEmpty()) {
        qInfo() << "No startup intro was found; starting television directly";
    } else {
        qInfo().noquote() << "Startup intro:"
                          << QDir::toNativeSeparators(startupIntro.toLocalFile());
    }

    TvController television;
    television.initialize(channelsPath, settingsPath, mediaRoot, statePath);

#ifdef Q_OS_LINUX
    std::unique_ptr<QSocketNotifier> reloadNotifier;
    if (pipe2(reloadSignalPipe, O_NONBLOCK | O_CLOEXEC) == 0) {
        struct sigaction action {};
        action.sa_handler = requestLibraryReload;
        sigemptyset(&action.sa_mask);
        action.sa_flags = SA_RESTART;
        if (sigaction(SIGUSR1, &action, nullptr) == 0) {
            struct sigaction terminationAction {};
            terminationAction.sa_handler = requestCleanShutdown;
            sigemptyset(&terminationAction.sa_mask);
            terminationAction.sa_flags = SA_RESTART;
            const bool terminationSignalsReady =
                sigaction(SIGTERM, &terminationAction, nullptr) == 0
                && sigaction(SIGINT, &terminationAction, nullptr) == 0;
            if (!terminationSignalsReady) {
                qWarning() << "Unable to install clean shutdown signal handlers";
            }
            reloadNotifier = std::make_unique<QSocketNotifier>(reloadSignalPipe[0],
                                                               QSocketNotifier::Read);
            QObject::connect(reloadNotifier.get(),
                             &QSocketNotifier::activated,
                             &application,
                             [&television, &application](QSocketDescriptor,
                                                         QSocketNotifier::Type) {
                                 char requests[32];
                                 bool shouldReload = false;
                                 bool shouldStop = false;
                                 ssize_t count = 0;
                                 while ((count = read(reloadSignalPipe[0], requests,
                                                      sizeof(requests))) > 0) {
                                     for (ssize_t index = 0; index < count; ++index) {
                                         shouldReload = shouldReload || requests[index] == 'R';
                                         shouldStop = shouldStop || requests[index] == 'Q';
                                     }
                                 }
                                 if (shouldStop) {
                                     qInfo() << "Received an orderly shutdown request";
                                     application.quit();
                                     return;
                                 }
                                 if (shouldReload) {
                                     qInfo() << "Reloading the media library without restarting KidsTV";
                                     television.reloadLibrary();
                                 }
                             });
        } else {
            qWarning() << "Unable to install the live library reload signal";
        }
    } else {
        qWarning() << "Unable to create the live library reload channel";
    }
#endif
    QObject::connect(&television,
                     &TvController::parentCommandRequested,
                     &application,
                     [&application](const QString &command) {
                         if (command == QStringLiteral("exit")) {
                             application.quit();
                         } else if (command == QStringLiteral("restart")) {
#ifdef Q_OS_WIN
                             QProcess::startDetached(QCoreApplication::applicationFilePath(),
                                                     QCoreApplication::arguments().sliced(1));
                             application.quit();
#else
                             QCoreApplication::exit(42);
#endif
                         } else if (command == QStringLiteral("shutdown")) {
#ifdef Q_OS_LINUX
                             const bool started = QProcess::startDetached(
                                 QStringLiteral("sudo"),
                                 {QStringLiteral("-n"),
                                  QStringLiteral("/usr/bin/systemctl"),
                                  QStringLiteral("poweroff")});
                             if (!started) {
                                 qCritical() << "Unable to start the safe-shutdown helper";
                             }
#else
                             qWarning() << "Safe shutdown is only available on the Raspberry Pi build";
#endif
                         }
                     });

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("startupMediaUrl"), startupMedia);
    engine.rootContext()->setContextProperty(QStringLiteral("startupIntroUrl"), startupIntro);
    engine.rootContext()->setContextProperty(QStringLiteral("directMediaMode"), !startupMedia.isEmpty());
    engine.rootContext()->setContextProperty(QStringLiteral("firstRunSetupRequired"),
                                             firstRunSetupRequired);
    engine.rootContext()->setContextProperty(QStringLiteral("firstRunSetupCode"), setupCode);
    engine.rootContext()->setContextProperty(QStringLiteral("firstRunLibraryUrl"), libraryUrl);
    engine.rootContext()->setContextProperty(QStringLiteral("firstRunLibraryIpUrl"), libraryIpUrl);
    engine.rootContext()->setContextProperty(QStringLiteral("firstRunSetupQrUrl"), setupQrUrl);
    engine.rootContext()->setContextProperty(QStringLiteral("tvDisplayName"), tvDisplayName);
    engine.rootContext()->setContextProperty(QStringLiteral("tvController"), &television);
    engine.load(QUrl(QStringLiteral("qrc:/qml/Main.qml")));
    if (engine.rootObjects().isEmpty()) {
        return 3;
    }

#ifdef Q_OS_LINUX
    // The library service is the only network-facing component.  It forwards
    // a deliberately small command set over this private, owner-only socket;
    // the player never opens another TCP port on the home network.
    QLocalServer portalControlServer;
    const QString portalControlPath = QStringLiteral("/run/mabeltv/portal-control.sock");
    QLocalServer::removeServer(portalControlPath);
    portalControlServer.setSocketOptions(QLocalServer::UserAccessOption);
    if (!portalControlServer.listen(portalControlPath)) {
        qWarning().noquote() << "Unable to start portal control socket:"
                             << portalControlServer.errorString();
    } else {
        QObject *rootObject = engine.rootObjects().constFirst();
        QObject::connect(&portalControlServer,
                         &QLocalServer::newConnection,
                         &application,
                         [&portalControlServer, rootObject]() {
                             while (portalControlServer.hasPendingConnections()) {
                                 QLocalSocket *socket = portalControlServer.nextPendingConnection();
                                 QObject::connect(socket,
                                                  &QLocalSocket::readyRead,
                                                  socket,
                                                  [socket, rootObject]() {
                                                      const QString command = QString::fromUtf8(
                                                          socket->readAll()).trimmed();
                                                      static const QSet<QString> allowed{
                                                          QStringLiteral("channel-up"),
                                                          QStringLiteral("channel-down"),
                                                          QStringLiteral("previous-programme"),
                                                          QStringLiteral("next-programme"),
                                                          QStringLiteral("toggle-pause"),
                                                          QStringLiteral("volume-up"),
                                                          QStringLiteral("volume-down"),
                                                          QStringLiteral("toggle-mute"),
                                                          QStringLiteral("toggle-power"),
                                                          QStringLiteral("enter-adult-mode"),
                                                      };
                                                      if (allowed.contains(command)) {
                                                          QMetaObject::invokeMethod(
                                                              rootObject,
                                                              "portalCommand",
                                                              Qt::QueuedConnection,
                                                              Q_ARG(QVariant, command));
                                                          socket->write("ok\n");
                                                      } else {
                                                          socket->write("unsupported\n");
                                                      }
                                                      socket->disconnectFromServer();
                                                  });
                             }
                         });
    }
#endif

    if (parser.isSet(fullscreenOption)) {
        if (auto *window = qobject_cast<QWindow *>(engine.rootObjects().constFirst())) {
            window->showFullScreen();
        }
    }

    // The systemd watchdog proves that the Qt event loop is alive. This
    // additional heartbeat proves that libmpv is still delivering frames;
    // otherwise a decoder/render stall could leave a frozen picture while the
    // main loop continued to report itself healthy forever.
    auto *video = engine.rootObjects().constFirst()->findChild<MpvVideo *>(
        QStringLiteral("mabeltvPlayer"));
    if (video == nullptr) {
        qCritical() << "The QML scene did not create the KidsTV video player";
        return 45;
    }
    if (!video->available()) {
        qCritical() << "libmpv was unavailable after the QML scene started";
        return 45;
    }
    QObject::connect(video,
                     &MpvVideo::fatalPlayerFailure,
                     &application,
                     [&application](const QString &message) {
                         qCritical().noquote() << "Fatal video-player failure:" << message;
                         notifyService("STATUS=Video engine failed; restarting");
                         application.exit(45);
                     });
    QTimer playbackHealthTimer;
    std::uint64_t previousFrameCount = video->renderedFrameCount();
    int stagnantPlaybackChecks = 0;
    int stagnantLoadingChecks = 0;
    playbackHealthTimer.setInterval(15'000);
    QObject::connect(&playbackHealthTimer,
                     &QTimer::timeout,
                     &application,
                     [&application,
                       video,
                       &television,
                      &previousFrameCount,
                      &stagnantPlaybackChecks,
                      &stagnantLoadingChecks]() {
                         if (video != nullptr
                             && (video->status() == QStringLiteral("Loading")
                                 || video->status() == QStringLiteral("Preparing video"))) {
                             ++stagnantLoadingChecks;
                             if (stagnantLoadingChecks >= 4) {
                                  qCritical() << "Playback remained in a loading state for 60 seconds; requesting a controlled restart";
                                  television.prepareForPlaybackRestart(
                                      QStringLiteral("The programme remained stuck while loading"));
                                 notifyService("STATUS=Playback load stalled; restarting");
                                 application.exit(44);
                             }
                             return;
                         }
                         stagnantLoadingChecks = 0;
                         if (video == nullptr || video->status() != QStringLiteral("Playing")
                             || video->paused()) {
                             stagnantPlaybackChecks = 0;
                             if (video != nullptr) {
                                 previousFrameCount = video->renderedFrameCount();
                             }
                             return;
                         }
                         const std::uint64_t frameCount = video->renderedFrameCount();
                         if (frameCount == previousFrameCount) {
                             ++stagnantPlaybackChecks;
                         } else {
                             stagnantPlaybackChecks = 0;
                         }
                         previousFrameCount = frameCount;
                         if (stagnantPlaybackChecks >= 4) {
                              qCritical() << "Playback rendered no frames for 60 seconds; requesting a controlled restart";
                              television.prepareForPlaybackRestart(
                                  QStringLiteral("The programme stopped producing video frames"));
                             notifyService("STATUS=Playback stalled; restarting");
                             application.exit(43);
                         }
                     });
    playbackHealthTimer.start();

    // systemd's watchdog ping is deliberately driven by Qt's main event loop.
    // If the UI wedges, systemd records a watchdog failure and restarts the
    // application; ExecStopPost preserves the evidence first.
    QTimer watchdogTimer;
    watchdogTimer.setInterval(15'000);
    QObject::connect(&watchdogTimer, &QTimer::timeout, &application, []() {
        notifyService("WATCHDOG=1");
    });
    notifyService("READY=1\nSTATUS=Playing television");
    watchdogTimer.start();

    const int result = application.exec();
    notifyService("STOPPING=1\nSTATUS=Stopping television");
    qInfo() << "KidsTV exited with code" << result;
    Logging::shutdown();
    return result;
}
