# Bun 全專案遷移：進行中，未完成交付

更新：2026-10-24（ADR-161：strict map-command／catalog validation；latest toolchain pins 維持不變）。原目標仍是全專案只用嚴格 TypeScript / ESNext / Bun；不得把目前階段當作全案完成。

## 最新增量：map command 與地圖目錄的 strict TypeScript boundary（ADR-161）

新增 `client/map-constants.ts`（WZ no-destination sentinel／`0x0D` s32 上限）與 `client/map-commands.ts`（alias／整數邊界 parser、`/where`／`/maps` route 及 validated catalog search）；server `game/map.ts` 保留原 `RETURN_MAP_NONE` export。`client/main.js` 委派新模組後少 20 行，field／permission gate 和有效命令輸出不變；`/api/maps` 的 unknown payload 在顯示前必須通過 map destination guard，ID 0 保持有效。

新增四項純 map-command regression；真 Data.wz `/api/maps`、map/provider、portal 與 server map-policy fixtures 共 **24/0、4 files**。TypeScript 7.0.2 strict typecheck、`bun check`（738 checked／739 loaded）、format check、Bun browser build 通過；Prettier 3.9.10 comparison 為 **446/446 byte-identical**。完整 `bun run test` **1482/0、5334 expects、172 files（345.82 s）**。最新 registry／GitHub 核對日期 2026-10-24，原有 Bun／TS／Chromium／Actions pins 仍是 latest，未為升級而改依賴。

唯一未 strict 型別化來源仍是 `client/main.js`（5529 行）；`client/` 有 **122 支 `.ts`**。全程未登入 LIVE、操作角色、讀寫既有 save 或執行 state-changing probe；既有 memory-only preview 仍使用 `--save off`。

## 前輪增量：trade JSON projection 與 full MiniRoom guard（ADR-160）

`client/trade-wire.ts` 把 `MiniRoomEvent` 投影為獨立 JSON DTO；cash block 的 `sn`／`unknown1A` u64 使用 `BigInt.toString(10)` 成 canonical 十進位字串，`unknown18` 保持數字，null／其他事件原樣保留。原始 protocol／save model 不改，沒有經過 JS number 或 generic coercion。出站 `ClientEventJson`／`WebClientServerMessage` 與 browser `TradeState` 共用 DTO；session 對 native event 使用明示的 protocol 接口。

`client/trade-message-validation.ts` 深度驗證所有十種 MiniRoom variant，包括 participant／enter indices、八個 offer slots、equip/non-equip 欄位、u8／u16／u32 與 canonical u64 範圍；`trade` 加入 `SERVER_MESSAGE_VALIDATED_TYPES`，`SERVER_MESSAGE_VALIDATION_GAPS` 現為空。合成 peer regression 從 `0x50 type 11` 穿過 decoder、session、projection，直接 `JSON.stringify`／`JSON.parse` round-trip 後仍保有相同十進位 u64 字串；validation fixtures 覆蓋每一 variant 與畸形邊界。

現有 57 個 discriminator 全數有明列 guard，但未識別／未分類 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard）；這不是完整 schema，`client/main.js` 仍未 strict 型別化。focused／完整驗證見 [ADR-160](DECISIONS.md)。

## 前輪增量：Messenger event guard 與 trade serialization trace（ADR-159）

`client/messenger-message-validation.ts` 現在接上 `client/server-message-validation.ts`，完整驗證八種 Messenger event variant、巢狀 participant／look 欄位，以及固定恰好三格的 `clear`／`keep`／`fill` roster；`MESSENGER_ROOM_SIZE` 由 `client/messenger-constants.ts` 單一提供，client state、protocol、server 與 validator 共用。測試逐 variant 覆蓋 accept/reject，以及畸形槽位、look、欄位型別／範圍、roster 長度和 cell。

ADR-159 時 Messenger 已不再是 gap：當時 56 種 server-to-browser discriminator 有 guard，`trade` 是唯一明列的 `SERVER_MESSAGE_VALIDATION_GAPS`。Trade path 已查實：`0x50 type 11` → `readItemSlot` → `ClientSession` event → mechanical `clientEventJson` projection → `WebClient.send` 的直接 `JSON.stringify`；隔離 regression 用 non-null cash block 的兩個 `bigint` 欄位證明 stringify 會丟 `TypeError`。ADR-160 隨後定義並測試 lossless JSON-safe projection，再把 trade 加入 guard。未識別／未分類 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard），`client/main.js` 仍未 strict 型別化，不宣稱完整 `ClientEvent` schema。

## 前輪增量：選定 inbound payload guards 與 Bun 原生 formatter（ADR-158）

`client/websocket-transport.ts` 加入 optional per-payload callback；JSON object／own string `t` 通過後才執行 guard，false 或 thrown exception 都 fail-closed 到既有 malformed callback。`client/main.js` 明確注入 `client/server-message-validation.ts`。這只驗證列出的 message families（login／characters／account replies、combat／stat basis、field/entity/movement、temporary stats、party/social、inventory/shop/NPC dialogue、drops/feedback/lifecycle 等），精確型別見 `SERVER_MESSAGE_VALIDATED_TYPES`。當時 `trade`、`messenger` nested unions 明列在 `SERVER_MESSAGE_VALIDATION_GAPS`；未識別／未分類的 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard）。`client/main.js` 仍未 strict 型別化，亦不宣稱完整 `ClientEvent` runtime schema。

