# 普通移動力學、地形狀態、繩梯與有序移動路徑

> 2026-10-18 後續：已補原537520／53C2B0的本機前後位置顯示取樣，涵蓋走路與跳躍而非改力學。
> 原553F40的ceil全域時相尚未移植；browser保留floor權威時鐘與最多30ms呈現延遲。
> 四種camera政策、來源交叉、實際執行結果及LIVE保存見 [PLAYER_PRESENTATION_CAMERA](PLAYER_PRESENTATION_CAMERA.md)。
> 本頁下方「來源未執行」等描述保留ADR-077撰寫時點，不取代後續實際驗證記錄。


日期：2026-10-18；ADR-077，幾何續作ADR-078見 [NATIVE_TERRAIN](NATIVE_TERRAIN.md)。**已實裝來源；未執行 test／check／typecheck／語法檢查／browser／VM／HTTP或登入 probe。**
這是普通控制器相關鏈的續作，不是完整 CVecCtrl、CShape2D 或原 server 已還原的宣告。

## 1. 原證與本輪實作

| 原函式／listing | 證據與落地 |
|---|---|
| `511030`、`485960` | CAttrShoe 預設 mass=100、walkForce／walkSpeed／walkDrag=1、slip=.9、jump=1。`.9` 是與 `abs(sin)` 比較的坡滑閾值，**不是平地 drag 乘子**。舊平地720已改800px/s² |
| `562BB0`、`563010` | CAttrFluid 預設係數1；靜態地形載入器建立**一個共用預設 CAttrFoothold**，walk／drag=1，逐段保留 id／xy／prev／next／page／group。沒有把後版 `force`／`drag`／map gravity 等欄位猜成這版會讀的 WZ 屬性 |
| `564CE0`、`537520` | 控制器按位置查 fluid tree，沒命中用預設；更新週期回傳30ms。所查 `563010` 沒有填入 fluid 區域。現有 ordinary 路徑使用這組有證預設，不捏造區域，也不稱 water/fly 已完成 |
| `5643D0`、`537260` | 地形 `+48/+56` 是 `(dx,dy)/hypot(dx,dy)`，`+64` 是長度；不是 dy/dx。`collisionWorld` 正規化一次。地面速度是 signed tangent speed；public vx/vy、封包、受擊與跳躍皆使用 world components |
| `537CA0` | port 地面力、摩擦、超速制動、斜面速限、坡滑與 trapezoid 距離；不是對一個水平速度做 `approach` |
| listing `537D35–537D4F` | 力乘數依原 oriented slope 分支：uphill sign<=0 取 `1+sin²`，另一向取 `1−sin²`。保留原碼的方向非對稱，不以常識「修成」另一套物理 |
| listing `537F68–537F77` | decompiler 未定義 `v12` 其實是選定速限與0的比較；不把它當未知旗標或刪去整個 overspeed 分支 |
| `5378D0`、`539A30` | detach 匯出 world velocity，腳點 `floor(y−1)`；普通跳 −555×shoe.jump／field.gravity；站跳水平漂移減半；走跳含 foothold walk、sin²及坡向速限。**本版沒有這條分支的「下＋跳忽略平台300ms」**，移除該後加穿台機制 |
| `5376C0`、`537B00` | 同一步先 jump，再 staged external force；受擊不直接覆寫 vx/vy。碰撞後剩餘毫秒用碰撞速度前進，不重加一次 gravity／walk force |
| `5382F0` ordinary branch | air input force20000／mass；drag10000／mass；水平控制上限8.92857而非89.2857；既有較快走跳不被按方向瞬間減到上限。重力2000，終速670；超終速由drag漸減，不瞬壓670 |
| `5389B0` | 第一次穿越的落地點插值碰撞速度，投影到地形切線；與水平輸入同向或input0減半，反向清零；保留world vy，不把斜坡落地固定寫成0 |
| `539450` | 相連斜坡交界保留 tangent speed，再轉換 world vx/vy；edge 按碰撞比例取速度，區分 oriented 上升牆／下行 lip，離開平台的剩餘位移包含 X/Y 兩軸 |
| `5426F0`、`564DF0` | 抓繩在物理之後；空中只在下落且Up抓，使用 swept AABB 的X±10、數字id順序；地面Up查上20px，Down查下10px且須在頂端範圍。forced action 不可偷偷變成抓繩請求 |
| `542DF0` | 每30ms上下3px、與 speed stat 無關；uf=false 在y1停，uf=true 越頂到y1−5後detach，底端y2+1；繩上只接受有水平方向的離繩跳 |
| `5426F0` death branch | 死亡先清速度／控制輸入並直接返回，不以「只擋按鍵」繼續套重力；queued jump／外力不能讓屍體繼續移動 |

