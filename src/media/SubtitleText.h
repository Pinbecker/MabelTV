#pragma once

#include <QString>
#include <optional>

// Normalise ordinary SRT inline styling to safe, plain-white display text.
// Complex ASS instructions stay with the native renderer and its style policy.
std::optional<QString> subtitleRichText(const QString &ass);
