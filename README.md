# KMS 1.11 重建工作區

以倉庫內的 2003 年 KMS 1.11 原版 EXE／DLL、反編譯 C、IDA listing 與 `Data.wz` 為證據，
重建 **瀏覽器客戶端＋TypeScript 伺服器＋原協定與資源工具**。
瀏覽器客戶端是唯一實作主線，不再規劃另一套引擎移植。

**尚非完整 MMO 成品，不宣稱全遊戲 1:1、正式營運安全或最新改動已驗證通過。**

## 從這裡開始

| 需求 | 文件 |
|---|---|
| 找功能與歷史紀錄 | [文件索引](docs/README.md) |
| 理解實際目錄、資料流與技術債 | [現行架構](docs/ARCHITECTURE.md) |
| 看下一步與已知缺口 | [路線圖](docs/ROADMAP.md) |
| 查還原方法與證據規則 | [還原原則](docs/REBUILD_PRINCIPLES.md) |
| 安裝工具、啟用版本與升級界線 | [工具鏈](docs/TOOLCHAIN.md) |
| 查啟動參數與協定工具 | [server 說明](server/README.md) |
| 查操作與功能細節 | [瀏覽器客戶端](docs/CLIENT.md) |

## 現行技術

- **客戶端**：原生 ES Modules、Canvas 2D、DOM 透明命中／輸入層、Web Audio；800×600 邏輯畫面，無前端建置步驟。
- **伺服器**：Node.js／TypeScript，原生 type stripping，執行時零 npm 套件依賴。
- **通訊**：瀏覽器同 origin HTTP／WebSocket → Node ClientSession → 原版 TCP 協定與遊戲服務。
- **資源**：產品 WZ reader 在 `server/src/wz/`，執行時讀原 archive 並供應 metadata／PNG／音訊；不是必須預先匯出所有素材。
- **持久化**：JSON save＋暫存檔改名；保留玩家裝備實例，不能用 WZ 模板回填或重 seed 舊進度。

2026-10-18 工具鏈鎖定：**Node 26.12.0、npm 12.2.0、TypeScript 7.0.2、@types/node 26.6.5、Python 3.15.0**。
這是此次查得的正式版，不使用 nightly／RC；不代表每個選擇都必須追逐最前沿。
Node 26 此時仍在 LTS 前，選用原因、相容範圍與未執行驗證見 [TOOLCHAIN](docs/TOOLCHAIN.md)。

## 目錄

```text
client/                 瀏覽器畫面、輸入、音訊與目前共用的純規則 .mjs
server/src/protocol/    原封包 codec、cipher、CP949、schema.ts 封包索引
server/src/client/      Node 端 ClientSession 與事件模型
server/src/net/         TCP 服務、HTTP／WebSocket 橋與 capture
server/src/game/        世界、物品、規則、資源呈現資料與保存
server/src/wz/          產品 WZ 解碼與 PNG 輸出
server/test/            回歸來源；有來源不等於已執行通過
server/scripts/         歷史 probe 與輔助腳本，不自動執行
tools/                 靜態分析、工具鏈 bootstrap／環境、明示新隔離體驗建立腳本
analysis/               已保存的 manifest、RTTI 與靜態分析結果
docs/                   現行規劃、原版證據、ADR 與歷史驗證
generated/             本機工具安裝、存檔、冷備份；忽略，不進 Git
```

根目錄的原 EXE／DLL／`.c`／`.lst`／`Data.wz` 是證據，不是應刪除的舊引擎執行時；
保留路徑以免破壞工具與位址引用。生成素材、node_modules 與玩家資料不納入 Git。

## 本機啟動

先按 [工具鏈文件](docs/TOOLCHAIN.md) 啟用版本。沙箱安裝完成後，每個新 shell 使用：

```sh
source tools/env.sh
```

下例從 repository 根目錄啟動，**只供建立新的本機體驗檔，不是恢復舊進度的命令**：

