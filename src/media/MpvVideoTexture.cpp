#include "MpvVideo.h"
#include <QSGSimpleTextureNode>
#include <QSGTexture>

void MpvVideo::setTextureOnly(bool enabled)
{
    if (m_textureOnly == enabled) return;
    m_textureOnly = enabled;
    emit textureOnlyChanged();
    update();
}

QSGNode *MpvVideo::updatePaintNode(QSGNode *node, UpdatePaintNodeData *data)
{
    auto *result = QQuickFramebufferObject::updatePaintNode(node, data);
    // Keep Qt's framebuffer renderer and texture provider alive. A ShaderEffect
    // can consume that texture directly, without an unwarped copy underneath.
    // QQuickFramebufferObject's OpenGL node is a QSGSimpleTextureNode in Qt 6.
    if (m_textureOnly) {
        if (auto *texture = dynamic_cast<QSGSimpleTextureNode *>(result)) {
            if (texture->texture()) texture->texture()->setFiltering(QSGTexture::Linear);
            texture->setRect(QRectF());
        }
    }
    return result;
}
