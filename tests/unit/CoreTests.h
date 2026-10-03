#pragma once
#include <QObject>

class CoreTests final : public QObject
{
    Q_OBJECT

private slots:
    void shuffleBagVisitsEveryItemBeforeRepeating();
    void shuffleBagAvoidsImmediateRepeatAcrossRefill();
    void channelLibraryLoadsAndSortsValidChannels();
    void channelLibraryKeepsMissingFoldersAsNoSignalChannels();
    void controllerTunesNumericChannelsAndHonoursVolumeLimit();
    void controllerClearsNoSignalWhenReturningToPopulatedChannel();
    void controllerSkipsAnEpisodeAfterPlaybackFailure();
    void controllerDoesNotPersistWatchdogQuarantine();
    void controllerMovesBetweenProgrammesInFilenameOrder();
    void controllerRestartsStaleShowsButNeverFilms();
    void controllerDisplaysSeasonEpisodeOrFilmNameWhenProgrammeChanges();
    void controllerRestoresCorruptFilmPositionWithoutChangingFilm();
    void standbyWakeWaitsForWelcomeBeforeResumingPlayback();
    void cecFailureDoesNotBlockMabelTvStandbyOrWake();
    void remoteLockBlocksActionsAndPersists();
    void parentControlsRequireThreeConfirmationsAndPersistSettings();
    void tvGuideBuildsOrderedScheduleAndTunesChannels();
    void parentLibraryControlsPersistAndAffectPlayback();
    void currentChannelSummaryIncludesArtworkMetadataAndFilmProgress();
    void controllerReloadPreservesPlaybackAndRuntimeVolume();
    void filmChannelBookmarksPersistAcrossTvAndPortalPlayback();
    void myTvLibraryIsSeparateAndParentOnly();
    void sqliteStateIsReadableAndWritableByNativeController();
    void queuePlaybackRetainsCurrentAndFollowsRemoteSkips();
    void portalControlCommandsAreNewlineFramed();
};