```sh
node server/src/cli.ts serve \
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
恢復原檔可使用 `bash tools/serve-existing-save.sh <真實save路徑>`；檔案不存在／空白會拒絕啟動。
這個保護入口不自行停服或冷備，必須先由操作者確認。

## 此輪補齊：普通角色動作（未測試）

原武器`info.walk`／`info.stand`分開選姿勢；普通動作改讀真WZ序列與原30ms倒數，
補選角／創角同時鐘、繩梯整數Y停格與恢復、反向／換裝／場地生命週期及metadata／預熱。
體驗工具新增**唯讀原角色動作閱覽**，可直接看單手劍／雙手劍／雙手斧與繩梯，不給物品、不改角色。
詳[NATIVE_AVATAR_MOTION](docs/NATIVE_AVATAR_MOTION.md)／ADR-068；不是完整移動物理或全部原版動畫已完成。

## 現行隔離 LIVE（2026-10-18）

使用者已同意無舊save也繼續；此輪建立 **全新** `generated/preview-faces-20261018.json`，不是恢復舊角色。
先用exclusive-create的 `node tools/create-isolated-preview.ts generated/<新的檔名>.json` 走WZ／原建角模板，
再停服冷備／啟服；重跑seed遇既有檔案會拒絕，不重設已玩進度。

- LIVE web **8515**，native login8516／game8517，全部綁0.0.0.0。
- `preview / preview` → Preview；`observer / observer` → Observer。建立時為新初心者，後續自行遊玩的進度沿同檔保存，不重新seed。
- 初始101000000無怪城鎮是明示體驗安排，不是原版建角起點；沒有自動轉職／給技能／金錢。
- 可兩個分頁觀察同圖；F1–F7或表情按鈕看一般表情／自行眨眼，選角與創角預覽也接獨立時鐘。
- 「體驗工具（非原版）」可找地圖／前往獵場、唯讀UI；修改配置／領物仍需自行確認。
- 僅確認啟服日誌與監聽狀態，沒有登入、測試、typecheck、browser、VM或probe，不代表驗收PASS。

前輪原碼／listing／WZ證據、臉飾、旁觀者attr2、HTTP／cache與界線見 [NATIVE_FACE_ANIMATION](docs/NATIVE_FACE_ANIMATION.md)。
新save與冷備均ignored；**Git push不含進度，仍須另行保存重要save**。

重啟既有新體驗檔（先停服、冷備；不要再seed）：

```sh
source tools/env.sh
node server/src/cli.ts serve --host 0.0.0.0 --port 8516 --game-port 8517 --web-port 8515 \
  --map 101000000 --data Data.wz --save generated/preview-faces-20261018.json \
  --account preview:preview,observer:observer --map-command preview,observer --test-tools preview,observer --ping off
