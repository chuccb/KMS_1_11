# 暫時能力封包、原加速藥水與裝備移動能力

2026-10-17。**本輪未跑 test／check／typecheck／browser／VM／probe**；新增的回歸來源不是 PASS。
此輪補「加速藥水的完整可操作鏈」及穿戴移動值，不代表所有 buff 或完整 CVecCtrl 已完成。

## 先更正舊判讀

舊 `FINDINGS §4.21.2`／`stat.ts`／schema 把第一個 u32 叫 `panelFlags`，第二個叫 `unknownId`，
還把第 4 個引數的副本當成角色 id。這些命名／語意不正確。

交叉來源是 `MapleStory.exe.c` 的 `4C5DC0`、`4C6310`、`4CBBD0`，以及 PE 的原指令：

- `4C5DE1` 讀第一 u32；`4C5DF2..4C5E01` 判零直接返回。
- `4C5E11` 將第一 u32 加上呼叫者 clock，保留到 EBP；這是到期時刻。
- `4C5E1E` 再讀一個 u32，`4C5E36..4C5E3A` 複製第二個 u32 到輸出副本，
  `4C5E3C` **test 第二個 u32 的 bit1**，不是第一個。
- `4C60A7` test 第二字的 `0x80`；`4C60C5` 讀 s16；`4C60E0..4C60FA` 寫入
  temp-stat +176/+180 的值與 +184 開始的 expiry 遮罩對。相對 CWvsApp 即 +288/+292。
- 反向 encoder `4C6310` 也是先 a3，再於非零時送 a4，並按 **a4 的 bits** 寫 signed values。
- `55BEB0`：`4C5DC0(this+28, packet, *(u32*)(n3000_0+20), out)` 非零回傳後，
  呼叫 `4CBBD0(this+94, packet, expiry, out[0])`。

這不是角色基礎能力面板的另一組旗標，而是 **一筆有時效的能力更新與其來源圖示**。

## Native `0x0D` 版面

```
u8 ack
u32 statDiffFlags
... 原19個基礎能力差異欄位，寬度不變
u32 durationMs                      // 0: 整包在這裡結束
if durationMs != 0:
  u32 temporaryMask                 // 0x001..0x800
  s16 value[popcount(temporaryMask)] // bits 由小到大
  u8 sourceIsSkill                  // 0: 道具，非0: 技能
  u32 sourceId                      // 整筆只有一組來源，不是每個 bit 都送一組
```

對應 DWORD value pair 起點：2、8、14、20、26、32、38、44、50、54、58、62；
各 expiry pair 在 value 起點再加2。前九欄為 PAD／PDD／MAD／MDD／ACC／EVA／hands／speed／jump。
最後三欄 codec 暫名 `unknown200`／`unknown400`／`unknown800`，**沒有靠後期版本的 buff 表來補語意或施放**。
`protocol/temporarystat.ts` 處理 wire；`stat.ts` 不再拒絕所有非零 duration。
未帶暫時能力的舊封包仍原樣只附四個零 byte。

writer 保守限制 duration 為正且不超過 0x7fffffff 的毫秒間隔、數值為 s16、來源為 u32；
reader 對未知 mask／截斷尾段直接拒絕。這是 codec 的安全限制，不聲稱原 server 也採相同限制。

## 效果覆蓋、到期與原圖示

- `4CBBD0`：舊圖示 mask &= ~新 mask，剩0才移除；之後 append 新來源。
  因此只覆蓋同欄、不把同類效果相加、弱效果也覆蓋；舊來源其他欄位保留自己的到期時間。
- `4C65A0`：clock − expiry **>0** 才逐欄清值；到期不永久寫入角色能力。
- `4CC2D0`：移除過期圖示；`4CC560` 重建32px槽寬圖層。
- `4CC560` 的 layer 位移 `(397 − 32*n, -255)` 相對800×600中心，即右界797／頂45；
  舊來源從最右往左畫，alpha210。沒有自行加現代倒數字、圓框或後期 buff 素材。
- `4CBBD0 → 479B10(..., 0)` 取的是 **`info/iconRaw`**；非零 sourceIsSkill 走技能 icon。
  copy 不扣道具 drop/inventory 使用的 origin；不把同一張圖拉伸成32×32。

瀏覽器 `temporarystats.mjs` 保存 client-owned 暫時值、來源與 deadline。
它使用持續經過的 clock，不用自然恢復的背景250ms cap；換圖不重設 deadline。
**目前效果不寫入存檔，斷線／新登入清除**：這是此重建版本的連線生命週期政策，
沒有取得原 server 的離線 buff 保存規則，不冒稱完全相同。重啟不補回已消耗藥水。
本輪未實作圖示右鍵取消或技能施放；沒有發明 cancel opcode。

## 真正改到移動的值

