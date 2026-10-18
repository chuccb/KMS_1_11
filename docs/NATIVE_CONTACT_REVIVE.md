# 怪物碰撞、受傷／MISS、擊退與復活（2026-10-18）

> **歷史交付 `855cebd` 的來源紀錄。** 後續原Tomb／ghost／attr2與重大HTTP bodyAttack漏接修補，
> 見 [NATIVE_DEATH_ANIMATION.md](NATIVE_DEATH_ANIMATION.md)。下述8495 LIVE／save是前輪紀錄，不代表本輪程序或存檔仍存在。

**交付狀態：實作與靜態來源整理；依使用者要求，沒有執行 test／check／typecheck／browser／VM／probe。**
下列回歸檔只是未執行的來源，啟動 LIVE 不代表功能 PASS，歷史測試數量也不適用本輪。

這輪補的是一條可操作的流程，不是只有能力顯示：

```
目前 WZ 動畫格 lt/rb + bodyAttack
  → 前後座標 swept RECT → 491FF0 內縮 → 第一個相交活怪
  → 第二 ClientRandom stream → 4C8ED0 EVA／PA／PDD
  → MISS: NoViolet0/Miss，負 1500ms 鎖，不新加受傷 tint／擊退
  → 命中: 原 0x1C 負 HP 報告 → 伺服器 0x0D → 真 HP／死亡
             + NoViolet 數字、hit 表情、正 1500ms tint、外力 staging
  → HP=0: dead 0 格／動作 18|facing，停止新攻擊與碰撞
  → >2200ms: 原 Notice 復活窗 → OK／Enter → 0x0D kind=0、空 name
  → 伺服器既有 returnMap／有效 HP 上限 → 原 0x16 重建場地
```

## 反編譯、PE、WZ 交叉對照

| 原來源 | 採用的行為 |
|---|---|
| `40B530` | 每個 mob action frame 讀 `lt/rb`，缺任一向量則 `SetRectEmpty`；不是以 canvas 大小代替。原缺 delay 預設 180ms。 |
| `486260` / `485AA0` | 當前動畫格的 RECT，鏡像為 `(-right,top,-left,bottom)`；碰撞時與上一座標位置做 UnionRect。 |
| `5085E0` | 玩家 RECT `(-22,-65,22,0)`，加當前與上一座標並聯集。 |
| `491FF0` | 活躍、有 `info.bodyAttack` 的怪物依 pool 次序尋找；**先 swept union 再內縮**，不是全 PNG 接觸就傷害。 |
| `511C60` | 原鎖為 0、非動作18/19才碰撞；先更新怪物 temp，再 `4C8ED0`；MISS 設 -1500，命中 `5114A0(...,1500)`。 |
| `4C8ED0` + PE `4C8ED0..4C90xx` | 第二 RNG stream、EVA 第一抽；MISS 不抽傷害，命中再抽一次。PA=0 也消耗第二抽，再落到最小傷害1。 |
| `5114A0` / `5376C0` / `537B00` | 負 HP 報告；外力先存獨立 pending components，下一物理步脫離地面／繩梯，再有界併入速度。不把外力直接當 walk vx/vy。 |
| `509790` | 命中呼叫 face1 (`hit`)，1500ms；不是新造 user-emotion 廣播。 |
| `CUser` tick（反編譯272370附近） | 30ms 朝0更新 signed counter；正值時 phase&3 的前兩相位乘 `0xff808080`，其餘白色；負值不新套這個 tint。 |
| `508450` / `509860` | 本機受傷／MISS 用 palette2；錨點是腳座標減兩張 avatar canvas 的最大 **originY**。**+132 不是圖片 height。** |
| `41AF20` / `41E610` / `41F200` | palette2 是 `NoViolet1/0`，MISS `NoViolet0/Miss`。palette1 是 NoBlue，不能由508450的正數分支誤稱打怪紅字；既有 mob 傷害仍用 NoRed。 |
| `509AF0` / PE `509B1A..509B3C` | local user、a2非零、timer尚為0時，明確將遊戲時間寫入 `CField+0x2a8`（680）。不再把這個寫入者說成完全未知。 |
| `558CF0` | 該時間非零且差值 **>2200**，才建立 CUIRevive；不是死亡瞬間自動傳回村。 |
| `4E94E0` / `4E9750` / `4E99C0` | 復活窗 `(268,104,264,132)`，`UI/Basic.img/Notice/backgrnd`；OK相對 `(100,92)`，原 `BtOK` 65×24。兩行原韓文，14px行距、12px字體、白色+1影／黑字。 |
| `4E9E20` / `4E9E30` / `4E9E70` | OK／Enter 同路徑；Escape 被吃掉、不取消。原 c2s `0x0D` kind0空名字，非需權限的地圖命令。 |

### 碰撞內縮不能遺漏

原 swept mob rect 為 `r`，`cx=trunc((left+right)/2)`、`cy=trunc((top+bottom)/2)`：

```
left   = min(r.left+25, cx-1)
top    = min(r.top+30, cy-1)
right  = max(r.right-25, cx+1)
bottom = max(r.bottom-10, cy+1)
```

