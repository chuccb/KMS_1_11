# 原版遠距技能、多彈藥、攻速增益欄與武器失效鏈

2026-10-18，ADR-071。**未執行 test／check／typecheck／語法檢查／browser／VM／probe**。
這是繼[第一批七技](ACTIVE_SKILLS.md)後的原碼／listing／Data.wz交叉與實作；新增回歸來源不等於PASS。

## 本輪完成的可操作鏈

| ID | WZ原名 | 相容武器 | 本輪內容 |
|---|---|---|---|
| 3001004 | 에로우 블로우（Arrow Blow） | bow145／crossbow146 | 一枚彈藥、一次HP／MP費用、原Skill ball、命中特效、WZ damage% |
| 3001005 | 더블 샷（Double Shot） | bow145／crossbow146 | 同一疊兩箭、兩條傷害、原彈藥bullet、上下分離彈道 |
| 4001344 | 럭키 세븐（Lucky Seven） | claw147 | 同一組兩鏢、兩條傷害、LUK專用分支、第二鏢延後120ms發射、空組保留 |

與既有七技合計**十招**。入口仍是K技能窗雙擊／圖示拖原七鍵，不加入任意新按鍵；沒有自動改職業／學技／加點／發彈藥。
沿用 `/tools` 的明示確認流程，由使用者自行選職業／SP並學習；原角色、道具與地圖進度不重置。

### 方便入口，但不代替使用者改角色

`/tools`新增弓手預填（僅填表），以及**勾選確認才可按**的「領取弓／弩／拳套＋各200枚彈藥」。
以`--test-tools`帳號授權、目前已進場的帳號／角色檢查、shop／talk／trade／pending-shot守衛保護，非新增native opcode。
固定allowlist取本Data.wz：War Bow1452002（Lv10、PAD25）、석궁1462001（Lv12、PAD29）、
Garnier1472000（Lv10、PAD10）、2060000／2061000／2070000；equipmentFromTemplate讀真能力／RUC，不填零武器。
兩箭WZ slotMax999、鏢500；每種200是**開發工具數量政策**，也受原slotMax限制，不宣稱原贈品或原掉寶量。
全背包clone上先計畫，任何模板／空間不足整組不發；可encode 0x0B後一次替換且保存ITEMS與consume flags。
不自動穿戴／轉職／學技／加點／升級；照原需求，Lv10不能提前穿Lv12弩。還原能力**不回收**道具，按鈕與回覆皆明示。
未按此按鈕就不發物品；目前save不因啟服獲贈任何東西。

## 原碼交叉：不能直接複製現代技能規則

### 1. 入口與普通近戰回退：518BF0 → 519380

- 先查已學等級、預檢HP／MP；無MP時不會拿技能鍵免費揮一下。
- skill book family3只接受45／46，family4只接受47；拿劍使用Arrow Blow不是普通劍揮，是拒絕。
- 相容武器但彈藥不夠或prone時，走`512F90(this,null,0,null)`普通近戰；這不是免費技能射擊。
- 有足量彈藥時先呼叫`512F90(this,null,0,&out)`嘗試原近身框；找到近身目標則普通近戰成功，技能HP／MP回復。
- 未找到近身目標才呼叫513C80。瀏覽器在選動作後重查目標；冷載入期間近身目標突然進框則取消當次輸入、下次再選，不拿已載好的射擊強打近身。
- 梯繩／死亡／modal／換場／失焦等沿用全入口守衛；完整CShape2D與global phase仍未移植。

本重建不用先扣再回滾：只有完整技能射擊通過時才扣款；普通近戰回退直接傳skill0，沒有暫時扣MP的HUD抖動。

### 2. 彈藥不是傷害段數：511630 → 513C80

`511630`讀level的`bulletCount`（level offset84，120*level−36），缺失或<=1視為1；
按照USE的數字slot順序，找**同一疊**足夠數量的相容彈藥。不是把兩疊各一支拼成Double Shot。

`513C80`則另讀`attackCount`（offset80，120*level−40），缺失或<=1視為1：

```
projectileCount = max(1, bulletCount)
hits = min(15, projectileCount * max(1, attackCount))
```

