#!/usr/bin/env bash
# UI 拆件生成：先生成整體 UI mockup 定風格，再以 mockup 做參考逐件生 UI 素材
# 已存在嘅檔案會跳過，可以安全重跑
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets tmp-art

# 第一步：整體 UI mockup（風格基準，亦係設計參考圖）
if [[ ! -f assets/ui-mockup.png ]]; then
  echo ">>> generating ui-mockup ..."
  tools/gpt-image-2 "Mobile game UI mockup for a personal finance JRPG app, portrait phone screen, 16-bit pixel art style. Dark purple night theme (#171029 background), ornate gold-trimmed panels, a top status bar with level badge and coin counter, a boss card with a purple demon and an HP bar, a hero character in the middle with a green HP bar, big golden rounded action button, bottom navigation bar with 5 icons. Rich gold and purple palette, cohesive fantasy RPG interface, no real text (use abstract glyph shapes instead of letters), no watermark." \
    "assets/ui-mockup.png" --size 1024x1536 \
    && sips -Z 1536 assets/ui-mockup.png >/dev/null && echo "OK ui-mockup" || echo "FAIL ui-mockup"
else
  echo "skip ui-mockup"
fi

REF="assets/ui-mockup.png"

gen_ui() { # name prompt
  local name="$1" prompt="$2"
  if [[ -f "assets/${name}.png" ]]; then echo "skip ${name}"; return 0; fi
  echo ">>> generating ${name} ..."
  if tools/gpt-image-2 "$prompt" "tmp-art/${name}.png" --size 1024x1024 --ref "$REF" \
     && node tools/chromakey.mjs "tmp-art/${name}.png" "assets/${name}.png" \
     && sips -Z 512 "assets/${name}.png" >/dev/null; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}"
  fi
}

gen_ui ui-panel "A single square ornate fantasy RPG UI panel frame border, 16-bit pixel art: dark purple panel edge with gold metal trim and small decorative corner ornaments, perfectly symmetric, straight edges, nine-slice ready. The centre of the frame is EMPTY and filled with flat solid bright magenta (#FF00FF), and everything outside the frame is also flat solid bright magenta (#FF00FF). No text, no watermark."

gen_ui ui-btn "A single wide rectangular golden fantasy RPG button, 16-bit pixel art: glossy gold surface with darker gold ornate border and subtle bevel, rounded corners, nine-slice ready, no icon, no text. Everything outside the button is flat solid bright magenta (#FF00FF). No watermark."

rm -rf tmp-art
echo "UI DONE"
ls -la assets/
