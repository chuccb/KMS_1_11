# 現行路線圖與已知缺口

更新：2026-10-24（ADR-161：strict map-command parsing／catalog validation；工具鏈 latest 核對無須升版）。瀏覽器 `client/` 是唯一客戶端主線（ADR-065）。
本頁列現況與優先序，不再累積多份「最新」、預估週數或未採用的引擎出口條件。
逐輪原版證據、歷史實測與改動界線保留在[文件索引](README.md)與 [ADR](DECISIONS.md)。
**有程式與回歸來源不代表已驗收。** 各輪strict／format／build與focused、完整suite記錄見 [社交指令鏈](NATIVE_SOCIAL_COMMANDS.md)與[角色互動續作](NATIVE_PLAYER_INTERACTIONS.md)；
**ADR-108 已將既有 44 項失敗全數結案（完整 1213 pass / 0 fail）**，不再是驗收阻擋項；未登入或操作LIVE角色。
全案TS／ESNext／Bun整理只剩 **`client/main.js` 一支未嚴格型別化**（ADR-109 已把 `client_probe.mjs` 遷為 `client_probe.ts`
並自 main.js 抽出 `client/inventory-window.ts`；ADR-156 抽出 strict browser WebSocket lifecycle／頂層 JSON envelope；ADR-157 將 `ClientEvent` → `t` 投影與 `WebClient.send` 收斂為 strict union；ADR-158 接上 selected inbound payload guards；ADR-159 guard Messenger；ADR-160 為 trade 定義無損 JSON projection 並 guard MiniRoom 全 union；ADR-161 抽出 strict map command／catalog boundary。現有 57 個已知 discriminator 全數 guard，但未識別 runtime `t` 仍 pass-through，故不是全事件 runtime schema；main 本體仍未型別化，靜態耦合普查表明需採門面分層逐領域搬移），
歷史native工具情境仍待完成，見 [BUN_MIGRATION](BUN_MIGRATION.md)。

## 最新增量：strict map commands 與 `/api/maps` 驗證（ADR-161）

`client/map-commands.ts` 接手 `/map`／`/warp`／`/go`／`/헉맵`、`/maps` 與 `/where` 的嚴格解析，保留本機 field／permission gate；數字必須是非負安全整數、符合 `0x0D` 的 s32 上限且不是無目的地 sentinel，map 0 仍有效。`client/map-constants.ts` 單一提供 `RETURN_MAP_NONE` 與上限，`server/src/game/map.ts` 仍 re-export 原常數。

`/maps` 在篩選／輸出前驗證 `/api/maps` 的 map ID 與名稱欄位符合 command wire policy；保留按 ID／名稱／區域名稱不分大小寫搜尋與最多 20 列顯示，對 HTTP／JSON／格式錯誤回傳明確訊息。新增 parser／search／malformed payload 測試，並用真 Data.wz HTTP endpoint、server policy 與 portal regressions 覆蓋跨層契約。focused **24/0、4 files**；完整 gates 見 [ADR-161](DECISIONS.md)。

## 前輪增量：strict server-to-browser JSON 訊息合約（ADR-157）

ADR-157 新增 `server/src/net/webclient-messages.ts`，把 `ClientEvent.kind` 一對一投影為 JSON `t` union，並納入 field capability flags、mob presentation／forced duration、登入／角色／建立／刪除、stat-basis、touch、attack-hit 與 test-tools 等 bridge 訊息；`clientEventJson` 保留每個 union discriminator，`WebClient.send` 不再接受 `unknown`。Touch result 也改成 success／rejection 互斥的 discriminated union。該 ADR 當時只做**編譯期約束**；ADR-158 後新增選定 runtime guards，但仍非所有 event 的深度 schema，也沒有聲稱 `client/main.js` 已 strict。

同日重新查 registry／GitHub latest：Bun 與 `@types/bun` 已由 **1.4.3 升至 1.4.4**，TS 7.0.2、Prettier 3.9.10、Playwright Core 1.64.1、Chromium tooling 153.0.0 仍為 latest；checkout v7.0.1／setup-bun v2.2.0 Actions 仍為 latest。新 Bun tarball SHA1／SHA512 與 registry metadata 相符，`bun install --frozen-lockfile --ignore-scripts` 27 installs／47 packages 無漂移；new-runtime strict typecheck／全範圍 format／build 通過，focused **44/0、4 files**，full suite **1468/0、5334 expects、170 files（345.05s）**。隔離測試，不登入／操作 LIVE 角色或存檔。驗證詳見 ADR-157 與工具鏈文件。

