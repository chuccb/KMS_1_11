# 「面板29、傷害全是1」：裝備生成漏接與傷害資料鏈

2026-10-18，接續 `1c628c7`。**未執行 test／check／typecheck／browser／VM／probe。**
本輪為靜態原碼／PE／WZ／現有存檔資料審閱，以及實作與未執行回歸來源；不是功能 PASS。

## 1. 這次不是把最低傷害硬調高

在目前獨立體驗檔中，角色 STR=29、DEX=8，穿戴的原起始劍 `1302000` 卻是：

- 實例 PAD=0；全部15項裝備能力=0；ruc=0、cuc=0。
- 原 `Character/Weapon/01302000.img/info`：**incPAD=17、tuc=7**，price=1、attackSpeed=2。
- 原 Detail 第一列是 STR+basePAD，不是傷害上下限；所以舊資料正好顯示29。
- `4C7960` 以實際 PAD 乘入傷害，PAD=0 就先得0，成功命中最後 clamp1..9999，於是顯示1。

**直接原因是先前建角裝備生成錯把空白 decode 結構當成完整裝備。**
`equipSlot(id)` 的全零結構本身可以用於協定解碼與 isolated fixture，卻不能當作有 WZ 的新裝備生成。
前輪「能力使用實例，不用模板覆蓋」方向仍正確，但漏接了「新實例必須先有正確數值」的前置條件。
先前手造 PAD fixture／bridge 回歸不能證明真實建角資料完整。

這次不會用 `Math.max(29,damage)`、把 Detail 當實際傷害、給虛構武器，或在每次攻擊時偷偷以 WZ 覆蓋實例。
正常低擲值／高防禦／等差仍可能打1；未命中仍為0／MISS。

## 2. 原來源交叉確認

| 原來源 | 這次確認的內容 |
|---|---|
| `478270`，本倉庫 MapleStory.exe.c/.lst | info/tuc→BYTE+44；15項 inc*→WORD+46..74，缺省0 |
| `47A740`，同一版本 C／listing／PE objdump | 先建 GW_ItemSlotEquip，再把模板 tuc／15項 WORD 寫入帶 XOR 保護的實例；cuc設0。不是只建空白結構 |
| `45E6A0` | 配置並從封包解碼既有實例；其全零初始結構不是物品生成規則 |
| `4C5020`／`4C5420`／`4C5740` | 有效穿戴、實例 signed WORD 能力、SecondaryStat PAD；不拿模板蓋掉卷過／骰過的物品 |
| `4F13B0` | Detail第一列不是傷害上下限；一般職業 STR+basePAD，另有暫時／彈藥顯示側 |
| `4C7960`、`4BE270`／`4BE8E0` | 七個預抽值、命中、mastery、武器／動作、等差、屬性、PD及最後clamp/trunc；本輪未改成後期公式 |
| `Character/Weapon/01302000.img/info` 靜態 dump | incPAD17／tuc7／price1；起始劍不是沒有攻擊力的純外觀 |
| `Etc/MakeCharInfo.img` | 男女建角各六組選項；修復白名單只取衣／褲／鞋／武器，不硬套後期起始道具表 |
| `55BAB0`／原0x0B | op0與負slot可以更新已穿戴的完整裝備實例；無須發明PAD修復opcode |

十五項對照：

```
str/incSTR dex/incDEX int/incINT luk/incLUK
maxHp/incMHP maxMp/incMMP pad/incPAD mad/incMAD
pdd/incPDD mdd/incMDD acc/incACC eva/incEVA
craft/incCraft speed/incSpeed jump/incJump
```

數值採此版 signed WORD／BYTE欄寬；**目前生成策略是原 WZ 基準值**。
這不代表找回了消失的原伺服器隨機裝備品質／掉落骰點或卷軸系統，沒有造不明隨機範圍。

## 3. 這輪補齊的相連路徑

### 新物品生成，不覆寫既有實例

- `iteminfo.ts` 匯出完整 equipment template（15項＋tuc），與現有 requirements／price／icon 共用原圖像路徑。
- `game/equipment.ts` 統一建立正常非cash裝備；缺模板就拒絕，不用零能力遮掩漏資料。
- CLI把同一裝備catalog交給 login：新建角色的衣褲鞋武器均先填原數值再寫 CharacterData／save。
- 新的無實例裝備掉落拾取走同一工廠；既有丟棄物／交易物有原實例時，優先逐值保留。
- 商店共用 catalog，修掉只查 Item/、查不到 Character/ 裝備價格的舊路徑；裝備買入也填完整能力。
  單件裝備限制count=1，不再可能付兩件錢只建立一個實例。現有商店貨單不擅自增加。
- 掉落／交易重用既有實例，不因模板載入而還原ruc/cuc、清掉強化或改能力。
- 商店沒有實例的 tooltip 可顯示模板；背包／已穿戴物即使是全零stats也仍顯示實例，不偷偷替換。
  正負能力的符號亦分開，避免出現 `+-1`。
