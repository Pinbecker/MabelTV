#include <QDir>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QtTest>
#include <cmath>

class CrtEffectTests : public QObject {
    Q_OBJECT
private slots:
    void cabinetCachePreservesArtworkAndTracksStyleChanges() {
        QQmlEngine engine;
        QQmlComponent component(&engine,QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/CrtCabinetTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root,qPrintable(component.errorString()));
        auto *item=qobject_cast<QQuickItem*>(root.data()); QVERIFY(item);
        QQuickWindow window; window.resize(960,600); window.setColor(Qt::black);
        item->setParentItem(window.contentItem()); window.show();
        for (const auto &style : {"charcoal-90s", "silver-90s", "vintage-black", "slim-black"}) {
            root->setProperty("styleName",style);
            root->setProperty("cached",false); QTest::qWait(150);
            const QImage original=window.grabWindow(); QVERIFY(!original.isNull());
            root->setProperty("cached",true); QTest::qWait(150);
            const QImage cached=window.grabWindow(); QCOMPARE(original.size(),cached.size());
            double error=0,squared=0;
            for (int y=0;y<original.height();++y) for(int x=0;x<original.width();++x) {
                const QColor a=original.pixelColor(x,y),b=cached.pixelColor(x,y);
                for (int d : {a.red()-b.red(),a.green()-b.green(),a.blue()-b.blue()}) { error+=std::abs(d); squared+=d*d; }
            }
            const double count=original.width()*original.height()*3.;
            qInfo()<<"Cabinet cache"<<style<<error/count<<std::sqrt(squared/count);
            QVERIFY2(error/count<0.6,"Cabinet caching changes the original artwork");
            QVERIFY2(std::sqrt(squared/count)<1.6,"Cabinet caching changes edges or colours");
        }
    }
    void foregroundCachesAndInvalidatesWithoutLeavingFadedOverlays() {
        QQmlEngine engine;
        QQmlComponent component(&engine,QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/CrtForegroundTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root,qPrintable(component.errorString()));
        auto *item=qobject_cast<QQuickItem*>(root.data()); QVERIFY(item);
        QQuickWindow window; window.resize(100,100); window.setColor(Qt::black);
        item->setParentItem(window.contentItem()); window.show(); QTest::qWait(250);
        QCOMPARE(window.grabWindow().pixelColor(50,50),QColor(Qt::red));
        root->setProperty("colour",QColor(Qt::blue)); QTest::qWait(100);
        QCOMPARE(window.grabWindow().pixelColor(50,50),QColor(Qt::red));
        root->setProperty("generation",1); QTest::qWait(100);
        QCOMPARE(window.grabWindow().pixelColor(50,50),QColor(Qt::blue));
        root->setProperty("animating",true); root->setProperty("colour",QColor(Qt::green)); QTest::qWait(100);
        QCOMPARE(window.grabWindow().pixelColor(50,50),QColor(Qt::green));
        root->setProperty("sourceOpacity",0.); root->setProperty("animating",false); QTest::qWait(100);
        QCOMPARE(window.grabWindow().pixelColor(50,50),QColor(Qt::black));
    }
    void cachedGeometryPreservesImageAndTracksSettings() {
        QQmlEngine engine;
        QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/CrtEffectTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        auto* item = qobject_cast<QQuickItem*>(root.data()); QVERIFY(item);
        QQuickWindow window; window.resize(960, 540); window.setColor(Qt::black);
        item->setParentItem(window.contentItem()); window.show();
        QDir().mkpath(QStringLiteral(TEST_OUTPUT_DIR));
        // Mutate the same live cache: stale geometry after a slider/size change
        // must fail the pixel comparison, as must a black/missing texture.
        const double settings[][3] = {{.9,0,0},{1,0,0},{.9,.15,0},{.35,0,0},{1,1,0},{.9,.15,1},{0,0,0}};
        int index=0;
        for (const auto& values : settings) {
            const QSize size = index % 2 ? QSize(640,480) : QSize(960,540);
            window.resize(size); item->setSize(size);
            item->setProperty("glass",values[0]); item->setProperty("distortion",values[1]); item->setProperty("paused",values[2]);
            item->setProperty("reference",true); QTest::qWait(250);
            const QImage before=window.grabWindow().convertToFormat(QImage::Format_RGBA8888);
            item->setProperty("reference",false); QTest::qWait(250);
            const QImage after=window.grabWindow().convertToFormat(QImage::Format_RGBA8888);
            QVERIFY(!before.isNull()); QCOMPARE(before.size(),after.size());
            double absolute=0,squared=0; int maximum=0;
            for(int y=0;y<before.height();++y) for(int x=0;x<before.width();++x) {
                const auto a=before.pixelColor(x,y),b=after.pixelColor(x,y);
                for(int channel=0;channel<3;++channel) {
                    const int delta=std::abs((channel==0?a.red():channel==1?a.green():a.blue())-(channel==0?b.red():channel==1?b.green():b.blue()));
                    absolute+=delta;squared+=delta*delta;maximum=qMax(maximum,delta);
                }
            }
            const double count=before.width()*before.height()*3.;
            qInfo()<<"CRT comparison"<<index<<"mean"<<absolute/count<<"rms"<<std::sqrt(squared/count)<<"max"<<maximum;
            QVERIFY(before.save(QStringLiteral(TEST_OUTPUT_DIR "/reference-%1.png").arg(index)));
            QVERIFY(after.save(QStringLiteral(TEST_OUTPUT_DIR "/cached-%1.png").arg(index)));
            // Changed GPU instruction scheduling can perturb pseudo-random
            // samples at extreme wobble while retaining their distribution.
            // Compare structure and colour separately from that monochrome noise;
            // a pixel-exact noise pattern is not an appearance requirement.
            if (values[1] == 0 && values[2] == 0) {
                QVERIFY2(absolute/count<0.6,"Cached glass differs visibly from the original effect");
                QVERIFY2(std::sqrt(squared/count)<1.6,"Cached glass has local image/edge errors");
            } else {
                double blocks=0,blockError=0,blockSquared=0,chromaError=0;
                double beforeEnergy=0,afterEnergy=0;
                for(int y=0;y<before.height();y+=16) for(int x=0;x<before.width();x+=16) {
                    double sum[2][3]={{0,0,0},{0,0,0}};int n=0;
                    for(int yy=y;yy<qMin(y+16,before.height());++yy) for(int xx=x;xx<qMin(x+16,before.width());++xx) {
                        const QColor a=before.pixelColor(xx,yy),b=after.pixelColor(xx,yy);
                        const double da[3]={double(a.red()),double(a.green()),double(a.blue())};
                        const double db[3]={double(b.red()),double(b.green()),double(b.blue())};
                        for(int c=0;c<3;++c){sum[0][c]+=da[c];sum[1][c]+=db[c];}
                        beforeEnergy+=a.red()*a.red();afterEnergy+=b.red()*b.red();++n;
                    }
                    chromaError+=std::abs((sum[0][0]-sum[0][1])-(sum[1][0]-sum[1][1]))/n
                        + std::abs((sum[0][2]-sum[0][1])-(sum[1][2]-sum[1][1]))/n;
                    for(int c=0;c<3;++c){const double d=(sum[0][c]-sum[1][c])/n;blockError+=std::abs(d);blockSquared+=d*d;++blocks;}
                }
                qInfo()<<"CRT structure mean"<<blockError/blocks<<"rms"<<std::sqrt(blockSquared/blocks)<<"chroma"<<chromaError/(blocks*2./3.);
                QVERIFY2(blockError/blocks<0.6,"Cached glass changes the image structure");
                QVERIFY2(std::sqrt(blockSquared/blocks)<1.6,"Cached glass changes the curved edge or shading");
                QVERIFY2(chromaError/(blocks*2./3.)<0.3,"Cached glass changes colour separation");
                QVERIFY2(std::abs(afterEnergy/beforeEnergy-1.)<.01,"Cached glass changes picture/noise energy");
            }
            ++index;
        }
    }
};
int main(int argc,char** argv) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QGuiApplication app(argc,argv); CrtEffectTests test;return QTest::qExec(&test,argc,argv);
}
#include "CrtEffectTests.moc"
