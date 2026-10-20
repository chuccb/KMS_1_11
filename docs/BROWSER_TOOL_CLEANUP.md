# 顯示／影像快取與診斷工具整理（2026-10-18，ADR-080）

本輪續作：frame／play 已真正遷為 strict TS／Bun，刪除舊 shim／直接封包工具，詳 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)。ADR-109 起 `client_probe.mjs` 已遷為 **`client_probe.ts`**（strict TS、納入 tsc 檢查、輸出與舊版逐行相同）；**僅餘 main.js 尚未完成實作型別遷移**（ADR-109 已抽出背包視窗幾何並補 9 項單元測試）；歷史數字／PID不代表當前 LIVE。

> 現行尺寸／遠近／轉場與游標DPR政策已由ADR-084更新，見 [PIXEL_CAMERA](PIXEL_CAMERA.md)。
> 下文舊fit／native／降採樣、固定backing或CSS游標縮圖的敘述保留歷史時點，不是目前可用選項。

> 本頁保留當輪功能與驗證數字。後續ADR-082的7支browser工具遷移、素材責任、現行安全命令與最新型別範圍，
> 見 [STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)；歷史PASS不沿用為手動場景的新驗收。

> 此頁保留9e10525當輪範圍／數字；後續新增本機步長實驗與十種鏡頭，最新結果見 [MOTION_EXPERIMENTS](MOTION_EXPERIMENTS.md)。

本輪是嚴格 TypeScript／ESNext／Bun 遷移的增量，**不是全案完成**。client 現有 76 支 TS；`main.js` 與 10 支 MJS 工具仍須實際遷移。沒有降低 strict、加入 allowJs／no-check／production any 或為通過測試改物理／傷害／協定。

## 1. 從 main 抽出實際責任，而非更名

- `display-controls.ts`：真實 canvas／context／overlay／select 契約、模式解碼、獨立 localStorage、同源縮放與可清理的 listener。800×600 是原邏輯畫面；pixel/native/fit 是瀏覽器呈現政策。
- 瀏覽器 DPR-only 切換在 Chromium CDP 實際重現：`devicePixelRatio` 與 media-query 的 `.matches` 已改變，卻沒有 resize／change 通知。現在由**既有 app frame**（含 title／selection）呼叫 `refresh()`，只比較三個量測值，改變才 relayout；不新增 RAF 迴圈或計時器。window resize 仍可立即更新。不改遊戲時鐘、座標、速度或 camera。
- `image-cache.ts`：archive FIFO／共享 UI 優先、avatar LRU／實際 blink index 預熱、完成 promise、HTTP／解碼／anchor 邊界與 blob URL 所有權。main 保留 hoisted `artImage`／`avatarFrame` wrapper，避免早期 UI constructor 的初始化順序退化。
- 1024／256 與每次淘汰 1/4 是**瀏覽器記憶體政策，不是 EXE 常數**。修正全部 entry 都是 UI 時舊淘汰分支不會減少 cache 的漏洞；UI 優先不再繞過 hard bound。
- 失敗仍是 cold／可重試，不以替代素材假裝 ready。舊請求失敗只能刪自己的 entry；`src` 同步丟錯也必須 settle promise。decoded Image constructor 丟錯仍在 URL 的 finally 範圍，不洩漏 object URL。
- avatar key／HTTP query 明確包含 look、stance、body frame、flip、emotion、**獨立 face frame**與 packed planes。URLSearchParams 保留查詢值語義；不以 unchecked JSON 或 headers cast 取代驗證。

## 2. 三個舊工具入口已移除

| 現行入口 | 已驗證範圍 | 未驗證／使用限制 |
| --- | --- | --- |
| `browser_display_probe.ts` | 真 Chromium DPR 1/1.25/1.5/2/3、黑白單像素欄等寬／無灰、UI 對齊、模式重載保存、同頁 DPR-only 切換；0 WS | 小視窗降採樣／任意非有理 DPR 本來就不保證像素完美；不是全部遊戲操作驗收 |
| `browser_render_probe.ts` | 預設唯讀 title；8 秒暖機、120 真實畫格、Canvas drawImage Proxy 計數、CPU／interval／draw mean/median/p95 | 明示帳號的 field 分支**沒有執行**；title 數據不能當作地圖效能或走跳平滑度證明 |
| `whisper_probe.ts` | 嚴格型別、純 import、共享 TCP transport 的 fake-peer 實測、真 MakeCharInfo 創角 fixture 契約 | 保留跨系統**歷史情境**，不是當前服務的105項認證；見下節 |

舊對應 `.mjs` 已刪，沒有 JS 兼容殼。其他十支 MJS 尚在，不自動執行。

