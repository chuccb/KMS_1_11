# frame／play 工具的實作遷移與證據邊界

2026-10-19。接續 [登入 UI 整理](STRICT_LOGIN_UI.md)；這一輪不改遊戲物理、鏡頭、傷害、掉落落點或存檔格式。

## 已完成的關聯鏈

- 刪除 `server/scripts/frame_probe.mjs` 與 `play_probe.mjs`，不是更名或保留 JS 相容殼。
- 新 `frame_probe.ts`／`play_probe.ts` 是 import-safe Bun runner，納入根 strict TypeScript／ESNext。
- `probe-field.ts` 共用明示身分／世界／地圖 admission；`probe-frame.ts` 負責純繪圖證據；`probe-play.ts` 負責有界鍵盤計畫與事件關聯。
- 擴充既有 `browser-observation.ts` 的 runtime projection、序號、溢出狀態與實際畫布／RAF／來源尺寸／完整變換矩陣；同步修改其測試、import-safety 呼叫測試及現行文件。
- 不再使用 DOM shim、假 `Image.onload`、預設管理帳密、預設第一個角色、直接移動／攻擊封包、傳送或注入遊戲掉落事件。

工具鏈六項 npm registry latest 本輪重查未變：**Bun 1.4.3、TypeScript 7.0.2、@types/bun 1.4.3、Prettier 3.9.10、playwright-core 1.64.1、@sparticuz/chromium 153.0.0**。沿用 exact pins／frozen install，不為了「升級」填不存在的新版本，也沒有 any／ts-ignore／allowJs／降低 strict。

## 可以唯讀執行的標題畫面

```sh
bun server/scripts/frame_probe.ts <明示web-port或http(s)://origin>
```

沒有省略目標的預設值。此路徑只允許該 origin 的 GET，封鎖所有 WebSocket 與寫入請求；不讀帳密、不登入、不選角。
使用真正 Chromium、實際客戶端與原 PNG，等待 `data-client-state=ready`，要求零頁面例外、零 socket attempts。

## 手動、明示的一次性角色工具

**這些命令會登入／操作角色，只限使用者自己確定可丟棄、已隔離的 fixture；不是平常測試入口，也未代玩家執行。**

兩支工具都要求：

| 輸入 | 意義 |
|---|---|
| 明示 origin ＋ `--allow-state-changes` | 必須通過既有隔離 admission；單有旗標不是隔離證明 |
| `PROBE_ACCOUNT`／`PROBE_PASSWORD` | 明示 fixture 帳密，無預設、不可替用玩家帳號 |
| `PROBE_WORLD_INDEX` | 原世界清單索引 0..255，不是 world id；以原 UI 鍵盤捲動選取，核對選中與可連接狀態 |
| `PROBE_CHARACTER_ID` | 1..u32max；必須在本次新收到的角色清單中，不替選第一個角色、不建立／刪除角色 |
| `PROBE_MAP_ID` | 明示預期入場地圖；本次 field 的 map id 與 self.characterId 必須都符合 |

所有身分參數在開瀏覽器之前檢查。持續拒絕現行／歷史玩家 LIVE 的 TCP ports 與同前綴 proxy hosts：8495/8496/8497、8515/8516/8517。
HTTP 與 WebSocket 均限制在明示 fixture origin，redirect／跨 origin 不轉送帳密。

### field frame

```sh
bun server/scripts/frame_probe.ts <隔離fixture-origin> --allow-state-changes
```

額外要求 `PROBE_FRAME_LAYERS`，逗號分隔、不得重複：必含 `background,tile,avatar`；可加 `npc,item-drop,meso-drop`。
不允許以 title 或 fallbackGround 代替 field 層；要求的圖層不在場，結果就是失敗／逾時，不偷偷製造掉落物。

繪圖證據不是單純計數 `drawImage`：

1. 只記錄真正 native `drawImage` 成功返回的呼叫；來源必須已解碼、有正尺寸。
2. 以 WeakMap 區分 canvas 身分；所有圖層必須在**同一個具名 game RAF、同一個 buffer及其內容世代** 中。
   同一幀world／UI會重用buffer，clearRect／context.reset／canvas width或height重設會另開世代；被清掉的舊圖層不能湊進後續present。
3. 必須在這些圖層之後，由該 buffer 真正 blit 到實際 `#view`。
4. source crop先裁至真正decoded像素，再經buffer crop與view裁切；不能把native drawImage無作用的來源範圍或實際被移出view的局部算進來。alpha 必須大於零；含縮放／鏡射的完整矩陣與 drawImage crop bounds 必須交會於這次實際呈現區域。
5. 來源必須是同 origin 的原圖 API 路徑；avatar Blob 回溯到真正 fetch URL，不把任意 blob 名稱當 avatar。
6. 無關 RAF／RAF 外呼叫的 frame=0，不繼承上一次 game frame；前一幀素材不會湊進本幀。

這是繪圖資料流證據，**不是完整逐像素／遮擋／美術相似度證明**；不宣稱看到每個最終像素、地圖無所有遮擋，或全部功能已還原。

### keyboard play

```sh
bun server/scripts/play_probe.ts <隔離fixture-origin> --allow-state-changes
```

另要求 `PROBE_PLAY_PLAN` 指向自己準備的非空 JSON（最多65536 bytes）。不提供會對未知地圖亂走／亂打的預設腳本。

