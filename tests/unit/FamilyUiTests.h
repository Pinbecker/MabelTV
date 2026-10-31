#pragma once
#include <QObject>

class FamilyUiTests final : public QObject
{
    Q_OBJECT
private slots:
    void initTestCase();
    void audioOnlyStoryWakesOnBlackAndRemainsBlackAtEnd();
    void illustrationTravelsWithLeafAndLandsWithoutJump();
    void storybookAndPlaybackRespectStandbyAndBack();
    void memoriesOwnOkReleaseAndDeferredChildResume();
    void compositionsRenderWholePhotosAndPauseTheirMotion();
    void memoryVideoClipsSharePhotoStageAndAdvanceAtClipEnd();
    void storytimeLibraryNavigationAndClosingAreInterruptible();
};
