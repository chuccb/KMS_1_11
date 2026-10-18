# 原技能視窗、SP 學習與已學成長被動（2026-10-17）

**實作已寫入，但本輪依使用者要求沒有執行測試、typecheck、瀏覽器、VM 或 probe。**
本頁是來源與實作界線，不是驗收報告；啟服日誌也不代表功能通過。

## 1. 原始證據，而非套用後期楓之谷

來源是本倉庫 `MapleStory.exe.c`、原 PE `MapleStory.exe` 與 `Data.wz`；不修改原檔、不另造技能素材。

| 原位址／路徑 | 本輪結論 |
|---|---|
| `sub_43FF00`、PE VA `0x5B40D4` | 原職業名稱指標表，以 PE section VA→file offset 解指標、CP949 解字串。共用於瀏覽器名稱和伺服器有效職業表，不再沿用後期的 `100=전사`、`110=파이터` 等錯誤名稱。本版是 `100=검사`、`110=전사`、`200=매지션`、`230=성직자`。 |
| `sub_43FFB0` | 有效職業的技能書祖先：先百位 root，再十位分支，個位 1／2 再加上第三／第四個 book。例 `112→100,110,111,112`。**job 0 沒有技能書**；不補後期初心者技能。只有 WZ 真正存在的書會顯示。 |
| `CSkillInfo` loader `sub_4BAD60`、`Skill/<book>.img` | 原 skill 枚舉順序、name／desc、req、各級 level／hs／數值，以及 iconDisabled／icon／iconMouseOver 路徑。不是從說明文字推導效果。 |
| `sub_55ABE0` | 先查所有前置技能：不足回 0；已學等級達最大回 -1；其他回 1。這裡沒有新增「角色每級才能點某級技能」的現代規則。 |
| `sub_4EE1B0`、`sub_55D140` | 原 SP 按鈕要求 alive、SP>0、沒有 pending、距上次 release 至少 500ms，且 eligibility=1；送 `0x1D + u32 skillId`。客戶端不送目標等級／任意數量。 |
| `sub_55A900` case 14 → `sub_55B6A0` | 真正技能更新是 **s2c 0x0E，不是 0x0F**。`u8 ack, u16 count, (u32 id, s32 level)*`；正數更新、非正數移除。非零 ack 解除 pending 並更新時間。**沒有 expiry／master level 欄位。** |
| CharacterData `sub_45FCC0` flag `0x20` | skill id→level 使用已存在的 `items.map32`（record+382 的 ZMap），不用改 save schema。 |
| `sub_4C7450` | HP 1000001／MP 2000001 的已學紀錄影響後續自然／AP 成長。前輪已接此讀取；這輪 SP 學習寫回同一張 map，不另外複製一份假被動。詳見 `STAT_GROWTH.md`。 |

原表包含後續職業名稱，不代表本輪有實作轉職／開放所有職業內容；不因表裡有名字便生成 WZ 沒有的技能書。

## 2. CUISkill 原視窗幾何與素材

`sub_4EC910` 建構、`sub_4ECD40` 建立控制項、`sub_4ED8E0` 繪圖、`sub_4EE5E0` 命中：

| 部分 | 原邏輯像素座標（相對視窗） |
|---|---|
| 視窗 | 176×315，CConfig type 3 預設 (96,96) |
| close | (128,9) |
| CCtrlTab id 2000 | (3,52)，width 170，標籤 I／II／III／IV |
| CCtrlScrollBar id 2001 | (161,116)，height 162 |
| 四個 row | (5,119+40i)，154×38；**每列之間 2px 不是命中區** |
| icon | (8,122+40i)；原拖曳另採 32×32 icon 命中區 |
| name／learned level | (43,123+40i)／(43,139+40i) |
| BtSpUp | (139,137+40i)，17×16 |
| SP／book name | (68,282)／(59,91) |
| book icon | `Item/Book/0500.img/05000000/info/icon`，(23,82) |

背景、兩種 row、SP 按鈕來自 `UI/UIWindow.img/Skill`，close 及 Tab／VScr 用原共用 UI 元件。
Gate=0 才用 skill0／iconDisabled；max 的 -1 仍是 skill1／正常 icon，不能把滿級誤畫成前置不足。

瀏覽器入口為 HUD 的 Skill 按鈕／K，Escape 關閉；支援 tabs、四列捲動、滾輪、滑塊、標題拖曳與位置保存
`kms111.skillAt`。DOM 透明命中層配 canvas 原圖；提供 tab／SP ARIA、鍵盤操作。這是瀏覽器輸入整合，
**不是已重建整套 CConfig 自訂按鍵**。視窗全矩形阻擋穿透，原數量 modal 優先，避免背景背包 tooltip 蓋上來。

