# 現行架構：瀏覽器客戶端＋原協定伺服器

更新：2026-10-23（ADR-158：selected inbound payload guards；Bun formatter migration）。這是實際程式的導覽，不再描述未建立的引擎專案或根 `core/`／`protocol/`。
方向由 ADR-065 確認；版本與升級風險見 [TOOLCHAIN](TOOLCHAIN.md)，證據規則見 [REBUILD_PRINCIPLES](REBUILD_PRINCIPLES.md)。

現行角色互動續作見[NATIVE_PLAYER_INTERACTIONS](NATIVE_PLAYER_INTERACTIONS.md)：原右鍵選單／人氣／派對事件、
輸入捕獲與modal身份；`tools/attach-web.ts` 可另開web橋接連既有本機TCP世界，不複製／重啟世界或操作save。
獨立橋接拿不到原process內的testTools／私人mobPresentation callbacks；未證實邀請身份的舊原生端亦停用invite／accept，與同程序serve有明示差異。

## 執行資料流

```text
桌面瀏覽器 client/
  Canvas 2D + DOM 輸入／命中層 + Web Audio + 純規則模組
       │ 同 origin：HTTP 靜態檔／資源 API、/ws JSON 事件
       ▼
server/src/net/webclient.ts + websocket.ts
       │ 每條 WebSocket 一個 Bun ClientSession
       ▼
server/src/client/session.ts
       │ 原版握手／cipher／CP949／二進位封包，透過 TCP
       ▼
server/src/net/loginserver.ts + game entry
       │
       ├── server/src/game/：場地、角色、道具、交易與記帳
       ├── server/src/protocol/：封包 codecs 與 schema.ts 封包索引
       ├── server/src/game/save.ts：帳號／角色 JSON 保存
       └── server/src/wz/ + game 資源 providers：唯讀 Data.wz → metadata／PNG／音訊
```

原版 TCP 客戶端與瀏覽器橋共用服務與協定能力；瀏覽器不自行實作第二份 cipher，也不直接載入 WZ。
橋上的 JSON event／API 是重建介面，**不是原封包格式的證據**。
web／login／game 是不同 port；伺服器內部可用 loopback，瀏覽器只使用對外 web origin。

## 實際責任與依賴

| 位置 | 責任與界線 |
|---|---|
| `client/main.js` | 啟動、場景整合、輸入與網路狀態；仍過大且未嚴格型別化，逐領域分層尚未完成 |
| `client/websocket-transport.ts` | 嚴格型別化的 browser WebSocket 建立／替換／送出／關閉、generation fence、JSON envelope 與 open guard；選定 payload guard 可拒收 malformed message，coverage/gaps 另列 |
| `client/server-message-validation.ts` | server-to-browser 選定 event runtime guards；trade／messenger nested unions 是明確 gaps；未識別的 runtime `t` pass-through（已知 `t: "unknown"` 有 guard），不是完整 schema |
| `client/*.ts` | 115個實作型別化的動畫／物理／呈現／UI／音訊與共用規則；無重複 declaration |
| `client/social-commands.ts`／`party-state.ts`／`party-invitation.ts`／`chat-entry.ts` | 原社交指令嚴格解析（`/파티*`／`/귓속말`／`/찾기`＋明示別名）、`55C5E0` 六格名冊狀態、邀請確認所有權與編輯框生命週期；`server/src/net/chat-input.ts` 與 bridge 共用同一路由，斜線行不會落到公開聊天 |
| `client/login-data.ts`／`login-presentation.ts`／`login-screen.ts` | 登入清單unknown守衛、選擇／pending純狀態、原WZ畫布與DOM／焦點／listener lifecycle；transport與creation／avatar透過具體介面注入 |
| `client/feedback-data.ts`／`feedback.ts`／`feedback-renderer.ts`／`item-metadata.ts` | strict收件投影、六列整數alpha／EXP與Notice FIFO、原UI繪製、共用metadata有界cache／重試／取消；不改遊戲獎勵或instance |
| `client/drop-presentation.ts`／`drop-renderer.ts` | unknown drop/remove守衛、signed `animationStartOffset`、kind 0 本機清理／kind 1 持續／kind 2 即放、連續動畫、原PNG底部貼地與固定金幣幀；不代替server選fh |
| `server/src/game/drop-landing.ts` | 所有掉落的有向真地板／下射線／虛空邊緣權威選點，原0x43格式不變 |
| `client/entity-assets.ts`／`entity-resource-validation.ts`／`avatar-look.ts` | NPC/mob metadata驗證、field ownership／取消、native action量化與local/remote look規則 |
| `client/motion-tuning.ts`／`motion-controls.ts` | 明示非原版本機5–60ms步長／插值選項與純偏好UI，不改server時鐘 |
| `client/scene-surface.ts`／`camera-lens.ts`／`lens-controls.ts` | 整數世界像素／原UI兩段合成、四視野、時間轉場、偏好／減少動態；不改物理／協定 |
| `client/display-controls.ts`／`image-cache.ts` | 視窗／DPR／canvas-overlay-cursor同步與bounded archive/avatar影像生命週期 |
| `server/src/net/client-event-json.ts`／`webclient-messages.ts` | `ClientEvent.kind` → JSON `t` projection 與完整 server-to-browser 出站 discriminated union；`WebClient.send` 編譯期受型別約束，不代表runtime深schema驗證 |
| `server/src/client/` | 瀏覽器 session 對原協定的轉換；不直接代替服務端權威落帳 |
| `server/src/net/` | TCP、WebSocket、HTTP、登入／遊戲連線與 capture |
| `server/src/protocol/` | bytes、cipher、字串、各系統 codec；`schema.ts` 索引已知／partial／skeleton |
| `server/src/game/` | 場地、保存、數值與物品權威；另含 WZ 資源呈現資料與重建政策 |
| `server/src/wz/` | WZ 產品 reader、值層／像素／PNG；執行時直接讀 archive |
| `server/scripts/browser-fixture.ts`／`browser-observation.ts` | 明示手動fixture admission、有界純觀測；匯入無連線／登入；7支browser runner與frame／play為strict TS；後者共用probe-field／probe-frame／probe-play |
| `tools/` | Bun TS靜態分析、工具鏈安裝、browser build、保護既有save與明示新fixture啟動 |
| `analysis/` | 既有研究輸出，不能把過時 manifest 描述當現在的解析結果 |
| `generated/` | 可重建工具／素材與不可隨意重建的玩家 save／備份並存；均忽略但重要性不同 |