新 `server/test/server-message-validation.test.ts` 覆蓋代表 payload accept/reject 與範圍／巢狀欄位；transport tests 覆蓋接受、拒絕及 validator throw。所有測試只用隔離物件／fake socket；不登入或操作角色／save。實際 gates 與最新結果見 [ADR-158](DECISIONS.md)。

Bun 1.4.4 內建 `bun fmt` 取代 Prettier CLI：以 lockfile 原 SHA512 驗證的 Prettier 3.9.10 做比較工具，同一 `.prettierrc.json` 下 438 個指定 source/config 路徑逐檔 output byte-identical，故移除 Prettier direct dependency／lock entry；保留 config。另 `bun check --no-script` 在 730 個 TypeScript files 無錯；正式 `typecheck` 仍用 pinned TypeScript 7.0.2 `tsc`。

## 前輪增量：strict server-to-browser 訊息合約與 Bun 1.4.4 升級（ADR-157）

新增 `server/src/net/webclient-messages.ts`：用 conditional mapped union 將 `ClientEvent.kind` 轉為 JSON `t`，明確列出 field capability flags、mob presentation／forcedDuration、登入／角色／角色建立刪除、`stat-basis`、attack／touch result、test-tools 等全部 `WebClient.send` 訊息。`clientEventJson` 現在保留 event discriminator；`BrowserSession.send(message: WebClientServerMessage)` 移除原本的 `unknown` sink。`touch-result` 使用互斥 success／rejection union。無 `any`、strict 放寬或新 runtime dependency。

這是**出站 JSON 的編譯期合約**，不等於序列化內容已深度 runtime 驗證。ADR-157 當時 browser inbound transport 僅檢查 JSON object＋string `t`；ADR-158 後才接上選定 per-event guard，且在 ADR-158 當時 `trade`／`messenger` 仍有明確 gaps，未識別／未分類的 runtime `t` pass-through（已知 `t: "unknown"` 有 guard）；`client/main.js` 仍未 strict 型別化。

ADR-157 當輪實際核對 registry／GitHub latest 後，把 Bun／`@types/bun` 由 1.4.3 升到 **1.4.4**；TypeScript 7.0.2、當時使用的 Prettier 3.9.10、playwright-core 1.64.1、@sparticuz/chromium 153.0.0 與 checkout v7.0.1／setup-bun v2.2.0 維持 latest。官方 registry tarball SHA1／SHA512 verified；`.bun-version`／`packageManager`／`engines`／`@types/bun`／`bun.lock` 同步，frozen install 27 installs／47 packages 無漂移。ADR-157 當時 typecheck、format check、browser build 通過；相關 bridge／projection focused **44/0、4 files**；完整 `bun run test` **1468 pass／0 fail／5334 expects、170 files（345.05 s）**。後續 formatter dependency migration、format byte comparison 與本輪最新回歸見 ADR-158。

## 前輪增量：獨立 strict WebSocket transport 與 JSON envelope（ADR-156）

新增 `client/websocket-transport.ts`，由嚴格 TypeScript 模組擁有 browser socket 建立／替換／送出／關閉、open-state 檢查、
JSON parse 與 active-connection generation fence；`client/main.js` 不再直接持有 `WebSocket` 或散落檢查 `readyState`，
所有既有 request／combat gates 改讀 typed `clientTransport.open`。相同 origin 的 `/ws`、login callback、close cleanup、
登入狀態與回標題碼 `1000 / "return to title"` 保持由 main 的既有整合流程注入，未自動連線或登入。

輸入先以 `unknown` 解析，只接受 JSON object 且 `t` 為 string；格式錯誤／缺 discriminator 按既有「unreadable message」路徑記錄，
不讓 `null`／array 直接進入 `handle`。這只是**頂層 envelope 守衛**，不是 `ClientEvent` 每個 payload 的深度 runtime schema；
`main.js` 仍是唯一未 strict 型別化的 authored client 來源。新增 5 個 isolated fake-WebSocket 回歸（send gate／JSON serialization、
invalid envelope、舊 socket stale event fence、active error/close、return-to-title close code）；mock browser startup／static／UI 與
system-UI source wiring 聚焦共 **18/0、5 files**。`typecheck`／`format:check`／`build` 通過；完整 `bun run test` **1468 pass／0 fail／5334 expects、170 files**（378.63 s）。本輪不新增依賴、不改 strict、不連真遊戲、不操作帳號／角色／save。

目前 `client/` 有 **122 支 `.ts`**，`client/main.js` 為 **5529 行**，仍需持續作領域門面拆分及型別化；不能把 transport／selected payload guard 抽出說成 main 遷移已完成。

## 前輪增量：探針嚴格 TS 化、背包視窗幾何抽出，全案僅餘 main.js（ADR-109）

`server/scripts/client_probe.mjs`（941 行）重寫為 **`client_probe.ts`（1749 行，納入 tsc 檢查）**：`ShimElement`
全欄位宣告（DOM 預設 `hidden/disabled/checked = false`）、`DomEvent`/`ShimDocument`/`ShimWindow`/`ClientProbe`
等介面、`el(id)` 取代 `elements.get(id)`、`fire()`（冒泡＋`stopPropagation`）與 `emitWindow()`（原樣交付），
並因型別化而能安全移除 ADR-069 留下的 21 行 `Object.assign(globalThis, await import(...))` 死 preload
（ADR-108 通用 import shim 已覆蓋 main.js 全部 79 條 static import；main.js 無 dynamic `import()`）。
**輸出與舊 `.mjs` 逐行完全相同**、退出碼 0，證明重寫沒有改行為。

