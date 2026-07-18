# 理財勇者（Finance RPG）

手機優先嘅個人理財 RPG。用真實記帳行為驅動遊戲：記支出＝儲 XP／爆寶箱，每日預算＝角色 HP，每週儲蓄目標＝慾望魔王血量。純前端，資料存喺 localStorage，唔使註冊。

## 執行

```bash
python3 -m http.server 3900 --directory /Users/kat/finance-rpg-game
# 開 http://localhost:3900（手機 viewport）
```

## 上癮迴路設計（人性邏輯）

| 機制 | 心理原理 |
|---|---|
| 3 下點擊完成記帳 | 極低行動門檻（Fogg B=MAT） |
| 記帳隨機爆寶箱、金幣隨機 | 變動獎勵（老虎機效應） |
| 每日預算＝HP、超支扣血 | 損失規避 |
| 連勝 streak + 護盾道具 | 唔捨得斷、sunk cost |
| 每週魔王、每日傷害上限（血量 1/5） | 迫每週最少返嚟 5 日 |
| 唔記帳嗰日唔計魔王傷害 | 防止「唔記＝儲晒」嘅漏洞 |
| 金幣買裝備（劍/咒文/護盾/披風） | 投入感、長期目標 |

## 財務問卷 + 資產負債遊戲化

開檔問卷（可隨時喺 統計 →「更新財務檔案」重新填）：
- 收入型態（固定月薪／浮動收入）＋每月收入
- 存款 → **護甲**（布衣 <1 個月 → 皮甲 → 鐵甲 → 龍鱗甲 6 個月+）
- 債務 → **惡龍**（每筆債一條，HP＝餘額）
- 「軍師建議」規則引擎：有債推**雪球還債法**（最細先斬，清一條滾落下一條）；
  冇債但應急庫未夠 3 個月推應急庫任務；浮動收入有專屬攻略。附一般教育資訊免責聲明。
- 還債＝斬龍：+20 金 +30 XP；清一條 +300 金 +500 XP

## Apple Shortcuts 快速入帳

支援 URL 快速入帳：`http://<host>:3900/?add=<分類>:<銀碼>`（例 `?add=food:45`）。
分類：food／transport／shopping／fun／bills／other。
App 內 統計 →「Apple Shortcuts 快速入帳」有逐步教學（要求輸入 → 選單 → 開啟 URL）。
iPhone 用法：同 Mac 同一 Wi-Fi 用 Mac IP，或者 host 上 GitHub Pages（資料照存手機 localStorage）。

## 美術生成（codex bridge，唔使 OpenAI API key）

圖用 gpt-image-2 經 **codex CLI（ChatGPT 訂閱身份）** 生成：

```bash
tools/gen-all.sh          # 生成全部缺少嘅圖（可以安全重跑，已有嘅會跳過）
tools/gpt-image-2 "prompt" out.png --size 1024x1024   # 單張
```

UI 拆件流程（`tools/gen-ui.sh`）：
1. 先生成整體 `ui-mockup.png` 定風格
2. 再以 mockup 做 `--ref` 參考圖逐件生（`ui-panel.png` 面板框、`ui-btn.png` 金掣）
3. `tools/trim.mjs` 裁走透明邊 → CSS `border-image` nine-slice 上身（`body.has-ui`）

要點：
- 需要 `codex` CLI 已 `codex login`（ChatGPT 帳號）
- gpt-image-2 經 ChatGPT 通道**唔會出真透明**，會將「透明格仔」畫入圖 —
  所以 prompt 指定純 magenta 背景，再用 `tools/chromakey.mjs` 去背
- 每張圖大約 2–4 分鐘（codex 會先 reasoning 再生圖）
- 換圖：刪走 `assets/*.png` 再行 `tools/gen-all.sh` / `tools/gen-ui.sh`；PNG 未有時 app 會自動 fallback 去 SVG 佔位圖

## 檔案

- `index.html` / `style.css` / `app.js` — 成個 game
- `assets/` — 生成嘅美術（hero, boss, chest-closed, chest-open, coin, shield, flame, bg）
- `tools/gpt-image-2` — codex bridge wrapper（來自 oakplank/claude-gpt-image-bridge，已審閱）
- `tools/chromakey.mjs` — magenta 去背（pngjs）
- `tools/gen-all.sh` — 批次生圖 pipeline

另外 `/Users/kat/openai-image-mcp/` 有一個備用嘅 OpenAI 圖像 MCP server（用 API key 嗰條路），今次冇用到。
