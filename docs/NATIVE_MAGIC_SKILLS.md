# 原初階攻擊魔法、命中時鐘與藥水完整鏈

2026-10-18，ADR-073。**未執行 test／check／typecheck／語法檢查／browser／VM／probe。**
本文件的原證來自倉庫 C、listing、PE 表與 Data.wz 靜態讀取；新增回歸來源不是 PASS，啟服也不是驗收。

## 本輪範圍

- 2001004 **에너지 볼트（Energy Bolt）**：一個目標、一段、真 WZ ball、Use／hit、MP、魔法公式。
- 2001005 **매직 클로（Magic Claw）**：一個目標、兩段、真 WZ effect／hit、MP、前置 Energy Bolt1；**沒有 ball**，不拿箭／飛鏢代替。
- 既有十招保留，加上兩招共十二招；不是全技能／全魔法完成。Magic Guard、Teleport、Heal、怪物魔法攻擊、Booster 施放與手動解除仍未開放。
- 同一追查修正既有多段技能的 **120ms × 段序**、30px 數字層距、每段命中特效及 MISS 不播技能 hit art。
- 接通 **MAD 藥水**；修正已有 EVA／PDD 讀取器與實際 use-item 入口的欄位落差，使用共用清單並完成原子扣物／回包。

## 1. 原入口、姿勢與動作表

`518BF0 → 5195D0 → 514D30`，不是物理／射擊改名。

- 已學等級、WZ cost、HP 必須嚴格大於 hpCon、MP 可以等於 mpCon；失敗不付資源。
- `5195D0` prone 退普通 `512F90`；因此 browser 送普通 skillId0／action32，**不送免費 magic32**。
- `514D30` 要求 `CVecCtrl +112` 的 foothold 指標非零。`537260` 的初始化與相鄰落地路徑寫入此指標，並從 foothold+28/+32 取 page/group。
  不是猜測的「魔法可空中施放」：browser grounded、bridge 的 movement foothold、game 的實際 map foothold 存在性都檢查。
- ladder／rope／dead 與既有 forced-body 閘門拒絕；資產 await 後重驗姿勢、ground、field、look、角色、快捷級別、資源與輸入 epoch。
- `428040` 的 PE **5B2374**：7 組 × 2 列 × 3 dword（count＋兩個 action）。只在 `skillType==3` 時取奇列，否則偶列。

| attack group | normal row | skillType3 row |
|---|---|---|
| 1 | count2，28／29 | 空 |
| 2／3／4／5 | 空 | 空 |
| 6 | count2，28／29 | 空 |
| 7 | 空 | 空 |

`43FC80` 的實際 alias：**28=swingO1，29=swingO3**。不是 magic1／magic2，也不是 heal／fly。
Data.wz 的原 body、weapon 都供應相應 swing 姿勢；不造素材、不借其他武器。
兩招沒有 skill afterimage；`50DD40` 取 skill afterimage，不能以普通武器殘影補空。

`514D30 / listing514DDA..514DE8` 直接將 avatar+152 的 WZ attackSpeed 交給508690；
**不套物理 Booster／Double Stab 扣速**。508700 自己 clamp0..6、逐格整數縮放；body 仍走既有30ms換格。

## 2. 範圍、命中點、彈道與牆

- `514D30`：搜尋從 X±**50** 到 X±**300**，基準 Y−**25**。
- 續讀 `491F20` 更正最初「細水平 ray」描述：每 **20px** 一片，半高為 `trunc(距施法者距離/4)`；第一片半高12、最後72。
- browser 用這些逐步擴高的 RECT 對當前 WZ mob bounds 選第一隻，不用物理 Afterimage 近戰框，也不設射手的「近身退揮刀」。
- `485B80`：細 ray 先延伸到與選中 mob RECT 重疊，再取交集中心，作為**命中點**。
  magic `0x11` 的 x/y 報告此點，不冒充 monster root；本機預測與 server travel 共用它。
- `514BA0`：level 的 ball marker 有效才取 loader-built level/ball 路徑，否則 root/ball。
- 有 ball 才呼 `564600`：從**人物 X、Y−25** 到命中點做有向 foothold ray，非只擋垂直牆；
  positive-x floor／非floor group 篩選、交叉側、prev／next 接點、最近交點與 trunc 全部共用 `clipMagicRay`。
  `5643D0` 證明 foothold+48 是 dx/length；563... loader 的第二層 key 存+32，與 CVecCtrl+128 的 group 相同。
  被擋就清目標，但仍有空施法／MP／飛到阻擋點的 ball。無 ball 的 Magic Claw **不走牆檢查**。
