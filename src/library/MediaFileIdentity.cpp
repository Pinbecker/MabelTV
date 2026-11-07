#include "MediaFileIdentity.h"
#include <QFile>
#include <QFileInfo>
#include <QDateTime>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <sys/stat.h>
#endif

QString mediaFileIdentity(const QString &path)
{
    QString identity;
#ifdef Q_OS_WIN
    const HANDLE file = CreateFileW(reinterpret_cast<LPCWSTR>(path.utf16()), FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, 0, nullptr);
    if (file == INVALID_HANDLE_VALUE) return {};
    BY_HANDLE_FILE_INFORMATION info{};
    if (GetFileInformationByHandle(file, &info)) {
        identity = QStringLiteral("%1:%2:%3").arg(info.dwVolumeSerialNumber)
            .arg(info.nFileIndexHigh).arg(info.nFileIndexLow);
    }
    CloseHandle(file);
#else
    struct stat info{};
    if (::stat(QFile::encodeName(path).constData(), &info) == 0)
        identity = QStringLiteral("%1:%2").arg(qulonglong(info.st_dev)).arg(qulonglong(info.st_ino));
#endif
    if (identity.isEmpty()) return {};
    const QFileInfo fileInfo(path);
    return identity + QStringLiteral(":%1:%2").arg(fileInfo.size())
        .arg(fileInfo.lastModified().toMSecsSinceEpoch());
}
