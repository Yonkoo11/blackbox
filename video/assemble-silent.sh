#!/bin/zsh
# Captions-only (silent) motion assembly. Trims each recorded clip's tail to the caption read-time,
# overlays the caption, fades, concats, color-grades. No voiceover (ElevenLabs payment blocked).
set -e
cd "$(dirname "$0")"
setopt +o nomatch
rm -f seg_*.mp4 concat.txt

typeset -A DUR
DUR[c1]=7.0; DUR[c2]=6.0; DUR[c3]=5.5; DUR[c4]=4.5; DUR[c5]=6.0; DUR[c6]=6.0

for k in c1 c2 c3 c4 c5 c6; do
  d=${DUR[$k]}
  fo=$(python3 -c "print(round($d-0.3,3))")
  ffmpeg -y -sseof -${d} -i "clips/$k.webm" -i "composites/$k.png" \
    -filter_complex "[0:v]scale=1920:1080,setsar=1,fps=30[v0];[v0][1:v]overlay=0:0[ov];[ov]fade=t=in:st=0:d=0.3,fade=t=out:st=${fo}:d=0.3[v]" \
    -map "[v]" -t ${d} -an -c:v libx264 -preset fast -crf 21 -pix_fmt yuv420p "seg_$k.mp4" 2>/dev/null
  echo "seg $k (${d}s)"
  echo "file 'seg_$k.mp4'" >> concat.txt
done

# concat (re-encode to avoid drift), then color grade + add silent 48k audio track for universal playback
ffmpeg -y -f concat -safe 0 -i concat.txt -c:v libx264 -preset fast -crf 21 -pix_fmt yuv420p _joined.mp4 2>/dev/null
ffmpeg -y -i _joined.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo \
  -vf "eq=contrast=1.06:saturation=1.08:brightness=0.01" \
  -map 0:v -map 1:a -shortest \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 96k \
  blackbox-demo.mp4 2>/dev/null
rm -f _joined.mp4 seg_*.mp4 concat.txt
echo "=== done: video/blackbox-demo.mp4 ==="
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,sample_rate -of default=noprint_wrappers=1 blackbox-demo.mp4
