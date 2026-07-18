#!/usr/bin/env bash
# 一次過生成《理財勇者》全部美術（經 codex CLI / ChatGPT 訂閱）
# sprite 用純 magenta 背景生成 → chromakey 去背 → 縮到 512px
# 已存在嘅檔案會跳過，可以安全重跑
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets tmp-art

STYLE="Cute 16-bit pixel art style, vibrant colors, clean bold dark outline around the subject, JRPG game asset, no text, no letters, no watermark. The entire background must be one single flat solid uniform bright magenta color (#FF00FF) with absolutely no gradient, no checkerboard pattern, no shadow on the background."

gen_sprite() { # name prompt
  local name="$1" prompt="$2"
  if [[ -f "assets/${name}.png" ]]; then echo "skip ${name}"; return 0; fi
  echo ">>> generating ${name} ..."
  if tools/gpt-image-2 "$prompt" "tmp-art/${name}.png" --size 1024x1024 \
     && node tools/chromakey.mjs "tmp-art/${name}.png" "assets/${name}.png" \
     && sips -Z 512 "assets/${name}.png" >/dev/null; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}"
  fi
}

gen_sprite hero "$STYLE Subject: a brave young adventurer hero character sprite, full body front view, holding a small golden coin pouch and a wooden sword, friendly determined face, green tunic, single character centered."
gen_sprite boss "$STYLE Subject: a comical greedy shopping demon boss monster sprite, deep purple round body, mischievous grin, holding shopping bags and credit cards, slightly menacing but cute, full body, single monster centered."
gen_sprite chest-closed "$STYLE Subject: a closed wooden treasure chest with gold metal trim, slight magical glow on the chest itself, front view, centered."
gen_sprite chest-open "$STYLE Subject: an open wooden treasure chest overflowing with gold coins and gems, golden light rays bursting upward from inside the chest, front view, centered."
gen_sprite coin "$STYLE Subject: a single shiny gold coin with a star emblem embossed on it, front view, centered."
gen_sprite shield "$STYLE Subject: a sturdy medieval knight shield, blue with gold border and a cute pink piggy bank emblem in the center, front view, centered."
gen_sprite flame "$STYLE Subject: a lively orange and yellow flame spirit with tiny happy eyes, streak fire symbol, centered."

# 背景圖唔使去背
if [[ ! -f assets/bg.png ]]; then
  echo ">>> generating bg ..."
  if tools/gpt-image-2 "Peaceful fantasy JRPG landscape in portrait orientation, 16-bit pixel art style: rolling green hills, winding path leading to a distant golden castle, dark night-purple sky with stars, dreamy muted dark colors suitable as a dark mobile app background, no text, no watermark." \
       "assets/bg.png" --size 1024x1536 \
     && sips -Z 1536 assets/bg.png >/dev/null; then
    echo "OK bg"
  else
    echo "FAIL bg"
  fi
else
  echo "skip bg"
fi

rm -rf tmp-art
echo "ALL DONE"
ls -la assets/