**共用邏輯現況**：server 會 import `client/jobs.ts`、`characterstats.ts`、`mobmotion.ts`、
`client/social-commands.ts`、`client/party-state.ts`（`PARTY_MAX_MEMBERS` 由 `protocol/party.ts` 再匯出）等純模組，
所以不能再寫「server 絕不 import client」。這些模組不得在載入時碰 DOM／Canvas／Audio；
未來可獨立成共用目錄，但目前沒有建立 `shared/`，本輪也不搬路徑，以免破壞既有匯入與資源 URL。
不能把此債務或未來方向描述成已完成的架構。

## 普通身體動作與幾何分界

`game/avatarmotion.ts`讀body幀表與武器walk/stand → ArtProvider／HTTP metadata →
`client/avatar-motion.ts`普通倒數 → `main.js`場地／typed login-presentation／creation →既有avatar PNG compositor。
`motion.ts`保留幾何並re-export普通clock；不讓新身體時序改movement byte、傷害或attack forced override。
actor持有clock與已完成的immutable weapon profile；64座metadata cache去重／退避，滿pending不逐RAF相互驅逐。
只讀開發閱覽用獨立actor及look副本，不與selfView／inventory／save混用；見[NATIVE_AVATAR_MOTION](NATIVE_AVATAR_MOTION.md)。

## 呈現與資源

- UI／DOM保持800×600邏輯座標；世界有獨立FOV，以整數實體倍率兩段合成。五種清晰尺寸，小視窗捲動不降採樣；見[PIXEL_CAMERA](PIXEL_CAMERA.md)。
- `requestAnimationFrame` 驅動呈現；重建物理、時鐘、插值與動畫不等於完整原 CVecCtrl／CShape2D。
- Web Audio 解碼／播放原資料所對應的音訊；不重寫 DirectSound／ACM 相容層。
- `game/wzart.ts` 做 path／UOL／canvas reader 與快取；mapart／avatar／sprites 等供應渲染資料。
- PNG、metadata、音訊由既有 `/api/...` 輸出，瀏覽器資源快取與取消／identity guard 管理生命週期。
- 最終canvas以整數layout box＋inverse DPR transform呈現，避免1/64 CSS px寬高量化；stage clip隔離未縮小的layout overflow。42組完整原素材screenshot像素比較通過（ADR-085）。
- `display-controls.refresh` 接既有app frame，不新增loop／timer，處理不發resize/change的DPR-only切換；只在實體倍率變化時重配800u×600u輸出backing。
- archive1024 FIFO/UI優先（仍hard bound）、avatar256 LRU/實際blink預熱是browser policy，不是原EXE常數。
- `assets/` 離線輸出仍可供分析，但不是 runtime 必經的「先全量轉檔」階段。
- 原字型未隨專案重建；Gulim／本地合法 fallback 的 metrics 與 GDI 不保證像素相同。

## 權威、保存與安全界線

server 控制角色／物品／金錢／共享場地的落帳；原 client 回報傷害或路徑與現行接受政策須分開記錄。
「server 有權威狀態」不代表反作弊、所有回報驗證、分散式交易或原 server 規則已完成。

JSON save 先寫暫存檔再改名；這不是資料庫交易、全機斷電保證或跨程序協調方案。
目前並非正式多節點 MMO 架構。帳號安全、TLS、備份恢復、營運監控與容量仍需另行評估。

