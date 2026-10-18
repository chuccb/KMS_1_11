# CUtilDlgEx 圖文內容、原圖示與選項整條接線

2026-10-18／ADR-063。**已編輯實作與回歸來源，未執行驗證。**
依使用者要求，沒有執行 test/check/typecheck、語法檢查、瀏覽器、VM、HTTP／登入 probe。
下列 EXE／listing／Data.wz 查閱不等於功能測試，啟服也不是 PASS。

## 原始證據，不套後期版本

| 原位置／資料 | 實際讀到的內容 | 實作對應 |
|---|---|---|
| `534A80`、`534D10`、`534FA0` | CharNextA 按完整字元讀取；CR／`#`／普通文字分支；`##` 是單一 literal `#`，`L/i/s` 才讀數值尾段 | `dialogueRuns` 分出 newline、文字、item、skill；保留未知碼，不新增後期 `#h/#t/#p/#m` 替換 |
| listing `00534FE0..00535025` | switch：35 為 hash escape；76/105/115 為 L/i/s 數字 token | UI 與回覆邊界共用 bounded canonical lexer；不再用 raw regex 誤認 `##L99#` |
| `5338A0`，listing `00533A8D`／`00533B0F`／`00533BC4` | `#i` → `479D30` 道具名稱、`479B10(id,1)` 普通 UI canvas；不是 iconRaw | `/api/item/<id>` 的 `icon` metadata ＋ `/api/png/<path>`，不走目前 icon.png 的 raw 優先路徑 |
| `5338A0`，listing `00533C8D`／`00533CC0`；`4BB270` | `#s` → `4BAC80` skill entry 的名稱(+4)與 canvas(+100)；`4BB270` 把 `icon` 放 entry+100 | 新增唯讀 `/api/skill/<id>`；不依角色是否學會技能，不用 iconDisabled／iconMouseOver |
| `5359B0`／`535A60`，listing `005359FA`／`00535A92..00535AA3` | 掃描同一 row 的最大 height，至少16；piece.y = rowY + rowHeight − piece.height；underline offset = height−1 | 道具／技能／文字混排按行底對齊、2px 行距、用實際 canvas 寬高；不用 origin 當作掉落物錨點 |
| `5338A0`／`535520` | 寬度容納、完整字元切分；下一字為 `.` 或 `,` 時可掛一字；續行移除空白 | 量測完整 substring，不再累加每字寬度；完整 Unicode code point、不切半個字元；續行修剪不吃手動換行後縮排 |
| `530D40`、`5333D0` | 圖示按 piece 左上直接 Copy；命中用 piece 寬高；選中同一 selection 的 piece 在 height−1 畫黑色1px線 | 圖文／純圖選項、跨行同值底線、實際高度命中與 viewport clipping；保留原稀疏選項數值 |
| `5333D0` → `500F50`、`505530`、`502CE0` | 只有 type1 icon 的名稱提示，指標(+20,+20)、font172 白字、文字(4,3)、量測寬+8／字高+6、799／599 收邊 | 新 `drawSimpleTooltip`；不是背包 stats tooltip，沒有虛構需求／能力面板；browser 量測整體字高 |

### 直接讀取 Data.wz（不是功能驗證）

使用 `python3 tools/wzdata.py Data.wz --dump <image>` 直接查閱三個 image，結果存 sandbox `/tmp/dialogue-wz-*.txt`，不進 Git。

| image／節點 | archive 名稱 | 普通 icon | iconRaw／origin 差異 |
|---|---|---|---|
| `Item/Consume/0200.img/02000000/info` | 빨간 포션 | **27×30**，origin(-3,30) | raw **27×27**；不能拿地上圖冒充普通圖示 |
| `Character/Weapon/01302000.img/info` | 검 | **31×30**，origin(0,30) | raw **31×29** |
| `Skill/100.img/skill/1000000` | HP 회복력 향상 | **32×32**，origin(0,32) | 同時有各自獨立的 iconMouseOver／iconDisabled，inline 使用 icon |

這些素材存在；本輪是在補內容 parser／排版與讀取接線，不是用「缺素材」的 fallback 掩蓋問題。

## 連貫完成的部分

