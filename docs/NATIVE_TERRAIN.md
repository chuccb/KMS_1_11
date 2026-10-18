# 有向整數地形、物理場界與碰撞時間整鏈

2026-10-18，ADR-078；承接 [ADR-077 普通力學](NATIVE_LOCOMOTION.md)。
**實作與回歸來源已編輯；依使用者要求，未執行 test／check／typecheck／語法檢查／browser／VM／HTTP或登入 probe。啟服不等於驗收。**

## 1. 原證與共用模組

來源是 repo 的 `MapleStory.exe.c` 與 `.lst`，不是後版模擬器參數。
`client/native-terrain.mjs`／`.d.mts` 共用幾何型別與純計算，普通 player、普通跳怪、特別 KB 分支按各自原 caller 使用。

| 原函式／listing | 這輪落地 |
|---|---|
| `563010`（C約360494–360536） | 所有 foothold endpoints 的 extrema：left=minX+30、right=maxX−30、top=minY−300、bottom=maxY+10。含牆與天花板，不是只算正向 floor，也不是 map art／VR／camera rectangle |
| `5643D0` | 共用 normalizeFootholds，保留 orientation、prev／next、page／group；不生成 reciprocal link |
| `537260` | 初始化裁四邊。普通 air 後續不裁 bottom；mob planner 延續900ms預算時 `initialize=false`，避免每次把跌落中的怪物拉回底界 |
| `539B10` | ordinary air 只裁左右X與top；清被裁軸的速度，其他軸保留原終點。按位移比例 trunc 毫秒，兩軸取較小值，不改成 rectangle entry 的共同線性點 |
| `539C40` | ground 沿當前 tangent 回算被裁X的 ground distance，清 tangent speed；不直接把角色座標夾在 camera 範圍 |
| `5389B0`、`539420` | 同一個有向整數 crossing resolver，取代分開 wall／floor sweep。保留有符號32位 side／端點乘積、64位階段、fraction排序、endpoint pair與等時角點 |
| `4AB460`（C約179656）、listing `538BDF`起 | R-tree query 的AABB判定是 inclusive；因此零寬牆、僅接觸端點不可用strict RECT intersection漏掉。這裡只移植 predicate，**不是整棵 R-tree** |
| listing `538EEB` 等 | first-hit比較不是一般double epsilon：`bestNumerator*denominator` 是signed64，但被減的 `bestDenominator*numerator` 是signed32結果再sign-extend。以 Math.imul／BigInt.asIntN 表達，初始比較值2/1 |
| `539054–5390EB` | dual contact投影兩者>.001選right，兩者<−.001選left；混合或near-zero清speed，優先正向right floor。不是最後掃到的foothold一律覆蓋 |
| `539450` | ground endpoint反向起步可換到prev.next／next.prev；正向地面在0ms轉段後return0，不啟動第二pass；nonfloor停端點。edge按neighbor sin分阻擋／detach，保留速度比例與整數剩餘時間 |
| `5376C0` | 最多兩次碰撞pass；第一pass才積分完整walk force／gravity，下一pass只走剩餘時間，不重加力、不64-hop追到底 |
| `53D3F0`（C約321255起） | 特別mob KB每次最多轉到一個相鄰floor、超長距離先夾該鄰段端點，不detach。ground KB不呼ordinary ground field clip；flyer KB呼539B10(time=0)，**不呼5389B0形狀掃描** |

### 整數、端點與常數的意義

- 坐標碰撞取整是 `trunc(n<0 ? n−.499999999 : n+.5)`，不是所有情況的Math.round，也不是改成一致away-from-zero。wire匯出仍是另一階段的 `_ftol` trunc。
- floor的group不阻擋落地；nonfloor只允許group0或body當前group。左右朝向與地形端點方向是不同資訊。
- 起端命中需要prev，尾端需要next。cornerAllows先比較left對right尾端的turn；turn<=0需任一new-point side>0，否則兩者皆>0。不以「坐標很近」補不存在的連結。
- 等fraction再依既有left／right與候選端點的side選pair；不拿foothold id當原生優先級。交點X保留32位cross後的signed64乘加與整除，Y依原path／segment分支回算。
- 30／300／10是native physical margin，不是視窗尺寸。`.001`是dual tangent選擇門檻；`EPS`只保留在既有spawn／remote浮點輔助，不作這條整數crossing的命中閾值。
- 無幾何、nonfinite、寬度不足60而無有效rectangle的手製fixture：回undefined，**這是重建防護政策**，不是聲稱native讀壞圖也相同。沒有造800×600 bounds或隱形地板。
- malformed overflow候選若恰與初始2/1 sentinel相等而尚無best，忽略該候選避免空讀；也是明示防護，不是有證正常WZ分支。

## 2. 剩餘時間與狀態

`motion.mjs` 的 `resolveGround`／`resolveAir`／`moveOnTerrain`：

