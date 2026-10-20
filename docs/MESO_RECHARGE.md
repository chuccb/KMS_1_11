# 楓幣丟棄與飛鏢整組操作（2026-10-17；207商店鏈已測2026-10-20）

> 2026-10-20 後續（ADR-101）：**207飛鏢商店鏈已補齊行為測試**——補充列（4B3780八列price0＋每發單價
> float64隨`0x4A`上線）、整組購買（wire count1、發數=slotMax、不合併）、recharge成功／ceil計價／拒絕矩陣
> （已滿badRequest、非207 notInShop、空格／現金序號notEnoughItems、錢不足notEnoughMesos不動組）、整組出售
> 與0發組（`floor((price+ceil(qty×unit))×0.5)`、部分出售拒絕）為 `shops.test.ts` 五支unit；`0x16` action2
> 真socket整合（`0x4B` silent＋`0x0B` put 500＋`0x0D`、拒絕恰一個`0x4B`）為 `serve.test.ts`；頁面충전橋
> （成功三事件、壞slot頁面錯、已滿code255、賣0發組count0放行到server）為 `webclient.test.ts`。同輪修復
> 該static交付 silently 弄壞的四支既有測試（兩支shops列斷言、serve商店開門列數、webclient舊錯誤訊息regex；
> USE-tab測試並在a1a1d9e的use閘後首次走到use相位——補「先關商店窗再喝藥」的玩家流程）。
> 2026-10-20 再續（ADR-102）：**楓幣丟棄 `0x1F` wire請求鏈已測**——`serve.test.ts` 真socket整合
> （成功＝`0x0D ack1`＋錢包diff＋全圖 `0x43` kind2 15bytes無怪物塊、連發管道化的200ms速率閘、
> 手工raw字節越界9/50001、超錢包、開商店窗互斥、`0x1C` 致死後死亡閘，每個拒絕恰一個空diff
> ack1）＋ `webclient.test.ts` 頁面橋（self／meso-drop-result changed:true/false、drop-enter pile、
> session端三個throw成為頁面error）。同輪修復三支基準欠帳：兩支 throw-away（`0x17` toSlot0丟物）
> 與 spawn-walk 測試的結構性陷阱（`zeroStats()` hp=0 撞死亡閘 ×2；測試中段 `client.close()`
> 把後加的 mob-walk 相位擱死在已關socket上；修好close後該相位的 `vx===0` 斷言又被發現從未跑綠——
> roam首腿隨`Math.random` intent是站定或walk腿，斷言已改為對兩者皆成立的不变量）。
> **仍未測**：BASIC_ATTACKS 的射擊扣彈。

> 2026-10-18 ADR-083續作：玩家丟物／丟金幣的權威落點已接真fh，focused73/0、原100圖與真browser component已跑。
> 只認證掉落落點／呈現鏈，不把本頁原UI／扣帳歷史場景全部改列PASS；見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。

> 後續狀態更正：本文件的驗證／未完成清單為當輪歷史。HP／MP自然成長與配點已由原表接上（**新改動未測試**），舊「成長表不在client」判讀已更正；自然AP/SP發放、完整Detail／buff仍缺。見 [STAT_GROWTH.md](STAT_GROWTH.md)／ADR-047。

> 依使用者指示：**沒有執行 unit／socket／VM／browser／typecheck，也沒有登入角色或修改存檔。**
> 只靜態閱讀原反編譯、解析 Data.wz 取證、修改來源及整理 Git。新增 golden 測試來源亦未執行。
> 既有文件的570項 PASS 屬歷史紀錄，不能當作本輪驗證。

## 操作與已接通範圍

### 背包丟楓幣

- `I` 打開背包，點左下金幣按鈕。使用原 `Item/BtCoin` 四態素材，原位置 `(8,294)`、17×17。
- 原韓文 `얼마를 버리시겠습니까?` 數量窗；預設10、最小10、最大 `min(持有楓幣,50000)`。
- Enter／確定送出；Escape／取消不送、不扣錢。錢不足10不開無效範圍的框。
- 經 WS → ClientSession → **原 c2s `0x1F + u32 amount`** → GameEntryServer；不是捏造聊天命令或道具搬移。
- 服務端檢查 alive、金額整數／範圍／餘額、200ms、未在商店／NPC對話／交易中，才扣同一個角色錢包。
- 成功回 `0x0D ack=1 + mesos diff`；拒絕也回 `0x0D ack=1 + 空diff`，避免pending鎖死。
  普通拾取／狀態更新的ack0不會解除這個請求；頁面不預先扣錢。
- 以現有 `0x43 placed` 錢幣物件廣播同圖；地面池負責後來進場、拾取與到期移除。
- 沿用重建伺服器「掉落後移動靠近拾取」政策，不新增原版不存在的pickup請求。
- 扣款與拾取成功皆立即persist。錢包容納不了整筆時保留地面楓幣，不再夾限後吞掉溢出部分。

### 飛鏢購買、補充與出售

- **마이（NPC12100，암허스트／1010000）**的重建商店新增수비 표창基本組。
  購買採原整組確認，wire count固定1，給一個獨立格、發數取WZ slotMax；不是買1發。
- 所有既有WZ商店均提供八種207飛鏢的補充列：`0x4A` 的 price0列只供補充，不顯示為可免費購買。
  非零price列才編入左側buy index，後端也用同一列表核對row／itemId。
