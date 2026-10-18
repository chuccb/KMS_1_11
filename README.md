# KMS 1.11 重建工作區

最新還原（2026-10-18，未測試）：原 NPC frame 缺省180ms、CUtilDlgEx2 原素材／尺寸與色框、
Prev／Next／OK、ESC正確回覆、五種對話body與CP949輸入／選項驗證、modal隔離及唯讀範例入口。
[原檔交叉證據、操作入口與未完成界線](docs/NATIVE_NPC_DIALOGUE.md)／ADR-061；原NPC任務腳本及待機自言自語同步仍未恢復，啟服不是PASS。

以本倉庫的2003年KMS 1.11反編譯程式、PE與原始 `Data.wz` 為依據，實作TypeScript協定／伺服器、
瀏覽器客戶端與WZ工具。**不是完整MMO成品，也不宣稱全遊戲已1:1還原。**

## 最新交付

- **本輪（2026-10-18，未測試）**：以反編譯／listing／WZ交叉補原CUtilDlgEx2對話框，修Prev=0／ESC=FF、長文scroll、五種body與實際sub-op回覆。
  補CP949 bytes／number／menu驗證、modal焦點與IME／失焦保護，修NPC缺省frame180ms。
  工具列「體驗工具」新增五種唯讀UI範例，明示非任務、不發0x15、不改角色；原quest腳本和NPC idle同步仍缺。
  [完整來源、入口及界線](docs/NATIVE_NPC_DIALOGUE.md)／ADR-061；未執行test/check/typecheck/browser/VM/probe，同save冷備份後重開LIVE。

- **前輪（2026-10-18，未測試）**：依原 EXE／listing／Gr2D／WZ 補單張 arrow 游標，覆蓋登入／選角／遊戲及原生 DOM 控件，隨既有顯示縮放。
  NPC 改讀原 dc 框與 name，補黃色名牌與 linked 動作圖；提示框改原 A0000040／切角／邊界，item／skill 完整排版仍未完成。
  補 Canvas 按鈕 hover 音效／CLOSE states、logical-button 配對，修重複 mouseup 與拖窗誤點；失焦／取消／隱藏分頁取消拖曳。
  [完整交叉來源與界線](docs/NATIVE_CURSOR_NPC_POINTER.md)／ADR-060；保留同 save，冷備份再開 LIVE，不 seed 或修角色。

- **前輪（2026-10-18，未測試）**：原GameOpt小地圖／密語即時設定、OK／Cancel；公開聊天原0x1F＋normal/dead五秒氣泡。
  接密語拒收與shared三秒gate、64換行record／五秒追尾，找人首回補地名、原色與13/type0公告。
  [原檔交叉證據與完整界線](docs/NATIVE_GAME_OPTIONS_CHAT.md)／ADR-059；沿用save，冷備份後重啟LIVE，非force推送。

- **前輪（2026-10-18，未測試）**：接原 Menu／SysOpt 圖片與原座標、Escape關窗優先序、兩組20段音量／獨立靜音。
  修原音量15段實際80%（不是100%）；即時預覽、OK本機保存、Cancel／Escape還原，音樂不重起。
  補消耗品快捷格彼此拖移／覆蓋、拖到場景只清綁定、hover與stale guards；不發送丟棄道具請求。
  接原悄悄話收件人輸入／記憶／切回everyone、CP949 byte驗證與左側名字格，不再只塞`/w `捷徑。
  Menu可離線回標題；補modal隔離／冷攻擊ticket與IME Enter。未完成選單項目明確disabled，不冒稱技能施放或完整UI完成。
  [原檔交叉來源、操作與界線](docs/NATIVE_SYSTEM_UI.md)／ADR-058。
  沿用save冷備份重啟、非force推送；**未跑test/check/typecheck/browser/VM/probe**。


- **前輪（2026-10-18，未測試）**：追到 Gr2D 原 vtable／parent-chain comparator，改正同z按腳底y排序；
  補本機角色深度+2、空中保留接觸層、背景index z、飛行道具來源z與傷害固定層。
  補 zmap明示數值／smap／islot／vslot的一般裝備遮擋；去除正面動作多貼後腦頭髮。
  角色兩面PNG與原殘影中間層接通；墓碑改正為avatar child−1（不是world z−1），名字回腳下黑底原式。
  遠端基本攻擊補資源ready／事件時鐘與過期guard；加103000000圖層入口，沿用存檔、不seed／自動改角色。
  [完整原檔證據、實作／未完成界線與操作](docs/NATIVE_LAYER_PRIORITY.md)／ADR-057。
  **未執行test/check/typecheck/browser/VM/probe**；不宣稱完整Gr2D／CVecCtrl／CAvatar／全遊戲1:1。