1. `#i`／`#s` 變成有 id、selection、實際寬高與名稱的 canvas records，不再印出 markup。
2. `##` escape、CR/LF、色彩、粗體、圖示前後的 selection scope 同一套解析；未知碼保持 literal。
3. 用普通 item icon／skill icon 的原像素、原尺寸；不拉伸為16px、不畫 placeholder、不畫掉落物 origin。
4. 每行至少16、取圖示最大高度、行底對齊／2px 行距；原300／230字框、padding、普通長文捲軸門檻不換成後期 UI。
5. 文字以整段量測折行，考慮 shaping／kerning；掛行句點／逗號、續行空白、顯式縮排分開。
6. 圖文與純圖選項都可選，保持10／20／42／84等實際數值；多行同值只設一個 Tab stop，透明命中仍逐 piece，避免空白矩形誤選。
7. 圖示的實際高度連到 draw culling、命中框、黑色底線、keyboard reveal／scroll、viewport clipping。
8. 名稱提示在對話上層、文字區 clip 之外畫；滾動、重排、離開、失焦／取消、close 清掉舊提示。
9. 資源載入依 id 去重、最多4個同時請求、跨頁成功快取128筆；錯誤不永久負快取，不讓無效回覆借用 iconRaw。
10. 等該頁 metadata 與首輪 PNG 嘗試完成再啟用接受／選項；ESC／Close仍可取消；不是阻塞世界或自動接受。
11. 每次開啟有 AbortController；關閉／死亡／換圖／斷線沿既有 close 路徑取消請求；新舊 modal identity guard 防舊頁套到新頁。
12. 字型到達後重新量測，但保留 editor value／selection、scroll 範圍與選項焦點；重建控件時取消舊 press／drag，不合成 click。
13. 回覆邊界從目前 body 重新解析選項；escaped `##L`、只有標記或換行而沒有 selectable record 的值不再被 raw regex 接受。
14. 新增兩個有明確標記的唯讀入口，沿真對話 renderer，並把 preview kind 與 packet kind 分開，避免單頁圖文 OK 誤跳普通 say 的第二頁。

## 使用者自行操作的入口

登入後：「體驗工具 · 非原版」→「對話窗範例 · 非原版工具／唯讀」：

- **原圖示／圖文長文**：紅水／短劍／戰士技能圖示、不同高度、反覆圖文長文與原樣式捲軸；滑鼠停圖示看 archive 名稱。
- **圖文／圖示選項**：10紅水、20短劍、42跨行技能文字、84純圖示；Tab 每個值只停一次，Enter／Space 操作有焦點的選項，Close／ESC取消。
- 舊五種入口保留；範例仍標 `UI PREVIEW - not an NPC quest`，結果只到本地日誌，**不送0x15、不給道具、不學技能、不修改角色／存檔**。
- 真0x47優先於 preview；普通NPC仍由現有遊戲層發 say，並未杜撰新的任務／計程車／轉職腳本。
- 世界、怪物、HP與時間不停；不自動換圖／補血／裝備／seed，可自行選無怪城鎮。

## 明確界線

- 原 lexer 使用 atoi 並可吞入非canonical數字尾段；此重建只接受 **`#L<number>#`／`#i<number>#`／`#s<number>#`，number為非負十進位 signed32** 的有界 canonical grammar，其他保持 literal。
  不把對畸形 token 的 Windows CRT／崩潰行為當成必須模擬的功能。
- Browser Gulim／KMSCJK 不是原 GDI fonts。整段量測、字元邊界與所考證的掛行／修剪已補，但不宣稱原字距、所有 ANSI／DBCS word-splitting、空行字高或 typography pixel-perfect。
  simple tooltip 無 fontBoundingBox metrics 時的13px是browser fallback，不是聲稱原font字高固定13。
- Abort、metadata並行與容量、載入期間接受 gate、無效icon尺寸上限4096、clipping、Tab去重／Space／焦點保持都是 browser 傳輸／可及性／防護政策；不是原 CWndMan 全移植。
- 沒有完整原 item／skill 詳情 tooltip；本輪補的是原 CUtilDlgEx 的 **單行名稱** tip。未知 macro 仍 literal，不虛構後期語法。
- 原 quest scripts、計程車／倉庫／交易／轉職業務規則未定位；不能由 client 選單介面推導原server腳本。
- NPC自主CVecCtrl、sender+2／receiver raw矛盾、完整Gr2D／Shape2D／全域30ms等前輪界線不變。

## 回歸來源與交付紀律

- `server/test/native-dialogue-richtext.test.ts`：lexer／escape／reply authority、原圖示尺寸／row底、wrap／掛行／縮排、純圖選項、metadata去重／校驗／取消／快取／並行、名稱tip邊界與modal接線來源。
- `server/test/native-npc-dialogue.test.ts`：更新舊「#i保持literal」斷言；原五種body／CP949／素材來源保留。
- `server/test/webclient.test.ts`：追加普通icon／iconRaw差異、skill名稱／normal32×32、無效id及唯讀存檔契約。
- **上述都只新增／編輯來源，沒有執行；沒有任何新功能PASS。**
- 不改角色資料或save schema，不seed／修裝備／遷移帳號；停服後冷備當下同一份save，再用同參數開LIVE。
- `[skip ci]` 提交、非force只推目前Arena分支；啟服不冒充驗證。


### 本次冷備／LIVE 紀錄（只啟服，未驗證）

已停止前一個8515／8516／8517服務，冷備 **當下** `generated/preview-death-20261018.json` 到：
`generated/backups/preview-death-before-native-dialogue-richtext-20261018-095257-080293115.json`。
主檔與備份 SHA-256 同為 `82e0f6e37c43abb4588b14a9a9a69b1d5aa13f8704ddaf61096b10d9c0fdd616`。

同一save重開 web8515／login8516／game8517，host0.0.0.0；啟動紀錄載入2帳號／1角色、既有save優先於CLI帳號。
沿用 preview／demo 的既有登入、map-command／test-tools 權限，ping off；沒有seed、修角色或覆回舊備份。
冷備／存檔留在ignored generated，不進Git。這是啟服紀錄，不是HTTP／登入／功能PASS。
