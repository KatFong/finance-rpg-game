# 理財勇者（Finance RPG）

手機優先嘅個人理財 RPG。用真實記帳行為驅動遊戲：記支出＝儲 XP／爆寶箱，每日預算＝角色 HP，每週儲蓄目標＝慾望魔王血量。日常財務資料存喺 localStorage，唔使註冊。

開場係可重播嘅全屏 RPG 序章：Title Screen → loading 轉場 → 軍師逐句對話與情境換圖 → 單題回答面板 → 男／女勇者與命名 → 第一個真實記帳行動。文字完成前下一步按鈕會鎖定，每組資料只會喺相應對話後由底部彈出；舊存檔可以喺手帳重播序章或隨時切換角色。

## 執行

```bash
python3 -m http.server 3900 --directory /Users/kat/finance-rpg-game
# 開 http://localhost:3900（手機 viewport）
```

## 低壓核心循環

| 玩家時刻 | 設計回應 |
|---|---|
| 打開 App | 單屏營地先答「今日仲有幾多日常安心額」，首頁唔需要捲動 |
| 想快速處理 | 點按「記眼前一筆」開表格；長按直接開語音記帳 |
| 記唔清楚 | 由底部「軍師」入口用一句廣東話或語音講，軍師逐項追問 |
| 資料複雜 | 先整理成卷軸，玩家確認後先正式入帳 |
| 固定／大額支出 | 屋租、供款或已由存款預留嘅一次性支出獨立顯示，唔會一筆扣爆今日安心額 |
| 今日超出步速 | 顯示現況但唔扣分、唔要求補償，下一筆重新選擇 |
| 中斷幾日 | 歡迎返嚟，由眼前一筆重新開始，過去進度唔會消失 |
| 準備收隊 | 盤點日常、固定、收入同還款；唔需要湊夠指定交易數量 |
| 完成小行動 | XP、金幣、寶箱同週目標提供即時但非懲罰式回饋 |
| 想看全貌 | 手帳分成總覽、信用卡、紀錄，避免一頁塞晒所有資料 |

首頁只保留角色、安心額、本週魔王縮圖、一個軍師頭像入口，以及記帳／零日常／戰況三個快捷按鈕。每日提醒或記帳追問會暗下營地，再由 NPC 軍師彈出逐句對話；關閉後不佔主畫面。任務獎勵、每週洞察、應急護甲同完整建議分流到任務及手帳，避免主畫面變成報表。

理財戰況對應個人財務健康：日常掌控、應急護甲、目標進度同自主空間；詳細資料集中喺手帳。設計參考 [CFPB Financial Well-Being](https://www.consumerfinance.gov/consumer-tools/educator-tools/financial-well-being-resources/)、[Apple Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) 同 [Apple Designing for Games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/)；原則係先用真實行動教識玩家、容許犯錯，並將下一步講清楚。

## 財務問卷 + 資產負債遊戲化

開檔問卷（可隨時喺 手帳 →「更新財務檔案」重新填）：
- 收入型態（固定月薪／浮動收入）＋每月收入
- 存款 → **護甲**（布衣 <1 個月 → 皮甲 → 鐵甲 → 龍鱗甲 6 個月+）
- 債務 → **惡龍**（每筆債一條，HP＝餘額）
- 「軍師建議」規則引擎：有債推**雪球還債法**（最細先斬，清一條滾落下一條）；
  冇債但應急庫未夠 3 個月推應急庫任務；浮動收入有專屬攻略。附一般教育資訊免責聲明。
- 還債＝斬龍：+20 金 +30 XP；清一條 +300 金 +500 XP

## Apple Shortcuts 快速入帳

支援 URL 快速入帳：`http://<host>:3900/?add=<分類>:<銀碼>`（例 `?add=food:45`）。
分類：food／transport／shopping／fun／bills／other。
App 內 手帳 →「Apple Shortcuts 快速入帳」有逐步教學（要求輸入 → 選單 → 開啟 URL）。
iPhone 用法：同 Mac 同一 Wi-Fi 用 Mac IP，或者 host 上 GitHub Pages（資料照存手機 localStorage）。

## 信用卡迷宮 + 分期任務

- 每張卡可以記錄尾數、信用額、現時結欠、截數日、還款日同 APR。
- 「新增信用卡」會開標準表格；每張卡亦可以直接編輯同用兩欄表格記還款。對話輸入係額外選項，唔係唯一入口。
- 信用卡頁先顯示最近要處理嘅日期、金額同距離日數；資料未齊時會直接指出缺口。
- 分期支援本金、總期數、已供期數、APR、每期手續費、已知每期金額同第一期日期。
- 供款表由 `advisor.js` 本機確定性計算；AI 只整理草稿，唔負責計息或直接寫資料。
- 每期供款會獨立列為本月固定承諾；繳付後推進任務線，還卡數只減結欠，唔會重複當成新消費。

## 日常安心額規則

- **日常消費**：餐飲、交通、一般購物等，會扣減今日安心額。
- **固定／預留**：屋租、管理費、保費、學費、稅款、分期供款，或明確由存款／另一筆預算支付嘅一次性支出；會計入總支出，但唔扣今日安心額。
- **還款轉移**：還信用卡只係清還已記錄卡數，唔會再次當成支出。
- 金額大唔代表自動排除。快速記帳可以揀預算分類，軍師會按語意整理；舊紀錄亦可以喺手帳改分類。
- 開檔設定嘅「每月日常可用預算」應該係扣除屋租、供款等固定承諾後，真正可安排日常生活嘅金額。

## 對話／語音軍師

底部中央「軍師」係唯一常駐對話入口，支援廣東話文字同瀏覽器語音輸入。可以記支出、收入、信用卡、還款與分期，亦可以問一般理財／投資教育問題。資料未齊時會逐項追問；整理完成後必須由用戶按「確認記錄」先寫入 localStorage。

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