`browser.ts` 只使用 pinned Playwright／Chromium，不讀外部 PLAYWRIGHT_MODULE。套件的 `--single-process` 在關閉 context 後再開 context 會使 Chromium 崩潰；已排除此旗標，以正常多進程生命週期跑完五個 DPR。仍排除關閉 web security／允許 insecure-content 的旗標，不靠降低 CORS／混合內容安全讓測試通過。

### 手動歷史原生情境：明確保留未完成事項

舊 whisper 工具還涵蓋攻擊／HP／復活／丟棄／商店／交易／Messenger，存在早期的動作、空彈藥射擊轉播、固定 HP、portal／移動假設。它們**沒有按現在的 native admission 全部重新驗收**；舊「105 PASS」不可沿稱本輪結果。現在第一個錯誤／逾時就停止並 finally 關閉全部 sockets，不會失敗後繼續交易或買賣。

本輪已實際查真 `Etc/MakeCharInfo.img/CharMale`，修正舊非 catalogue 的衣褲鞋、總和22的骰子、只有3 bytes的 Alt 名稱；fixture 現為 ProbeHero／ProbeAlt、合法六外觀與 STR/DEX/INT/LUK=5/5/5/10（4個基數4＋9 increments，430630／430690）。普通攻擊 skillId 改回0，不能把 mob pool id 冒充技能。**這些修正仍不證明整段歷史場景可跑完**；後續應按 WZ motion／角色職業／ammo／HP 合約重建情境，不得放寬產品 admission 迎合舊工具。

`probe-session.ts` 集中 framing／cipher handshake、timeout／close/error、最多4096個待處理封包與單一 consumer。4096是診斷工具防失控預算，不是原協定限制。`take`／filtered `drain` 保留未匹配封包的順序，`pendingCount` 不暴露 mutable queue。原重複 scan/unshift 與會丟掉其他子系統封包的等待已收斂到此處。

## 3. 安全入口與使用

唯讀工具必須明示 web port 或 credential-free HTTP(S) origin，導航前只允許同 origin GET 並攔截所有頁面 WebSocket。預設不點按鈕、不登入、不建立角色。

```sh
bun server/scripts/browser_display_probe.ts <明示web-port或http(s)://origin>
bun server/scripts/browser_render_probe.ts <明示web-port或http(s)://origin>
```

改變進度的手動分支還要求 `--allow-state-changes` 一次、顯式 `PROBE_ACCOUNT`／`PROBE_PASSWORD`（原生情境另需 `PROBE_ALT_ACCOUNT`／`PROBE_ALT_PASSWORD`、不同帳號／login/game ports）。沒有隱含 admin／alt 或預設目標。runner 也拒絕既有 LIVE 8515/8516/8517 與對應 e2b proxy。

**旗標與已知 port 黑名單不是任意 target 的隔離證明**；呼叫者仍須建立自己確認的新 disposable fixture，不用玩家存檔。本輪沒有執行登入／歷史 native 情境，也沒有建立、移動或修改 LIVE 角色。

## 4. 驗證與剩餘範圍

- 六個 npm latest 與 exact pins 再次逐一相符：Bun1.4.3、TS7.0.2、types1.4.3、Prettier3.9.10、Playwright1.64.1、Chromium153.0.0。不為升版而換相同版本。
- strict／format／browser build 已過；最終 focused **63/0（8 files，59.96秒）**；包含 source-chain、source/bundle startup、camera 與工具回歸。
- 新增27項案例：13 cache、9 transport/options/import/creation fixture、2 display lifecycle、3真瀏覽器。子行程把 net／Bun connect/listen/serve／fetch／WebSocket／Chromium 解壓與 launch 都改成 fail-closed，8個工具／component import 的嘗試數為0。
- 真頭像測試僅 GET 實際 WZ packed PNG，檢查 anchor／plane、decode、cache identity、URL create/revoke 各1次，並在 revoke 後真的 draw/read 非透明像素。不以假 HTMLImageElement 取代全部瀏覽器證據。
- 初次完整 suite 暴露2個因抽離而過時的 source assertions（cursor layout、face-frame query）。已改為追完整 `main → controller/cache → cursor/query` 關聯鏈，保留其餘原斷言；不是移除案例或加 skip。最終全套數字見 [BUN_MIGRATION](BUN_MIGRATION.md)。
- 本機日誌在 ignored `generated/cleanup-round4/`；原 EXE／C／listing／WZ／analysis／歷史 ADR 均保留。

仍須完成 main 的大型整合責任、其餘工具與歷史 whisper 情境（44 項既有失敗已於 ADR-108 全數結案）。strict 成功只涵蓋已納入的 TS，不能代表 `client/main.js` 也已型別化或全遊戲驗收完成。
