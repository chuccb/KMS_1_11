# CUIToolTip：道具／裝備／技能原版版型與唯讀閱覽

2026-10-18 · ADR-064 · **實作與回歸來源已編輯，未測試、未 typecheck、未語法檢查、未 browser／VM／HTTP／登入 probe。**
啟服不是 PASS；字型與像素結果留給使用者自行操作確認，不要求每補一處就測一次。

## 證據與反編譯陷阱

依本 repo `MapleStory.exe.c`（CP949）、`MapleStory.exe.lst`、PE 原字串、當前 `Data.wz` 直接 dump 交叉：

| 原址 | 對應內容 |
|---|---|
| 4FFE30 / 5030F0 | 七組 Gulim 字型、index 與 ARGB 字色 |
| 5014C0 / 4FFC90 | 裝備 title、性別／CUC、武器分類、signed WORD footer、職業遮罩 |
| 502780 / 5029A0 | 普通 item／skill 基本尺寸、desc、目前／下一級 footer |
| 503210 / 5034E0 | footer 尺寸量測、置中、白 divider 與行距 |
| 503840 / 5054B0 | 68×68 A0FFFFFF 底、normal canvas 原點、2× stretch |
| 503AF0 | tooltip 專用 description lexer／字符折行（不是 CUtilDlgEx macro） |
| 504480 / 525AE0 | 五項需求 Can／Cannot labels、變寬數字 canvas 的 Copy 與 advance |
| 502CE0 | A0000040 frame、透明 inset keyline、799／599 clamp |

**不能直接把壞 C 的 pointer arithmetic 當像素值：**

- `501C1A add eax,14h`：title measure **+20**，不是反編譯 `_DWORD* +5` 表面上的 5。
- `5033C2 add eax,14h`：footer measure +20。
- `50340A add edx,4`：每行總高度 **fontHeight+4**，與 `5037FE lea ebp,[edx+ebp+4]` draw pitch 相同。
  舊調查裡「總高+1但 draw+4」是 `_DWORD* +1` 誤讀，本輪沒有保留那個錯誤。
- jobs 起點(12,110)，後續 x 按整段 `"%s   "` measure 累加；C 中 `DWORD* +3` 是 12，不是 3。
- 503840 listing 的 Canvas +50h／+58h 讀 width／height；+84h／+7Ch 讀 origin x／y。
  不把其他歷史文件中「vtable132=height」的稱呼沿用到 tooltip，也沒有順便改動 NPC 行為。

原韓文由 kstr／PE bytes 還原，不翻成自創中文 stats；4FFC90 最終 switch 沒有 case47，不補後期拳套名稱。

## 實作與整合

`client/tooltip.mjs` 將純 plan 與共用 painter 分開；既有 frame／simple name tip 保留。
舊 compact paragraph helper 僅保留相容性，遊戲 item／skill 不再呼叫。

| 類型 | 初始寬高 | divider | 標題／icon／desc |
|---|---:|---:|---|
| type3 equip | 216×142 | 128 | title y10；icon(14,32)；需求在右；job y110；不把 desc 當 footer |
| type4 item | 290×116 | -1 | title y10；icon(14,32)；desc(92,35) right270 |
| type5 skill | 290×128 | 114 | 同 item；footer 從 y122 依 fontHeight+4 排列 |

footer 每列增加 runtime fontHeight+4，寬至少 measure+20；標題置中、equipment title 可加寬。
skill hs 仍是一個置中 record，太長加寬，不換成後期窄框／手動分欄。item 原固定高度不擅自改成現代自適應長框；
整窗 clip 防超界，desc 沒有額外發明一個會截斷原行的獨立 viewport。
極端大字串在 browser painter 限制799×599，屬防護，不聲稱 native 崩潰／超大 canvas 行為。

