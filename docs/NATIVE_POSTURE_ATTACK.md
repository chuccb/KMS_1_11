# 本機姿勢、蹲刺、強制攻擊雙時鐘、恢復與被動射程

2026-10-18；接續 ADR-068，決策 ADR-069。

**狀態：已編輯實作與回歸來源；沒有執行 test、check、typecheck、語法檢查、browser、VM 或遊戲 probe。**
本輪的 Node 資料讀取僅枚舉原 WZ 節點／數值，不執行遊戲、傷害、合成或網路情境作為驗證。
啟服只確認服務啟動，不能當成畫面／玩法 PASS；舊輪的實測也不挪用。

## 這輪接通的整條關聯鏈

1. 原 controller 輸入 → 地面 walk／prone／alert／stand：不再以殘餘 vx 猜走路。
2. Down → movement10/11 → prone33；有水平輸入時仍走路，沒有加一個假蹲下技能。
3. Down＋Ctrl → 獨立 attack32/proneStab；不污染站立隨機攻擊表，不徒手假揮、不變成射擊。
4. WZ body／武器／Afterimage 真幀與 bounds → 兩向分層合成、預熱、冷載入守衛與遠端接包。
5. bridge → 原 0x0F → server 動作／速度／姿勢／次數驗證 → 原 0x23；蹲刺不扣箭／飛鏢。
6. action32 → 既有原 4C7960 弱 STR 分支；不是重寫為面板值、普通劍係數或增加彈藥 PAD。
7. 強制攻擊輸入遮蔽包括空中；32 保留 Down=1，其餘垂直／水平為0，不直接清除動量；forced32的Down不會誤抓平台頂繩梯。
8. 攻擊動畫逐幀30ms倒數與原 raw release 排程拆開；自己／remote／server cooldown 共用身體時長。
9. 攻擊接受時開始3000ms警戒倒數；不是播完後才開始，走路／蹲下只遮蔽姿勢，不重置倒數。
10. 自然恢復改傳正確 body action；警戒／蹲下不算普通站立，繩梯被動可到36/37分支。
11. 原射程被動 `range` 接到本機挑敵、空射終點、server包容範圍、唯讀數值；學技／換裝／換場重新供應。
12. movement flush 與 bridge move/attack 寫入排序；server 保留 action／foothold，使晚加入者看見原姿勢／方向。
13. 攻擊／飛彈 metadata 快取補上容量、重試、去重、clear abort、舊 response 防復活；server profile cache 有界。
14. `info/sfx` 隨 profile 到達，不再依賴背後非同步的物品 tooltip，避免首次冷攻擊漏武器聲。
15. 授權工具的唯讀閱覽加入近戰／蹲刺／射擊、弓／弩／拳套、真延遲與前後 plane／Afterimage；不寫角色。

## 原碼、listing、WZ 交叉證據

| 來源 | 這輪採用的意義 |
|---|---|
| CUserLocal vtable listing `5875E8 +4 = 512EE0` | 不是誤追到空的507810。512EE0先處理死亡，再呼叫50D700；其this為調整過的介面指標。 |
| `5426F0` | controller+152/+156保存水平／垂直輸入；forced action有效時水平0，垂直為 `forcedAction==32`；不只地面遮蔽；梯繩抓取也須無forced action，listing542AF5為Down入口guard。 |
| `50D700` | 地面且水平非0→walk；水平0且Down>0→prone；其餘視alert計時器選alert或stand。之後才是梯／繩／空中。 |
| `512F90` | dead與攀爬拒絕；prone movement下必須skill=null且weapon group非0，固定32；否則427F60選站立動作。 |
| `427F60`／`427FE0`、原表 `5B2144`／`5B2294` | 七組普通近戰／射擊候選；32不在普通隨機列。`4280A0`的基本合法動作另接受32，技能路徑不接受。 |
| `508690` | 設定forced action並重建身體時，同時將 `CUser+176` 設3000；不是受傷或站立時任意重開三秒。 |
| `50B590` | alert每次扣30；body countdown也扣30，到期換幀並裝入下一幀自己的delay，丟棄負overshoot。forced播完解除並回普通動作。 |
| `508700` | speed clamp0..6；每幀整數除法 `(speed+5)*baseDelay/8`，`+196`另存這些raw值的總和。 |
| `512F90`／`513C80` | 另用raw總和減raw最後一幀排程Afterimage／射彈；不能拿已量化的身體播放總長去減最後raw值。 |
| `508FC0` | movement>>1與body action不是同一張表：prone5→33、jump3→35、ladder7→36、rope8→37。 |
| `4C7960` | action32走 `STR(0.5..1) * PAD * 0.006666…` 特別分支；命中／等差／PD／最低傷害沿既有原計算。 |
| `4BC590`、listing `4BD338..4BD3C1` | `range`讀入每級資料+76，即 `120*level-44`，不是attackCount或射速。 |
| `513C80` | 弓／弩查3000002；拳套查4000001；以已學且clamp後的級別取range，再加原基本200。遠界從角色x起算，不是近界再加200。 |
| WZ `Skill/300.img/skill/3000002/level`、4000001同理 | level1 range25、level8 range200；讀數值，不解析hs文字，不以目前職業清掉已存被動。 |
| WZ `Character/00002000.img/proneStab` | 真幀0／1、delay300／400、face1；不是三格普通劍揮或無delay素材。 |
| 14種基礎武器的WZ stance／Afterimage | 130/131/132/133/137/138/140/141/142/143/144/145/146/1472000均有proneStab；共用body但Afterimage家族與矩形各自讀原資料。 |
| WZ 單手劍1302000 | `info.afterImage=swordOL`、`info.sfx=swordL`；proneStab bounds lt[-74,-11]／rb[-15,1]。 |
| `527550`；WZ `Sound/Weapon.img/<sfx>/Attack` | 原sound family與Attack名稱；不是固定替換為某種劍聲。 |

