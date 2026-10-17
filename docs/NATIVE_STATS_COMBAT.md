# 有效裝備、能力詳情與普通物理攻擊（2026-10-18）

> **後續更新**：本輪已接怪物碰撞／實際EVA、紫色字圖、外力及復活；最新主線見
> [NATIVE_CONTACT_REVIVE.md](NATIVE_CONTACT_REVIVE.md)。仍未執行測試。前輪save不在新沙箱，本輪LIVE使用新獨立檔。

**交付狀態：實作／靜態原碼、PE 與 WZ 交叉研究；沒有執行 test、check、typecheck、browser、VM 或 probe。**
啟動 LIVE 只代表服務啟動，不代表功能通過。原 `combat.ts` 的「binary 未定位公式」說法已過時；
舊近似 helpers 只保留給歷史 fixture，瀏覽器不再使用。

## 這輪完整接到的路徑

1. normal worn 1..14 → 原有效穿戴篩選 → STR/DEX/INT/LUK、HP/MP 上限及 SecondaryStat。
2. 已學 map32 與真 Skill 數值 → 3000000.x 命中、4000000.x/y 命中／迴避能力。
3. 同一基底 → S 主窗的 `total (base+equip)`、原 Detail 九列、實際速度／跳躍。
4. 同一基底 → 普通近戰／射擊的命中、武器／動作係數、等差、怪物 PD、mastery 及早期特殊暴擊分支。
5. 2002004 PAD+5／180000ms、2002005 ACC+5／300000ms → 真扣道具、原0x0D、圖示、到期與實際攻擊。
6. 裝備 HP/MP → 狀態列、能力窗、自然恢復、補藥百分比／上限、復活與升級補滿；
   成長 INT 也改用有效裝備。基礎 record 的 maxHp/maxMp 不被裝備值覆寫。
7. 傷害與 MISS → 真 `Effect/BasicEff.img/NoRed*`，不用瀏覽器白色字型冒充原數字。

後續已將EVA／PDD接入原4C8ED0，2002000迴避藥水可實際使用；MAD/MDD與未知效果仍整筆拒絕。
主動技能、魔法傷害、原 CShape2D 逐幀選敵、怪物暫時能力等也未完成。

## 原來源與交叉結果

| 原程式 | 這輪採用的證據 |
|---|---|
| 4C5020 | 14 normal slots；候選扣自身四屬性後檢查；第一件失格移除並從 slot1 重掃；性別、level、job bit、法師武器白名單 |
| 4C5420 | 基礎四屬性及 maxHP/MP 加有效裝備；從實例 signed WORD 讀值，不拿 WZ inc* 覆蓋卷過／骰過的物品 |
| 4C5740 | 下表的 ACC/EVA/MAD/MDD/hands；裝備與兩個被動；PAD/PDD/MAD/MDD/ACC/EVA clamp 0..999；speed/jump 基底 clamp |
| 4BDD20 | 讀已學 map32、正級別、clamp 到原 skill level array；不靠當前職業抹掉既存被動 |
| 4BE270 / 4BE730 | 武器／是否用彈藥選 mastery；讀 level/mastery，clamp 0..15，不把 x 當 mastery |
| 4BE8E0 | 原弓弩／拳套射擊的特殊分支使用已學級別；缺 WZ 書不造技能 |
| 4C7960 | 真正的普通物理計算；不是先前找到的外觀匯出 515CB0 或 HP/MP 成長 4C7450 |
| 48D080 / 4C6940 | 此版怪物攻防欄名是 `PA`、`PD`、`acc`、`eva`；不是後期 PADamage/PDDamage |
| 4BE150 | elemAttr 大小寫皆可；P 槽為物理屬性，無數字／0 的值是999；1減半、2乘1.5，照4C7960分支 |
| 4F0940 / 4F30A0 / 4F13B0 | Detail 176×192、parent+(176,123)、Stat/backgrnd2、x80／y12+18i、九列與格式 |
| 41AF20 / 41E610 / 41F200 / 4882F0 / 485C20 | 傷害第一字 NoRed1、其餘 NoRed0、NoRed0/Miss；origin-aware overlap、50px 組圖、400/600ms alpha、1000ms 上升30px；以 mob 當前 canvas originY 當頂端 |

