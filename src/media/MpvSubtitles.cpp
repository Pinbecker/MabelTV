#include "MpvSubtitles.h"
#include "SubtitleText.h"

#include <QAbstractTextDocumentLayout>
#include <QPainter>
#include <QFontMetricsF>
#include <QQuickWindow>
#include <QTextCursor>
#include <QTextDocument>
#include <algorithm>
#include <mpv/client.h>

namespace {
constexpr std::uint64_t trackObserver = 100, cueObserver = 101, cueStartObserver = 102;
QString stringValue(const mpv_node &node) {
    return node.format == MPV_FORMAT_STRING && node.u.string
        ? QString::fromUtf8(node.u.string) : QString();
}
}

MpvSubtitles::MpvSubtitles(QQuickItem *surface)
    : QQuickPaintedItem(surface), m_surface(surface)
{
    setObjectName("mabeltvCachedSubtitles");
    setVisible(false);
    setAntialiasing(true);
    setAcceptedMouseButtons(Qt::NoButton);
    connect(surface, &QQuickItem::widthChanged, this, &MpvSubtitles::layoutCaption);
    connect(surface, &QQuickItem::heightChanged, this, &MpvSubtitles::layoutCaption);
}

void MpvSubtitles::attach(mpv_handle *handle)
{
    m_handle = handle;
    if (m_cached) observe();
}

void MpvSubtitles::observe()
{
    if (!m_handle) return;
    auto *handle = m_handle;
    mpv_observe_property(handle, trackObserver, "current-tracks/sub", MPV_FORMAT_NODE);
    // Observe stable properties. Newer mpv versions do not send changes for
    // the old formatted-text alias, although asynchronous reads still work.
    mpv_observe_property(handle, cueObserver, "sub-text", MPV_FORMAT_STRING);
    mpv_observe_property(handle, cueStartObserver, "sub-start", MPV_FORMAT_DOUBLE);
    mpv_observe_property(handle, 110, "sub-font", MPV_FORMAT_STRING);
    const char *styles[] = {"sub-font-size", "sub-border-size", "sub-margin-y", "sub-margin-x", "sub-scale"};
    for (std::uint64_t i = 0; i < 5; ++i)
        mpv_observe_property(handle, 111 + i, styles[i], MPV_FORMAT_DOUBLE);
}

void MpvSubtitles::setCached(bool enabled)
{
    if (m_cached == enabled) return;
    m_cached = enabled;
    if (enabled) observe();
    else if (m_handle) {
        for (const auto id : {100, 101, 102, 110, 111, 112, 113, 114, 115})
            mpv_unobserve_property(m_handle, id);
        m_cueRequest = 0;
    }
    reconcile();
}

void MpvSubtitles::setShown(bool shown)
{
    m_shown = shown;
    reconcile();
}

void MpvSubtitles::reset()
{
    m_loaded = false;
    m_trackId = -1;
    m_codec.clear();
    m_html.clear();
    m_rejected = m_haveCue = m_active = false;
    m_cueRequest = 0;
    if (m_cached) reconcile();
    else showCaption();
}

void MpvSubtitles::setTrack(const QString &codec, qint64 id)
{
    if (m_trackId == id && m_codec == codec) return;
    m_trackId = id;
    m_codec = codec;
    m_html.clear();
    m_rejected = m_haveCue = false;
    reconcile();
    // A new track may have identical text. Fetch asynchronously once rather
    // than depending on a changed-value observation to redraw that cue.
    readCue();
}

void MpvSubtitles::readCue()
{
    if (!m_handle || m_codec != "subrip" || m_trackId < 0) return;
    m_cueRequest = ++m_sequence;
    // This alias is also supported on the Pi's mpv 0.35. Never query the
    // decoder synchronously from Qt's GUI/render handshake.
    mpv_get_property_async(m_handle, m_cueRequest, "sub-text-ass", MPV_FORMAT_STRING);
}