七色：white、`#FDF514`、`#FF8A18`、white、`#BBBBBB`、`#7B8C91`、`#F20303`。
原14px BA 用 CSS bold14px Gulim，內文12px Gulim；依 runtime fontBoundingBox 計高度，缺 metrics 才用16／13。
既有 KMSCJK 是本地合法 fallback，**不是原 GDI Gulim、不是字型／AA 像素完全相同**。
字型 loadingdone 清除 layout／height cache。每 renderer 至多64 plans，另有2048個文字寬度上限；以 immutable facts identity、
instance stats／ruc／cuc、五項有效能力、skill level 為鍵，不每幀序列化整本 hs catalogue。
原圖仍走共用 artImage cache，沒有每 hover 建 Image 或晚到 callback 復活 tooltip。

### normal icon 與需求圖字

503840 的底圖68²，normal canvas 放大2倍：

```
x = 14 + 2 - 2*ox
y = 32 + 2*(33 - oy)
w = 2*normal.width
h = 2*normal.height
```

紅水 normal27×30、origin(-3,30) → (22,38)／54×60；raw27×27不能代替。
短劍 normal31×30、origin(0,30) → (16,38)／62×60。
戰士技能 normal32×32、origin(0,32) → (16,34)／64×64，不用 disabled／mouseOver 放大。
`SkillInfo.icon` 新增 path／width／height／ox／oy；既有 `/api/skill/<id>` inline 資料形狀不必變更，
完整 `/api/skills/<job>` catalogue 提供新 metadata。

`UI/UIWindow.img/ToolTip/Equip/{Can,Cannot}` 五個 labels 都45×7；label(96,35+14i)、digits(146,35+14i)。
0–9除1外5×7，**1為3×7、origin(-1,0)**。native Copy 不另手動位移 origin；advance=actual width+1，
所以 `10` 的兩張圖 x146／150，不是146／152。數值0照樣有一個原數字canvas。
逐項比較 level／STR／DEX／INT／LUK，使用 **有效 BasicStat**，含有效穿戴加成，不用 raw CharData，
也不把「整件 canWear=false」當成五列全部紅。BasicStat 尚未到達就先不畫裝備 tip，不把 unknown 當角色能力0。
jobs 是物品 reqJob mask：reqJob0全白，否則初心者紅、允許 bit 白／其餘紅；不是當前角色 job 判色。

### 實例資料界線

- 背包、穿戴、商店賣出：只用 wire inventory instance 的 signed WORD stats、byte ruc/cuc。
- 只有 **商店買入 row** 明確允許 WZ equipment template。售價不是 instance，不能因缺 stats 就泛用 template rescue。
- 原 footer 只列 signed >0，順序 STR／DEX／INT／LUK／HP／MP／PAD／MAD／PDD／MDD／ACC／EVA／craft／speed／jump，
  前有原 weapon class、後有正 ruc。0或負值不列（不是本輪自行「隱藏扣能力」的規則）。
- CUC>0 title 橘，格式 `name (+N남)`／`name (+N여)`／`name (+N)`；CUC0依ID性別位顯`name (남)`／`(여)`／純名。
- 不再在原 item tip 添加自創「價格／數量／需求等級」中文列表；那些數量／售價仍保留於背包／商店本身。
- 不改裝備值、原防禦／傷害／wear判定、save migration、卷軸或cash行為。

### description 與當前／下一級

503AF0 專用逐字符累加：leading space/tab/CR/LF 清掉；literal `\\n` 只 flush 非空行；
`\\\\`→一個 slash；未知 escape pair 吞掉。超寬時**保留造成超寬的字**在同一行，再帶一個掛行`.`／`,`，不退到單字邊界。
不套 dialogue #i/#s lexer，也不亂補人物／任務／後期 macro。

skill0只顯 `[다음레벨 1]`／level1.hs；已學>0顯 `[현재레벨 N]`／current.hs；未max才顯 next。
name不加自創 `(N/MAX)`，hs原文不算新公式。每幀由 learned map 取目前level，SP回覆後停在原位置也更新。
關窗／tab／scroll／drag／blur／modal／換圖清理 tooltip，不在其他視窗出現後重播舊 hover。

