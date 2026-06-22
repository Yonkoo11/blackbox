#!/bin/zsh
# Free neural voiceover via Microsoft edge-tts (no API key, no payment). Andrew voice.
set -e
cd "$(dirname "$0")"
mkdir -p audio
VOICE="en-US-AndrewNeural"
RATE="-4%"   # slightly deliberate pacing

typeset -A VO
VO[c1]="This is an AI agent's wallet on Swee. It spends real money, and every move is sealed on chain. Here's the proof, recomputed live in your browser."
VO[c2]="The agent can't go rogue. Its spending limit, rate cap, and allowed recipients are enforced by the contract, not by trust."
VO[c3]="Every action becomes a tamper evident memory. Encrypted with Seal, stored on Walrus, chained on chain."
VO[c4]="So what if someone edits one stored record? Flip a single byte, and watch."
VO[c5]="The seal no longer matches. That record and every one after it turn red. The chain caught it."
VO[c6]="Blackbox. Give an AI agent money without trusting it. Verify any agent yourself, link below."

for k in c1 c2 c3 c4 c5 c6; do
  out="audio/$k.mp3"
  /usr/bin/python3 -m edge_tts --voice "$VOICE" --rate="$RATE" --text "${VO[$k]}" --write-media "$out" >/dev/null 2>&1
  if file "$out" | grep -qiE 'mpeg|audio'; then
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
    echo "ok $k (${d}s)"
  else
    echo "FAIL $k"; head -c 160 "$out"; exit 1
  fi
done
echo "edge audio done"
