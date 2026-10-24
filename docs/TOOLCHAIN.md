# Bun / TypeScript / ESNext 工具鏈

更新：2026-10-24（ADR-164：strict browser UI preference boundary；registry／GitHub latest recheck）。**這是尚未完成的全專案遷移，不是完成交付聲明。**

正式 formatter 為 Bun 1.4.4 內建 `bun fmt`；ADR-158 的 438-path、ADR-159 的 440-path、ADR-160 的 443-path byte audits 保留為歷史紀錄。ADR-164 現樹含 **447 個 `.ts`＋4 個 package/config/workflow paths，共 451 個格式輸入**；Prettier 3.9.10 僅作臨時比較，與 Bun 1.4.4 輸出 **451/451 byte-identical**，沒有恢復成依賴。2026-10-24 registry／GitHub latest 重查：Bun／`@types/bun` 1.4.4、TypeScript 7.0.2、playwright-core 1.64.1、Chromium tooling 153.0.0、checkout v7.0.1 與 setup-bun v2.2.0 均與 latest 相同，故沒有為升級而改依賴。另以 Bun 1.4.4 `bun check --no-script` 輔助複核，權威 typecheck 仍呼叫 pinned TypeScript 7.0.2 `tsc`；Bun 官方 tarball SHA1／SHA512、packageManager、engine、`.bun-version`、@types pin 與 lockfile 同步。

strict `client/websocket-transport.ts` 把 socket 建立／替換／open gate／JSON encode／close 與 active-generation fence
自 `client/main.js` 移到可單元測試的 TypeScript 邊界；JSON object＋string `t` 後再呼叫 optional payload guard，guard 回 false 或 throw 都 fail-closed。
`client/main.js` 現在接上 `client/server-message-validation.ts`，針對明列的 server message families 檢查 payload；57 個已知 discriminator 全數有 guard，trade／messenger nested unions 均覆蓋。`client/trade-wire.ts` 只在 JSON projection 將 cash-block `sn`／`unknown1A` u64 轉為 canonical 十進位字串；raw protocol BigInt 不改、不經 JS number。未識別／未分類 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard），故不是全面 schema。main 本身仍未納入 TypeScript 檢查；現況 **125 支 client `.ts`**、`client/main.js` **5507 行**。map DTO／runtime guards（ADR-162）、strict HTTP loader（ADR-163）與 UI preference/storage boundary（ADR-164）分層；全部以隔離測試／mock，未操作 LIVE 角色或 save。

ADR-109 遷移基線：`server/scripts/client_probe.mjs` 已真正遷為 strict TS（`client_probe.ts`，1749 行，納入 tsc 檢查，
輸出與舊 `.mjs` **逐行相同**），並自 `client/main.js` 抽出第一個可單元化的領域 `client/inventory-window.ts`
（220 行，9 項新單元測試）。ADR-110 續抽 `client/shop-window.ts`（約 330 行，10 項新單元測試）。**目前唯一尚未型別化的 authored 來源仍是 `client/main.js`（5507 行）**；
靜態耦合普查顯示它是彼此糾結的單體（321 個 top-level 宣告中僅 3 個零耦合），沒有可機械切開的純區塊，
故採門面分層逐領域搬移，不以改名冒充遷移。frame／play 已於前輪遷為 strict TS，詳
[STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)。歷史數字／PID不代表當前 LIVE。

ADR-109 時點的strict／format／build驗證：focused25/0；當時完整1064/44（1108tests／124files，267.35s），對該輪前基準failure multiset新增0／移除0。35純imports／0 I/O，手動角色場景未代玩家執行；不代表ADR-156的現況。

前輪三個login UI實作模組strict TS遷移：main5963→5356行、client89支TS，保留主入口／3MJS未完債務。
六項registry latest重新查證與下表exact pins一致（UTC2026-10-18T16:09:10Z／台北2026-10-19）；不為升級而虛構版號。
strict／format／build與focused45/0通過，21組舊／新完整邏輯畫布RGBA全0差異、30純imports／0 I/O。
完整1054/44（1098tests／122files，285.07s），對1520ac9 failure multiset新增0／移除0，CI仍不綠。
完整回歸與原證／安全界線見 [STRICT_LOGIN_UI](STRICT_LOGIN_UI.md)。