- **前輪（2026-10-18，未測試）**：原48D080動作子樹能力分類、53DAA0無目標跳躍、重力／swept落地路徑，
  連接0x33／browser jump動畫／中途進場／戰鬥位置／死亡重生；補info.link動作來源與靜止類分流。
  修攻擊arm身份與hand錨點、冷圖跳站姿、未知／無武器假480ms攻擊，以及待機0→1→2→1。
  508FC0另定位movement/body action混表，修jump6／ladder14／rope16的本機、遠端與繩梯深度接線。
  依46BDA0＋Shape2D修type4雲層時間位移（非後期4～7通則）、重複origin；體驗工具可直接前往104040000。
  [原始證據、完整界線與操作](docs/NATIVE_JUMP_ATTACK_BACKGROUNDS.md)／ADR-056。
  沿用現有save，冷備份後重啟；**未跑test/check/typecheck/browser/VM/probe**，不聲稱完整aggro／飛行／CVecCtrl或全遊戲1:1。

- **前輪（2026-10-18，未測試）**：用原版截圖與 C／PE／WZ 交叉核對，修 EXP條151px／整除／百分比、人物欄黑字，
  確認本輪來源字體 **Gulim**；接右上動態街名／地圖名／原徽章、數值hover，原尺寸聊天記錄與可操作原圖捲軸。
  補七格200/201/202消耗品拖入、數量合計、原icon／ItemNo點陣字、按鍵使用與本機分角色設定。
  沿用現有save，不seed／不自動修裝備；**未跑test/check/typecheck/browser/VM/probe**。
  [來源、操作與未完成界線](docs/NATIVE_HUD_CHAT_QUICKSLOTS.md)；當時缺的消耗品互拖／拖出、Menu與收件人窗已在ADR-058補接（未測），技能施放／技能快捷格／BtChat仍缺。

- **前輪（2026-10-18，未測試）**：修正「Detail29、打怪全是1」的根因：起始劍實例PAD被建為0，原WZ應為17／可升級7次。
  新建角、無既有實例的掉落與商店裝備共用15項能力／tuc工廠；既有卷過／骰過實例不被模板覆蓋。
  補Character裝備價格、單件購買、tooltip模板／實例區分；新增明確確認的**舊全零起始裝備修復**及唯讀傷害分解。
  原Detail仍不是傷害上下限，未硬調最低傷害。沿用已有獨立save／角色，停服冷備份後重開，不自動修復／重seed。
  [原始證據、原因、操作與界線](docs/NATIVE_EQUIPMENT_DAMAGE_FIX.md)。未跑test/check/typecheck/browser/VM/probe。

- **前輪（2026-10-18，未測試）**：補原 Tomb 落下／落地／持末格、死亡 avatar 2000ms 繞行與 2500ms 淡出、
  遠端／已死進場生命週期、立即 spatial Tombstone 音效；補原 canvas `a0/a1` 插值及繼承、portal 缺省120ms、field動畫clock。
  修正 **`bodyAttack` 未進HTTP而使網頁排除全部接觸怪物** 的前輪漏接；補 attr2 外力原 move relay、0ms record與反向位移 facing。
  新增需確認的 **「HP設為1」** 入口；未自動建角或改進度。地圖請求亦加同圖重進 generation guard。
  [原檔證據、實作界線與操作](docs/NATIVE_DEATH_ANIMATION.md)。LIVE使用**全新獨立存檔**，不冒稱恢復舊角色。
  未跑test／check／typecheck／browser／VM／probe；不宣稱完整CVecCtrl／CShape2D、30ms同步或全遊戲1:1。

- **前輪（2026-10-18，未測試）**：原目前格 lt/rb／swept與內縮碰撞、第二RNG的迴避／受傷、
  原負HP報告、紫色數字／MISS、signed 1.5秒保護、外力擊退與hit表情；補EVA藥水及明示領藥。
  同時修正漏傳表情與canvas delay，補dead姿勢及原2.2秒Notice復活窗、OK／Enter→原returnMap流程。
  當輪未接墓碑動畫；後續見上項。本輪仍不宣稱完整CVecCtrl／CShape2D、技能或魔法已完成。
  [證據、界線、方便操作](docs/NATIVE_CONTACT_REVIVE.md)。本沙箱沒有舊ignored進度，LIVE是**新的獨立存檔**，不冒稱恢復舊角色。
  未跑test／check／typecheck／browser／VM／probe，啟服非PASS。

