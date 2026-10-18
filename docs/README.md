# 文件索引

從[根 README](../README.md)開始操作。本頁區分現行方向、原版證據、功能交付與歷史驗證，
避免把早期方案／測試數字／某輪缺口誤認為現在狀態。

## 現行方向與開發

| 文件 | 用途 |
|---|---|
| [ARCHITECTURE](ARCHITECTURE.md) | 實際瀏覽器／Node資料流、目錄、共用規則與技術債 |
| [ORIGINAL_PARITY_AUDIT](ORIGINAL_PARITY_AUDIT.md) | 對原版的現行差異／部分完成／未接／未知總盤點、程式入口與優先序（基準4f9ad1b；未執行驗證） |
| [ROADMAP](ROADMAP.md) | 現況入口、未完成玩法、工程優先序與交付界線 |
| [REBUILD_PRINCIPLES](REBUILD_PRINCIPLES.md) | 原檔／listing／WZ證據優先序、保護規則與研究入口 |
| [TOOLCHAIN](TOOLCHAIN.md) | 最新正式版鎖定、安裝／啟用、CI與未驗證風險 |
| [DECISIONS](DECISIONS.md) | ADR沿革；現行技術主線見065、工具鏈見066、臉部／新隔離體驗見067、普通動作見068、蹲刺／時序／射程見069，舊編號不重編 |
| [server README](../server/README.md) | CLI、模組、協定／保存細節與歷史結果 |
| [CLIENT](CLIENT.md) | 瀏覽器操作、各輪功能與界線；歷史「最新」不能蓋過後續更正 |
| [RECOVERY_TEST_TOOLS](RECOVERY_TEST_TOOLS.md) | 非原版體驗工具、唯讀UI範例、授權寫入與還原點保護 |

## 原版資料與協定

- [FINDINGS](protocol/FINDINGS.md)：封包與反編譯發現，區分已知／partial／unknown。
- [WZ1_FORMAT](WZ1_FORMAT.md)：容器、字串、值層、canvas、解壓與reader更正。
- `../analysis/`：manifest、RTTI、sample屬性；原檔仍在repository根目錄，不搬動證據路徑。
- [字型來源與授權](../client/fonts/README.md)：合法本地fallback，不宣稱原GDI像素等價。

## 功能交付與證據（近期來源未執行驗證）

