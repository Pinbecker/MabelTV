#pragma once
#include <QJsonObject>
#include <QString>
class QObject;

namespace PortalSeek {
QJsonObject status(QObject *root);
bool apply(QObject *root, double position, const QString &token);
}
