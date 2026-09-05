#pragma once

#include <QFileInfo>
#include <QRegularExpression>
#include <QString>
#include <QStringList>

namespace mabeltv::detail
{
inline QString cycleValue(const QStringList &values, const QString &current, int direction)
{
    int index = values.indexOf(current);
    if (index < 0) {
        index = 0;
    }
    const int count = static_cast<int>(values.size());
    index = (index + (direction < 0 ? -1 : 1) + count) % count;
    return values[index];
}

struct EpisodeDisplay
{
    QString name;
    QString title;
    int seriesNumber = 0;
    int episodeNumber = 0;
};

inline EpisodeDisplay episodeDisplayForPath(const QString &path)
{
    QString name = QFileInfo(path).completeBaseName();
    name.replace(QLatin1Char('_'), QLatin1Char(' '));
    name = name.simplified();

    static const QRegularExpression episodePattern(
        QStringLiteral("^S(\\d{1,2})E(\\d{1,3})\\s*-\\s*(.+)$"),
        QRegularExpression::CaseInsensitiveOption);
    const QRegularExpressionMatch match = episodePattern.match(name);
    if (!match.hasMatch()) {
        return EpisodeDisplay{name, name, 0, 0};
    }

    const int seriesNumber = match.captured(1).toInt();
    const int episodeNumber = match.captured(2).toInt();
    const QString title = match.captured(3).simplified();
    return EpisodeDisplay{
        QStringLiteral("S%1  E%2  ·  %3")
            .arg(QString::number(seriesNumber).rightJustified(2, QLatin1Char('0')),
                 QString::number(episodeNumber).rightJustified(2, QLatin1Char('0')),
                 title),
        title,
        seriesNumber,
        episodeNumber,
    };
}

inline QString displayNameForEpisodePath(const QString &path)
{
    return episodeDisplayForPath(path).name;
}
} // namespace mabeltv::detail