本批真WZ：Arrow Blow沒有bulletCount／attackCount，因此一箭一段；Double Shot／Lucky Seven的bulletCount=2，未設attackCount，因此兩彈兩段。
15是原傷害nibble上限。彈藥helper另限制每次1..15為本重建的資源安全域；未開放更大bulletCount的技能，不宣稱原客戶端也把彈體數上限設為15。

### 3. 真傷害公式：4C7960 case47

普通拳套仍是mastery相關LUK*4＋STR＋DEX；**Lucky Seven不能沿用那一條**：

```
raw = Uniform(LUK*1.3, LUK*0.5) * 5 * Clamp(PAD + temporary PAD + star PAD, 0,999) * .01
```

Uniform仍走4C9270端點排序／七字亂數流；與其他物理攻擊同樣經過命中、等差、屬性與PD。
技能damage%在扣PD後、critical前，再最後clamp1..9999。每目標只預取七個亂數，多段沿同一cursor前進；
不為Lucky Seven每鏢抽一套七字，也不把星鏢PAD漏掉或提前分別clamp。

原WZ lv1：Arrow Blow MP7／108%；Double Shot MP8／56%×2；Lucky Seven MP8／55%×2。
lv20：Arrow Blow MP14／260%；Double Shot MP16／130%×2；Lucky Seven MP16／150%×2。
運算讀數值欄，不從hs拆字重算。

### 4. 飛行與命中不是同一條時鐘：513C80／514BA0

- 原level ball欄非空則取loader建立的`.../level/ball`路徑，否則entry22的root ball；不是將文字當URL。
- Arrow Blow有`Skill/300.img/skill/3001004/ball/{0,1,2}`，不能拿一般箭的bullet代替。
- Double Shot／Lucky Seven沒有自己的ball，取**實際彈藥**的`Item/Consume/.../bullet`；不能拿星鏢icon或別種箭替代。
- n枚彈體終點垂直位移：`7*(2*i-n+1)`，相鄰14px。兩枚即−7／+7，單枚0。
- **只有207族星鏢**每枚增加120ms launch delay；兩箭同時發射，不加假的120ms。
- 同次shot先算共同travel：距離×1.5；發射時刻是raw release，不是整個body duration。
- 本次所有傷害的native schedule仍以共同release＋travel計；第二鏢的視覺延後不能擅自加進傷害包的結算時間。
- 彈體進既有scene depth排序，捕捉發射root z；不另疊全場最高overlay。角色後續移動／轉身不拖動既有彈道。

**幾何界線**：現在命中點取mob root−20而不是完整485B80 shape交點；server沿用x65／y100安全容差、普通near由profile近戰框導出。
這些是重建政策，非已移植全CShape2D／牆面ray collision；飛行旋轉／Gr2D混合亦未逐像素驗收。

## 端到端封包與資源交易

- browser只送skillId、原action、朝向、當前目標座標；bridge從真已學level／WZ／武器／彈藥推算hits與damages。
- 使用原**c2s0x10**射擊布局：hits／skillId／action／speed／USE slot／至多一個mob與各段s16傷害；不是拿0x1E buff封包發遠距傷害。
- GameEntry另立`validatedActiveRanged`，驗真武器、段數、每段0..9999、姿勢、攻速、已學技能、HP／MP、彈藥來源、cooldown與場地。
- **全驗證＋預encode成功後**才同步commit一次HP／MP與彈藥。空射亦消耗。無任意JSON damage／level／彈數接口。
- `planBasicAmmo`先產生變更、不寫Map；資源與0x0B／0x0D都可encode才apply。最後一支箭clear；最後兩鏢扣到0仍保留rechargeable set。
- s2c0x0B **result=0**與成本0x0D **ack=false**，不誤解鎖物品移動／SP／AP／buff等待。
- 0x24原relay保留skillId／level、全部傷害、原projectileItemId，即使最後一支箭已從背包刪除，旁觀者仍能畫對素材。
- Server接受後先relay再排程扣怪HP／EXP／drop；保留session／instance／死亡世代守衛。換圖／斷線／施法者死亡與怪物重生不結算到錯誤實體。
- Bridge送出前不先抽無效目標的RNG；RNG前即檢查pending。已死亡／消失的射擊目標改空射，不悄悄換另一隻。
- 送包await後再核對session與contactField；不把舊場的active-hit預測標成新場。瀏覽器死亡後不接新預測，既有延後數字有epoch／mob identity守衛。

