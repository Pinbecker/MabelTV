pragma ComponentBehavior: Bound
import QtQuick
import MabelTV 1.0
import "../../qml"

Item {
    id: fixture
    width: 1920; height: 1080
    property bool poweringOff: false
    property string pendingPowerAction: ""
    property bool muteHeldForLock: false
    property bool okHeldForGuide: false
    property bool previousHeldForParent: false
    property bool previousHeldForRestart: false
    property bool homeHeldForChannelSummary: false
    property bool remoteLocked: false
    property bool standby: false
    property bool muted: false
    property int volume: 50
    property int currentChannelNumber: 5
    property string currentContentType: "films"
    property int childStarts: 0
    property string lastChildSource: ""
    property int resumes: 0
    property bool restoreChildPauseAfterMyTv: true
    property int pendingPortalTuneChannel: -1
    property bool pendingQueueStart: false
    property int pendingPortalChannel: -1
    property string pendingPortalProgramme: ""
    property real pendingPortalProgrammePosition: 0
    property var familyMedia: family
    property var player: childPlayer
    property var mabelPresentation: overlay
    signal familyMemoryRequested(int number)
    signal channelChanged()
    function togglePlaybackPause() { childStarts++ }
    function startControllerPlayback(source, position) { childStarts++; lastChildSource = source }
    function resumeFromStandby() { resumes++ }
    function seedChildHold() { guideTimer.start(); okHeldForGuide = false }
    function seedResume() { resumeDelay.restart() }
    component Overlay: QtObject {
        property bool active: false
        property bool visible: false
        function handleKey(key, repeat) { return false }
        function handleKeyReleased(key, repeat) { return false }
    }
    Overlay { id: overlay }
    MpvVideo { id: childPlayer }
    Timer { id: muteTimer; interval: 3000 }
    Timer { id: guideTimer; objectName: "childGuideHold"; interval: 3500 }
    Timer { id: parentTimer; interval: 3500 }
    Timer { id: emergency; interval: 6000 }
    Timer { id: channelHold; interval: 900 }
    FamilyMediaCoordinator {
        id: family; objectName: "family"; appRoot: fixture; controller: fixture
        active: true; ready: true
        session: ({ kind: "memories", title: "Family Videos", channel: 10, settings: {}, scenes: [
            { kind: "photo", seconds: 30, items: [{ id: "first", source: memoryPicture }] },
            { kind: "photo", seconds: 30, items: [{ id: "second", source: memoryPicture }] },
            { kind: "photo", seconds: 30, items: [{ id: "third", source: memoryPicture }] }
        ] })
    }
    MyTvResumeCoordinator { id: resumeDelay; appRoot: fixture; controller: fixture; familyPlayer: family }
    RemoteInputHandler {
        objectName: "familyRemoteInput"
        appRoot: fixture; controllerObject: fixture; myTvOverlay: overlay
        channelOverlay: overlay; guide: overlay; parentMenu: overlay
        muteHold: muteTimer; guideHold: guideTimer; parentHold: parentTimer
        emergencyRestart: emergency; channelSummaryHold: channelHold
    }
}