用 Win32 IntersectRect 的嚴格正面積交集，只有邊緣接觸不算。
座標整數化及瀏覽器長幀採樣仍是重建端的實作，不宣稱完整 CVecCtrl／CShape2D。

### 真 WZ 的具體例子

- `Mob/0100100.img/info` 有 `bodyAttack=1`、`acc=15`。
- move/0 的 `lt=(-18,-26), rb=(19,0)`；hit1/0 改為 `(-21,-33)..(22,0)`，且 **delay=600ms**。
- 此輪發現先前 sprite reader 用 `nodeProperty(canvas,"delay")`，漏了 canvas.value.props；
  現在改讀真正的 canvas properties，WZ hit1不再硬播240ms／每格120ms。
- 繪圖、普通攻擊的矩形篩選與碰撞現在共用「目前格」，死怪先播 die1，不會先被殘留 hit1蓋住。
- **此份 Data.wz 的該怪有 `PADamage=20/PDDamage=0`，但這個 exe 的48D080查的是 `PA/PD`，缺值預設0。**
  所以此版公式可產生1點碰撞傷害；不是素材缺失，也不偷偷用後期欄名補出較大的傷害。
  若未來要增加相容別版WZ的選項，必須另行明示，不能混稱原1.11規則。

## 受傷計算與外力

`4C8ED0`：

1. `EVA=clamp(base+temp,0,999)`。玩家低於怪物等級時，減 `trunc((mobLv-playerLv)/2)`、下限0。
2. 第一抽 uniform(`EVA*.1`, `EVA`) 若 `>= clamp(mobAcc,0,999)`，結果0／MISS。
3. 否則 PA=clamp(mobPA,0,999)，第二抽 uniform(`PA*.7`,`PA*.8`) ×PA×.01。
4. 扣防依 job/100：戰士 `(STR*.15+DEX*.1)*PDD/(Lv*2.5)`；
   法師 `(DEX+STR)*.5*PDD/(Lv*2.2)`；弓／賊 `(STR*.2+DEX*.1)*PDD/(Lv*2.5)`；初心者不走這三條。
5. trunc、夾1..9999。`nativeUniform` 保留 `%10000000 / 9999999`，不是後期固定命中率公式。

擊退方向：`dx=prevSelfX+mobX-prevMobX-selfX`，水平 sign(dx)×270；
`dy=prevSelfY+mobY-prevMobY-selfY`，垂直 dy>0取0，否則-270。
不是拿 mob/self 中心左右硬選方向。pending force與既有速度都用原 bounded merge：
如向右125遇-270，變-145；向左-125遇-270，限至-270；已經-400則不減速；下落500遇-270仍可是230。

ADR-077已改下一個本地30ms控制步消費外力，並按5376C0先jump後force；attr2留在該有序fragment。
原始程式使用共同app phase與原整數幾何；仍未宣稱逐bit一致，見 [NATIVE_LOCOMOTION](NATIVE_LOCOMOTION.md)。
擊退不偽播放 Jump 音效，也不憑空新增未定位的玩家受傷音效。

## 表情、字圖與生命週期修補

- 修正 `avatarFrame` 原只有4參數、呼叫端卻傳5參數的遺漏：emotion現在進入 URL、cache key及組圖。
  `hit`與既有F鍵表情不再被默默忽略；同角色stat更新保留本地emotion／animation／facing。
- 命中時 body/face 複合圖做 RGB brightness128/255，不用 alpha=.5 冒充原 tint。
  afterimage不跟著變灰；MISS不新加hit face／impulse／tint。
- 原本 trimming 後的 PNG 高度不等於傷害錨點。組圖保留 **未trim** canvas的 `damageOriginY`，
  透過header交給頁面；素材未到就不畫替代文字／猜60px的高度。
- incoming數字與MISS取NoViolet，打怪仍NoRed；原1000ms、400/600ms、上升30px及origin-aware overlap共用。
- field／login／斷線清collision pending、snapshot與本地鎖，忽略舊field結果；mob離場／重生清舊hit快照。
- 視窗鎖輸入不等於原版無敵：NPC／商店／背包／體驗工具打開時，接觸仍可受傷。
  復活窗開啟時遮住底層輸入、關閉本機其他模態顯示；下一field完成NPC session清理。
- 背景／blur丟棄舊碰撞位置，保護時間仍依monotonic elapsed推進，不把長時間切頁當延長無敵。

## Bridge信任界線與政策（不是原server證據）

瀏覽器傳 `touch` snapshot，不傳HP差值；bridge驗證當前角色、已知活怪、bodyAttack、
真正template內的frame、整數座標、有限前後位移、native RECT相交，才計算傷害。
第二RNG由0x16 seeds獨立初始化，和普通攻擊的第一stream分開。

- 每個field帶browser-only `contactField` token；request ID防重送；bridge另有1500ms rate gate與busy鎖。
- 座標容差是本實作政策：player對最新100ms移動記錄±256、相鄰快照±192、mob對未來leg endpoint±1024。
  不是已證的原版anti-cheat，也不是完整server-authoritative mob geometry。