和普通攻擊相同，TCP仍是client-reported damages；server不重抽傷害。沒有原server資料，不宣稱完整authoritative combat／反作弊。
本地數字是預測，不是自創近戰／射擊ACK；被server拒絕時不代表真有造成傷害。

## 0x400 語意已定位，但 Booster 施放幅度未捏造

這次是**原收包值消費鏈的補齊**，不是宣稱Booster技能已開放：

1. `4C5DC0 mask0x400`寫temp58／59，CWvsApp起點temp28，因此對應app86／87。
2. `512F90`及`513C80`都讀`app86 ^ app87`，送到`4BE8B0`第三參數。
3. `4BE8B0`明確是：`clamp(rawWeaponSpeed - DoubleStabOne - booster, 0,6)`。
4. 所以原`unknown400`更名`booster`，wire順序／寬度不變；不是movement speed，也不是Dark Sight。
5. 保留未clamp的WZ `baseSpeed`。例如raw8、booster2必須得到6；若先clamp成6才減二會錯成4。
6. 普通近戰、prone32、普通射擊、主動近戰／遠距、body duration、raw release、server admission、bridge與remote一起接；冷載入完成後重驗攻速是否已到期或替換。
7. `55AA80`比較更新前後**有效weapon itemId**，變更時清app86／87；`4CC050`只把舊圖示mask的0x400去掉，非整筆buff清除。
   Ledger加逐欄移除，browser／bridge按stat-basis有效weaponId處理，server在裝備變更／攻擊／跨圖重播前同步清理；換髮型或同ID能力更新不濫清。
8. 其他未知0x200／0x800仍保留名稱，不依後期buff表猜成Magic Guard或Dark Sight。

**為什麼還不開Booster快捷鍵**：518BF0／519600可確證六種戰士Booster的武器要求與HP／MP／time；
但真WZ的level只有消耗與time，沒有「攻速減幾階」的數值，client只接受server給的整數。
因此本輪沒有填一個常見的2假稱原常數。也未以零效果的caster白扣HP／MP。這個阻塞與可用十技分開列明。

Magic Guard也續追：WZ x=4..80與hs百分比可對照；5114A0仍把**完整HP damage／MP0**送55B870。
原client未提供server分攤／MP不足時的捨入／回退細節，0x200在client沒有足夠消費者證明其語意；
因此沒有把Magic Armor改成Magic Guard，也未猜一個temp mask來湊第十一招。

## ACK 續查更正

上一輪最後把200ms完全視為send起算是不完整的。`55BEB0`處理非零ack時不只清CWvsApp+24，
**也重寫CWvsApp+28 = timeGetTime()**。本輪還原ACK時重新建立200ms gate，沒有以「避免RTT」為由移除原行為。
recipient／跨圖重播／射擊成本使用ack=false，不延長施法者以外的等待。

## 工程來源與交付

新增 `server/test/ranged-skills.test.ts`：整疊彈藥選取／預計畫原子提交／零鏢保留、數量與14px／120ms、
原0x10／0x24多段／truncation、真WZ的技能球／限制／消耗、Lucky Seven LUK與七字cursor、
0x400 wire／單欄取消／嚴格expiry／先減後clamp；明確領取工具的真模板／整組容量原子性／不自動穿戴。全部**未執行**。

沿用 `generated/preview-faces-20261018.json` 的使用者最新進度；停舊服務後冷備
`generated/backups/preview-faces-before-boosters-20261018-*.json`（名稱是本輪研究起點，不代表已開Booster）。
不重seed、不自動補資源、不還原成上次快照。提交 `[skip ci]` 跳過hooks，不跑CI或測試。
完成後用同save／preview與observer原工具權限重開web8515／login8516／game8517。
