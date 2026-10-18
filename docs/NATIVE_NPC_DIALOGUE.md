# 原 NPC 動畫時間、CUtilDlgEx2 對話與回覆接線

日期：2026-10-18 ｜ ADR-061 ｜ **已編輯實作及回歸來源，未執行驗證**。

依使用者要求，沒有執行 test/check/typecheck、語法檢查、瀏覽器、VM、HTTP／登入 probe。
原 EXE／listing／WZ 的讀取不是功能測試；服務啟動也不是 PASS。

> 後續 ADR-062已接NPC idle／speech／controller鏈，索引差異與原server政策仍未解；見 [NATIVE_NPC_BEHAVIOR](NATIVE_NPC_BEHAVIOR.md)。

> 後續ADR-063已補 `#i/#s` 圖文內容、名稱tip／動態row／生命週期；見 [NATIVE_DIALOGUE_RICHTEXT](NATIVE_DIALOGUE_RICHTEXT.md)。原quest腳本仍缺。

## 本輪交付

1. NPC 缺省 frame delay 從 1000ms 修成原 `40C730` 的 **180ms**。保留 canvas 明示 delay、Mob 的既有規則及 Map 的缺省值。
2. 移除畫面下方的自製黑色 HTML 文字卡；以原 `UtilDlgEx2` 八片 Border、50×23 的原按鈕、32×15 的 `BtUIClose2` 作圖。
   DOM 只處理透明命中、可及文字、焦點及輸入，跟隨既有 800×600 logical surface／顯示縮放／原游標。
3. `0x47 say` 的兩個旗標不再丟棄。第一個控制 Prev，第二個選 Next 或 OK；Prev 回 0、Next／OK 回 1，**ESC／header Close 回 FF**。
   本地伺服器的分頁模型同步補上一頁、頁首／中間／末頁旗標；不能再把 0 當成通用關閉。
4. 保留 `0x47` **五種 body**（say／confirm／askText／askNumber／menu）到 JSON，再依實際 kind 回 `0x15`。
   沿用 `npc-say` event 名稱避免破壞既有訂閱，新增 `body`，並保留 `npcId`／`message`。
5. 補原尺寸規則、字框七個整數 FillRect、四種字色／粗細、`#L<number>#`／`#l` 選項與長文 VScr。
   普通對話 text width 300、輸入 230；字框 padding 8／2、純文字最低行高16＋2；字框起點(11,36)／(14,36)。
   Say／confirm height = text viewport＋79；menu＋58；edit＋99。普通寬322、長文含12px scroll為334、edit寬252。
6. 補 CP949 byte 長度、未修剪的原輸入、number範圍／九位數 edit、Y／N、Enter／ESC／Tab、IME、捲動、焦點與 modal 隔離。
   在 bridge/session 再獨立驗證 kind／範圍／選項／CP949；不讓自稱 say 的回覆接受任意 number 或選項。
7. 頁面切換前先釋放目前 body，避免下一包在 async write 尚未返回時被誤當重複；write 失敗也不能把新頁覆寫成舊頁。
   換圖／斷線／close 清除 session 對話；browser 對話亦在換圖／死亡復活介面／斷線時清掉，不補送舊圖回覆。
8. 加明確標記的 **唯讀 UI 範例入口**，不是任務系統、不是新的 NPC 腳本，不發 `0x15`，不發道具／能力／存檔寫入命令。

## 反編譯、listing 與 WZ 交叉

