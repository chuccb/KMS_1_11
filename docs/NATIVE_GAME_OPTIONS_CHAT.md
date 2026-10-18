# 原GameOpt、公開聊天氣泡、密語拒收與StatusBar記錄

2026-10-18／ADR-059。**已編輯實作與回歸來源，未執行test/check/typecheck/browser/VM/probe，沒有功能PASS。**
只做原EXE／C／listing／WZ／原始碼交叉閱讀、diff閱讀與git空白檢查。歷史PASS不適用這輪變動。
不seed、不改帳號／角色／裝備／能力／進度，不換save；啟服也不表示功能通過。

## 1. 先更正舊判讀

1. `472910`的`.text:004729DC mov eax,[ecx+18h]`是 **CConfig byte offset24=goWhisper**。
   原先文件把它當「聊天窗開關」是錯的，導致把c2s23/22猜成氣泡請求。
2. `23/22`實際是 **拒收剛收到的密語**，兩字串為sender與own-name。沒有訊息內容不是缺欄位，而是此請求不需要內容。
3. 公開聊天和密語**可從wire分辨**：公開聊天s2c1F有characterId；收到密語s2c1A/12只有名字。
   不能再說「2003版不分類」，也不能把系統提示包成假System密語。
4. StatusBar font1是綠#00ff00，不是藍；font3灰#bbbbbb、font5淡黃#fff080、font6粉#ffafaf。

FINDINGS§4.26／4.31／4.35.5／§6第17項已同步更正；ADR-019與舊交付文件屬歷史，不是這輪驗證。

## 2. 交叉證據與接線

| 原始來源 | 確認事項 | 這輪接線 |
|---|---|---|
| 52D0B0、UI/UIWindow.img/GameOpt/backgrnd | 166×246、800×600置中317,177；checkbox134,50+26i；OK54,203、Cancel107,203 | 原圖與透明DOM命中，不畫現代設定頁 |
| 43D360／43D630 | goMiniMap／Whisper／Messenger／Exchange／Party／Game在+20／24／28／32／36／40，預設全1 | `kms111.gameSettings`本機profile；舊minimap shown只用於第一次migration |
| 52D7B0／52D6E0／52D740／43DE80 | checkbox取值、變更即apply；OK存、Cancel回舊值；goGame原disable | miniMap／whisper可用；其他尚未有完整瀏覽器UI的功能disabled，不注入假封包 |
| 4717D0／4728D0 | shared find／whisper gate、3000ms、`다른 요청을 처리 중입니다` font6 | browser與ClientSession雙層；成功decode09／0A才清，22不清 |
| 472910／4732D0 | goWhisper=1顯`%s>> %s` font1，=0送23/22；兩路都記recipient | 拒收不顯私訊正文、不生成氣泡；仍記回覆對象 |
| 472910的22與EXE raw file offset1B6142附近字串 | `'%s'님은 현재 귓속말이 거부되어 있습니다.` | `read/encodeUserWhisperRefused`與sender綠字提示 |
| 470C70／51D530／51CD10／50B320 | c2s12文字→s2c1F id+文字；含self pool lookup、未知id丟棄 | server同圖含自己轉播；session發channel=field與id，不靠名字猜來源 |
| 50B320→4E2850→4373A0 | `%s : %s`完整含名文字先白字log，再寬字氣泡；5000ms | 相同完整字串兩處顯示；leave／field／owner clear |
| 4373A0／4386E0、UI/ChatBalloon.img normal/dead十片 | wrap84px、12px cells／14px列、單行奇數欄最多7，多行7；alpha224；normal箭13×13 origin1,0、dead14×15 origin2,0 | 原十片直接拼，未ready不假畫CSS框；normal/dead layout cache、font ready時invalidate |
| 4373A0→4386E0＋原avatar canvas原點 | 寬12+12×欄；高6+箭高+14×行；x3−trunc(w/2)，y−h−avatarOriginY−5；root z−1073471624 | 相對field root z250210，portal250110／damage250310；獨立speech record排序key |
| 4FB670／4FBEE0 | wrap444−VScr12=432、續行五空白、上限64換行record、六行13px、讀者最後操作>5000ms才自動追尾（或已在底／≤7record） | 手動量測產生固定li列；不是CSS把64則訊息任意折行 |
| 4F8CB0 | Esc清空退出、empty edit左右鍵退出 | IME組字保留；focus清移動鍵與cold-action ticket |
| 55CDE0、EXE `[공지사항] %s` | s2c13/type0＋CP949 string→font5；type1走52BBE0 | 新notice codec／catalogue resolver／session event；map命令拒絕不偽裝System密語 |
| 472910＋原StatusBar constructor | 找不到font6；find成功font3；EXE raw offsets1B61A9／1B617D／1B61C5附近確認韓文文案 | 成功find首回主動載本機metadata組street:map；async只更新仍存在的原行 |

原Data.wz不缺素材。WZ dump僅作素材研究，不是執行遊戲測試；未提交大型dump、原檔副本或生成資料。
`4F88C0` id1004→4DDF10(0)是Messenger入口，不是聊天log顯示開關；這輪不冒充完成BtChat。

## 3. 行為與生命週期

- GameOpt有snapshot／draft：即時影響miniMap與收密語；OK只存本機設定，Cancel／Esc還原。
  傳圖、換owner、斷線或其他modal關窗也還原未確認draft。M同步同一設定；預覽不寫舊minimap位置profile。
