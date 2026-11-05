#include "MpvVideo.h"
#include "MpvSubtitles.h"

bool MpvVideo::subtitlesVisible() const
{
    return m_subtitlesVisible;
}

bool MpvVideo::subtitlesAvailable() const
{
    return m_subtitlesAvailable;
}

bool MpvVideo::subtitleDefaultOn() const
{
    return m_subtitleDefaultOn;
}

void MpvVideo::setSubtitleDefaultOn(bool enabled)
{
    m_subtitleDefaultOn = enabled;
}

void MpvVideo::resetSubtitleState()
{
    if (cachedSubtitles()) { m_subtitles->reset(); m_subtitles->setShown(true); }
    setSubtitlesAvailable(false);
    setSubtitlesVisible(true);
}

void MpvVideo::setSubtitlesVisible(bool visible)
{
    if (cachedSubtitles()) m_subtitles->setShown(visible);
    if (m_subtitlesVisible == visible) {
        return;
    }
    m_subtitlesVisible = visible;
    emit subtitlesVisibleChanged();
}

void MpvVideo::setSubtitlesAvailable(bool available)
{
    if (m_subtitlesAvailable == available) {
        return;
    }
    m_subtitlesAvailable = available;
    emit subtitlesAvailableChanged();
}

bool MpvVideo::cachedSubtitles() const
{
    return m_subtitles->cached();
}

void MpvVideo::setCachedSubtitles(bool enabled)
{
    m_subtitles->setCached(enabled);
}
