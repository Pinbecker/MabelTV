#pragma once
#include <QString>

// A filesystem object identity survives a rename, unlike its pathname.
QString mediaFileIdentity(const QString &path);
