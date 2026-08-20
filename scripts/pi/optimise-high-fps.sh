#!/usr/bin/env bash
# Re-encode explicitly selected high-frame-rate programmes for reliable Pi
# playback. Each replacement is validated before its original is removed.
set -Eeuo pipefail

if (($# == 0)); then
    printf 'Usage: sudo mabeltv-optimise-high-fps <video.mp4> [video.mp4 ...]\n' >&2
    exit 2
fi

# Encoding in a hot enclosure can make the Pi unresponsive long before it
# reaches its emergency shutdown temperature. One worker is slower but keeps
# the appliance manageable; the guard retains the original if cooling is not
# sufficient. Set MABELTV_OPTIMISE_MAX_TEMP_C to override for maintenance.
max_temperature_c="${MABELTV_OPTIMISE_MAX_TEMP_C:-78}"
resume_temperature_c="${MABELTV_OPTIMISE_RESUME_TEMP_C:-72}"
if ! awk -v limit="$max_temperature_c" 'BEGIN { exit !(limit >= 50 && limit <= 80) }'; then
    printf 'MABELTV_OPTIMISE_MAX_TEMP_C must be between 50 and 80.\n' >&2
    exit 2
fi

for source in "$@"; do
    [[ -f "$source" ]] || { printf 'Missing source: %s\n' "$source" >&2; exit 1; }
    [[ "$source" == *.mp4 ]] || { printf 'Only MP4 sources are supported: %s\n' "$source" >&2; exit 1; }

    media_root=/srv/mabeltv/media
    incoming="$media_root/.incoming"
    install -d -o mabeltv -g mabeltv -m 0750 "$incoming"
    temporary="$(mktemp "$incoming/manual.XXXXXX.optimising.mp4")"
    backup="${source%.mp4}.pre-fps30.mp4"
    [[ ! -e "$backup" ]] || {
        printf 'Refusing to replace %s because a recovery file already exists.\n' "$source" >&2
        exit 1
    }

    printf 'Optimising %s\n' "$source"
    ffmpeg -hide_banner -loglevel error -y -threads 1 -filter_threads 1 -i "$source" \
        -map 0:v:0 -map 0:a:0? \
        -vf 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30' \
        -c:v h264_v4l2m2m -b:v 2500k -maxrate 3000k -bufsize 5000k \
        -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$temporary" &
    encoder_pid=$!
    (
        while kill -0 "$encoder_pid" 2>/dev/null; do
            temperature="$(vcgencmd measure_temp 2>/dev/null | sed -nE 's/.*=([0-9.]+).*/\1/p')"
            if [[ -n "$temperature" ]] \
                && awk -v current="$temperature" -v limit="$max_temperature_c" 'BEGIN { exit !(current >= limit) }'; then
                printf 'Pausing encode at %sC (limit %sC).\n' "$temperature" "$max_temperature_c" >&2
                kill -STOP "$encoder_pid" 2>/dev/null || true
                while kill -0 "$encoder_pid" 2>/dev/null; do
                    temperature="$(vcgencmd measure_temp 2>/dev/null | sed -nE 's/.*=([0-9.]+).*/\1/p')"
                    if [[ -n "$temperature" ]] \
                        && awk -v current="$temperature" -v resume="$resume_temperature_c" 'BEGIN { exit !(current <= resume) }'; then
                        printf 'Resuming encode at %sC.\n' "$temperature" >&2
                        kill -CONT "$encoder_pid" 2>/dev/null || true
                        break
                    fi
                    sleep 5
                done
            fi
            sleep 5
        done
    ) &
    guard_pid=$!
    set +e
    wait "$encoder_pid"
    encoder_status=$?
    kill "$guard_pid" 2>/dev/null || true
    wait "$guard_pid" 2>/dev/null || true
    set -e
    if (( encoder_status != 0 )); then
        rm -f -- "$temporary"
        printf 'Encoding failed or was stopped for %s. Original retained.\n' "$source" >&2
        exit "$encoder_status"
    fi

    stream="$(ffprobe -v error -select_streams v:0 \
        -show_entries stream=codec_name,width,height,avg_frame_rate \
        -of csv=p=0 "$temporary")"
    IFS=, read -r codec width height frame_rate <<< "$stream"
    fps="$(awk -F/ 'NF == 2 && $2 != 0 { print $1 / $2; exit } NF == 1 { print $1; exit }' <<< "$frame_rate")"
    if [[ "$codec" != "h264" ]] || ! [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] \
        || ! awk -v fps="$fps" 'BEGIN { exit !(fps > 0 && fps <= 30.1) }' \
        || (( width > 1280 || height > 720 )); then
        rm -f -- "$temporary"
        printf 'Validation failed for %s (%s). Original retained.\n' "$source" "$stream" >&2
        exit 1
    fi

    mv -- "$source" "$backup"
    mv -- "$temporary" "$source"
    rm -- "$backup"
    printf 'Ready: %s (%sx%s at %s fps)\n' "$source" "$width" "$height" "$fps"
done
