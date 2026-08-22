import QtQuick
import MabelTV 1.0

Item {
    id: overlay

    required property var controller

    visible: controller.parentAccessState !== TvController.ParentClosed

    function handleKey(key, modifiers) {
        return designLoader.item ? designLoader.item.handleKey(key, modifiers) : false
    }

    Loader {
        id: designLoader
        anchors.fill: parent
        sourceComponent: controller.parentOverlayStyle === "modern"
            ? modernDesign : classicDesign
    }

    Component {
        id: classicDesign

        ClassicParentOverlay {
            controller: overlay.controller
        }
    }

    Component {
        id: modernDesign

        ModernParentOverlay {
            controller: overlay.controller
        }
    }
}
