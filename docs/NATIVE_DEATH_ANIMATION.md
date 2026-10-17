# 原版死亡演出、canvas 動畫與外力 move 接線

2026-10-18；接續 `855cebd`。**本輪沒有執行 test／check／typecheck／browser／VM／probe。**
本文件區分原檔證據、這次的實作，以及仍不等同原生 client 的部分；啟服不代表功能 PASS。

## 先更正前輪漏接

`MobArt.bodyAttack` 原本有從 WZ 讀取，卻沒有出現在 `/api/mob/<id>` 的 JSON。
瀏覽器又用 `data.bodyAttack === true` 才收進碰撞候選，因此會排除全部接觸怪物。
**這次才補齊 HTTP 序列化**，不是前輪已驗證的網頁功能。既有 bridge-only contact 回歸不足以抓到此漏接。
本輪加入 HTTP regression source，仍未執行。

## 1. 原檔交叉確認

所有地址均為本倉庫隨附版本，並非後期 Maple 規則。

| 原始來源 | 結論 | 本輪落點 |
|---|---|---|
| `MapleStory.exe.c/.lst` `509AF0`，另以 PE `objdump` 讀相同範圍 | 新死亡與已死初始化不是同一條演出 | `client/death.mjs` 的 settled lifecycle |
| `5084C0`／`509AF0` | 先前已死的人物進場直接取 land 最後 canvas；不重播新死亡音效／fall／fade | self field、user-enter 與 field.users 初始化 |
| `509AF0`，`Effect/Tomb.img` 原 props | fall 依原 delay 排到累積至少 800ms；接全部 land，一次播完持末格 | `server/src/game/deathart.ts`、`tombPose` |
| `509AF0`，Shape2D `10011030`（vtable +152） | Tomb 從捕獲位置上方 150px 落到死亡點，使用 fall queue 時長 | Tomb 位置插值，非另造上升／落地 easing |
| `509AF0`，Shape2D `10011E30`（vtable +168）、`10012070` | parent 繞轉周期 2000ms，不是直線速度或加速度 | 半徑 10 的 avatar origin orbit |
| Shape2D `1000E000`／`1000E250`；`10012060`／`10012070` | parent 角度矩陣、符號與取整 | death 點截整；cos/sin 偏移按 native 取整 |
| `509AF0` 的兩張 avatar layer alpha vector；PE 與 vector transform | 新死亡 2500ms 由 255 到 0；sprite 本身不自轉 | composite avatar 同步 fade，並明列未重建雙 layer 內部狀態 |
| `526CC0`／`5271F0` | `Game/Tombstone` 在新死亡時立即播放；計算的是音量，不是延遲到落地 | live transition 立即 spatial sound，remote 同樣；settled 靜音 |
| `509AF0` 的 layer z 設定 | Tomb layer 為 avatar 前 layer 的 z−1 | 加入 scene merge，不在畫面最末一律蓋上 |
| `46A9F0`，Gr2D `10015290`／`100167C0` | 插入 canvas 的 delay/a0/a1；缺省 −1 保留 alpha，a1 可排到截止時間 | 共用 `animation.mjs` 與 WZ canvas metadata reader |
| `4A3920` `delay` 分支，`Map/MapHelper.img/portal/game/pv` | 缺省 **120ms**，不是既有硬寫的 100ms | 原 8 格合計 960ms；field clock 起播 |
| `537B00`→`495D60`，`495620`／`4953A0`，`4967C0`／`485330` | attr=2 是 staged external force；attr=1 另用於 stale record。不是 remote hurt event | browser→bridge→session→原 0x0E／0x22 保留 attr2 |
| `563010` 的 ladderRope 1..count 載入、`485400` 的 signed lookup | ladder id 與普通 foothold 不同；climbing move 送負 ladder id | publisher 不再一直送 0 |

### WZ 原資料（靜態 dump，不是程式驗證）

- `Effect/Tomb.img/fall` 有 12 格，各 80ms。原 queue 到至少 800ms，所以排 fall/0..9，**不是把 12 格全部播完**。
- `land/0..7` delay 為 100,100,100,150,150,150,150,150，共 1050ms；最後圖 `origin=(20,43)`。
- fall 800ms 完成時開始 land/0；1850ms 起持 land/7。settled 進場直接 land/7。
- ghost parent 在死亡捕獲點 `(x,y−5)`，child 初始 `(-10,0)`；2000ms 一圈。
  新死亡 fade 2500ms，settled 不淡出。這不是讓整張 sprite 旋轉。
- `Map/Obj/acc1.img/grassySoil/nature/25/{0,1}`：delay 各 3000，alpha 0→255／255→0。
  nature/26 各 2100；space/22 各 3500；darkWood/artificiality/4 各 2000。
  這些是原資料已含的淡入淡出，不能以「缺素材」或每格固定 alpha 1 取代。
- `Map/MapHelper.img/portal/game/pv/0..7` 均未附 delay，故使用 `4A3920` 的 120ms 缺省。

## 2. 實作與接線

### Canvas metadata／播放

- 共用 `frameProperty` 讀 canvas.props 或 property node.props；不可再只找 node.props，漏掉真正 canvas 的欄位。
- resolved/UOL canvas、數字子 frame、plain canvas 均共用 delay／alpha 讀取；沒有捏造 PNG。
- `animationFrame` 統一 loop／one-shot、保留跨格及跨 loop 的 alpha。
  one-shot 到終點持末格及精確終點 alpha，不用 `duration−1` 近似。
