# KMS 1.11 重建工作區

以倉庫內的 2003 年 KMS 1.11 原版 EXE／DLL、反編譯 C、IDA listing 與 `Data.wz` 為證據，
重建 **瀏覽器客戶端＋TypeScript 伺服器＋原協定與資源工具**。
瀏覽器客戶端是唯一實作主線，不再規劃另一套引擎移植。

**尚非完整 MMO 成品，不宣稱全遊戲 1:1、正式營運安全或全部回歸已通過。**

## 從這裡開始

| 需求 | 文件 |
|---|---|
| 找功能與歷史紀錄 | [文件索引](docs/README.md) |
| 理解實際目錄、資料流與技術債 | [現行架構](docs/ARCHITECTURE.md) |
| 看與原版仍有哪些差異／遺漏 | [現況總盤點](docs/ORIGINAL_PARITY_AUDIT.md)（含部分完成／未接／未知與程式入口） |
| 看下一步與已知缺口 | [路線圖](docs/ROADMAP.md) |
| 查還原方法與證據規則 | [還原原則](docs/REBUILD_PRINCIPLES.md) |
| 安裝工具、啟用版本與升級界線 | [工具鏈](docs/TOOLCHAIN.md) |
| 查啟動參數與協定工具 | [server 說明](server/README.md) |
| 掉落權威落點／圖示貼地／原WZ全圖驗證 | [掉落與fh](docs/DROP_FOOTHOLD_LANDING.md) |
| 真實畫布／有界鍵盤探針、安全入口與驗證界線 | [frame／play整理](docs/STRICT_FRAME_PLAY_TOOLS.md) |
| 手動瀏覽器工具／NPC與怪物素材整理 | [嚴格TS工具與素材](docs/STRICT_BROWSER_TOOL_MIGRATION.md) |
| 多種清晰尺寸、拉近／拉遠、淡出／淡入與分層UI | [清晰鏡頭](docs/PIXEL_CAMERA.md) |
| 可選物理步長、插值與十種自訂鏡頭 | [手感實驗](docs/MOTION_EXPERIMENTS.md)／[原版呈現原證](docs/PLAYER_PRESENTATION_CAMERA.md) |
| 顯示／影像快取與安全診斷工具、遷移進度 | [整理與限制](docs/BROWSER_TOOL_CLEANUP.md)／[嚴格TS遷移](docs/BUN_MIGRATION.md) |
| 查操作與功能細節 | [瀏覽器客戶端](docs/CLIENT.md) |

## 現行技術

- **客戶端**：原生 ES Modules、Canvas 2D、DOM 透明命中／輸入層、Web Audio；800×600 UI、可選世界FOV，開發直接送ESM，另有Bun browser build。
- **伺服器**：Bun／TypeScript／ESNext，執行時無第三方套件依賴。
- **通訊**：瀏覽器同 origin HTTP／WebSocket → Bun ClientSession → 原版 TCP 協定與遊戲服務。
- **資源**：產品 WZ reader 在 `server/src/wz/`，執行時讀原 archive 並供應 metadata／PNG／音訊；不是必須預先匯出所有素材。
- **持久化**：JSON save＋暫存檔改名；保留玩家裝備實例，不能用 WZ 模板回填或重 seed 舊進度。

2026-10-19 重新核對 latest 並鎖定：**Bun 1.4.3、TypeScript 7.0.2、@types/bun 1.4.3、Prettier 3.9.10**。
根目錄 `package.json`／`bun.lock`／`.bun-version` 是唯一工具鏈入口。
**全專案遷移仍未完成**：嚴格檢查已涵蓋所有 `.ts`，但主瀏覽器入口及剩餘1支 `server/scripts/client_probe.mjs` 尚未完成型別化；
不可把目前 typecheck 成功當成全客戶端已嚴格檢查。範圍及驗證狀態見 [TOOLCHAIN](docs/TOOLCHAIN.md)。

## 目錄