前輪顯示端點修正（ADR-085）：整數canvas layout＋inverse DPR transform，42組原素材完整screenshot RGBA差異全0，未加銳化。
strict／format／build通過；完整1038/44（1082 tests／120 files，287.81s），對c773329 failure multiset新增0／移除0，CI仍不綠。
詳見 [PIXEL_CAMERA](PIXEL_CAMERA.md)。工具版本與下表不變；main／3MJS仍待實際遷移。

前輪鏡頭增量：當輪六個registry latest與下表exact pins一致；新增合成／lens／控制的strict TS責任，當輪client86支TS。
strict／format／build通過；完整1037/44（1081 tests／119 files，216.80s），對2eaa5f2失敗multiset新增0／移除0，CI仍不綠。
七DPR×五尺寸／游標、16組原PNG分層與LIVE同PID唯讀驗證見 [PIXEL_CAMERA](PIXEL_CAMERA.md)；main／3MJS仍待實際遷移。

## 前輪增量：strict WebClient server-to-browser union（ADR-157）

`server/src/net/webclient-messages.ts` 定義 `ClientEvent` JSON 投影與 browser bridge 其他出站 message union，`clientEventJson` 保留各 `t` discriminator；`WebClient.send` 由 `unknown` 改接受該 union，並把 `touch-result` 成功／拒絕形狀分開。ADR-157 當時只證明 TypeScript 編譯期保證，不是 JSON runtime validator；選定 inbound payload guards 於 ADR-158 加入，仍非全面 schema，`main.js` 也尚未納入 strict compiler。詳見下節與 [ADR-157](DECISIONS.md)。

## 前輪增量：選定 server-to-browser payload guards 與 Bun formatter（ADR-158）

`client/websocket-transport.ts` 新增可選 `validateMessagePayload` hook：JSON envelope 通過後才執行；false 或 exception 都走既有 malformed callback，絕不交給 main handler。`client/main.js` 明確注入 `validateServerMessagePayload`。`client/server-message-validation.ts` 用既有 login／feedback／drop parsers 及 event-specific guards 驗證選定家族，且 compile-time assertion 要求 `WebClientServerMessage["t"]` 每種 discriminator 必須在 guarded list 或 gap list 分類。

本輪 guarded 覆蓋：login／characters／create-name-delete／errors；hit、active-hit、touch、stat-basis、test-tools；field／self snapshots、movement、mob／NPC／user、temporary stats；party／party-command／trade-command／fame／chat／whisper／find；skills／inventory／shop／dialogue；drop／loot／notice／disconnect／`t: "unknown"`。精確列表由 `SERVER_MESSAGE_VALIDATED_TYPES` 提供。刻意明列 gaps 是 `trade` 與 `messenger` 的 nested unions；任何不在 validator map 的未識別／未來 discriminator 仍 pass-through。不得將它描述成完整 `ClientEvent` schema；`client/main.js` 仍未 strict 型別化。

測試包含代表 payload 接受／拒絕、欄位型別／範圍與路徑／巢狀資料案例，也驗 transport 將 guard false／throw 導入 malformed path；範圍、完整 gate 結果見 [ADR-158](DECISIONS.md)。沒有登入 LIVE、操作角色或改 save。

格式化則由 Prettier 3.9.10 換成 Bun 1.4.4 內建 `bun fmt`：兩個 formatter 使用同一 `.prettierrc.json`，438 個格式化路徑的結果逐檔 byte-for-byte 一致；已移除 Prettier package／lock entry，設定檔保留。`bun check --no-script` 亦在 730 個 TS files 無 type errors；維持 pinned TypeScript 7.0.2 `tsc` 為正式 typecheck script。

## 最新增量：strict browser preferences 與 UI window persistence（ADR-164）

`client/browser-preferences.ts` 將 `localStorage` 安全取得、偏好讀寫、unknown JSON validation 與 UI window/tab policies 自未型別化的 `client/main.js` 拆至 strict TypeScript。window keys／tab key 的現有 shape 保留；quick-slot profile 的 own payload logic 仍在 `quickslots.ts`，只共用安全 storage accessor。這是 page-local UI preference，與 server／角色 save 分離。

