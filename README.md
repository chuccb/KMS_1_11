# KMS 1.11 重建工作區

以本倉庫的2003年KMS 1.11反編譯程式、PE與原始 `Data.wz` 為依據，實作TypeScript協定／伺服器、
瀏覽器客戶端與WZ工具。**不是完整MMO成品，也不宣稱全遊戲已1:1還原。**

## 最新交付

- **本輪（未測試）**：原 CUISkill 176×315 四列技能窗、原 WZ 書／前置／等級描述、SP 單點學習、
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
