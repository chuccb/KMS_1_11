# 掉落落在真實 fh：權威落點與嚴格 TS 呈現

2026-10-18，ADR-083。延續全案 TypeScript／ESNext／Bun 整理，新增要求為「掉落的道具最終應該落在 fh 上」。
這是完整掉落鏈的增量，**不是全案遷移、全遊戲原版等價或全部測試已通過**。

## 實際修正

舊 `DropField.spawnFromDeath` 只查死亡怪物的 fh chain；24px 散開越過 chain 後直接退回死亡 y，可能停在空中。
玩家的物品／金幣丟棄則直接使用角色 x/y，沒有向地形投影。舊 browser hop 到 420ms 的終點是 groundY，
下一幀 rest 卻變成 groundY−16，另外把原 WZ 背包 origin 用於地面圖示；兩者都不是地面接觸。

現在的責任鏈：

```text
monster death / FieldInstance.dropItem / FieldInstance.dropMesos
  -> DropLandingIndex.resolve(real directed WZ footholds, source, desiredX)
  -> DropEntry { integer x/y, internal supporting foothold }
  -> native 0x43 -> ClientSession decoder -> same-origin drop-enter
  -> parseDrop / createDropRecord -> dropPosition -> dropRenderer
  -> original PNG at actual dimensions, bottom aligned to authoritative ground
```

拾取、過期、既有玩家與晚加入者全使用同一份 `DropEntry` 落點；不在 browser 重新選一張地板、掩蓋錯誤封包。
`0x43` 沒有 fh 欄位，**沒有擅自擴充原封包**。browser 深度沿既有 `actorDepth` 從 wire x/y 找支持地板。

## 地板選擇：明示重建伺服器政策

原版伺服器程式不在本倉庫，不能把以下選點規則冒稱原版 server 演算法：

1. 只接受 `x1 < x2` 的有向地板。垂直牆與反向天花板不能支撐掉落。
2. 來源有有效 grounded fh hint 時，先沿真正相接的左右地板放置；只循 prev/next 且端點完全相接，不穿牆／天花板／斷鏈。
   這使站在斜坡時向上坡側散開仍停在自己的連續平台，不誤掉到樓下。
3. 來源在空中，或散開離開原平台覆蓋範圍，從來源高度向下選第一片真地板。
   不使用既有 `footholdUnderPoint` 的「絕對最近 y」，避免選到頭頂平台；空中仍保留的舊 fh hint 不可跳過中間平台。
4. 該 x 下方完全是虛空時，將 x 約束回真實平台邊緣，優先原連續平台，否則選水平距離最近的真地板。
   這是避免物品留在虛空的明示掉落政策，不新增地形或把 VR／圖片 bounds 當地板。等距選點穩定，不依賴 Map 插入順序。
5. 先把 x 量化為原封包整數，再由該 x 求斜坡 y 並四捨五入；斜坡誤差最多半像素，是 s16 wire 限制。
6. `--data off`／確實只有牆或天花板的 floorless fixture 無從取得 fh，保留舊 unresolved x/y，內部標記 fh0；不發明地板。
   **本倉庫 100 張原 WZ 地圖都有有效地板**，本次全圖 audit 沒有這個例外。

半像素 allowance 只補整數斜坡量化，不是新玩家碰撞吸附半徑。
場地會把來源的 fh hint 一起交給物品／金幣丟棄；仍保留原裝備實例、耗盡飛鏢 quantity0、數量及 mesos 語義。
沒有改道具扣帳／持久化、掉落機率、5分鐘壽命、40×60px拾取範圍、人物物理或傷害計算。

## 圖示與原版證據，不能混為一談

原 `MapleStory.exe.c` 的 `sub_4A88A0`（177841–178372）在 current／target y 都扣16，
但也以 **canvas width/−2、height/−2 置中**，不是用道具背包 origin 畫在 y−16。
`kind2` 直接進 state3，沒有 monster 的起點區塊，不應憑空再做420ms跳躍。

依這次「最終在 fh 上」要求，browser 明示採用**實際 PNG 底部貼齊權威地面點**，
而非照原版 canvas 中心上移16px後可能留下數 px 的間隔。這是使用者要求的呈現政策，**不是宣稱原版也底部貼地**。
只改 reward renderer；背包／商店／tooltip 的 WZ origin 不變。不是把封包 groundY 減一個魔術數字。

原檔實讀，尺寸並非一律27×27：

| 圖示 | 寬×高 | 原 WZ origin |
|---|---|---|
| 蝸牛殼4000019 | 25×25 | −4,27 |
| 紅藥水2000000 | 27×27 | −3,30 |
| 基礎劍1302000 | 31×29 | 0,30 |
| 弓1452000 | 31×31 | 0,31 |
| 第0／1金幣堆四幀 | 23／25／23／5 × 24 | 各幀不同 |
| 第2金幣堆四幀 | 31／32／33／32 × 30 | 各幀不同 |
| 第3金幣堆四幀 | 32×31 | 0,32 |

金幣 tier 50／100／1000 來自 `sub_4A9C10`，每 tier 四張 `iconRaw` 都驗過原圖存在。
一次預熱四幀，固定四幀時間軸，不再依 metadata 到達順序逐步增加 frame count；直接共用 bounded PNG cache，
不用為了地面圖示額外請求 canvas origin metadata。缺圖／載入中不造 placeholder。
採原 PNG 自然尺寸、原比例與像素；本次代表圖示及全部16金幣幀的最末列都有非透明像素，真 browser 另驗證可見底邊。
不宣稱已逐一驗證 archive 所有道具的透明 padding。

