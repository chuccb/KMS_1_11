# 現行路線圖與已知缺口

更新：2026-10-18。瀏覽器 `client/` 是唯一客戶端主線（ADR-065）。
本頁列現況與優先序，不再累積多份「最新」、預估週數或未採用的引擎出口條件。
逐輪原版證據、歷史實測與改動界線保留在[文件索引](README.md)與 [ADR](DECISIONS.md)。
**有程式與回歸來源不代表已驗證；近期改動與工具鏈升級未執行測試。**

## 已有實作，仍需按各文件界線看待

| 範圍 | 現況入口 |
|---|---|
| 原協定、登入／選角／建刪角、原版 WZ 畫面 | [server](../server/README.md)、[CLIENT](CLIENT.md)、[FINDINGS](protocol/FINDINGS.md) |
| 地圖／背景／角色／怪物、左右朝向、繩梯與傳送、BGM／音效 | [地圖](MAP_MOVEMENT_VALIDATION.md)、[動作音訊](CLIMB_AUDIO_VALIDATION.md)、[門與登台](PORTAL_CLIMB_VALIDATION.md) |
| 分層、普通跳躍怪、攻擊合成、移動雲 | [圖層](NATIVE_LAYER_PRIORITY.md)、[跳躍／攻擊／背景](NATIVE_JUMP_ATTACK_BACKGROUNDS.md) |
| Stat／有效裝備／普通傷害、成長／AP、技能書／SP、部分被動 | [數值](NATIVE_STATS_COMBAT.md)、[裝備鏈](NATIVE_EQUIPMENT_DAMAGE_FIX.md)、[成長](STAT_GROWTH.md)、[技能](SKILLS.md) |
| 背包／穿脫／丟棄／商店／補充、消耗品與部分暫時能力 | [道具操作](INVENTORY_OPERATIONS.md)、[補充](MESO_RECHARGE.md)、[temp](TEMPORARY_STATS.md) |
| 受擊／死亡／復活、HUD／小地圖／聊天／快捷道具 | [死亡](NATIVE_DEATH_ANIMATION.md)、[HUD](NATIVE_HUD_CHAT_QUICKSLOTS.md)、[小地圖](DISPLAY_MINIMAP_VALIDATION.md) |
| 系統選單／設定、游標、NPC controller／對話圖文、三類 tooltip | [選單](NATIVE_SYSTEM_UI.md)、[NPC](NATIVE_NPC_BEHAVIOR.md)、[圖文](NATIVE_DIALOGUE_RICHTEXT.md)、[tip](NATIVE_RICH_TOOLTIPS.md) |
| 臉部獨立時鐘／眨眼／F鍵／101臉飾／remote attr2 hit | [臉部證據與界線](NATIVE_FACE_ANIMATION.md)，沒有改全部原生movement幾何 |
| 方便體驗入口 | [非原版工具](RECOVERY_TEST_TOOLS.md)，唯讀範例與授權寫入操作分開 |

## 優先序 1：持續原版差異修復

- 依原碼／listing／WZ 追查角色與怪物移動、繩梯、攻擊、時序、相機、圖層與音訊的實際差異。
- 補完整 CVecCtrl／CShape2D 的已證分支；不能把現有近似當成全域原30ms時鐘或完整幾何。
- NPC sender+2／receiver raw 的矛盾仍保留；不以隨機本地演出冒充原 server 同步。
- 字型與 tooltip 等 UI 保持原素材／座標／實例資料，不以 CSS 美化、後期資源或缺素材 fallback 代替。
- 每項有證據入口、實作／unknown／重建政策與取消／過期邊界；不因有某個 codec 就聲稱整個玩法完成。

## 優先序 2：未接通的玩法

- 主動技能：施放、快捷綁定、MP、動作／特效／命中／傷害與 buff／解除；其餘被動效果逐條還原。
- 自然 AP／SP、原轉職流程與加成；資料未定位不套慣見5／3或後期規則。
- 卷軸、cash／pet、完整怪物攻擊 AI、飛行／仇恨等分支。
- 原 quest／taxi／trunk scripts：原 server 腳本缺證據，不自創價格／路線／任務。
- 交易／組隊／Messenger 等部分已有 server／codec，但完整瀏覽器 UI／流程仍待接通。

## 優先序 3：工程整理與營運基礎

- 將大型 main 的責任逐步拆分；先明確邊界，不做未驗證的大規模搬檔。
- 未來抽出 server／browser 共用純規則；目前共用檔仍在 client，架構文件不隱瞞。
- 維持正式版工具鏈的明確版本檔／lock／CI 一致，不把升級或成功啟服視為相容性證明。
- 效能改善須定位實際熱點；不為「前沿」直接改成另一套引擎或 GPU 架構。
- 正式多人營運前，另做持久化交易、帳號安全、TLS、備份恢復、監控、容量與反作弊評估。
- 跨平台目前為桌面瀏覽器方向；原生安裝包、手機觸控與手把不冒稱已支援／驗收。

## 每輪交付要求

1. 先查原證據，再寫實作；新規則標明重建政策，unknown 不變成事實。
2. 實例、模板、資源 cache、連線／modal／場地生命週期分清，舊 response 不得復活舊操作。
3. 不自動修改角色，不以新 save／QA fixture 冒充舊進度；停服冷備才能恢復同檔。
4. 依使用者要求不自動執行 test／check／typecheck／語法檢查／browser／VM／遊戲 probe。
5. 維護回歸來源與文件，但未執行就是未執行；歷史 PASS 不可挪用。
6. `[skip ci]` 提交，只非 force 推目前 Arena 分支；提供可用 LIVE，若存檔缺失須明示並先恢復資料。
