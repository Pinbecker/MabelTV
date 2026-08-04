#pragma once

#include <QObject>
#include <QString>

#include <memory>

class SoundEffects : public QObject
{
    Q_OBJECT
    Q_PROPERTY(int volume READ volume WRITE setVolume NOTIFY volumeChanged)
    Q_PROPERTY(bool muted READ muted WRITE setMuted NOTIFY mutedChanged)

public:
    explicit SoundEffects(QObject *parent = nullptr);
    ~SoundEffects() override;

    [[nodiscard]] int volume() const;
    void setVolume(int volume);
    [[nodiscard]] bool muted() const;
    void setMuted(bool muted);

    Q_INVOKABLE void playPowerClick();
    Q_INVOKABLE void playPowerDown();
    Q_INVOKABLE void playTuningNoise();

signals:
    void volumeChanged();
    void mutedChanged();

private:
    struct State;

    void playFile(const QString &path);
    bool createEffectFile(const QString &path, const QByteArray &pcm, int sampleRate) const;

    std::unique_ptr<State> m_state;
    QString m_powerClickPath;
    QString m_powerDownPath;
    QString m_tuningNoisePath;
    int m_volume = 20;
    bool m_muted = false;
};