2026-10-18 ADR-064 已取代舊簡化 tooltip：按 `5029A0` 的 type5／290×128／separator114、
14px BA 標題、原 normal icon 兩倍、desc(92,35)及原 `503AF0` 字符折行；底部依目前已學等級
顯示 `[현재레벨 N]`／hs、下一級 `[다음레벨 N]`／hs。0 級不顯目前、滿級不顯下一級；
SP 回覆後停在同一列也讀取新等級。hs 不套自創公式或當代技能說明。
完整 catalogue 新增 normal icon 的 path／width／height／ox／oy，並不取 disabled／mouseOver 當放大圖。
字型以 runtime metrics 量測，字型到達會清 layout；瀏覽器 fallback 仍非原 Win32 Gulim，不能宣稱像素驗收。
Tab／VScr 仍為原元件拼接。詳 [NATIVE_RICH_TOOLTIPS](NATIVE_RICH_TOOLTIPS.md)。

## 3. 端到端流程與保存

1. CLI 的 `--data` 建立共用 `SkillCatalog`，注入 game server 和 web bridge。
2. `/api/skills/<job>` 按原 ancestry 回真 WZ 書；`/api/png/<URL-encoded Skill/...>` 經既有路徑／canvas 保護輸出原素材。
   這個 API 是瀏覽器讀取 WZ 的橋接，**不是聲稱原遊戲有 HTTP 封包**。
3. 進場完整 CharacterData 先送 field／inventory，再送已學 skills snapshot；不是拿 HTTP catalogue 當已學技能。
4. `{t:"skill-up",skillId}` → ClientSession pending → 原 c2s 0x1D。
5. 伺服器重新查 alive、SP、有效職業 book、原 req／max／下一級存在；AP 和 SP 共用 500ms server rate window。
   拒絕不扣 SP、不建立技能紀錄；不信任瀏覽器給的等級或解鎖狀態。
6. 成功扣 **1 SP**，更新同一張 map32、旗標 OR 0x20、呼叫既有保存，再送
   `0x0D ack=false {sp}` 及 `0x0E ack=true [change]`。這組伺服器回包順序是重建政策；原 codec／release 條件有反編譯證據，
   **沒有宣稱擷取到原伺服器成功交易的實際封包序列**。
7. 拒絕也送 `0x0E ack=true []`，避免操作一直鎖住。讀完整更新包之後才改本地 map；ack=false 不解 SP pending。
8. ClientSession 更新 character snapshot／技能事件，維持重新進場與既有存檔紀錄一致；AP／物品／商店相關既有 gates 增加 SP pending 防線。

這不是完整 CWvsApp 全域 request gate 重建：各既有功能仍有自己的 pending；server 的 AP／SP 速率與前端控制是目前的保守整合。

## 4. 可用與尚未實作

- **已接線**：真技能書／四列原窗、SP 單點學習、前置／max／book／生命檢查、拒絕 release、即時保存、進場已學 snapshot、成長被動使用同一紀錄。
- **只有學習紀錄，不代表效果已完成**：1000001／2000001 成長已接；後續 ADR-049 又接上1000000／2000000自然恢復與1000002繩梯間隔（未測試），見 `RECOVERY_TEST_TOOLS.md`。其餘被動、武器熟練／容量等仍需逐條還原。
- **未接**：主動技能施放、拖到快捷鍵、自訂技能按鍵、技能 MP 消耗／動作／特效／傷害、持續 buff／解除／裝備 buff 合計。
  不把點 icon 當成普通攻擊去偽裝已支援技能，也不偽造 buff 圖示。
- **未接**：轉職流程、轉職加成、自然 AP／SP 的發放數量。仍不填慣見的 5AP／3SP。
- **保留現有體驗存檔**：`generated/preview-growth-20261017.json`，不重新 seed、不改角色 job／SP。
  原隔離角色是 beginner、SP=0，技能窗空白是本版正確的 book 結果，並非缺素材；這輪不擅自轉職或給點數。

## 5. 新增回歸來源（未執行）

- `server/test/skills.test.ts`：exact request／signed diff／truncation／schema codec、原職業與 ancestry、真 WZ req／max、SP 單點／拒絕無突變、成長 context 與 save roundtrip。
- `server/test/webclient.test.ts`：新增隔離 fixture 的職業／SP（只在測試記憶體），HTTP catalogue、初始 snapshot、SP 真 TCP／WS、錯職業拒絕、重新進場保存。
- `server/scripts/client_probe.mjs`／`test/client-ui.test.ts`：補新 module shim，新增 38px row／2px gap、三態 eligibility、原初心者空書與關窗回歸來源。

**以上只新增／維護來源，本輪一項也沒有執行；歷史 PASS 不能沿用到本輪。**

後續方便體驗：`RECOVERY_TEST_TOOLS.md`／ADR-049增加明示非原版的帳號授權面板；可由使用者明確套用職業／SP，不再只能停在原初心者空窗。仍不自動更動角色，也沒有實作原轉職或自然發點。
