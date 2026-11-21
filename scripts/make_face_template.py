#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 v74 自定义牌面雪碧图模板 public/face-template.png。
用法：python3 scripts/make_face_template.py [输出路径]
把每格替换成你自己的牌面图后，在「我的 → 自定义牌面」上传即可。
规格：2340 × 1260 px，13 列 × 5 行，每格 180 × 252 px（比例 5:7）。
"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 180, 252
COLS, ROWS = 13, 5
RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K']
SUITS = ['S','H','C','D']        # 黑桃 红桃 梅花 方块
OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/face-template.png'

img = Image.new('RGB', (COLS*W, ROWS*H), (248, 248, 246))
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 34)
except Exception:
    font = ImageFont.load_default()

for r in range(ROWS):
    for c in range(COLS):
        x, y = c*W, r*H
        d.rectangle([x+2, y+2, x+W-3, y+H-3], outline=(190,190,190), width=2)
        d.line([x+2, y+2, x+W-3, y+H-3], fill=(225,225,225), width=1)
        if r < 4:
            label = SUITS[r] + '-' + RANKS[c]
        elif c == 0:
            label = 'JOKER-S'
        elif c == 1:
            label = 'JOKER-B'
        elif c == 2:
            label = 'BACK'
        else:
            label = 'unused'
        d.text((x+10, y+8), label, fill=(40,40,40), font=font)
        d.text((x+10, y+H-46), '%d,%d' % (c, r), fill=(150,150,150), font=font)

img.save(OUT)
print('wrote', OUT, img.size)
