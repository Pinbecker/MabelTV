import "../../qml"
import QtQuick
Item {
    id: fixture
    property bool active: false
    property bool playing: false
    property bool stopping: false
    property bool closing: false
    property bool poweringOff: false
    property string pendingPowerAction: ""
    property bool portalTransitionPending: false
    property var familyMedia: fixture
    property var channelOverlay: fixture
    property int plays: 0
    property int stops: 0
    property real position: -1
    signal closed()
    function close(resume) {}
    function enterMyTvMode() { active = true }
    function loadPortalPlayback(path, ready) {
        ready({item:{id:"episode",source:"file:///episode.mp4"},position:125})
    }
    function stopFilm() { stops++; stopping = true }
    function startNativePlayback(item, start) {
        plays++; position = start; playing = true; stopping = false
    }
    MyTvPortalPlayback { objectName:"bridge"; appRoot:fixture; host:fixture }
}
