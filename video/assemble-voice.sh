#!/bin/zsh
# Voiced motion assembly. Per segment: 0.5s lead-in silence, then edge-tts voice; motion video
# from the recorded clip, holding its last frame if the voice runs longer; caption overlay; fades.
set -e
cd "$(dirname "$0")"
setopt +o nomatch
rm -f seg_*.mp4 concat.txt

LEAD=0.5; BREATH=0.3
for k in c1 c2 c3 c4 c5 c6; do
  ad=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "audio/$k.mp3")
  TOTAL=$(python3 -c "print(round($LEAD+$ad+$BREATH,3))")
  VFO=$(python3 -c "print(round($TOTAL-0.25,3))")          # video fade-out start
  AFO=$(python3 -c "print(round($LEAD+$ad-0.2,3))")        # audio fade-out start
  ffmpeg -y -sseof -${TOTAL} -i "clips/$k.webm" -i "composites/$k.png" -i "audio/$k.mp3" \
    -filter_complex "\
[0:v]scale=1920:1080,setsar=1,fps=30[v0];\
[v0][1:v]overlay=0:0[ov];\
[ov]tpad=stop_mode=clone:stop_duration=15[ovp];\
[ovp]fade=t=in:st=0:d=0.25,fade=t=out:st=${VFO}:d=0.25[v];\
anullsrc=r=48000:cl=stereo,atrim=0:${LEAD}[sil];\
[sil][2:a]concat=n=2:v=0:a=1[a0];\
[a0]afade=t=in:st=${LEAD}:d=0.12,afade=t=out:st=${AFO}:d=0.2,apad[a]" \
    -map "[v]" -map "[a]" -t ${TOTAL} \
    -c:v libx264 -preset fast -crf 21 -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 96k "seg_$k.mp4" 2>/dev/null
  echo "seg $k  audio=${ad}s total=${TOTAL}s"
  echo "file 'seg_$k.mp4'" >> concat.txt
done

ffmpeg -y -f concat -safe 0 -i concat.txt -c:v libx264 -preset fast -crf 21 -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 96k _joined.mp4 2>/dev/null
# color grade + lock 48k audio (loudnorm-free; just eq)
ffmpeg -y -i _joined.mp4 -vf "eq=contrast=1.06:saturation=1.08:brightness=0.01" \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 96k blackbox-demo.mp4 2>/dev/null
rm -f _joined.mp4 seg_*.mp4 concat.txt
echo "=== done ==="
ffprobe -v error -show_entries format=duration:stream=codec_type,sample_rate -of default=noprint_wrappers=1 blackbox-demo.mp4