import QtQuick
import MabelTV 1.0
import "../../qml"
Rectangle {
    id: fixture
    width: 960; height: 540; color: "magenta"
    property int volume: 50
    property bool muted: false
    property bool standby: true
    property string connectedTvPower: "on"
    property string currentChannelName: "Children's TV"
    property int currentChannelNumber: 1
    property string currentContentType: "shows"
    property int turnOns: 0
    property int resumes: 0
    property var player: childPlayer
    signal familyMemoryRequested(int number)
    signal channelChanged()
    function syncPlaybackPosition() {}
    function updatePlaybackPosition(position, force) {}
    function pauseQueuePlaybackForTransfer() {}
    function portalCommand(value) {}
    function cancelFilmCountdown() {}
    function prepareFamilyAudioOnly() {}
    function turnOn() { turnOns++; standby = false }
    function resumeFromStandby() { resumes++ }
    MpvVideo { id: childPlayer; paused: true }
    FamilyMediaCoordinator { id: family; objectName: "family"; appRoot: fixture; controller: fixture }
}