原 `4C5740`：100＋一般穿戴（14格、不是 cash 外觀）的 `speed`／`jump`，
先把基底 clamp 到 speed 100..130、jump 100..123。
原 `512400`：再加暫時值，最後 clamp 到 speed 80..130、jump 80..123，
將百分比×0.01寫到 CAttrShoe +32／+56。

因此 `movementStats` 使用 **背包封包裡已穿戴的裝備實例數值**，不是重新拿 WZ 模板蓋掉捲軸結果。
`motion.mjs` 把 walkSpeed 和 jumpSpeed 各自乘上倍率；離繩跳的水平162.5也乘speed，
垂直−555×0.5乘jump，符合 `5378D0`。沒有用速度藥水改重力、空中阻力、繩梯直爬速度或攻速。
`5382F0` 的一般空中控制以 field drag／shoe mass 計算，不另把 speed 百分比亂乘上去。

無裝備速度加成時，speed108 對應平地目標速度125×1.08=135px/s；
效果到期後目標回到穿戴基底，仍透過既有加減速處理，而非瞬間把位置拉回。
原完整鞋屬性、CShape2D逐幀碰撞、斜坡力學等仍未全部還原，不宣稱完整物理1:1。

## 道具使用：只放行真的有作用的部分

原 `Item/Consume/0200.img/02002001`：

| 欄位 | 原值 |
|---|---:|
| info/name | 속도향상의 물약 |
| spec/speed | 8 |
| spec/time | 180000 |

`time` **已經是毫秒**，不是180000秒，也不再乘1000。
`game/items.ts` 僅把有效 speed＋time 列為已支援 timed mechanic。
包含 EVA／PAD／MAD／其他未實作效果的道具（即使也有 speed）仍拒絕整筆，不先耗道具再說沒有作用。
只有 time 沒有實作效果、無效時間／speed、空 spec，也不放行。
伺服器安全政策也拒絕商店／對話／交易中的使用，避免消耗正在交易的堆疊；不聲稱這是已取得的原server限制。

使用仍走原 `0x18` slot／itemId；伺服器先準備／編碼完整效果，再驗證背包格並扣一瓶，
送 `0x0B` 更新數量、`0x0D` 傳暫時能力並立即保存。
滿血滿魔不阻擋純加速；死亡不准吃。空格／錯itemId／未支援效果仍回原空 `0x0B` 解除 pending。
圖示不代表已完成其餘戰鬥 buff；原傷害公式、命中／迴避／防禦模型未完成前，不燒那些藥水。

## 方便實際操作（明示非原版）

1. 登入 sandbox 原有 preview／demo 帳號與角色，開上方體驗工具或 `/tools`。
2. 先去無怪城鎮，勾選同意，按 **領取3瓶原WZ加速藥水**。這一步才會加道具且保存；沒有自動seed。
3. 關工具，I開背包，選消耗欄，連點藥水。右上出現原raw圖示，走路實際套倍率。
4. 工具另有明示非原版的唯讀速度／跳躍百分比與加速剩餘秒數，每250ms更新；
   不把現代數字塞到原遊戲 buff 圖層。關閉工具才可移動（與原工具一致，不暫停怪物）。
5. 重喝會刷新同欄時間，不是+16。換圖保持目前時效，時間到清掉效果與圖示。

發放由 server 固定2002001×3，不接受任意itemId／數量；核對登入owner、`--test-tools`、
confirmed、無shop／talk／trade／pending shot，核對原WZ有效spec，clone背包、預encode後才套用。
背包沒有能放3瓶的格／堆疊空間時拒絕，不覆蓋道具、不扣錢、不改職業或點數。
**這是會存檔的體驗道具發放，不是原版取得規則；能力／技能還原點不回收／回溯道具與時效**。

## 新增回歸來源（全部未執行）

- `test/temporarystat.test.ts`：手寫speed封包bytes、十二欄signed序與單一來源、舊零尾段、無效與截斷。
- `scripts/temporarystats_probe.mjs`（納入browser-motion wrapper）：覆蓋／弱效果／部分保留／期限邊界、
  裝備與temp兩階段clamp、實際physics multiplier、iconRaw位置／alpha。
- `test/items.test.ts`：真speed＋毫秒fixture、混合未實作欄位與無效time保持拒絕。
- `test/stat.test.ts` 舊「非零一律拒絕」改為「非零duration須有完整尾段」；client probe載入新module。

依使用者要求不執行以上內容，也沒有瀏覽器／原client驗證。啟動LIVE只代表服務啟動，不代表功能PASS。

## 本輪交付存檔

沿用 `generated/preview-growth-20261017.json`，未重新seed；停止舊服務後以exclusive create保留
`generated/preview-before-speed-buffs-20261017-6788523701597.json` 冷備份（ignored，不推送角色進度）。
能力／技能記憶體還原點會隨重啟清空，這份完整冷備份則保留於工作區。
