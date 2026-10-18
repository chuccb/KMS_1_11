# 主動技能第一批：施放、七鍵、消耗、近戰、多段、增益與隊伍鏈

> **本輪續作（未測試）**：[NATIVE_RANGED_SKILLS](NATIVE_RANGED_SKILLS.md)／ADR-071新增三個遠距技能，合計十招；補多彈藥／Lucky Seven／真ball／攻速欄與武器失效／ACK時鐘。下文保留上一輪交付範圍，不把未開放的Booster／Magic Guard寫成已完成。

2026-10-18，ADR-070。**這輪未執行 test／check／typecheck／語法檢查／browser／VM／probe。**
只有原 C／listing／WZ 的靜態追查與程式實作；新回歸來源不是 PASS，LIVE 啟動也不是驗收。

## 已接通的範圍

| ID | 原 WZ 名稱 | 本輪路徑 |
|---|---|---|
| 1001003 | 아이언 바디 | 自身 PDD、MP、秒數、來源圖示、程序式 armor flash |
| 2001003 | 매직 아머 | 自身 PDD、MP、秒數、來源圖示、同一 armor flash；不是 Magic Guard |
| 3001003 | 포커스 | ACC／EVA、MP、秒數、原 effect／Use |
| 1101006 | 분노 | 隊伍 PAD 與負 PDD、MP、秒數；依原入口需在隊伍內，自己建一人隊亦可 |
| 1001004 | 파워 스트라이크 | 原武器近戰動作、每目標一段、WZ damage%、MP、effect／hit／Use |
| 1001005 | 슬래시 블러스트 | HP＋MP、普通近戰先命中才延伸 WZ range、最多六隻、原 damage%／effect／hit |
| 4001334 | 더블 스탭 | 只准 dagger33；stabO1／stabO2、武器 speed−1、WZ attackCount／damage%、MP／hit／Use |

這是嚴格 whitelist，不是「WZ 有節點就支援」：例如 `1301006` 有資料，卻不在本版
`518BF0` 的已定位 dispatch；沒有據此捏造 Iron Will 施放。Magic Guard 的 MP 轉移、Dark Sight、
Disorder 的怪物暫時能力、武器 booster、箭／飛鏢主動技能、魔法／瞬移／Heal／Final Attack 等仍未開放。
普通技能零號路徑的 `validatedBasicAttack` 保留原嚴格檢查；沒有拿放寬 guard 代替技能。

## 原版交叉證據與常數意義

| 證據 | 實作意義 |
|---|---|
| `518BF0` | dead 拒絕；4BDD20 讀已學等級；4BDDC0 預先扣 HP／MP，再依 skillId dispatch；失敗恢復。本重建改成**全部驗證後原子扣款**，不把失敗扣款留到下一包。 |
| `4BDDC0` | `hpCon >= HP` 拒絕；`mpCon > MP` 拒絕，最後一點 MP 可以消耗。itemCon 鏈未支援則拒絕，不能白用物品技能。 |
| `519270` | self buff 呼叫55D320，成功才50C460。沒有強制揮刀或額外施法 body action；其本身沒有梯繩拒絕，因此自身 buff 可在梯繩施放。 |
| `55D320` | c2s **30 decimal = 0x1E**；u32 skillId、u8 level、u8 recipientCount、u32 characterId[]；pending gate＋200ms。不是0x1D學習包、不是怪物ID。**續追更正**：55BEB0非零ACK也重設clock，見ADR-071；不是永遠只從send起算。 |
| `519950` | party存在才可施放；以施法者 `x/y ±50` 的 PtInRect 蒐集六格中的其他同圖隊友；右／下界不包含。伺服器再驗證隊伍／位置／生命，不相信任意 recipient。 |
| `5192B0`／`512F90`／`427F60` | prone 不准主動近戰；Double Stab 只准 dagger33，選16／17；其他兩招沿普通武器 action pool。 |
| `4BE8B0` | Double Stab 先將武器攻速值減一，然後扣 booster 值，再 clamp0..6；本批未啟用語意尚未完整的 booster。不是把 Double Stab 寫死為某個 speed。 |
| `512F90` | range 不為0時，先在原 Afterimage hit rect 找到一隻，才將遠邊延伸到 range，最多6隻；attackCount 缺失為1，最大15。不是直接放大整個框或上下左右同時乘倍率。 |
| `512F90 → 515CA0` | impact 為 raw release＋`min(targetIndex×70,280)`；身體仍逐格整數縮放、每格30ms換格。Server 排程與本機／remote 數字一起接，不把全動畫長度當出手點；4882F0的120×ordinal是character識別計算，不能當時間。 |
| `4C7960 LABEL_177` | damage% **在扣 PD 後、critical 前、最後1..9999 clamp前**。每目標預取七個 RNG 值，多段沿同一 cursor 繼續，不能每段再取七個。 |
| `522300` type1 | s2c **0x29**：u32 characterId、u8 type1、u32 skillId、**u8 level**，4BAC80→50C460。補齊遠端技能；type0升級保留。 |
| `50D570`／`50D9F0` | 已選level的marker優先，否則root；effect是loader建立的路徑，不是把BSTR內容當路徑。hit/0、hit/1是可隨機選的動畫，各自再包含canvas frames，不可把variant當frame。 |
| `46A9F0` delay 讀取分支 | 缺 delay 的原預設是 **120ms**，不是100／160／1000；保留 canvas a0／a1，以既有 animationFrame 做一次性 alpha 演算。 |
| `50C460` armor 分支 | 1001003／2001003 是程序式合成，不是 WZ 缺素材。400ms、InsertCanvas alpha212→0、vector 到3×；瀏覽器以施放時的 avatar 合成快照呈現白色擴張輪廓，仍有下述 Gr2D 界線。 |
| `527090`／`5095A0` | Skill.img/%07d/Use 與武器揮動聲有各自路徑，不以技能聲取代武器聲；分怒在本 WZ 沒有該 Use 節點，保留無聲，不拿別招補音效。 |
| `4C5DC0`／`4C65A0`／`4CBBD0` | 新增益逐欄替換，不相加、也不在到期後復活舊增益；now嚴格大於expiry才到期。圖示使用skill來源，不偽裝成消耗品。 |