```text
client/                 瀏覽器畫面、輸入、音訊與逐步遷移的純規則 .ts；89支TS，main.js 尚待實作型別遷移
server/src/protocol/    原封包 codec、cipher、CP949、schema.ts 封包索引
server/src/client/      Bun 端 ClientSession 與事件模型
server/src/net/         TCP 服務、HTTP／WebSocket 橋與 capture
server/src/game/        世界、物品、規則、資源呈現資料與保存
server/src/wz/          產品 WZ 解碼與 PNG 輸出
server/test/            回歸來源；有來源不等於已執行通過
server/scripts/         歷史 probe 與輔助腳本，不自動執行
tools/                 靜態分析、Bun 工具鏈安裝／靜態分析、明示新隔離體驗建立腳本
analysis/               已保存的 manifest、RTTI 與靜態分析結果
docs/                   現行規劃、原版證據、ADR 與歷史驗證
generated/             本機工具安裝、存檔、冷備份；忽略，不進 Git
```

根目錄的原 EXE／DLL／`.c`／`.lst`／`Data.wz` 是證據，不是應刪除的舊引擎執行時；
保留路徑以免破壞工具與位址引用。生成素材、node_modules 與玩家資料不納入 Git。

## 本機啟動

先按 [工具鏈文件](docs/TOOLCHAIN.md) 安裝固定 Bun，從根目錄安裝鎖定開發依賴：

```sh
bun tools/setup.ts
```

下例從 repository 根目錄啟動，**只供建立新的本機體驗檔，不是恢復舊進度的命令**：

```sh
bun server/src/cli.ts serve \
  --host 0.0.0.0 --port 8496 --game-port 8497 --web-port 8495 \
  --data Data.wz --save generated/local-save.json \
  --account demo:demo --ping off
```

本機瀏覽器開 `http://127.0.0.1:8495`。遠端預覽使用 **web port** 的公開網址，
瀏覽器不能呼叫沙箱的 localhost；素材與 `/ws` 均走同 origin。
`--account` 只供新帳號種子，已有 save 時不能用它假設密碼／進度已重設。

已有進度時，先確認真正存檔存在、停服冷備，再把 `--save` 指向同一檔案。
**找不到存檔就停止恢復流程，不用新 fixture 假裝舊角色。** `/tmp`、ignored 目錄或沙箱程序不能當成永久備份；
重要 save 請另行匯出保存，不能期待 Git push 會帶走它。
恢復原檔可使用 `bun tools/serve-existing-save.ts <真實save路徑>`；檔案不存在／空白會拒絕啟動。
這個保護入口不自行停服或冷備，必須先由操作者確認。

## 可選手感與鏡頭

遊戲上方「手感實驗 · 非原版」可切換本機角色 **5／8／10／15／20／30／45／60ms**物理步長與「平滑插值／即時位置」。
預設仍30ms，可一鍵還原；新鏡頭含疾速領航、彈簧追蹤、電影滑軌、平台跑酷、柔性區域、方向側肩，共十種。
可先比較10ms＋插值＋疾速領航；低步長增加CPU工作並改變數值軌跡，不保證一定更順。
偏好僅存瀏覽器，不調整人物能力或server時鐘。上方重複背包按鈕已移除，原ITEM／I保留。
詳見 [手感實驗與驗證界線](docs/MOTION_EXPERIMENTS.md)。

## 普通角色動作（單元回歸已執行；完整瀏覽器驗收未完成）

原武器`info.walk`／`info.stand`分開選姿勢；普通動作改讀真WZ序列與原30ms倒數，
補選角／創角同時鐘、繩梯整數Y停格與恢復、反向／換裝／場地生命週期及metadata／預熱。
體驗工具新增**唯讀原角色動作閱覽**，可直接看單手劍／雙手劍／雙手斧與繩梯，不給物品、不改角色。
詳[NATIVE_AVATAR_MOTION](docs/NATIVE_AVATAR_MOTION.md)／ADR-068；不是完整移動物理或全部原版動畫已完成。

## 隔離體驗與進度安全

2026-10-19 當前沙箱沒有先前的玩家 save；過往文件的檔名／冷備路徑不代表檔案仍存在。
**不聲稱恢復舊角色，不自行重建相同名字的角色，不覆寫玩家資料。**
有真實 save 時用 `bun tools/serve-existing-save.ts <真實路徑>`；必須先停服並冷備。

可明示開啟不寫存檔的全新記憶體世界：

```sh
bun server/src/cli.ts serve --host 0.0.0.0 --port 8516 --game-port 8517 --web-port 8515 \
  --map 101000000 --data Data.wz --save off \
  --account preview:preview,observer:observer --map-command preview,observer --test-tools preview,observer --ping off
```