- 發射點 X±50、Y−25；travel=`trunc(distance × 1.5)`；空施放遠端是±300，不是 near+300。
- 無 ball 的 Magic Claw 於 raw release 命中，**沒有箭矢 fallback 或額外 travel**。
- `41BF60` 的 atan2 向量旋轉與 native預設120ms ball frames 沿用既有共用 projectile renderer。
- 空施放、MISS 都會付 MP，一次施放只付一次；多段不重扣，也不消耗 ammo。

## 3. 獨立 4C89D0 公式與元素

`nativecombat.ts/rollNativeMagic` 沒有套物理 PAD／ACC／damage%／PD／critical／傷害等級百分比。

```
MAD = clamp(baseMAD + temporaryMAD, 0, 999)
accuracy = (7*trunc(LUK/10) + 3*trunc(INT/10))*100
           / (255 + 10*max(mobLevel-characterLevel,0))
hitRoll = uniform(accuracy*.4, accuracy*.8)
hitRoll < clamp(mobEVA,0,999) => MISS0
factor = (level.mastery*5 + 10)*.009000000000000001
raw = (INT + 3*uniform(MAD, MAD*factor))*level.mad*.01
raw = native element operation(raw)
damage = trunc(clamp(raw - uniform(MD*.5,MD*.6), 1, 9999))
```

- INT、LUK 是原有效裝備集合的 basic 值；MAD 是能力與裝備 incMAD＋暫時 MAD，MD 讀原 **info.MD**，不讀後版 MDDamage。
- 每目標先預取七字 RNG；每段沿同一循環 cursor，不能逐段再 seed 七字。
- **listing 4C8B6D 只有一次 inc**：MISS 消耗1個 slot、成功消耗3個。最初研究的「MISS2／成功4」假設已排除，沒有寫入實作。
- `4BE150` 共用 parser：P/I/F/L/W/H/D/U 八槽、大小寫、十進位、無數字或0→999、重複覆寫、未知字元讓 loader 拒絕。
- `4C89D0` 無條件以 mob P 為起點，再只對 skill 槽值999的 **I..D（1..6）**取 mob 值最大。
  U 會解析，但這段公式**沒有取 U**。值1×.5，值2×1.5且最多9999；其他不乘。
  沒有把999猜成免疫，也沒有用後版元素語意換掉這版出乎意料的 P 基值。
- 兩招 root 的 skillType 預設0、元素槽全0；不是因為 skill book200 就猜元素。

WZ 實值：Bolt1 mpCon7／mad12／mastery1，Bolt20 mpCon14／mad50／mastery10；
Claw1 mpCon10／mad6／attackCount2，Claw20 mpCon20／mad35／attackCount2；前置 Bolt1。
ball／effect／hit 缺 delay 的原預設120ms，不解析 hs 文案作算式。

## 4. 120ms 多段時鐘：明確更正舊結論

舊 ACTIVE_SKILLS 的「4882F0 的120×ordinal不是時間」**錯誤且已更正**。

- `4882F0` 寫 DAMAGEINFO[0]=impact+120×ordinal。
- **listing4863C8..4863CD** 用世界時鐘減此欄，未到期跳過；486404呼487A30。
- `487A30` 數字 y=`mobY - 30*ordinal - mobTop`；ArgList>0 才畫 skill hit art。
- 共用 `attackHitDelay` 接本機、remote、server 的已開放近戰／遠距／魔法多段；每段各選 hit variant，MISS不畫技能 hit 特效。
- 數字／hit effect 仍以原攻擊 start＋raw release＋travel／target offset＋120×ordinal，而非 bridge 回覆後重新起鐘。
- GameEntry 先 relay／付一次資源，再逐段 queue；每一段保留 session、field、mob deaths 世代，死亡／換場／斷線／respawn 不傷新對象。
  **把 HP／掉落／EXP 結算也對齊這個時鐘是重建政策**，不是已知原 server 規則。

## 5. 封包、旁觀者與狀態生命週期

完整鏈：K學習／雙擊或七鍵 → 資產與姿勢重驗 → movement flush → active-magic JSON → bridge計算 → **0x11** →
獨立magic admission → cost、cooldown、pending hits／persist → **0x25** → remote renderer。

