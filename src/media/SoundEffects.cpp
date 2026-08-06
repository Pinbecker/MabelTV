#include "SoundEffects.h"

#include <QDataStream>
#include <QDir>
#include <QFileInfo>
#include <QSaveFile>
#include <QStandardPaths>
#include <QtGlobal>

#include <mpv/client.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <random>

namespace
{
constexpr double pi = 3.14159265358979323846;
constexpr int childSafeVolume = 60;
constexpr int boostedMaximumVolume = 160;

int outputVolume(int visibleVolume)
{
    visibleVolume = std::clamp(visibleVolume, 0, 100);
    if (visibleVolume <= childSafeVolume) {
        return visibleVolume;
    }
    return childSafeVolume
        + (visibleVolume - childSafeVolume) * (boostedMaximumVolume - childSafeVolume)
            / (100 - childSafeVolume);
}

QByteArray makeSamples(int sampleRate, double durationSeconds, const auto &sampleGenerator)
{
    const int sampleCount = static_cast<int>(sampleRate * durationSeconds);
    QByteArray bytes(sampleCount * static_cast<int>(sizeof(qint16)), Qt::Uninitialized);
    for (int index = 0; index < sampleCount; ++index) {
        const double time = static_cast<double>(index) / sampleRate;
        const double sample = std::clamp(sampleGenerator(time, durationSeconds), -1.0, 1.0);
        const qint16 pcm = static_cast<qint16>(sample * 32767.0);
        std::memcpy(bytes.data() + index * static_cast<int>(sizeof(qint16)), &pcm, sizeof(pcm));
    }
    return bytes;
}

void runCommand(mpv_handle *handle, const char **command)
{
    if (handle != nullptr) {
        const int result = mpv_command_async(handle, 0, command);
        if (result < 0) {
            qWarning() << "Sound effect command failed:" << mpv_error_string(result);
        }
    }
}
} // namespace

struct SoundEffects::State
{
    mpv_handle *handle = nullptr;

    ~State()
    {
        if (handle != nullptr) {
            mpv_terminate_destroy(handle);
        }
    }
};

SoundEffects::SoundEffects(QObject *parent)
    : QObject(parent)
    , m_state(std::make_unique<State>())
{
    m_state->handle = mpv_create();
    if (m_state->handle == nullptr) {
        return;
    }

    mpv_set_option_string(m_state->handle, "vo", "null");
    mpv_set_option_string(m_state->handle, "video", "no");
    mpv_set_option_string(m_state->handle, "terminal", "no");
    mpv_set_option_string(m_state->handle, "audio-display", "no");
    mpv_set_option_string(m_state->handle, "idle", "yes");
    mpv_set_option_string(m_state->handle, "keep-open", "no");
    mpv_set_option_string(m_state->handle, "volume-max", "160");
#ifdef Q_OS_LINUX
    mpv_set_option_string(m_state->handle, "ao", "alsa");
    const QByteArray audioDevice = qEnvironmentVariable("MABELTV_AUDIO_DEVICE").toUtf8();
    if (!audioDevice.isEmpty()) {
        mpv_set_option_string(m_state->handle, "audio-device", audioDevice.constData());
    }
#endif
    if (mpv_initialize(m_state->handle) < 0) {
        mpv_terminate_destroy(m_state->handle);
        m_state->handle = nullptr;
        return;
    }

    const QString effectsDirectory = QDir(
        QStandardPaths::writableLocation(QStandardPaths::CacheLocation))
                                         .filePath(QStringLiteral("effects"));
    m_powerClickPath = QDir(effectsDirectory).filePath(QStringLiteral("power-click.wav"));
    m_powerDownPath = QDir(effectsDirectory).filePath(QStringLiteral("power-down-v2.wav"));
    m_tuningNoisePath = QDir(effectsDirectory).filePath(QStringLiteral("tuning-noise.wav"));

    constexpr int sampleRate = 48000;
    if (!QFileInfo::exists(m_powerClickPath)) {
        std::mt19937 random(973U);
        std::uniform_real_distribution<double> noise(-1.0, 1.0);
        const QByteArray samples = makeSamples(
            sampleRate, 0.085, [&random, &noise](double time, double duration) {
                const double envelope = std::exp(-time * 38.0) * (1.0 - time / duration);
                return envelope
                    * (std::sin(2.0 * pi * 92.0 * time) * 0.54 + noise(random) * 0.22);
            });
        createEffectFile(m_powerClickPath, samples, sampleRate);
    }
    if (!QFileInfo::exists(m_tuningNoisePath)) {
        std::mt19937 random(1973U);
        std::uniform_real_distribution<double> noise(-1.0, 1.0);
        const QByteArray samples = makeSamples(
            sampleRate, 0.16, [&random, &noise](double time, double duration) {
                const double fade = std::min(1.0, time * 55.0)
                    * std::min(1.0, (duration - time) * 42.0);
                return noise(random) * fade * 0.24;
            });
        createEffectFile(m_tuningNoisePath, samples, sampleRate);
    }
    if (!QFileInfo::exists(m_powerDownPath)) {
        std::mt19937 random(9073U);
        std::uniform_real_distribution<double> noise(-1.0, 1.0);
        const QByteArray samples = makeSamples(
            sampleRate, 0.68, [&random, &noise](double time, double duration) {
                const double progress = time / duration;
                const double sweepFrequency = 155.0 - 105.0 * progress;
                const double sweep = std::sin(2.0 * pi * sweepFrequency * time);
                const double shuumEnvelope = std::sin(pi * progress)
                    * std::exp(-progress * 0.65);
                const double buttonThump = std::exp(-time * 34.0)
                    * std::sin(2.0 * pi * 72.0 * time);
                return buttonThump * 0.48
                    + shuumEnvelope * (sweep * 0.30 + noise(random) * 0.075);
            });
        createEffectFile(m_powerDownPath, samples, sampleRate);
    }
    setVolume(m_volume);
}

