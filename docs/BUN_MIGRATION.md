# Bun 全專案遷移：進行中，未完成交付

2026-10-18。原目標仍是全專案只用嚴格 TypeScript / ESNext / Bun；不得把目前階段當作全案完成。

## 已落實

- Bun 1.4.3、TypeScript 7.0.2、@types/bun 1.4.3、Prettier 3.9.10，單一根 package / bun.lock / tsconfig / CI。
- 41 個瀏覽器模組的宣告與實作收斂到真正 typed .ts，另外抽出共用 motion/render/resource-validation 型別與守衛。無新增 production any、ts-ignore 或關閉 strict；全部 .ts / .mts 都納入編譯。
- 原生 ESNext modules、Bun browser build；開發 HTTP 逐檔移除 TS 型別，以 JS MIME 回應。完整瀏覽器 import graph 已經實際 HTTP 遞迴讀取、檢查狀態/MIME/JS 語法；沒有執行網頁或登入遊戲。
- Python 分析工具與 Bash 啟動工具改為 Bun TS；WZ 共用產品 reader，對照不重生的獨立舊 manifest，逐一驗證 1,056 個 image 的 offset/size/source 與原 bytes checksum。
- 分析 CLI 原證 CP949 bytes、forward declaration、列函式、具名函式、calls/globals；存檔保護只接受現有非空 regular file，錯誤不建立替代進度。
- 保留所有原版二進位、C/listing、Data.wz、analysis 與歷史 ADR。未自動登入、未操作玩家角色、未修改玩家存檔。

## 凍結來源後驗證

| 檢查 | 實際結果 |
| --- | --- |
| frozen lockfile / ignore scripts 安裝 | 通過，無 lockfile 漂移 |
| 根 strict typecheck（包含全部 TS，而非剩餘 JS） | 通過 |
| 格式檢查（TS / config 範圍） | 通過；不是宣稱剩餘 JS 已完成整理 |
| Bun browser build | 通過 |
| 完整 Bun suite | **828 pass / 45 fail，873 tests / 90 files，131.17 秒** |
| d311622 原始碼隔離副本，完全同版 Bun / 同 suite 參數 | **823 pass / 45 fail，868 tests / 86 files，131.82 秒** |
| 失敗集合交叉 | **檔名、標題、重複次數完全相同**，沒有過濾或跳過失敗案例 |
| 新增工具與 HTTP graph 五項 | 5 pass / 0 fail，完整 suite 也有包含 |

先前格式化引入四個過度依賴空白的 source assertions，已改成相同語義但容許空白的比對；完整套件重跑後恢復與參照相同的失敗集合。
注意：參照也是 **Bun**；這不能證明原 Node 環境同樣失敗，也不能因此把這 45 項當成可忽略。CI 仍會失敗，不能宣稱已全面相容／驗收。

原始日誌是 ignored generated/migration/{typecheck-checkpoint,format-checkpoint,build-checkpoint,full-suite-checkpoint,reference-suite}.log；檔案不隨 Git 推送。

## 尚未完成的原目標

1. client/main.js（主入口）實作型別及合理分層；不能單純 rename 或用 any 包住。
2. 以下 20 個瀏覽器 .mjs 的實際型別遷移。
3. server/scripts 的 25 支 .mjs probe：Bun runner / DOM shim / TS 型別與呼叫鏈尚需完整處理。
4. 追查全部 45 個失敗，分清舊 fixture、Bun 相容差異與真正行為；必須依原證修正，不縮小驗證範圍讓 CI 變綠。
5. 全案最後一次格式、型別、完整回歸、建置及 HTTP 交叉確認；目前只具備上述階段性結果。

### 剩餘瀏覽器來源

- client/audio.mjs
- client/basiccombat.mjs
- client/chatballoons.mjs
- client/chatlog.mjs
- client/combat-assets.mjs
- client/creation.mjs
- client/display.mjs
- client/equipment.mjs
- client/itemdialogs.mjs
- client/minimap.mjs
- client/mob-attack-preview.mjs
- client/npcdialogue.mjs
- client/portals.mjs
- client/recovery.mjs
- client/revive.mjs
- client/scene.mjs
- client/skills.mjs
- client/statwindow.mjs
- client/systemmenu.mjs
- client/testtools.mjs