inventory position 接受有限 x/y 且不 clamp；shop position round 後 clamp 到 viewport／sheet width，至少留 48 px 水平、32 px 垂直可抓邊，明確標註為 browser usability policy 而非原版常數；tab 僅接受 1..4、default EQUIP=1。storage getter、讀取／JSON parse／寫入出錯皆 fail-soft，不阻止 drag、inventory action 或進入 field。主入口現不再直接存取 localStorage。

`server/test/browser-preferences.test.ts` 新增 **4/0**；與 `client-ui.test.ts`／`browser-startup.test.ts` focused 合計 **9/0、3 files**，真 main startup／client probe 亦通過。pinned TS 7.0.2 strict typecheck、Bun 1.4.4 `format:check`、build 與完整 `bun run check` 全通過；full suite **1493/0、5334 expects、174 files（333.96 s）**。`bun check --no-script --timing` 為 **743 checked／744 loaded**；Prettier 3.9.10／Bun formatter **451/451 byte-identical**。無 LIVE login、角色操作或 save access。

## 前輪增量：strict map-resource HTTP loader 與 generation fence（ADR-163）

`client/map-resource-loader.ts` 將既有 `/api/map/<id>` name／geometry 與 `/api/map/<id>/art` 請求從未型別化的 `client/main.js` 拆至 strict TypeScript。fetcher 可注入、response 保持 `unknown`，重用 ADR-162 的 DTO guards；不重複 schema、不更動 server 或 WZ source。

三種 API 保留各自原有政策：map-name 查詢對 fetch／HTTP／JSON／shape／ID failure 回 `undefined`，維持 `/find` 的 ID fallback；geometry HTTP／contract failure 仍拋出可記錄錯誤，完整讀取 JSON 後才檢查目前 field／`mapGeneration`，stale response 不會安裝；map-art 以 `ready`／`http-error`／`stale` union 明確區分合法素材、原有 no-art 訊息與過期請求，malformed art 仍拋錯。generation check 的時點與 `self?.mapId`／`map?.id` identity 條件皆保留，未加入 abort、retry、fallback art 或新 timer。

新增 `server/test/map-resource-loader.test.ts` 四項隔離 regression，覆蓋 map-name soft-failure／ID、geometry HTTP／shape／ID、JSON 尚未完成時切換 owner 的 stale fence、art valid／missing／stale／malformed 分支。focused **4/0、1 file**。`client/main.js` 只保留 state 安裝、記錄與 renderer work；HTTP parse／validation／generation ownership policy 集中在新 TS boundary。本輪 pinned TypeScript 7.0.2 strict typecheck、Bun 1.4.4 format check、`bun check --no-script --timing`（**741 checked／742 loaded**）、browser build 與完整 `bun run check` 全通過；全套 **1489 pass／0 fail／5334 expects、173 files（378.89 s）**。Prettier 3.9.10／Bun formatter **449/449 byte-identical**。新 memory-only preview 使用 `--save off`，read-only GET 與兩種 map guard 均通過，未登入或建立／操作角色。

## 前輪增量：strict map-resource HTTP contract 與 DTO guards（ADR-162）

`client/map-resources.ts` 定義 `/api/map/<id>` map geometry、`/api/map/<id>/art` 與 map-name 的 browser wire types，並對 `unknown` payload 深度驗證。`client/main.js` 僅在完整 guard 通過且回應 `id` 等於請求 map ID 時安裝 map／art；既有場地 generation fence 保留。server `mapJson`／`artJson` 明確回傳共用 DTO，編譯期避免 browser projection 漂移。

map guard 涵蓋合法 map ID／名稱、有限 terrain／portal／ladder／spawn 數值、物理 bounds、背景、sprite、frame、相機 bounds 順序、missing-tile 欄位，以及可選 minimap 的原生畫布尺寸與座標；map 0 仍有效，no-destination sentinel 仍非法。沒有改 WZ parser、原地形資料、地圖命令權限或存檔 policy。

`server/test/browser-resource-contract.test.ts` 用唯讀真 Data.wz HTTP map/art response 與 malformed fixtures 驗證 wire contract；同一真 WZ HTTP server 逐一驗證 **100 張 map JSON response**；全 archive 的 **100 張 map-art** 亦全部通過 browser guard。`client_probe.ts` fixtures 以 `BrowserMapResource`／`BrowserMapArtResource` 約束，且依 request path 回正確 map ID；沒有放寬 guard。contract focused **5/0、1 file**。