同輪自 `client/main.js` 抽出第一個可單元化的領域 **`client/inventory-window.ts`（220 行）**：native 版面常數
（sub_43D750／sub_43E340／4DA440／4DA810）與 `inventoryScrollbarGeometry`/`clampInventoryScroll`/
`inventorySlotAt`/`inventoryWindowAt`/`drawInventoryScrollbar`/`drawInventoryLabel`，main.js 六個同名函式退化為
一行委派，**呼叫點與既有 source pin 一字未動**（main.js 5930→5836 行、client 106→107 支 TS；ADR-110 續抽商店幾何後 5662 行、108 支；ADR-112 收回 status bar 後 5616 行、ADR-113 後 5597 行、ADR-114 後 5567 行、ADR-115 後 5551 行、ADR-116 後 5547 行、ADR-117 後 5543 行、ADR-118 後 5547 行、ADR-119 後 5548 行、ADR-120 後 5482 行、ADR-121 後 5445 行、ADR-131 後 5513 行、ADR-132 後 5522 行、ADR-137 後 5525 行），並新增
`server/test/inventory-window.test.ts` **9 pass / 0 fail**。主入口健診採靜態耦合普查（321 個 top-level 宣告中
僅 3 個零耦合、≥25 行且耦合 ≤4 者僅 6 個）：**main.js 是彼此糾結的單體，沒有可機械切開的純區塊**，
因此採門面分層逐領域搬移，不以改名或 `any` 冒充遷移。六項工具 pins 重新以 registry metadata 核對仍為
`latest` 且不變（Bun 1.4.3／TypeScript 7.0.2／@types/bun 1.4.3／Prettier 3.9.10／playwright-core 1.64.1／
@sparticuz/chromium 153.0.0）。本輪結果、等價驗證與文件同步見 ADR-109。

## 前輪增量：probe/typed/canvas 家族清零與 client_probe 全鏈復活（ADR-108）

`server/scripts/client_probe.mjs` 自 typed 模組化後已死（hardcode 11 個 `.mjs` strip，與 ~90 TS 現況脫節；自稱 Historical NOT executed）。本輪以**通用 import shim**（逐條 `import {a} from "./mod.ts"` 真 import 並掛 `globalThis`）使其評估**真實 typed main.js**，並補足 `Element.localName`/`ownerDocument`/`closest`/`matches`/`before`/`documentElement`/`hasFocus`/`dispatchEvent` 與事件 bubbling 等 DOM 最小契約；同時修復 **`client/main.js:834` 真產品 bug**（`case "user-move"` 用裸 `now` 而未宣告，bebb3009 引入，遠端路徑 ReferenceError）與八項真 Chromium 超時（`{ timeout: 60000 }`）及 `server/scripts/browser.ts` 啟動期 SIGSEGV 有界重試。**完整 1213 pass / 0 fail**（142 files），對 ADR-107 1205/8/2 清掉最後 8 fail/2 errors，43 項歷史失敗全數結案。`client_probe.mjs` 仍為 `.mjs`（node:vm），但其覆蓋的 login→field→portal→shop→dialogue→inventory→stat→creation 全鏈現已與 typed client 一致並通過；**main.js 仍未完成 TS 遷移**。本輪結果、每步中間失敗與政策見 ADR-108。

## 前輪增量：原社交指令鏈與名冊六格（ADR-090）

新增strict `social-commands`／`party-state`／`party-invitation`／`chat-entry`及`server/src/net/chat-input.ts`，browser與bridge共用同一指令路由；
`readPartyTable`改為固定六格，`PARTY_MAX_MEMBERS`移到client純模块由protocol再匯出。未關strict／erasableSyntaxOnly，未新增依賴，未把JS只更名冒充遷移。
client101支TS；main5394→5370行（抽出編輯框與邀請確認），仍不是完整main TS遷移，client_probe.mjs及原44項失敗亦未完成。
本輪結果、原證位址與安全邊界見[NATIVE_SOCIAL_COMMANDS](NATIVE_SOCIAL_COMMANDS.md)。

## 前輪增量：原角色互動／附接橋接（ADR-089）

新增strict `player-menu-data`／`player-menu`／`fame`／`party`及Session送出clock、具原PE／WZ／真Chromium與加密synthetic peer回歸，
另有不建立世界／save的`tools/attach-web.ts`；補權威party邀請身份檢查並對舊附接端fail-closed；未關strict／erasableSyntaxOnly，沒有新增依賴或把JS只更名冒充遷移。
client97支TS；main5321→5394行是整合接點，仍不是完整main TS遷移，client_probe.mjs及原44項失敗亦未完成。
本輪結果、完整失敗比較、同世界新版LIVE與獨立橋接能力差異見[NATIVE_PLAYER_INTERACTIONS](NATIVE_PLAYER_INTERACTIONS.md)。

## 前輪增量：原訊息與名稱資源整鏈（ADR-088）

新增真正strict的feedback-data／feedback／feedback-renderer／item-metadata，拆出真bridge共用client-event-json；不是更名或any／declaration／strict放寬。
主入口5356→5321行，client93支TS；舊client_probe.mjs709行與其他深schema／44項基準失敗仍未完成。
六項registry latest重新核對與exact pins一致；strict／format／build／diff通過。
聚焦49/0（8files，6.82s），完整1090/44（1134tests／129files，320.71s），對本輪前1064/44（319.36s）failure multiset新增0／移除0；CI仍不綠。
41純imports／0 I/O；原EXE/Shape2D binary anchors、全equipment metadata及DPR1/2原WZ component通過。LIVE93模組200，title-only frame29／errors[]／0WS；新記憶體世界不是舊角色恢復。
完整原證、政策與安全邊界見[NATIVE_FEEDBACK](NATIVE_FEEDBACK.md)。