SoundEffects::~SoundEffects() = default;

int SoundEffects::volume() const
{
    return m_volume;
}

void SoundEffects::setVolume(int volume)
{
    volume = std::clamp(volume, 0, 100);
    const bool changed = m_volume != volume;
    m_volume = volume;
    const QByteArray value = QByteArray::number(outputVolume(volume));
    const char *command[] = {"set", "volume", value.constData(), nullptr};
    runCommand(m_state->handle, command);
    if (changed) {
        emit volumeChanged();
    }
}

bool SoundEffects::muted() const
{
    return m_muted;
}

void SoundEffects::setMuted(bool muted)
{
    const bool changed = m_muted != muted;
    m_muted = muted;
    const char *command[] = {"set", "mute", muted ? "yes" : "no", nullptr};
    runCommand(m_state->handle, command);
    if (changed) {
        emit mutedChanged();
    }
}

void SoundEffects::playPowerClick()
{
    playFile(m_powerClickPath);
}

void SoundEffects::playPowerDown()
{
    playFile(m_powerDownPath);
}

void SoundEffects::playTuningNoise()
{
    playFile(m_tuningNoisePath);
}

void SoundEffects::playFile(const QString &path)
{
    if (path.isEmpty() || !QFileInfo::exists(path)) {
        return;
    }
    const QByteArray encodedPath = QFileInfo(path).absoluteFilePath().toUtf8();
    const char *command[] = {"loadfile", encodedPath.constData(), "replace", nullptr};
    runCommand(m_state->handle, command);
}

bool SoundEffects::createEffectFile(const QString &path, const QByteArray &pcm, int sampleRate) const
{
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) {
        return false;
    }

    QByteArray wave;
    QDataStream stream(&wave, QIODevice::WriteOnly);
    stream.setByteOrder(QDataStream::LittleEndian);
    stream.writeRawData("RIFF", 4);
    stream << static_cast<quint32>(36 + pcm.size());
    stream.writeRawData("WAVEfmt ", 8);
    stream << static_cast<quint32>(16);
    stream << static_cast<quint16>(1);
    stream << static_cast<quint16>(1);
    stream << static_cast<quint32>(sampleRate);
    stream << static_cast<quint32>(sampleRate * 2);
    stream << static_cast<quint16>(2);
    stream << static_cast<quint16>(16);
    stream.writeRawData("data", 4);
    stream << static_cast<quint32>(pcm.size());
    wave.append(pcm);

    file.write(wave);
    return file.commit();
}
