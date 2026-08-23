import QtQuick
import MabelTV 1.0

Item {
    id: overlay

    required property var controller

    visible: controller.parentAccessState !== TvController.ParentClosed

    function handleKey(key, modifiers) {
        return modernDesign.handleKey(key, modifiers)
    }

    ModernParentOverlay {
        id: modernDesign
        anchors.fill: parent
        controller: overlay.controller
    }
}
