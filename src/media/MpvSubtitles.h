#pragma once

#include <QQuickPaintedItem>
#include <QImage>
#include <atomic>
#include <cstdint>

struct mpv_handle;
struct mpv_event;

// Cached subtitle artwork for the flat My TV player. mpv remains the timing,
// track-selection and decoding authority; unsupported tracks render in mpv.
class MpvSubtitles final : public QQuickPaintedItem
{
    Q_OBJECT
public:
    explicit MpvSubtitles(QQuickItem *surface);
    void attach(mpv_handle *handle);
    void process(const mpv_event &event);
    void reset();
    void setCached(bool enabled);
    bool cached() const { return m_cached; }
    void setShown(bool shown);
    bool active() const { return m_active; }
    QString caption() const { return m_html; }
    std::uint64_t paintCount() const { return m_paints.load(std::memory_order_relaxed); }
    void paint(QPainter *painter) override;

private:
    void observe();
    void setTrack(const QString &codec, qint64 id);
    void setCue(const QString &cue, bool valid);
    void readCue();
    void reconcile();
    void layoutCaption();
    void showCaption();
    void nativeVisibility(bool visible);

    mpv_handle *m_handle = nullptr;
    QQuickItem *m_surface;
    QImage m_image;
    QString m_font = "sans-serif";
    double m_fontSize = 55, m_border = 3, m_marginY = 22, m_marginX = 19, m_scale = 1;
    QString m_html, m_codec;
    qint64 m_trackId = -1;
    bool m_cached = false, m_shown = true, m_loaded = false;
    bool m_rejected = false, m_haveCue = false, m_active = false;
    bool m_nativeVisible = true, m_visibilityConfirmed = false;
    std::uint64_t m_sequence = 2000, m_visibilityRequest = 0, m_cueRequest = 0;
    std::atomic<std::uint64_t> m_paints = 0;
};