- **前輪（2026-10-18，未測試）**：有效裝備篩選／實例能力總值、命中與迴避被動數值、原 **S→Detail** 九列；
  裝備 HP/MP 上限接補藥／自然恢復／升級補滿。普通物理攻擊改用新定位的 **4C7960**，包含命中、武器動作、PD、mastery；
  原 WZ 傷害數字與 MISS 取代白字。攻擊／命中藥水已接實際計算，工具可勾選後明確各領3瓶。
  當輪迴避只合計／顯示；本輪已補怪物碰撞，**主動技能、魔法與完整 CShape2D 仍未接齊**；未跑測試／typecheck／browser。
  [來源、界線與操作](docs/NATIVE_STATS_COMBAT.md)。當輪沿用原存檔；本輪環境已重建，未找到舊存檔，不自動重建／冒稱恢復角色。

- **前輪（未測試）**：更正原暫時能力封包第一字為時間、第二字為mask；接同欄覆蓋／到期／原raw圖示，
  原加速藥水速度+8、180秒實際改移動；穿戴裝備的速度／跳躍實例值也依原上下限接入。
  `/tools` 勾選同意後可明確領3瓶；非原版工具內另顯示速度百分比與剩餘秒數，不自動改進度。
  [原版證據、操作與未完成界線](docs/TEMPORARY_STATS.md)。本輪已擴充 PAD/ACC 藥水；其餘未實作效果仍不白耗，主動技能buff未完成。

- **前輪（未測試）**：依558950／4BE790接上自然 HP／MP 恢復、回血／回魔與繩梯被動、地圖 recovery 倍率，
  用原0x1C報告→0x0D回值，不在瀏覽器假加血。
- **方便自行體驗**：登入後按上方「體驗工具（非原版）」或輸入 `/tools`，可選原職業書、明確給AP/SP、
  補滿／半血半魔、查地圖並傳送、還原能力／技能。預設關閉，只有 `--test-tools` 授權帳號可用。
  第一次修改自動建記憶體還原點；**不跨重啟，升級後拒絕回舊能力，不回溯EXP／道具／金錢**。
  [原版來源、操作步驟與界線](docs/RECOVERY_TEST_TOOLS.md)。不重seed目前存檔，也不自動改角色。

- **前輪（未測試）**：原 CUISkill 176×315 四列技能窗、原 WZ 書／前置／等級描述、SP 單點學習、
  0x1D→0x0E、拒絕解鎖與即時保存；已學紀錄連到前輪 HP／MP 成長被動。更正為 PE 的本版職業名稱。
  [來源與具體界線](docs/SKILLS.md)。K／HUD 開窗；**初心者原本無技能書**，不擅自轉職／加 SP。
  主動施放、其他被動／buff、自然 AP/SP 與轉職仍未接。

- **前輪（未測試）**：依原 PE 十行成長表接上自然 HP／MP、已學被動與穿戴 INT、HP／MP AP、
  六種加點與殺怪立即保存；更正舊反編譯誤讀。自然 AP/SP 發放量仍未定位。
  [來源、限制與已啟動的隔離預覽帳號](docs/STAT_GROWTH.md)。

- **前輪（未測試）**：原武器基本動作表／逐幀速度、弓弩拳套選彈與空射扣彈、0發飛鏢／末箭清格、
  0x10→0x24本人與旁觀投射物、延後命中／EXP掉落、stand2／walk2武器合成。
  來源與碰撞／傷害等政策界線見 [BASIC_ATTACKS.md](docs/BASIC_ATTACKS.md)。

- 原WZ登入／世界／選角、建刪角；原地圖、角色／怪物動作、繩梯、傳送、BGM與基本音效。
- 原Stat與已有AP的六種能力配點（含HP／MP）、背包拖放／裝備窗與真穿脫／旁觀外觀／保存。
- 原小地圖與DPR整數實體像素顯示。
- 前輪新增：背包超過24格的捲動、道具地面丟棄與數量框、商店批量買入／部分出售、
  原UtilDlgEx視窗與過期操作保護、交易立即保存。

**本輪依使用者要求未執行測試**，亦未跑typecheck或瀏覽器驗證。前輪文件中的570項PASS只是歷史結果，
不能當作最新修改已通過。提交附 `[skip ci]`，本次push不自動跑GitHub Actions測試。

## 本機啟動

需要 **Node.js 22.6+**。執行時零npm依賴；`npm ci`只用於開發工具，不是啟動必要條件。

```sh
cd server
node src/cli.ts serve \
  --host 0.0.0.0 --port 8496 --game-port 8497 --web-port 8495 \
  --data ../Data.wz --save ../generated/local-save.json \
  --account demo:demo --ping off
```

