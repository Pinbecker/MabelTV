#pragma once

#include <cmath>
#include <vector>

class QObject;
class QQuickWindow;

namespace mabeltv::display {
// Rates come from the connected display at its current pixel dimensions.
inline int chooseRate(double fps, const std::vector<double> &rates)
{
    int best = -1;
    double bestScore = 1e9;
    if (!std::isfinite(fps) || fps < 0 || fps > 60.01) return best;
    for (int i = 0; i < static_cast<int>(rates.size()); ++i) {
        const double hz = rates[i];
        if (!std::isfinite(hz) || hz < 23 || hz > 60.1) continue;
        const double ratio = fps > 0 ? hz / fps : 1;
        const double cadence = fps > 0 ? std::abs(ratio - std::round(ratio)) : 0;
        // Prefer a matching cadence. When none is available, use the highest
        // supported refresh rather than giving 24 fps films an irregular 50 Hz
        // cadence just because 50/24 happens to be close to an integer.
        const double score = (fps > 0 && hz + .06 < fps ? 10 : 0)
            + (cadence <= .005 ? cadence : 1) + (60.1 - hz) * .000001;
        if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
}

void requestRefresh(QObject *owner, QQuickWindow *window, double fps);
void releaseRefresh(QObject *owner, QQuickWindow *window);
}
