# 手感實驗：可選物理步長與十種鏡頭（2026-10-18，ADR-081）

> 本頁保留當輪功能與驗證數字。後續ADR-082的7支browser工具遷移、素材責任、現行安全命令與最新型別範圍，
> 見 [STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)；歷史PASS不沿用為手動場景的新驗收。

這次依使用者要求，**明示開放非原版手感實驗**，不再只限原版30ms。預設仍30ms＋平滑插值＋原有平滑跟隨；其他選項不冒充官方規則，也不保證比官方更順。原版重建缺口仍見 [NATIVE_LOCOMOTION](NATIVE_LOCOMOTION.md)／[NATIVE_TERRAIN](NATIVE_TERRAIN.md)。

## 在遊戲裡怎麼用

遊戲上方開「**手感實驗 · 非原版**」：

- **本機角色物理步長**：5／8／10／15／20／30／45／60ms，約200／125／100／66.7／50／33.3／22.2／16.7次更新/秒。這是 simulation Hz，**不是渲染 FPS**。
- **平滑插值**：在最後兩個完成步之間顯示，最多延遲當前選擇的一步。例如8ms設定的插值上限是8ms，不再固定除以30。
- **即時位置**：直接顯示最後物理位置，不加插值延遲，但可能看到階梯；不是外推／穿牆預測。
- **還原30ms＋平滑插值**：不改鏡頭選擇、不改人物能力或存檔。
- Esc關閉並回到canvas；點選面板外也會關閉，不搶外部控制的焦點。換場／登入階段轉換也會關閉，不留下隱藏輸入鎖。展開時遮蔽角色輸入與動作請求，**世界／重力／傷害不暫停，不是無敵**。

已移除上方重複「背包」按鈕及其handler；**原遊戲 ITEM 與 I 快捷鍵保留**。

可先試「**10ms＋平滑插值＋疾速領航**」，再與30ms比較。喜歡較低顯示延遲可換即時位置；喜歡明顯回彈可選彈簧。這些是方便比較的起點，沒有宣稱已實測出最佳／最快／最爽組合。

## 十種鏡頭

上方鏡頭下拉選單與「鏡頭回中」獨立保留：

| 模式 | 行為 |
| --- | --- |
| 平滑跟隨（預設） | 保留既有 `.18 / 60Hz` 的指數跟隨 |
| 直接置中 | 不加鏡頭緩動，跟隨目前顯示點 |
| 區域跟隨 | 超出中央安全區才立即推邊 |
| 疾速領航 | 依實際速度向前／上下預留視野；停止後平滑收回 |
| 彈簧追蹤 | 欠阻尼彈簧，有刻意的受控超越／回彈 |
| 電影滑軌 | 較慢的臨界阻尼滑軌、前方留白與略低角色構圖 |
| 平台跑酷 | 水平方向較快，短跳保留垂直鏡位，落地後緩動回中 |
| 柔性區域 | 中央安全區外柔和追上，與即時推邊的區域模式不同 |
| 方向側肩 | 按面向預留前方視野，停下仍保留構圖，轉身平滑換肩 |
| 固定鏡頭 | 保留目前鏡位，回中按鈕仍可用 |

全部是**瀏覽器自訂政策**，不是原EXE十種模式。沒有加入會破壞像素／滑鼠命中的未完成 zoom 或 rotation。
背景、角色、附身FX與pointer仍共用同一個camera raster origin；所有模式共用VR／窄圖界限。
換圖／校正／回中清掉彈簧速度與前瞻偏移；切換模式保留當前鏡位但不繼承舊模式動量。
撞到鏡頭邊界清除該軸動量，不在牆外蓄力後突然彈出。

## 實作與數值意義

- `motion-tuning.ts`：純選項／decoder；只有明確整數ms選項可用。30由 `NATIVE_STEP_MS` 來，其他值是本次實驗政策。整數ms避免原move-path duration量化產生分數時間漂移。
- `motion-controls.ts`：typed DOM／獨立storage／reset／事件清理，匯入不操作DOM或連線。新偏好是 `kms111.physicsStepMs`、`kms111.presentationMode`，不是帳號save。
- `advancePlayer` 的第五參數真的控制積分、碰撞細分與journal duration。速度／重力／跳力仍用原先秒單位公式，不因5ms更新六次就把速度乘六。
- 切換步長保留未積分的**實際毫秒**與原journal，不按新舊步長比例重設時間；同步顯示history以免混合不相容區間。換場後也使用當前瀏覽器偏好。
- **沒有改**怪物/server時鐘、原攻擊／普通身體／臉部／自然恢復／接觸的獨立時鐘、100ms網路批次、原packet codec或bridge admission。
- 250ms catch-up、journal62 records／960ms、bridge64 records／1000ms仍是既有browser安全預算；高頻率更容易碰到backlog淘汰限制。長卡頓不是靠增加無界回補來掩蓋。
- 鏡頭的tau、位移比例、omega與damping是art-direction設定，不是EXE常數。彈簧用解析欠阻尼（omega9 rad/s、ratio0.6），電影用解析臨界阻尼（omega4.5、ratio1），不是容易受FPS影響的Euler彈簧。

小步長增加CPU工作，碰撞次數／整數接觸時刻／數值積分誤差會改變，因此**不保證各步長落點、斜坡、繩梯出口與原版完全相同**。45／60ms是較粗的對照，不是推薦的加速器。鏡頭回彈與較慢電影模式也可能讓部分人更暈，隨時可改回既有模式。

## 本輪驗證

- strict／format／build通過；針對性 **81 pass / 0 fail，9 files，62.73秒**。
- 完整 **976 pass / 44 fail，1020 tests / 110 files，199.72秒**。與9e10525逐項failure multiset比對新增0／移除0，含重複標題；CI仍不綠，不以局部通過當全案完成。
- 新增18案例：八個步長在30/60/120/144Hz RAF的物理／顯示／原codec round-trip；實際時間與climb speed；pending time切換；jump／KB marker；storage/reset/dispose；鏡頭解析解、六種構圖差異／界限／回中／不改subject；原ITEM／I與實際main wiring。
- 原9e10525與新**預設30ms**逐畫格A/B：20 scenarios、3540 frames、425個原movement packet bytes一致。只排除新增local step metadata與presentation history；沒有登入、server或save。
- 真Chromium來源版與bundle：十種鏡頭、八個步長、呈現偏好／重載、還原／Escape、外部點擊與800px popup範圍通過。title原本隱藏toolbar；測試僅以CSS顯示該DOM元件，不注入角色／地圖或改遊戲stage。0遊戲連線；另有既有mock拒絕登入測試，沒有連到真登入服務。
- LIVE同PID6097、不重啟：首頁200、兩個entry／76 modules HTTP/MIME/JS parser與Chromium首幀通過、0WS。沒有自動登入、走跳或動玩家存檔；真實遊戲內主觀手感留給使用者自行比較。

日誌保留在 ignored `generated/motion-experiments/`：focused-final、full-suite、authority、cross-check、comparison.json及型別／格式／build。原證與歷史驗證仍保留。