- 瀏覽器使用 **web port 8515** 的 LIVE 入口，8516/8517 是原生 TCP，不能當網頁開啟。
- `preview / preview`、`observer / observer` 是這個隔離世界啟動時建立的帳號；角色由使用者自行建立，不代表現在仍沒有角色，也不是還原舊帳號。
- `--save off` **重啟會失去全部新進度**，不寫任何現有玩家存檔；重要進度請改在自行指定的新 save 上玩並另行匯出備份。
- 101000000 城鎮是明示開發體驗安排，不是原版建角起點；不自動轉職／加技能／給錢。
- 網頁更新後請重新整理；這不是重啟 server。若初始化中斷，會顯示錯誤／重新整理面板，登入按鈕與 Enter 都不會啟動半完成的用戶端。
- 程序是否在線以本次實際 LIVE 程序為準，這裡不保證沙箱跨重啟存活。
- 型別／格式／建置與回歸狀態見 [Bun 遷移記錄](docs/BUN_MIGRATION.md)；提供入口不是宣稱全案驗收通過。

原碼／listing／WZ、臉飾與 attr2 原證保留在 [NATIVE_FACE_ANIMATION](docs/NATIVE_FACE_ANIMATION.md)。
`create-isolated-preview.ts` 仍是**明示寫入新檔**的人工工具，不能拿來假恢復舊進度；只在明示開全新隔離進度時使用，不屬於功能驗證或恢復程序。

## 操作與體驗工具

| 操作 | 功能 |
|---|---|
| ←／→、A／D | 移動 |
| Alt／空白 | 跳躍 |
| ↑／↓ | 繩梯；地面靠門 ↑ 使用，type3 自動門靠近觸發 |
| F1–F7／上方表情按鈕 | hit／smile／troubled／cry／angry／bewildered／stunned，長按不重送 |
| Ctrl | 普通近戰／蹲刺／基本射擊 |
| K技能列雙擊／圖示拖到七鍵 | 目前12個主動技能白名單；原七快捷鍵與藥水共用格，見[遠距](docs/NATIVE_RANGED_SKILLS.md)／[魔法](docs/NATIVE_MAGIC_SKILLS.md) |
| I／E／S／K／M | 背包／裝備／能力／技能／小地圖 |
| 背包雙擊／拖放 | 支援的消耗品、穿脫、換位；拖到真正場景可能丟棄 |
| 背包金幣鈕／商店충전 | 楓幣丟棄／飛鏢補充，確認後由服務端落帳 |
| Enter／Escape | 聊天或目前 modal 的確認／取消／關閉 |

上方「體驗工具（非原版）」／`/tools` 包含明示的唯讀 UI 範例：
原怪物動作／攻擊鏈（預填9999997，不生怪）、原 NPC 圖文、提示框普通道具／持有裝備快照／模板、技能 0／1／MAX，不需要先轉職或給 SP。
涉及配置職業／AP／SP、領藥／遠距裝備／明確補足所選最低等級或地圖命令的操作，仍須明確帳號授權與確認；不是原版任務。
工具不暫停世界。參見 [操作與保護](docs/RECOVERY_TEST_TOOLS.md)。

## 最近功能與限制

- 本輪：[原角色右鍵／人氣／派對邀請整鏈](docs/NATIVE_PLAYER_INTERACTIONS.md)／ADR-089：更正真選單入口、四片原WZ／角色UnionRect／密語、人氣送出冷卻與CP949回覆、隊長邀請及綁定確認對象；停用未完成交易房，不捏造server規則；補server接受inviterId核對，未證實的舊附接端暫停invite／accept。附接新web可保留既有記憶體世界，不重啟玩家進度。

- 前輪：[原版提示窗與六列螢幕訊息](docs/NATIVE_FEEDBACK.md)／ADR-088：補真正0x13/type1 OK modal、loot／金幣／拒絕／同級EXP、原6000ms整數fade、名字cache失敗重試與自己taken音效；含CP949／加密合包／原WZ Chromium與生命週期回歸，沒有改獎勵／角色／存檔。