void MpvSubtitles::setCue(const QString &cue, bool valid)
{
    if (m_codec != "subrip" || m_trackId < 0 || m_rejected) return;
    if (!valid) {
        // mpv 0.35 reports unavailable before the first playback timestamp
        // and during decoder transitions. This is not an unsupported track.
        // Keep native rendering until a subsequent observed cue is readable.
        m_haveCue = false;
        m_html.clear();
        reconcile();
        return;
    }
    const auto html = subtitleRichText(cue);
    if (!html) {
        // Keep the whole track native after encountering unsupported layout.
        m_rejected = true;
        m_html.clear();
    } else {
        m_haveCue = true;
        if (m_html != *html) {
            m_html = *html;
            layoutCaption();
        }
    }
    reconcile();
}

void MpvSubtitles::nativeVisibility(bool visible)
{
    if (!m_handle || (m_visibilityRequest && m_nativeVisible == visible)) return;
    m_nativeVisible = visible;
    m_visibilityConfirmed = false;
    m_visibilityRequest = ++m_sequence;
    const char *command[] = {"set", "sub-visibility", visible ? "yes" : "no", nullptr};
    if (mpv_command_async(m_handle, m_visibilityRequest, command) < 0) {
        m_rejected = true;
        m_active = false;
        m_visibilityRequest = 0;
        qWarning("Unable to change subtitle rendering; retaining native subtitles");
    }
}

void MpvSubtitles::reconcile()
{
    const bool eligible = m_cached && m_loaded && m_codec == "subrip"
        && m_trackId >= 0 && m_haveCue && !m_rejected;
    nativeVisibility(m_shown && !eligible);
    m_active = eligible && m_visibilityConfirmed && !m_nativeVisible;
    showCaption();
}

void MpvSubtitles::showCaption()
{
    setVisible(m_active && m_shown && !m_html.isEmpty());
}

void MpvSubtitles::process(const mpv_event &event)
{
    if (!m_cached) {
        if (event.event_id == MPV_EVENT_START_FILE || event.event_id == MPV_EVENT_END_FILE) reset();
        else if (event.event_id == MPV_EVENT_FILE_LOADED) m_loaded = true;
        return;
    }
    if (event.event_id == MPV_EVENT_START_FILE || event.event_id == MPV_EVENT_END_FILE) {
        reset();
    } else if (event.event_id == MPV_EVENT_FILE_LOADED) {
        m_loaded = true;
        reconcile();
    } else if (event.event_id == MPV_EVENT_COMMAND_REPLY && event.reply_userdata == m_visibilityRequest) {
        m_visibilityConfirmed = event.error >= 0;
        if (event.error < 0) {
            m_rejected = true;
            qWarning("Cached subtitle switch failed: %s", mpv_error_string(event.error));
            // The failed command leaves the previous native state in place.
            // Retry only the restoration, never the failed optimisation.
            if (!m_nativeVisible) nativeVisibility(m_shown);
        }
        reconcile();
    } else if (event.event_id == MPV_EVENT_PROPERTY_CHANGE || event.event_id == MPV_EVENT_GET_PROPERTY_REPLY) {
        const auto *property = static_cast<const mpv_event_property *>(event.data);
        if (!property) return;
        if (event.event_id == MPV_EVENT_PROPERTY_CHANGE && event.reply_userdata >= 110 && event.reply_userdata <= 115) {
            if (event.reply_userdata == 110 && property->format == MPV_FORMAT_STRING && property->data)
                m_font = QString::fromUtf8(*static_cast<char **>(property->data));
            else if (property->format == MPV_FORMAT_DOUBLE && property->data) {
                double *settings[] = {&m_fontSize, &m_border, &m_marginY, &m_marginX, &m_scale};
                const double value = *static_cast<double *>(property->data);
                if (std::isfinite(value) && value >= 0 && event.reply_userdata > 110)
                    *settings[event.reply_userdata - 111] = value;
            }
            layoutCaption();
        } else if (event.event_id == MPV_EVENT_PROPERTY_CHANGE && event.reply_userdata == trackObserver) {
            QString codec;
            qint64 id = -1;
            const auto *node = static_cast<const mpv_node *>(property->data);
            if (property->format == MPV_FORMAT_NODE && node && node->format == MPV_FORMAT_NODE_MAP) {
                const auto *map = node->u.list;
                for (int i = 0; i < map->num; ++i) {
                    if (QByteArray(map->keys[i]) == "codec") codec = stringValue(map->values[i]);
                    if (QByteArray(map->keys[i]) == "id" && map->values[i].format == MPV_FORMAT_INT64)
                        id = map->values[i].u.int64;
                }
            }
            setTrack(codec, id);
        } else if (event.event_id == MPV_EVENT_PROPERTY_CHANGE
                   && (event.reply_userdata == cueObserver || event.reply_userdata == cueStartObserver)) {
            readCue();
        } else if (event.event_id == MPV_EVENT_GET_PROPERTY_REPLY && event.reply_userdata == m_cueRequest) {
            const bool valid = property->format == MPV_FORMAT_STRING && property->data;
            const char *text = valid ? *static_cast<char **>(property->data) : nullptr;
            setCue(QString::fromUtf8(text ? text : ""), valid);
        }
    }
}

