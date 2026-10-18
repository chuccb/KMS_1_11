> 2026-10-18後續（未測試）：本機prone／32蹲刺、攻擊接受時起3000警戒、強制動作逐幀30ms與raw release拆分、

> 本輪續作（未測試）：[NATIVE_EQUIP_ADMISSION](NATIVE_EQUIP_ADMISSION.md)／ADR-072。最低級方便入口、原穿戴順序與server正反swap、主動預測時鐘及remote身份鏈已有續作；本文下列前輪範圍／工具描述保留歷史背景。

> **本輪續作（未測試）**：[NATIVE_RANGED_SKILLS](NATIVE_RANGED_SKILLS.md)／ADR-071新增三個遠距技能，合計十招；補多彈藥／Lucky Seven／真ball／攻速欄與武器失效／ACK時鐘。下文保留上一輪交付範圍，不把未開放的Booster／Magic Guard寫成已完成。

> **2026-10-18 後續（未測試）**：[ACTIVE_SKILLS](ACTIVE_SKILLS.md)／ADR-070已接七個主動技能、原七鍵、消耗、多段／範圍、增益與隊伍入口。下方保留當輪歷史範圍；不代表其他技能／魔法／完整幾何已完成。
> 恢復body ID、原被動射程與資源／封包生命週期見 [NATIVE_POSTURE_ATTACK](NATIVE_POSTURE_ATTACK.md)／ADR-069。
> 下方是前輪紀錄，其「尚未實作」與raw攻擊時間敘述須按後續更正閱讀。

> 2026-10-18 圖層後續（未測試）：原avatar雙面／afterimage child1中層、bullet發射來源root z、
> remote資源ready與過期guard見 [NATIVE_LAYER_PRIORITY.md](NATIVE_LAYER_PRIORITY.md)。不是完整CShape2D／技能實作。

> 2026-10-18後續：攻擊arm身份／冷圖／無武器fallback與idle動畫修補見 [NATIVE_JUMP_ATTACK_BACKGROUNDS.md](NATIVE_JUMP_ATTACK_BACKGROUNDS.md)。
> 此文件較早的 combat.ts 舊公式敘述已由 NATIVE_STATS_COMBAT.md／NATIVE_EQUIPMENT_DAMAGE_FIX.md 後續實作取代。

# 基本武器攻擊、選彈與投射物（2026-10-17；未測試）

> **2026-10-18 後續更新（未測試）**：有效裝備／Detail／4C7960普通物理與PAD/ACC藥水已接，裝備HP/MP與成長INT亦共用有效集合。下方保留當時交付紀錄；最新範圍與未完成碰撞／技能界線見 [NATIVE_STATS_COMBAT.md](NATIVE_STATS_COMBAT.md)。

> **依使用者指示，未執行 unit／socket／browser／VM／probe／check／typecheck。**
> 本輪僅靜態閱讀反編譯／PE、解析原 Data.wz、編輯／格式化來源與整理 Git。
> 新增回歸測試來源亦未執行。舊文件的570等PASS不能代表本次改動；沒有啟動服務或改動存檔。

## 本次接通的完整基本路徑

- Ctrl：先依武器原動作表選一個近身動作；弓／弩／拳套有相容彈藥、前方沒有近敵時，改走基本射擊。
  沒彈藥仍可走近身攻擊，不把整個攻擊鍵封死；不把拳套投擲錯畫成射箭。
  場景／本地物理尚未載入、攀繩、死亡或互斥視窗／請求中不送新攻擊。
- 使用原 **c2s 0x0F／0x10**，攜帶正確的攻擊action、speed，射擊另有USE格號。
  無目標也發送基本攻擊；**空射仍消耗1發**，旁觀者也收到動作／投射物。
  WS另帶頁面取樣的當前怪物座標，寫入原target x/y，避免TCP移動記錄的未來終點被誤當射擊目標。
  這是本專案WS資料，不是新增原版wire欄位；server仍按自己當前的怪物記錄判定。
- 依消耗欄slot1起升序選第一個足量且相容的格，不按Map插入順序，不拿弓箭供弩用。
  弓2060xxx、弩2061xxx、拳套207xxxx；0發飛鏢跳過。瀏覽器與TCP橋均重新讀各自最新庫存。
- 服務端重新驗武器動作／速度、基本單發形狀、彈藥相容性與第一個可用格；成功才扣1發。
  一般箭最後1發耗盡清格；207飛鏢保留原物件及quantity0，可走既有商店補充／整組出售／丟棄。
  不把0發物件變成1發、不拆組、不預先在頁面扣彈。