前輪定位的 **4C8ED0**／5085E0／491FF0 已在後續輪次接到實際碰撞；
其中當前格、491FF0內縮與PA欄名／default0界線詳見新的contact文件，不等於完整CShape2D。

### SecondaryStat 基底

- PAD=0、PDD=0、MAD=INT、MDD=INT。
- EVA=trunc(DEX/4)+trunc(LUK/2)。
- 弓／賊 ACC=trunc(DEX/2)+trunc(LUK/3)；其餘 ACC=DEX+trunc(LUK/2)。
- hands=DEX+INT+LUK；此函數沒有把裝備 craft 加進 hands，也未做該欄 999 基底 clamp。
- normal equip 加 PAD/PDD/MAD/MDD/ACC/EVA/speed/jump，接被動後再做基底 clamp。
- speed 基底100..130／jump100..123；加暫時值後分別80..130／80..123。
- 有效性篩選不等於把失格裝備刪出存檔／脫下外觀；只是決定哪些實例參與能力。
  互相加成而每件扣自身後仍達標的裝備可保留，不自行加入「必須能依次從裸裝穿上」的後期規則。

### Detail 不是傷害上下限

第一列：弓 DEX+basePAD、賊 LUK+trunc((DEX+STR)/4)+basePAD，其餘 STR+basePAD。
同武器可用的第一組彈藥 PAD 加在暫時 bonus 一側。有 bonus 時 `total (base+bonus)`。
其後 PDD、MAD、MDD、ACC、EVA、hands、speed%、jump%；百分比照最終 clamp，其餘原窗直接顯示加總。
主窗 AP 按鈕仍判基礎 record 上限，不拿裝備 total 限制分點。

### 普通物理攻擊

- 從 0x16 三個 seeds 建立第一個 ClientRandom stream；每次目標計算預抽七個 u32，再依分支消費。
  uniform 使用 `u32 % 10000000 / 9999999`，端點先排序；MISS 也已預抽七個。
- 命中數值是 clamp 後 ACC×100/(255+10×正等差)。弓取其0.4..0.8，其餘0.5..1.5，
  小於怪物 EVA 則0／MISS；命中不是用後期百分比公式硬套。
- PAD 把已 clamp 的 basePAD、tempPAD、彈藥 PAD 合在一起後才 clamp0..999。
- 隨機主屬下限係數 `(mastery×5+10)×0.009000000000000001`。
- 劍取 STR、賊短劍取 LUK、弓弩取 DEX、拳套取 LUK；並有 STR/DEX 副屬，
  斧／鈍器／杖與槍矛的 swing/stab 係數不同。法師拿劍的普通攻擊**不是 INT 傷害**。
- 弓弩拳套近戰／action32 是原特別的 STR0.5..1 × PAD × 2/3 分支。
- 低於怪物等級的減益先乘 `(100-等差)/100`；扣 PD×0.5..0.6；成功傷害最後 clamp1..9999 並 trunc。
- 早期特殊射擊分支保留了非常反直覺的 `roll > 3×learnedLevel` 時乘 `5×level%`。
  **已靜態核對 PE 4C88B5..4C88CE 的 x87 compare/test AH 41h/jne 與 multiplier**，
  不擅自換成後期 Critical Shot 的倍率／機率。這不代表已由原版實機驗證所有暴擊視覺。
- mastery 函數的 x/ACC 修改位於本函數命中基準已算完之後，本輪不另加未見於此路徑的命中 bonus。

**界線**：瀏覽器挑攻擊動作還沒有和 native 第一 stream 共用同一個 RNG 序列；
因此只主張已移植算式／該次計算的抽樣，不主張整個原 client 全域 RNG 狀態逐步 bit-identical。
JS double／原 x87 暫存精度也未作逐輸入實機比對。原 field 仍按 0x0F／0x10 的 client damage 落帳，
不在 server 重新骰第二次；目前選敵幾何仍沿用既有有界重建策略，非完整 CShape2D。

## 架構、保存與重建政策

