FROM debian:trixie-slim

# This image is built as linux/arm64 by buildx. It supplies the same Debian
# Trixie development ABI targeted by Raspberry Pi OS Lite 64-bit, while the
# host stays entirely on the maintainer's laptop.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        ffmpeg \
        git \
        libdrm-dev \
        libegl1-mesa-dev \
        libgl1-mesa-dev \
        libmpv-dev \
        libqt6opengl6-dev \
        libqt6sql6-sqlite \
        libsystemd-dev \
        ninja-build \
        nodejs \
        npm \
        pkg-config \
        python3 \
        qml6-module-qtquick \
        qml6-module-qtquick-window \
        qt6-base-dev \
        qt6-declarative-dev \
        qt6-image-formats-plugins \
        qt6-svg-plugins \
        qt6-shadertools-dev \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /source

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        qml6-module-qtqml-workerscript qml6-module-qtquick-shapes qml6-module-qtquick-effects \
    && rm -rf /var/lib/apt/lists/*
