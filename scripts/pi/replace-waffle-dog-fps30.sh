#!/usr/bin/env bash
# Replace the five remaining 50fps Waffle Dog programmes with validated local
# 30fps copies. Originals remain recoverable until every replacement passes.
set -Eeuo pipefail

readonly media='/srv/mabeltv/media/Waffle Dog'
readonly stage='/home/pinbecker/waffle-fps30-staging'
readonly backup="/var/backups/mabeltv/waffle-fps30-$(date +%Y%m%d-%H%M%S)"

declare -A replacements=(
    ['S01E03 - Goodbye Waffle.mp4']='Waffle_the_Wonder_Dog_Series_1_-_03._Goodbye_Waffle_b09tn3pm_original.mp4'
    ['S01E04 - Waffle Explores.mp4']='Waffle_the_Wonder_Dog_Series_1_-_04._Waffle_Explores_b09tn4hy_editorial.mp4'
    ['S01E05 - Waffle Grows.mp4']='Waffle_the_Wonder_Dog_Series_1_-_05._Waffle_Grows_b09tn5fc_original.mp4'
    ["S01E06 - Waffle's Paint Disaster.mp4"]='Waffle_the_Wonder_Dog_Series_1_-_06._Waffles_Paint_Disaster_b09vjzv9_original.mp4'
    ['S01E07 - Waffle Walkies.mp4']='Waffle_the_Wonder_Dog_Series_1_-_07._Waffle_Walkies_b09vk2cc_original.mp4'
)

validate() {
    local file="$1" video audio
    video="$(ffprobe -v error -select_streams v:0 \
        -show_entries stream=codec_name,width,height,avg_frame_rate,pix_fmt \
        -of csv=p=0 "$file")"
    audio="$(ffprobe -v error -select_streams a:0 \
        -show_entries stream=codec_name,channels -of csv=p=0 "$file")"
    [[ "$video" == 'h264,1280,720,yuv420p,30/1' && "$audio" == 'aac,2' ]]
}

systemctl stop mabeltv.service

for staged_name in "${!replacements[@]}"; do
    validate "$stage/$staged_name" || {
        printf 'Staged replacement failed validation: %s\n' "$staged_name" >&2
        exit 1
    }
done

install -d -o root -g root -m 0700 "$backup"
rollback_needed=true
rollback() {
    if [[ "$rollback_needed" != true ]]; then
        return
    fi
    for staged_name in "${!replacements[@]}"; do
        target="$media/${replacements[$staged_name]}"
        [[ -e "$backup/${replacements[$staged_name]}" ]] || continue
        rm -f -- "$target"
        mv -- "$backup/${replacements[$staged_name]}" "$target"
    done
}
trap rollback ERR

for staged_name in "${!replacements[@]}"; do
    target_name="${replacements[$staged_name]}"
    mv -- "$media/$target_name" "$backup/$target_name"
    mv -- "$stage/$staged_name" "$media/$target_name"
done
chown mabeltv:mabeltv "$media"/*.mp4

for staged_name in "${!replacements[@]}"; do
    validate "$media/${replacements[$staged_name]}" || {
        printf 'Installed replacement failed validation: %s\n' "$staged_name" >&2
        exit 1
    }
done

rollback_needed=false
rm -rf -- "$backup"
rmdir "$stage"
systemctl start mabeltv.service
printf 'Replaced and validated five Waffle Dog programmes at 30fps.\n'
