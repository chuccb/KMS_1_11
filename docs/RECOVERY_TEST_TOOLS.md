# 自然恢復／恢復被動與方便操作的體驗工具（2026-10-17）

**本輪沒有執行 test／check／typecheck／browser／VM／probe。** 新增的是實作與回歸來源，不是 PASS 報告。
原版功能與方便體驗的開發工具分開；工具不算 1:1 原版 UI，也不代表轉職／自然發點規則已找到。

## 直接操作，不必困在初心者的空技能窗

1. 開 LIVE PREVIEW，沿用原帳號／角色登入；`preview / preview`，或 `demo / demo` 自行建立角色。
2. 畫面上方按 **「體驗工具（非原版）」**。面板直接查目前帳號授權；開面板、讀取狀態、填預設都不改數值。
3. 先按 **「無怪城鎮 · 엘리니아」**，沿用原 `/map 101000000` 封包及獨立地圖命令權限。
   工具不暫停世界／怪物；進城後再開工具即可。
4. 選 **「填入戰士體驗配置」** 或 **「填入法師體驗配置」**：只是填表；目前為 20 AP／40 SP，
   並勾選清除已學技能。這是明示的體驗配置，不是本版創角／轉職／自然升級發點。
5. 勾選同意修改目前角色及保存，再按 **「套用體驗配置」**。第一個變更前自動記住能力／技能；
   預設關閉工具並開原技能窗，可用真正 SP 按鈕學習，不是直接填滿技能等級。
6. 可補滿 HP／MP，或降至半血半魔（保留至少 1 HP），方便觀察被動／自然恢復；不需要等怪打到剛好血量。
7. 用 **「還原能力／技能」** 回到第一個變更前，或明確按「更新還原點」取代舊點。
   **還原點只存於本次服務記憶體、不跨重啟；已升級則拒絕還原舊能力。**

還原範圍：job／STR DEX INT LUK／AP SP／目前與上限 HP MP／已學技能。
**不回溯 EXP、等級、道具、金錢、地圖與位置**，也不把道具／金錢複製回來。
若已升級，應保留新成長或明確重新建立還原點，不套舊等級 maxima。
死亡時「補滿」會透過本圖重新進場回出生點；其他活人操作不重新載圖／移動位置。

> 原隔離存檔繼續使用 `generated/preview-growth-20261017.json`，不重新 seed。
> 開放工具前另外保留一份 `generated/preview-before-test-tools-20261017-*.json` 冷備份；
> 它不是自動回溯按鈕，也不覆寫正在使用的存檔。能力／技能還原點與完整冷備份不是同一件事。

### 實際可觀察的路徑

- 戰士 `1000000 HP 회복력 향상`：提高站立 HP 回復；初級真值 hp=3，不是成長被動的 x/y。
- 戰士先學到 `1000001` 的必要前置，再學 `1000002 인듀어`：靜止在繩／梯上也能回血；
  第 1 級間隔 **31 秒**，末級 **10 秒**，按 WZ time，不自行把它都設成 10 秒。
- 法師 `2000000 MP 회복력 향상`：提高 MP 回復，走動／跳躍也可累計；HP 仍需站立或已學繩梯被動。
- 前輪已接的 `1000001／2000001`：影響**之後**的自然／AP HP／MP 成長，不回補過去升級。
- `S` 配 AP、`K` 技能、`I` 背包、`E` 裝備、`M` 小地圖、地面 `↑` 進門、`Ctrl` 基本攻擊。
- 面板可按 ID／名稱找全部原地圖，不需手記指令；地圖授權仍與工具授權分開。
- **主動技能施放、技能快捷鍵拖放、其他被動／buff、原轉職與自然 AP/SP 數量仍未完成。**

## 1. 自然恢復的原始證據

本輪重讀倉庫 `MapleStory.exe.c`：

| 原位置 | 結論與接線 |
|---|---|
| `sub_4707E0` | `CField` 從 `info/recovery` 轉為 double，寫 field+144；缺省／轉換失敗為 **1.0**。MapData／HTTP map JSON 現在攜帶此值；0 保持 0，不用 truthy fallback 替換。 |
| `sub_558CF0 → sub_558950` | 本人的場地 update 跑恢復；HP／MP 計數各次 **+30**。不是每秒 server 無條件補血，也不是吃藥。 |
| `sub_558950` HP | 活人、HP 未滿、前後位置相同、內部 action 2／3（stand1／stand2）才累計至 10000ms。其他情況 HP 計時歸零。 |
| `sub_558950` MP | 活人且 MP 未滿便累計至 10000ms，不要求站立；MP 滿或死亡時計時歸零。HP 與 MP 各自計時、分開送 report。 |
| `1000000` lookup | `hp` 在 level struct+4，`10 + hp` 乘 field recovery 後向零截斷，再夾剩餘 HP。真 WZ 第 1 級 3／末級 50。 |
| `2000000` lookup | `mp` 在 level struct+8，`3 + mp` 乘同一 recovery、截斷並夾剩餘 MP。真 WZ 第 1 級 2／末級 32。 |
| `sub_4BE790` | action **36／37 是梯／繩動作，不是場地類型**。戰士查1000002、41x／42x查4100001／4200001，讀 level.time（+68）×1000 當 HP 間隔；無技能／time<=0 不在繩梯回血。 |
| `sub_55B870` | 發 c2s **0x1C**，固定 flags **0x1400**、s16 HP delta、s16 MP delta、u8 flag。HP／MP 分兩次呼叫時，另一個 delta 仍寫 0；繩梯 HP report flag=1，MP=0。 |
| `sub_55BEB0／0x0D` | 等伺服器實際回值才改角色 record／HP MP bar，不在瀏覽器先樂觀加血。 |