## 前輪增量：真實畫布／有界鍵盤工具（ADR-087）

frame_probe／play_probe已改為strict TS實作與Bun runner；刪除2支舊MJS。共用明示fixture／序號與原PNG→buffer→view證據，拒絕fake DOM／直接攻擊與移動封包。
工具鏈latest與exact pins相同；focused25/0、完整1064/44（1108tests／124files，267.35s），對本輪前基準failure multiset新增0／移除0，CI仍不綠。
完整結果與安全邊界見 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)。
主入口5356行及client_probe.mjs709行／44項舊失敗仍待處理，不冒稱全案完成。

## 前輪增量：標題／登入／世界與選角 strict UI（ADR-086）

實際抽出login-data／login-presentation／login-screen，連同清單unknown守衛、純選擇狀態、
原WZ繪圖、DOM／鍵盤／modal／pending／storage／dispose與transport接線；main **5963→5356行**，client **89支TS**。
不是改副檔名、declaration或allowJs；main與3支MJS仍未完成，舊client-ui失敗測試未移除。
六項registry latest於2026-10-19台北日期重新核對與exact pins一致；strict／format／build通過，focused45/0（7 files），30純imports／0 I/O。
原renderer與新實作21組完整邏輯畫布RGBA完全相同；真HTML／WZ component0WS，LIVE同PID4942、87modules與只讀120幀，不登入／角色／save／restart。
完整1054/44（1098tests／122files，285.07s），對1520ac9 failure multiset新增0／移除0（含重複），CI仍不綠。
完整證據與明確限制見 [STRICT_LOGIN_UI](STRICT_LOGIN_UI.md)。

## 前輪修正：放大後的最終螢幕像素（ADR-085）

補足原先只查buffer／取樣條紋的缺口：真原WZ角色、背景與tile經production CSS／DPR的整張screenshot RGBA比對。
42組修正前14組有差異（含4組DPR3拉近／特寫內部），修正後全0；不是加sharpen遮掩。
canvas保持整數CSS/backing，inverse DPR transform取代小數layout寬高；stage clip隔離未縮小的scroll overflow。
strict／format／build通過；完整1038/44（1082 tests／120 files，287.81s），對c773329 failure multiset新增0／移除0，CI仍不綠。
LIVE同PID4942、84modules與唯讀120幀／0WS，無登入／角色／save變更。
新fixture／test皆strict TS；原有86個client TS、main.js／3MJS未完債務不變。細節見 [PIXEL_CAMERA](PIXEL_CAMERA.md)。

## 前輪增量：清晰尺寸與strict TS鏡頭／合成責任

新增scene-surface／camera-lens／lens-controls，整理display／cursor／camera／drop視野與輸入整條鏈。
五種清晰等比例尺寸（自動與1–4實體倍率）；小視窗捲動不降採樣。四種lens＋cut/fade/shutter，世界與原800×600 UI分開。
原游標以整數實體bitmap＋image-set密度，DPR-only也更新，不先縮小CSS bitmap。client現86支TS，main.js與3MJS仍未遷完。
六個latest與exact pins再核對一致；strict／format／build通過，focused58/0；完整1037/44（1081 tests／119 files，216.80s）。
對2eaa5f2 failure multiset新增0／移除0，CI仍不綠。真Chromium七DPR×五尺寸35 screenshot與游標pixel blocks、原PNG×16lens/display組合通過。
減少動態、保存／拒絕、輸入／dispose、RAF跳峰值均覆蓋；27純imports／0 I/O。LIVE同PID4942、84modules與唯讀120幀／0WS，不登入或動進度。
細節與不保證的任意DPR／OS cursor plane界線見 [PIXEL_CAMERA](PIXEL_CAMERA.md)／ADR-084。

## 前輪增量：掉落權威fh與真正typed呈現鏈

新增純DropLandingIndex，怪物戰利品／玩家道具／金幣都沿真WZ有向地板選點，原0x43不增欄位；
main抽出drop-presentation／drop-renderer，含unknown drop/remove守衛、hop與pickup連續性、實際PNG底部貼地及固定金幣幀。
client現83支TS；main.js、3支legacy MJS及完整WS深schema仍未遷完，不使用any／假的declaration／allowJs迴避。
六個registry latest再查與exact pins相同，strict／format／build通過；focused73/0（7 files）、新增28案例。
完整1023/44（1067tests／117files，187.28s），對7162765失敗multiset含重複0新增／0移除，CI仍不綠。
全100張原WZ圖379422組與真PNG／DPR1／2 component通過；新LIVE81modules／唯讀120幀、0WS。
舊沙箱／save不在，本輪明示新建獨立preview，不假稱恢復、不自動登入；玩家自行測試後不再重啟或重置。
完整原證與新政策、命令及範圍見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)／ADR-083。

## 前輪增量：7支瀏覽器工具與實體素材責任

本輪完成7支browser MJS的真正TS實作／入口／呼叫鏈遷移，移除舊檔；共用安全admission與嚴格觀測，不在匯入時啟動任何服務。
主入口另抽出entity-assets／entity-resource-validation／avatar-look，包含未知JSON守衛、template identity、取消與same-generation stale ownership。
當輪client **81支TS**，只餘main.js與 **3支MJS**；沒有降低strict或用declaration包住原實作。