開啟 `http://127.0.0.1:8495`，demo/demo登入。這是**新本機資料檔**的範例，不是正式帳號／存檔恢復命令。
若已有進度，先備份，將 `--save`指向那份真正的存檔，不要用新fixture取代。
login／game TCP與web HTTP是不同port；遠端瀏覽器使用web的網址，WebSocket與素材均走同origin。
外網部署前需自行處理TLS、帳號安全、持久化與備份，不能把這個開發指令當正式營運設定。

`generated/`、node_modules、生成素材與存檔不進Git。請勿將重要存檔放在 `/tmp`；該位置不保證跨工作環境保留。
本工作區只曾使用明示的隔離QA存檔，沒有以QA進度覆蓋缺失的舊正式存檔。

## 操作

| 操作 | 功能 |
|---|---|
| ←／→、A／D | 移動 |
| Alt／空白 | 跳躍 |
| ↑／↓ | 繩梯；地面靠門↑使用，自動門靠近觸發 |
| Ctrl | 目前已接的一般攻擊路徑，傷害公式仍有重建政策 |
| I／E／S／M | 背包／裝備／能力／小地圖 |
| 背包道具雙擊 | 一般裝備穿戴或支援的消耗品使用 |
| 拖放道具 | 背包換位、穿脫；拖到真正場景為丟棄，狀態列／瀏覽器外取消 |
| 背包左下金幣按鈕 | 丟10–50,000楓幣，數量窗確認後由服務端落帳 |
| 商店충전 | 對未滿的207飛鏢整組補充，確認後按WZ單價收費 |
| 商店左列／右列 | 選擇後按買／賣，或雙擊開數量框 |
| Enter | 聊天；對話框內確認 |
| Escape | 取消拖曳／數量框，或關閉已接的視窗 |

**丟棄前注意**：單件裝備拖到場景會直接丟1件；堆疊道具詢問數量。地面掉落物只在記憶體中，
尚未拾回就停服會消失；請用非重要物品自行確認最新未測試功能。
背包捲動遵守原capacity，不會自動擴包。最新已接原金幣按鈕／0x1F楓幣丟棄，以及207飛鏢整組購買、補充與空組處理（均未測試）；詳見[交付範圍與限制](docs/MESO_RECHARGE.md)。

最新已依原 exe 的 HP／MP 表補上逐級成長、已學被動與 HP／MP AP 加點／保存；舊「成長表不在 client」判讀已更正。自然 AP/SP 發放量仍未定位，不套後期數字。見 [STAT_GROWTH](docs/STAT_GROWTH.md)（未測試）。

聊天 `/help`列出命令；`/map ID`需服務端明確開啟 `--map-command 帳號,...`，預設禁止。
地圖ID、名稱、原圖、腳踏點來自Data.wz，不以人工平台或「缺素材」fallback掩蓋reader問題。

## 文件索引

- [最新 HP／MP 原版成長、六種 AP 與隔離預覽（未測試）](docs/STAT_GROWTH.md)

- [最新楓幣丟棄／飛鏢補充交付（未測試）](docs/MESO_RECHARGE.md)
- [背包／丟棄／商店數量交付（未測試）](docs/INVENTORY_OPERATIONS.md)
- [客戶端使用與限制](docs/CLIENT.md)
- [背包／裝備前輪驗證紀錄](docs/EQUIPMENT_VALIDATION.md)
- [傳送／繩頂／地圖命令](docs/PORTAL_CLIMB_VALIDATION.md)
- [動作、繩梯與音訊](docs/CLIMB_AUDIO_VALIDATION.md)
- [朝向與選角](docs/FACING_SELECTION_VALIDATION.md)
- [流暢度與Stat/AP](docs/SMOOTH_STAT_VALIDATION.md)
- [清晰縮放與小地圖](docs/DISPLAY_MINIMAP_VALIDATION.md)
- [架構](docs/ARCHITECTURE.md) · [決策ADR](docs/DECISIONS.md) · [路線圖](docs/ROADMAP.md)
- [協定與反編譯發現](docs/protocol/FINDINGS.md) · [WZ格式](docs/WZ1_FORMAT.md)
- [伺服器](server/README.md) · [字型來源與授權](client/fonts/README.md)

卷軸強化、完整技能／怪物攻擊與受擊、裝備／buff總值／Detail、自然升級AP/SP發放量、
完整交易／組隊等瀏覽器UI、現金／寵物、技能遠距攻擊／原形狀碰撞與完整傷害公式仍有未完成範圍；既有server的etc/cash分頁映射與原UI標籤亦尚待存檔遷移。各文件區分原版證據、重建政策與歷史驗證。