## 前輪增量：lossless trade projection 與 MiniRoom payload guard（ADR-160）

`client/trade-wire.ts` 定義 MiniRoom JSON DTO：cash block 的 `sn`／`unknown1A` u64 只在投影時以 `BigInt.toString(10)` 表示為 canonical 十進位字串，`unknown18` 保持 number、null 保持 null，原協定物件與存檔不改。browser `TradeState` 消費同一 wire type；server protocol path 使用明示的 `receiveProtocol` 投影，不把 raw BigInt 當成 browser event。

`client/trade-message-validation.ts` 驗證全部十種 MiniRoom event、參與者／房間索引、item kind／數值範圍與 cash-block u64 字串上下界；trade 加入 central guarded set，明列 gaps 歸零。現有 57 個已知 discriminator 全數有 guard；未識別 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard），故不是完整 runtime schema，`client/main.js` 仍未 strict 型別化。focused／完整驗證見 [ADR-160](DECISIONS.md)。

## 前輪增量：完成 Messenger inbound payload guard（ADR-159）

`client/messenger-message-validation.ts` 驗證全部八種 Messenger event、巢狀 participant／look 欄位與恰好三格 roster；`MESSENGER_ROOM_SIZE` 移至純共用常數，client state、protocol、server 與 guard 使用同一來源。Messenger 已自 explicit gaps 移除。該時點為 56 種 discriminator 有 guard、`trade` 唯一 gap；Type-11 cash-block BigInt 的 `JSON.stringify` 失敗已由隔離 peer regression 證實。ADR-160 已用不失真的十進位字串 projection 關閉該 gap。

未識別／未分類 runtime `t` 當時及現今都 pass-through（已知 `t: "unknown"` 有 guard）；完整歷史驗證見 [ADR-159](DECISIONS.md)。

## 前輪增量：選定 inbound payload guards 與 Bun formatter（ADR-158）

transport hook 現在在 envelope 驗證後執行 optional payload guard，拒絕或例外皆不傳入 `main.js`。`client/server-message-validation.ts` 對 server union 的大部分 message types 提供選定 guards，並在 compile-time 要求每個 discriminator 都被列入 guarded 或 gaps；實際覆蓋清單見 `SERVER_MESSAGE_VALIDATED_TYPES`。當時刻意保留 `trade`／`messenger` nested-union gaps，未識別／未分類的 runtime `t` 同樣 pass-through（已知 `t: "unknown"` 有 guard），不得稱為完整 runtime schema。

Bun 1.4.4 `bun fmt` 已作為正式 formatter；用鎖檔 Prettier 3.9.10 作一次遷移比較，438 個格式輸入逐檔 byte-identical 後移除 Prettier direct dependency。測試／typecheck／build 結果與工具鏈比較見 [ADR-158](DECISIONS.md)／[TOOLCHAIN](TOOLCHAIN.md)。

完整現況分類、程式入口、歷史缺口更正與後續順序，見[與原版差異總盤點](ORIGINAL_PARITY_AUDIT.md)（初始基準4f9ad1b，A類含ADR-078更新）。

## 已有實作，仍需按各文件界線看待

新增：怪物／玩家物品／金幣使用真fh權威落點，移除動畫16px跳位，真PNG底部貼地。
全100張原圖379422組與DPR1／2 component通過，非官方server選點算法的聲稱；見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。

