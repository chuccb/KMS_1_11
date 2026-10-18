# Bun 全專案遷移：進行中，未完成交付

2026-10-18。原目標仍是全專案只用嚴格 TypeScript / ESNext / Bun；不得把目前階段當作全案完成。

## 已落實

- Bun 1.4.3、TypeScript 7.0.2、@types/bun 1.4.3、Prettier 3.9.10，單一根 package / bun.lock / tsconfig / CI。
- 本輪完成剩餘 20 個 client .mjs 的實作型別與關聯呼叫鏈；61 個原有瀏覽器 leaf 已 typed。client 現有 **68 支 .ts**（含共用型別／守衛），沒有 .mjs 或重複 declaration；**main.js 仍未遷移**。沒有新增 production any、ts-ignore、allowJs 或關閉 strict；全部 .ts / .mts 都納入編譯。
- DOM 元素依真實 tag/context 縮窄；影像 lookup 區分 Canvas 與 HTML image；系統設定的 sound/game draft 分離，取消還原與明示保存有隔離測試；創角回覆、刪除目標、NPC stale-page／asset lifecycle、技能和裝備 DTO 都有明確型別。
- 共用 combat/UI resource guards；不把 response.json()、storage JSON 直接當可信型別。本輪真 WZ HTTP 契約測試涵蓋六類武器、投射物、創角 catalogue、怪物、技能書與全部已接主動技能；這不代表所有既有 API 都已逐一做完深 schema 審核。
- 原生 ESNext modules、Bun browser build；開發 HTTP 移除 TS 型別後用 JavaScript MIME 回應。獨立 HTTP test 與現有 LIVE 的整個 import graph 均做過狀態、MIME、JavaScript parser 檢查，沒有執行網頁或登入遊戲。
- 9 支純規則 probe 已真正搬進嚴格 TS / Bun suite，沒有保留 JS 兼容殼；另補自然恢復四項、typed UI 五項、真 WZ HTTP／非法 metadata 兩項。完整 suite 比上一凍結點多 **73 個直接案例**；不是宣稱新增 73 項遊戲功能。
- Python 分析工具與 Bash 啟動工具改為 Bun TS；WZ 共用產品 reader，對照不重生的獨立舊 manifest，逐一驗證 1,056 個 image 的 offset/size/source 與原 bytes checksum。
- 分析 CLI 保留原證 CP949 bytes、forward declaration、列函式、具名函式、calls/globals；存檔保護只接受現有非空 regular file，錯誤不建立替代進度。
- 原版 EXE/DLL/ACM、C/listing、Data.wz、analysis 與歷史 ADR 均保留。沒有自動登入、操作玩家角色、修改玩家存檔或重啟既有 LIVE。

## 凍結來源後驗證

| 檢查 | 本輪實際結果 |
| --- | --- |
| frozen lockfile / ignore scripts 安裝 | 通過，28 packages 無變更，無 lockfile 漂移 |
| 根 strict typecheck（全部 TS，不含剩餘 JS） | 通過 |
| 格式檢查（TS / config 範圍） | 通過；不是宣稱剩餘 JS 已完成整理 |
| Bun browser build | 通過 |
| 完整 Bun suite | **902 pass / 44 fail，946 tests / 102 files** |
| 9 支 presentation tests 與 Bun wrapper | **63 pass / 0 fail**；完整 suite 也有包含 |
| 另增 recovery / typed UI / WZ HTTP | **4 + 5 + 2 項全通過**；完整 suite 也有包含 |
| 現有 LIVE 唯讀檢查 | index 200、**66 個 browser modules 的 HTTP / MIME / JS parser 全通過**；僅 static GET，未開遊戲連線 |
| 上一凍結點 80316d4 | 828 pass / 45 fail，873 tests / 90 files，131.17 秒 |
| d311622 隔離原始碼，同版 Bun / 同 suite 參數 | 823 pass / 45 fail，868 tests / 86 files，131.82 秒 |
| 失敗 multiset 交叉 | **原有 browser-motion wrapper 轉綠；其餘 44 項檔名、標題、重複次數完全相同；新增失敗 0** |

完整回歸沒有過濾、skip、continue-on-error 或降低型別設定。CI **仍會失敗**；參照也是 Bun，不能據此推論原 Node 同樣失敗，更不能把餘下 44 項當可忽略或宣稱完成驗收。

本輪格式化／typed 變數命名使數個 source assertions 過時；已保留原語義檢查，改成容許空白、等價引號及明確的 sound/game draft 名稱，而不是刪除 assertion。

原始日誌在 ignored generated/migration/round2/：install-final.log、typecheck-final.log、format-check-final.log、build-final.log、full-suite-confirmed.log、failure-comparison.json、cross-check.log；上一輪在 generated/migration/{full-suite-checkpoint,reference-suite}.log。日誌不隨 Git 推送。

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
2. 下列 **16 支 server/scripts .mjs 工具／fixture** 的 Bun runner、型別與呼叫鏈遷移；含手動 browser probes，不因本次 pure suite 轉綠而宣稱它們已完成。
3. 繼續審核其餘既有資料邊界與重複責任；目前 strict typecheck 不等於每個 HTTP payload 都有深 runtime schema。
4. 追查全部 **44 項失敗**，分清 fixture、Bun 相容差異與真實行為，按原證修正；不能只讓 CI 表面變綠。
5. 全案最後的格式、型別、完整回歸、建置與 HTTP 交叉確認；目前只有以上階段性結果。

### 尚未遷移的工具

- server/scripts/art_perf_probe.mjs
- server/scripts/browser_audio_probe.mjs
- server/scripts/browser_creation_probe.mjs
- server/scripts/browser_display_probe.mjs
- server/scripts/browser_equipment_probe.mjs
- server/scripts/browser_minimap_probe.mjs
- server/scripts/browser_motion_probe.mjs
- server/scripts/browser_portal_probe.mjs
- server/scripts/browser_render_probe.mjs
- server/scripts/browser_selection_probe.mjs
- server/scripts/browser_stat_probe.mjs
- server/scripts/client_probe.mjs
- server/scripts/equipment_fixture.mjs
- server/scripts/frame_probe.mjs
- server/scripts/play_probe.mjs
- server/scripts/whisper_probe.mjs

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