以**speed2為例**：proneStab raw縮放是[262,350]，raw總和612ms，release262ms；
身體逐幀倒數實際消耗[270,360]，共630ms。這是兩種時間的推導，不是執行測試得到的結果。

## 寫死數字的分類：原常數不等於重建政策

本輪針對上列實作鏈查明並標示，不宣稱已把整個repository每個數字都還原完。

| 數字／表格 | 意義與處置 |
|---|---|
| attack32、body33、movement10/11 | 三種編碼空間；32不可直接乘2當movement，33也不是wire蹲下狀態。保留原編碼並分開selector。 |
| 3000、30 | 原alert倒數起始值、原user update量子。抽出語義常數；3000從接受攻擊開始，30不是瀏覽器fps。 |
| speed0..6、+5、/8 | 原速度級別與逐幀整數縮放；不把speed當目標數，不拿已round profile再縮第二次。 |
| body default150 | 原407A10／listing407C8B的缺省，不是「看起來順」的值；沿用共用nativeBodyFrameDelay。 |
| [160,160,160]、90/72/36 reach | 沒有這條原攻擊路徑的依據；移除假動畫與舊近戰範圍fallback，不偷偷改成另一組近似。 |
| 65 | 512F90原近身射擊probe的left限制，還要 `min(left,right-1)`；蹲刺不進射擊probe，不截短為65。 |
| 200 | 513C80基本遠界；不是所有角色永久射程，已補 `+ learned WZ range`。 |
| y−25、距離×1.5 | 原射彈來源高度與飛行時間；保留。 |
| mob.y−20、以當前canvas矩形挑敵、duration最少1ms | browser的目標中心／幾何／除零保護政策，**不是已還原的CShape2D**。 |
| server grace30ms、射擊slop X65/Y100 | 明確命名的傳輸／位置包容政策；其65不因數字相同就成為原近界語義。未知原server算法，不宣稱原版常數。 |
| metadata64、retry5000ms | 記憶體／失敗重試政策，不是武器／玩家／動作數上限。pending滿時不互相abort；clear才中止。 |
| 8ms物理步、250ms補償上限、100ms位置發布 | 現有browser重建政策，**不是原30ms全域主迴圈**；本輪沒有將它們改名冒充原物理。 |
| 基底125／1400／720／2000／670／555等 | 原CVecCtrl／CAttrShoe有相應基底或因子，但現行motion仍是普通地空重建；完整地形摩擦、斜率、water／fly與全global調度不能靠這些基底宣稱完成。 |

## 操作、時序與生命週期

