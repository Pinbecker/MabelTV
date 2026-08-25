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
        libsystemd-dev \
        ninja-build \
        pkg-config \
        python3 \
        qt6-base-dev \
        qt6-declarative-dev \
        qt6-shadertools-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /source