ADR-162 的 TypeScript 7.0.2 strict typecheck、Bun 1.4.4 `bun check --no-script --timing`、format check、browser build、Prettier 3.9.10 comparison **447/447 byte-identical** 與完整 suite **1485/0、5334 expects、172 files** 全通過。僅使用 local test server、isolated fixtures 與唯讀 Data.wz；未登入 LIVE、操作角色、讀寫既有 save 或執行 state-changing probe。詳細結果見 [ADR-162](DECISIONS.md)。

## 前輪增量：strict map-command parsing 與 `/api/maps` guard（ADR-161）

`client/map-commands.ts` 將原在 `client/main.js` 的 `/map` aliases、`/maps`、`/where` parsing／呈現移至可 strict typecheck 的 pure module；`client/map-constants.ts` 單一提供 `RETURN_MAP_NONE` 與 `0x0D` signed-32-bit 上限，`server/src/game/map.ts` 保留原 export。地圖目錄先以 `isMapDestinations` 驗證每個 ID 為安全、非負且可表達的整數（排除 no-destination sentinel），name／streetName 必須是字串，再做原本不分大小寫的搜尋與最多 20 筆顯示。map ID 0 仍有效。

focused map／resource／portal regressions **24/0、4 files**；strict TypeScript 7.0.2 typecheck、`bun check --no-script --timing`（**738 checked／739 loaded**）、`bun run format:check`、Bun browser build 通過。Prettier 3.9.10 與 Bun 1.4.4 現樹 **446/446 byte-identical**。完整 suite **1482 pass／0 fail／5334 expects、172 files（345.82 s）**。全程只用 isolated fixtures、local test server 與 Data.wz；沒有 LIVE login、角色操作、既有 save 讀寫或 state-changing probe；既有 memory-only preview 維持 `--save off`。

## 前輪增量：trade JSON projection 與完整 MiniRoom guard（ADR-160）

`client/trade-wire.ts` 定義獨立 JSON-safe MiniRoom DTO：僅把 cash block 的 `sn`／`unknown1A` u64 用 `BigInt.toString(10)` 編為 canonical 十進位字串；`unknown18` 保持 number，null 與其他 event 欄位不變。原始 protocol 與 save 型別未改，沒有經過可能失真的 JS number。`clientEventJson`、出站 `WebClientServerMessage`、browser `TradeState` 共用該 wire contract；native session 有明示 `receiveProtocol` 邊界。

`client/trade-message-validation.ts` 驗證全部十種 MiniRoom variants、participant／room indexes、1..8 slot、equip/non-equip 欄位及 u8／u16／u32／u64 範圍；只有十進位、無前導零的 u64 字串可進 browser，cash block 的 `sn` 必須非零。trade 加入 guarded set，現為 **57/57 已知 discriminator 有 guard、gaps 為空**。隔離 native-peer regression 驗證 `0x50 type 11` → codec／session／projection → `JSON.stringify`／`JSON.parse`，兩個 u64 完整以十進位字串 round-trip；validator fixtures 逐 variant accept/reject。

未識別／未分類 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard），所以仍不是全事件 runtime schema；`client/main.js` 尚未 strict 型別化。驗證／formatter audit 見 [ADR-160](DECISIONS.md)。未登入 LIVE、未操作角色、未讀寫 save；既有 memory-only preview 繼續 `--save off`。

## 前輪增量：Messenger payload guard 與 trade gap trace（ADR-159）

新增 `client/messenger-message-validation.ts` 並接入 central `validateServerMessagePayload` map 與 compile-time coverage set。全部八種 `MessengerEvent` 都驗：participant／left／cell-update 槽位界線、level／face／look 欄位、chat／invite／result payload，以及 `roster` 恰好三格且 marker-specific cells 合法。`MESSENGER_ROOM_SIZE` 移到純 `client/messenger-constants.ts`，client state、protocol、server registry、guard 共用同一常數；protocol 不載入 UI state 模組。