- 地面Down且不水平移動：prone；Ctrl：獨立蹲刺。無武器／未知動作不借別的武器姿勢。
- 蹲刺期間forced Down保留；鬆Down不會半途把32變普通攻擊；到期才回目前輸入選定的姿勢。
- 普通／射擊／空中攻擊期間遮蔽方向輸入，不直接把vx/vy歸零，仍由物理／碰撞處理動量。
- 新攻擊從profile與圖像冷載入返回時重查field、角色、look、方向、prone、生命、modal、輸入框與operation epoch。
- 攻擊前發布當前movement；bridge move/attack序列化寫入，避免TCP write的await使32先於prone到達。
  換field／session後丟棄舊佇列操作；未新增native opcode。
- server LIVE只接受已實作基本物理，空攻擊同樣佔冷卻；未知action不能跳過cooldown再扣怪血。
  主動技能／magic的消耗、合法性尚未完成，因此LIVE不再把它們當免費基本攻擊處理。
  metadata-free舊協定fixture路徑保留，不聲稱其可公開營運。
- 蹲刺走原弱STR算式；弱傷害與最低1可以合法出現，但不因此重新引入已修復的裝備實例PAD0問題。
- alert在走路、跳躍與prone時仍倒數；到期不應留下永久警戒。死亡／field／斷線不保留舊body的倒數。
- recovery現在讀body ID；climb passive讀值本身不變，沒有贈送技能或修改HP／MP存檔。
- server在既有first-path snapshot策略上保留action與foothold；晚加入者可看見prone／rope／facing。
  無報告時stand4是明示spawn政策，不是觀察到的原server字節；沒有順便改成另一套path merge／append幾何。
- immutable攻擊資源跨場地可共用；斷線clear，舊promise不能暖回已清空cache。actor／hit／projectile仍有原field epoch守衛。

## 唯讀入口

`/tools` →「唯讀 · 原角色動作／武器姿勢閱覽」。加入弓1452000、弩1462000、拳套1472000，
普通近戰首動作、32蹲刺、普通射擊首動作（只看身體／Afterimage，不生成飛彈）。
顯示實際frame與raw delay／body倒數總長；預覽循環是browser工具政策，不冒充玩家自動攻擊。

look副本、不試穿、不給物品、不消耗、不選敵、不發attack／movement、不出聲；
前後planes之間畫Afterimage，沿正式profile／clock／compositor。無武器或該武器沒有射擊時明示，不假造。
關閉／收合／換場／斷線／真modal／死亡沿既有工具清理；遊戲角色不被預覽的虛擬Y／時鐘改寫。
唯讀戰鬥欄另顯示當前movement byte／body ID／forced ID／alert剩餘與WZ射程。

## 仍未聲稱完成

- 完整CVecCtrl、CShape2D逐幀選敵／地形遮擋、原全域30ms相位、原全域RNG選動作、water／fly。
- 原Gr2D所有Afterimage z／混色／技能等級；目前第0子節點與既有effect reader的缺省／alpha機制保留。
- 主動攻速buff、技能MP／多段／多目標、Soul Arrow、完整怪物AI與正式反作弊。
- remote沒有別人已學技能表；空射遠端視覺保留基本200，不能從別人的職業猜被動級別。
  有目標時仍以已收到目標呈現飛彈；本機／server的真正射程已讀本人WZ被動。
- 瀏覽器attack時鐘以接受時間建立相位；背景返回直接到當前時間，不是重播所有原native中間物理snapshot。
- 原server沒有在倉庫內；合法動作、單目標、速度／姿勢驗證是根據已支援client契約制定的server政策。
  仍沿原協定信任送來的傷害，不冒稱server重算／正式營運安全。

## 變更與回歸來源（全未執行）

- `client/posture.mjs`：selector、alert、forced input與body action編碼。
- `client/attack-timing.mjs`／`.d.mts`：raw縮放、逐幀倒數、release、真index與基本動作查詢；Node共用。
- `client/combat-assets.mjs`：有界資源去重／退避／abort／舊世代守衛。
- `game/basicattack.ts`、`world.ts`、`client/session.ts`、兩層net與main／工具閱覽整合。
- 新 `native-posture-attack.test.ts`、`combat-assets.test.ts`；擴充basicattack、equipment-generation、world與舊jump／motion fixture、歷史VM import shim來源；VM harness未認證。
- 沿用 `generated/preview-faces-20261018.json` 的實際遊玩進度；沒有重seed／改級別／重填裝備。
  停服冷備：`generated/backups/preview-faces-before-posture-attack-20261018-040933-833420367.json`。
  存檔與冷備都在ignored generated，不進Git；完成後同檔開LIVE web8515／login8516／game8517。
