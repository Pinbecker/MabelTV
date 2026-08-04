#include "ShuffleBag.h"

#include <algorithm>
#include <numeric>

ShuffleBag::ShuffleBag(int itemCount, quint32 seed)
    : m_itemCount(std::max(0, itemCount))
    , m_random(seed)
{
}

void ShuffleBag::reset(int itemCount)
{
    m_itemCount = std::max(0, itemCount);
    m_lastItem = -1;
    m_remaining.clear();
}

int ShuffleBag::take()
{
    if (m_itemCount <= 0) {
        return -1;
    }

    if (m_remaining.isEmpty()) {
        refill();
    }

    const int item = m_remaining.takeLast();
    m_lastItem = item;
    return item;
}

int ShuffleBag::itemCount() const
{
    return m_itemCount;
}

void ShuffleBag::refill()
{
    m_remaining.resize(m_itemCount);
    std::iota(m_remaining.begin(), m_remaining.end(), 0);
    std::shuffle(m_remaining.begin(), m_remaining.end(), m_random);

    if (m_itemCount > 1 && m_remaining.constLast() == m_lastItem) {
        std::swap(m_remaining[0], m_remaining[m_remaining.size() - 1]);
    }
}