### 尚未通過的 45 個案例（包含同檔重複標題）

- server/test/browser-motion.test.ts — browser movement/audio/selection/scene: fixed-step physics, climbing, playback races and stable culling
- server/test/client-session.test.ts — coalesced initial field/pool/stat packets preserve wire order, mobs and current EXP denominator
- server/test/client-ui.test.ts — browser canvas UI: title login, shop buy/sell, scroll, drag, inventory updates and tooltips
- server/test/field.test.ts — every opcode range of the CField router maps to its subsystem
- server/test/field.test.ts — 0x1a's other sub-ops are refused instead of read as chat
- server/test/field.test.ts — the level-up effect (0x29) names a user, and one byte says which effect
- server/test/growth.test.ts — two HP/MP allocations use real c2s/s2c codecs and survive an unchanged save format
- server/test/magic-skills.test.ts — both WZ skills keep prerequisite, actual mad/mastery/cost and distinct ball/effect/hit variants
- server/test/magic-skills.test.ts — 0x11 has no ammo slot or shot-only u16; 0x25 relay reads as magic without a projectile item
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
- server/test/serve.test.ts — the game server spawns the map's monsters and NPCs right after 0x16
- server/test/serve.test.ts — a swing that kills a mob answers 0x34, 0x30, and then 0x31 when the corpse is over
- server/test/serve.test.ts — a kill awards the monster's exp as a 0x0D stat diff
- server/test/serve.test.ts — a drop is taken by walking onto it: 0x44 kind 2, the gain, and the notice
- server/test/serve.test.ts — a swing at an unknown mob id answers nothing and leaves the field alone
- server/test/serve.test.ts — clicking an NPC opens its shop, and buying moves the item and the mesos
- server/test/serve.test.ts — two players in one map see each other: 0x1C, 0x22, the same kill, and 0x1D
- server/test/serve.test.ts — equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map
- server/test/serve.test.ts — a throw-away answers 0x0B and puts the item on the ground for the whole map
- server/test/serve.test.ts — a shot goes out as 0x24 with the projectile id, and a cast as 0x25
- server/test/serve.test.ts — a level-up plays the effect for the other players (0x29), not for the one who levelled
- server/test/serve.test.ts — a session that ends leaves the character's progress in the save
- server/test/serve.test.ts — using a USE-tab item: 0x18 restores and consumes it, 0x19 changes the map
- server/test/serve.test.ts — equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map
- server/test/serve.test.ts — a throw-away answers 0x0B and puts the item on the ground for the whole map
- server/test/shops.test.ts — the rows the client is sent carry the archive's price and the shop's cap
- server/test/shops.test.ts — what a shop sells is something the use path understands
- server/test/webclient.test.ts — clicking an NPC opens its shop, and a buy moves the item and the mesos
- server/test/webclient.test.ts — a browser's Ctrl swing kills a mob: the hit, the death and the drop
- server/test/webclient.test.ts — Korean character names survive field entry, other-player views, whispers and find
- server/test/webclient.test.ts — native map command denies by default, validates IDs, preserves field on missing maps and allows only authorized account
- server/test/webclient.test.ts — map command is disabled when no operator policy is configured
- server/test/webclient.test.ts — browser slot requests cross native TCP: swap, wear, self/remote look, ack, refusal and save
- server/test/webclient.test.ts — bridge contact derives its own damage, validates frame/field, releases duplicates and revives via kind=0
- server/test/webclient.test.ts — legacy blank sword repair is opt-in/authenticated, emits native inventory and basis; damage trace exposes zero PAD
- server/test/webclient.test.ts — inline dialogue catalogue: normal item/skill icons, original names, no learned-skill or save mutation

## 預覽與存檔

目前沒有找到舊玩家 save，不冒稱恢復。可啟動 --save off 的全新空帳號記憶體世界，由使用者自行建角；重啟遺失進度，不會寫既有玩家存檔。實際在線狀態以 LIVE 程序為準。命令及警告見 README / TOOLCHAIN。