| 範圍 | 現況入口 |
|---|---|
| 角色右鍵／人氣／密語／隊長邀請 | [原角色互動](NATIVE_PLAYER_INTERACTIONS.md)：原WZ／UnionRect／送出與回覆／綁定modal；權威inviterId核對與舊附接端invite／accept停用 |
| 原社交指令（`/파티정보`等五條＋`/귓속말`／`/찾기`）、名冊六格、邀請所有權 | [原社交指令鏈](NATIVE_SOCIAL_COMMANDS.md)：原送出前检查搬回client、斜線行不再落公開聊天、`524A00`密語闸門；這版GameMenu無party窗分支（原證），交易房／Messenger／人物資訊id0仍未完成 |
| 原Notice/OK與六列loot／EXP訊息 | [原訊息呈現](NATIVE_FEEDBACK.md)：真type1 modal、整數fade、共同名稱cache／音效／生命週期；非GDI逐像素或全UI管理器 |
| 可選本機物理步長／插值、十種鏡頭 | [手感實驗](MOTION_EXPERIMENTS.md)，明示非原版；預設30ms不變 |
| 普通地空力學／有向整數地形／物理場界／繩梯／30ms有序wire | [普通力學](NATIVE_LOCOMOTION.md)與[有向整數地形／物理場界](NATIVE_TERRAIN.md)，非完整CVecCtrl |
| 怪物主動攻擊／MP／effect-ball-hit／攻擊中KB／晚進場body | [原證與server政策](NATIVE_MOB_ATTACKS.md)，非完整owner AI；含唯讀原素材閱覽 |
| 穿戴需求／正反swap／原子換裝／最低級準備／攻擊關聯時鐘 | [原證與未測試界線](NATIVE_EQUIP_ADMISSION.md) |
| 12個主動技能／七鍵／多彈藥／兩魔法／增益與隊伍 | [遠距與攻速界線](NATIVE_RANGED_SKILLS.md)、[魔法](NATIVE_MAGIC_SKILLS.md)、[第一批](ACTIVE_SKILLS.md)，非全技能完成 |
| 原協定、登入／選角／建刪角、原版 WZ 畫面 | [server](../server/README.md)、[CLIENT](CLIENT.md)、[FINDINGS](protocol/FINDINGS.md) |
| 地圖／背景／角色／怪物、左右朝向、繩梯與傳送、BGM／音效 | [地圖](MAP_MOVEMENT_VALIDATION.md)、[動作音訊](CLIMB_AUDIO_VALIDATION.md)、[門與登台](PORTAL_CLIMB_VALIDATION.md) |
| 分層、普通跳躍怪、攻擊合成、移動雲 | [圖層](NATIVE_LAYER_PRIORITY.md)、[跳躍／攻擊／背景](NATIVE_JUMP_ATTACK_BACKGROUNDS.md) |
| Stat／有效裝備／普通傷害、成長／AP、技能書／SP、部分被動 | [數值](NATIVE_STATS_COMBAT.md)、[裝備鏈](NATIVE_EQUIPMENT_DAMAGE_FIX.md)、[成長](STAT_GROWTH.md)、[技能](SKILLS.md) |
| 背包／穿脫／丟棄／商店／補充、消耗品與部分暫時能力 | [道具操作](INVENTORY_OPERATIONS.md)、[補充](MESO_RECHARGE.md)、[temp](TEMPORARY_STATS.md) |
| 受擊／死亡／復活、HUD／小地圖／聊天／快捷道具 | [死亡](NATIVE_DEATH_ANIMATION.md)、[HUD](NATIVE_HUD_CHAT_QUICKSLOTS.md)、[小地圖](DISPLAY_MINIMAP_VALIDATION.md) |
| 系統選單／設定、游標、NPC controller／對話圖文、三類 tooltip | [選單](NATIVE_SYSTEM_UI.md)、[NPC](NATIVE_NPC_BEHAVIOR.md)、[圖文](NATIVE_DIALOGUE_RICHTEXT.md)、[tip](NATIVE_RICH_TOOLTIPS.md) |
| 蹲下／蹲刺／警戒、攻擊雙時鐘、恢復body ID、被動射程／原常數分類 | [姿勢與攻擊鏈](NATIVE_POSTURE_ATTACK.md)，完整幾何／技能仍缺 |
| 普通身體動作／WZ序列／原武器姿勢／繩梯停格 | [普通動作](NATIVE_AVATAR_MOTION.md)，有唯讀閱覽；非完整CVecCtrl |
| 臉部獨立時鐘／眨眼／F鍵／101臉飾／remote attr2 hit | [臉部證據與界線](NATIVE_FACE_ANIMATION.md)，沒有改全部原生movement幾何 |
| 方便體驗入口 | [非原版工具](RECOVERY_TEST_TOOLS.md)，唯讀範例與授權寫入操作分開 |

## 優先序 1：繼續真正的嚴格 TypeScript 遷移

- 使用者目前要求全案乾淨易讀、只用最新版TS／ESNext／Bun。**ADR-109 已處理 client_probe（→ `.ts`）並從 main.js
  抽出背包視窗幾何**、ADR-110 續抽商店視窗幾何並把兩模組引用的原版 `sub_` 證據逐條回讀 `MapleStory.exe.c`／`Data.wz` 交叉確認（剔除查無實據的 `sub_4AC3A0`）**；ADR-156 已抽出 WebSocket transport 與頂層 JSON discriminator 守衛，main.js（5529 行）本體仍需逐領域門面分層與實作型別，不只改名、不以 `any` 包住。
  靜態耦合普查（321 個 top-level 宣告中僅 3 個零耦合）已列為分層順序的依據，見 [BUN_MIGRATION](BUN_MIGRATION.md)。