六個registry latest再次與exact pins一致。strict／format／build通過，focused **78/0，9 files**；最後工具路由／redirect與import另驗 **15/0**。
完整 **995/44，1039 tests / 113 files**，相對29f3df6 failure multiset新增0／移除0（含重複），不skip／減少suite，CI仍不綠。
新增19案例；真Chromium空白fixture／假echo與Data.wz真HTTP metadata通過，22 imports／0 I/O attempts。
LIVE同PID6097，79modules與首幀通過、0WS；未登入／操作角色／save／restart。
實作、可用命令、安全限制與仍未驗收的手動場景見 [STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)／ADR-082。

## 前輪增量：使用者可選物理與十種鏡頭

依明確要求開放非原版5/8/10/15/20/30/45/60ms本機角色物理步長；預設30ms保留。
獨立插值／即時呈現選項、還原與typed local preference；camera增加六種真實構圖／解析彈簧模式，共十種。
移除重複header背包入口，不移除原ITEM／I。新增motion-controls／motion-tuning，當輪client **78支TS**；main與10MJS仍WIP。

strict／format／build通過，focused **81/0，9 files**；完整 **976/44，1020 tests / 110 files**。
相對9e10525失敗multiset新增0／移除0；新增18案例，沒有skip或調低原admission。
原9e10525與新預設30ms的20 scenarios／3540frames／425 movement packet bytes一致（排除local preference與顯示history）。
真source/bundle UI驗證與LIVE76 modules首幀通過、0WS；LIVE保持PID6097，未登入／操作角色／save／restart。
具體實驗界線見 [MOTION_EXPERIMENTS](MOTION_EXPERIMENTS.md)；本機日誌在ignored generated/motion-experiments/。

## 前輪增量：顯示／影像快取與診斷工具

本輪實際抽出 `display-controls.ts`／`image-cache.ts`，含拒絕 storage、dispose、DPR-only 畫格更新、
archive hard bound／avatar LRU、cold retry／stale identity／blob URL 完整生命週期。當輪client **76 支 TS**，main 仍是 JS。
三支 display/render/whisper 工具改為嚴格 TS＋純 import／顯式 runner，移除其舊 MJS；其餘 **10 支 MJS** 仍未遷移。
whisper 的跨系統歷史場景仍欠 native admission 對齊；**不能沿稱舊105項通過**。

strict／format／build 通過；最終 focused **63/0（8 files，59.96秒）**，包含抽離 source-chain。
完整 **958 pass / 44 fail（1002 tests / 109 files，197.48秒）**；相對 c8b52d7 的 failure multiset
**新增0／移除0**，含同標題的重複次數；不是只比總數。新增27案例，沒有 skip 或縮小全套範圍。
初次全套46fail的兩個新 source-path失敗已沿實際委派鏈修正，不移除其餘原斷言；最終44仍阻擋全案驗收。

真 Chromium 五DPR／同頁DPR切換、120個title畫格／實際draw計數、真WZ avatar packed PNG解碼與revoke後像素皆通過。
LIVE 維持原PID6097：首頁200、兩入口與 **74 modules** HTTP／MIME／JS parser及Chromium首幀通過、page errors=0、0WS。
**沒有登入／操作現有角色／寫存檔／restart**。六個latest仍與exact pins一致，未換同版本。
細節、手動工具使用限制、常數意義與剩餘範圍見 [BROWSER_TOOL_CLEANUP](BROWSER_TOOL_CLEANUP.md)／ADR-080。
日誌：ignored `generated/cleanup-round4/`（registry-latest、typecheck、format-check、build、focused-tools、
source-chain-tests、focused-final、full-suite、cross-check、comparison.json）；歷史初始化失敗另保留 full-suite-initial.log。

## 前輪增量：走跳顯示插值與鏡頭模式

已按原 CVecCtrl 537520／53C2B0 補上獨立顯示取樣，不改走速／重力／權威30ms時鐘／發包；
走路、跳躍、繩梯、KB與附身視覺共用。保留最多30ms呈現延遲，原 app ceil 全域相位仍未完整移植。
新增嚴格 TS `player-presentation.ts`／`camera.ts`／`camera-controls.ts`；四種鏡頭、回中、獨立偏好與焦點守衛已接真 UI。

本次 strict／format／build 通過；完整 **931 pass / 44 fail（975 tests / 106 files，168.25秒）**，
對登入修復輪38cdd2d的44項 failure multiset 新增0／移除0，CI仍不綠。
新增15項 regression；含真 source／bundle startup與camera偏好的 focused **19/0**。
原／新物理20 scenarios／3540 frames／425個原movement packet bytes交叉全同。
LIVE同一PID，只讀載入72 modules與Chromium首幀通過、0WS；沒有登入／操作現有角色／存檔／restart。
詳見 [PLAYER_PRESENTATION_CAMERA](PLAYER_PRESENTATION_CAMERA.md)。以下登入修復與150音訊等數字保留其**前輪**時點意義。

## 前輪修復：登入按鈕沒有反應（38cdd2d）

上一輪把 statwindow 的 #stat-body 誤判成 div，實際 index.html 是 button。真 Chromium 重現了 requireElement 拋錯，使整頁初始化中斷；前輪 HTTP／MIME／JS 語法檢查無法偵測這種執行期錯誤。**失敗 multiset 沒增加，不代表頁面功能一定正確。**

