# 背包擴充捲動、丟棄與商店數量操作（2026-10-17）

> **本輪依使用者要求不執行測試。** 未執行 unit／VM／Chromium／TypeScript 檢查，亦未登入操作角色。
> 本文件記錄已寫入的實作與原版來源，不是 PASS 報告。
> `EQUIPMENT_VALIDATION.md` 的570項與瀏覽器結果屬於前一輪，不能當成本次修改的驗證結果。

## 本輪實作

### 1. 背包超過24格的可見範圍

- 保留原162×315視窗、4×6格、35px pitch，不另畫放大的背包。
- 使用原(147,80)、高208px的 `UI/Basic.img/VScr`；可點上下箭頭／軌道、拖動thumb、在背包上滾輪。
- 每次位移一列四格；四個分頁各自保留本次連線的row，不新增服務端存檔欄位。
- 第一可見格 `4*row+1`，顯示、命中、tooltip／選取、拖放與雙擊都沿用真slot號，並非將第25格冒充第1格。
- 以服務端回來的capacity夾限，不偽造空間或解鎖格。容量24時顯示原disabled scrollbar。
- 超過24格才有捲動範圍；一般既有24格角色不會因本次更新自動擴包。

### 2. 道具丟到地面

- 背包道具拖至**遊戲場景畫布**放開，送原 `0x17 tab/from/to=0/count`。
- 一般堆疊>1：原韓文「몇 개나 버리시겠습니까?」，預設整疊、最小1、最大持有數。
- 裝備／單件：數量1；207飛鏢：整組丟棄，不把可充能的一組拆成任意數量。
- 4031家族先顯示不可回收的Yes/No警告。已穿戴物不直接丟，先卸回背包。
- 原WZ cash或wire cash serial均拒絕。WZ讀不到亦取消，不能把未知當可丟棄。
- 對話框期間不樂觀扣除道具；原非零0x0B ack才解除搬移pending，保留500ms gate。
- 服務端原有 `dropItem`／0x43廣播與拾取保留，個別裝備能力由那件物件傳遞，不重建模板。
- 正常帶Data.wz啟動時，服務端新增cash／未知WZ防線；無WZ工具模式只有原wire檢查，不稱完整反作弊。
- `count`為s16：普通超大堆疊一次最多32767；整組飛鏢超出範圍則拒絕，不截斷後送。

**取消與保護**：Escape、瀏覽器外／其他DOM控制項、狀態列區域放開均不丟棄。場景可丟區暫限
status panel上方(y<392)，這是防誤丟的瀏覽器邊界政策，不是宣稱已還原native全部透明區域命中。
單件裝備在真正場景放開會直接丟棄（與原sender一致），不是每次都另加確認。

**拾取與存檔界線**：仍沿用既有伺服器「移動靠近後拾取」政策，沒有新增虛構pickup封包。
地面掉落物目前只在運行中的場地記憶體中，**不會寫入角色save**；丟棄後道具從角色立即保存，
若在撿回前關閉伺服器，地面那件道具會消失。請不要以正式重要物品嘗試未驗證操作。

### 3. 商店批量購買／部分出售

- 左列雙擊或사기：一般道具預設1、最小1、最大原0x4A列的maxCount；不是固定只買1個。
- 右列選取或雙擊／팔기：預設整疊，可選部分出售；裝備為1。207飛鏢採整組確認。
- 數量依原u16 wire範圍限至65535。前端檢查總價與當前金額，但是否成功仍由服務端決定。
- 頁面與ClientSession都有shop pending，等原0x4B解除；close不等待也不虛構0x4B。
- 服務端核對購買row（非零price可購買列表）與該列itemId一致、檢查存量／格數／錢，成功立即persist，而非一定等斷線。
- `0x0B`改道具、`0x0D`改錢，不從對話框自己扣錢／加物品。
- 賣出前讀取**當前真tab**的快照，不用itemId百萬位猜tab。既有server／save政策將etc放tab3、cash放tab4，
  與原UI的설치／기타標籤並未完全對齊；本輪不私自搬移舊存檔物品，該映射與資料遷移仍待專項處理。
- shop stock、售價比例、maxCount仍是已有重建伺服器政策；沒有宣稱找到了2003年伺服器腳本。
- **後續更新**：207補充成功分支、整組購買／零發組與楓幣丟棄已寫入，仍未測試；見 `MESO_RECHARGE.md`。

### 4. 共用原數量視窗與過期操作保護

- `client/itemdialogs.mjs`：原 `UI/UIWindow.img/UtilDlgEx/Border/0..7` 拼框、BtOK／BtCancel三態；
  真input及透明button作可編輯／可存取命中，未使用瀏覽器prompt／confirm。