- frame／play已strict TS實作遷移，真RAF／畫布來源與有界keyboard計畫見 [工具續作](STRICT_FRAME_PLAY_TOOLS.md)；不對玩家執行手動工具。
- 7支browser工具的明示admission與typed觀測、NPC/mob素材及look已拆出；手動登入／角色情境未替使用者執行，見[本輪整理](STRICT_BROWSER_TOOL_MIGRATION.md)。
- 逐項追查44失敗及typed whisper歷史native admission情境；不能改skip、刪斷言或降低strict掩蓋問題。
- HTTP／WebSocket其餘資料邊界仍須逐一審核；strict compile不等於所有payload已驗證。

## 優先序 2：持續原版差異修復

- 依原碼／listing／WZ 追查角色與怪物移動、繩梯、攻擊、時序、相機、圖層與音訊的實際差異。
- 補完整 CVecCtrl／CShape2D 的已證分支；不能把現有近似當成全域原30ms時鐘或完整幾何。
- NPC sender+2／receiver raw 的矛盾仍保留；不以隨機本地演出冒充原 server 同步。
- 字型與 tooltip 等 UI 保持原素材／座標／實例資料，不以 CSS 美化、後期資源或缺素材 fallback 代替。
- 每項有證據入口、實作／unknown／重建政策與取消／過期邊界；不因有某個 codec 就聲稱整個玩法完成。

## 優先序 3：未接通的玩法

- 主動技能白名單已接12招（7首批＋3遠距＋2魔法）及七鍵／消耗／多段／多彈藥／buff／party，見[遠距](NATIVE_RANGED_SKILLS.md)與[魔法](NATIVE_MAGIC_SKILLS.md)；續補其餘技能／Magic Guard／booster施放幅度／mob debuff與手動解除，其餘被動逐條還原。
- 自然 AP／SP、原轉職流程與加成；資料未定位不套慣見5／3或後期規則。
- 卷軸、cash／pet、完整怪物owner攻擊 AI／狀態機、monster skill、飛行／仇恨等分支；基本active metadata與呈現已接，不代表全AI完成。
- 原 quest／taxi／trunk scripts：原 server 腳本缺證據，不自創價格／路線／任務。
- 組隊已接指令／名冊（固定六格）／原式邀請與Rage收件者；這版原檔的GameMenu沒有party視窗分支，`/파티정보`是本機印名冊，故不补后期样式窗。交易／Messenger等完整瀏覽器UI仍待接通。

## 優先序 4：工程整理與營運基礎

- 將大型 main 的責任逐步拆分；display lifecycle、image cache、entity assets／look已抽成TS並回歸，主整合入口仍未typed，不能只rename或降低strict。
- 未來抽出 server／browser 共用純規則；目前共用檔仍在 client，架構文件不隱瞞。
- 維持正式版工具鏈的明確版本檔／lock／CI 一致，不把升級或成功啟服視為相容性證明。
- 效能改善須定位實際熱點；不為「前沿」直接改成另一套引擎或 GPU 架構。
- 正式多人營運前，另做持久化交易、帳號安全、TLS、備份恢復、監控、容量與反作弊評估。
- 跨平台目前為桌面瀏覽器方向；原生安裝包、手機觸控與手把不冒稱已支援／驗收。

## 每輪交付要求

1. 先查原證據，再寫實作；新規則標明重建政策，unknown 不變成事實。
2. 實例、模板、資源 cache、連線／modal／場地生命週期分清，舊 response 不得復活舊操作。
3. 不自動修改角色，不以新 save／QA fixture 冒充舊進度；停服冷備才能恢復同檔。
4. 依後續授權可執行完整型別／格式／單元／建置及唯讀browser檢查；仍不自動登入LIVE、操作角色／save或跑手動state-changing probe。
5. 維護回歸來源與文件，但未執行就是未執行；歷史 PASS 不可挪用。
6. 只非force推目前Arena分支，不用skip CI掩蓋失敗；提供可用LIVE，保護既有程序與存檔，缺存檔須明示。
