# 原版截圖交叉核對：HUD、地圖標題、聊天與消耗品快捷格

2026-10-18。**已實作，未執行 test/check/typecheck/browser/VM/probe；來源回歸檔不是 PASS。**

## 依據與座標系

使用者提供的原版畫面包含 Windows 視窗外框；遊戲內容仍為 **800×600**，約從圖片 (1,33) 起。
不能把外框的 802×634 當遊戲 viewport，更不能為了對齊外框而整體位移 HUD。
原圖右上是獨立街名／地圖名／徽章，不是後期小地圖的標題列；截圖內物件、地形、角色能力
亦不代表目前存檔應被改成同一張地圖／同一個職業。

| 原始來源 | 確認的事實 | 本輪接線 |
|---|---|---|
| CUIStatusBar constructor／4F6B70、WZ `UI/StatusBar.img` | 視窗 (0,392), 800×208；base/0=243×208、base/1=446×27、base/2=111×136 | 保留三片原圖與既有 I/E/S/K 按鈕，不重畫後期 HUD |
| 4FA5E0 | HP/MP 的填滿寬163，EXP **151**；整數除法 | 修 EXP163 舊誤值與 round；非法／零上限安全空條 |
| 4FA170→527720(1)、PE 5B3A00 | 人物欄用12px黑字；`74 AD BC B9 00 00` UTF-16LE 是 **굴림 / Gulim**，不是舊註解假設的 Dotum | HUD 優先 Gulim，不再白字黑描邊；沿用 OFL 韓文字 fallback，未聲稱 metrics 相同 |
| 4FB440 | `%d%%`，局部 (214,190) 20×12，底色 ARGB FF869EAA | 補 EXP 百分比與底色，位置為畫面 (214,582) |
| 4F9AD0 | HP/MP/EXP 嚴格 hover 邊界，字串 `HP : n / n` 等；EXP hit 包含左邊標籤 | 補數值提示，非永久把數字壓在進度條上；使用現有簡化 tooltip 框 |
| CField 46DA30 | `info/streetName`, `mapName`, `mapMark`；None 不載 mark；mark 38×38 | mapArt loader → **artJson** → browser `drawMapTitle` 整條傳遞，非只補 loader |
| 46DA30 C／listing | 寬=max(兩行量測寬+有 mark 時40)+4；左799-width／上3；兩行局部 y1/21、黑影+1/+1；mark x=width-39 | Gulim BA/16、白字黑影，讀本圖名稱；mark 保留原韓文字路徑及像素尺寸 |
| 4F6B70、4FBEE0、450D00／450F70 | 記錄區 (243,489) 434×84；六列13px；VScr寬12，位於 (677,490)、高82 | 原 VScr 圖片，上一行／下一行／頁面／滾輪／拖曳 thumb；不再最多8筆便永久刪除 |
| 4FB670 | 記錄上限64（原版是在換行後的記錄層計算） | browser 上限64訊息；換行由 DOM，並非逐字同 IWzFont |
| 4F6B70 | 文字輸入局部 (346,188) 340×12；BtWhisper (327,183)14×23 | 輸入移到 (346,580)，黑字 Gulim；原按鈕圖片與可用入口 |
| 4FC960／4FC9F0、PE **5BCEC0** | 七格32×32，右下邊界不含；畫面 x/y 見下表 | 精確命中／繪製位置，不把 Ctrl／Alt 占為可設定格 |
| 511E20 與 **512260 VK dispatch table** | Shift／Insert／Home／PageUp／Delete／End／PageDown 對七格 | browser `event.key` 對應；文字輸入優先，不在輸入聊天時吃掉按鍵 |
| 463DF0、4FC180、512570 | 只有200/201/202類消耗品可拖入；綁 itemId 去重；加總各堆數量，使用最低正 bag slot；200ms guard | 不發送移格／丟棄封包來「設定」快捷格；沿既有 use 請求與 server 消耗路徑 |
| 479B10(...,1)、4FC440→525AE0；PE 4FC68D push0 | 使用 `info/icon` 不是 `iconRaw`；原點 x-ox/y+32-oy；ItemNo 點陣數字，字寬逐字累加、間距0、y+20 | 新增正常 icon metadata；原 raw PNG／drop／shop 路徑不改；數量使用 WZ 位圖而非 CSS 數字 |
| CConfig constructor 43D... | 本機148起56bytes清零，再讀設定 | 空白 browser profile 不憑空塞藥水或技能；不依截圖替使用者預綁 |

### 七格座標／按鍵

| slot | 畫面左上 | 按鍵 |
|---|---|---|
| 0 | 753,490 | Shift |
| 1 | 692,527 | Insert |
| 2 | 728,527 | Home |
| 3 | 764,527 | PageUp |
| 4 | 692,564 | Delete |
| 5 | 728,564 | End |
| 6 | 764,564 | PageDown |