- Messenger／交換／Party的server協定雖存在，這輪沒有完整邀請／視窗，所以不開假checkbox；原goGame也停用。
- 收件者關閉whisper時，client發拒收；server只接受**曾真送達給該receiver的同sender-session**、有效3秒receipt，
  raw own-name必須相等，處理後consume，才通知sender。過期／偽造／換session／重複拒收不成立。
  **這是本專案防偽政策**，不是從原server流量證實的實作，也不是離線訊息系統。
- 拒收第二字串用encodeCp949(self.name)，不能把解碼韓文直接當byte-string寫出。
- 普通聊天不更改recipient；傳圖只清pending，不清本機recipient；owner／下線清recipient／pending／記錄。
- chat新append最多保留64列；async loot／地名更新不重建已被prune或clear的舊記錄，字型ready時重量測，不每RAF全量重排。
- 氣泡每人一筆、5秒、新話覆蓋、leave移除；用目前avatar已合成frame的head anchor，不猜固定角色高度。
  speech用自己的record做sceneOrdering key，不與同角色avatar交替寫z而每RAF重排。
- 所有文字以textContent／canvas繪製，沒有innerHTML訊息插入；bridge維持same-origin `/ws`。

## 4. 方便操作入口

- 登入既有角色，左下 **Menu → 게임 옵션**：第一項小地圖，第二項接受密語；OK保存，Cancel／Esc還原。
  M同樣切小地圖。四項停用原因可由透明hit target的title／aria得知。
- 切「모두에게」後直接輸入公開文字；同圖的自己／他人會走原0x1F log＋五秒氣泡。
- 原聊天箭頭可設定recipient，或用 `/w 名字 訊息`；另一個線上角色關whisper後，回sender原拒收提示。
  `/f 名字`依原find封包找位置，地名由client自己的map metadata補上；不自動warp。
- reader往上捲後，五秒內新行不搶回底部；超過五秒後有新行才追尾。Esc清edit，empty edit左右鍵退出。
- 帳號／進度仍沿用同save：`preview/preview`、`demo/demo`。沒有為示範拒收而新增或改寫角色。

以上為操作說明，**不是要求使用者反覆幫忙測試，也不是這輪已執行的結果**。

## 5. 尚未完成，不能宣稱1:1的部分

- browser Gulim／KMSCJK fallback與measureText並非原IWzFont／Win32 GDI，因此字形、斷行像素與kerning仍可能不同。
  不把新64列規則說成已逐像素證明；特殊空白／多行與ANSI編輯70上限的精確byte語意未證明，未硬套UTF16或CP949 byte截斷。
- 這輪一般氣泡、normal/dead造型與root層已接，不是完整Gr2D layer cache／CShape2D／CVecCtrl／30ms同步引擎。
  只cache氣泡layout，尚未cache整張氣泡canvas；Menu hover仍用原mouseOver第0格，完整動畫未重建。
- 缺request ID時，3秒逾時後舊09／0A與新請求無法完全關聯；不要聲稱防偽receipt解決了這件事。
- 13/type1中央公告尚未接。`55C130`原loot取得提示走4EB440螢幕提示，不是StatusBar；browser仍保留舊loot log，未冒稱完成。
- 任務／Messenger／交易／Party／小遊戲完整UI，SysOpt的DirectX畫質／Win32截圖，完整UI focus manager仍缺。
  技能施放／魔法／buff、aggro／飛行、自然AP/SP／原轉職、卷軸、cash/pet等既有界線未改。

## 6. 回歸來源與交付

新增 `server/test/native-chat-gameoptions.test.ts`：預設／migration／blocked storage、公開／私訊wire、韓文own-name拒收、
notice、cell幾何／wrap／5秒邊界、session channel／unknown id／shared gate、GameOpt接線來源。
修改既有field／serve／native-system-ui fixtures；client／whisper probe僅同步聊天fixture／舊balloon-kind用語。
舊client_probe的VM／DOM shim未完整遷移到所有後續UI，不把這兩處來源修改冒稱整支probe已可用。
**沒有執行任何測試／typecheck／browser／VM／probe。** 只閱源與git空白檢查；不以assert數目或啟服充當PASS。

沿用 `generated/preview-death-20261018.json`：停LIVE→冷備份當下最新save→同參數開LIVE。
冷備份／啟動識別於實際完成後追加；提交含 `[skip ci]`，非force推送同Arena分支。

### 本輪冷備份與LIVE實際記錄

- 先停止舊LIVE `kms-1-11-34df21b6`，冷備份**當下最新save**，沒有恢復前輪快照。
- 備份：`generated/backups/preview-death-before-gameopt-chat-20261018-082615.json`。
- 原save／冷備份SHA256：`818006ccad453f65f4f1f5989d40942affb7fca981f7fd8dcb6518192d677dfd`。
- 原save同參數啟動新LIVE `kms-1-11-e91048bf`，PID11390；載入2帳號／1角色，忽略已有帳號的`--account` entries。
- Web8515／login8516／game8517綁0.0.0.0；map-command／test-tools仍只preview,demo，ping off。
- 啟動工具回報running／三port監聽，沒有preview警告；未訪HTTP、未登入、未做browser／VM／probe。
  **只代表程序啟動，不是功能PASS。**