- 數量框內容寬230、外寬252，文字逐行高度+99；文字區(14,36)，輸入與按鈕依native公式。
- Yes/No沿用原 `UI/Basic.img/YesNo/backgrnd`／BtYes／BtNo，不以現代卡片替代。
- 只接受十進位整數；範圍錯誤保留視窗，不送封包。Enter確認、Escape取消、Tab在框內循環。
- 阻擋背後快捷鍵、攻擊、傳送與穿透點擊；開框清除移動鍵。這只是UI modal，不暫停世界物理／網路。
- 換圖／斷線／死亡／關店關閉對話框；送出前再核對角色field epoch、原shop物件與原道具快照，
  防止非同步WZ讀取或別的更新之後，將舊slot上的新道具賣掉／丟掉。
- Yes/No預設焦點No為瀏覽器防誤操作政策；沒有聲稱原Windows預設焦點完全相同。

## 原版依據（靜態閱讀）

| 來源 | 實際讀到的行為 |
|---|---|
| `sub_4DA440` | CCtrlScrollBar id2001，x147/y80/h208 |
| `sub_4DA810` | scroll事件a4更新該tab row，firstSlot=4*a4+1 |
| `sub_4DA8B0` | 切tab讀各自scroll狀態及容量，重新計算firstSlot |
| `sub_4DB170`／`sub_4DB990` | 只命中firstSlot起24格；格座標用slot-firstSlot計算 |
| `sub_463BE0` | 0x17 to0；cash／cash serial拒絕、4031警告、207整組、其他詢問數量 |
| `sub_4643F0` | `535AC0(type2,0,prompt)`，`535C90(total,1,total)` |
| `sub_4B6B40` | 一般buy調用 `4B7960(prompt,1,row[8])`，207確認，裝備1，並比較總價 |
| `sub_4B6E90` | sell調用 `4B7960(prompt,total,total)`，207確認整組，之後重新比對道具物件 |
| `sub_4B7960` | 共用數量框，Cancel回0，OK回input值 |
| `sub_530C20`／`sub_535EF0` | type2內容寬230，外寬+22；textHeight+99 |
| `sub_531110` | 八片Border原貼法：top13、left0、right=w-8、bottom=h-18、右上裝飾w-54 |
| `sub_532A80` | input(16,textHeight+38)，OK(w-119,h-42)、Cancel(w-65,h-42) |
| `sub_535C90`／`sub_532EC0` | 數字上下界與超界拒絕，不是任意字串轉Number後默許 |

韓文以 `tools/kstr.py`讀CP949；WZ只讀取原樹與canvas尺寸，不修改Data.wz，亦未以缺素材fallback代替原圖。
文字字型與換行仍受瀏覽器度量影響，不稱整個對話框已有Windows逐像素oracle驗證。

## 檔案與交付政策

- `client/main.js`、`itemdialogs.mjs`、`index.html`、`style.css`：操作與原圖呈現。
- `server/src/client/session.ts`：cash serial視圖／shop pending與wire欄位檢查。
- `server/src/game/iteminfo.ts`：所有道具家族的WZ cash事實，不只裝備。
- `server/src/net/loginserver.ts`／`cli.ts`：cash拒絕、shop row與死亡狀態檢查、成功交易即保存。
- 舊VM probe來源已適應「先開數量框、再確認」，**未執行**；舊equipment probe的場景外取消案例
  在y400的status區，敘述已改為status-region cancellation，沒有拿它當本輪丟棄測試。
- 本輪不跑既有suite、不跑typecheck、不啟動瀏覽器probe。提交附 `[skip ci]`，避免本次push觸發自動測試。
- 截圖、QA／正式save、node_modules與生成素材仍不進Git；不創建或覆寫正式角色進度。

## 尚未實作

背包內拆疊／合併的完整原版分支、meso丟棄按鈕、卷軸強化、cash穿戴／寵物、補充飛鏢成功路徑、
裝備／buff總值與Detail、自然升級AP/SP與HPMP成長仍未完成。
本輪是四組操作的實作交付，不是全遊戲1:1完成或已驗證可正式運營的聲明。


### 隔離預覽部署

本輪僅重啟既有8595預覽以載入新程式（沒有開測試瀏覽器／登入操作）。保留同一份
`generated/validation/equipment-qa-save-v6.json`，啟動日誌顯示載入5帳號／5角色；重啟前另留本機副本，
兩份save都被Git排除。gear/gear與watch/watch仍為隔離帳號，不是正式進度恢復。
