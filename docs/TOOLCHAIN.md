# Bun / TypeScript / ESNext 工具鏈

更新：2026-10-19。**這是尚未完成的全專案遷移，不是完成交付聲明。**

本輪續作：frame／play 已真正遷為 strict TS／Bun，刪除舊 shim／直接封包工具，詳 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)。目前僅餘 main.js 與 client_probe.mjs 尚未完成實作型別遷移；歷史數字／PID不代表當前 LIVE。

最新一輪strict／format／build通過、focused25/0；完整1064/44（1108tests／124files，267.35s），對當輪前基準失敗multiset新增0／移除0。35純imports／0 I/O，手動角色場景未代玩家執行。

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

## 唯一版本與安裝入口

| 工具 | 固定穩定版 | 鎖定來源 |
| --- | --- | --- |
| Bun | 1.4.3 | `.bun-version`、根 `package.json` 的 `packageManager` |
| TypeScript | 7.0.2 | 根 `package.json` 與 `bun.lock` |
| Bun 型別 | 1.4.3 | 同上；與 runtime 同版 |
| Prettier | 3.9.10 | 同上與 `.prettierrc.json` |
| Playwright Core | 1.64.1 | 根 devDependencies / bun.lock，Bun 直接執行 |
| Chromium tooling | 153.0.0 | 同上；只作隔離 browser 驗證 |
| checkout Action | v7.0.1 | CI 固定完整 commit SHA |
| setup-bun Action | v2.2.0 | CI 固定完整 commit SHA |

版本來源（六項 registry latest 與兩 CI Action 於 2026-10-19 清潔輪以 API 實測**全部相符**，ADR-093；存證 `generated/native-messages/registry-latest-cleanup.json` 與 `generated/bun-install-proof.json`，Bun tarball 經 SHA512 驗證）：[Bun release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3)、
[TypeScript registry](https://registry.npmjs.org/typescript/latest)、
[Bun 型別 registry](https://registry.npmjs.org/@types/bun/latest)、
[Prettier registry](https://registry.npmjs.org/prettier/latest)、
[setup-bun release](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0)。
六項runtime／compiler／tool套件為本輪最新穩定版基線，不宣稱永遠最新；升版要重新檢查 lockfile、型別、回歸及瀏覽器建置。

先用官方發行版安裝固定 Bun，再從 repository 根目錄執行：

```sh
bun tools/setup.ts
bun run typecheck
bun run format:check
bun run test
bun run build
```

`setup.ts` 檢查實際 Bun 版本後，只執行 frozen lockfile 安裝，禁止安裝生命週期腳本；不測試、不登入、不寫進度。
本沙箱的 Bun 位於 ignored `generated/toolchain/bin/bun`；新 shell 可明示
`export PATH="$PWD/generated/toolchain/bin:$PATH"`。不覆寫作業系統的 Node/Python。

## 編譯、瀏覽器與遷移界線

- 根 `tsconfig.json` 使用 `target/module: ESNext`、Bundler resolution、嚴格型別、unused 檢查、
  `verbatimModuleSyntax`、`erasableSyntaxOnly`，**不關 strict、不 skipLibCheck、不加 allowJs 假裝遷移完成**。
- 所有 `client/**/*.ts`／`.mts`、server、tools 的 TypeScript 都在檢查範圍。
  client 的 61 個原有 leaf 已完成真正實作型別，現有 89 支 `.ts`（含共用型別／守衛），無 `.mjs`／重複 declaration。
  **`client/main.js` 及 server/scripts 剩餘 1 支 `client_probe.mjs` 仍未獲嚴格型別驗證**，必須繼續實際遷移。
- 已遷移共用模組把宣告和實作收斂到同一 `.ts`，保留原證常數、順序與整數運算。
- 開發 HTTP 只對 `.ts` 使用 Bun.Transpiler，移除型別後以 JavaScript MIME 回應；不用瀏覽器原生理解 TS。
  `server/test/bun-static.test.ts` 以獨立 port 檢查此路徑，不連遊戲、不登入。
- `bun run build` 用 Bun 的 browser/ESM bundler 輸出 ignored `dist/client`，複製 HTML、CSS 與字型。
  建置結果是產物，不是 authored JavaScript 原始碼。
- `node:` 匯入是 Bun 提供的標準函式庫相容介面，不呼叫 Node runtime；現存 `node:test` 來源由 Bun 執行。
- 9 支純規則 probe 已移至 `server/test/presentation-*.test.ts`，連同新增 recovery／typed UI／WZ HTTP 測試納入根 suite。
  7支手動 `browser_*_probe.ts` 已strict型別化但本輪未執行登入／角色場景；另有frame／play兩支strict runner，完整界線見 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)；全案仍欠主入口與client_probe.mjs，不能以能 bundle 代替完成。

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
bun tools/audit-drop-landing.ts  # 原WZ全圖，只讀、無登入／save
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

最新掉落／fh增量：strict／format／build通過，focused73/0（7 files），新增28案例。
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

**44個失敗仍阻擋驗收；main.js 與10支工具仍未遷完，這不是全專案完成。** 詳細範圍、原證與失敗清單見 [BUN_MIGRATION](BUN_MIGRATION.md)。CI 不使用 continue-on-error、skip、縮小範圍或關閉 strict。
