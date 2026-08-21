#!/bin/bash -e

bootstrap_dir="${ROOTFS_DIR}/usr/lib/mabeltv-bootstrap"
install -d -m 0700 "${bootstrap_dir}"
install -m 0600 files/release.tar.gz "${bootstrap_dir}/release.tar.gz"
install -m 0600 files/release.sha256 "${bootstrap_dir}/release.sha256"
install -m 0644 files/image-build.json "${bootstrap_dir}/image-build.json"
install -m 0755 files/mabeltv-image-firstboot \
	"${ROOTFS_DIR}/usr/local/sbin/mabeltv-image-firstboot"
install -m 0644 files/mabeltv-image-firstboot.service \
	"${ROOTFS_DIR}/etc/systemd/system/mabeltv-image-firstboot.service"

on_chroot <<'EOF'
systemctl enable mabeltv-image-firstboot.service
EOF