| 計畫欄位 | 規則 |
|---|---|
| `combatMapId`／`targetTemplateId` | 明示戰鬥地圖與目標 mob 模板 |
| `reward` | `{ money: boolean, value: 正整數 }`，item id 或 meso amount |
| `steps` | 1..128步；只投影以下兩種形狀，不執行任意 JS 或 JSON 命令 |
| hold | `{ kind:"hold", keys:[...], durationMs }`；1..3個不重複、不相反的鍵；1..10000ms |
| await | `{ kind:"await", event, timeoutMs }`；必須是新的指定事件；1..30000ms |

可用鍵只有方向鍵、Alt、Control；可等待的事件只有 field／hit／mob-die／drop-enter／drop-leave／loot／inventory／self。
總計畫時間預算最多120000ms。這些數字是工具工作量上限，**不是遊戲 tick／能力／移速設定**。
hold 後更新 await 的 freshness 游標；await 消耗第一筆新符合事件，不用陳舊背包事件假裝新撿取。成功按下的鍵在錯誤路徑也逐一嘗試釋放，某一鍵釋放失敗不阻擋其他鍵；所有路徑最後關閉 browser。

最終成功還要求：同一個 field epoch／角色／指定戰鬥地圖，目標 template 的 mob-enter → 新的正傷害 hit → 後續 mob-die → 同 mobId／預期 reward 的 drop-enter → 同 dropId、同角色 taken → 相符 loot notice，以及撿取後的物品數量或 meso 餘額增量。

原伺服器順序是 taken → **inventory（道具）或 stat/self wallet（金幣）** → loot。不能錯把金幣撿取也要求 inventory。
bridge的 `hit` 本身是本地預測數字，不是原TCP伺服器傷害ack；工具同時要求死亡／掉落／撿取的後續證據，但不冒稱能逐擊證明伺服器扣血。
原生 loot notice **沒有 dropId**，所以工具只能依同角色、時序、物件 id／金額及狀態增量做關聯，不冒稱原封包有逐掉落物 acknowledgement，也不宣稱能排除一切同值並行獎勵。
收到的事件用本地嚴格遞增 sequence，而不是可偽造／同毫秒的封包 at；每次 field 都分 epoch。5000筆 message history 一旦溢出就拒絕驗收，不用截斷歷史拼出錯誤成功。

## 實際結果與交付入口

strict型別／format／build／diff檢查通過；focused **25 pass／0 fail（4 files，7.03s）**。最終完整 **1064 pass／44 fail，1108 tests／124 files，267.35s**；對本輪整理前1054/44的failure multiset新增0／移除0（保留重複標題），CI仍不綠。

本輪明示新建 `generated/preview-20261019-tool-cleanup.json`（ignored，exclusive create，非舊save恢復），開放web8515／login8516／game8517。
`preview / preview` 與 `observer / observer` 各有一名新level1 beginner，城鎮101000000；未替使用者登入、操作或增加能力。
程序是否存活以本次LIVE面板為準；這份檔案是新進度，不能用本輪產物取代原玩家存檔。
新入口實際跑title-only runner：errors=[]、socketAttempts=0；原title PNG同RAF到view，讀取前後save SHA256完全相同，preview Host header回200。
全案Markdown本地連結417個／missing0。套件、build、觀測與測試log都在ignored `generated/tool-cleanup/`，不提交二進位／玩家資料。

## 驗證方式與限制

- 純測試：身分／protected targets／layers／有界 JSON plan／鍵釋放；道具與金幣各自的完整事件關聯，拒絕過期、錯物、錯角色、跨圖、零傷害、未增量及錯序證據。
- 真 Chromium：原 WZ 背景、tile、NPC、原 avatar API、道具 iconRaw、金幣 iconRaw，經 production `sceneSurface`／`dropRenderer`；同幀呈現成立，透明／畫外／分幀／未呈現及同幀clear／reset／resize後空buffer均失敗。無效 native draw 不記錄，無關 RAF frame=0。
- 實際完整客戶端的 title-only runner 通過，0 socket attempts；這不是 field／戰鬥人工驗收。
- 觀測器真 WebSocket echo fixture：不攔掉原事件交付、深投影新增事件／金額、拒絕 malformed，5100筆 burst 後保留5000筆且明報溢出。此伺服器僅 echo，沒有 LoginServer、角色或存檔。
- 獨立程序禁止網路／啟動瀏覽器時，35個工具／元件 import 保持0 I/O attempts；兩支新增 runner 的無參數／無帳密／protected-origin admission 亦實際被呼叫。
- 完整回歸以本輪整理前的 **1054 pass／44 fail／1098 tests／122 files** 為基準，比對包含同名重複案例的失敗 multiset，而非只看失敗數。

**全案尚未遷移完成**：`client/main.js`（ADR-109 時點 5836 行，ADR-110 後 5662 行，ADR-112 後 5616 行，ADR-113 後 5597 行，ADR-114 後 5567 行，ADR-115 後 5551 行，ADR-116 後 5547 行，ADR-117 後 5543 行，ADR-118 後 5547 行，ADR-119 後 5548 行，ADR-120 後 5482 行，ADR-121 後 5445 行、ADR-131 後 5513 行、ADR-132 後 5522 行、ADR-137 後 5525 行）仍待真正實作型別與分層；`server/scripts/client_probe.mjs` 已於 ADR-109 遷為 `client_probe.ts`（strict TS、納入 tsc 檢查），舊 client_probe 不可按預設帳密執行。44 項既有失敗已於 ADR-108 全數結案；其餘深 schema 債務沒有因此消失。手動 field／keyboard 場景本輪未對任何玩家／遊戲帳號執行。
