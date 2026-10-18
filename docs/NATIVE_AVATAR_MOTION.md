# 原角色普通動作：武器姿勢、WZ幀序列、30ms倒數與繩梯停格

2026-10-18，ADR-068。**本輪沒有執行test／check／typecheck／語法檢查／browser／VM／HTTP／登入或遊戲probe。**
研究操作只讀原C、listing及WZ屬性；沒有拿歷史PASS或啟服結果充當本輪驗證。
範圍是**普通身體循環動作的呈現**，不是整個CVecCtrl物理、強制技能動作或全Gr2D重寫。

## 1. 這輪推翻的舊近似

- `motion.mjs animationPose`原來寫死3／4／2幀及500／180／250ms；雖有idle ping-pong，仍是RAF elapsed直接取模。
- 選角另外用100ms走路、500ms站立三格循環；創角又有一份500ms三格循環，與場地分裂。
- 全武器一律walk1／stand1，忽略了原武器`info.walk`和`info.stand`分開選擇。
- 繩梯以vy判斷是否累計elapsed；remote最後一段vy非0但位置已停止時，會繼續攀爬動畫。
- 身體缺delay誤用180，實際原body loader缺省為**150**（不是mob的180或face的60）。

## 2. 原C／listing交叉

| 原位置 | 結論 |
|---|---|
| `407A10`，listing `407C33–407C90`（缺省`407C8B mov esi,96h`） | Character/00002000.img逐幀delay，缺失／轉換失敗150ms；不是缺素材就造幀。 |
| `427BF0`／`428DE0`、`40D950`；`407A10`後半反向複用delay | stand1／stand2／alert的flag1；N幀展為2N−2，例如0→1→2→1。 |
| `409C30` 的`walk`／`stand`讀入WEAPONITEM[9]/[10] → `508290` user[35]/[36] | 兩種姿勢獨立選擇；無武器時1/1。有武器資料時等於1取第一種，其餘取第二種。 |
| `508FC0`／UI `425060` | movement action>>1：1walk、2stand、3jump、4alert、5prone、6fly、7ladder、8rope、9dead。不是把body action35等直接乘2送線上。 |
| `5084C0`／UI `4245E0` | action byte（含朝向）改變即重建普通序列；換外觀`508290`／UI counterpart強制重建。 |
| `508700`，普通caller `5084C0(...,3)` | delay `(speed+5)*base/8`，但**普通動作傳3**，等於base。不拿武器attackSpeed或Speed藥水比例縮走路動畫。 |
| UI `425620` 將body表的delay複製入序列 | 選角／創角用同一套原body表，不是另一組100ms走路設定。 |
| `50B590`，listing `50B763–50B776` | 每次減30，remaining<=0才換幀。 |
| `50B590`，listing `50B90A–50B919` | 新remaining直接設為新幀delay，**捨棄超出部分**；不是累積實數elapsed取模。 |
| `50B78A–50B7A2`；UI `424740`同分支 | ladder／rope比較previous/current整數Y；相同時在到期後把remaining設0，不換格。倒數本身沒有在停止時暫停；下次移動時可以立即換格。 |
| `42E210` →`4245E0(...,2/4,0)` | 選中的人物改走路，未選中改站立；沒有獨立的100ms動畫參數。 |

所以普通待機WZ500，在此更新鏈是510ms才換幀；繩梯250會到270ms；walk180仍180。
這是原倒數分支導出的結果，不是把WZ值改寫成510／270，也不代表整個瀏覽器已改全域原30ms tick。

## 3. 真WZ唯讀屬性抽取

| 動作 | 原數字幀 | WZ delay | body face欄位 |
|---|---|---|---|
| walk1／walk2 | 0,1,2,3 | 各180 | 1 |
| stand1／stand2／alert | 0,1,2 | 各500 | 1 |
| jump | 0 | 200 | 1 |
| ladder／rope | 0,1 | 各250 | 0 |
| fly | 0,1 | 各300 | 1 |
| prone／dead | 0 | 無delay，原缺省150 | 1 |

抽取的武器例子（僅WZ metadata，**沒有試穿或測畫面**）：

| 模板 | info.walk | info.stand | 原姿勢 |
|---|---|---|---|
| 無武器、1302000單手劍 | 1 | 1 | walk1／stand1 |
| 1402000雙手劍 | 1 | 2 | **walk1／stand2**，不能單憑雙手武器猜walk2 |
| 1412000雙手斧、1422000雙手棍 | 2 | 2 | walk2／stand2 |
| 1432000槍、1442000矛、1462000弩 | 2 | 2 | walk2／stand2 |
| 1452000弓、1472000拳套、1372000短杖、1382000長杖 | 1 | 1 | walk1／stand1 |

## 4. 完整接線與生命週期

