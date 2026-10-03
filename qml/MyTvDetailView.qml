pragma ComponentBehavior: Bound
import QtQuick

Rectangle {
    id: detailView
    objectName: "myTvDetail"
    required property var host
    property var detail: ({})
    property var providers: []
    property var episodes: []
    property bool loading: false
    property bool loadFailed: false
    property bool providersLoading: false
    property bool seasonLoading: false
    property string seasonError: ""
    property int zone: 0
    property int selectedAction: 0
    property int selectedProvider: 0
    property int selectedSeason: 0
    property bool seasonChosen: false
    property int selectedEpisode: 0
    property int selectedCast: 0
    property int seasonGeneration: 0
    property int providerGeneration: 0
    property var seasonRequest: null
    property var providerRequest: null
    readonly property real uiScale: host.uiScale
    readonly property var seasons: detail.seasons || []
    readonly property var highlightedEpisode: episodes[selectedEpisode] || null
    readonly property var resumeEpisode: detail.media_type === "tv" ? detail.next_playable : null
    readonly property string seriesContext: detail.media_type === "tv" && resumeEpisode
        ? (detail.series_progress?.state === "complete" ? "Series completed · Watch again"
            : (detail.series_progress?.state === "resume" ? "Continue · " : "Up next · ")
                + "S" + resumeEpisode.season + " E" + resumeEpisode.number
                + (resumeEpisode.name ? " · " + resumeEpisode.name : "")) : ""
    readonly property var actions: loadFailed ? [{ label: "Retry title information", retry: true }] : detail.on_mabeltv ? [
        { label: resumeEpisode ? (resumeEpisode.remote_position >= 30 ? "Resume" : "Play") + " S" + resumeEpisode.season + " E" + resumeEpisode.number
            : (detail.progress?.position >= 30 ? "Resume" : "Play") + " on " + host.tvDisplayName, restart: false },
        { label: "Play from start", restart: true }] : []
    signal closed()
    anchors.fill: parent
    color: "#f3f5f7"

    MyTvControl {
        x: 60 * detailView.uiScale; y: 18 * detailView.uiScale
        width: 268 * detailView.uiScale; height: 48 * detailView.uiScale
        uiScale: detailView.uiScale; radius: height / 2
        Row {
            anchors.centerIn: parent; spacing: 12 * detailView.uiScale
            MyTvIcon { name: "back"; width: 23 * detailView.uiScale; height: width; anchors.verticalCenter: parent.verticalCenter }
            MyTvText { font.weight: Font.DemiBold; font.pixelSize: 21 * detailView.uiScale; text: "Back to My TV" }
        }
    }
    Column {
        x: 520 * detailView.uiScale; y: 85 * detailView.uiScale
        width: parent.width - x - 60 * detailView.uiScale; spacing: 8 * detailView.uiScale
        MyTvText {
            width: parent.width; color: "#15212b"; font.weight: Font.Bold; font.letterSpacing: -0.8 * detailView.uiScale
            font.pixelSize: 52 * detailView.uiScale; elide: Text.ElideRight
            text: detailView.detail.title || ""
        }
        MyTvText {
            objectName: "episodeContext"
            width: parent.width; color: "#008b79"; font.pixelSize: 22 * detailView.uiScale; elide: Text.ElideRight
            text: detailView.detail.media_type === "tv" && detailView.seasons.length
                ? (detailView.zone === 3 && detailView.highlightedEpisode
                    ? "Season " + detailView.seasons[detailView.selectedSeason]?.number + " · Episode " + detailView.highlightedEpisode.number + " · " + detailView.highlightedEpisode.name
                    : detailView.seriesContext || "Season " + detailView.seasons[detailView.selectedSeason]?.number)
                : [detailView.detail.year, detailView.detail.runtime ? detailView.detail.runtime + " min" : ""].filter(value => value).join(" · ")
        }
    }
    Column {
        x: 60 * detailView.uiScale; y: 100 * detailView.uiScale
        width: 410 * detailView.uiScale
        spacing: 20 * detailView.uiScale
        MyTvArtwork {
            width: parent.width; height: width * 1.5
            radius: 24 * detailView.uiScale
            artworkSource: detailView.host.artworkUrl(detailView.detail, false)
            focalX: detailView.host.artworkFocus(detailView.detail).x
            focalY: detailView.host.artworkFocus(detailView.detail).y
            queue: detailView.host.artworkQueue
            title: detailView.detail.title || ""; crop: detailView.detail.borrowed === true && detailView.detail.media_type === "tv"
        }
        MyTvText { visible: detailView.loading; color: "#008b79"; font.pixelSize: 22 * detailView.uiScale; text: "Loading title information…" }
    }
    Flickable {
        id: content
        x: 520 * detailView.uiScale; y: 194 * detailView.uiScale
        width: parent.width - x - 60 * detailView.uiScale
        height: parent.height - y - 42 * detailView.uiScale
        contentHeight: body.height
        clip: true
        Column {
            id: body
            width: content.width
            spacing: 22 * detailView.uiScale
            Column {
                width: parent.width; spacing: 10 * detailView.uiScale
                Row {
                    spacing: 14 * detailView.uiScale
                    Rectangle {
                        visible: Boolean(detailView.detail.rating)
                        width: ratingLabel.implicitWidth + 28 * detailView.uiScale; height: 36 * detailView.uiScale
                        radius: height / 2; color: "#dcefeb"
                        MyTvText { id: ratingLabel; anchors.centerIn: parent; color: "#007e6e"; font.weight: Font.DemiBold; font.pixelSize: 20 * detailView.uiScale; text: "★  " + Number(detailView.detail.rating || 0).toFixed(1) + " / 10" }
                    }
                    MyTvText {
                        anchors.verticalCenter: parent.verticalCenter; color: "#647580"; font.pixelSize: 21 * detailView.uiScale
                        text: detailView.detail.media_type === "tv" ? [detailView.detail.year, "Series", detailView.detail.runtime ? detailView.detail.runtime + " min" : ""].filter(value => value).join(" · ") : "Film"
                    }
                }
                MyTvText { width: parent.width; color: "#435660"; font.pixelSize: 24 * detailView.uiScale; lineHeight: 1.2; wrapMode: Text.WordWrap; text: detailView.detail.overview || "No synopsis available yet." }
                MyTvText { width: parent.width; visible: (detailView.detail.genres || []).length > 0; color: "#647580"; font.pixelSize: 20 * detailView.uiScale; wrapMode: Text.WordWrap; text: (detailView.detail.genres || []).join(" · ") }
            }
            Row {
                id: primaryActions
                width: parent.width; spacing: 14 * detailView.uiScale
                Repeater {
                    model: detailView.actions
                    delegate: MyTvControl {
                        required property var modelData
                        required property int index
                        width: (primaryActions.width - primaryActions.spacing) / 2
                        height: 88 * detailView.uiScale; uiScale: detailView.uiScale
                        primary: index === 0; accent: detailView.host.accent
                        highlighted: detailView.zone === 0 && detailView.selectedAction === index
                        Row {
                            anchors.centerIn: parent; spacing: 14 * detailView.uiScale
                            width: Math.min(implicitWidth, parent.width - 36 * detailView.uiScale)
                            MyTvIcon { name: index === 0 ? "play" : "restart"; width: 28 * detailView.uiScale; height: width; anchors.verticalCenter: parent.verticalCenter }
                            Column {
                                width: Math.min(actionLabel.implicitWidth, primaryActions.width / 2 - 90 * detailView.uiScale)
                                spacing: 5 * detailView.uiScale
                                MyTvText { id: actionLabel; width: parent.width; elide: Text.ElideRight; color: "#142a31"; font.weight: Font.DemiBold; font.pixelSize: 24 * detailView.uiScale; text: modelData.label }
                                MyTvText {
                                    width: parent.width; visible: index === 0 && !detailView.loadFailed
                                    elide: Text.ElideRight; color: "#234b50"; font.pixelSize: 18 * detailView.uiScale
                                    text: [detailView.resumeEpisode?.name, detailView.host.remainingLabel(detailView.resumeEpisode || detailView.detail.progress)].filter(value => value).join(" · ")
                                }
                            }
                        }
                    }
                }
            }
            Column {
                id: providerSection
                visible: !detailView.detail.borrowed
                width: parent.width; spacing: 12 * detailView.uiScale
                Rectangle { width: parent.width; height: 1; color: "#dce3e7" }
                MyTvText { color: "#15212b"; font.weight: Font.DemiBold; font.pixelSize: 29 * detailView.uiScale; text: "Where to watch" }
                ListView {
                    id: providerList
                    width: parent.width; height: (detailView.providers.length ? 105 : 45) * detailView.uiScale
                    orientation: ListView.Horizontal; clip: true; spacing: 14 * detailView.uiScale
                    model: detailView.providers
                    currentIndex: detailView.selectedProvider
                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                    delegate: MyTvControl {
                        required property var modelData
                        required property int index
                        width: 295 * detailView.uiScale; height: providerList.height
                        uiScale: detailView.uiScale
                        highlighted: detailView.zone === 1 && index === detailView.selectedProvider
                        MyTvProviderIcon { id: logo; x: 17 * detailView.uiScale; anchors.verticalCenter: parent.verticalCenter; badgeSize: 58 * detailView.uiScale; provider: modelData }
                        Column {
                            x: 88 * detailView.uiScale; anchors.verticalCenter: parent.verticalCenter
                            width: parent.width - x - 35 * detailView.uiScale; spacing: 6 * detailView.uiScale
                            MyTvText { width: parent.width; color: "#1c3039"; font.pixelSize: 21 * detailView.uiScale; font.weight: Font.DemiBold; elide: Text.ElideRight; text: modelData.name }
                            MyTvText { width: parent.width; color: modelData.shortcut ? "#008b79" : "#778690"; font.pixelSize: 18 * detailView.uiScale; elide: Text.ElideRight; text: modelData.action }
                        }
                        MyTvIcon { name: "chevron"; anchors.right: parent.right; anchors.rightMargin: 13 * detailView.uiScale; anchors.verticalCenter: parent.verticalCenter; width: 20 * detailView.uiScale; height: width }
                    }
                    MyTvText { anchors.centerIn: parent; visible: !detailView.providers.length; color: "#647580"; font.pixelSize: 22 * detailView.uiScale; text: detailView.providersLoading ? "Checking streaming availability…" : "No supported TV apps found · OK to check again" }
                }
                MyTvText {
                    width: parent.width; visible: (detailView.detail.other_services || []).length > 0
                    color: "#647580"; font.pixelSize: 20 * detailView.uiScale; wrapMode: Text.WordWrap
                    text: "Also listed on: " + (detailView.detail.other_services || []).map(value => value.name + " (" + value.action.toLowerCase() + ")").join(" · ")
                }
            }
            Column {
                id: seriesSection
                width: parent.width; visible: detailView.detail.media_type === "tv"
                spacing: 14 * detailView.uiScale
                Rectangle { width: parent.width; height: 1; color: "#dce3e7" }
                MyTvText { color: "#15212b"; font.weight: Font.DemiBold; font.pixelSize: 29 * detailView.uiScale; text: "Seasons and episodes" }
                ListView {
                    id: seasonList
                    width: parent.width; height: 63 * detailView.uiScale
                    orientation: ListView.Horizontal; spacing: 12 * detailView.uiScale; clip: true
                    model: detailView.seasons
                    currentIndex: detailView.selectedSeason
                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                    delegate: MyTvControl {
                        required property var modelData
                        required property int index
                        width: 190 * detailView.uiScale; height: seasonList.height; radius: height / 2
                        uiScale: detailView.uiScale; checked: detailView.selectedSeason === index
                        accent: detailView.host.accent; highlighted: detailView.zone === 2 && index === detailView.selectedSeason
                        MyTvText { anchors.centerIn: parent; color: "#1b3036"; font.weight: Font.DemiBold; font.pixelSize: 22 * detailView.uiScale; text: "Season " + modelData.number }
                    }
                }
                MyTvText { visible: detailView.seasonLoading || Boolean(detailView.seasonError); width: parent.width; color: "#647580"; font.pixelSize: 20 * detailView.uiScale; text: detailView.seasonError || "Loading episode information…" }
                ListView {
                    id: episodeList
                    width: parent.width
                    height: Math.min(420, Math.max(110, detailView.episodes.length * 106)) * detailView.uiScale
                    spacing: 10 * detailView.uiScale; clip: true
                    model: detailView.episodes; cacheBuffer: 100 * detailView.uiScale
                    currentIndex: detailView.selectedEpisode
                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                    delegate: MyTvControl {
                        required property var modelData
                        required property int index
                        width: episodeList.width; height: 96 * detailView.uiScale; radius: 18 * detailView.uiScale
                        uiScale: detailView.uiScale; highlighted: detailView.zone === 3 && index === detailView.selectedEpisode
                        Rectangle {
                            x: 15 * detailView.uiScale; anchors.verticalCenter: parent.verticalCenter
                            width: 50 * detailView.uiScale; height: 58 * detailView.uiScale; radius: 12 * detailView.uiScale; color: "#edf2f4"
                            MyTvText { anchors.centerIn: parent; color: "#008b79"; font.weight: Font.DemiBold; font.pixelSize: 25 * detailView.uiScale; text: String(modelData.number).padStart(2, "0") }
                        }
                        Column {
                            x: 80 * detailView.uiScale; anchors.verticalCenter: parent.verticalCenter
                            width: parent.width - x - 50 * detailView.uiScale; spacing: 7 * detailView.uiScale
                            MyTvText { width: parent.width; color: "#152c37"; font.weight: Font.DemiBold; font.pixelSize: 23 * detailView.uiScale; elide: Text.ElideRight; text: modelData.name || "Episode " + modelData.number }
                            MyTvText { width: parent.width; color: "#647580"; font.pixelSize: 19 * detailView.uiScale; elide: Text.ElideRight; text: [(modelData.remote_position >= 30 ? "Resume" : modelData.watched ? "Watched" : ""), modelData.source ? "On " + detailView.host.tvDisplayName : "Choose a streaming service", detailView.host.remainingLabel(modelData) || (modelData.runtime ? modelData.runtime + " min" : "")].filter(value => value).join(" · ") }
                        }
                        MyTvIcon { name: "chevron"; anchors.right: parent.right; anchors.rightMargin: 20 * detailView.uiScale; anchors.verticalCenter: parent.verticalCenter; width: 24 * detailView.uiScale; height: width }
                    }
                    MyTvText { anchors.centerIn: parent; visible: !detailView.episodes.length; color: "#647580"; font.pixelSize: 22 * detailView.uiScale; text: detailView.seasonLoading ? "Loading episodes…" : "No episodes in this season · OK to retry" }
                }
                MyTvText { color: "#647580"; font.pixelSize: 19 * detailView.uiScale; text: detailView.episodes.length ? "Episode " + (detailView.selectedEpisode + 1) + " of " + detailView.episodes.length + "  ·  ↑↓ to browse" : "" }
                MyTvText {
                    width: parent.width; visible: detailView.zone === 3 && Boolean(detailView.highlightedEpisode?.overview)
                    color: "#435660"; font.pixelSize: 21 * detailView.uiScale; wrapMode: Text.WordWrap
                    maximumLineCount: 3; elide: Text.ElideRight; text: detailView.highlightedEpisode?.overview || ""
                }
            }
            Column {
                id: castSection
                width: parent.width; spacing: 12 * detailView.uiScale
                visible: (detailView.detail.cast || []).length > 0
                Rectangle { width: parent.width; height: 1; color: "#dce3e7" }
                MyTvText { color: "#15212b"; font.weight: Font.DemiBold; font.pixelSize: 29 * detailView.uiScale; text: "Cast" }
                ListView {
                    id: castList
                    width: parent.width; height: 228 * detailView.uiScale
                    orientation: ListView.Horizontal; spacing: 18 * detailView.uiScale; clip: true
                    currentIndex: detailView.selectedCast
                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                    model: detailView.detail.cast || []
                    delegate: Column {
                        required property var modelData
                        required property int index
                        width: 170 * detailView.uiScale; spacing: 8 * detailView.uiScale
                        Item {
                            width: parent.width; height: 156 * detailView.uiScale
                            MyTvArtwork {
                                anchors.centerIn: parent; width: 148 * detailView.uiScale; height: width; radius: width / 2
                                queue: detailView.host.artworkQueue
                                artworkSource: detailView.host.artworkUrl({ poster_path: modelData.profile_path }, false)
                                title: (modelData.name || "").split(" ").map(value => value[0]).slice(0, 2).join("")
                            }
                            Rectangle {
                                anchors.centerIn: parent; width: 148 * detailView.uiScale; height: width; radius: width / 2; color: "transparent"
                                border.width: detailView.zone === 4 && detailView.selectedCast === index ? 4 * detailView.uiScale : 1
                                border.color: detailView.zone === 4 && detailView.selectedCast === index ? "#008b79" : "#200e2731"
                            }
                        }
                        MyTvText { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: "#15212b"; font.pixelSize: 20 * detailView.uiScale; font.weight: Font.DemiBold; elide: Text.ElideRight; text: modelData.name }
                        MyTvText { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: "#647580"; font.pixelSize: 18 * detailView.uiScale; elide: Text.ElideRight; text: modelData.character || "" }
                    }
                }
            }
            MyTvText { width: parent.width; color: "#788892"; font.pixelSize: 17 * detailView.uiScale; text: "Catalogue: TMDB · Availability: Watchmode / JustWatch" }
        }
    }
    function cancel() {
        seasonGeneration++; providerGeneration++
        if (seasonRequest) seasonRequest.abort()
        if (providerRequest) providerRequest.abort()
        seasonRequest = null; providerRequest = null
    }
    function open(value) {
        cancel(); detail = value; providers = host.detailProviders(value); episodes = []
        loading = true; loadFailed = false; providersLoading = false; seasonLoading = false; seasonError = ""
        zone = value.on_mabeltv ? 0 : 1
        selectedAction = 0; selectedProvider = 0; selectedSeason = 0; selectedEpisode = 0; selectedCast = 0; seasonChosen = false
        content.contentY = 0
    }
    function updateDetail(value) {
        const oldSeason = seasonChosen ? seasons[selectedSeason]?.number : null
        detail = Object.assign({}, detail, value); loading = false; loadFailed = false
        providers = host.detailProviders(detail)
        if (detail.media_type === "tv") {
            const target = oldSeason || detail.next_playable?.season || detail.progress?.episode?.season || seasons[0]?.number
            const index = seasons.findIndex(value => value.number === target)
            loadSeason(Math.max(0, index))
        }
        loadProviders()
    }
    function updatePlayback(value) {
        detail = Object.assign({}, detail, { progress: value.progress, next_playable: value.next_playable,
            series_progress: value.series_progress, local_episodes: value.local_episodes || [] })
        const local = detail.local_episodes.filter(item => item.season === seasons[selectedSeason]?.number)
        episodes = episodes.map(item => {
            const saved = local.find(value => value.number === item.number)
            return saved ? Object.assign({}, item, { remote_position: saved.remote_position,
                remote_duration: saved.remote_duration, watched: saved.watched }) : item
        })
    }
    function loadProviders() {
        if (!detail.tmdb_id || detail.borrowed) return
        const generation = ++providerGeneration
        if (providerRequest) providerRequest.abort()
        providersLoading = true
        providerRequest = host.request("/api/native/my-tv/providers?media_type=" + detail.media_type + "&tmdb_id=" + detail.tmdb_id, "GET", null, result => {
            if (generation !== providerGeneration) return
            detail = Object.assign({}, detail, result); providers = host.detailProviders(detail)
            selectedProvider = Math.max(0, Math.min(selectedProvider, providers.length - 1))
            providersLoading = false; providerRequest = null
            if ((result.errors || []).length) host.notify("Some availability could not be loaded. OK on a service to retry or open it.")
        }, message => { if (generation === providerGeneration) { providersLoading = false; host.notify(message) } })
    }
    function loadSeason(index) {
        const generation = ++seasonGeneration
        if (seasonRequest) seasonRequest.abort()
        selectedSeason = index; selectedEpisode = 0; seasonError = ""
        seasonChosen = true
        const number = seasons[index]?.number
        episodes = (detail.local_episodes || []).filter(value => value.season === number)
        const preferred = number === detail.next_playable?.season ? detail.next_playable.number : 0
        selectedEpisode = Math.max(0, episodes.findIndex(value => value.number === preferred))
        episodeList.contentY = 0
        if (!number || !detail.tmdb_id) { seasonLoading = false; return }
        seasonLoading = true
        seasonRequest = host.request("/api/native/my-tv/season?tmdb_id=" + detail.tmdb_id + "&season=" + number, "GET", null, result => {
            if (generation !== seasonGeneration || seasons[selectedSeason]?.number !== number) return
            const selectedNumber = episodes[selectedEpisode]?.number || preferred
            episodes = (result.episodes || []).map(value => Object.assign({ season: number }, value))
            selectedEpisode = Math.max(0, episodes.findIndex(value => value.number === selectedNumber))
            seasonLoading = false; seasonRequest = null
        }, message => { if (generation === seasonGeneration) { seasonLoading = false; seasonError = message } })
    }
    function setZone(value) {
        if (value === 4 && !(detail.cast || []).length) return
        zone = value
        const target = zone === 0 ? primaryActions : zone === 1 ? providerSection : zone === 2 ? seriesSection : zone === 3 ? episodeList : castSection
        const position = target.mapToItem(body, 0, 0).y
        const bottom = position + target.height
        const max = Math.max(0, content.contentHeight - content.height)
        if (position < content.contentY) content.contentY = Math.min(max, position)
        else if (bottom > content.contentY + content.height) content.contentY = Math.min(max, bottom - content.height)
    }
    function handleKey(key) {
        const isSeries = detail.media_type === "tv"
        if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) { closed(); return true }
        if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            if (loading) return true
            if (loadFailed) { host.openSelected(); return true }
            if (zone === 0) host.playItem(detail, null, actions[selectedAction]?.restart)
            else if (zone === 1) { if (providers.length) host.launchProvider(providers[selectedProvider], detail); else loadProviders() }
            else if (zone === 2) { loadSeason(selectedSeason); setZone(3) }
            else if (zone === 3) {
                const episode = episodes[selectedEpisode]
                if (episode?.source) host.playItem(detail, episode, false)
                else if (episode) { setZone(1); host.notify("Choose a service to open this series") }
                else loadSeason(selectedSeason)
            }
        } else if (key === Qt.Key_Left || key === Qt.Key_Right) {
            const offset = key === Qt.Key_Left ? -1 : 1
            if (zone === 0) selectedAction = Math.max(0, Math.min(actions.length - 1, selectedAction + offset))
            else if (zone === 1) selectedProvider = Math.max(0, Math.min(providers.length - 1, selectedProvider + offset))
            else if (zone === 2) loadSeason(Math.max(0, Math.min(seasons.length - 1, selectedSeason + offset)))
            else if (zone === 4) selectedCast = Math.max(0, Math.min((detail.cast || []).length - 1, selectedCast + offset))
        } else if (key === Qt.Key_Down) {
            if (zone === 0) setZone(detail.borrowed ? (isSeries ? 2 : 4) : 1)
            else if (zone === 1) setZone(isSeries ? 2 : 4)
            else if (zone === 2) setZone(3)
            else if (zone === 3 && selectedEpisode + 1 < episodes.length) selectedEpisode++
            else if (zone === 3) setZone(4)
        } else if (key === Qt.Key_Up) {
            if (zone === 4) setZone(isSeries ? 3 : detail.borrowed ? 0 : 1)
            else if (zone === 3 && selectedEpisode > 0) selectedEpisode--
            else if (zone === 3) setZone(2)
            else if (zone === 2) setZone(detail.borrowed ? 0 : 1)
            else if (zone === 1 && actions.length) setZone(0)
            else if (zone === 0) content.contentY = 0
        } else return false
        return true
    }
}