入口：`client/native-locomotion.mjs`（純數值規則與有證預設）、`client/motion.mjs`（幾何／狀態／時鐘）、
`client/main.js`（輸入／音效／發布）、`client/mobmotion.mjs`（共用普通跳怪規劃）。

## 2. 時鐘、按鍵、音效與生命周期

- 玩家 controller 改為本地固定 **30ms**；mob planner 仍為<=30ms細分。RAF 顯示與原 app 的全域相位並未等價。
- keydown 直接排入 request，RAF觀察到的按下也 latch 到下一控制步（即使keyup早於第一次RAF），不因從8ms改30ms而在步間釋放後消失；按住不自動每次落地重跳；這項既有browser按鍵政策不冒稱已比對全部native keyboard repeat。
- focus／hidden／輸入框／對話等 blocked 與死亡會清 queued request。死亡保留實體位置，不套普通空中重力。
- native ground jump 分支才播放 `Game/Jump`；離開平台、純KB、離繩不偽播。以實際接受的 groundJumps 計數判斷，不再用 RAF 開頭結尾的 grounded 差去猜；同一RAF含多個控制步也不漏掉一般跳躍。
- 角色換場／重生／server correction 重新 createPlayer，地形索引、累計餘數、pending jump、外力、journal 都不沿用舊場。
- 本輪不更改 AP／SP／裝備／HP保存格式、不寫角色能力、不自動配裝、不改存檔角色地圖。
- 普通跳怪共用同一套 ordinary forces／ground projection，terminal landing 保留真world vy；這不等於移植完整 CVecCtrlMob owner／state／aggro。

## 3. 路徑完整鏈，而不是只改本機位移

原 wire codec 與 `0x0E→0x22` 沒改版、不新增私有 native opcode。

1. 每個30ms控制步保留座標、world vx/vy、動作／朝向、foothold、attr、duration。原 `_ftol` 匯出用trunc，不再對負座標／速度用round。
2. `drainPlayerPath` 加零毫秒起點，依時間送出完整 records；ADR-078以碰撞前positive-duration／實際接觸時刻0ms transition／剩餘時間末端保序。抓繩／離繩也留transition，不讓整段下降提早變成grounded／ladder姿勢。
3. **仍每100ms批次傳輸**，attack前照舊flush。這100ms是browser傳輸政策，不是物理步長或原版send判定。往返後終點恰好相同也不可丟棄中間運動；只有整條都沒有移動／姿勢／速度／attr變化才省略idle包。
4. attr2留在真正消費外力的那一個有序fragment；drain才交出一次，不會因下一個控制步清掉、或重播在之後每包。遠端臉部沿用已接的30ms movementFace消費時序。
5. `BrowserSession` 在入串列前驗證 `path`；`ClientSession.movePath` 用既有 codec送出；motionWrites原本的session／field失效守衛仍有效，換場不執行舊佇列。
6. Session本機位置、remote cache以及 FieldInstance 的權威位置／posture都使用**最後一個**chronological record。怪物選敵、命中距離、拾物、晚進場不被新的zero-start anchor錯留在前一位置；原單元素 `moveTo`／舊browser工具呼叫保留相容。
7. server仍原樣relay整條path，remote sampler保留每段duration、終端零節點、facing與page/group。只在相連的地面段之間投影，不把air→floor的下降或無關平台間的chord提早貼到地面。