ADR-159 當時是 **56 個 guarded discriminator、`trade` 唯一明列 gap**。Type-11 cash-block BigInt 已由隔離 peer regression 證明可穿過 codec 與 bridge JSON projection，造成 direct `JSON.stringify` 丟 `TypeError`；此 gap 在 ADR-160 才由明確的無損 projection 關閉。未知／未分類 runtime `t` 當時及現今都 pass-through（已知 `t: "unknown"` 有 guard）；`client/main.js` 仍未 strict 型別化，不宣稱完整 server-message schema。

ADR-159 的驗證結果：focused **35/0、8 files**；full suite **1476/0、5334 expects、171 files（299.67 s）**；strict TypeScript 7.0.2 typecheck、`bun run format:check`、`bun check`（732 files）與 browser build 通過。該輪 formatter audit 是 **440/440 byte-identical**。沒有 LIVE login、角色操作或 save 讀寫；memory-only preview 使用 `--save off`。

## 唯一版本與安裝入口

| 工具 | 固定穩定版 | 鎖定來源 |
| --- | --- | --- |
| Bun | 1.4.4 | `.bun-version`、根 `package.json` 的 `packageManager` |
| TypeScript | 7.0.2 | 根 `package.json` 與 `bun.lock` |
| Bun 型別 | 1.4.4 | 同上；與 runtime 同版 |
| Formatter | Bun 1.4.4 `bun fmt` | Bun runtime 內建；`.prettierrc.json` |
| Playwright Core | 1.64.1 | 根 devDependencies / bun.lock，Bun 直接執行 |
| Chromium tooling | 153.0.0 | 同上；只作隔離 browser 驗證 |
| checkout Action | v7.0.1 | CI 固定完整 commit SHA |
| setup-bun Action | v2.2.0 | CI 固定完整 commit SHA |

