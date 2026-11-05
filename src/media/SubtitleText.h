#pragma once

#include <QString>
#include <optional>

// Only the inline styling emitted by mpv for ordinary SRT is supported here.
// Positioning, drawings and arbitrary ASS styles stay with the native renderer.
std::optional<QString> subtitleRichText(const QString &ass);
