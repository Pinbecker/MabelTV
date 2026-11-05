"""Decode generated proofs in a separate libmpv context without HDMI/audio output."""
import ctypes as c
import ctypes.util
import json
import pathlib
import time
import sys

root = pathlib.Path('/var/tmp/mabeltv-frame-rate-proof-20261105')
mpv = c.CDLL(ctypes.util.find_library('mpv'))
mpv.mpv_create.restype = c.c_void_p
mpv.mpv_set_option_string.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
mpv.mpv_initialize.argtypes = [c.c_void_p]
mpv.mpv_command.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
mpv.mpv_get_property_string.argtypes = [c.c_void_p, c.c_char_p]
mpv.mpv_get_property_string.restype = c.c_void_p
mpv.mpv_free.argtypes = [c.c_void_p]
mpv.mpv_terminate_destroy.argtypes = [c.c_void_p]


class Event(c.Structure):
    _fields_ = [('event_id', c.c_int), ('error', c.c_int), ('reply', c.c_uint64), ('data', c.c_void_p)]


class EndFile(c.Structure):
    _fields_ = [('reason', c.c_int), ('error', c.c_int)]


mpv.mpv_wait_event.argtypes = [c.c_void_p, c.c_double]
mpv.mpv_wait_event.restype = c.POINTER(Event)


def property_value(handle, name):
    value = mpv.mpv_get_property_string(handle, name.encode())
    if not value:
        return None
    try:
        return c.string_at(value).decode()
    finally:
        mpv.mpv_free(value)


results = []
for name in sys.argv[1:] or ['mabel-50-compact', 'mytv-50-compact', 'mytv-50-compatible', 'mytv-60']:
    handle = mpv.mpv_create()
    try:
        for key, value in {'config': 'no', 'load-scripts': 'no', 'vo': 'null', 'ao': 'null',
                           'hwdec': 'no', 'vd-lavc-threads': '2', 'terminal': 'no', 'volume': '0'}.items():
            assert mpv.mpv_set_option_string(handle, key.encode(), value.encode()) >= 0
        assert mpv.mpv_initialize(handle) >= 0
        args = (c.c_char_p * 3)(b'loadfile', str(root / (name + '.mp4')).encode(), None)
        assert mpv.mpv_command(handle, args) >= 0
        start, snapshots = time.monotonic(), []
        while time.monotonic() - start < 30:
            event = mpv.mpv_wait_event(handle, .2).contents
            if event.event_id == 7:
                ending = c.cast(event.data, c.POINTER(EndFile)).contents
                assert ending.reason == 0 and ending.error >= 0, (name, ending.reason, ending.error)
                break
            if property_value(handle, 'time-pos'):
                snapshots.append({key: property_value(handle, key) for key in
                                  ['time-pos', 'frame-drop-count', 'decoder-frame-drop-count', 'container-fps', 'avsync']})
        else:
            raise AssertionError('Playback timed out: ' + name)
        assert snapshots and max(float(v['time-pos']) for v in snapshots) > 11
        assert all(float(v[key] or 0) == 0 for v in snapshots for key in ['frame-drop-count', 'decoder-frame-drop-count'])
        result = {'name': name, 'seconds': round(time.monotonic() - start, 2), 'samples': len(snapshots), 'last': snapshots[-1]}
        results.append(result)
        print(json.dumps(result), flush=True)
    finally:
        mpv.mpv_terminate_destroy(handle)
(root / 'pi-results.json').write_text(json.dumps(results, indent=2))