- `game/avatarmotion.ts`依原body數字幀產生播放序列，保留真index／delay；ping-pong不重造canvas。
  所有武器共享reader的body表；缺武器或body資料回undefined，不用假類別補圖。
- ArtProvider新增64份有界metadata，`GET /api/avatar-motion/<weaponId>`供瀏覽器橋；0代表無武器。
  路由拒絕非法範圍／非整數／不存在模板；無Data.wz不造資料。這是HTTP資源API，**不是新遊戲封包**。
- `client/avatar-motion.mjs`承接普通倒數，與幾何、face clock、攻擊的speed／命中排程分離。
  行走／站立先以目前可見武器選walk/stand；不改角色實例能力、不用模板回填裝備PAD。
- 本人／remote使用同一clock，場地每幀更新**包括視窗外的actor**；draw／contact重複取同時間不重複前進。
  攀爬讀實際integer Y，不以收到時的vy判斷，停止時讓倒數到0並持幀。
- 選角三個槽、選中／未選中切換、創角換武器共用；沒有另留100ms／500ms近似。
  反向、換stance／look、死亡→復活、換場／斷線重設普通clock；self快照合併不重啟。
  強制攻擊期間仍由既有attack路徑優先，退出後從普通序列第一幀開始，不因此改傷害／投射物時序。
- 只讀metadata有64個cache座位、去重及5秒失敗退避；滿載不逐RAF驅逐全部pending造成永遠無法完成。
  actor只保留已完成且weaponId相符的immutable profile，避免metadata淘汰導致活躍人物每幀回到0。
  clear會abort；晚回覆只更新仍屬自己的entry，不修改actor／舊地圖。
- 預熱與PNG key使用真stance／index，含walk2／stand2、兩個方向與原臉部幀；淘汰後按實際cache重新取用。
  冷metadata先持frame0不造循環；冷PNG仍不改遊戲時序。一般idle暫代也改用正確武器stand，非一律stand1。
- geometry、movement action byte與100ms發送都不變；prone／fly原remote action可映至正確圖片，**沒有因此新增趴下操作、飛行物理或技能**。

### 明示的瀏覽器政策／未等價處

30ms普通呈現clock仍由RAF呼叫驅動，起始相位不等同原程式整個主迴圈；長背景間隔最多消費250ms，
不追播數秒不可見輸入。多個補償tick的攀爬比較用本次觀察到的integer Y，不是假裝有所有原生中間物理快照。
強制攻擊、技能、全部CVecCtrl、alert狀態的本機產生／原3秒切換鏈等未在這輪冒稱完成。
原圖層／face=0／face accessory／PNG compositor沿用已接鏈；原完整Gr2D雙layer內部狀態不因此變成完全等價。
普通動作排程沒有新增音效呼叫：跳躍／攻擊音效仍各由原有動作入口觸發，不每換幀播一次。

## 5. 方便操作，但不改角色的閱覽入口

體驗工具 → 展開 **「唯讀 · 原角色動作／武器姿勢閱覽」**：

1. 不必勾同意修改、不轉職、不升級、不買裝備；預設看目前穿戴外觀。
2. 切換無武器／單手劍1302000／雙手劍1402000／雙手斧1412000模板；替代模板不帶盾牌。
3. 選站立／走路可看不同walk/stand；面向左可看翻向與換動作重啟。
4. 選繩索／梯子，勾「閱覽器攀爬中」再取消／恢復，看倒數耗盡後的停格；virtual Y只屬閱覽器。
5. 所有動作共用正式metadata／clock／PNG compositor；不是另做一套展示動畫。

它是明示**非原版工具**、獨立actor與look副本；只GET素材，不送遊戲寫入封包，不穿戴、不給物品、不改存檔。
fly／dead只看身體姿勢，不觸發飛行技能、死亡事件、Tomb或聲音。關閉／收合清除preview clock／canvas；
真NPC對話／商店、死亡、換場、斷線優先關閉工具。世界與怪物不暫停，建議目前無怪城鎮使用。

## 6. 回歸來源與交付

新增 `native-avatar-motion.test.ts`：倒數／捨棄overshoot、不同delay與稀疏index、rope整數Y／停格／恢復、
反向／look／死亡／snapshot／face獨立、背景上限、metadata退避／飽和／clear、真WZ／兩手姿勢與合成、readonly工具整合。
`webclient.test.ts`追加HTTP真metadata、unarmed／雙手劍／斧與非法範圍；舊jump及motion probe僅更新來源，沒有執行。

沿用既有 `generated/preview-faces-20261018.json`，**不重seed、不覆寫進度**；停服冷備後重開web8515。
帳號仍preview/preview與observer/observer。只確認啟動日誌／監聽，不登入或執行功能probe，不宣稱PASS。
