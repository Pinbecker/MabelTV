#include "library/ChannelLibrary.h"
#include "library/MediaIndex.h"

#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDir>
#include <QStandardPaths>
#include <QTextStream>

int main(int argc, char *argv[])
{
    QCoreApplication application(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("Mabel TV Media Check"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("Validate a Mabel TV channel library"));
    parser.addHelpOption();
    const QCommandLineOption channelsOption(QStringLiteral("channels"),
                                             QStringLiteral("Path to channels.json."),
                                             QStringLiteral("file"));
    const QCommandLineOption mediaRootOption(QStringLiteral("media-root"),
                                              QStringLiteral("Root directory containing channel folders."),
                                              QStringLiteral("directory"));
    const QCommandLineOption cacheOption(QStringLiteral("cache"),
                                          QStringLiteral("Path to the media validation cache."),
                                          QStringLiteral("file"));
    const QCommandLineOption strictOption(QStringLiteral("strict"),
                                           QStringLiteral("Return a non-zero status when warnings are found."));
    parser.addOption(channelsOption);
    parser.addOption(mediaRootOption);
    parser.addOption(cacheOption);
    parser.addOption(strictOption);
    parser.process(application);

    const QString channelsPath = parser.isSet(channelsOption)
        ? parser.value(channelsOption)
        : QDir::current().filePath(QStringLiteral("config/examples/channels.json"));
    const QString mediaRoot = parser.isSet(mediaRootOption)
        ? parser.value(mediaRootOption)
        : QDir(QStandardPaths::writableLocation(QStandardPaths::MoviesLocation))
              .filePath(QStringLiteral("MabelTV"));
    const QString cachePath = parser.isSet(cacheOption)
        ? parser.value(cacheOption)
        : QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
              .filePath(QStringLiteral("media-index.json"));

    MediaIndex index(cachePath);
    const ChannelLibraryResult library = ChannelLibrary::load(
        channelsPath, mediaRoot, [&index](const QString &path) { return index.inspect(path); });
    const bool cacheSaved = index.save();

    QTextStream output(stdout);
    if (!library.isValid()) {
        output << "ERROR: " << library.error << "\n";
        return 1;
    }

    int episodeCount = 0;
    for (const Channel &channel : library.channels) {
        episodeCount += static_cast<int>(channel.episodes.size());
        output << "CH " << channel.number << "  " << channel.name << ": " << channel.episodes.size()
               << " usable episode(s)\n";
    }
    for (const QString &warning : library.warnings) {
        output << "WARNING: " << warning << "\n";
    }
    if (!cacheSaved) {
        output << "WARNING: Could not save the media validation cache.\n";
    }
    output << "Checked " << library.channels.size() << " channel(s), " << episodeCount
           << " usable episode(s).\n";
    output.flush();

    return parser.isSet(strictOption) && (!library.warnings.isEmpty() || !cacheSaved) ? 2 : 0;
}