- 數量更新使用既有 **0x0B put／clear，timer flag=0**，立即persist。
  **沒有把尚未解明的op1 key誤當數量**，也不讓攻擊的庫存更新釋放別的slot-move pending。
- 射擊在扣彈前保留itemId，送 **s2c 0x24** 給同圖其他玩家；因此最後一支箭清格後仍有正確投射物。
  ClientSession現在同時接0x23與0x24，保留action／speed／projectileItemId，頁面不再隨意輪播swingO1–3。
- 正常武器近身／射擊使用WZ身體每一幀delay及原speed縮放，不再統一拉成480ms。
  稀疏afterimage按WZ對應的身體幀顯示；弩shoot2五幀全部保留。
- 箭與飛鏢來自 **Item/Consume/.../<itemId>/bullet/<frame>**，讀原origin與delay；不是拿背包icon代替。
  顯示發射等待、飛行與方向旋轉；數字／怪物傷害音效等待命中時刻，不在拉弓時就顯示。
- 服務端延後處理基本射擊的扣怪血／死亡／EXP／掉落；斷線、換場及已死亡再生的目標不被舊排程命中。
  攻擊者本人仍是原client方式的本地預測數字，沒有捏造新的TCP「攻擊成功ack」。
- 正常待機／行走依武器WZ的stand／walk選2型，修正弩／雙手武器因只畫stand1／walk1而消失。
  這不會把攻擊或爬繩姿勢回退成站姿裝備。
- 換圖／斷線清理飛彈與數字排程；非同步素材回覆不把上一張地圖的攻擊插回新場景。
  地面攻擊動作期間限制新走跳輸入，不把角色傳送或清掉既有空中慣性。

## 原版證據

### 選彈與Ctrl分流

- `sub_511630`：只對武器45／46／47掃USE2，slot1起至容量尾，數量必須足夠；
  箭按itemId整除1000檢查2060／2061，飛鏢按整除10000檢查207。
  基本攻擊需1發；技能bulletCount、Soul Arrow不應以這條基本路徑推測。
- `sub_511E20`：非prone、弓／弩／拳套且有彈時，先由`sub_512F90(...,&n119)`檢查近身目標，
  無近敵才呼叫`sub_513C80`。有近敵或無彈時保留近身路徑。
- `sub_513C80`：基本遠界是**角色x±200**，不是「near再加200」；近界是角色x±n119，y是角色y−25。
  `512F90`在這個分流把近身rectangle左界夾至−65；`491F20(...,4)`查原怪物形狀池。
  3000002／4000001可能增加射程，這次未實作技能加成。

### 動作表不是移動action，也不是一律swingO

只讀PE section映射原VA，未執行exe。`427F60`讀`0x5B2144`，每group兩列、每列6個u32；
`427FE0`讀`0x5B2294`，每group兩列、每列4個u32。每列第一格是長度。此處只實作normal列：

| info/attack group | 近身action ids | 射擊action ids |
|---|---|---|
| 1 | 5,6,7,16,17 | 無 |
| 2 | 10,13,14,19,20 | 無 |
| 3（弓） | 9,11 | 22 |
| 4（弩） | 9,19 | 23 |
| 5 | 9,10,11,16,17 | 無 |
| 6 | 6 | 無 |
| 7（拳套） | 16,17 | 24,25,26 |

`43FC80`：5–7=swingO1–3，9–11=swingT1–3，13–14=swingP1–2，
16–17=stabO1–2，19–20=stabT1–2，22=shoot1，23=shoot2；24–26別名swingO1–3。
技能列另有shootF等，本次不泛化成已實作技能。

`508290`讀武器載入區+8的attackSpeed、+9/+10的walk/stand、+11的attack；
原WZ loader `aAttackspeed`（C18617附近）明確把WZ值放進+8，缺值預設3。
`4BE8B0`夾0..6；`508700`逐幀為 **trunc(delay * (speed+5) / 8)**，不是整段最後才取整。
尚無buff系統，頁面／服務端基本射擊使用未加buff的WZ速度；旁觀轉播按原speed重新縮放未取整的delay。

原Data.wz靜態解析例：