- 檢查拒絕不抽RNG、不報負HP。成功命中只由 `ClientSession.reportTouchDamage(1..9999)` 發原0x1C。
  `recovery`仍只准非負，不能用JSON任意扣HP；bridge錯誤有帶ID的拒絕結果，不讓pending永久卡住。
- `touch-result`只是瀏覽器的本地運算結果訊息，**不是原TCP命中ack**。HP仍只能靠native stat reply更新。
- 真正vital diff與成功復活立即persist，避免只等斷線存檔；不把裝備上限寫回base record。
- 復活入口限定HP<=0；按鈕等待field才解除，錯誤／5秒未回可重試是browser防卡政策。
- 暫時能力／到期仍沿用既有same-field／disconnect政策與到達時計時差，未宣稱全域RNG與時鐘完全對齊。

## 道具與方便體驗

`2002000` 原 `eva=5,time=180000` 現在有真正contact消費者；消耗／原temporary-stat封包、
同欄覆蓋、期限、raw圖示與到期都共用既有流程。PDD timed spec也接到扣防；
MAD/MDD與未知效果仍整筆拒用，不先吃掉再顯示無效buff。

在上方「體驗工具（非原版）」或 `/tools`：

1. 可用無怪城鎮、原地圖搜尋、獵場40000；不是改目前角色的強制啟動腳本。
2. 勾選同意後才領3瓶迴避藥；這是明示非原版發放、會存檔，還原點不回收道具。
3. I → 消耗欄連點使用，S→Detail看EVA；非原版面板另顯示唯讀EVA／PDD與正／負保護tick。
4. EVA+5不保證MISS，初心者可能仍低於怪物ACC。可明確套用盜賊體驗配置，再到K學님블 바디，
   或分配LUK比較；表單新增「填入盜賊體驗配置」只填值，不自動修改角色。
5. 死亡後約2.2秒出原韓文復活窗，Enter／OK走原returnMap；不要求地圖命令權限，不用工具假加血。

**本輪環境重建後，前輪ignored存檔／冷備份／LIVE程序均不在沙箱。**
本次LIVE採新的獨立 `generated/preview-contact-20261018.json`（**repository根目錄相對路徑**），`preview:preview`／`demo:demo`為新帳號，
角色由使用者在原建立介面建立；這不是恢復舊兩個角色，不覆寫／冒充舊進度，也不提交save至Git。未建立角色前只使用記憶體中的新帳號；首次角色建立等實際變更才寫入save。

本輪已實際啟服，web **8495**、native login8496／game8497均綁0.0.0.0；僅確認程序啟動日誌／監聽狀態，沒有登入或執行功能探測。
零runtime依賴，不安裝測試工具來啟服。可重現命令（cwd：`server/`）：

```sh
node src/cli.ts serve --host 0.0.0.0 --port 8496 --game-port 8497 --web-port 8495 \
  --data ../Data.wz --save ../generated/preview-contact-20261018.json \
  --account preview:preview,demo:demo --map-command preview,demo --test-tools preview,demo --ping off
```

## 尚未完成／不宣稱

- 原完整CVecCtrl force／斜坡／繩梯再抓取狀態與完整CShape2D；瀏覽器是現有普通物理＋已定位外力合併。
  前輪尚未保留attr2；後續已接原move relay，仍未重建原30ms append/merge。沒有另造遠端受傷表情廣播。
- `511C60`後半的4734A0環境固定10傷害分支、怪物主動攻擊／魔法／怪物temp與技能受傷路徑。
- 前輪未接完整Tomb.img；後續已接原fall／land／ghost。另更正聲音為新死亡立即播放，不是延到落地；526CC0回傳的是音量。來源與界線見後續文件。
- face/emotion仍為既有compositor的emotion/0；全原生臉部動畫、2張Gr2D layer內部狀態與字體metrics未完整。
  原視窗皮、座標及文字有證據；KMSCJK fallback不等於2003 Dotum逐像素相同。
- 主動技能、魔法、快捷鍵拖放、自然AP/SP／轉職、卷軸、cash/pet、完整交易窗、自由拆疊等仍待完成。
- 沒有執行測試或視覺驗證，不能據此稱整體1:1完成。

## 新增／更新但未執行的回歸來源

- `server/test/native-contact.test.ts`：條件式抽數、MISS等號、PA0、等差、各職業扣防、兩stream隔離、
  swept/mirror/shrink/空rect／邊界、外力方向與有界合併、signed clock、原復活payload、真WZ metadata。
- `server/test/native-damage-render.test.ts`：NoViolet首／餘字與MISS，不fallback到NoRed。
- `server/test/items.test.ts`／`native-stats.test.ts`：EVA接入、PDD與未支援MAD拒用，保留原vital邏輯。
- `server/test/webclient.test.ts`：新增synthetic hit／MISS橋接場景，snapshot拒絕、browser damage被忽略、
  原負報告落到HP0、重複ID／舊field拒絕、revive回field、任意負recovery拒絕；未執行，不當實測。