版本來源：**2026-10-24** 重新查詢四項固定 npm devDependencies、Prettier comparison package、Bun release 與兩個 GitHub Actions latest；Bun／`@types/bun` 為 1.4.4，TypeScript 7.0.2、playwright-core 1.64.1、Chromium tooling 153.0.0 維持 latest。`@oven/bun-linux-x64@1.4.4` tarball SHA1 `9ffc89c427ea37043589bdfe2d5999b01cb2eee2` 與 SHA512 `CHbbkmHVM28T1GFq+6GL4Ao4ujwwYwj1CxFFwEFzLanPfNsId9AhbIP0Q4reWuWBkGimUkoQygrK7Rgjtj3vog==` 與 registry metadata 相符；ADR-158 移除 Prettier 後，frozen install 結果另於 [ADR-158](DECISIONS.md) 記錄。Prettier 3.9.10 只作 formatter byte-comparison 的已驗證臨時工具，不再是 package pin。版本來源：[Bun release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4)、[TypeScript registry](https://registry.npmjs.org/typescript/latest)、[Bun 型別 registry](https://registry.npmjs.org/@types/bun/latest)、[Playwright Core registry](https://registry.npmjs.org/playwright-core/latest)、[Chromium tooling registry](https://registry.npmjs.org/@sparticuz/chromium/latest)、[checkout releases](https://github.com/actions/checkout/releases/latest)、[setup-bun releases](https://github.com/oven-sh/setup-bun/releases/latest)；formatter comparison 使用 [Prettier 3.9.10](https://registry.npmjs.org/prettier/latest)。ADR-093 的 2026-10-19 查核是當時基線，不代表目前仍相同；之後升版必須重跑 lockfile、型別、回歸與瀏覽器 build。

先用官方發行版安裝固定 Bun，再從 repository 根目錄執行：

```sh
bun tools/setup.ts
bun run typecheck
bun run format:check
bun run test
bun run build
```

`setup.ts` 檢查實際 Bun 版本後，只執行 frozen lockfile 安裝，禁止安裝生命週期腳本；不測試、不登入、不寫進度。
本輪沙箱以 registry 官方 tarball 驗證後，暫存 Bun 1.4.4 與依賴於 ignored `node_modules/` 供驗證；該路徑不進 Git，沙箱重置後須按 `.bun-version` 重新安裝／加入 PATH。不覆寫作業系統的 Node/Python。

## 編譯、瀏覽器與遷移界線

- 根 `tsconfig.json` 使用 `target/module: ESNext`、Bundler resolution、嚴格型別、unused 檢查、
  `verbatimModuleSyntax`、`erasableSyntaxOnly`，**不關 strict、不 skipLibCheck、不加 allowJs 假裝遷移完成**。
- 所有 `client/**/*.ts`／`.mts`、server、tools 的 TypeScript 都在檢查範圍。
  client 的 61 個原有 leaf 已完成真正實作型別，現有 **125 支 `.ts`**（含共用型別／守衛），
  全專案已無 authored `.mjs`／重複 declaration。
  **唯一尚未獲嚴格型別驗證的 authored 來源是 `client/main.js`**（5507 行，JS／TS 混用），必須繼續實際遷移；
  `server/scripts/client_probe.ts` 自 ADR-109 起已納入檢查（其 DOM／VM shim 亦已型別化）。
- 已遷移共用模組把宣告和實作收斂到同一 `.ts`，保留原證常數、順序與整數運算。
- 開發 HTTP 只對 `.ts` 使用 Bun.Transpiler，移除型別後以 JavaScript MIME 回應；不用瀏覽器原生理解 TS。
  `server/test/bun-static.test.ts` 以獨立 port 檢查此路徑，不連遊戲、不登入。
- `client/websocket-transport.ts` 是 browser socket lifecycle／頂層 JSON envelope 的 strict TS 模組，且由 `client/main.js` 接上 per-family payload guards；目前 57 個已知 discriminator 全數受 guard，`SERVER_MESSAGE_VALIDATION_GAPS` 為空。未識別 runtime `t` 仍 pass-through（已知 `t: "unknown"` 有 guard）；這不是完整 `ClientEvent` runtime schema，也不代表 `main.js` 已型別化。
- `bun run build` 用 Bun 的 browser/ESM bundler 輸出 ignored `dist/client`，複製 HTML、CSS 與字型。
  建置結果是產物，不是 authored JavaScript 原始碼。
- `node:` 匯入是 Bun 提供的標準函式庫相容介面，不呼叫 Node runtime；現存 `node:test` 來源由 Bun 執行。
- 9 支純規則 probe 已移至 `server/test/presentation-*.test.ts`，連同新增 recovery／typed UI／WZ HTTP 測試納入根 suite。
  7支手動 `browser_*_probe.ts` 已strict型別化但本輪未執行登入／角色場景；另有frame／play兩支strict runner，完整界線見 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)。`server/scripts/client_probe.ts`（離線 VM／DOM shim 探針，非自動執行）自 ADR-109 起也在檢查範圍內，由 `server/test/client-ui.test.ts` spawn 執行；全案仍欠主入口，不能以能 bundle 代替完成。

## 工具遷移與原證

已移除 Node/npm 與 Python 的獨立版本檔、server 重複 package/lock/tsconfig，以及 Bash/Python 的啟動／分析實作。
分析改用以下 TypeScript 入口：

```sh
bun tools/hexfunc.ts MapleStory.exe.c sub_5376C0 --calls
bun tools/kstr.ts MapleStory.exe.c sub_5376C0 --names
bun tools/wz.ts help
bun tools/wz.ts manifest
bun tools/wz.ts dump Map/Map/101000000.img --json
```

WZ 工具直接重用產品 parser，不再維護第二套 Python parser；舊 Python CLI 的子命令／參數並非全部同名。
因此**不能再聲稱有兩個獨立現行 reader**。改以舊 Python 已保存且不重新生成的
`analysis/data_wz_manifest.json`，對照所有 1,056 個 image 的 offset、size、source 及每段原始 bytes checksum，
另保留產品 parser 的手建 fixture 與既有 goldens。
反編譯工具保留原始 bytes，再以 CP949 優先解碼；不先 UTF-8 replace 毀掉韓文字串。

原 `.c`／`.lst`、EXE/DLL/ACM、WZ、analysis 資料與過往 ADR 均是原證或歷史記錄，**不翻譯、不格式化、不刪除**。
歷史文件中的 `.py`、`node`、`npm` 舊命令只代表當時操作；現行命令以本頁與 README 為準。

## 存檔與操作安全

```sh
# 必須先停止舊程序、確認真正 save、冷備；這個入口不替你做以上三件事。
bun tools/serve-existing-save.ts generated/<真正存在的存檔>.json
```