## 嚴格 TS 與時間政策

- `server/src/game/drop-landing.ts`：具實作的純落點 index，無 DOM 或網路。
- `client/drop-presentation.ts`：原生整數範圍的 unknown JSON 守衛、drop/remove 投影、hop/rest/pickup 狀態。
- `client/drop-renderer.ts`：typed canvas／真 HTML image、item icon 守衛、native money tiers／frames、貼地 anchors、culling、alpha finally 還原。
- `tools/audit-drop-landing.ts`：可重跑的只讀原 WZ audit；import 不讀檔或開服務，顯式 CLI 才執行。
- main 移除舊掉落計算、金幣 metadata queue 與 origin renderer，保留場景整合；換場／斷線仍 clear 原 pool。

420ms／28px hop、260ms／30px pickup、140ms money cadence 都是**既有 browser 呈現政策**，不是原 EXE 已量測常數。
hop 與 rest 共用 ground/bottom anchor，420ms 沒有16px跳位；提前拾取先記錄當下顯示位置，不瞬移到落地終點再吸過去。
看不到 taker 時保持拾取起點並到期消失；重複 taken 不倒轉時間。所有動畫只讀權威位置，沒有改角色相機或積分。

新增程式保持 ESNext／strict／unused／erasableSyntaxOnly／skipLibCheck=false，沒有 any／no-check／allowJs／假 declaration。
工具鏈重新查 latest，仍是 Bun1.4.3、TS7.0.2、@types/bun1.4.3、Prettier3.9.10、Playwright1.64.1、Chromium153.0.0，
與 exact pins 相同，不把安裝同版說成升級。client現 **83支TS**；main.js及3支legacy MJS仍未全部遷完。

## 驗證與重跑

```sh
bun run typecheck
bun run format:check
bun test --timeout 30000 ./server/test/drop-landing.test.ts ./server/test/drop-presentation.test.ts \
  ./server/test/drop-wz.test.ts ./server/test/drop-browser.test.ts ./server/test/drop.test.ts \
  ./server/test/mesodrop.test.ts ./server/test/world.test.ts
bun tools/audit-drop-landing.ts
bun run test
bun run build
```

注意測試路徑要帶 `./`：不帶斜線的 Bun filter 可能誤掃 ignored baseline checkout，不能把重複數當正式結果。

- focused **73 pass / 0 fail，7 files**；新增28案例，含 field 成員／晚加入者同封包與物品／金幣空中丟棄。
- 原 WZ **100 maps、21,079 floors、11,810 slopes、379,422 samples**：slope／edge／jump、原 s16 codec、browser exact endpoint與支持 draw layer 全通過。
- 真 Chromium component fixture：DPR1／2、4種物品＋16金幣幀的原 PNG、可見底邊、hop接rest／提早pickup、fade與alpha例外還原、loading／missing／culling。
  fixture 沒有 game endpoint／帳密／save，所有 HTTP 限同源GET，0WS；不注入正在玩的角色或使用假 Image。
- 5個新增產品／audit／fixture模組在獨立 deny-I/O process 匯入：0次fetch／socket／listen／Bun檔案API／archive open。
- strict／format／build 通過。最後完整 **1023 pass / 44 fail，1067 tests / 117 files，187.28s，5315 expects**。
  對本輪實際重跑7162765 baseline（995/44，177.45s），failure title multiset含重複新增0／移除0；
  第一輪完整也為1023/44，183.37s。不代表所有root cause均已證明相同，既有44仍阻擋CI。

ignored `generated/drop-landing/` 保留 registry／install／baseline-tests／focused-final／typecheck-final／format-final／build-final／wz-audit／final-tests／comparison／live-readonly 等紀錄。
原 EXE／DLL／C／listing／WZ／analysis 保留不動。沒有自動登入 LIVE 或操作玩家；component browser 不等於手動遊戲驗收。
沙箱重建後舊服務與 ignored save 不在本環境，不能宣稱舊PID或舊進度仍在；新的獨立測試入口須明示是新進度，絕不覆寫既有save。

剩餘 main／三支 MJS、既有44失敗與完整協定深 schema 仍需繼續整理。此增量不縮小 suite、不加 CI skip、不冒稱全案已乾淨。

## 本輪測試入口

目前新獨立 preview 的 web port 為8515；帳密 `preview / preview`，第二帳號 `observer / observer`。
這是新建的level1角色，不是舊角色恢復；保存於ignored `generated/preview/fh-20261018.json`，不能靠Git恢復。
只對這兩個帳號開啟手動test-tools與map-command，能力／道具／轉職等仍須玩家自己確認，不自動贈裝或改能力。
原八種物理步長、十種camera、ITEM／I均保留；它們不改本次掉落權威。

新LIVE首頁（proxy Host）200、81 modules MIME／JS parser與真Chromium標題120幀通過，0page errors／0WS。
觀測期間有獨立遊戲連線在更新新進度，因此初次「整個save hash應不變」斷言不成立；
保留初始log並改列並行診斷，不凍結玩家、不倒回存檔或重啟伺服器來讓hash檢查變綠。
只讀browser自己的0WS有獨立閘門驗證，不能把其他遊戲連線活動算成agent自動操作，也不拿它冒稱手動驗收PASS。