- map object、portal、NPC 初始動畫改採本次 field 的 clock，不用頁面開啟以來的全域 performance 相位。
  這是 browser 以 map 資料到達時刻建立的起點，不宣稱和原 Gr2D clock 逐 bit 相同。
- 地圖與 art 請求有 generation guard，包含同圖 revive／重進，避免舊 response 蓋回新 field。

### 死亡生命週期

- 本機以 authoritative HP 轉為 0 的事件捕獲位置；遠端以原 move action 18|facing 判斷。
- 新死 sound 一次，後續 stat／重複 move 不重啟；先前已死的 field.users／user-enter 不誤播 fall。
- dead 優先於舊 swing；等待 attack art 的遠端 callback 不再把死亡角色改回 swing。
- field／login／disconnect／實際 WebSocket close 清除 state；user-leave 清除該人的 Tomb。
  metadata／PNG 可以沿用 cache，但不讓上一個人物的生命週期沿用。
- Tomb 加入既有原 z-space scene；既有原 Notice 復活窗與 kind0→field 回覆不被工具替換。
- 顯示素材還在傳輸時，時間仍按事件時刻前進，不在 PNG 到達時假裝重新死亡。

### 外力 move／方向

- pending 外力實際消耗後保留 `moveAttr|2`，直到 publisher 已送入開啟的 WebSocket 才清零。
  這不是 server ack，不能稱保證伺服器已接受。
- bridge 限制 attr 為 0／2，action byte、整數與座標／速度 signed16、foothold 合法 word 範圍，避免任意 bits／小數截斷。
- 原 action 的低 bit 決定 facing，不以位移方向翻臉；被擊退往右移動不代表人物應面向右。
- zero-duration record 立即消耗，不把原 0ms 延成 100ms。
- 沒有捏造 remote hurt／hit-face 廣播；attr2 本身不代表傷害數字／表情／tint。

## 3. 方便實際操作：明示的 1HP 入口

1. 原登入／世界／建立角色後，開上方 **「體驗工具（非原版）」**，也可 `/tools`。
2. 用既有「獵場 · 40000」或地圖搜尋移動；工具不暫停怪物。
3. 勾選明確同意後按 **「HP設為1（碰怪看死亡演出）」**。
   僅把活角色 HP 設 1，不改 MP／裝備／道具／位置、不直接判死；自然恢復可能先把 HP 回起。
4. 被怪物接觸後可看擊退／死亡／墓碑，約 2.2 秒後原 Notice 的 OK／Enter 走既有復活。
   dead 不能用 1HP 工具繞過復活窗。
5. `demo:demo` 可另開第二個頁面建立另一人物並前往同圖，方便觀察 remote movement／death。
   這是操作入口說明，不是本輪已操作成功的驗證紀錄。

工具仍由帳號授權、default-off、confirmed 才修改；不自動改寫任何既有角色。
checkpoint 不回收已領／已用的道具，不回溯 EXP／金錢／地圖。

## 4. 本輪 LIVE：新的獨立進度

本輪開始時 workspace 未含前輪 ignored save／舊 LIVE 程序。
本次使用全新 `generated/preview-death-20261018.json`（相對 repository 根目錄），**不是恢復或替代舊進度**。
新帳號 `preview:preview`／`demo:demo` 尚無預造角色，由使用者在建立介面操作；實際變更後才寫入 save。
不把 save／資料 dump／啟服 log 提交至 Git。

從 repository 根目錄啟動：

```sh
node server/src/cli.ts serve --host 0.0.0.0 --port 8516 --game-port 8517 --web-port 8515 \
  --data Data.wz --save generated/preview-death-20261018.json \
  --account preview:preview,demo:demo --map-command preview,demo --test-tools preview,demo --ping off
```

本輪已用此命令啟動：web 8515、native login 8516／game 8517 均監聽 0.0.0.0。
僅收到程序啟動日誌與監聽狀態；未自動登入／建角，也沒有執行功能探測或回歸。
使用 Arena 的 **8515 LIVE PREVIEW**，不要把日誌中的 sandbox loopback 位址當作自己瀏覽器的網址。

## 5. 回歸來源與未完成範圍

新增但**未執行**：

- `server/test/native-death-animation.test.ts`：Tomb 時界、orbit/fade、settled、生命週期、alpha 繼承、0ms record、反向位移 facing、外力 marker、原 WZ delay／origin／portal／alpha。
- `server/test/webclient.test.ts`：HTTP bodyAttack／death metadata；雙 session attr2 原協定 relay；非法 bits／小數拒絕。
- `server/test/testtools.test.ts`：1HP confirmation、plan 不直接改角色、保留 MP、dead 拒絕。

仍不宣稱：

- 完整 CShape2D／CVecCtrl、原 30ms accumulator／append／merge／stale queue、double/x87 逐步一致。
  browser 仍為現有 8ms physics＋100ms snapshot＋remote linear playback；不是全原生同步。
- 兩張 Gr2D layer 的全部內部狀態、所有 face/emotion frame、原 Dotum metrics／全 UI 逐像素一致。
  本輪用既有 composite avatar 做 orbit／fade，未重建全部 Gr2D 物件圖。
- 4734A0 環境傷害、怪物主動攻擊／魔法、玩家 active skill／magic、所有其他 passive/buff。
- 快捷鍵拖放、自然 AP/SP／原轉職、卷軸、cash/pet、完整交易 UI、自由拆疊。
- 新增回歸來源不是 PASS；歷史測試紀錄不為本輪接線背書。
