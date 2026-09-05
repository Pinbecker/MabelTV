"""Shared policy constants for the local library service."""

import re

SUPPORTED_EXTENSIONS = {".mp4", ".m4v", ".mkv", ".mov", ".webm", ".avi", ".mpg", ".mpeg"}
CHUNK_LIMIT = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = 64 * 1024 * 1024 * 1024
SESSION_SECONDS = 8 * 60 * 60
PLAYBACK_WIDTH = 1280
PLAYBACK_HEIGHT = 720
PLAYBACK_FPS = 30
MAX_CONVERSION_TEMP_C = 78.0
RESUME_CONVERSION_TEMP_C = 72.0
USB_IMPORT_RESERVE_BYTES = 256 * 1024 * 1024
USB_MAX_SELECTION_FILES = 2000
USB_IDLE_SECONDS = 60.0
USB_POWER_POLL_SECONDS = 5.0
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TMDB_BACKDROP_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w1280"
WATCHMODE_API_BASE_URL = "https://api.watchmode.com/v1"
LG_WEBOS_DEFAULT_PORT = 3001
LG_WEBOS_CLIENT_KEY_PATH = "/var/lib/mabeltv/secrets/lg-webos-client-key"
NETFLIX_TV_APP_ID = "netflix"
ADULT_DISCOVERY_CACHE_SECONDS = 24 * 60 * 60
ADULT_PROVIDER_CACHE_SECONDS = 7 * 24 * 60 * 60
ADULT_PROVIDER_MAX_CACHE_SECONDS = 29 * 24 * 60 * 60
OPENSUBTITLES_API_BASE_URL = "https://api.opensubtitles.com/api/v1"
OPENSUBTITLES_USER_AGENT = "MabelTV/0.2.5"
SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass", ".ssa"}
REMOTE_BROWSER_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}
REMOTE_SESSION_SECONDS = 2 * 60
EXTERNAL_VLC_SESSION_SECONDS = 6 * 60 * 60
EXTERNAL_DOWNLOAD_SESSION_SECONDS = 30 * 60
OFFLINE_PREPARED_CACHE_SECONDS = 2 * 24 * 60 * 60
REMOTE_RESUME_MIN_SECONDS = 30.0
REMOTE_COMPLETION_MIN_SECONDS = 180.0
REMOTE_COMPLETION_FRACTION = 0.05
VIEWING_SAMPLE_SECONDS = 15.0
VIEWING_SESSION_GAP_SECONDS = 120.0
VIEWING_MIN_SESSION_SECONDS = 120.0
VIEWING_MAX_SESSIONS = 50000
VIEWING_RETENTION_DAYS = 3650
UPLOAD_SOURCE_GRACE_SECONDS = 45
SAFE_NAME = re.compile(r"[^A-Za-z0-9 ._()&'\-]+")
EPISODE_NAME = re.compile(r"^s(\d{1,2})e(\d{1,3})\s*-\s*(.+)$", re.IGNORECASE)
PIN_PATTERN = re.compile(r"\d{4,8}")
PBKDF2_ITERATIONS = 260_000
PRODUCT_NAME = "KidsTV"
DEFAULT_CHANNELS = [
    {"number": 1, "name": "Kids TV", "folder": "kids-tv", "aspect": "crop",
     "content_type": "shows"},
    {"number": 2, "name": "Cartoons", "folder": "cartoons", "aspect": "crop",
     "content_type": "shows"},
    {"number": 3, "name": "Films", "folder": "films", "aspect": "fit",
     "content_type": "films"},
    {"number": 4, "name": "Family Videos", "folder": "family", "aspect": "fit",
     "content_type": "films"},
]

