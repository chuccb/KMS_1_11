# 原版公告視窗與六列螢幕訊息

2026-10-19，ADR-088。這輪補的是實際接收鏈，不是另一組登入／戰鬥 probe。
`EXE → listing → Shape2D.dll → WZ → protocol → ClientSession → JSON bridge → strict browser state → canvas/DOM/audio` 交叉。
不改移動速度、相機、傷害、伺服器獎勵或存檔；不宣稱整個遊戲或全案 TypeScript 已完成。

## 這次真正改動的行為

- `0x13/type0` 保留 `[공지사항] text`、StatusBar font5；不再丟失 type。
- `type1` 是 **CUtilDlg1000 的單 OK modal**，不是中央跑馬燈、toast 或永久橫幅。未知 type 必須先讀完 string，再忽略；不能因未實作而把連線打斷。
- 金幣、道具、背包拒絕與**同等級正向 EXP**走原六列螢幕訊息，不再灌聊天紀錄。
- 移除數字 itemId 假名稱與40次輪詢改字。名稱未載入不畫假字；未知／空名稱不新增列。
- 共同道具 metadata cache 不再把網路／500／JSON 錯誤永遠當「WZ沒有這個道具」。只有404負快取；共用 promise、暫時失敗重試、有限快取／請求與可取消生命週期一起整理。背包／商店／需求／音效／tooltip沿用同一份 archive facts，**不是裝備 instance**。
- 撿取聲改接 `0x44` 自己的實際 taken，重複移除不重播；獎勵訊息、別人撿取、拒絕、消失本身都不播放 PickUpItem。
- 一般 Yes/No 同時更正原按鈕位置與文字排列，補 Y/N；不改 quantity/text 的 UtilDlgEx 版面／驗值。

## 原證與常數的意思

| 原檔位置 | 可確認的行為 | 本輪實作 |
|---|---|---|
| EXE `55CDE0` | 讀 `u8 type + CP949 string`；0→StatusBar、1→52BBE0、其他忽略 | `protocol/notice.ts`／`client/session.ts` |
| `52BBE0 → 52C320 → 461C50 → 461DD0` | 建 type1000 CUtilDlg；依背景尺寸在800×600置中，進入 modal loop | `itemdialogs.ts` notice；與原輸入 modal 共用 capture／焦點守衛 |
| vtable `587720` 的 +0C／+1C／+28 | `52B8B0` OnCreate／`52BDC0` commands／`52C4C0` paint；**52C8E0是GameMenu，不能拿來推提示窗** | binary evidence regression |
| EXE UTF16 `5BCA8C`／`5BE5C0` | `UI/Basic.img/Notice/backgrnd`／`YesNo/backgrnd` | 真WZ PNG，不自製近似框 |
| WZ Notice背景264×132、origin0,0；`461C50` | 一般提示窗 `(268,234)`，不是死亡提示的 `(268,104)` | `BASIC_DIALOG`／既有 death/revive 不變 |
| `52B8B0` | Notice OK ID1相對 `(100,92)`；Yes ID6 `(59,92)`、No ID7 `(140,92)`；Basic按鈕65×24；DlgNotice聲 | 同一個 DOM/modal owner，notice只留一個可操作OK |
| `525880`／`52C4C0` | 僅 CRLF 分行，不依寬度折行；保留空列。14px行距，y=`trunc((43−14n)/2)+43`；x=`15+trunc((234−width)/2)` | 明確文字帶：top43／height43／left15／width234；超出以原窗範圍裁切 |
| `527720`、UTF16 `5B3A00` | **굴림/Gulim 12px**；font0白／1黑、4黑／5白 | 螢幕訊息黑影(1,1)→白前景；Basic dialog白影(1,1)→黑前景 |
| `4EB080`／`4EB440`／`4EBA30` | 六個290×14 layer，取head移tail，右齊290；畫面x504／y382+14i，第一則在y452，滿後向上輪替 | `screenMessagePool`；過期不compact、不把下方訊息重新排到頂列 |
| `4EB440`／listing `4EB8CB`、`4EB968..4EB9B7` | alpha先設255，再RelMove到0，終點為原layer時刻+6000ms | 每則從接收時刻算6000ms，不等名稱到才重新開始 |
| Shape2D vtable `10019160+98 → 10011030 → 10010AD0`；`100199F8+8 → 10010C40` | 預設非循環的整數線性插值。對負delta向0整數除法，不是浮點0.5或先等再fade | `alpha=(255−trunc(255×clamp(age,0,6000)/6000))/255`；3000ms為128/255，5999ms為1/255 |
| `55C130`／`479D30` | 金幣 `%d`；道具只有非空archive名稱才畫，count>1才加` %d개`；其餘type拒絕 | 保留signed32格式語意，包括wire高bit；不改實際伺服器數量／獎勵 |
| `55BEB0` | 更新前後level相同且EXP增加才畫`경험치를 얻었습니다 (+%d)` | field先建立比較基準；同值／下降／升級／不同角色不誤報；原LevelUpFX路徑不變 |
| `4A95B0` | drop pool存在、移除kind2、taker為本機id才播PickUpItem；移除池避免重播 | `beginDropPickup`回報首次轉態，main只對自己播一次 |
| Game建立處呼叫 `4EB080`，僅在singleton不存在時建立 | 已完成的螢幕列不是每張field重建 | 換場保留已成立的列及原期限；取消尚未完成的舊field查詢／modal排隊 |