| 原位置 | 確認內容 | 對應實作 |
|---|---|---|
| `40C730` | NPC canvas delay 缺省180 | `game/sprites.ts` |
| `4A5910`、`4A5A80..4A65C0` | 五種封包、modal、回覆值；header u8／npcId 讀後不用 | `client/session.ts`、`client/questreply.ts` |
| `52FEB0` | **CUtilDlgEx** vtable，非另一個 CUtilDlg；Gulim12黑／紅／綠／藍，各有粗體 | `npcdialogue-layout.mjs` |
| `535AC0`、`535C60` | kind／server flag、selection=-1、兩旗標存+128／+132 | body保留／分頁 |
| `5309B0` | server flag非零時資源 basename 加 `2` | Ex2與Close2，不能套本地Ex palette |
| `.lst 005BE990..005BE9C2` | `aUi_71` 被 .c 截斷成 `L"UI"`；連續 UTF-16 實為 `UI/UIWindow.img/UtilDlgEx` | WZ圖片路徑 |
| `.lst 005BC260..005BC292` | `aUi_68` 同樣被截斷，實為 `UI/UIWindow.img/BtUIClose` | header Close2 |
| `531110` | 外框八張，白色內部、水平／垂直4px repeats、原角片座標 | 共用 `utildialog.mjs`，也供既有物品輸入使用 |
| `531FB0` `.lst 00531FB0..00532210` | **ret 10h，只有四個 stack args**；.c 的額外參數／未初始化值是反編譯錯誤 | 七個FillRect逐筆重建，非一個猜測strokeRect |
| `530C20`／`530C60`／`530CA0` | text width、240px普通上限、8／2 padding | layout |
| `5338A0`／`5359B0`／`535A60` | markup、行高至少16、每列再＋2、上下padding | 支援的純文字／色彩／選項子集 |
| `535E40`／`535EF0` | dimensions；超240且 `floor((textHeight-240)/8)+1>2` 才開scroll | layout／8px offset |
| `532220` | header Close位於(w-48,9)，VScr位於(textX+textWidth,36) | DOM hit bounds及canvas |
| `532500` | Prev(w-115,h-40)、Next或OK(w-61,h-40) | 50×23按鈕及原旗標 |
| `532820`／`532A80` | Yes/No居中、edit OK／Cancel、原edit框位置 | confirm／text／number |
| `532E60` `.lst 00532E60..00532E7D` | .c 失敗但listing完整：只呼叫文字frame，**沒有**額外OK／Cancel | menu只有共享header Close及文字選項 |
| `533350`／`5333D0`／`530D40` | 選項hit寫+164，點擊後回結果1，hover底線 | 有界的#L整數選項 |
| `5336C0`／`5332C0`／`532EC0` | Y/N、say Enter、ESC／Tab、edit數字及長度檢查 | modal鍵盤、CP949及驗證 |
| `UI/UIWindow.img` | Ex／Ex2各有Border/0..7與Prev/Next/OK/Cancel/Close/Yes/No三態；Close2為32×15 | 無新增／生成圖像或缺素材fallback |

### 531FB0 的純色字框

位置參數為(x,y,w,h)，七筆：

- (x+1,y+1,w-2,h-2)：local `D3DBE4`／server `E4DDD3`。
- (x,y,w-1,1)：`6A8594`／`947C6A`。
- (x,y+1,1,h-2)：`7D98B3`／`B39C7D`。
- (x,y+h-1,1,1)與(x+w-1,y,1,1)：`BAC8D2`／`D2C6BA`。
- (x+1,y+h-1,w-1,1)與(x+w-1,y+1,1,h-2)：`EAEFF2`／`F2EEEA`。

普通圖片外框與這個文字區不是同一層。不得把字區色塊拉伸成整個視窗、或誤用本地 YesNo 背景。

## 對話來源：必須修正的舊假設

`Npc/<id>.img/info.speak` 是 **NPC 待機自言自語池**（`49A0C0`／`499C00`），不是原任務頁。
目前伺服器將它作成點擊分頁是本重建的**本地政策**；原 `info.quest` 例如 `begin5` 的伺服器腳本仍未恢復。
本輪沒有把這個政策包裝成「原 NPC 任務已實作」，沒有添加假任務、獎勵或轉職。
正常 NPC 點擊仍只會由現有遊戲層送 say；其他四類已接資料／UI／回覆邊界，但**沒有新增遊戲任務呼叫者**。

## 方便入口（使用者自行操作，未由 agent 執行）

- 真 NPC：進圖點沒有商店、且有現有對話池的 NPC；看 Next／Prev／末頁 OK，ESC 或 header Close 離開。
- 工具列「體驗工具（非原版）」→「對話窗範例 · 非原版工具／唯讀」：
  翻頁／長文捲動、是／否、文字輸入、數字輸入、選單五個入口。