- 前輪續作：[有向整數地形與物理場界](docs/NATIVE_TERRAIN.md)／ADR-078：floor／wall／ceiling共用crossing、endpoint pair、group、ground反向連結、兩pass餘時、真接觸時間到remote，map／player／mob與特別KB連動；尚非完整R-tree／全域相位，未執行測試。
- 前輪：[普通移動力學與有序wire](docs/NATIVE_LOCOMOTION.md)／ADR-077：原地空力／切線速度、抓繩／繩梯／死亡停止、30ms本地controller、journal／bridge／末端權威，未執行測試。
- 前輪：[怪物主動攻擊完整鏈](docs/NATIVE_MOB_ATTACKS.md)／ADR-076：原選招／楔形範圍、MP／Value、拋物線與hit圖、攻擊中KB、冷載入／離場與晚進場body相位、唯讀怪物閱覽；此EXE主動hit不扣HP，身體碰撞另走傷害，未執行測試。
- 前輪：[怪物KB／NPC氣泡名牌與方向狀態](docs/NATIVE_MOB_KB_NPC_STATE.md)／ADR-075：KB真正替換巡邏、門檻與多段互斥、原受傷動作／時鐘／KEEP、NPC強制表情翻面與冷氣泡名牌、唯讀入口；未執行測試。
- 前輪：[原版攻擊特效整鏈](docs/NATIVE_ATTACK_EFFECTS.md)／ADR-074：更正殘影 child5／獨立時鐘、真 mastery tier、普通命中火花、命中點與世界層排序、release 聲音及本機／旁觀／預覽生命週期；未執行測試。
- 前輪：[兩招原版魔法與完整消費／生命週期](docs/NATIVE_MAGIC_SKILLS.md)／ADR-073。修正120ms多段時鐘與EVA/PDD入口漏接、新增MAD藥水；已列十二招，不宣稱全技能，未執行測試。
- 前輪補原穿戴順序、server正反換裝驗需求與原子提交、主動攻擊原時鐘關聯／遠端冷載入身份守衛；[證據與政策](docs/NATIVE_EQUIP_ADMISSION.md)／ADR-072。遠距工具可分族、明確補最低級；已有武器可只補級，不改原需求。

- 本輪射擊技能與彈藥交易、原攻速欄識別／換武器失效、ACK時鐘更正已實作；沒有猜Booster施放幅度或Magic Guard的server規則。

- 遠距技能階段（當時十招；後接兩魔法共12招）：原七技＋Arrow Blow／Double Shot／Lucky Seven、多彈藥／獨立公式／真彈體／攻速消費鏈：[本輪證據](docs/NATIVE_RANGED_SKILLS.md)／ADR-071、[第一批](docs/ACTIVE_SKILLS.md)，**未測試**。

- 原道具／裝備／技能 tooltip：normal icon 2×、需求圖字、真正 instance stats、當前／下一級 hs。
  [交付與原版證據](docs/NATIVE_RICH_TOOLTIPS.md)／ADR-064，**未測試**。
- NPC 圖文／選項與同步行為：[圖文](docs/NATIVE_DIALOGUE_RICHTEXT.md)、[controller 與未解矛盾](docs/NATIVE_NPC_BEHAVIOR.md)，**未測試**。
- 地圖、角色／怪物、移動、音訊、背包、商店、數值與死亡等逐輪紀錄，由[文件索引](docs/README.md)查閱，不在此重複堆疊歷史「最新」。

近期普通移動續作：地面力／坡滑、空中超終速、落地速度投影、抓繩與死亡停止，
並將30ms控制器路徑經bridge／原codec完整傳送；見[原證與未完成幾何界線](docs/NATIVE_LOCOMOTION.md)。

完整 CShape2D／CVecCtrl、原 GDI 字型、全部主動技能／buff、自然 AP／SP／轉職、卷軸、cash／pet、
原 quest／taxi／trunk scripts、完整交易／組隊瀏覽器介面與正式營運防護仍有缺口。
原 server 缺失的規則明示為重建政策；不以後期版本或「缺素材」猜測代替原證據。

本輪依授權執行 strict型別／格式／單元與完整回歸／建置、隔離component與唯讀title驗證；不自動登入／操作玩家角色或修改玩家save。
最新結果與未完成項目見 [角色互動續作](docs/NATIVE_PLAYER_INTERACTIONS.md)；前輪工具整理見[frame／play](docs/STRICT_FRAME_PLAY_TOOLS.md)。
套件安裝、版本顯示、工具編譯、靜態閱讀與啟服都不算功能 PASS。舊測試數字只對應當時提交。