1. ground先做ordinary force，再539C40與539450；轉到ground則以碰撞速度走餘時，detach則以world velocity走餘時air。
2. air先做ordinary air force；首次floor命中依碰撞速度投影，同向／無輸入減半、反向歸零，餘時ground不再套force。
3. nonfloor不設ground、不做floor half；accelerated pass投影END velocity，以contact／end tangent速度平均預估餘時位移。第二air pass是a4=false，**重用原始pre-force dst**，不是擅自用contact當新origin。
4. 第二pass後不繼續第三次edge。仍有剩餘毫秒時，publication補末端狀態以保持browser每步時間總量；不是另一輪物理積分。
5. page／group與world vx/vy隨真正ground transfer更新；grab ladder／jump／KB／detach清ground distance狀態，groundPosition與groundSpeed分開，不把坡面切線速度當水平速度。

## 3. map → player／mob → wire → remote

- `loadMapData`由真WZ footholdSegments算physicalBounds；`webclient.mapJson`傳原geometry與該rectangle。
- `collisionWorld`使用該rectangle；獨立幾何caller無metadata時可由segments計算。換場重建world，不把舊圖bounds沿用。
- loaded-map普通server roam目標也與physical X limits相交；makeMob／landing後rangeOn共用同一規則，不能初次生怪一套、落地另一套。既有life.rx0/rx1、chain與server決策政策仍保留；count-only MapSummary不捏造bounds。
- 普通air mob caller傳同一physicalBounds，使用與player相同step contact records；mob的jump／stand／move action ids獨立映射，不直接套user action6。
- `terrainTrace`為每個接觸保留`at/before/after`。incoming phase以positive duration走到接觸，after以0ms表達新phase，最後補本步剩餘duration。field clipping也保留其整數時間，而非全部推遲到30ms末。
- jump與KB在0ms；ladder grab／end在控制步末表達。attr2只在實際外力消費的transition一次，不沾到整個後續30ms，也不重複在每包。
- 玩家保留ADR-077的journal／bridge驗欄／既有codec／末端權威／remote sampler。未改native opcode，不新增private movement wire欄位。
- 普通mob落地仍保留最後0ms ground terminal，供resume及既有API；若落地後還有餘時，先輸出真ground positive-duration，再terminal。最多255個path records，append前保留terminal容量；若到上限，停在已發佈的上一個endpoint，不發超count byte封包，也不偽造ground。
- server mob sample／resume沿既有duration順序消費，晚進場從當前位置續未完成節點；不從原jump起點重播。

### 特別KB不混用普通控制器

`mob-reaction.mjs`改共用normalization／segmentPosition／clipAir，但**不把普通gravity／landing half／two-pass硬套進KB**。
ground KB依directed links最多轉一鄰段並clamp；不再有64-hop或額外contiguous坐標修補。flyer KB移除沒有該caller原證的獨立wall sweep，改539B10物理場界裁切；其普通飛行AI依然未完成。
保留mass100、130px/s、400px/s²、raw reaction window、forced body／facing與巡邏互斥、attack保護、死亡／重生與晚進場清理。

## 4. 還沒等價的範圍

- 現在broad phase是穩定WZ-array順序加inclusive AABB，不是native R-tree allocation／candidate traversal。多個等時而無幾何決勝的候選仍可能受遍歷順序影響；shape pool與其他CShape2D／unstick callers未整體移植。
- x87暫存精度／double差異，global30ms app phase、原CMovePath append／壓縮／send／velocity playback仍未等價。contact journal是browser的endpoint時間表示，不稱native原始recorder逐bit重演。
- 完整water／fly／special shoe／skill位移、owner AI／state／aggro／server correction政策未完整還原；普通server ground roam仍是polyline planner，不是全部改成CVecCtrlMob force simulation。
- 沒有執行動態手感／原機／像素驗收。來源回歸不表示PASS，舊輪PASS也不能挪用。

## 5. 回歸來源與保存

新 `server/test/native-terrain.test.ts` 涵蓋extrema、初始化與延續、不造bottom floor、field clip時間、整數cross／orientation／group、端點pair與tangent、反向link、two-pass、landing TOI與remote、mob terminal、KB一鄰段／flyer bounds、server roam目標。
更新native-locomotion的slope出生點／linked fixture以免被新bounds改變意圖、KB zero-time marker與jump landing餘時預期。
**只編輯來源，未執行任何測試或檢查。**

LIVE繼續同一 `generated/preview-faces-20261018.json`，重新作停服前備份及停服後冷備，再開新版；不使用上輪較舊備份覆蓋玩家進度、不自動改角色／配裝／帳號。備份檔留在ignored `generated/backups/`。

本輪實際保存／啟服：

- 停服前：`generated/backups/preview-faces-before-terrain-20261018-160247.json`
- 停服後冷備：`generated/backups/preview-faces-cold-terrain-20261018-160318.json`
- LIVE新版沿用相同save，啟動載入2帳號／2角色；0.0.0.0的8515／8516／8517已監聽。只確認啟服log，未做HTTP／登入／遊戲probe。
