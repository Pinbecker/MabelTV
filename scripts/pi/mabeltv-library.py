#!/usr/bin/env python3
"""Local, parent-protected media library for a KidsTV appliance.

The service deliberately uses only Python's standard library.  It is bound to
the home network by systemd, runs as the unprivileged mabeltv user, and never
serves a partial upload from the media folders watched by the TV application.
"""

from __future__ import annotations

import argparse
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.request import urlopen

SERVICE_ROOT = Path(__file__).resolve().parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from mabeltv_backend.auth import AuthenticationMixin
from mabeltv_backend.adult_metadata import AdultMetadataMixin
from mabeltv_backend.adult_insights import AdultInsightsMixin
from mabeltv_backend.artwork import ArtworkProxyMixin
from mabeltv_backend.constants import (
    DEFAULT_CHANNELS,
    LG_WEBOS_CLIENT_KEY_PATH,
    USB_IDLE_SECONDS,
    USB_POWER_POLL_SECONDS,
    VIEWING_SAMPLE_SECONDS,
)
from mabeltv_backend.discovery import AdultExploreMixin
from mabeltv_backend.database import StateDatabase
from mabeltv_backend.http import Handler, LibraryServer
from mabeltv_backend.lg import LgWebOsError, LgWebOsSocket, RemoteTvActiveError
from mabeltv_backend.lg_control import LgControlMixin
from mabeltv_backend.live_stream import LiveStream
from mabeltv_backend.media import MediaCatalogueMixin
from mabeltv_backend.management import ManagementMixin
from mabeltv_backend.portal import (
    INDEX,
    PORTAL_APP_SCRIPT,
    PORTAL_APP_SOURCES,
    PORTAL_INCLUDE,
    WATCH_PAGE,
    load_index,
    load_portal_app_script,
    load_portal_document,
    load_watch_page,
)
from mabeltv_backend.providers import ProviderMetadataMixin
from mabeltv_backend.provider_transport import ProviderTransportMixin
from mabeltv_backend.remote import RemotePlaybackMixin
from mabeltv_backend.system import SystemStatusMixin
from mabeltv_backend.transcoding import TranscodingMixin
from mabeltv_backend.uploads import UploadConversionMixin
from mabeltv_backend.usb import UsbMixin
from mabeltv_backend.viewing import ViewingMixin
from mabeltv_backend.viewing_queue import ViewingQueueMixin

__all__ = [
    "DEFAULT_CHANNELS",
    "INDEX",
    "PORTAL_APP_SCRIPT",
    "PORTAL_APP_SOURCES",
    "PORTAL_INCLUDE",
    "WATCH_PAGE",
    "Handler",
    "LgWebOsError",
    "LgWebOsSocket",
    "Library",
    "LibraryServer",
    "LiveStream",
    "RemoteTvActiveError",
    "load_index",
    "load_portal_app_script",
    "load_portal_document",
    "load_watch_page",
    "os",
    "shutil",
    "socket",
    "subprocess",
    "threading",
    "time",
    "urlopen",
]

