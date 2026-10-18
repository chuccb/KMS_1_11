# 本機走跳呈現與可選鏡頭（2026-10-18）

> 本頁是ADR-079當輪的原版呈現取樣與四種鏡頭記錄。後續依使用者要求明示開放非原版步長／即時呈現與十種鏡頭，
> 見 [MOTION_EXPERIMENTS](MOTION_EXPERIMENTS.md)／ADR-081；預設30ms與原有四模式保留，下文原C／listing證據不改。

## 問題範圍與結論

使用者回報：跳躍有抽動／不順感，走路也有；不是 TypeScript 遷移才出現。
本次不改重力、走速、跳力、30ms 控制步、地形或封包來掩蓋畫面問題。

找到的共用缺口是：`advancePlayer` 固定步進後，`main.js` 每 RAF 直接繪製最新物理座標；
中間的畫面沒有 CVecCtrl 的前後位置顯示取樣。鏡頭再逐幀追這個階梯訊號。
因此影響不只 jump，也包含普通走路、上下坡、繩梯與外力移動。
這是有原證支持、已補上的呈現缺口；不宣稱它已排除所有可能的掉幀／資源載入問題，
也沒有自動登入使用者角色來宣稱動態手感驗收。

## 原 C 與 listing 證據

| 原函式／位置 | 可直接證明的行為 |
| --- | --- |
| `537520` | 每個控制更新前，current 的 `+32..+56` 複製至 previous `+64..+88`；控制步回傳30 |
| `53C2B0`，listing `53C35C–53C37E` | 取 Gr2D vtable+80 的顯示時間，讀全域控制時間；對 XY 取樣後作 signed native rounding |
| CVecCtrl vtable `58783C` +148；`53BD00`／`53BDA0` | get_x/get_y 委派至這條顯示座標鏈，不是單純讀最新物理 double |
| `537260`／`53BEC0` | 初始化／不連續移位同步前後位置，避免跨瞬移插值 |
| `553F40`，listing `553F82` 起的 update loop | `while(now - tick > 0)` 先 update、再 `tick += 30`；最後 Gr2D 時間設定至 now |
| `470340`；listing `470769–4707B1` | VR 相機中心範圍為左右各400／上下各300；窄場用 signed 整數中點合併界限 |

`53C2B0` 的 ordinary branch（另有外部向量委派分支）：

```text
phase = (controllerTime - renderTime) / 30
render = current + (previous - current) * phase
integer = trunc(render < 0 ? render - 0.499999999 : render + 0.5)
```

**時相不冒稱完整還原：**原 app 的 while 條件會把控制時間推至下一個30ms界線（ceil bracket）；
目前 browser accumulator 仍是已完成控制步（floor）。本次保留物理／輸入／journal／發包時序，
用 `phase = 1 - clamp(accumulator / 30, 0, 1)` 在最後兩個已解算位置間呈現。
這有一個控制間隔、最多30ms的 presentation latency，**不是原 app 共用全域相位的完整 port**。
若只換成 ceil scheduler，會同時改變輸入接受與權威／傳輸時間；本次不以呈現修正之名偷改這些語義。
也不外推速度或另跑一次預測物理，避免畫到尚未通過碰撞求解的位置。

`470340` 只支持上述 VR 範圍與窄場中點，**尚未找到原版 camera easing 的完整證據**。
移除舊 `.18 ≈ 原版0.2秒` 的不實註解。缺 VR 時 server 既有 art extent bounds 是瀏覽器政策，
本次沿用，不把它稱作原版的無 VR 場界計算；camera bounds 也不作為物理碰撞 bounds。

## 實際資料流

- `client/player-presentation.ts`：純顯示 sampler／不連續點 reset；重用 `collisionRound` 與 `NATIVE_STEP_MS`。
- `createPlayer` 在 clamp／settle 後同步兩端；`advancePlayer` 在**每個**30ms step前保存 previous。
  一個 RAF 補多步時取最後一個完整 interval，不把整段250ms壓成一條 spawn→end chord。
- `main.js` 在物理完成後取 `displaySelf`；角色／裝備／武器殘影、名牌、聊天泡泡、附身技能、
  附身怪物 hit FX、死亡／墓碑基準、拾物飛行終點、小地圖與鏡頭使用顯示座標。
  死亡 child 的 world→screen offset 也使用同一個傳入 point，不能再扣權威 self 而多出一段偏移。
