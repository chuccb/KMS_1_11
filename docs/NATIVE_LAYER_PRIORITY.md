> **2026-10-18 原證更正／未測試**：[NATIVE_ATTACK_EFFECTS](NATIVE_ATTACK_EFFECTS.md)／ADR-074。weapon afterimage 是 +380 child5，不是 +368 child1；通用 cast／hit 與 Armor flash 都是 root 250310。下方第4節已更正。

# 原版圖層優先度、角色遮擋與子圖層

2026-10-18。**已實作；依使用者指示，未執行 test/check/typecheck/browser/VM/probe。不是功能或逐像素 PASS。**
本輪只靜態讀原 C／listing／WZ dump，修改重建端；`MapleStory.exe`、Gr2D／Shape2D DLL 和 `Data.wz` 未改。

## 1. 先分清 root z 與 overlay child z

不能把所有東西排成 `(z, 腳底y)`，也不能把角色的部位全變成 global `z+1/z+2`。

- `Gr2D_DX8.dll` **1000C8A0** 建 `CWzGr2DLayer`，COM layer vtable 是 **100275A8**。
  listing 的 `10027664`（+188）指向 **10013770** put_z；`100276AC`（+260）指向 **10014510** overlay。
- **10013770 → 100137B0**：設定 z／overlay 都進排序串列；更新排序序號（`this[8]++`，layer vtable+8、參數1）。
- **10013D40** 比較 parent chain，直到共同父節點，再比 z；相等則比 vtable+12(1) 的序號。
  **1000CBA0** 回傳相應儲存欄位。**沒有拿畫面的 y 作 tie-break。**
- 因此一個角色的整棵子樹先依 root 排，再畫自己的負／零／正 child；不容許另一個 root 插進同一角色兩張 canvas 之間。

接線：`scene.mjs` 改 z／持續序號；靜態節點保留來源順序，不再由 server 或 RAF 按 y 重排。
動態節點 WeakMap 保存 stamp，z 改變才重新分配，隨 field 重設；不因重建 RAF array 改次序。
**界線**：原 engine 每次 put_z 都會有序號，這裡沒有重建全引擎的呼叫／30ms排程；不能聲稱同 z 同刻網路事件的全域順序已逐 tick 一致。

## 2. 世界深度：共同減掉 tile base `-1073721834`

| 原函式 | 原始算式／含義 | 重建端 normalized z |
|---|---|---|
| 46A1C0 | tile 的 `30000*layer-10*zM+canvasZ-1073721834` | `30000*layer-10*zM+canvasZ`（沿用，未亂改） |
| 46A9F0 | obj 的 `30000*layer+entry.z-1073739824` | `30000*layer+entry.z-17990`（沿用） |
| 4861F0 | mob `30000*page-2*group-1073711826` | page/group +10008 |
| 509A80 | user 同上，**controller+24 !=0 再加2** | remote +10008，local +10010 |
| 499BA0 | NPC base -1073711825 | page/group +10009 |
| 4A88A0 | drop 查落點附近 foothold，base -1073711823；查無 page/group=0 | page/group +10011 |
| 4A3920 | portal root -1073471724 | 250110（沿用） |
| 41E610／41F200 | 傷害／MISS root -1073471524 | 250310 |
| 46BDA0 | 背景 **1000*index-1073869824** | **1000*index-147990** |

交叉確認 `537260` 把 init 第一參數寫入 controller+24；**511820** local 初始化為1，**520680** remote 為0。
因此 +2 不是「攀繩加2」，也不能套到 mob hit1=14。繩梯 page/group 仍依 ladder metadata。

- 移除 user/mob 的「腳底4px內有平台就換 page/group」：空中保留上次接觸層，真正落地才切換。
  `sampleMotion` 也記住一個 RAF 跨過的正 foothold fragment，後面再是 air=0 不抹掉這個層。
- 背景現在有 z，從 WZ loader → `artJson` → 靜態 scene，保留原 type4／field clock，不再用後期 `front` 布林在最後強蓋。
  原 46BDA0 並不讀現代 `front`；API 保留相容欄位 false。這不是把素材當成缺失。