上述原證由實際C、listing與PE位址交叉，不把反編譯中截成 `"UI"` 的UTF16標籤當成完整路徑。
Data.wz 素材存在；`art.reader.at()` 回傳 CanvasArt，不能用不存在的 `.type === "canvas"` 判定缺素材。

## 模組與完整生命週期

- `feedback-data.ts`：unknown JSON投影／原文句／EXP比較／六列池／Basic版面與整數alpha，無DOM／連線。
- `feedback.ts`：注入 dialog、item lookup、clock與chat；type1 FIFO、不搶 quantity/text/confirm、creation/revive/NPC/menu/lab；收件時序與field generation。
- `feedback-renderer.ts`：UI座標、逐列clip、右齊與shadow；save/restore含throw分支，不污染外層alpha／transform。
- `itemdialogs.ts`：confirm accept沿既有API回傳1代表接受，不冒充native raw6/7；notice是本機視窗關閉，不發伺服器ack。共用Notice／YesNo／UtilDlgEx，隱藏並disable不適用的Cancel，單OK Tab/Shift+Tab trap，Enter-repeat不連續接受下一窗，Escape取消且不回傳同意。
- `item-metadata.ts`：共用promise、校驗回傳item identity／name與既有tooltip投影、404負快取、暫時錯誤重試、clear/dispose的AbortSignal與generation；不是宣稱所有native item schema遷移完成。
- `protocol/notice.ts → ClientSession → net/client-event-json.ts`：byte type保留至真bridge，不使用測試專屬轉換偷代換。type0舊encoder呼叫仍可用；type1需明示；unknown type不冒充已知modal。
- `main.js`：先投影feedback、再走其餘收件者；UI render接池，標題分支也畫已開提示窗。連線開始／關閉清理，level比較不碰角色值。
- `login-screen.ts`：其他modal/lab開啟時，標題Escape不能先關到背後的登入窗；遊戲既有itemDialog.open輸入守衛繼續共用。

斷線／新登入清除全部暫態列、排隊與比較基準；換場取消未完成名稱與其持有的notice，但不重置已完成列的壽命。
不同owner的編輯窗不由feedback任意關閉。dispose後不開始新查詢；晚回覆不得重新添列或清掉新世代的同id請求。

## 明示的 browser 政策與剩餘差異

1. 原版名稱是同步WZ查詢；browser用同origin API。冷名稱可能較晚出現，但保持接收順序和**原到期時間**；已淘汰／過期／舊field不補畫，不以numeric fallback掩蓋。
2. 六列是原常數；**六個pending名稱、16個待顯示modal**是有限browser工作量政策，不是原server獎勵限制。modal overflow明報，不默默假成功。
3. 共用metadata **1024快取、64併行、1000ms暫時錯誤cooldown**也是browser預算。成功與404依容量淘汰；原素材不是永久因一次HTTP錯誤消失。沒有本機帳號、角色或道具變更。
4. 原Yes/No預設焦點Yes；現行browser**刻意保留No先焦點**避免破壞性操作被殘留Enter接受。Y/N／位置／文字對原證，焦點安全政策不假稱完全等價。Notice按原版焦點OK。
5. Gulim缺少時仍用既有KMSCJK字型，Canvas量測／raster與原IWzFont/GDI並非逐像素等價。鍵盤focus沿既有UI用mouseOver素材提示，亦不是Win32全視窗管理port。
6. 收件與繪製仍在browser RAF／本地clock，沒有把全域native30ms相位、所有UI z-order／native modal loop、server原腳本與其餘對話caller一次宣稱已還原。
7. Magic Guard／Booster本輪只研究，未猜後版MP分攤、取整、temporary mask或施放幅度；維持既有未知／限制。