- `client/characterstats.mjs` 是共用純運算；`game/characterstats.ts` 提供 WZ 需求／技能值。
- bridge 在 field/self/inventory/skills 後發 `stat-basis` 給頁面；這是本地 WZ 計算結果的 view message，
  **不是新造一個 native opcode**。包含有效 slots、基底、可用彈藥 PAD 及穿戴需求。
- 進場／裝備／加點／學技能均重新產生；畫面把本地有期限 temp 疊上去，普通攻擊則由 bridge 同樣的 timer model 計算。
  bridge 與頁面各自以封包到達時的 monotonic clock 啟動，網路延遲可能造成極短的到期顯示差；未宣稱時鐘完全同步。
- normal worn 總值不寫回 base record、不重seed、不改現有物品實例。原有裝備視覺仍沿現有 look pipeline。
- **伺服器政策**：脫下增加上限的裝備時，把現有 HP/MP clamp 到新的 effective ceiling；
  補藥百分比依 effective max 計算，沿用原已明示的向下取整政策。這不是聲稱找到了原 server。
- 成長有 archive metadata 時使用有效穿戴 INT。metadata-free 的舊 isolated fixture helper 保留，
  LIVE 的 Data.wz 路徑不走那個近似；未知裝備需求不給能力，不拿缺資料偷偷補模板。
- tool 補滿／半血半魔以 effective cap；還原不回溯裝備，還原後若超新上限會 clamp。
- PAD/ACC 與速度沿用同欄覆蓋、其他欄保留期限、換圖保留／斷線清除，不做離線保存；
  舊 TEMPORARY_STATS.md 的時間／封包來源仍適用，本輪擴充支援效果，不回寫舊輪測試狀態。

## 方便使用者操作

沿用目前的隔離體驗存檔與兩角色，不建立或重置帳號。重啟前停止寫入服務後另外冷備份。

1. 在 LIVE 登入現有帳號：`preview / preview` 或 `demo / demo`。
2. 按 **S → Detail**；可拖動主窗觀察相鄰詳情，按 Detail 再收起。
3. **E** 看／脫穿裝備；主窗加成、Detail、HP/MP 分母與速度使用同一有效集合。
4. 上方 **體驗工具（非原版）**／`/tools`，勾同意後才按 **領取攻擊／命中藥水各3瓶**。
   這是明示開發發放：2002004×3＋2002005×3，會保存；背包不足整批不發，不自動修改角色。
5. **I → 消耗** 連點使用。Detail 的攻擊／命中與右上原圖示會變動；Ctrl 普通攻擊採用同一暫時值。
6. 若要學弓／賊能力，可在工具表單選原有書職業、明確給 SP，再到 **K** 點原被動。
   這不是轉職、不發原版自然 AP/SP；後續輪已將4000000的EVA接到實際碰撞判定。
7. 原補滿／半血半魔工具、地圖搜尋與獵場入口仍保留；還原點只含能力／技能，
   不回收領到或喝掉的藥水，不回溯 EXP／金錢／位置，不跨服務重啟。

## 未執行的回歸來源

- `test/native-stats.test.ts`：自身資格／連鎖失格／互相支持、signed 實例、基底 clamp、Detail、有效 vital cap、
  native 七抽樣／MISS／PD、真 WZ 被動與 PAD/ACC 藥水。
- `test/native-damage-render.test.ts`：首字 bank、origin-aware overlap、jitter、MISS raw centering、不補 CSS font。
- `test/items.test.ts`：新增 PAD/ACC timed spec、未支援 MAD 混合整筆拒絕；後續輪改為EVA接受、MAD混合仍拒用。
- `scripts/equipment_probe.mjs`：更新 worn requirements fixture 對應有效裝備篩選；僅來源調整，未執行。

沒有用歷史570/570、舊 PASS、格式化、git whitespace 檢查或服務啟動來宣稱新功能驗證通過。

本輪啟服前的 ignored 冷備份：`generated/preview-before-native-stats-20261018-8190232611359.json`；沿用同一 save，不由備份覆蓋現有檔案。

交付啟服：Web **8495**、login8496／game8497，綁定0.0.0.0；啟動日誌讀到原檔2帳號／2角色。
這只是服務啟動紀錄；沒有自動登入、模擬操作、瀏覽器截圖或功能PASS。