- 0x11共用原 attack codec，但**沒有0x10的USE slot u16**；0x25共用既有user attack reader。
- JSON 不接受 damage、等級、段數、消耗；native TCP 仍為 client-reported damage，本重建並非完整 authoritative combat。
- 基本／近戰／遠距 admission 不放寬；未知技能、魔法塞0x0F／0x10、錯動作／速度／段數／武器／資源不會繞過。
- remote 離場同 ID、換 look、冷載入、死亡、field epoch 都保留前輪守衛；source／group／z／目標 RECT 在 await 前捕捉。
- 不是魔法就播武器聲；magic 用技能 Use，不附加假的 sword／wand Attack 音。
- 原 start 不重設；過期 body／聲音／one-shot 不重播，飛彈保留來源 root z 與固定終點。
- hit art 綁 mob 實體。magic 依捕捉命中點的 mob-relative offset，其他歷史技能仍保留原明列的root−20政策。
- 無新的 native admission ACK；active-hit仍是 bridge **預測**，沿既有 token 與 TTL／clear 機制。server若拒絕／剔除目標，預測不等同已造成傷害。

## 6. 消耗品欄位漏接與原子生命週期

停舊 LIVE 時的現存日誌顯示2002000反覆被拒絕；靜態追查：reader已接 eva/pdd，但handleUseItem只轉speed/pad/acc。
不是 WZ 缺料，也不是玩家操作錯誤。

現在 reader 與 `consumeTemporary` 共用 `TIMED_CONSUME_FIELDS`：speed／pad／mad／acc／eva／pdd；
EVA/PDD 原既有碰撞公式確有消費者，MAD由本輪魔法公式消費。MDD／其他未知機制仍拒絕整個混合道具，不燒掉半套。

| 道具 | 原 spec | 這輪入口 |
|---|---|---|
| 2002000 | EVA+5／180000ms | 修通原迴避藥水到0x0D／ledger／碰撞 |
| 2002002 | MAD+5／180000ms | 新魔法傷害、Detail、原物品來源圖示 |
| 2002003 | MAD+10／300000ms | 同欄替換，不把兩瓶相加 |
| PDD規格道具 | 讀真spec | 修通已接受PDD到0x0D／ledger／碰撞，不另造道具模板 |

普通藥水 clone inventory → 在clone扣數量 → inventory/stat全預encode → commit count與vitals → ledger → persist；
不因後一包編碼失敗先吃掉道具。拒絕仍回空0x0B解除閘門。duration單位已是ms，不再乘1000。
到期／逐欄替換／跨圖剩餘時間／死亡與登出清除沿既有ledger政策，不讓舊小MAD復活。

## 7. 明確操作入口，不自動改進度

- 保留最新save與目前等級／職業／技能／道具；不自動升級、轉職、發物或重seed。
- `/tools` 明確選法師／SP配置（非原版轉職），S手動配能力，K學 Bolt1 再學 Claw，雙擊或拖七鍵。
- 可穿回原初心者單手劍或合原要求的wand／staff；原魔法表依attack group，不必捏造Lv1魔杖。
  若目前穿弓／弩／拳套，其 magic row 原本為空，先手動換回相容武器；不會自動改裝或放寬需求。
- 工具新增「領取原WZ魔力藥水兩款各3瓶」：需確認，背包容量不足整批不發；會存檔，不由能力還原點回收。
- 既有「迴避藥水」入口不換模板，修的是實際消費鏈。

## 8. 仍不是完整1:1的界線

- mob RECT 取當前 WZ frame，不是完整原生 swept CShape2D；同片多隻的 Map 順序不保證等於原 ZList。
- directed foothold ray 已移植幾何／接點／group，使用線性掃描而非原R-tree；極端32-bit cross-product溢位與全CVecCtrl尚未逐項重現。
- server以已報命中點、已知mob root及既有x65/y100容差再驗證，不重算整個原生mob形狀池。
- Canvas／Gr2D blend、hit child z、字型度量與全局30ms相位仍有界線；不宣稱逐像素1:1。
- 各段server結算、斷線／死亡取消、有限資源cache／128筆10秒token，皆為明列重建政策。
- 原生死亡flush待命中列表與全部其他未開放技能不在這次宣稱範圍內。

新增 `server/test/magic-skills.test.ts`，更新舊active/items回歸來源；**全部未執行**。
冷備：`generated/backups/preview-faces-before-magic-20261018-052849-845095293.json`；
同 `generated/preview-faces-20261018.json` 重開8515／8516／8517，preview／observer帳號與工具權限不變。