- 已改回實際 button 契約，保留原生按鈕、拖曳行為及嚴格 tag 驗證，不把守衛改成無條件 cast。
- 把主入口的 canvas／UI 查找收斂到 typed game-dom schema，移除該區 unchecked JSDoc casts。
- 獨立 startup.ts 先安裝錯誤／rejection／15秒逾時 watchdog；main 所有 UI constructor 完成才發 ready。失敗時顯示可重新整理的文字面板，不再留無回應畫面；登入按鈕及 Enter 都必須通過 ready guard。15秒是啟動介面政策，不是原版遊戲時間常數。
- 真 Chromium 分別驗證實際 HTML 的來源版、建置版與首幀 rendering；攔截的假 WebSocket 驗證登入按鈕／Enter／拒絕／重試。另故障注入原 tag 錯誤與 main 404，確認錯誤可見且不能啟動登入。
- HTTP fixture 沒有 LoginServer／GameEntryServer／帳號／玩家存檔；假 WebSocket 不呼叫 connectToServer。**沒有登入 LIVE 或操作現有角色。** 原 LIVE 只作 GET 與不點擊的瀏覽器載入檢查，程序保持同一 PID。

本輪另外將 art_perf_probe、equipment_fixture、browser_audio_probe 真正遷成 TS。PNG 計數改用 Bun 原生 module interception（舊 Node default-export monkey patch 在 Bun 會錯讀為0）；實測 metadata 0次壓縮、3個 avatar PNG 3次、重讀同一 PNG 共用快取。裝備 fixture 改為純建構函式及明示 CLI，限制新 generated/validation/*.json、wx 獨占建立、防越界 symlink，不覆寫既有 fixture。音訊工具只在同 origin 的空白驗證頁解碼，不啟動遊戲繪圖／音訊迴圈；隔離服務的原150筆音訊／alias 全部真 decodeAudioData 通過，silent=0、errors=[]，所有 WebSocket 都攔截阻止。

## 已落實

- Bun 1.4.4、TypeScript 7.0.2、@types/bun 1.4.4，單一根 package / bun.lock / tsconfig / CI；formatter 使用 Bun 1.4.4 `bun fmt`（最初遷移的 438-path audit 保留其歷史結果，Prettier direct dependency 已移除）。ADR-161 當輪以 Prettier 3.9.10 對本樹 446 個輸入再次 byte-compare，**446/446 相同**；Bun／型別與保留 package metadata latest 於 2026-10-24 重查，固定 pins 仍一致，歷史 1.4.3／Prettier pins 保留在各 ADR 當時紀錄。
- 上一輪完成剩餘 20 個 client .mjs 的實作型別與關聯呼叫鏈；61 個原有瀏覽器 leaf 已 typed。client 當時 **74 支 .ts**（目前81）（含共用型別／守衛），沒有 .mjs 或重複 declaration；**main.js 仍未遷移**。沒有新增 production any、ts-ignore、allowJs 或關閉 strict；全部 .ts / .mts 都納入編譯。
- DOM 元素依真實 tag/context 縮窄；影像 lookup 區分 Canvas 與 HTML image；系統設定的 sound/game draft 分離，取消還原與明示保存有隔離測試；創角回覆、刪除目標、NPC stale-page／asset lifecycle、技能和裝備 DTO 都有明確型別。
- 共用 combat/UI resource guards；不把 response.json()、storage JSON 直接當可信型別。真 WZ HTTP 契約測試涵蓋六類武器、投射物、創角 catalogue、怪物、技能書與全部已接主動技能；這不代表所有既有 API 都已逐一做完深 schema 審核。
- 原生 ESNext modules、Bun browser build；開發 HTTP 移除 TS 型別後用 JavaScript MIME 回應。獨立 HTTP test 與現有 LIVE 的兩個 entry／完整 import graph 均驗過狀態、MIME、JS parser；本輪另以真正 Chromium 執行初始化及 rendering，不登入 LIVE。
- 9 支純規則 probe 已真正搬進嚴格 TS / Bun suite，沒有保留 JS 兼容殼；另補自然恢復四項、typed UI 七項、真 WZ HTTP／非法 metadata 兩項。前輪納入73個直接案例，本輪再補14項；不是宣稱新增相同數量的遊戲功能。
- Python 分析工具與 Bash 啟動工具改為 Bun TS；WZ 共用產品 reader，對照不重生的獨立舊 manifest，逐一驗證 1,056 個 image 的 offset/size/source 與原 bytes checksum。
- 分析 CLI 保留原證 CP949 bytes、forward declaration、列函式、具名函式、calls/globals；存檔保護只接受現有非空 regular file，錯誤不建立替代進度。
- 原版 EXE/DLL/ACM、C/listing、Data.wz、analysis 與歷史 ADR 均保留。沒有登入 LIVE、操作現有角色、修改玩家存檔或重啟既有 LIVE；unit 使用隔離 fixture 與假傳輸。

## 登入修復輪凍結來源後驗證（38cdd2d）

| 檢查 | 本輪實際結果 |
| --- | --- |
| frozen lockfile / ignore scripts 安裝 | 通過，47 packages 無變更，無 lockfile 漂移 |
| 根 strict typecheck（全部 TS，不含剩餘 JS） | 通過 |
| 格式檢查（TS / config 範圍） | 通過；不是宣稱剩餘 JS 已完成整理 |
| Bun browser build | 通過 |
| 完整 Bun suite | **916 pass / 44 fail，960 tests / 105 files，165.10 秒** |
| 9 支 presentation tests 與 Bun wrapper | **63 pass / 0 fail**；完整 suite 也有包含 |
| 另增 recovery / typed UI / WZ HTTP | **4 + 7 + 2 項全通過**；完整 suite 也有包含 |
| 本輪 startup / browser / tool / UI / static focused | **20 pass / 0 fail，5 files**；完整 suite 也全部包含 |
| 現有 LIVE 唯讀檢查 | index 200、兩個 entry／**69 個 modules** 的 HTTP / MIME / JS parser 通過；Chromium 153 實際啟動及 rendering 通過、login enabled、page errors=0、WebSocket attempts=0 |
| 上一凍結點 ff0e735 | 902 pass / 44 fail，946 tests / 102 files |
| 上一凍結點 80316d4 | 828 pass / 45 fail，873 tests / 90 files，131.17 秒 |
| d311622 隔離原始碼，同版 Bun / 同 suite 參數 | 823 pass / 45 fail，868 tests / 86 files，131.82 秒 |
| 失敗 multiset 交叉 | **與 ff0e735 的44項檔名、標題、重複次數完全相同；新增／移除均0**。前輪原 browser-motion wrapper 已轉綠 |

完整回歸沒有過濾、skip、continue-on-error 或降低型別設定。CI **仍會失敗**；參照也是 Bun，不能據此推論原 Node 同樣失敗，更不能把餘下 44 項當可忽略或宣稱完成驗收。

前輪格式化／typed 變數命名使數個 source assertions 過時；已保留原語義檢查，改成容許空白、等價引號及明確的 sound/game draft 名稱，而不是刪除 assertion。

本輪日誌在 ignored generated/migration/round3/：install.log、typecheck.log、format-check.log、build.log、full-suite.log、comparison.json、cross-check.log；focused 為 generated/browser-runtime/focused-final.log。前輪 round2 與原 reference 日誌保留；不隨 Git 推送。

## 純 probe 的真正遷移與原證修正

舊 browser-motion wrapper 透過 Node --test 方式啟動 Bun，並未成功跑到內層案例。改用 Bun runner 後揭露的 10 個舊 fixture／expectation 失敗，逐項依現有 EXE/listing/WZ／ADR 修正，**沒有改 production 物理、速度或添加人工地板**：

- 裝備拒絕依實際 Lv／STR 原生分支檢查，不把早先命中的拒絕理由誤當另一個分支。
- 兩個 isolated slope/wall 測試明示 physicalBounds，隔離 ADR-078 的真實 field clipping；不是改遊戲地圖邊界。
- Down+jump 與普通 jump 比對且落回原平台；不再期待 ADR-077 已證明不存在的穿台。
- local root z 為 10010；remote rope 為 16/17；登台、跳躍與恢復按 30ms controller boundary 驗證，不拿 16ms 當完整 tick。
- scene oracle 獨立排序完整 map/dynamic creation stamps；額外驗證 equal-z 不按 feet y。
- 新自然恢復案例驗證 30ms／9990→10020ms 邊界、HP/MP 與死亡 reset、繩梯旗標／間隔、numeric WZ passive 與 learned-level clamp，不解析 hs 文案做公式。

| 舊 server/scripts 來源 | 現行 server/test 來源 |
| --- | --- |
| equipment_probe.mjs | presentation-equipment.test.ts |
| display_probe.mjs | presentation-display.test.ts |
| minimap_probe.mjs | presentation-minimap.test.ts |
| portal_probe.mjs | presentation-portal.test.ts |
| motion_probe.mjs | presentation-motion.test.ts |
| temporarystats_probe.mjs | presentation-temporarystats.test.ts |
| audio_probe.mjs | presentation-audio.test.ts |
| selection_probe.mjs | presentation-selection.test.ts |
| scene_probe.mjs | presentation-scene.test.ts |

歷史文件中的舊檔名／node 指令保留其原時點意義；現行純測試可用：

```sh
bun test --timeout 30000 ./server/test/presentation-*.test.ts
bun test --timeout 30000 ./server/test/typed-ui-components.test.ts ./server/test/browser-resource-contract.test.ts
```

這些是隔離的純規則／DOM fixture／HTTP metadata 測試；不要與會自動登入或移動角色的 browser_*_probe 混為一談。本次沒有執行後者。

## 尚未完成的原目標

1. client/main.js 的真正實作型別與合理分層，不能只 rename 或用 any 包住。
2. ~~`server/scripts/client_probe.mjs` 的形式遷移~~ **已完成（ADR-109）**：現為 `server/scripts/client_probe.ts`，納入 strict 檢查並由 `server/test/client-ui.test.ts` spawn 執行。**剩餘唯一未完成項是 client/main.js**。
3. 完成 typed whisper 歷史場景的 WZ/native admission 對齊；繼續審核其餘既有資料邊界與重複責任；目前 strict typecheck 不等於每個 HTTP payload 都有深 runtime schema。
4. **44 項失敗已於 ADR-108 全數結案（1213 pass / 0 fail）**；本節保留歷史清單供追溯，不再代表現況失敗。
5. **本輪全套工程 gates 已綠**：ADR-156 的 `typecheck`／`format:check`／`build`／完整 suite 均通過；不表示完成主入口嚴格型別化、每種 HTTP／WebSocket event 的深 schema，或替使用者進行手動登入／角色遊玩驗收。後續任何變更仍須重跑對應 gates。

### 尚未遷移的來源（ADR-109 起僅餘 main.js）

- **client/main.js（5529 行）**：仍為 JS／TS 混合入口，未完成分層與型別化。ADR-109 的耦合普查與 `client/inventory-window.ts`、
  既有 shop/window/hud 抽離，以及 ADR-156 的 `client/websocket-transport.ts`（socket lifecycle／頂層 envelope）都是逐域門面；
  其餘 shop operation、rendering、pointer/UI state 與 event-specific payload validation 仍在 main，需逐領域重構，不是一次改名能完成。
- ~~server/scripts/client_probe.mjs~~ → 已於 ADR-109 遷為 `client_probe.ts`。

### 已通過的 44 個案例（ADR-108 結案，保留歷史標題供追溯）

- server/test/client-session.test.ts — coalesced initial field/pool/stat packets preserve wire order, mobs and current EXP denominator
- server/test/client-ui.test.ts — browser canvas UI: title login, shop buy/sell, scroll, drag, inventory updates and tooltips
- server/test/field.test.ts — 0x1a's other sub-ops are refused instead of read as chat
- server/test/field.test.ts — every opcode range of the CField router maps to its subsystem
- server/test/field.test.ts — the level-up effect (0x29) names a user, and one byte says which effect
- server/test/growth.test.ts — two HP/MP allocations use real c2s/s2c codecs and survive an unchanged save format
- server/test/magic-skills.test.ts — 0x11 has no ammo slot or shot-only u16; 0x25 relay reads as magic without a projectile item
- server/test/magic-skills.test.ts — both WZ skills keep prerequisite, actual mad/mastery/cost and distinct ball/effect/hit variants
- server/test/mobs.test.ts — a mob walks one leg per 0x33, at its speed, and turns around at the range end
- server/test/native-attack-effects.test.ts — 4BE270 native formula and browser art select the same learned WZ passive, mode0 vs1 and ordered sword fallback
- server/test/native-dialogue-richtext.test.ts — 534FA0: ## escapes, native item/skill records inherit selection, unknown macros remain literal
- server/test/native-jump-background-attack.test.ts — browser wiring shares field clock and action selection, awaits selected attack PNGs and retains authorized-only warp
- server/test/native-layer-priority.test.ts — 46BDA0 background index participates in root z; modern front is not a KMS 1.11 flag
- server/test/native-layer-priority.test.ts — field wiring keeps avatar children atomic, damage fixed-plane and bullets at source depth
- server/test/native-locomotion.test.ts — linked floor transition preserves tangent speed and changes world velocity; jump lifts before external force
- server/test/native-npc-dialogue.test.ts — UI examples are local/read-only and real packets supersede them; source isolation stays wired
- server/test/ranged-skills.test.ts — Lucky Seven case47 draws LUK1.3..0.5 *5, no STR/DEX/mastery term, before level/PD/skill factor
- server/test/schema.test.ts — every row with a field codec is understood by the decode tool's describer
- server/test/serve.test.ts — a drop is taken by walking onto it: 0x44 kind 2, the gain, and the notice
- server/test/serve.test.ts — a kill awards the monster's exp as a 0x0D stat diff
- server/test/serve.test.ts — a level-up plays the effect for the other players (0x29), not for the one who levelled
- server/test/serve.test.ts — a session that ends leaves the character's progress in the save
- server/test/serve.test.ts — a shot goes out as 0x24 with the projectile id, and a cast as 0x25
- server/test/serve.test.ts — a swing at an unknown mob id answers nothing and leaves the field alone
- server/test/serve.test.ts — a swing that kills a mob answers 0x34, 0x30, and then 0x31 when the corpse is over
- server/test/serve.test.ts — a throw-away answers 0x0B and puts the item on the ground for the whole map
- server/test/serve.test.ts — a throw-away answers 0x0B and puts the item on the ground for the whole map
- server/test/serve.test.ts — clicking an NPC opens its shop, and buying moves the item and the mesos
- server/test/serve.test.ts — equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map
- server/test/serve.test.ts — equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map
- server/test/serve.test.ts — the game server spawns the map's monsters and NPCs right after 0x16
- server/test/serve.test.ts — two players in one map see each other: 0x1C, 0x22, the same kill, and 0x1D
- server/test/serve.test.ts — using a USE-tab item: 0x18 restores and consumes it, 0x19 changes the map
- server/test/shops.test.ts — the rows the client is sent carry the archive's price and the shop's cap
- server/test/shops.test.ts — what a shop sells is something the use path understands
- server/test/webclient.test.ts — Korean character names survive field entry, other-player views, whispers and find
- server/test/webclient.test.ts — a browser's Ctrl swing kills a mob: the hit, the death and the drop
- server/test/webclient.test.ts — bridge contact derives its own damage, validates frame/field, releases duplicates and revives via kind=0
- server/test/webclient.test.ts — browser slot requests cross native TCP: swap, wear, self/remote look, ack, refusal and save
- server/test/webclient.test.ts — clicking an NPC opens its shop, and a buy moves the item and the mesos
- server/test/webclient.test.ts — inline dialogue catalogue: normal item/skill icons, original names, no learned-skill or save mutation
- server/test/webclient.test.ts — legacy blank sword repair is opt-in/authenticated, emits native inventory and basis; damage trace exposes zero PAD
- server/test/webclient.test.ts — map command is disabled when no operator policy is configured
- server/test/webclient.test.ts — native map command denies by default, validates IDs, preserves field on missing maps and allows only authorized account

## 預覽與存檔

本輪沒有找到舊玩家 save，不冒稱恢復。既有 web 8515 / native 8516 / game 8517 的 memory-only LIVE 保持運行，沒有重啟或清空；使用者可能已有新的記憶體角色進度，不能再稱它當下必然空白。preview/preview、observer/observer 是此獨立世界的帳號，不是還原的舊帳號。

--save off 重啟會遺失記憶體進度，不寫既有玩家存檔。實際在線狀態以 LIVE 程序為準；手動啟動指令及安全限制見 README / TOOLCHAIN。
