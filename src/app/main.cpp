#include "core/TvController.h"
#include "diagnostics/Logging.h"
#include "media/MpvVideo.h"
#include "media/SoundEffects.h"

#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QCursor>
#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QProcess>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSet>
#include <QStandardPaths>
#include <QSurfaceFormat>
#include <QUrl>
#include <QWindow>

#include <mpv/client.h>

#include <algorithm>
#include <locale.h>

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
        if (candidate.completeBaseName().compare(QStringLiteral("MabelTV"),
                                                 Qt::CaseInsensitive)
                == 0
            && supportedExtensions.contains(candidate.suffix().toLower())) {
            return QUrl::fromLocalFile(candidate.absoluteFilePath());
        }
    }
    return {};
}

bool hasArgument(int argc, char *argv[], const char *argument)
{
    return std::any_of(argv + 1, argv + argc, [argument](const char *value) {
        return QByteArray(value) == QByteArray(argument);
    });
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
        // every embedded frame.  The GLES 2 path does not expose GL_ARB_sync,
        // so the affected libmpv code is never entered.  This remains a
        // supported renderer for both Qt Quick and libmpv on the Pi.
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
    QCoreApplication::setApplicationName(QStringLiteral("Mabel TV"));
    QCoreApplication::setApplicationVersion(QStringLiteral(MABELTV_VERSION));
    QCoreApplication::setOrganizationName(QStringLiteral("MabelTV"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("Mabel TV child-friendly television player"));
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

    Logging::initialize(logDirectory);
    qInfo().noquote() << "Starting Mabel TV" << QCoreApplication::applicationVersion();
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
    engine.rootContext()->setContextProperty(QStringLiteral("tvController"), &television);
    engine.load(QUrl(QStringLiteral("qrc:/qml/Main.qml")));
    if (engine.rootObjects().isEmpty()) {
        return 3;
    }

    if (parser.isSet(fullscreenOption)) {
        if (auto *window = qobject_cast<QWindow *>(engine.rootObjects().constFirst())) {
            window->showFullScreen();
        }
    }

    const int result = application.exec();
    qInfo() << "Mabel TV exited with code" << result;
    Logging::shutdown();
    return result;
}