只接受已存在、非空的 regular file，否則直接失敗，不建立 replacement、不加種子帳號、不聲稱恢復成功。
預設 web/login/game 為 8515/8516/8517，綁 0.0.0.0；可用 `KMS_WEB_PORT`、`KMS_LOGIN_PORT`、
`KMS_GAME_PORT` 指定 1–65535。瀏覽器素材與 WebSocket 維持同 origin，不指向使用者機器的 localhost。
保護測試只用臨時 fixture，不接觸玩家存檔。

本次允許型別、格式、單元回歸及建置；**不自動登入、不操作角色、不寫玩家進度、不自動跑手動 probe**。

## 瀏覽器工具與安全邊界

Playwright Core／Chromium 皆固定本日 registry latest，安裝生命週期腳本仍禁止。Bun 直接載入 tooling，沒有呼叫 Node runtime；browser binary、NSS/NSPR 由 dev package 提供，不提交產物、不需 apt 或外部 Playwright module。內建 binary 用於 Linux x64；其他平台請明示 CHROMIUM_EXECUTABLE 指向可用的本機 Chromium。Linux 的額外 shared-library path 只傳給子 browser，不改遊戲 server 環境。保留一般瀏覽器 origin/security 檢查，不開 disable-web-security。

source／bundle 的真瀏覽器啟動與假傳輸 UI 測試納入 bun run test。只用 ephemeral HTTP port，沒有遊戲 server／玩家帳號／save；WebSocket 在 Playwright 內攔截，永不 connectToServer。故障注入會故意製造錯誤，確認啟動警示與 ready gate，不是在 LIVE 注入。

現行 typed 工具（有副作用的分支須依限制手動操作）：

```sh
bun tools/audit-drop-landing.ts   # 原WZ全圖，只讀、無登入／save
bun tools/audit-drop-evidence.ts  # per-image 掉落證據掃描，只讀、無登入／save
bun server/scripts/art_perf_probe.ts
bun server/scripts/browser_audio_probe.ts <明示web-port或http(s)://origin>
bun server/scripts/equipment_fixture.ts generated/validation/<全新名稱>.json
bun server/scripts/browser_display_probe.ts <明示web-port或http(s)://origin>
bun server/scripts/browser_render_probe.ts <明示web-port或http(s)://origin>
```

音訊只讀、無登入且拒絕隱含預設目標；裝備 fixture 是明示建立獨立新檔，非恢復／修改進度，不能自動拿來替代玩家存檔。僅餘client_probe.mjs仍未遷完；frame／play的現行安全入口見 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)，不自動執行手動登入／移動 probe。

`whisper_probe.ts` 也已嚴格型別化，採顯式帳號／目標／ack與共享TCP transport；歷史跨系統場景沒有重新驗收，
不得以舊105項PASS宣稱當前服務認證。只讀 display/render 已跑真瀏覽器；field/login分支未跑，見
[BROWSER_TOOL_CLEANUP](BROWSER_TOOL_CLEANUP.md)。

手動browser probe的明示帳號／目標／--allow-state-changes與七個入口見
[STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)。不要照歷史node／MJS命令操作；import不會自動執行。

## 實際驗證狀態

本輪 ADR-164：strict typecheck／format check／Bun check／browser build 通過；preferences／UI／startup focused **9/0、3 files**，完整 suite **1493/0、5334 expects、174 files（333.96 s）**。`bun check --no-script --timing` 為 **743 checked／744 loaded**，現樹 formatter audit **451/451 byte-identical**。固定 pins 與 2026-10-24 latest 核對一致；memory-only preview 明確 `--save off`，唯讀 GET／map guards 通過，沒有登入／操作角色或觸碰既有 save。詳細偏好邊界與安全界線見 [ADR-164](DECISIONS.md)；地圖 DTO／HTTP lifecycle 見 [ADR-162](DECISIONS.md)／[ADR-163](DECISIONS.md)。

前輪掉落／fh增量：strict／format／build通過，focused73/0（7 files），新增28案例。
完整1023/44（1067 tests / 117 files，187.28s），相對7162765 failure multiset含重複新增0／移除0，CI仍不綠。
全100張原WZ地圖379422組、真PNG／DPR1／2 component及新LIVE的81modules／唯讀標題120幀通過、0WS。
新獨立測試入口不是舊進度恢復；玩家自行操作後不重啟或重置，不能以save hash不變當作並行觀測前提。
六個registry latest與pins仍一致；日誌在ignored generated/drop-landing/，完整界線見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。

