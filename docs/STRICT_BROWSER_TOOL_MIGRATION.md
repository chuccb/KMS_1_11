# 瀏覽器工具與實體素材的嚴格 TS 整理

2026-10-18，ADR-082。這是全案 TypeScript／ESNext／Bun 遷移的實作增量，**不是全案已完成**。

> 本頁保留7162765當輪的81支TS與995/44結果；後續掉落權威fh／呈現TS整理、83支TS及1023/44，
> 見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。舊PID6097／LIVE是前沙箱歷史，不代表當前仍存活。

本輪續作：frame／play 已真正遷為 strict TS／Bun，刪除舊 shim／直接封包工具，詳 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)。目前僅餘 main.js 與 client_probe.mjs 尚未完成實作型別遷移；歷史數字／PID不代表當前 LIVE。

## 本輪範圍

- 7 支 browser probe 從 MJS 真正遷成嚴格 TS；刪除舊檔，不保留 JS 相容殼。
- 共用 `server/scripts/browser-fixture.ts`、`browser-observation.ts`，不再每支工具重寫 Playwright 啟動、WebSocket／Canvas／Blob 監測。
- 從 main 抽出 `client/entity-assets.ts`、`entity-resource-validation.ts`、`avatar-look.ts`。
- client 現有 **81 支 TS**。主入口 `main.js` 及 **3 支 MJS** 仍待真正遷移：`client_probe`、`frame_probe`、`play_probe`。
- 根 strict／ESNext／unused／erasableSyntaxOnly／skipLibCheck=false 不變；沒有 allowJs、no-check、重複 declaration 或新增 production any。
- 再次逐個查詢 npm latest：Bun1.4.3、TypeScript7.0.2、@types/bun1.4.3、Prettier3.9.10、Playwright Core1.64.1、Chromium tooling153.0.0，與 exact pins 一致，不重裝同版冒稱升級。

## 真正拆出的素材責任

`entityAssets` 持有 NPC／mob 各自的 actions、metadata、bodyAttack、pushed 與 pending/negative cache。
主入口只保留場景整合與 NPC presentation callback，不再直接信任這兩類 response.json()。

- 每份 metadata 先驗證未知 JSON、template identity、sprite origins／delays、NPC dense speech／extra actions／click bounds，以及怪物攻擊資料，再交給呈現端。
- 保留 `nativeMobActions` 的原 30ms attack/body 量化與 rawDelay，不混用可選本機角色步長，不改來源 WZ frames。
- `clear()` 取消所有請求並撤銷 ownership；同一 generation 重入也用 request identity 區分，防止舊 finally 刪新 pending、舊成功或失敗覆蓋新值。
- field/login/disconnect、socket close 與 map resource reset 均清理；generation 改變後，晚到的 JSON 不更新 metadata、NPC presentation 或預熱舊 PNG。
- 失敗沿用原 browser 政策：此場地內不逐 RAF 重試，clear／換場才釋放 negative cache。沒有假動作、假 click bounds 或合成圖像 fallback。
- metadata 預設 bodyAttack=false、pushed=1、maxMP=0／attacks=[] 保留既有語義；pushed=1 的原證見48D080。缺 metadata 不會開啟 body contact。

`lookOf` 將本機獨立 hair 與 remote 0x1C 的 avatarItems 首項 hair 分開；不把頭髮畫成裝備、不改來源陣列。
20000／30000 是既有空白 preview 的 browser 預設，不是角色授裝或寫入存檔。
完整 WebSocket／map JSON schema 與 main 的型別化仍未完成，不能由這三個模組推論全 client 已有深驗證。

## 手動工具入口與安全條件

| 現行入口（server/scripts） | 必要 fixture                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------- |
| browser_motion_probe.ts    | 已有角色、原 Amherst 地形；可加 --climb                                             |
| browser_portal_probe.ts    | 已有 travel 角色及 operator map-command 權限；--auto 需原105040200 spawn9的獨立角色 |
| browser_minimap_probe.ts   | 已有角色及明示 map-command 權限                                                     |
| browser_stat_probe.ts      | 原六 AP fixture：STR8/DEX6/INT6/LUK5/AP6                                            |
| browser_equipment_probe.ts | equipment_fixture.ts 的 gear；第二帳號為 watch                                      |
| browser_creation_probe.ts  | 兩個空帳號，primary 為 male、alt 為 female；另給 PROBE_NAME／PROBE_ALT_NAME         |
| browser_selection_probe.ts | primary 有角色；alt 是空帳號                                                        |

每個 runner 都有 `import.meta.main` 閘門；程式匯入不啟動 browser、socket、HTTP server 或登入。
執行必須同時給 **明示 origin／port、--allow-state-changes、PROBE_ACCOUNT／PROBE_PASSWORD**。
三個雙帳號情境另需 **PROBE_ALT_ACCOUNT／PROBE_ALT_PASSWORD**，兩帳號不得相同；創角還需明示兩個新名字。
沒有 admin／travel 等隱含帳密，不再接受外部 PLAYWRIGHT_MODULE；共用本專案鎖版的 browser.ts，CHROMIUM_EXECUTABLE 仍可明示覆寫 binary。

