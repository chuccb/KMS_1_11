# 原建立／刪除角色流程：來源、實作與驗證

> 後續ADR-082：7支browser工具已真正遷成TS；本頁舊node／MJS命令及PASS保留歷史時點，不是現行操作入口。
> 現行安全命令、未執行的手動場景與最新型別整理見 [STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)。

本次取代固定外觀的 HTML 建角列，接通 CUINewChar 與刪角的真登入封包、持久化。
不把此項完成當成整個遊戲已 1:1。原 `Data.wz` 未改。

## 來源與更正

| 原來源 | 本次落地 |
|---|---|
| `sub_42F160`、`sub_430690` | `newDlg` 260×424，置中 (270,88)；名稱 (110,143)、Check (191,141)、六個 combo (108,160+20i)、預覽腳 (141,123)、OK (58,383)、Cancel (139,383)，均為視窗內座標 |
| `Etc/MakeCharInfo.img/CharMale`、`CharFemale` | 直接讀六組選項並保留原序；名稱讀各 `Character/.../<8位id>.img/info/name`，不是自己翻譯或猜配裝 |
| `sub_430630` | 四個 4，再做九次 `rand()%4` 加一：每項 4..13、總和 25 |
| `newDlg` 印好的 STR／DEX／INT／LUK＋`sub_430690` y293/313/333/353 | **更正舊文件「骰子次序未知」**；最後四個 u32 依序寫入四能力，不再丟掉 |
| `sub_430BE0`、`sub_430C30` | 12 個更新步的骰動畫及原點擊區；瀏覽器以 30ms 驅動更新步，未宣稱 Windows 原計時器的毫秒精度已完全重現 |
| `sub_4304E0`、`sub_42FD30` | OK 必須檢查目前名稱；編輯名稱即失效，獨立 Check 不新增角色；提交時再檢查同一名稱／最新外觀與骰點 |
| `sub_524A00` | 4..12 **bytes**，ASCII 英數或 KS 韓文（lead B0..C8、trail A1..FE）；I/l 合計達四個拒絕；讀原 `ForbiddenName.img` 禁字 |
| `CWvsApp +8`／`+9` | **app8 才是帳號性別**；舊註解把 app9 當性別是錯的。app9 為名稱檢查權限旗標，一般帳號送 0，未加入 GM 略過禁字的管理介面 |
| `sub_431620` 刪除分支 | 原 YesNo，只有確認才送 c2s `0x07 + u32 id`；讀 s2c `0x06 + id + success`，成功後才移除清單 |
| `sub_52B8B0` | Notice／YesNo 均 264×132，置中 (268,234)；Notice OK 內座標 (100,92)、Yes (59,92)、No (140,92)，不是估算位置 |
| `sub_52C4C0` | 訊息逐行置中於 234px 內框，行距 14，起點 `43 + (43 - 14*n)/2`，白色一像素陰影與黑字 |

原字串從執行檔 PE section 映射取 CP949 bytes 解碼，不使用反編譯檔內已損壞的註解：

- `005B335C`：`선택된 캐릭터를 지우시겠습니까?`
- `005B33BC`：建立角色前的三行注意事項。
- `005B3238`：要求先按 Check 的訊息。
- `005B34F8`／`005B3524`／`005B34C0`：名稱可用／已用／檢查失敗。

原 WZ 的 `BtCheckId`、`BtOK`、`BtCancel`、`BtComboBox`、`BtYes`、`BtNo` 及四種按鈕狀態由畫布繪製。
HTML 僅供透明點擊區、名稱輸入與焦點，不再疊灰色表單；建角結果不另加中文 HTML 成功橫條。

## 六組選項原序

| | 男 | 女 |
|---|---|---|
| 臉 | 20000,20001,20002 | 21000,21001,21002 |
| 頭髮 | 30030,30020,30000 | 31000,31040,31054 |
| 上衣 | 1040002,1040006,1040010 | 1041002,1041006,1041010,1041011 |
| 下衣 | 1060002,1060006 | 1061002,1061008 |
| 鞋 | 1072001,1072005 | 同男 |
| 武器 | 1302000,1322005,1312004 | 同男 |

## 不是只有畫面