- 沒有archive的協定fixture仍可使用空白結構；LIVE的WZ新裝備路徑不應使用該fallback。

### 原有角色：只提供明確確認的受限修復

沒有 load-time migration；沒有直接改這次的使用者存檔。

1. 只允許既有 `--test-tools` 授權、目前帳號已進場角色。
2. 使用 MakeCharInfo 的起始裝備白名單。
3. 只有**全部15項=0、ruc=0、cuc=0、cash=null**的正常穿戴物／裝備欄物品才列為候選。
4. 非全零、已升級、非起始清單、cash／無可讀模板的物品均保留。
5. state僅列候選數，不修改；`confirmed:true`且活角色才可套用。
6. clone／預先編碼0x0B後才替換與保存；物品ID不變，能力與tuc改成原WZ基準。
7. 不重設角色、職業、STR/DEX等基礎能力、AP/SP、已學技能、EXP、金錢或地圖。
   若新有效上限較低，僅沿既有政策clamp超上限的HP/MP，不補滿／復活。
8. 重複操作無候選就不改；能力／技能checkpoint不回溯裝備修復。

全零特徵並非原伺服器的物品來源證明，所以這是明示工具，不能自動把所有零數值裝備當成壞檔。

### 傷害可追溯，不再只能看最後的1

- `rollNativePhysical` 可輸出同一次計算的唯讀trace：有效武器、base/temp/ammo PAD、命中、mastery、
  原始傷害、等差、屬性、PD擲值、此早期版本特殊倍率、clamp/trunc前與最後數字。
- 不多抽RNG、不另骰一次、不以trace改計算結果。MISS不執行後續傷害算式。
- 既有browser-local `hit`訊息附trace；原TCP仍送0x0F／0x10，沒有新造原版傷害opcode。
- 「體驗工具」另顯示唯讀戰鬥資料及上次有目標攻擊；不把除錯文字塞進原Detail視窗。
- trace分辨總PAD0、無有效武器、MISS與正常最低傷害區間。
- hit回覆附field generation，換圖／斷線清掉舊trace，不把上一張圖的計算顯示成新圖攻擊。

## 4. 原案例的算式預期，不是已跑出的驗證

STR29／DEX8、PAD17、無mastery、同級、無PD／物理屬性：

```
factor = (0*5+10)*0.009 = 0.09
raw = (uniform(29,29*0.09)*4 + 8)*17/100
```

其數學端點約為3.1348..21.08，截整後3..21；Detail第一列為29+17=46。
這**不是保證所有怪物每次都打3..21**：等差、防禦、MISS、武器／動作及其他已支援分支仍會影響結果。
不應為了讓畫面數字接近29而改公式。

## 5. 方便操作與進度保存

刷新 **8515 LIVE PREVIEW**，使用原帳號／原角色，不必重建：

1. `/tools` 或上方「體驗工具（非原版）」；state會列出符合的舊全零起始裝備數。
2. 先看唯讀區的有效武器與裝備PAD；修復前原案例為0。
3. 勾選同意，再按「修復舊全零起始裝備（N件；原WZ值）」。若已死，先使用原復活窗。
4. E／I可看實例能力及可升級次數；S→Detail仍遵原顯示，不改成傷害上下限。
5. Ctrl有目標攻擊後，可在工具查看同次計算的各階段；不須先套體驗職業或領藥才能修復。

本輪沿用已有 `generated/preview-death-20261018.json`，不另seed新帳號／不重建角色。
重啟前先停止舊寫入程序，再在ignored `generated/backups/` 冷備份，才重開同一路徑。
本輪已停止舊程序，冷備份至 `generated/backups/preview-death-before-equipment-20261018-064202.json`，
原檔與備份SHA-256相同（4b2dff05…1d76b103）。重開後日誌為**讀取原檔2帳號／1角色**，並忽略seed帳號參數；
web8515／login8516／game8517監聽0.0.0.0。未自動登入／修復／建角，也沒有執行功能探測。
原暫時能力仍遵既有斷線清除政策，未聲稱重啟可恢復buff期限。備份、save與WZ dump不提交Git。

## 6. 未執行回歸／界線

- `equipment-generation.test.ts`：15欄與signed WORD、PAD17/tuc7、新建角、原案例、原0x0B負slot、
  受限修復／冪等／不自動migration、既有實例保留、掉落／商店與裝備count。
- `webclient.test.ts` 新原WZ裝備模式：舊零PAD→trace1、未確認拒絕、確認修復→原inventory／stat-basis／保存、
  再攻擊的新PAD與越權拒絕。這些只是新增來源，沒有執行。

仍未完成：原裝備隨機品質／卷軸、active skills／magic、全部buff/passive、完整CShape2D/CVecCtrl與30ms同步。
本輪不聲稱全域RNG／x87逐bit一致，也不以舊測試或啟服為此修改背書。