void MpvSubtitles::layoutCaption()
{
    if (m_html.isEmpty() || m_surface->height() <= 0 || m_surface->width() <= 0) {
        m_image = QImage();
        update();
        return;
    }
    const qreal scale = m_surface->height() / 720.0;
    const qreal padding = (m_border + 1) * scale;
    setWidth(std::max(1.0, m_surface->width() - 2 * m_marginX * scale));
    setX((m_surface->width() - width()) / 2);
    QFont font(m_font);
    // libass specifies the font's full ascender/descender height, not its em.
    font.setPixelSize(100);
    font.setPixelSize(std::max(1, qRound(m_fontSize * m_scale * scale * 100 / QFontMetricsF(font).height())));
    QTextDocument fill, border;
    for (auto *document : {&fill, &border}) {
        document->setDefaultFont(font);
        document->setDocumentMargin(padding);
        document->setHtml("<p align=\"center\" style=\"margin:0\">" + m_html + "</p>");
        document->setTextWidth(width());
    }
    QTextCursor cursor(&border);
    cursor.select(QTextCursor::Document);
    QTextCharFormat outline;
    outline.setForeground(Qt::black);
    outline.setTextOutline(QPen(Qt::black, 2 * m_border * scale, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
    cursor.mergeCharFormat(outline);
    const qreal captionHeight = fill.size().height();
    if (captionHeight > m_surface->height() * 0.6 || captionHeight > 1024) {
        m_rejected = true;
        reconcile();
        return;
    }
    setHeight(captionHeight);
    setY(std::max(0.0, m_surface->height() - height() - m_marginY * scale + padding));
    const qreal dpr = window() ? window()->devicePixelRatio() : 1;
    m_image = QImage(QSize(qCeil(width() * dpr), qCeil(height() * dpr)), QImage::Format_ARGB32_Premultiplied);
    m_image.setDevicePixelRatio(dpr);
    m_image.fill(Qt::transparent);
    QPainter raster(&m_image);
    raster.setRenderHint(QPainter::Antialiasing);
    QAbstractTextDocumentLayout::PaintContext context;
    // The border must be underneath the coloured glyphs, not drawn over them.
    border.documentLayout()->draw(&raster, context);
    fill.documentLayout()->draw(&raster, context);
    update(); // Rasterise/upload once per cue or resize, never per video frame.
}

void MpvSubtitles::paint(QPainter *painter)
{
    ++m_paints;
    // Text layout/rasterisation is complete on the GUI thread. The render
    // thread uploads only this immutable image and never touches a document.
    painter->drawImage(QPointF(0, 0), m_image);
}
