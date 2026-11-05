#include "hardware/DisplayRefresh.h"
#include <QtTest>
#include <limits>

class DisplayRefreshTests : public QObject {
    Q_OBJECT
private slots:
    void preservesSourceCadence() {
        const std::vector<double> rates{60, 50, 30, 24, 24000.0/1001, 60000.0/1001};
        using mabeltv::display::chooseRate;
        QCOMPARE(rates[chooseRate(50, rates)], 50.0);
        QCOMPARE(rates[chooseRate(25, rates)], 50.0);
        QCOMPARE(rates[chooseRate(24, rates)], 24.0);
        QCOMPARE(rates[chooseRate(24000.0/1001, rates)], 24000.0/1001);
        QCOMPARE(rates[chooseRate(30, rates)], 60.0);
        QCOMPARE(rates[chooseRate(30000.0/1001, rates)], 60000.0/1001);
        QCOMPARE(rates[chooseRate(60, rates)], 60.0);
        QCOMPARE(rates[chooseRate(0, rates)], 60.0);
    }
    void choosesSupportedModesWithoutForcing120HzOrReducing50To30() {
        using mabeltv::display::chooseRate;
        QCOMPARE(chooseRate(50, {30, 60, 120}), 1);
        QCOMPARE(chooseRate(24, {24, 48, 120}), 1);
        QCOMPARE(chooseRate(50, {}), -1);
        QCOMPARE(chooseRate(120, {120}), -1);
        QCOMPARE(chooseRate(std::numeric_limits<double>::quiet_NaN(), {60}), -1);
        QCOMPARE(chooseRate(50, {0, -1, std::numeric_limits<double>::quiet_NaN()}), -1);
    }
};
QTEST_APPLESS_MAIN(DisplayRefreshTests)
#include "DisplayRefreshTests.moc"