## 驗證與安全邊界

本輪重新核對registry latest：Bun1.4.3／TypeScript7.0.2／typesBun1.4.3／Prettier3.9.10／Playwright1.64.1／Chromium153.0.0，與exact pins一致；沒有因改功能隨意更新依賴。

- 本輪前完整基準：**1064 pass／44 fail／1108 tests／124 files，319.36s**。不是引用前輪267.35s結果。
- 新回歸：所有256個notice type＋每個截斷、CP949 bytes、合併加密TCP收件→真JSON projection→chat/modal、六列輪替／期限／整數alpha、EXP四種抑制、notice FIFO／owner／focus／Tab／Escape、非同步反序／缺名／容量／錯誤／取消。
- metadata回歸涵蓋651個原equipment template＋3個consume/ammo/etc代表（654份archive facts）、共用promise、404不讀body、network/500/JSON/identity/name暫錯重試、clear/dispose/old-finally、容量與無效id。
- 原EXE／Shape2D的vtable與UTF16二進位anchor另有regression，不用生成的文字反向自證。
- **真Chromium DPR1/2 component**：實際production modal HTML/CSS、真WZ Notice/YesNo/BtOK/Yes/No PNG、真API道具名稱、鍵盤／滑鼠遮罩與throw後canvas恢復；無WebSocket／帳密／遊戲actor／save。
- **最終完整：1090 pass／44 fail／1134 tests／129 files／5315 expects，320.71s**。逐file＋test label（含重複）對本輪1064/44基準，failure multiset **新增0／移除0**；新增26項通過，不刪既有失敗測試，CI仍不綠。
- **focused49/0（8 files，6.82s）**；strict型別／全TS格式／browser build／diff檢查通過。41個純imports／0 I/O；446個文件內相對連結有效。
- LIVE相同程序PID6716持續運行，93個TS模組全部HTTP200；最新只讀title frame29、2canvas、有原Title素材、errors[]／0WS。不因新增共用metadata模組重啟世界，也不宣稱已操作測試實際角色。
- LIVE僅做GET-only title frame與原素材可達檢查；不自動登入、不選／建／移動／攻擊角色、不寫玩家save。所有TCP回歸均為拋棄式synthetic peer，不連玩家服務。

重跑（先依[工具鏈](TOOLCHAIN.md)設定Bun）：

```sh
bun run typecheck
bun run format:check
bun test server/test/native-feedback.test.ts server/test/native-feedback-session.test.ts server/test/native-feedback-evidence.test.ts server/test/item-metadata.test.ts server/test/feedback-browser.test.ts server/test/native-chat-gameoptions.test.ts server/test/typed-ui-components.test.ts server/test/probe-session.test.ts
bun run test
bun run build
# 明示現有web port，預設只讀title、0WS：
bun server/scripts/frame_probe.ts 8515
```

## 方便自行體驗

缺舊save／舊程序已確認；本輪另開**全新記憶體隔離世界**（不是恢復），web8515／native8516／game8517。
`preview / preview`或`observer / observer`；由使用者自己建立角色、操作既有體驗工具與實際遊戲。
新收到的EXP／掉落／拒絕會自動走本輪呈現；**不是每則都能由無怪城鎮立即觸發**，不為展示而假發獎勵或偽造ledger。
遠近／清晰尺寸／鏡頭與轉場設定仍保留。網頁更新後重新整理即可，不為載入改動任意重啟已有進度的服務。
`--save off` 不寫任何玩家存檔，**服務停止會失去此新世界記憶體進度**；實際URL／在線狀態以本次LIVE程序為準。


後續ADR-089已補角色右鍵／人氣／派對邀請的相連鏈，並保留本輪memory-only世界不重啟；
最新驗證與同世界新版入口見[NATIVE_PLAYER_INTERACTIONS](NATIVE_PLAYER_INTERACTIONS.md)。本頁數字仍對應ADR-088，不覆寫歷史。
