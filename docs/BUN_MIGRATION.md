# Bun 全專案遷移：進行中，未完成交付

2026-10-18。原目標仍是全專案只用嚴格 TypeScript / ESNext / Bun；不得把目前階段當作全案完成。

## 最新增量：顯示／影像快取與診斷工具

本輪實際抽出 `display-controls.ts`／`image-cache.ts`，含拒絕 storage、dispose、DPR-only 畫格更新、
archive hard bound／avatar LRU、cold retry／stale identity／blob URL 完整生命週期。client 目前 **76 支 TS**，main 仍是 JS。
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

- Bun 1.4.3、TypeScript 7.0.2、@types/bun 1.4.3、Prettier 3.9.10，單一根 package / bun.lock / tsconfig / CI。
- 上一輪完成剩餘 20 個 client .mjs 的實作型別與關聯呼叫鏈；61 個原有瀏覽器 leaf 已 typed。client 當時 **74 支 .ts**（本輪增加至76）（含共用型別／守衛），沒有 .mjs 或重複 declaration；**main.js 仍未遷移**。沒有新增 production any、ts-ignore、allowJs 或關閉 strict；全部 .ts / .mts 都納入編譯。
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
2. 下列 **10 支 server/scripts .mjs 工具／fixture** 的 Bun runner、型別與呼叫鏈遷移；含手動 browser probes，不因本次 pure suite 轉綠而宣稱它們已完成。
3. 完成 typed whisper 歷史場景的 WZ/native admission 對齊；繼續審核其餘既有資料邊界與重複責任；目前 strict typecheck 不等於每個 HTTP payload 都有深 runtime schema。
4. 追查全部 **44 項失敗**，分清 fixture、Bun 相容差異與真實行為，按原證修正；不能只讓 CI 表面變綠。
5. 全案最後的格式、型別、完整回歸、建置與 HTTP 交叉確認；目前只有以上階段性結果。

### 尚未遷移的工具

- server/scripts/browser_creation_probe.mjs
- server/scripts/browser_equipment_probe.mjs
- server/scripts/browser_minimap_probe.mjs
- server/scripts/browser_motion_probe.mjs
- server/scripts/browser_portal_probe.mjs
- server/scripts/browser_selection_probe.mjs
- server/scripts/browser_stat_probe.mjs
- server/scripts/client_probe.mjs
- server/scripts/frame_probe.mjs
- server/scripts/play_probe.mjs

### 尚未通過的 44 個案例（保留同檔重複標題）

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