沒有官方server原碼；上述「最後record作權威」是明示重建政策，不改稱已恢復官方 anti-cheat。
path 的 originX/Y 語義仍未證明；browser的起點由**第一個零duration record**表達，不偷把header兩word解釋成原版已知欄位。

### 界限與常數分類

| 數字 | 意義 |
|---|---|
| 100／140000／125／80000／16000 | 原shoe mass、走力、走速、摩擦、零摩擦時仍有的超速制動 |
| .9／60000／120／.5／.8 | 原坡滑門檻、坡滑力／速率、指定分支減半、走跳最低注入因子 |
| 10000／.0008928571428571428／2000／670／555 | 原普通air drag、水平控制速率換算、gravity、terminal、jump |
| 30／3／10／20／−5／+1／162.5 | 原控制步、climb位移、抓繩X／下探、上探、離繩頂／底、離繩橫速 |
| 250ms | browser背景分頁補償上限，非原版常數 |
| 100ms | browser transport batching，非原send條件／全域相位 |
| 960ms／62+2 records | 本地未送journal上限；超量丟舊並換anchor，不跨舊資料接chord |
| 64 records／1000ms、attr只0或2 | bridge JSON入界政策；native codec本身仍支持255 records／u16 duration。整數、signed XY／velocity、foothold／action範圍在寫socket前驗證，不做字串／NaN隱式轉型 |
| EPS、spawn距離24px | 既有spawn／remote浮點保護與portal settle政策，非整數crossing門檻；ADR-078移除64-hop，ordinary最多兩pass |

## 4. 還沒等價的邊界

本輪 ground force／ordinary air scalar 分支有直接port；但以下**不能冒充完成**：

- ADR-078已接有向整數crossing／endpoint pair／dual tangent／ceiling-wall group、ground reversal、539B10/539C40物理場界及integer contact time；原證與政策見 [NATIVE_TERRAIN](NATIVE_TERRAIN.md)。仍非native shape pool／R-tree遍歷與所有unstick callers。
- 原 app 共同30ms時相、CMovePath原始append／send判斷、過期合成fragment／30與33ms播放校正、網路抖動下的完整重排／預測。
- 現在journal是browser的endpoint interpolation表示，仍非逐bit重演native的velocity／acceleration playback；ADR-078已把接觸時刻放入interval內，不再把全部落地推遲到30ms末端。
- water／fly／特殊鞋／技能位移、完整mob owner AI；不能只靠同一套scalar helper稱它們全做好。
- x87暫存精度／JS double、現版動態手感、像素或原機比較皆未驗收。

## 5. 來源回歸與LIVE保存

`server/test/native-locomotion.test.ts` 新增純來源回歸：flat force／friction、slope normalized/world velocity、
steep與zero-drag、air control與超終速、jump caps、短按鎖存／背景上限、Down+jump、linked edge／jump-before-KB、
landing half／反向歸零、抓繩順序與rising阻擋、uf／頂底／離繩、dead freeze、ordered wire／attr／trunc、remote terminal、不合法JSON拒絕。
另更新舊8ms／attr暫存來源，並在world回歸補多record relay／末端權威／晚進場。
**全部只寫來源，沒有執行；沒有PASS數字。**

沿用 `generated/preview-faces-20261018.json`。停服前備份及停服後冷備：

- `generated/backups/preview-faces-before-locomotion-20261018-072922.json`
- `generated/backups/preview-faces-cold-locomotion-20261018-072945.json`

備份不進Git；不回滾、不另造帳號、不代替使用者修改現有角色。啟服／port listening不等於遊戲驗收。

後續ADR-078的整數幾何、field bounds、普通mob與特別KB連動，以及新版同save保存方式，見 [NATIVE_TERRAIN](NATIVE_TERRAIN.md)；以上兩份locomotion備份是上一輪時間點，不作新版restore來源。
