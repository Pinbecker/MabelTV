#pragma once
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QQmlNetworkAccessManagerFactory>
#include <QTimer>
#include <cstring>

// Native UI cases must never read or write the running Pi's family library.
class FamilyFixtureReply final : public QNetworkReply {
    QByteArray body = R"({"ok":true,"stories":[{"id":"shelf-book","title":"A little adventure","ready":true,"illustration":""}],"page_sound":""})";
    qint64 offset = 0;
public:
    FamilyFixtureReply(const QNetworkRequest& request, QObject* parent) : QNetworkReply(parent) {
        setRequest(request); setUrl(request.url());
        setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        setAttribute(QNetworkRequest::HttpStatusCodeAttribute, 200);
        open(QIODevice::ReadOnly | QIODevice::Unbuffered);
        QTimer::singleShot(0, this, [this] { setFinished(true); emit readyRead(); emit finished(); });
    }
    void abort() override {}
    qint64 bytesAvailable() const override { return body.size() - offset + QNetworkReply::bytesAvailable(); }
    qint64 readData(char* destination, qint64 maximum) override {
        const auto count = qMin(maximum, body.size() - offset);
        if (!count) return -1;
        std::memcpy(destination, body.constData() + offset, count); offset += count; return count;
    }
};

class FamilyFixtureNetwork final : public QNetworkAccessManager {
public:
    using QNetworkAccessManager::QNetworkAccessManager;
    QNetworkReply* createRequest(Operation operation, const QNetworkRequest& request, QIODevice* data) override {
        if (request.url().scheme() == "http" || request.url().scheme() == "https")
            return new FamilyFixtureReply(request, this);
        return QNetworkAccessManager::createRequest(operation, request, data);
    }
};

class FamilyNetworkFixture final : public QQmlNetworkAccessManagerFactory {
public:
    QNetworkAccessManager* create(QObject* parent) override { return new FamilyFixtureNetwork(parent); }
};
