#!/bin/zsh
# ElevenLabs Brian voiceover for Blackbox demo. Key read from env (~/.zshenv). Never printed.
set -e
cd "$(dirname "$0")"
mkdir -p audio
VOICE="nPczCjzI2devNBz1zQrb"   # Brian
MODEL="eleven_multilingual_v2"

typeset -A VO
VO[c1]="This is an AI agent's wallet on Swee. It spends real money, and every move is sealed on chain. Here's the proof, recomputed live in your browser."
VO[c2]="The agent can't go rogue. Its spending limit, rate cap, and allowed recipients are enforced by the contract, not by trust."
VO[c3]="Every action becomes a tamper evident memory. Encrypted with Seal, stored on Walrus, chained on chain."
VO[c4]="So what if someone edits one stored record? Flip a single byte, and watch."
VO[c5]="The seal no longer matches. That record and every one after it turn red. The chain caught it."
VO[c6]="Blackbox. Give an AI agent money without trusting it. Verify any agent yourself, link below."

for k in c1 c2 c3 c4 c5 c6; do
  out="audio/$k.mp3"
  if [[ -s "$out" ]]; then echo "skip $k (exists)"; continue; fi
  body=$(python3 -c "import json,sys; print(json.dumps({'text':sys.argv[1],'model_id':sys.argv[2],'voice_settings':{'stability':0.82,'similarity_boost':0.65,'style':0.03,'use_speaker_boost':True}}))" "${VO[$k]}" "$MODEL")
  curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE}" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" -H "Content-Type: application/json" \
    -d "$body" -o "$out"
  # validate: real mp3, not error JSON
  if file "$out" | grep -qiE 'audio|mpeg'; then
    echo "ok $k ($(wc -c < "$out") bytes)"
  else
    echo "FAIL $k:"; head -c 200 "$out"; echo; exit 1
  fi
done
echo "audio done"