```

## 操作與體驗工具

| 操作 | 功能 |
|---|---|
| ←／→、A／D | 移動 |
| Alt／空白 | 跳躍 |
| ↑／↓ | 繩梯；地面靠門 ↑ 使用，type3 自動門靠近觸發 |
| F1–F7／上方表情按鈕 | hit／smile／troubled／cry／angry／bewildered／stunned，長按不重送 |
| Ctrl | 普通近戰／蹲刺／基本射擊 |
| K技能列雙擊／圖示拖到七鍵 | 本批十個主動技能；原七快捷鍵與藥水共用格，見[技能範圍](docs/NATIVE_RANGED_SKILLS.md) |
| I／E／S／K／M | 背包／裝備／能力／技能／小地圖 |
| 背包雙擊／拖放 | 支援的消耗品、穿脫、換位；拖到真正場景可能丟棄 |
| 背包金幣鈕／商店충전 | 楓幣丟棄／飛鏢補充，確認後由服務端落帳 |
| Enter／Escape | 聊天或目前 modal 的確認／取消／關閉 |

上方「體驗工具（非原版）」／`/tools` 包含明示的唯讀 UI 範例：
原怪物動作／攻擊鏈（預填9999997，不生怪）、原 NPC 圖文、提示框普通道具／持有裝備快照／模板、技能 0／1／MAX，不需要先轉職或給 SP。
涉及配置職業／AP／SP、領藥／遠距裝備／明確補足所選最低等級或地圖命令的操作，仍須明確帳號授權與確認；不是原版任務。
工具不暫停世界。參見 [操作與保護](docs/RECOVERY_TEST_TOOLS.md)。

## 最近功能與限制

- 最新續作：[怪物主動攻擊完整鏈](docs/NATIVE_MOB_ATTACKS.md)／ADR-076：原選招／楔形範圍、MP／Value、拋物線與hit圖、攻擊中KB、冷載入／離場與晚進場body相位、唯讀怪物閱覽；此EXE主動hit不扣HP，身體碰撞另走傷害，未執行測試。
- 前輪：[怪物KB／NPC氣泡名牌與方向狀態](docs/NATIVE_MOB_KB_NPC_STATE.md)／ADR-075：KB真正替換巡邏、門檻與多段互斥、原受傷動作／時鐘／KEEP、NPC強制表情翻面與冷氣泡名牌、唯讀入口；未執行測試。
- 前輪：[原版攻擊特效整鏈](docs/NATIVE_ATTACK_EFFECTS.md)／ADR-074：更正殘影 child5／獨立時鐘、真 mastery tier、普通命中火花、命中點與世界層排序、release 聲音及本機／旁觀／預覽生命週期；未執行測試。
- 前輪：[兩招原版魔法與完整消費／生命週期](docs/NATIVE_MAGIC_SKILLS.md)／ADR-073。修正120ms多段時鐘與EVA/PDD入口漏接、新增MAD藥水；已列十二招，不宣稱全技能，未執行測試。
- 前輪補原穿戴順序、server正反換裝驗需求與原子提交、主動攻擊原時鐘關聯／遠端冷載入身份守衛；[證據與政策](docs/NATIVE_EQUIP_ADMISSION.md)／ADR-072。遠距工具可分族、明確補最低級；已有武器可只補級，不改原需求。

- 本輪射擊技能與彈藥交易、原攻速欄識別／換武器失效、ACK時鐘更正已實作；沒有猜Booster施放幅度或Magic Guard的server規則。

- 十個主動技能：原七技＋Arrow Blow／Double Shot／Lucky Seven、多彈藥／獨立公式／真彈體／攻速消費鏈：[本輪證據](docs/NATIVE_RANGED_SKILLS.md)／ADR-071、[第一批](docs/ACTIVE_SKILLS.md)，**未測試**。

- 原道具／裝備／技能 tooltip：normal icon 2×、需求圖字、真正 instance stats、當前／下一級 hs。
  [交付與原版證據](docs/NATIVE_RICH_TOOLTIPS.md)／ADR-064，**未測試**。
- NPC 圖文／選項與同步行為：[圖文](docs/NATIVE_DIALOGUE_RICHTEXT.md)、[controller 與未解矛盾](docs/NATIVE_NPC_BEHAVIOR.md)，**未測試**。
- 地圖、角色／怪物、移動、音訊、背包、商店、數值與死亡等逐輪紀錄，由[文件索引](docs/README.md)查閱，不在此重複堆疊歷史「最新」。

完整 CShape2D／CVecCtrl、原 GDI 字型、全部主動技能／buff、自然 AP／SP／轉職、卷軸、cash／pet、
原 quest／taxi／trunk scripts、完整交易／組隊瀏覽器介面與正式營運防護仍有缺口。
原 server 缺失的規則明示為重建政策；不以後期版本或「缺素材」猜測代替原證據。

本輪不執行 test／check／typecheck／語法檢查／browser／VM／遊戲 HTTP 或登入 probe。
套件安裝、版本顯示、工具編譯、靜態閱讀與啟服都不算功能 PASS。舊測試數字只對應當時提交。