存檔用明確 `--save` 路徑；找不到舊檔不可自動 seed 來冒充恢復。
停服後冷備當下最新檔，再以同一路徑啟動。ignored／沙箱暫存不等於永久備份。
根目錄原 EXE／DLL／C／LST／Data.wz 是唯讀證據，保留位置，不作 runtime 相容層。

## 工具鏈與驗證狀態

根 `.bun-version`／`package.json`／`bun.lock`／`tsconfig.json` 是唯一工具鏈；Bun1.4.4／TS7.0.2，
ESNext／strict／unused／erasableSyntaxOnly／skipLibCheck=false；formatter 為 Bun 內建 `bun fmt`，已與 Prettier 3.9.10 在438個輸入 byte-compare 相同。CI的checkout/setup-bun固定SHA，不另裝Node/Python。
`node:`標準庫由Bun相容實作，不是另一個runtime；產物JS不等於authored JS已遷移。

client_probe 已於 ADR-109 遷為 strict TS（`server/scripts/client_probe.ts`，納入 tsc 檢查），ADR-108 復活的真 typed 呼叫鏈全鏈仍通過；frame／play 已刪舊 MJS 並遷為真正 strict TS，見 [工具續作](STRICT_FRAME_PLAY_TOOLS.md)；已 typed whisper 還有未按當前 admission 重建的歷史情境。**唯一尚未型別化的 authored 來源是 main.js**（5549 行；ADR-109 普查顯示無可機械切開的純區塊，採門面分層逐領域搬移；已抽出 `client/inventory-window.ts`、`client/shop-window.ts`、`client/hud.ts`／`client/jobs.ts`，ADR-156 再抽出 `client/websocket-transport.ts`）。
前輪增量（ADR-156）：strict `websocket-transport.ts` 收攏 browser socket lifecycle／open gates，頂層 JSON envelope 守衛拒收 malformed message，但不宣稱 event payload 深 schema；typecheck／format／build 與完整 suite **1468/0、5334 expects、170 files** 通過。`client/main.js` 仍未 strict 型別化，工程 gates 通過不代表全遊戲手動驗收。
前輪（ADR-157）新增 strict 出站 JSON message union，讓 `WebClient.send` 與 `clientEventJson` 的 discriminator／payload 關聯受 compiler 驗證；當時尚未做 inbound runtime validation，亦未型別化 main.js。Bun／@types 升至 registry latest 1.4.4；該輪 focused44/0、完整1468/0（5334 expects、170 files）。
本輪（ADR-158）transport 掛上選定 payload guards；`trade`／`messenger` nested unions 明列為 gaps，未識別的 runtime `t` pass-through（已知 `t: "unknown"` 有 guard），`main.js` 仍不是 strict TS。Bun `fmt` 與鎖檔 Prettier 3.9.10 對438個 format input逐檔byte-identical後，正式移除 Prettier依賴。實測／完整suite結果見 [ADR-158](DECISIONS.md)。
ADR-108／109 的 1213 pass／0 fail、inventory-window 9/9 與 probe 輸出等價結果是各自歷史時點；較早的 1205/8、1064/44 亦不代表現況，詳 [BUN_MIGRATION](BUN_MIGRATION.md)。
前輪login UI另有真HTML／WZ component、21組原renderer完整邏輯畫布RGBA相等與30純imports／0 I/O；LIVE同PID4942、87modules與唯讀標題120幀，0WS，不登入或操作玩家。既有七DPR×五尺寸／游標與world/UI／zoom screenshot回歸保留。
舊 PID／ignored preview-save 名稱只代表歷史狀態，不是可恢復的玩家進度。本輪發現先前 8515 服務已停止後，另開全新 memory-only 隔離服務：web/login/game ports 8515/8516/8517、`--save off`、安全城鎮 map `101000000`（啟動時 0 mobs）、只有新的 `preview`／`observer` 帳號；沒有舊角色／save 被載入。`/healthz`、首頁與 `/main.js` 只讀檢查皆回應 200；沒有登入、建立／操作角色或寫存檔。使用者若自行建立角色，進度只在此程序記憶體中，重啟即消失；預覽是否在線以本輪 LIVE 入口為準，不以舊 PID／save 路徑推定。
掉落的全100張原WZ地圖／379422組驗證及呈現政策見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。
標題／登入／世界與選角責任、原證及驗證見 [STRICT_LOGIN_UI](STRICT_LOGIN_UI.md)。
鏡頭／合成／清晰尺寸見 [PIXEL_CAMERA](PIXEL_CAMERA.md)。詳 [BUN_MIGRATION](BUN_MIGRATION.md)／[BROWSER_TOOL_CLEANUP](BROWSER_TOOL_CLEANUP.md)／[MOTION_EXPERIMENTS](MOTION_EXPERIMENTS.md)／[STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)。