class Library(ViewingMixin, UploadConversionMixin, TranscodingMixin, AuthenticationMixin,
              ArtworkProxyMixin,
              MediaCatalogueMixin, ManagementMixin, RemotePlaybackMixin, LgControlMixin,
              UsbMixin,
              ProviderTransportMixin, AdultMetadataMixin, ProviderMetadataMixin,
              ViewingQueueMixin,
              AdultInsightsMixin, AdultExploreMixin,
              SystemStatusMixin):
    def __init__(self, args: argparse.Namespace) -> None:
        self.media_root = Path(args.media_root).resolve()
        self.config_path = Path(args.config).resolve()
        database_value = getattr(args, "database", None)
        if not database_value:
            raise RuntimeError("MabelTV requires an authoritative SQLite database")
        self.database_path = Path(database_value).resolve()
        self.state_database = StateDatabase(self.database_path)
        self.state_database.verify_ready()
        self.owner_recovery_path = self.database_path.with_name("owner-recovery-pending")
        self.incoming = self.media_root / ".incoming"
        self.adult_root = self.media_root / ".adult"
        self.adult_artwork_root = self.adult_root / ".metadata"
        self.adult_series_root = self.adult_root / ".series"
        self.adult_series_artwork_root = self.adult_root / ".series-metadata"
        self.channel_artwork_root = self.media_root / ".channel-metadata"
        configured_usb_root = os.environ.get("MABELTV_USB_ROOT")
        self.usb_root = Path(configured_usb_root or "/media/mabeltv-usb").resolve()
        # A real installation must only browse an actual mount. Tests and the
        # local portal preview deliberately use a private directory fixture.
        self.usb_requires_mount = configured_usb_root is None
        self.tmdb_key_path = Path(os.environ.get(
            "MABELTV_TMDB_API_KEY_FILE", "/var/lib/mabeltv/secrets/tmdb-api-key"))
        self.watchmode_key_path = Path(os.environ.get(
            "MABELTV_WATCHMODE_API_KEY_FILE",
            "/var/lib/mabeltv/secrets/watchmode-api-key"))
        self.opensubtitles_key_path = Path(os.environ.get(
            "MABELTV_OPENSUBTITLES_API_KEY_FILE",
            "/var/lib/mabeltv/secrets/opensubtitles-api-key"))
        self.lg_tv_host = os.environ.get("MABELTV_LG_TV_HOST", "").strip()
        self.lg_tv_client_key_path = Path(os.environ.get(
            "MABELTV_LG_TV_CLIENT_KEY_FILE", LG_WEBOS_CLIENT_KEY_PATH))
        self.lg_tv_lock = threading.Lock()
        self.lg_tv_pointer_socket: LgWebOsSocket | None = None
        self.lg_tv_catalog_cache: dict[str, Any] = {}
        self.lg_tv_catalog_updated = 0.0
        self.tmdb_artwork_cache_root = Path(os.environ.get(
            "MABELTV_TMDB_ARTWORK_CACHE", "/var/cache/mabeltv/tmdb-artwork")).resolve()
        self.tmdb_artwork_prune_lock = threading.Lock()
        self.tmdb_artwork_last_prune = 0.0
        self.bin = self.media_root / ".recycle-bin"
        self.sessions: dict[str, float] = {}
        self.login_failures: dict[str, list[float]] = {}
        self.config_lock = threading.RLock()
        self.channel_programme_duration_cache: dict[tuple[str, int, int], float] = {}
        self.channel_programme_duration_lock = threading.RLock()
        self.upload_locks: dict[str, threading.Lock] = {}
        self.conversion_queue: queue.Queue[str | None] = queue.Queue()
        self.queued_conversions: set[str] = set()
        self.deferred_retries: set[str] = set()
        self.cancelled_conversions: set[str] = set()
        self.adult_optimisation_active: set[str] = set()
        self.adult_optimisation_lock = threading.Lock()
        self.adult_optimisation_serial = threading.Lock()
        self.adult_optimisation_progress_callback: Any = None
        self.remote_stream_lock = threading.RLock()
        self.remote_stream: dict[str, Any] | None = None
        self.viewing_lock = threading.RLock()
        self.viewing_closed = threading.Event()
        self.viewing_worker: threading.Thread | None = None
        self.viewing_last_tv_sample: tuple[dict[str, Any], float] | None = None
        self.viewing_remote_samples: dict[str, tuple[float, float]] = {}
        self.viewing_pending: dict[tuple[str, str], dict[str, Any]] = {}
        self.viewing_dirty = False
        self.viewing_last_flush = 0.0
        self.viewing_store = self.load_viewing_store()
        self.adult_insights_lock = threading.Lock()
        self.adult_insights_closed = threading.Event()
        self.adult_insights_worker: threading.Thread | None = None
        self.external_stream_lock = threading.RLock()
        self.external_streams: dict[str, dict[str, Any]] = {}
        self.offline_cache = self.media_root / ".offline-prepared"
        self.usb_import_root = self.incoming / ".usb-imports"
        self.offline_preparation_lock = threading.RLock()
        self.offline_preparations: dict[str, dict[str, Any]] = {}
        self.usb_transfer_closed = threading.Event()
        self.usb_transfer_wakeup = threading.Event()
        self.usb_action_lock = threading.RLock()
        self.usb_power_lock = threading.RLock()
        self.usb_last_activity: dict[str, float] = {}
        self.usb_sleeping: set[str] = set()
        self.usb_idle_seconds = max(5.0, float(os.environ.get(
            "MABELTV_USB_IDLE_SECONDS", USB_IDLE_SECONDS)))
        self.usb_power_closed = threading.Event()
        self.usb_power_worker: threading.Thread | None = None
        self.conversion_closed = threading.Event()
        self.media_root.mkdir(parents=True, exist_ok=True)
        self.incoming.mkdir(mode=0o750, exist_ok=True)
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_series_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_series_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.channel_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.tmdb_artwork_cache_root.mkdir(mode=0o750, parents=True, exist_ok=True)
        self.offline_cache.mkdir(mode=0o750, exist_ok=True)
        self.usb_import_root.mkdir(mode=0o750, exist_ok=True)
        self.bin.mkdir(mode=0o750, exist_ok=True)
        self.reconcile_recycle_items()
        self.cleanup_stale_temporary_files()
        self.cleanup_offline_prepared_cache()
        self.recover_adult_optimisations()
        self.recover_final_results()
        self.resume_conversion_jobs()
        self.conversion_worker = threading.Thread(
            target=self.run_conversion_worker,
            name="mabeltv-conversion",
            daemon=True,
        )
        self.conversion_worker.start()
        self.usb_transfer_worker = threading.Thread(
            target=self.run_usb_transfer_worker,
            name="mabeltv-usb-transfer",
            daemon=True,
        )
        self.usb_transfer_worker.start()
        self.live_stream = LiveStream(self)
        if os.name == "posix" and self.usb_requires_mount:
            self.usb_power_worker = threading.Thread(
                target=self.run_usb_power_worker,
                name="mabeltv-usb-power",
                daemon=True,
            )
            self.usb_power_worker.start()

    def close(self, timeout: float = 10.0) -> None:
        """Drain and stop the single media worker (primarily for clean tests)."""
        if self.conversion_closed.is_set():
            return
        with self.lg_tv_lock:
            self.close_lg_tv_pointer()
        self.usb_transfer_closed.set()
        self.usb_transfer_wakeup.set()
        self.usb_transfer_worker.join(timeout=timeout)
        if self.usb_transfer_worker.is_alive():
            raise RuntimeError("The USB transfer worker did not stop cleanly")
        self.conversion_closed.set()
        self.usb_power_closed.set()
        self.viewing_closed.set()
        self.adult_insights_closed.set()
        self.conversion_queue.put(None)
        self.conversion_worker.join(timeout=timeout)
        if self.usb_power_worker:
            self.usb_power_worker.join(timeout=min(timeout, USB_POWER_POLL_SECONDS + 1))
        if self.viewing_worker:
            self.viewing_worker.join(timeout=min(timeout, VIEWING_SAMPLE_SECONDS + 1))
        if self.adult_insights_worker:
            self.adult_insights_worker.join(timeout=min(timeout, 2.0))
        self.flush_viewing_store(force=True)
        if self.conversion_worker.is_alive():
            raise RuntimeError("The media worker did not stop cleanly")
        self.live_stream.stop()

    @staticmethod
    def _open_url(*args: Any, **kwargs: Any) -> Any:
        """Use the executable's patchable network hook."""
        return urlopen(*args, **kwargs)


def main() -> None:
    parser = argparse.ArgumentParser(description="Mabel TV local media library")
    parser.add_argument("--bind", default="0.0.0.0"); parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--media-root", default="/srv/mabeltv/media")
    parser.add_argument("--config", default="/etc/mabeltv/library.conf")
    parser.add_argument("--database", default="/var/lib/mabeltv/mabeltv.db")
    args = parser.parse_args(); LibraryServer((args.bind, args.port), Library(args)).serve_forever()


if __name__ == "__main__": main()