| 武器 | attack group／speed | 射擊姿勢／原body delays | 縮放後 |
|---|---|---|---|
| 1452000 배틀 보우 | 3／3 | shoot1：350,150,350 | 350,150,350 |
| 1462000 산양 석궁 | 4／4 | shoot2：150,150,250,100,100 | 168,168,281,112,112 |
| 1472000 가니어 | 7／2 | swingO1–3：300,150,350 | 262,131,306 |

### 發射時刻與飛行

`513C80`先取`this[50]`的延遲陣列**最後一格**，由`this[49]`總時間扣除，作為發射等待。
不是減第一格（弓的首尾恰好同為350，單看弓會漏掉這個差異）。
`41B630`得到起點`righta=x±near, y−25`及終點；到達時間為`trunc(distance*1.5)`ms。
空射也呼叫同一投射物池及發0x10。207技能多發間距0x78不是本次基本單發的額外投擲。
`41BC80`讀bullet子畫布，`41BF60`按起點減終點的向量atan2旋轉。
WZ2070000兩幀delay30ms、origin(9,9)/(8,8)；2060000／2061000有各自箭形與origin。

## 重建政策與尚未完成

以下不能從原client斷言原server規則，故明示為重建政策：

1. 伺服器基本射擊需skillId0、hits1、最多一怪，拒絕附加bytes、錯誤武器動作／速度、錯格／錯彈。
   alive／shop／talk／trade及冷卻守衛；冷卻採WZ總動作時間，允許30ms傳輸抖動。
   原client不能證明伺服器如何防作弊；既有近身／魔法傷害仍不是完整防作弊模型。
2. 瀏覽器用WZ afterimage lt/rb與怪物**第一張stand/move canvas rectangle**選近身目標；
   射擊用y−25的線穿canvas外框挑最近者。原CShape2D形狀／動畫逐幀碰撞、地形遮擋未完整移植。
   怪圖尚未載入時暫用舊20×30框；服務端只做前方265px／垂直100px的寬鬆目標中心界線。
   不能稱這些canvas／防護範圍與原形狀池1:1。
3. 有目標的飛彈終點暫為怪物腳底(x,y−20)，不是已移植的485B80形狀交點；飛行為固定起終點，
   未追蹤原pool的所有移動目標／特殊飛行分支。near的服務端／旁觀重建取第一個近身action的rectangle。
4. 命中排程使用原client可見的發射／飛行時間，於下一個world tick結算；
   這是本server的政策，不是發現了原server。換場／斷線取消待命中，但已扣的彈不退回；
   同場已接受的射擊可在攻擊者死亡後命中，目標已死亡／重生則不再套舊傷害。
   pending飛彈不持久化；停服不會恢復未命中射擊。
5. `combat.ts`仍是已明示的近似傷害公式；本次只把相容彈藥WZ incPAD納入其watk。
   武器係數、熟練度、命中／迴避、防禦、技能、完整instance裝備／buff總值未還原。
   因此**不宣稱射手／盜賊傷害已1:1，也不宣稱完整職業玩法完成**。
6. afterimage使用第0子節點與稀疏幀附件；缺少delay時沿用sprite reader的1000ms通用預設。
   全部原effect z／混色／技能afterimage等級與音效時序尚未移植。後續ADR-056依512F90／427F60
   移除無武器假480ms fallback；有武器卻無法取得原動作資料時拒絕假造其他武器動作，並顯示提示。
7. Soul Arrow、技能多發／消耗、技能容量／射程／攻速buff、完整技能UI仍未實作。
   飛鏢購買／補充政策沿用`MESO_RECHARGE.md`；本輪沒有改商店stock或贈送／改寫角色裝備。

## 程式與未執行回歸來源

- `game/basicattack.ts`：原normal動作表、WZ速度／body delay／afterimage、相容選彈／單發扣除、bullet素材。
- `game/avatar.ts`：正常stand/walk按武器2型；`game/sprites.ts`多回傳原canvas寬高。
- `net/loginserver.ts`：基本shot驗證／消耗／保存、0x24預扣id轉播、世界tick的待命中清理。
- `client/session.ts`／`net/webclient.ts`：原wire空攻擊／shot、0x24接包、action／speed保留、資源endpoint。
- `client/basiccombat.mjs`／`main.js`：原動作時間／素材、Ctrl分流、飛彈／數字等待、地圖生命週期清理。
- **新增但未執行** `server/test/basicattack.test.ts`：選彈次序／拒絕不修改、0發保留／最後箭清格、空射golden、
  WZ三類動作／五幀shoot2／30ms飛鏢frame。這不是PASS紀錄，也尚未涵蓋整個網路／排程／畫面。