- `self`／`playerBody` 仍是權威物理位置；接觸矩形、怪物攻擊判定、技能目標搜尋、
  門與發包/journal不回填顯示座標。已建立的 world-space 投射物、命中點和傷害數字不改軌跡／判定。
- 生成、換場、同圖重入與非 local echo 的 server correction 建立新的同步端點；
  blur／隱藏時同步 previous=current，但不清 controller remainder、速度或 movement journal。
- 相機保留 float tracking，僅輸出一次整數 raster origin。背景、地圖、演員與滑鼠 world 換算沿用同一組 camera.x/y。
- 換場／同圖重入／server correction／手動回中重新初始化鏡頭兩組座標。
  art 晚到時只套新 bounds，不再二次回中造成 pop；固定模式也會接受新邊界。

## 真正可操作的鏡頭模式

遊戲上方選單標記「鏡頭模式（瀏覽器自訂）」。全部是明示的 browser presentation policies，
不是聲稱原版有四個相機選項。

| 選項 | 行為 |
| --- | --- |
| 平滑跟隨（預設） | 保留原 browser `.18 / 60Hz` 追蹤速度，依 elapsed 換算 gain；改追顯示點而非階梯物理點 |
| 直接置中 | 直接跟顯示點，不額外加 camera easing；仍受地圖邊界限制 |
| 區域跟隨 | 中央容許區外才捲動；半寬 `viewport/8`、半高 `viewport/6`，減少短距離走跳帶來的全場景上下晃動 |
| 固定鏡頭 | 保留當前相機位置；地圖重入或按「鏡頭回中」才重新對準角色，邊界仍有效 |

`client/camera.ts` 處理純幾何／追蹤；`camera-controls.ts` 處理 typed DOM 與單一 localStorage key
`kms111.cameraMode`。切換不傳 game packet、不寫玩家 save；拒絕／損壞的 storage 不阻擋使用。
下拉選單與縮放選單的鍵盤焦點屬於 UI，不能同時走路／攻擊；回中按鈕 Space／Enter 不漏成跳躍。
回中後焦點回到真正可 focus 的 canvas。選單保留 pointer-events:auto；上方工具列在窄畫面可換行。

## 本次實際驗證

- 根 strict TypeScript、Prettier TS/config 檢查、Bun browser build 通過；新增三個 production modules 全部是嚴格 TS，
  沒有 any／ts-ignore／關閉 strict。**main.js 與13支舊工具仍未遷完**，目前 client 共74支 TS。
- 新增15項純幾何／DOM／wiring回歸；含走路與跳躍30/60/120/144Hz、逐tick前後位置、繩梯／KB、
  signed rounding、顯示不變更 journal、reset、四模式、四邊／窄圖整數中心、late bounds、float residual、storage錯誤與焦點所有權。
- 真 Chromium 對 source 與 bundle 的實際 HTML：完成初始化與首幀、四個選項／title／可點樣式、
  保存後 reload、損壞偏好回預設、回中焦點。fixture只有 ephemeral HTTP；所有 WebSocket 全 mock，沒有遊戲服務或save。
  此兩檔 focused **19 pass / 0 fail**。
- 完整 suite **931 pass / 44 fail，975 tests / 106 files，168.25秒**。與 `38cdd2d` 的
  916/44 比對失敗檔名／標題／重複次數：**新增0／移除0**；既有44失敗仍阻擋全案驗收，不skip或放寬設定。
- 將 `38cdd2d` 原 motion.ts 與新版同輸入逐幀交叉：走／反向／煞車、跳落、斜坡、KB、繩梯 × 四種Hz，
  **20 scenarios／3540 frames／425個 encodeClientUserMove bytes 全同**（除新增 presentation-only previous 欄位）。
  比對純數值與封包，不連線／登入或寫角色資料。
- 原 LIVE 保持 PID6097；index200、兩個entry及72個module HTTP／MIME／parser通過；Chromium153.0.8010.0
  唯讀載入 ready／首幀、page errors=0、WebSocket attempts=0。沒有點擊／登入／操作角色／存檔／restart。

本機證據在 ignored `generated/motion-camera/{full-suite.log,authority-comparison.log,cross-check.log,comparison.json}`，
最終focused在 `generated/motion-camera/focused-final.log`；產物／baseline副本不進Git。
完整物理、未知／未完成邊界繼續見 [NATIVE_LOCOMOTION](NATIVE_LOCOMOTION.md)、[NATIVE_TERRAIN](NATIVE_TERRAIN.md)
與 [BUN_MIGRATION](BUN_MIGRATION.md)。
