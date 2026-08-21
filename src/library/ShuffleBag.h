#pragma once

#include <QVector>
#include <QtGlobal>

#include <random>

class ShuffleBag
{
public:
    explicit ShuffleBag(int itemCount = 0, quint32 seed = std::random_device{}());

    void reset(int itemCount);
    [[nodiscard]] int take();
    [[nodiscard]] int itemCount() const;

private:
    void refill();

    int m_itemCount = 0;
    int m_lastItem = -1;
    QVector<int> m_remaining;
    std::mt19937 m_random;
};