| 主題 | 文件 |
|---|---|
| 怪物主動攻擊／MP／楔形射程／原hit回呼／攻擊中KB與唯讀閱覽 | [NATIVE_MOB_ATTACKS](NATIVE_MOB_ATTACKS.md) |
| 怪物KB／NPC名牌與forced方向／冷氣泡readiness | [NATIVE_MOB_KB_NPC_STATE](NATIVE_MOB_KB_NPC_STATE.md) |
| 原武器殘影／mastery tier／命中點與world FX | [NATIVE_ATTACK_EFFECTS](NATIVE_ATTACK_EFFECTS.md) |
| 兩招獨立魔法／原動作、MD與元素／foothold與彈道／120ms多段更正／MAD與EVA/PDD消費鏈 | [NATIVE_MAGIC_SKILLS](NATIVE_MAGIC_SKILLS.md) |
| 穿戴原順序／server需求與原子換裝／明確最低級準備／主動時鐘與remote身份 | [NATIVE_EQUIP_ADMISSION](NATIVE_EQUIP_ADMISSION.md) |
| 本機姿勢／蹲刺／警戒／攻擊雙時鐘／恢復編碼／射程與硬編碼分類 | [NATIVE_POSTURE_ATTACK](NATIVE_POSTURE_ATTACK.md) |
| 普通身體動作／武器walk/stand／繩梯停格／唯讀閱覽 | [NATIVE_AVATAR_MOTION](NATIVE_AVATAR_MOTION.md) |
| 臉部獨立動畫／眨眼／F鍵／臉飾／遠端受傷 | [NATIVE_FACE_ANIMATION](NATIVE_FACE_ANIMATION.md) |
| 原tooltip三類版型／實例需求／技能當前下一級 | [NATIVE_RICH_TOOLTIPS](NATIVE_RICH_TOOLTIPS.md) |
| NPC圖文／選項／資源生命週期 | [NATIVE_DIALOGUE_RICHTEXT](NATIVE_DIALOGUE_RICHTEXT.md) |
| NPC metadata／controller／未解索引矛盾 | [NATIVE_NPC_BEHAVIOR](NATIVE_NPC_BEHAVIOR.md) |
| NPC原對話／五種body | [NATIVE_NPC_DIALOGUE](NATIVE_NPC_DIALOGUE.md) |
| 游標／命中框／原tip frame | [NATIVE_CURSOR_NPC_POINTER](NATIVE_CURSOR_NPC_POINTER.md) |
| 系統選單／設定／道具快捷操作 | [NATIVE_SYSTEM_UI](NATIVE_SYSTEM_UI.md) |
| GameOpt／聊天／找人與密語 | [NATIVE_GAME_OPTIONS_CHAT](NATIVE_GAME_OPTIONS_CHAT.md) |
| HUD／聊天記錄／道具快捷格 | [NATIVE_HUD_CHAT_QUICKSLOTS](NATIVE_HUD_CHAT_QUICKSLOTS.md) |
| 原圖層／組圖／殘影／深度 | [NATIVE_LAYER_PRIORITY](NATIVE_LAYER_PRIORITY.md) |
| 跳躍怪／攻擊動作／移動背景 | [NATIVE_JUMP_ATTACK_BACKGROUNDS](NATIVE_JUMP_ATTACK_BACKGROUNDS.md) |
| 基本攻擊／投射物／選彈 | [BASIC_ATTACKS](BASIC_ATTACKS.md) |
| 裝備能力／傷害鏈修補 | [NATIVE_EQUIPMENT_DAMAGE_FIX](NATIVE_EQUIPMENT_DAMAGE_FIX.md) |
| 有效能力／Detail／普通物理 | [NATIVE_STATS_COMBAT](NATIVE_STATS_COMBAT.md) |
| HP／MP成長與AP | [STAT_GROWTH](STAT_GROWTH.md) |
| 遠距階段十招／七鍵／多彈藥／Lucky Seven／攻速消費鏈（後接兩魔法共12招） | [NATIVE_RANGED_SKILLS](NATIVE_RANGED_SKILLS.md)、[第一批七技](ACTIVE_SKILLS.md) |
| 技能書／SP／前置與滿級 | [SKILLS](SKILLS.md) |
| 暫時能力／消耗品 | [TEMPORARY_STATS](TEMPORARY_STATS.md) |
| 受擊／擊退／復活 | [NATIVE_CONTACT_REVIVE](NATIVE_CONTACT_REVIVE.md) |
| Tomb／ghost／死亡時序 | [NATIVE_DEATH_ANIMATION](NATIVE_DEATH_ANIMATION.md) |
| 背包／丟棄／商店數量 | [INVENTORY_OPERATIONS](INVENTORY_OPERATIONS.md) |
| 楓幣／飛鏢補充 | [MESO_RECHARGE](MESO_RECHARGE.md) |

## 特定提交的歷史驗證紀錄

以下保留方法、結果與差異清單；**不代表目前提交或新工具鏈已通過**，頁內缺口可能已由後續ADR更正：

- [MAP_MOVEMENT_VALIDATION](MAP_MOVEMENT_VALIDATION.md)：地圖reader／移動與原資料。
- [CLIMB_AUDIO_VALIDATION](CLIMB_AUDIO_VALIDATION.md)：繩梯組圖／BGM／音效。
- [FACING_SELECTION_VALIDATION](FACING_SELECTION_VALIDATION.md)：左右朝向／世界選角。
- [CREATION_VALIDATION](CREATION_VALIDATION.md)：建角／刪角流程。
- [SMOOTH_STAT_VALIDATION](SMOOTH_STAT_VALIDATION.md)：流暢度／Stat／AP。
- [PORTAL_CLIMB_VALIDATION](PORTAL_CLIMB_VALIDATION.md)：傳送門／繩頂登台／地圖命令。
- [DISPLAY_MINIMAP_VALIDATION](DISPLAY_MINIMAP_VALIDATION.md)：DPR清晰縮放／小地圖。
- [EQUIPMENT_VALIDATION](EQUIPMENT_VALIDATION.md)：裝備窗／穿脫與外觀。

近期另已補臉部完整鏈與經同意的全新隔離體驗；見ADR-067，不以舊PASS代替驗證，不冒充恢復進度。