- 範例內文固定標 `UI PREVIEW - not an NPC quest`；接受結果只寫本地日誌，不發 `0x15`。
  翻頁範例有兩頁；文字範例4–12 CP949 bytes、數字1–99、選項值10／20。
- 真 `0x47` 到達會優先結束範例並顯示真封包；範例不能取代或回答已開啟的真對話。
- 工具不暫停怪物／時間；可用既有無怪城鎮入口，但不會自動傳送、補血、seed或修改角色。

## 明確未完成／browser 替代界線

- 後續ADR-062補idle／speech／controller及條件路徑codec；原server索引重寫、完整CVecCtrlNpc與自主走路仍未恢復。
  已交叉出 `49A0C0` 為4–12秒抽選、`499C00` 氣泡5000ms，但不直接把它寫成任務翻頁或本地各自亂播的AI。
  `.lst 0049A2C2..0049A310` 明確對signed action與extra表count比較；sender `49A3C0` 是extraIndex+2，
  此邊界與action表語意仍待釐清。不能用猜測的wire索引宣稱已同步。
- 後續ADR-063已補 `#i/#s` icon、archive名稱tip與圖文選項；未確認的人物／任務／道具名稱替換不套後期macro。
  未支援碼仍保留literal，不默默刪掉內容或杜撰資料。
- Browser Gulim／KMSCJK fallback不是原GDI字型量測；ADR-063改用整段量測、續行空白／掛行，完整原byte-token word splitting仍未全移植。
  因此有原尺寸／素材／row規則，不宣稱文字pixel-perfect。
- Wheel、PageUp/Down、Home/End、focus trap、IME／主按鍵防誤觸是browser相容／操作政策；不是完整CWndMan。
  普通scroll thumb互動可用，但原控件的按住重複、全部hover/pressed scrollbar狀態、drag caption未完整移植。
- Menu以明確選項啟用回覆；不在尚未選擇時發FFFFFFFF sentinel。
- 極長輸入prompt為保護800×600 viewport將視窗cap600，edit留在窗內、prompt可wheel讀取；原不限制高度的行為未照抄。
- 改圖／斷線清理不假回覆；blur／hidden／pointercancel只取消press/scroll drag，不接受／關閉modal。

## 回歸來源與保存

新增 `server/test/native-npc-dialogue.test.ts`：分頁、尺寸／padding／scroll、七筆色框、markup、CP949／-1上限、
實際kind／range／menu驗證、session五種body、async次頁競爭、NPC180ms與原WZ素材。
同步修 `quest.test.ts`、`serve.test.ts`、`webclient.test.ts` 的舊0=關閉／旗標fixture，補browser前後翻頁的來源。
**全部未執行**，不沿用歷史PASS，不宣稱瀏覽器／連線結果。

沿用 `generated/preview-death-20261018.json`，停服後才冷備份再開LIVE；備份資訊見本節交付紀錄。

### 本輪冷備份／LIVE 交付紀錄

- 停止舊 LIVE `kms-1-11-npc-bc9e4f76` 後，才複製當下同一份存檔；保留使用者本輪自行遊玩的後續進度，沒有用前輪備份覆回。
- 冷備份：`generated/backups/preview-death-before-native-npc-dialogue-20261018-011425.json`。
- 複製當下主檔及冷備份 SHA256 都是 `744abea71a7a12b564609af64537428badb05076c210092c19329b0b95c28665`。
  重啟後玩家正常遊玩可能繼續改變主檔，不能據此用冷備份覆蓋。
- 新 LIVE：`kms-1-11-ca0f1379`／PID14666，host `0.0.0.0`，web8515／login8516／game8517。
  同save啟動載入2帳號、1角色；`preview/preview`、`demo/demo`，原帳號授權的地圖命令／體驗工具、ping off均保留。
- 這是服務啟動紀錄，不是功能PASS；沒有執行瀏覽器／登入／HTTP probe／測試／typecheck。
- generated存檔、冷備份及/tmp反編譯抽檔不納入Git。
