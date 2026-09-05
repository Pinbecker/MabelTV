pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0
Item {
    required property var host
    required property var tvController

    anchors.fill: parent
    visible: tvController.parentAccessState === TvController.ParentOpen

    Rectangle {
        anchors.fill: parent
        color: "#080b0f"
    }

    Rectangle {
        id: sideRail
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: footer.top
        width: 365 * host.uiScale
        color: "#0b0e12"
        border.color: "#2b3138"
        border.width: 1

        Row {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.leftMargin: 42 * host.uiScale
            anchors.topMargin: 44 * host.uiScale
            spacing: 12 * host.uiScale

            Text {
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 35 * host.uiScale
                text: "Mabel"
            }
            Text {
                anchors.baseline: parent.children[0].baseline
                color: "#ff6b57"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 35 * host.uiScale
                text: "TV"
            }
        }

        Text {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.leftMargin: 44 * host.uiScale
            anchors.topMargin: 94 * host.uiScale
            color: "#808890"
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 14 * host.uiScale
            text: "PARENT CONTROLS"
        }

        Column {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.topMargin: 170 * host.uiScale
            spacing: 8 * host.uiScale

            Repeater {
                model: host.navPages

                Rectangle {
                    id: navItem
                    required property string modelData
                    required property int index
                    readonly property bool selected: host.sidebarFocused
                            ? host.sidebarSelection === index
                            : host.page === modelData
                    width: parent.width
                    height: 78 * host.uiScale
                    color: selected ? "#181d23" : "transparent"
                    border.color: host.sidebarFocused
                                  && host.sidebarSelection === index
                                  ? "#ff6b57" : "transparent"
                    border.width: host.sidebarFocused
                                  && host.sidebarSelection === index ? 2 : 0

                    Rectangle {
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        width: 7 * host.uiScale
                        color: navItem.selected ? "#ff6b57" : "transparent"
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 48 * host.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        width: 42 * host.uiScale
                        color: navItem.selected ? "#ff7562" : "#bbc1c5"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 25 * host.uiScale
                        horizontalAlignment: Text.AlignHCenter
                        text: host.pageIcon(navItem.modelData)
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 114 * host.uiScale
                        anchors.right: parent.right
                        anchors.rightMargin: 20 * host.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        color: navItem.selected ? "#ff7562" : "#c5cace"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: navItem.selected
                        font.pixelSize: 20 * host.uiScale
                        text: host.pageLabel(navItem.modelData)
                    }
                }
            }
        }

        Text {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 38 * host.uiScale
            color: host.sidebarFocused ? "#ff8a78" : "#747d84"
            wrapMode: Text.WordWrap
            font.family: "DejaVu Sans"
            font.pixelSize: 15 * host.uiScale
            text: host.sidebarFocused
                  ? "SIDEBAR FOCUS\n↑ ↓ choose   ·   OK open"
                  : "Back returns to Overview\nLeft from Overview opens this menu"
        }
    }

    Item {
        id: content
        anchors.left: sideRail.right
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: footer.top
        opacity: host.sidebarFocused ? 0.46 : 1

        Text {
            id: contentTitle
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.leftMargin: 56 * host.uiScale
            anchors.topMargin: 50 * host.uiScale
            color: "#f8f5ef"
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 50 * host.uiScale
            text: host.pageTitle(host.page)
        }

        Text {
            anchors.left: contentTitle.left
            anchors.top: contentTitle.bottom
            anchors.topMargin: 6 * host.uiScale
            color: "#aeb5b9"
            font.family: "DejaVu Sans"
            font.pixelSize: 21 * host.uiScale
            text: host.pageSubtitle(host.page)
        }

        Rectangle {
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.rightMargin: 52 * host.uiScale
            anchors.topMargin: 56 * host.uiScale
            width: savedText.implicitWidth + 54 * host.uiScale
            height: 50 * host.uiScale
            radius: height / 2
            color: "#11171a"
            border.color: "#303b3c"
            border.width: 1

            Text {
                id: savedText
                anchors.centerIn: parent
                color: "#7dd4ca"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * host.uiScale
                text: "✓   All changes saved"
            }
        }

        Grid {
            id: overviewGrid
            visible: host.page === "overview"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.leftMargin: 54 * host.uiScale
            anchors.rightMargin: 52 * host.uiScale
            anchors.topMargin: 190 * host.uiScale
            anchors.bottomMargin: 38 * host.uiScale
            columns: 2
            columnSpacing: 18 * host.uiScale
            rowSpacing: 18 * host.uiScale

            Repeater {
                model: ["Playback", "Picture & sound", "Channels", "System"]

                Rectangle {
                    id: overviewCard
                    required property string modelData
                    required property int index
                    width: (overviewGrid.width - overviewGrid.columnSpacing) / 2
                    height: (overviewGrid.height - overviewGrid.rowSpacing) / 2
                    radius: 14 * host.uiScale
                    color: index === host.selectedRow && !host.sidebarFocused
                           ? "#1a2026" : "#11161b"
                    border.color: index === host.selectedRow && !host.sidebarFocused
                                  ? "#ff6b57" : "#303840"
                    border.width: index === host.selectedRow && !host.sidebarFocused ? 3 : 1

                    Rectangle {
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.leftMargin: 26 * host.uiScale
                        anchors.topMargin: 24 * host.uiScale
                        width: 54 * host.uiScale
                        height: 54 * host.uiScale
                        radius: 10 * host.uiScale
                        color: index === host.selectedRow ? "#ff6b57" : "#252c33"

                        Text {
                            anchors.centerIn: parent
                            color: index === host.selectedRow ? "#12161b" : "#d8dcde"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 25 * host.uiScale
                            text: host.pageIcon(["playback", "picture", "channels", "system"][overviewCard.index])
                        }
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.leftMargin: 100 * host.uiScale
                        anchors.topMargin: 27 * host.uiScale
                        color: "#f6f3ed"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 25 * host.uiScale
                        text: overviewCard.modelData
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.leftMargin: 26 * host.uiScale
                        anchors.rightMargin: 26 * host.uiScale
                        anchors.topMargin: 100 * host.uiScale
                        color: index === host.selectedRow ? "#ff8a78" : "#7dd4ca"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 20 * host.uiScale
                        text: host.overviewValue(overviewCard.index)
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.leftMargin: 26 * host.uiScale
                        anchors.rightMargin: 26 * host.uiScale
                        anchors.topMargin: 142 * host.uiScale
                        color: "#9ea6ab"
                        wrapMode: Text.WordWrap
                        font.family: "DejaVu Sans"
                        font.pixelSize: 16 * host.uiScale
                        text: host.overviewDescription(overviewCard.index)
                    }

                    Text {
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        anchors.margins: 24 * host.uiScale
                        color: index === host.selectedRow ? "#f8f5ef" : "#687179"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 15 * host.uiScale
                        text: "OK   Open"
                    }
                }
            }
        }

        Item {
            id: settingsPage
            visible: host.page === "playback" || host.page === "picture"
                     || host.page === "system"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.leftMargin: 54 * host.uiScale
            anchors.rightMargin: 52 * host.uiScale
            anchors.topMargin: 180 * host.uiScale
            anchors.bottomMargin: 32 * host.uiScale

            Rectangle {
                id: informationPanel
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 118 * host.uiScale
                radius: 12 * host.uiScale
                color: "#11161b"
                border.color: "#2d353c"
                border.width: 1

                Text {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.leftMargin: 26 * host.uiScale
                    anchors.topMargin: 20 * host.uiScale
                    color: "#757e85"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 13 * host.uiScale
                    text: host.page === "system" ? "ABOUT THIS ACTION" : "HOW THIS WORKS"
                }

                Text {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: 26 * host.uiScale
                    anchors.rightMargin: 26 * host.uiScale
                    anchors.bottomMargin: 21 * host.uiScale
                    color: "#d4d8da"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.pixelSize: 17 * host.uiScale
                    text: {
                        const rows = host.rowsForPage(host.page)
                        if (rows.length === 0)
                            return ""
                        return host.descriptionForRow(rows[host.selectedRow])
                    }
                }
            }

            ListView {
                id: settingsList
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: informationPanel.top
                anchors.bottomMargin: 18 * host.uiScale
                clip: true
                spacing: 10 * host.uiScale
                model: host.rowsForPage(host.page)
                currentIndex: host.selectedRow
                boundsBehavior: Flickable.StopAtBounds
                interactive: false

                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                delegate: Rectangle {
                    id: settingRow
                    required property int modelData
                    required property int index
                    readonly property bool selected: index === host.selectedRow
                            && !host.sidebarFocused
                    readonly property bool hasSlider: modelData === 4 || modelData === 5
                                                     || modelData === 8
                    width: settingsList.width
                    height: 94 * host.uiScale
                    radius: 11 * host.uiScale
                    color: selected ? "#1a2026" : "#12171c"
                    border.color: selected ? "#ff6b57" : "#30373e"
                    border.width: selected ? 3 : 1

                    Text {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 28 * host.uiScale
                        color: "#f4f1ec"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 22 * host.uiScale
                        text: host.labelForRow(settingRow.modelData)
                    }

                    Row {
                        anchors.right: parent.right
                        anchors.rightMargin: 26 * host.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 22 * host.uiScale

                        Text {
                            visible: settingRow.modelData <= 10
                            anchors.verticalCenter: parent.verticalCenter
                            color: settingRow.selected ? "#ff7562" : "#747d84"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 28 * host.uiScale
                            text: "‹"
                        }

                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: !settingRow.hasSlider
                            color: settingRow.selected ? "#f8f5ef" : "#c6cbce"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 20 * host.uiScale
                            text: host.valueForRow(settingRow.modelData)
                        }

                        Item {
                            visible: settingRow.hasSlider
                            width: 220 * host.uiScale
                            height: 36 * host.uiScale

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: valueLabel.left
                                anchors.rightMargin: 14 * host.uiScale
                                anchors.verticalCenter: parent.verticalCenter
                                height: 8 * host.uiScale
                                radius: height / 2
                                color: "#3a4249"

                                Rectangle {
                                    width: parent.width * host.sliderValueForRow(settingRow.modelData) / 100
                                    height: parent.height
                                    radius: parent.radius
                                    color: settingRow.selected ? "#ff6b57" : "#a6afb4"
                                }
                            }

                            Text {
                                id: valueLabel
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                color: settingRow.selected ? "#f8f5ef" : "#c6cbce"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 20 * host.uiScale
                                text: host.valueForRow(settingRow.modelData)
                            }
                        }

                        Text {
                            visible: settingRow.modelData <= 10
                            anchors.verticalCenter: parent.verticalCenter
                            color: settingRow.selected ? "#ff7562" : "#747d84"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 28 * host.uiScale
                            text: "›"
                        }
                    }
                }
            }
        }

        Item {
            id: channelsPage
            visible: host.page === "channels"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.leftMargin: 54 * host.uiScale
            anchors.rightMargin: 52 * host.uiScale
            anchors.topMargin: 180 * host.uiScale
            anchors.bottomMargin: 34 * host.uiScale

            Rectangle {
                id: channelPanel
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: parent.width * 0.39
                radius: 13 * host.uiScale
                color: "#101419"
                border.color: !host.programmePane && !host.sidebarFocused
                              ? "#ff6b57" : "#30373e"
                border.width: !host.programmePane && !host.sidebarFocused ? 3 : 1

                Text {
                    id: channelHeading
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.leftMargin: 24 * host.uiScale
                    anchors.topMargin: 22 * host.uiScale
                    color: "#f1eee8"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 20 * host.uiScale
                    text: "CHANNELS"
                }

                ListView {
                    id: channelList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: channelHeading.bottom
                    anchors.bottom: parent.bottom
                    anchors.margins: 14 * host.uiScale
                    anchors.topMargin: 20 * host.uiScale
                    clip: true
                    spacing: 6 * host.uiScale
                    currentIndex: host.selectedChannel
                    model: tvController.parentLibrary
                    boundsBehavior: Flickable.StopAtBounds
                    interactive: false

                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                    delegate: Rectangle {
                        id: channelEntry
                        required property int index
                        required property var modelData
                        width: channelList.width
                        height: 82 * host.uiScale
                        radius: 10 * host.uiScale
                        color: index === host.selectedChannel ? "#1c2228" : "transparent"
                        border.color: index === host.selectedChannel
                                      && !host.programmePane ? "#ff6b57" : "transparent"
                        border.width: index === host.selectedChannel
                                      && !host.programmePane ? 2 : 0

                        Rectangle {
                            anchors.left: parent.left
                            anchors.leftMargin: 14 * host.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            width: 56 * host.uiScale
                            height: 56 * host.uiScale
                            radius: 9 * host.uiScale
                            color: index === host.selectedChannel ? "#ff6b57" : "#242b32"

                            Text {
                                anchors.centerIn: parent
                                color: index === host.selectedChannel ? "#11151a" : "#f3f1ec"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 25 * host.uiScale
                                text: channelEntry.modelData.number
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: channelStatus.left
                            anchors.leftMargin: 88 * host.uiScale
                            anchors.rightMargin: 12 * host.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: channelEntry.modelData.enabled ? "#f0eee8" : "#7f878d"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: index === host.selectedChannel
                            font.pixelSize: 18 * host.uiScale
                            text: channelEntry.modelData.name
                        }

                        Text {
                            id: channelStatus
                            anchors.right: parent.right
                            anchors.rightMargin: 14 * host.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: channelEntry.modelData.enabled ? "#7dd4ca" : "#df7d78"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 14 * host.uiScale
                            text: channelEntry.modelData.enabled ? "◉  Shown" : "⊘  Hidden"
                        }
                    }
                }
            }

            Rectangle {
                anchors.left: channelPanel.right
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.leftMargin: 18 * host.uiScale
                radius: 13 * host.uiScale
                color: "#101419"
                border.color: host.programmePane && !host.sidebarFocused
                              ? "#ff6b57" : "#30373e"
                border.width: host.programmePane && !host.sidebarFocused ? 3 : 1

                Text {
                    id: programmeHeading
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.leftMargin: 24 * host.uiScale
                    anchors.topMargin: 20 * host.uiScale
                    color: "#f1eee8"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 21 * host.uiScale
                    text: {
                        const channel = host.currentChannel()
                        return channel ? channel.name.toUpperCase() : "PROGRAMMES"
                    }
                }

                Text {
                    anchors.left: parent.left
                    anchors.top: programmeHeading.bottom
                    anchors.leftMargin: 24 * host.uiScale
                    anchors.topMargin: 5 * host.uiScale
                    color: "#9ba3a8"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 15 * host.uiScale
                    text: {
                        const channel = host.currentChannel()
                        return channel ? channel.enabledProgrammeCount + " of "
                                + channel.programmeCount + " shown" : ""
                    }
                }

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.leftMargin: 24 * host.uiScale
                    anchors.rightMargin: 24 * host.uiScale
                    anchors.topMargin: 82 * host.uiScale
                    height: 4 * host.uiScale
                    radius: height / 2
                    color: "#30373d"

                    Rectangle {
                        width: {
                            const channel = host.currentChannel()
                            if (!channel || channel.programmeCount === 0)
                                return 0
                            return parent.width * channel.enabledProgrammeCount
                                    / channel.programmeCount
                        }
                        height: parent.height
                        radius: parent.radius
                        color: "#7dd4ca"
                    }
                }

                ListView {
                    id: programmeList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: 14 * host.uiScale
                    anchors.rightMargin: 14 * host.uiScale
                    anchors.topMargin: 108 * host.uiScale
                    anchors.bottomMargin: 14 * host.uiScale
                    clip: true
                    spacing: 5 * host.uiScale
                    currentIndex: host.selectedProgramme
                    model: host.currentProgrammes()
                    boundsBehavior: Flickable.StopAtBounds
                    interactive: false

                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                    delegate: Rectangle {
                        id: programmeEntry
                        required property int index
                        required property var modelData
                        readonly property bool selected: index === host.selectedProgramme
                                && host.programmePane
                        width: programmeList.width
                        height: 72 * host.uiScale
                        radius: 9 * host.uiScale
                        color: selected ? "#1b2127" : "#12171b"
                        border.color: selected ? "#ff6b57" : "#282f35"
                        border.width: selected ? 3 : 1

                        Text {
                            anchors.left: parent.left
                            anchors.right: programmeState.left
                            anchors.leftMargin: 20 * host.uiScale
                            anchors.rightMargin: 12 * host.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: programmeEntry.modelData.enabled ? "#f2efe9" : "#7f878d"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: programmeEntry.selected
                            font.pixelSize: 17 * host.uiScale
                            text: programmeEntry.modelData.name
                        }

                        Text {
                            id: programmeState
                            anchors.right: parent.right
                            anchors.rightMargin: 18 * host.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: programmeEntry.modelData.enabled ? "#7dd4ca" : "#df7d78"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 14 * host.uiScale
                            text: programmeEntry.selected
                                  ? (programmeEntry.modelData.enabled ? "OK  Hide" : "OK  Show")
                                  : (programmeEntry.modelData.enabled ? "◉  Shown" : "⊘  Hidden")
                        }
                    }

                    Text {
                        anchors.centerIn: parent
                        visible: programmeList.count === 0
                        color: "#838c92"
                        font.family: "DejaVu Sans"
                        font.pixelSize: 18 * host.uiScale
                        text: "No programmes in this channel yet"
                    }
                }
            }
        }
    }

    Rectangle {
        id: footer
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 82 * host.uiScale
        color: "#090c10"
        border.color: "#2c3238"
        border.width: 1

        Row {
            anchors.centerIn: parent
            spacing: 50 * host.uiScale

            Text {
                color: "#d8dcde"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * host.uiScale
                text: "↑  ↓   Move"
            }
            Text {
                color: "#d8dcde"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * host.uiScale
                text: host.page === "channels" ? "←  →   Change panel" : "←  →   Change"
            }
            Text {
                color: "#f7f4ee"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 16 * host.uiScale
                text: host.page === "channels" ? "OK   Show or hide" : "OK   Select"
            }
            Text {
                color: "#d8dcde"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * host.uiScale
                text: host.page === "overview" ? "Back   Close" : "Back   Overview"
            }
        }

        Text {
            anchors.right: parent.right
            anchors.rightMargin: 32 * host.uiScale
            anchors.verticalCenter: parent.verticalCenter
            width: 300 * host.uiScale
            color: "#7dd4ca"
            elide: Text.ElideRight
            horizontalAlignment: Text.AlignRight
            font.family: "DejaVu Sans"
            font.pixelSize: 13 * host.uiScale
            text: tvController.parentMessage
        }
    }
}
