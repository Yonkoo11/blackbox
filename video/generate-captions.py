#!/usr/bin/env python3
# Transparent 1920x1080 caption overlays (Helvetica 32px, bottom-center box). Verbatim captions.
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
OUT = os.path.join(os.path.dirname(__file__), 'composites')
os.makedirs(OUT, exist_ok=True)

CAPS = {
 'c1': "This is an AI agent's wallet on Sui. It spends real money, and every move is sealed on chain. Here's the proof, recomputed live in your browser.",
 'c2': "The agent can't go rogue. Its spending limit, rate cap, and allowed recipients are enforced by the contract, not by trust.",
 'c3': "Every action becomes a tamper evident memory. Encrypted with Seal, stored on Walrus, chained on chain.",
 'c4': "So what if someone edits one stored record? Flip a single byte, and watch.",
 'c5': "The seal no longer matches. That record and every one after it turn red. The chain caught it.",
 'c6': "Blackbox. Give an AI agent money without trusting it. Verify any agent yourself, link below.",
}

def font(sz):
    for p in ['/System/Library/Fonts/HelveticaNeue.ttc','/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/SFNS.ttf','/Library/Fonts/Arial.ttf']:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()

F = font(34)

def wrap(draw, text, fnt, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=fnt) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

for k, text in CAPS.items():
    img = Image.new('RGBA', (W, H), (0,0,0,0))
    d = ImageDraw.Draw(img)
    maxw = W - 360
    lines = wrap(d, text, F, maxw)
    lh = 46
    box_h = lh*len(lines) + 36
    box_w = max(d.textlength(l, font=F) for l in lines) + 64
    bx0 = (W - box_w)//2
    by0 = H - 130 - box_h
    # rounded translucent box
    d.rounded_rectangle([bx0, by0, bx0+box_w, by0+box_h], radius=14, fill=(0,0,0,150))
    y = by0 + 18
    for l in lines:
        lw = d.textlength(l, font=F)
        d.text(((W-lw)//2, y), l, font=F, fill=(245,248,252,255))
        y += lh
    img.save(os.path.join(OUT, k+'.png'))
    print('caption', k, len(lines), 'lines')
print('captions done')