### 前輪工具／實體素材（7162765）

工具／實體素材增量：strict／format／build通過；focused78/0（9 files）、最後工具15/0。
完整995/44（1039 tests / 113 files），對29f3df6 failure multiset新增0／移除0；新增19案例，未skip。
22個工具／元件import與七個runner的錯誤入口皆0 I/O attempts；真Chromium觀測／redirect防護與原WZ HTTP metadata通過。
當輪LIVE同PID6097，79modules與首幀通過、0WS，沒有登入／操作角色／save／restart。
六個registry latest再次與pins一致；本輪日誌在ignored generated/strict-cleanup/。

### 前輪手感實驗（29f3df6）

手感實驗增量：strict／format／build通過，focused81/0（9 files），完整976/44（1020 tests / 110 files）；
相對9e10525 failure multiset新增0／移除0，預設30ms的3540frames／425原movement packet bytes與修改前相同。
LIVE同PID6097，76 modules與唯讀首幀通過、0WS；不登入／角色／save／restart。
新增兩個typed controls/rules實作，只有原生TS／ESNext／Bun；main與10MJS仍待實際遷移。
非原版步長／鏡頭的授權與限制見 [MOTION_EXPERIMENTS](MOTION_EXPERIMENTS.md)。

### 前輪顯示／影像快取與工具（9e10525）

顯示／快取／工具增量：strict／format／build 通過，最終focused63/0（8 files）；完整
**958 pass / 44 fail，1002 tests / 109 files**，相對c8b52d7失敗multiset新增0／移除0。
真Chromium五DPR、同頁DPR-only切換、title120畫格、真WZ avatar decode/revoke後像素通過。
當輪LIVE同PID6097、74 modules與首幀通過、0WS，不登入／操作角色／save／restart。
六個npm latest與exact pins逐個相符；沒有升到不存在的新版本。

### 前輪走跳／鏡頭增量（c8b52d7）

走跳／鏡頭增量：strict／format／build 通過；完整 **931 pass / 44 fail，975 tests / 106 files**，
對38cdd2d的44項failure multiset新增0／移除0。新camera/presentation focused19/0，
原／新權威3540frames與425個movement packet bytes全同；LIVE仍同一PID、72modules與唯讀Chromium首幀通過，0WS。
新三模組全部嚴格TS；全案遷移仍未完成。細節及最多30ms呈現延遲限制見
[PLAYER_PRESENTATION_CAMERA](PLAYER_PRESENTATION_CAMERA.md)。

### 前輪登入修復凍結點（38cdd2d）

frozen lockfile（47 packages 無漂移）、根 strict typecheck、格式與 browser build 均通過。
完整回歸 **916 pass / 44 fail，960 tests / 105 files**；上一凍結點 ff0e735 是902/44。44項檔名／標題／重複次數完全相同，新增／移除均0。**不能以無新增失敗推論沒有執行期問題**：本輪真 Chromium 找出並修正前輪漏掉的 stat-body tag 錯誤，已補正式啟動／假傳輸／故障注入案例。

focused 20/0；真 Chromium 的來源版與建置版、PNG實際壓縮／快取、150筆原音訊解碼、fixture獨占寫入與防越界皆通過。原 WZ manifest checksum 及其他既有測試保留。現有 LIVE 首頁200、兩個entry與69個模組 HTTP／MIME／JS parser 通過；只載入頁面的 Chromium 實測 ready／首幀通過、page errors=0、WebSocket attempts=0。沒有登入 LIVE、操作現有角色或重啟 server。

**歷史快照（38cdd2d）**：當時44個失敗仍未結案、main.js與10支工具仍待遷移；ADR-108後44項已結案，ADR-109及後續輪次已遷完工具，目前僅主入口 `client/main.js` 尚未 strict 型別化。此段保留當輪證據，不代表現行 suite 仍有失敗。CI 不使用 continue-on-error、skip、縮小範圍或關閉 strict；完整歷史見 [BUN_MIGRATION](BUN_MIGRATION.md)。
