import QtQuick

Item {
    id: detailView
    required property var host
    property var detail: ({})
    property var providers: []
    property var episodes: []
    property int selectedAction: 0
    property int selectedSeason: 0
    property bool loading: false
    signal closed()

    anchors.fill: parent

    Image {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: parent.width * 0.46
        source: host.artworkUrl(detail, true)
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
    }
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "#00f4f6f9" }
            GradientStop { position: 0.43; color: "#d9f4f6f9" }
            GradientStop { position: 0.58; color: "#fff4f6f9" }
        }
    }
    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: parent.height * 0.30
        gradient: Gradient {
            GradientStop { position: 0; color: "#00f4f6f9" }
            GradientStop { position: 1; color: "#fff4f6f9" }
        }
    }

    Text {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.margins: 38 * host.uiScale
        color: "#65707c"
        font.family: "DejaVu Sans"
        font.bold: true
        font.pixelSize: 17 * host.uiScale
        text: "‹  Back to Watch"
    }

    Flickable {
        anchors.left: parent.left
        anchors.leftMargin: parent.width * 0.43
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.topMargin: 65 * host.uiScale
        anchors.rightMargin: 55 * host.uiScale
        anchors.bottomMargin: 34 * host.uiScale
        contentHeight: content.implicitHeight
        clip: true

        Column {
            id: content
            width: parent.width
            spacing: 14 * host.uiScale
            Text {
                width: parent.width
                color: host.accent
                font.family: "DejaVu Sans"
                font.bold: true
                font.letterSpacing: 2.4 * host.uiScale
                font.pixelSize: 13 * host.uiScale
                text: (detailView.detail.media_type === "tv" ? "SERIES" : "FILM")
                    + (detailView.detail.on_mabeltv ? "  ·  ON " + tvDisplayName.toUpperCase() : "")
            }
            Text {
                width: parent.width
                color: "#11151d"
                wrapMode: Text.Wrap
                maximumLineCount: 2
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 48 * host.uiScale
                lineHeight: 0.95
                text: detailView.detail.title || "Loading…"
            }
            Row {
                spacing: 12 * host.uiScale
                Rectangle {
                    visible: Number(detailView.detail.rating || 0) > 0
                    width: score.implicitWidth + 18 * host.uiScale
                    height: 32 * host.uiScale
                    radius: 7 * host.uiScale
                    color: host.accent
                    Text {
                        id: score
                        anchors.centerIn: parent
                        color: "#07362f"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 14 * host.uiScale
                        text: "★ " + Number(detailView.detail.rating || 0).toFixed(1)
                    }
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#596270"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 15 * host.uiScale
                    text: [detailView.detail.year || "",
                           detailView.detail.certification || "",
                           detailView.detail.runtime ? detailView.detail.runtime + " min" : "",
                           (detailView.detail.genres || []).slice(0, 3).join(" · ")]
                        .filter(value => value).join("   ")
                }
            }
            Text {
                width: parent.width
                color: "#454e5b"
                wrapMode: Text.Wrap
                maximumLineCount: 4
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.pixelSize: 17 * host.uiScale
                lineHeight: 1.24
                text: detailView.detail.overview || "No description is available yet."
            }

            Row {
                spacing: 10 * host.uiScale
                Repeater {
                    model: host.detailActions(detailView.detail)
                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: actionText.implicitWidth + 30 * host.uiScale
                        height: 48 * host.uiScale
                        radius: 10 * host.uiScale
                        color: index === detailView.selectedAction
                            ? host.accent : "white"
                        border.width: index === detailView.selectedAction ? 3 * host.uiScale : 1
                        border.color: index === detailView.selectedAction ? "white" : "#d7dce2"
                        Text {
                            id: actionText
                            anchors.centerIn: parent
                            color: "#11231f"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 15 * host.uiScale
                            text: modelData.label
                        }
                    }
                }
            }

            Text {
                visible: detailView.providers.length > 0
                color: "#161b22"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 20 * host.uiScale
                text: "Where to watch"
            }
            Row {
                visible: detailView.providers.length > 0
                spacing: 11 * host.uiScale
                Repeater {
                    model: detailView.providers.slice(0, 6)
                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: 152 * host.uiScale
                        height: 62 * host.uiScale
                        radius: 12 * host.uiScale
                        color: "white"
                        border.width: index + host.detailActions(detailView.detail).length
                            === detailView.selectedAction ? 3 * host.uiScale : 1
                        border.color: index + host.detailActions(detailView.detail).length
                            === detailView.selectedAction ? host.accent : "#d7dce2"
                        Row {
                            anchors.fill: parent
                            anchors.margins: 9 * host.uiScale
                            spacing: 9 * host.uiScale
                            MyTvProviderIcon {
                                anchors.verticalCenter: parent.verticalCenter
                                provider: modelData
                                badgeSize: 42 * host.uiScale
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 52 * host.uiScale
                                color: "#1a2028"
                                elide: Text.ElideRight
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 13 * host.uiScale
                                text: modelData.name
                            }
                        }
                    }
                }
            }

            Text {
                visible: detailView.detail.media_type === "tv"
                color: "#161b22"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 20 * host.uiScale
                text: "Series"
            }
            Row {
                visible: detailView.detail.media_type === "tv"
                spacing: 8 * host.uiScale
                Repeater {
                    model: detailView.detail.seasons || []
                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: seasonText.implicitWidth + 24 * host.uiScale
                        height: 38 * host.uiScale
                        radius: 8 * host.uiScale
                        color: index === detailView.selectedSeason ? host.accent : "white"
                        border.width: 1
                        border.color: "#d6dce2"
                        Text {
                            id: seasonText
                            anchors.centerIn: parent
                            color: "#17211f"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 13 * host.uiScale
                            text: modelData.name || "Series " + modelData.number
                        }
                    }
                }
            }
            Row {
                visible: detailView.episodes.length > 0
                spacing: 10 * host.uiScale
                Repeater {
                    model: detailView.episodes.slice(0, 4)
                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: 190 * host.uiScale
                        height: 72 * host.uiScale
                        radius: 10 * host.uiScale
                        color: "white"
                        border.width: 1
                        border.color: "#d7dce2"
                        Column {
                            anchors.fill: parent
                            anchors.margins: 10 * host.uiScale
                            spacing: 4 * host.uiScale
                            Text { color: host.accent; font.bold: true; font.pixelSize: 11 * host.uiScale; text: "E" + modelData.episode }
                            Text { width: parent.width; color: "#151922"; elide: Text.ElideRight; font.bold: true; font.pixelSize: 13 * host.uiScale; text: modelData.title || "Episode " + modelData.episode }
                        }
                    }
                }
            }

            Text {
                visible: (detailView.detail.cast || []).length > 0
                color: "#161b22"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 20 * host.uiScale
                text: "Cast"
            }
            Row {
                spacing: 18 * host.uiScale
                Repeater {
                    model: (detailView.detail.cast || []).slice(0, 5)
                    delegate: Row {
                        required property var modelData
                        spacing: 8 * host.uiScale
                        Rectangle {
                            width: 42 * host.uiScale; height: width; radius: width / 2; color: "#dfe4e9"
                            Text { anchors.centerIn: parent; color: "#57616d"; font.bold: true; text: modelData.name.split(" ").map(value => value[0]).join("").slice(0, 2) }
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            Text { color: "#171c23"; font.bold: true; font.pixelSize: 12 * host.uiScale; text: modelData.name }
                            Text { color: "#747d89"; font.pixelSize: 10 * host.uiScale; text: modelData.character || "Cast" }
                        }
                    }
                }
            }
        }
    }

    function open(value) {
        detail = value
        providers = host.detailProviders(value)
        episodes = []
        selectedAction = 0
        if (value.media_type === "tv" && (value.seasons || []).length)
            loadSeason(0)
    }

    function loadSeason(index) {
        selectedSeason = index
        const season = (detail.seasons || [])[index]
        if (!season) return
        host.request("/api/native/my-tv/season?tmdb_id=" + detail.tmdb_id
                     + "&season=" + season.number, "GET", null, result => {
            episodes = result.episodes || []
        })
    }

    function handleKey(key) {
        const actions = host.detailActions(detail)
        const total = actions.length + providers.length
        if (key === Qt.Key_Left) selectedAction = Math.max(0, selectedAction - 1)
        else if (key === Qt.Key_Right) selectedAction = Math.min(Math.max(0, total - 1), selectedAction + 1)
        else if ((key === Qt.Key_Return || key === Qt.Key_Enter)) {
            if (selectedAction < actions.length) host.runDetailAction(actions[selectedAction], detail)
            else host.launchProvider(providers[selectedAction - actions.length], detail)
        } else if (key === Qt.Key_Up && detail.media_type === "tv" && selectedSeason > 0) {
            loadSeason(selectedSeason - 1)
        } else if (key === Qt.Key_Down && detail.media_type === "tv"
                   && selectedSeason + 1 < (detail.seasons || []).length) {
            loadSeason(selectedSeason + 1)
        } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) closed()
        else return false
        return true
    }
}