- **513C80 → 41B630 → 41BF60**：發射時透過 **515C70** 讀 avatar main layer 的 z，存入 bullet record[7]，
  41BF60 以它 createLayer。接上飛行道具的來源 root 深度並凍結，不再永遠畫在所有前景上方；之後換層不拖動已射出的彈。
- 傷害／MISS 進固定原 root plane。清除過期項倒序、繪製按建立先後；新數字不被舊數字反蓋。
- NPC/drop 目前封包沒有傳完整 browser controller 層狀態，固定落點仍以 WZ foothold 查詢；**沒有宣稱 NPC 漫步／原 collision tree 已還原**。

## 3. 裝備不是只要依 zmap index 畫一遍

| 來源 | 事實／本輪處理 |
|---|---|
| 4011C0（C 約9480–9660） | z counter 由0開始；空／空字串逐項減1，明示數字重設 counter。移除 `names.length-index` 與臆測 body/hand fallback |
| 4C1610 | canvas z 可是數字或名字；缺省0，未知字串保留 INT_MIN，而非偷換為部位名字。slot rank 為 info/islot 的兩字元 token 對應 rank 最大值 |
| template loader（C 18462–18518） | 讀 info/islot、info/vslot，不是只看道具號碼猜「帽子一定在頭上」 |
| 4C1460／smap.img | 依每2字元求 slot intersection；每張 canvas 的 slots = info/vslot ∩ smap[canvas.z] |
| 402130 | back-to-front 走部位；slot owner 優先度較高時淘汰整張新 part，較低時淘汰舊 part；等值共存；同 part 任一衝突即整張不畫 |
| Hair/00030000.img | rope/ladder、swingTF 的特定格自己引用 backDefault。移除對**所有正面格**額外補 backDefault/backHair，也不在缺動作時偷貼 front/default hair |

原 WZ dump 的具體例子：`zmap face=-36`，`smap/cap = CpHdH1H2H3H4H5H6HsHfHb`。
`Cap/01002000.img`（갈색 항공 모자）為 `islot=Cp`、`vslot=CpH1H5`；
`Hair/00030000.img` 為 `islot=Hr`、`vslot=H1H2H3H4H5H6HfHsHb`。
帽子只取得自己 vslot 允許的 hair regions，不是有帽子便把頭髮全刪掉；後腦、帽沿、窄／寬剪裁依各格 smap 分開處理。
同一流程也作用在衣服／手套／褲鞋／披風／盾，不為單一帽子硬編特例。

**界線**：native avatar 還有 body-level blocked-slot 集合、cash／pet／技能附著與完整 template/action assembler；
本輪接的是一般穿戴圖像的 islot/vslot/smap 衝突鏈，不宣稱整個 CAvatar／cash 遮擋樹已完成。

## 4. 合成兩張角色 canvas，weapon afterimage 在 front 後（ADR-074 更正）

- **402490**：`part.z >= faceZ` 畫到 a3（front），否則 a2（back）；**508700** 把 a2 給 user+376、a3 給 user+372。
- **更正先前誤判**：+368 child1 不是 weapon afterimage。**507A20／40EA70** 的真殘影是 +380／this[95]、child5，overlay +376；front 是 +372 child2。
  不再拿 508700／509070 的 +368 操作證明武器殘影位置。
- server 以相同 bounds／origin／mirror 合成兩面；HTTP `planes=1` 的單一 PNG 垂直存兩面，
  header `x-frame-plane-height` 指每面的高度。API／cache key 加 planes；一般選角仍可用單面合併 PNG；攻擊工具預覽與 field 使用相同兩面後的獨立殘影。
- field 一次下載／decode 兩面：back → front → 獨立 release-clock afterimage。死亡 alpha／body tint 保留；殘影不乘受傷 body tint。
  同時保持未 trim 的 `damageOriginY`，不讓裁切移動受傷數字錨點。