例如，只能在自行確認是可丟棄 fixture 後手動執行：

```sh
# FIXTURE_* 必須由操作者指向全新的獨立進度；不能使用既有玩家世界。
PROBE_ACCOUNT="$FIXTURE_ACCOUNT" PROBE_PASSWORD="$FIXTURE_PASSWORD" \
  bun server/scripts/browser_motion_probe.ts "$FIXTURE_ORIGIN" --allow-state-changes --climb
```

工具拒絕歷史8495/8496/8497、目前8515/8516/8517及對應 e2b proxy；也拒絕 URL 內帳密、path/query/fragment、未知或重複旗標。
HTTP 限同 origin，WebSocket 限該 origin 的 /ws；跨 origin navigation 在填帳密前拒絕。
**這些閘門不是自動證明任意 target/save 已隔離**。本輪沒有執行上述登入／移動／AP／換裝／建刪角情境，不挪用歷史 PASS。

原 motion probe 尚把 body action35/37倍增成70/74當 movement wire。現依508FC0及已存在的 native locomotion 原證改成 walk2／jump6／rope16（另有 facing bit），不修改 production 物理或原 codec。
缺角色現在明確失敗，要求先準備合法 fixture，不再走未完成 name-check 的隱含建角流程。
Stat 截圖改取真 stat-window bounding box；debug 圖片統一寫入 ignored generated/validation，不寫玩家存檔。

## 觀測不是權威

`installBrowserObservation` 是可由 Playwright 序列化的自含函式，型別和實際 initializer 同檔，沒有假的 .d.ts。
Window extension 只用於明示安裝的 fixture page，game 不安裝它。selection 另讀取原有 module state 的唯讀快照，取回後逐欄驗證。

- 觀測的 JSON 是使用欄位的已驗證投影，**不是完整 browser protocol decoder**；未知種類保留 kind/raw payload，錯誤形狀列入 invalid，runner 結尾必須檢查。
- 不重寫送收資料；壞封包仍正常送達實際 listener。登入觀測不保留帳密。
- 完整保留 drawImage 三種 overload、transform、fillText/fillRect、原生音訊 start；不替換圖片尺寸或注入掉落／位置／地形。
- Avatar Blob 以 WeakMap 關聯 HTTP query，不在原 Blob 上塞自訂 property；revoke 釋放 active 所有權，仍保留有界歷史供既有圖片辨識。
- 診斷歷史各自有界：一般5000、invalid100、mini blits500、yellow marks200；是工具記憶體政策，不是原版常數。每個真正 app frame 只清該幀 draw/text。

## 實際驗證與未完成

- strict typecheck／format／browser build：通過。
- focused：**78 pass / 0 fail，9 files**；含本輪新增 **19案例**（素材10、外觀3、工具6）。最後工具路由／redirect 與 import 再驗 **15/0**。
- 完整 suite：**995 pass / 44 fail，1039 tests / 113 files**。相對29f3df6的976/44，失敗 multiset（含重複標題）新增0／移除0；不是只比總數，CI仍不綠。
- 真 Chromium 的空白 HTTP fixture／Playwright fake echo：驗證真畫布像素、2/4/8座標 overload、transform、Blob revoke、音訊、壞封包仍送達、有界歷史、跨 origin／redirect 拒絕；沒有 game services／角色／存檔。
- 另外用原 Data.wz 的真 HTTP metadata 驗證四個存在的 NPC（1001000／1002000／1002001／2100），連同既有 mob／weapon／skill／creation 守衛；沒有猜測缺素材。
- 22 個工具／元件 import 在獨立 deny-network／deny-launch process 中通過；七個 runner 缺參數或指向保護 port/proxy 也在任何 I/O 前拒絕，attempts=0。
- source／bundle 真 startup 與 controls 通過。既有 LIVE 同 PID6097，首頁200、**79 modules** HTTP／MIME／JS parser與 Chromium153.0.8010.0 首幀通過，page errors=0、0WS。
- **沒有登入 LIVE、操作現有角色、save 或 restart**。原 EXE／DLL／C／listing／WZ／analysis 不改。

日誌在 ignored `generated/strict-cleanup/`：registry、typecheck、format-check、build、focused-final、tools-final、full-suite、cross-check、comparison.json。
首次 metadata 擴充測試錯選 archive 不存在的1002002；已直接查原 WZ，改用確實存在且有多動作的2100，不改 parser、不加 fallback，初始失敗 log 保留。
下一步仍需遷移 main 與三個 legacy 入口、逐項修正44失敗與 typed whisper 的歷史 native admission 情境；不能跳過、縮小 suite 或加 CI skip 冒稱乾淨。