- `game/creation.ts` 載入／快取 WZ 選項與禁字，驗證十個 u32、骰點與性別白名單。
- 原生登入端也驗證：不能跳過 Check、替換已檢查名稱、用不合法骰點、重用已消耗的成功檢查。
- `ClientSession` 公開 Check／Create／Delete；Web bridge 串行登入操作，避免相同 opcode 回包互搶。
- 限角色選擇階段、三角色槽；刪除須 `confirmed:true`、角色屬於當前帳號。
  YesNo 捕捉確認當時的 id，不能換另一個角色被刪；No／取消不送刪除封包。
- **修正舊建角會複製首位角色進度**：全新 stats、level 1、job/exp 0，套入骰點與裝備。
  HP/MP 50、初始金錢／地圖仍是重建伺服器政策，不是官方伺服器數值的證據。
- 存檔可選 `gender:0|1`，舊檔不改版，缺省男 0，只在有值時保存。
- **修正 CP949 名稱欄位**：`char[13]` 是 12 個可見 bytes＋NUL，不是 ASCII-only；讀取不可用會清掉最高位的 `Buffer.toString('ascii')`。
  protocol／存檔保持 byte-string，UI／JSON 邊界才轉 Unicode。名字比對只折疊 ASCII 大小寫，韓文 bytes 不做 Latin-1 大小寫轉換。
- 韓文角色名稱通過進場、其他玩家、聊天、密語、找人的往返驗證，不只在建角預覽正確。

## 實際驗證

1. **TypeScript＋545/545 測試通過**：`cd server && npm run check`。
   - 原始封包檢查／建立／刪除、正確骰點、拒絕假 Check、首位角色不被複製。
   - 並行重複建立只成功一次、第四個角色拒絕，跨帳號／未確認／進場後刪角拒絕。
   - 男女白名單、韓文名稱／禁字、CP949 邊界、可選性別、保存後再讀取。
2. **真 Chromium** `server/scripts/browser_creation_probe.mjs 8595`：
   - **隔離** `maker`／`female`、`/tmp/kms111-creation-save.json`，不是使用者存檔。
   - 男女六組各選最後一項；預覽確實解碼繪製該外觀；畫面骰點與提交／收到的能力一致，總和 25。
   - 未 Check 不送 Create、改名失效、名稱錯誤可返回重試；取消刪除零封包、確認只送一次。
   - 男 `NativeOne`、女 `한글용사` 建立與刪除成功，`errors:[]`、`httpErrors:[]`。
   - 測後真 JSON 兩帳號角色數皆 0，女性 `gender:1` 保留。
3. 舊功能回歸：真 Chromium 世界／角色選擇與左右朝向通過（758 個 mob move packets，無 JS／素材錯誤）；
   繩索走到 x718、爬升、停止 500ms 不滑、跳離通過；BGM／SE 真解碼／播放通過；frame smoke 通過。
4. `server/scripts/client_probe.mjs`：SMOKE／SHOP／TITLE／SELECTION／**NATIVE CREATION/DELETION** 五組通過。

暫存紀錄：`/tmp/creation-full-545-release.log`、`/tmp/browser-creation-release2.log`、
`/tmp/browser-creation-selection-regression.log`、`/tmp/browser-creation-climb-release.log`、`/tmp/creation-frame-release.log`。
畫面在忽略追蹤的 `generated/validation/creation-{maker,female}-native.png`、`deletion-{maker,female}-native.png`。

## 未聲稱完成

- 全遊戲 1:1、技能／任務／所有原始視窗與完整怪物追敵／跳躍／飛行 AI，仍需各別實作驗證。
- 使用本地 OFL Noto CJK fallback，不是原 Windows Dotum；文字 metrics、下拉文字／鍵盤行為不能宣稱逐像素一致。
- 起始裝備仍沿用 `equipSlot` 的零能力／零 ruc，未套入完整 WZ info 初始裝備數值。
- 反作弊、GM 專用名稱規則、官方註冊服務、各種中斷重連路徑，未因此一併宣稱還原。

Data.wz SHA256：`286abe74f4335ebfde3164fa8f55e195e926a6cf5165646796b3c2fba3962d0f`（未修改）。
