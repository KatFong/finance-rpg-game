# 理財勇者（Finance RPG）

手機優先嘅個人理財 RPG。用真實記帳行為驅動遊戲：記支出＝儲 XP／爆寶箱，每日預算＝角色 HP，每週儲蓄目標＝慾望魔王血量。日常財務資料存喺 localStorage，唔使註冊。

開場係全屏營地故事流程，可以選男／女勇者；舊存檔亦可以喺「更新財務檔案」隨時切換角色。

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

## 信用卡迷宮 + 分期任務

- 每張卡可以記錄尾數、信用額、現時結欠、截數日、還款日同 APR。
- 分期支援本金、總期數、已供期數、APR、每期手續費、已知每期金額同第一期日期。
- 供款表由 `advisor.js` 本機確定性計算；AI 只整理草稿，唔負責計息或直接寫資料。
- 每期供款會預留喺本月安心額度；繳付後推進任務線，還卡數只減結欠，唔會重複當成新消費。

## 對話／語音軍師

底部「軍師對話」支援廣東話文字同瀏覽器語音輸入。資料未齊時會逐項追問；整理完成後必須由用戶按「確認記錄」先寫入 localStorage。

GitHub Pages 預設使用本機規則軍師。要接 OpenAI，只需部署同一個 `POST /api/advisor` endpoint（已提供 Vercel function）：

```bash
vercel env add OPENAI_API_KEY
vercel env add ALLOWED_ORIGIN      # https://katfong.github.io
vercel --prod
```

再將 `index.html` 嘅設定指向部署網址：

```js
window.FRPG_CONFIG = { advisorApiUrl: 'https://<your-project>.vercel.app/api/advisor' };
```

可選 `OPENAI_MODEL`，預設 `gpt-5.4-mini`。API key 只可以放後端環境變數，唔好寫入 HTML、JavaScript 或 Git；endpoint 只傳最近對話與精簡卡片資料，並設定 `store: false`。

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

- `index.html` / `style.css` / `app.js` — 遊戲 UI 同核心狀態
- `advisor.js` — 對話軍師、本機 fallback、分期計算同信用卡迷宮
- `api/advisor.js` — 單一 OpenAI Responses API 後端 endpoint
- `assets/` — 生成嘅美術（hero, boss, chest-closed, chest-open, coin, shield, flame, bg）
- `tools/gpt-image-2` — codex bridge wrapper（來自 oakplank/claude-gpt-image-bridge，已審閱）
- `tools/chromakey.mjs` — magenta 去背（pngjs）
- `tools/gen-all.sh` — 批次生圖 pipeline

另外 `/Users/kat/openai-image-mcp/` 有一個備用嘅 OpenAI 圖像 MCP server（用 API key 嗰條路），今次冇用到。
