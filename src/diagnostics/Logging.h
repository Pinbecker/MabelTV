#pragma once

#include <QString>

namespace Logging
{
bool initialize(const QString &directoryPath);
void shutdown();
QString currentLogPath();
} // namespace Logging
