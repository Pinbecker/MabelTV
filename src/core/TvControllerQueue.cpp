#include "TvController.h"
#include "StateDatabase.h"
#include <QFileInfo>

bool TvController::playQueuedProgramme(bool start, bool previous)
{
    QString error;
    const auto queued = previous
        ? mabeltv::state::previousMabelQueue(m_databasePath, &error)
        : mabeltv::state::advanceMabelQueue(m_databasePath, start, &error);
    if (!error.isEmpty()) {
        qWarning().noquote() << "Could not advance queue:" << error;
        m_libraryStatus = error;
        emit libraryStatusChanged();
        emit stopPlaybackRequested();
        return true;
    }
    if (!queued.claimed) return false;
    if (queued.allDone) {
        emit stopPlaybackRequested();
        emit queueAllDoneRequested();
        saveState();
        return true;
    }
    if (queued.item.isEmpty()) return false;
    const int number = queued.item.value("channel").toInt();
    const QString file = queued.item.value("file").toString();
    const int index = findChannelByNumber(number, true);
    bool available = false;
    if (index >= 0 && m_channels[index].enabled) {
        const auto &target = m_channels[index];
        for (int i=0; i<target.channel.episodes.size(); ++i) {
            if (QFileInfo(target.channel.episodes[i].path).fileName() == file
                && episodeIsUsable(target,i)) { available = true; break; }
        }
    }
    if (!available) {
        m_libraryStatus = "Queue paused: " + queued.item.value("title").toString()
            + " is not available. Remove it or choose another queued programme.";
        mabeltv::state::failMabelQueue(m_databasePath,m_libraryStatus);
        emit libraryStatusChanged();
        emit stopPlaybackRequested();
        return true;
    }
    if (m_currentChannelIndex >= 0) {
        freezeTimeline(m_channels[m_currentChannelIndex]);
        markCurrentEpisodeLeft(m_channels[m_currentChannelIndex]);
    }
    emit queueItemStarted();
    m_queueTransition = true;
    m_queueLastSavedPosition = -10;
    playPortalProgramme(number,file,queued.item.value("position").toDouble());
    m_queueTransition = false;
    return true;
}

void TvController::startMabelQueue()
{
    if (!m_standby) playQueuedProgramme(true);
}

void TvController::queuePlaybackStarted(const QUrl &source)
{
    if (m_currentChannelIndex < 0 || m_standby) return;
    const auto &runtime = m_channels[m_currentChannelIndex];
    if (runtime.currentEpisode < 0) return;
    const QString path = runtime.channel.episodes[runtime.currentEpisode].path;
    if (QFileInfo(source.toLocalFile()).absoluteFilePath() != QFileInfo(path).absoluteFilePath()) return;
    mabeltv::state::markMabelQueuePlaying(m_databasePath,runtime.channel.number,QFileInfo(path).fileName());
}

void TvController::pauseQueuePlaybackForTransfer()
{
    if (m_currentChannelIndex >= 0) freezeTimeline(m_channels[m_currentChannelIndex]);
    emit stopPlaybackRequested();
    m_playbackPaused = true;
    saveState();
}

void TvController::pauseMabelQueue()
{
    mabeltv::state::stopMabelQueue(m_databasePath);
}