### 數值與文字不能混為一談

原 `4BC590` level loader 的 `VariantChangeType(VT_I4)` 接受數值 BSTR。Data.wz 的
`3001003/level/20/acc` **確實是字串 `"20"`**，舊 SkillCatalog 只保留 JS number 會漏掉它。
這輪補十進位整數 BSTR 到數值（包含負數），亦用於前置等級；不解析 hs 文句來算傷害／消耗。

- Slash Blast20：hs 寫 MP14，但真正 `mpCon=15`、`hpCon=16`、`damage=130`、`range=150`。
- Focus20：hs 寫 MP18，但真正 `mpCon=16`、`acc="20"`、`eva="20"`、`time=300`。
- Iron Body20：`time=300`、`mpCon=10`、`pdd=40`。
- Magic Armor20：`time=400`、`mpCon=16`、`pdd=40`。
- Skill level/time 單位**秒**，轉成0x0D duration毫秒；Consume spec/time 本來就是**毫秒**，不可一起乘1000。

### 原本誤認的0x1F

最初相鄰函式 `55D5F0` 被誤認成技能取消；續追呼叫端是販售介面的數量確認，故未接成技能封包。
沒有把後期版本的 cancel opcode 硬套在本版。現階段不提供右鍵解除 buff 或虛構取消封包。
「動作中斷／逾期／換場／斷線」與「主動解除 buff」不是同一件事。

## 操作、隊伍與存檔

1. **K** 開原四列技能窗，學到的支援技能可雙擊列施放。
2. 從技能**圖示**拖到七個原快捷格：Shift／Insert／Home／PageUp／Delete／End／PageDown。
3. 快捷格可拖到別格覆蓋、拖到場景清除；不交換、不消耗、不從技能表刪技能。Escape／blur／modal／換場取消拖曳。
4. 技能 binding 用 `{kind:'skill',skillId}`；舊 numeric potion binding 原樣讀取。
   **魔法技能2001003與消耗品ID區間重疊**，因此不能只憑ID位數辨認技能或把藥水誤施放。
5. 快捷格保留原 icon 與 tooltip；未學 binding 灰顯，不能消耗MP；採同一個角色本機設定 key，不改存檔格式。
6. 隊伍走已有 `0x26`／`0x10`，補瀏覽器的名冊狀態、原式邀請確認、接受／拒絕／退出／解散／踢人：
   `/party create`、`/party invite Observer`、`/party leave`、`/party kick Observer`；
   亦接受原 `/파티만들기`、`/파티탈퇴`、`/파티초대 名稱`、`/파티강퇴 名稱`。
   `/party accept`／`decline` 是瀏覽器便利別名。拒絕只清本機邀請，原協定沒有新拒絕包。
7. 增益／消耗品的 runtime ledger 跨圖只重播**剩餘**duration，不重新給滿；不進持久存檔。
   本重建政策是死亡／登出／服務重開清除；死亡取消尚未結算的主動近戰，已承諾資源不退回。