- 普通單面輸出也先合成兩面後再 fold，避免 RGBA8 分組取整差異；兩面使用**共同** crop，不各自裁臉／頭髮導致漂移。
- remote 基本攻擊也等待所選圖／effect ready 才暴露 swing；保留收到時的時鐘，若已結束就不遲到重播。
  場景、epoch、人物、look、death／攀爬、較新 attack ticket 都有 guard；傷害／投射物安排不等 PNG 下載才重新起算。
  冷載入太慢時會略過已逝動畫，不聲稱完整資源常駐或原網路延遲補償。

### 墓碑的前輪誤判一併更正

**509AF0** createLayer(-1) 之後以 vtable+260 overlay user+376。
這是 avatar **child -1**，不是 `avatarRootZ-1` 的另一個 root！
本輪移除 Tomb 的世界 scene 節點，改在該角色 body 前畫；仍保留前輪 fall/land／死亡繞行淡出／聲音與settled生命週期。
不再允許附近另一個 mob／object 插進同一 avatar 子樹。

## 5. 名字不是頭頂白色描邊字

**47D110**：CLife name layer overlay main，child z=5，位置 `(-width/2,+2)`（腳下）；
width=文字量測+5，height=font height+4，文字局部(2,2)。底 ARGB **A0000000**，四個1px透明角。
**527720(0)** 是 Gulim12／白字。接回腳下的黑底名字，不再 y−62 與3px黑色描邊，也不把名字提到 global HUD plane。
瀏覽器使用現有 Gulim／KMSCJK fallback；16px label height 是原12px字體對應值，量測／baseline仍非原 IWzFont/GDI metrics。

## 6. 操作與未完成範圍

登入後點「體驗工具（非原版）」或 `/tools`：

- 新增 **圖層／遮擋 · 103000000**，既有 **跳躍怪／雲層 · 104040000** 仍保留。
- 只在明確點擊且既有 map-command/test-tools 授權允許時傳送；**不改裝備、能力或進度**。
- 一般 I／E 穿脫、Ctrl基本揮刀／射擊、移動／跳躍／繩梯、掉落／死亡路徑沿原功能，不加自動角色配置。

依使用者要求未做執行驗證。新增 `server/test/native-layer-priority.test.ts` 來源，涵蓋 zmap reset、
slot 衝突、同z非y序號、local+2／空中層、plane packing、back index與HTTP接線；**沒有執行**。
舊 arm fixture 補上最小 archive.has facade；不是回歸通過宣告。

仍未完成：全 CAvatar/body-level slot、全 CWzGr2D 排程、原 CShape2D/fixed-point 與所有 controller、
NPC 自行漫步／aggro／飛行、技能／魔法／buff、全 UI window manager/focus、cash/pet／交易等。
本輪沒有修改 UI 視窗焦點堆疊，也沒有把後期機制混進來。

## 7. 存檔與交付

沿用 `generated/preview-death-20261018.json`；停服後冷備份、以相同save與授權重啟。
不seed，不自動修裝備或重設角色。實際備份／服務啟動紀錄見下節，啟服不是功能PASS。

### 實際交付記錄

- 已停止前輪 `kms-1-11-1ec1eb7b`，再以 `cp -p` 冷備份：
  `generated/backups/preview-death-before-layer-priority-20261017-234500.json`（檔名用沙箱UTC）。
- 停服後 save／備份的 SHA256 同為
  `84447144c88fe7a7ba320325a4641694ea3250d4d197b8634862905e13cf2c2a`。
  本輪保留使用者在前輪服務遊玩的新進度，不回復成上一輪的舊hash。
- 相同命令／同save重開 `kms-1-11-648135c3`，PID9097；web8515／login8516／game8517，均0.0.0.0。
  啟動載入 **2帳號、1角色**，CLI帳號因已有存檔被忽略，沒有重新seed、移圖或自動修裝備。
- 啟服結果只證明服務已啟動。舊LIVE回傳的遊玩log不是本輪測試；本輪沒有進瀏覽器／發功能請求／跑測試。
- 文件／原始碼完成後只做 `git diff --check` 空白檢查；提交含 `[skip ci]`，非force推送目前Arena分支。