- 選消耗頁右側未滿的飛鏢組，按 **충전**，顯示原 `정말로 충전하시겠습니까?` 確認窗。
  已滿、非207、沒有補充列、現金序號的組不啟用補充。
- 原 `0x16 action2 + u16 slot`；服務端重新查真實格／id／剩餘發數，費用
  `ceil((WZ slotMax - currentQuantity) * WZ unitPrice)`。不足錢不扣、不改發數。
- 成功走共用 `0x4B` 回應、`0x0B put` 更新發數、`0x0D` 更新錢、立即保存。
- 相同id的飛鏢組在購買、拾取、交易取得時**不合併**。整組丟棄／出售／交易不得只送部分發數。
- **0發仍是一組物品**：背包與tooltip顯示0，允許原整組出售、丟棄、拾回及伺服器交易。
  不再以 `max(1,count)` 把空組撿成1發；交易放桌／成交兩層都拒絕部分拆組，且不能重複放同組。
- 右側原生價格顯示修正為 `info/price + ceil(quantity * info/unitPrice)`，不是錯誤的
  `quantity * info/price`。207整組實際回收價為該基數乘既有 `SELL_PRICE_RATIO=0.5` 後向下取整；
  一般道具仍保持既有每單位回收政策。**顯示基數不等於原伺服器實際回收價證據。**

## 原版證據與本輪更正

| 來源 | 靜態讀到的事實 |
|---|---|
| `sub_4DA440` | CUIItem button2002在(8,294)；WZ `Item/BtCoin` 各態17×17 |
| `sub_4DAF70` | 原量框type2，`535C90(10,10,min(wallet,50000))`；韓文提示已直接以CP949解讀原檔comment |
| `sub_55D5F0` | opcode31、4-byte amount；pending／HP／200ms，送出後arm gate |
| `sub_4B3780` | 207額外8 bytes複製到row+24；全部207進補充列表，只有price非零進可購買列表 |
| `sub_47A1D0` | 讀WZ `info/price`及`info/unitPrice`，後者轉double |
| `sub_4B4AD0` | 售出列值 `basePrice+ceil(count*unitPrice)`；補充值 `(rowCapacity-quantity)*rowDouble` |
| `sub_4B7130` | 補充值非零才確認，核對原格物件後送action2／u16 slot |
| `sub_464000` | 207交易拖放直接取整組發數，跳過一般道具數量窗 |
| `sub_4D5C80` | 放交易桌允許ArgList0但僅限207；一般道具不得0 |

**重要更正**：以前把商店207的8 bytes保留為未知 `cash`，只讀到copy位置就停止追查。
現在由其後續double讀取與乘法確認為**補充每發單價**，不是現金道具序號。
codec保留舊 `cash?: Uint8Array` 欄名相容既有trace，但提供明確float64 LE編碼／解讀helper。
同時修正JS家族判斷必須 `Math.floor(itemId/10000)===207`，否則2070001等會錯讀後續欄位。

### 本機 Data.wz 實際值（只解析資料，非測試）

| itemId | 原名稱 | price／組基數 | slotMax | unitPrice／發 |
|---|---|---:|---:|---:|
| 2070000 | 수비 표창 | 250 | 500 | 0.3 |
| 2070001 | 월비 표창 | 500 | 500 | 0.4 |
| 2070002 | 목비 표창 | 1000 | 700 | 0.5 |
| 2070003 | 금비 표창 | 1500 | 500 | 0.6 |
| 2070004 | 토비 표창 | 2500 | 400 | 0.6 |
| 2070005 | 뇌전 수리검 | 2500 | 600 | 0.7 |
| 2070006 | 일비 표창 | 5000 | 800 | 0.8 |
| 2070007 | 화비 표창 | 25000 | 600 | 1 |

## 政策、未完成與安全界線

- 商店stock、哪些店提供補充、購買給滿組、補充費整數向上取整、50%回收仍是**重建server政策**。
  原2003商店腳本不存在於Data.wz；不可宣稱這張stock表是原服1:1。元資料、UI分支與wire格式有原碼證據。
- 容量只採WZ基礎slotMax；技能增加彈匣容量尚未實作。異常／超容量舊組拒絕補充／出售，不截斷存檔。
- 此輪當時未接的**基本選彈／投射物／射擊扣彈**，後續已由 [BASIC_ATTACKS.md](BASIC_ATTACKS.md) 接通（同樣未測試）；技能多發／容量等仍未完成，不能以補充服務宣稱完整職業完成。
  新買滿組不會靠現有近戰Ctrl自動耗彈。本輪沒有直接改QA存檔製造少發數的物品。
- 交易變更限原有服務端路徑；完整瀏覽器交易視窗仍未完成，不把後端支援誤稱成可點擊UI。
- 新meso request與AP／背包／商店互斥，但整個native CWvsApp跨所有動作共用的全域gate仍未完整重建。
- **地面物件不持久化**。角色扣款／移除已保存；未撿就停服或到期會消失，這是現有地面模型限制，
  不是角色save也會保存地面。沒有建立、覆蓋或替換任何正式／隔離存檔。
- 自由拆疊合併、204強化、cash／pet、自然AP/SP/HPMP成長、Detail／buff totals等仍未完成。
- 這些改動尚未實測；沒有啟動／重啟預覽以免影響使用者當前自行操作中的角色。