8. 既有 `/tools` 是授權體驗配置，不是原轉職；可明確確認後配置職業／SP，於技能窗學習。
   本輪沒有自動重配／學技／補血／發裝，沒有重seed原有進度。

## 完整關聯鏈與重建政策

- browser→串行 movement flush→bridge 的真 WZ／已學等級／消耗／動作→原 TCP codec→game admission→扣款／排程→remote。
- JSON 不接受傷害、段數、技能等級或消耗；bridge 用原第一 RNG stream 算。
- 本機 active-hit 和普通攻擊一樣是預測：TCP沒有近戰admission ACK，server拒絕時不代表已造成傷害；不新增虛構原版ACK封包。
- TCP 仍是原本 client-reported damage 協定：server 驗各段0..9999、hits、max targets、唯一mobId、武器／姿勢／速度、資源、cooldown與位置。
  **這不是完整 authoritative combat 或正式反作弊。**
- 近戰 browser 用當前怪物 canvas RECT，候選先取近者再按native facing／x順序；完整 CShape2D pool 未移植。
- server 使用既有 x65／y100 容差框；world tick 可能把due延到下一tick，非原server精確時鐘。
- delayed hits 保留同一session／field／mob deaths世代；換場／斷線／死亡與respawn不會扣到新生怪。
- 冷圖載入採 bounded metadata、dedupe／abort／重試；新 look、field、local input epoch、死亡、modal、focus變更均重驗。
- 特效是有限 one-shot，保留原 start，晚載過期不重新播放；來源 ID／look／field守衛，沒有本地假buff或永久循環。

### 仍未達1:1的明確界線

- Canvas白色 armor mask／3×縮放對應原程序式分支，但瀏覽器合成、過濾與原 Gr2D 的 raster／blend／裁切並未逐像素驗證。
  續讀 Gr2D `10015290` 確認 InsertCanvas 的三個 VT_I4 參數保存進frame record；
  50C460呼叫傳入400／212／0，並非猜測的400ms／白輪廓opacity；白色過濾本身仍列為Canvas近似。
- hit canvas 以mob root向上20px呈現、多段數字間隔20px、128條效果資源上限、至少200ms的無圖音效載入期限是**重建政策**，不是原版確定常數。
- hit暫時先放在HUD之前的場景overlay，不聲稱已重現原mob child全部z排序；人物effect跟隨自身root，非全場最高z。
- buff受信任的runtime ledger與死亡清除、recipient拒絕整包、未結算技能死亡取消，均為伺服器安全政策；原server不存在於倉庫。
- 尚未支援未知temp bits、全部武器booster、怪物debuff、魔法／投射技能與手動解除。不能把「七個已實作」寫成「全技能完成」。

### level.effect 的續追結論（不是未解字串fallback）

重新讀4BC590，VARIANT只用來判斷屬性存在，再以**格式字串建立**路徑；原常數確是
`Skill/%03d.img/skill/%07d/level/effect`（沒有插入level數字），50D570取已選level的104欄，否則entry20欄。
因此不把level.effect的BSTR值當任意URL，也不擅自套入現代WZ的level-specific節點格式。
本批七招的level1沒有effect／hit marker，依原root路徑；盔甲兩招走程序式分支。
Power Strike `hit/0`，Slash Blast與Double Stab的`hit/0`、`hit/1`底下才是frames；
已把variant和frame分開，依50D9F0的rand()%count選動畫，用獨立視覺亂數，**不消耗傷害的七亂數stream**。

## 回歸來源與交付

新增 `server/test/active-skills.test.ts`，涵蓋原wire bytes／truncation／schema、HP與MP邊界、
BSTR／hs矛盾、真WZ選動作／速度／段數／六目標拒絕、damage百分比順序／七亂數cursor、
暫時能力替換／expiry、typed快捷binding／舊設定、原effect路徑／hit variants／音效節點。
**全部未執行**；亦未執行既有測試或歷史VM／probe，不能援用歷史PASS。

沿用 `generated/preview-faces-20261018.json`，先停舊LIVE冷備到 generated/backups，再用同檔重開8515／8516／8517。
提交用 `[skip ci]`、跳過hooks，僅推目前Arena分支；不更換分支，不force push。


本輪LIVE重開時沿用preview／observer的工具權限，僅供使用者手動配置／移圖，不自動執行：

```sh
source tools/env.sh
node server/src/cli.ts serve --host 0.0.0.0 --port 8516 --game-port 8517 --web-port 8515 \
  --data Data.wz --save generated/preview-faces-20261018.json \
  --account preview:preview,observer:observer --map-command preview,observer --test-tools preview,observer --ping off
```