原 base/2 內建 Shift 大標籤；格0實際圖示槽在它右側，不能把標籤框也當作32px槽。
Ctrl 攻擊／Alt 跳躍仍走原本動作入口；沒有拿現代可自訂全鍵盤功能取代。

## 操作與安全界線

- 重新整理 LIVE，沿用既有帳號／角色。開 I 背包的消耗品頁，把200/201/202物品拖到右下原格。
  同個 itemId 再拖到另一格，舊格會清除；設定只存在本機 browser profile，不會消耗或移動物品。
- 綁定保存於 origin 的 localStorage，key 以帳號／角色ID／名字 tuple 區分。原版是 CConfig 本機 registry，
  此處不是在伺服器新增道具／角色欄位，也不是原 registry 相容格式；禁用 storage 不阻擋入圖。
- 快捷鍵使用最低正 slot 的同品項，加總顯示所有 USE 堆數量；用完會顯示0，設定保留以供再取得。
  回城卷203、投擲鏢207、裝備、技能不能冒充200/201/202綁定；錯誤拖入取消，不落地丟掉。
- 死亡、傳圖中、拖曳中、商店／NPC交談、確認窗／體驗工具／移格 pending 時不送快捷使用。
  仍由既有 server 決定能否使用；不預扣數量、不自行恢復 HP/MP、不另加 buff 效果。
- 聊天舊訊息可上下捲；停在舊記錄時，新訊息不強行拉到底。原圖 VScr 包含 enabled/disabled/pressed。
  對應正常聊天白字、既有系統分類綠字、可區分的寄出悄悄話藍字；接收端原協定無 whisper 標籤，
  仍作一般聊天，不藉文字內容臆判來源。
- BtWhisper 本輪提供 **browser 的 `/w ` 輸入捷徑**，不直接送出、不暗設收件人。
  原 4F8940 的收件人選擇窗／記憶收件人 UI 尚未重建；此捷徑不冒稱原視窗完成。
- 地圖標題每張從 WZ 讀；mark='None'／空字串不載圖。要求的 mark 讀不到則明確報錯，
  不以替代徽章或「素材缺失」掩蓋 reader 問題。小地圖仍維持原框及原資料，不植入後期標題。

## 尚未達成原版完整程度

Gulim 不存在時仍使用 KMSCJK OFL fallback；瀏覽器的 font metrics、反鋸齒、DOM換行與原 Win32/IWzFont
不是逐像素相同。聊天使用64條訊息而非64個原生換行記錄，沒有複製原捲軸的全部 timing／鍵盤政策。
HUD tooltip 仍用既有簡化框；系統訊息分類／中文操作提示不是所有原生 message-type 的1:1重建。
技能快捷格施放、快捷格彼此拖曳／拖出清除、完整鍵位設定、BtChat 的原聊天窗及 Menu 的原系統選單未完成。
本輪不改角色／怪物物理，不聲稱完整 CVecCtrl／CShape2D／30ms同步；原主動技能／魔法／其餘 buff、
自然 AP/SP、轉職、卷軸與其他既有未完成範圍不因本輪 UI 接線而變為完成。

## 交付與驗證紀律

新增 `native-hud.test.ts` 的純函數／原來源回歸；`equipment-art.test.ts` 增正常／raw icon 區分來源；
`webclient.test.ts` 增 **HTTP 序列化與 mark PNG** 回歸來源，避免只寫 loader 卻忘了 HTTP 欄位。
**全部未執行**；未開 browser、VM、probe，亦未執行 test、check、typecheck 或 CI。
只有手動閱讀原 C／listing、WZ dump／原畫布解碼、人工閱讀 diff 及 `git diff --check`。
啟服只能說明服務讀檔／監聽成功，不能視為上述功能通過。

沿用 `generated/preview-death-20261018.json`，停服後冷備份再重開；不建角、不重seed、不執行裝備修復，
不直接編輯使用者角色。具體啟動／備份紀錄於交付時追加。

### 本輪實際啟動紀錄

- 停止上一個 LIVE 後，冷備份至 `generated/backups/preview-death-before-hud-20261017-225818.json`（檔名為 sandbox UTC 時刻）。
- 當時原檔與備份 SHA-256 均為 `9e3780376136cbc8fb428579e556642c160911263991e058ca9075866ac7e4fd`。
- 重啟仍讀 `generated/preview-death-20261018.json`，啟動紀錄為 **2帳號／1角色**；既有帳號優先，忽略CLI seed參數。
- `0.0.0.0` web8515／login8516／game8517，process `kms-1-11-d63b9673`。
  這是服務啟動／讀取舊進度紀錄，不是遊戲功能驗證；未由代理登入／建角／修復裝備。


後續ADR-056補回本輪原先漏接的聊天 maxlength：120→70；DOM字數不等於原CP949 byte／字型逐字排版。