### 每個 caller 的位置與活資料

背包／穿戴／技能：`(pointer.x,pointer.y+20)`；商店買／賣：`(x,y)`；快捷道具：`(x,y−128)`，再做799/599 clamp。
主 frame 每幀重新 hit shop／equip／bag，避免 selection 長駐、inventory更新／scroll後指向舊 instance。
原一般技能窗自己的 hover 同步讀新等級；拖物、modal、死亡與換圖不讓舊 tip 穿透。
快捷技能綁定／技能施放仍未實作，不把現有道具快捷鍵稱成技能功能。

## 方便操作但不冒充原版

「體驗工具（非原版）」→「原提示框閱覽」沿同 renderer：普通道具／模板／持有裝備快照、
比較值0、合成CUC3、技能0／1／MAX。初心者不必轉職／加SP。模板例子取真 `1302001`（톱，reqLevel10、reqJob8、PAD27、tuc7），
而不是硬編當代武器要求。CUC3只造本地view copy，**不計算卷軸、不增加能力、不給物品、不代表角色成功強化**。

工具列／比較值都明示 UI PREVIEW／非原版；只讀API、沒有send能力、沒有localStorage/save寫入。
持有實例在選模式時取快照，優先武器，沒有就說明，不用模板冒充。
Esc／關閉、Tab循環、焦點恢復；新選項／關閉 AbortSignal，identity guard丟舊response；失焦／離頁隱藏跟隨圖。
真NPC／shop／field／death／disconnect優先清理唯讀閱覽；不暫停世界，不替代任務流程。

## 回歸來源與仍未完成

新 `server/test/native-rich-tooltip.test.ts`、`native-tooltip-preview.test.ts`，並更新 skills／webclient／舊client_probe來源：
lexer／footer／title／字色／字距／normal origins、實例與模板隔離、有效需求、0/1/MAX、font到達與唯讀生命週期。
**全部未執行**；沒有以靜態 dump、原碼閱讀或程序啟動宣稱 PASS。

仍不聲稱原 GDI 字形／所有 CP949 CharNextA 病態字串、CShape2D／全域時鐘、主動技能／buff、轉職自然APSP、
卷軸／cash／pet／交易、原 quest／taxi／trunk scripts 已完成。這一輪不重seed、不自動修角色、不回退使用者存檔。
停服後備份當下同save，再以既有帳號／授權／port重啟；實際結果於交付紀錄列明。

## 本輪實際保存／啟服

1. 已停止舊 LIVE `kms-1-11-56849b49`。取停服當下最新 save 冷備，沒有用前輪備份覆寫、沒有重新 seed 或自動配置角色。
2. 冷備：`generated/backups/preview-death-before-native-rich-tooltips-20261018-021455-631318785.json`。
   主 save 與冷備 SHA256 同為 `06cc4876251d2fcfe3d7c785cc34523423d6b4b0545e7fc47248308d667790aa`。
   generated 仍忽略，不提交玩家資料；後續使用者操作照常更新主 save。
3. 新 LIVE `kms-1-11-72c5b59c`／PID18281，web8515／login8516／game8517 均綁0.0.0.0。
   啟動 log 讀到同 save 的2帳號1角色，明確忽略已有帳號的 --account entries；沒有預覽警告。
   **只啟服，未發 HTTP／登入／遊戲操作 probe，不表示新 renderer 已驗證。**
4. 命令沿用：
   ```sh
   node server/src/cli.ts serve --host 0.0.0.0 --port 8516 --game-port 8517 --web-port 8515 \
     --data Data.wz --save generated/preview-death-20261018.json \
     --account preview:preview,demo:demo --map-command preview,demo --test-tools preview,demo --ping off
   ```
5. 固定工作分支 `arena/593e75b0-kms-1-11`，提交含 `[skip ci]`，只非force推此分支。
   commit／push 成功與否以 Git 結果及交付訊息為準，此處不預先虛稱。