`CSkillInfo` 是全域查詢，所以恢復 metadata 包含原100／200書，不把「目前職業書看不到」誤當成保留技能不存在。
讀目前已學 map32，正數 learned level 夾到 WZ max；讀數值 hp／mp／time，絕不從 hs 中文／韓文說明算公式。
實際 `Skill/` 目錄為 100／110／120／130／200／300／400；本輪研究確認沒有410／420書，
故不生成它們的數值或捏造被動。程式保留原職業分支查詢，但無實際節點就沒有相應加成。

實作位置：`client/recovery.mjs` 的純模型／controller，main 內固定30ms累積；ClientSession.recover
→既有 `encodeClientStatReport`→game `applyVitalReport`→`0x0D` snapshot；map.ts／map JSON 帶 recovery。
不新增第二套 server 自動補血時計，避免 native report 與 server tick 雙補。

### 已知界線，不冒充全原版

- 瀏覽器位置／velocity／動作來自現有固定步進移動與武器 attack；尚非完整 CUserLocal／CVecCtrl／CShape2D。
- 每幀最多採250ms，背景切換／blur 重置，不補掉線或背景停留數小時的血；這是明示瀏覽器安全政策。
- metadata 尚未載入時暫不計時，失敗後5秒重試；不以假被動或後期技能數值填補資料。
- 最大 HP／MP 仍是目前已接的 maxima，完整裝備／buff TotalStat 尚未完成；原回血數字泡泡未接。
- 原 client report 金額依原模式由 client 算，server 仍用既有 clamp／死亡規則，不宣稱重建了原服反外掛驗算。
  瀏覽器 recovery route 拒絕負數／非整數／s16溢出，**不代表已有完整 server 權威恢復速率／姿勢驗證**。
- HP／MP 持久化沿用既有離場／其他 durable mutation 保存；每個恢復 tick 不另外重寫整份存檔。

## 2. 體驗工具的安全界線

- CLI 新增 **`--test-tools off|all|帳號清單`，預設 off**，與 `--map-command` 完全獨立。
- 面板在原 800×600 遊戲畫布之外，清楚標示「非原版」；不把開發表單畫成原技能／轉職 UI。
- 沒有自動轉職／給點／補血，也沒有憑空指定原版 GM opcode。工具走獨立 WS bridge→同程序開發 API，
  實際角色更新才使用既有原 `0x0D／0x0E／0x16`，成功保存。
- 帳號取自完成驗證的 login，不信任瀏覽器傳的 username／characterId；GameEntryServer 再核對已進場 session 的 owner。
- 修改必須 confirmed=true；角色只允許 PE 有效職業且有真 WZ book，AP/SP 只接受0–32767整數，未知 action 拒絕。
- 先做純 plan、預先 encode，成功才更動 record；無效請求不偷偷建立／覆寫還原點或部分扣改數值。
- 目前 native SP／AP／道具請求未回覆時拒絕；商店、對話、交易、延後射擊未結算時拒絕修改。
- 清除技能是明確選項，preset 只勾表單、尚未執行；原技能仍在還原點，直到使用者明確更新該點。
- 只供私人開發世界；`all` 不應用在正式／公開營運世界。能明示加點的帳號當然可以影響測試世界平衡。

### 沙箱啟動方式

在 `server/`：

```sh
node src/cli.ts serve --host 0.0.0.0 \
  --port 8496 --game-port 8497 --web-port 8495 \
  --data ../Data.wz --save ../generated/preview-growth-20261017.json \
  --account preview:preview,demo:demo \
  --map-command preview,demo --test-tools preview,demo --ping off
```

存檔優先，`--account` 不會重新 seed 已存在檔。頁面／WS 用相對 URL，三埠綁0.0.0.0；
LIVE入口是web8495，不是login8496／game8497。已有角色與其他最新進度保持原樣，直到使用者明確按工具套用。

## 3. 新增／更新的回歸來源（未執行）

- `test/testtools.test.ts`：plan 不突變、深拷貝還原點、數值／確認／job 拒絕、還原範圍、升級保護、save roundtrip。
- `test/webclient.test.ts`：default-off、獨立授權、假冒他人失敗、實際 TCP stat／skills 更新與還原、recovery report bridge。
- `test/map.test.ts`：map recovery 預設1、0不替換、小數保留；`test/skills.test.ts` 真 WZ hp／mp／time。
- `scripts/client_probe.mjs`／`test/client-ui.test.ts`：新 module shim、HP／MP獨立334 tick、移動打斷、繩梯time／flag、死亡／cap／倍率，以及開面板／填preset不突變、必須明確確認。

**全部只是新增測試來源，這輪沒有執行。啟服成功也不是上述功能已通過。**

## 後續擴充：加速藥水（2026-10-17，未測試）

工具新增明確領取2002001×3的按鈕，仍須授權、owner與勾選確認；會保存背包，**能力還原點不回收道具**。
不自動發、不重seed、不扣錢。I→消耗欄連點使用原藥水；速度+8／180秒、同欄刷新不疊加。
工具內有唯讀速度／跳躍百分比與剩餘秒數，一般遊戲畫面只畫原raw圖示。
這是獨立於能力／技能plan的固定道具體驗發放；來源、到期及斷線政策見 [TEMPORARY_STATS](TEMPORARY_STATS.md)。
