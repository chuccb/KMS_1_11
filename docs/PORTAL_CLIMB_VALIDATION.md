# 傳送門／繩頂登台／地圖命令驗證（2026-10-17）

> 後續狀態更正：本文件的驗證／未完成清單為當輪歷史。HP／MP自然成長與配點已由原表接上（**新改動未測試**），舊「成長表不在client」判讀已更正；自然AP/SP發放、完整Detail／buff仍缺。見 [STAT_GROWTH.md](STAT_GROWTH.md)／ADR-047。

## 原版證據與修正

### 繩頂不是 y1−1

`MapleStory.exe.c` 的 `sub_542DF0`：原攀爬更新每 30ms 移動 3px。
向上越過 y1：uf!=0 設 y=y1−5 並離繩；uf=0 則停在 y1、保持攀爬。
向下越過 y2：設 y=y2+1 並離繩。

真 `Map/Map/001000000.img` 的八條繩索，其上平台全部是 **y1−2**：

| 繩 id | x | y1 | 上平台 foothold | 平台 y |
|---|---:|---:|---:|---:|
| 1 | 2528 | 37 | 263 | 35 |
| 2 | 3148 | -503 | 241 | -505 |
| 3 | 718 | 97 | 277 | 95 |
| 4 | 898 | 37 | 272 | 35 |
| 5 | 1085 | -23 | 256 | -25 |
| 6 | 1167 | -23 | 257 | -25 |
| 7 | 3064 | -83 | 250 | -85 |
| 8 | 3001 | -83 | 253 | -85 |

舊瀏覽器設 y1−1，腳已在平台以下，`floorBelow` 不可能找到上平台。
改為原版 −5，再交回既有 swept gravity 落地；**不放大 snap，也不新增永久禁止重抓的假狀態**。
仍使用瀏覽器既有 8ms fixed step，並非聲稱原 client 的所有 update 時序都已逐指令移植。

### 門的類型／觸發／落點

- `sub_4A3920`：pt=3 放自動陣列，其餘（包括 pt=0）放一般陣列，維持 WZ 列舉順序。
- `sub_5124C0`／`sub_4A47D0`：每次 user update 自動檢查 pt=3；x/y 各 ±50。
- `sub_512510`／`sub_4A4740`：必須 grounded、按 ↑；一般陣列找 pt!=0，x±20、y±50。
- 反向搜尋；RECT 左／上 inclusive，右／下 exclusive。pt=1 是隱藏**手動**門，不是自動門。
- `tm=999999999` 無目的地；**tm=0 是有效地圖**，不能當 sentinel。pt=0 不可啟動。
- `sub_472590` sender gate 為 500ms；空 s2c `0x19` 解除 pending，拒絕也必須回應。
- **`sub_511820` 已定位 CharacterStats+101**：索引一般（non-pt3）陣列，初始化 x=portal.x、y=portal.y−10。
  不是 `0x16` 的 mode。保留 wire/save 欄名 `unknown101` 避免破壞舊存檔；`SelfView.spawnPortal` 帶給瀏覽器。
- 伺服器用來源門的 `tn` 找目的門在 non-pt3 陣列的索引，寫進 `0x16`、角色紀錄及保存；
  server remote spawn 與 browser local spawn 使用相同座標。相同地圖的傳送也重建 field。
- 地圖 0 的角色重連保留 0；只有不提供 map 0 的 archive-free/tooling provider 沿用舊的 default-map 相容行為。

實作位於 `client/{motion,portals,main}.mjs/js`、`game/{map,world}.ts`、`net/loginserver.ts`、ClientSession／Web bridge。
另修正聊天 Enter 的事件冒泡：送出／blur 後不能被全域 Enter 捷徑再次 focus，否則命令後按方向鍵不會走。

## 地圖命令與權限

```sh
# 正常預設一律禁止地圖命令；明確允許個別帳號：
node src/cli.ts serve ... --map-command admin,alt
# off：任何帳號都禁止；all：僅適合私人開發環境。
```

- `/map ID`，別名 `/warp ID`、`/go ID`、`/헉맵 ID`：仍走原 c2s 0x0D `[s32 mapId][empty string]`。
- `/maps [ID/名稱關鍵字]`：只讀 `/api/maps`，列真 Data.wz 的 100 張地圖，最多一次顯示 20 筆。
- `/where`：目前地圖及角色座標；`/help`：命令與傳送門操作。
- 授權在 **GameEntryServer** 檢查 account username，不是只藏前端按鈕；直接偽造原 TCP 封包也不能越權。
  這是明示的 operator policy，不冒稱已還原原伺服器 GM rank／權限表，也不改角色的 GM byte。
- ID 必須為非負安全整數、在 s32 範圍且非 999999999；找不到地圖則停在原圖並顯示訊息。
- 原協定的 kind=0 與 revive 重疊：僅**獲授權且活著**時視為 map-zero GM 命令；死亡時仍維持原復活處理。
  瀏覽器／ClientSession 要求先復活再用地圖命令，不創造私有 opcode。

## 自動驗證結果

- `cd server && npm run check`：**561/561 通過，strict TypeScript 通過**。
- `node --test server/scripts/{motion,portal}_probe.mjs`：**30/30 通過**；包含八條真繩 × 30/60/144Hz、
  uf=false、native −5 出口、不立即 snap、持續 ↑／放開保持登台、手動／自動門的 RECT 邊界及搜尋順序。
- 真 TCP：0x19→0x16、`tn` 索引排除 type 3、remote x/y−10、map-zero 保存紀錄重入、
  普通帳號偽造 GM 封包遭拒、授權者 kind=0 正確進 map 0。
- 真 WebSocket→TCP：前後門各自 tn（非 sp）、預設拒絕／帳號 allowlist、invalid ID／不存在地圖不破壞原 field。
- VM：原有 Stat/AP、選角／建刪角、商店全部保留，另含命令驗證與 chat Enter stopPropagation。

### Chromium（隔離 save，不使用正式角色）

環境同 `browser_motion_probe.mjs` 的 PLAYWRIGHT_MODULE／CHROMIUM_EXECUTABLE。

1. `BROWSER_ACCOUNT=climb BROWSER_PASSWORD=climb node server/scripts/browser_motion_probe.mjs 8595 --climb`
   - 真走路／跳過地形到 x718，抓繩→爬→停→爬到頂。
   - 持續 ↑ 2 秒，再放開 1.5 秒：**x718,y95,fh277,vy0**；PNG `generated/validation/map-rope-top-fixed.png`。
   - 保留原 BGM／音效解碼播放檢查；JS errors=[]。
2. `node server/scripts/browser_portal_probe.mjs 8595`
   - 真走到 Amherst west00，↑：1000000→50000，目的 east00 **x3041**，不是 sp 的 −183。
   - ↑ 返回 Amherst west00（index3）；/map1000001 後走到 out00，↑ 到 Amherst **in00(index1,x−52,y−385)**。
   - 停在隱形門超過 guard 不會自動回去；↑ 才回 1000001/out00(index5)。
   - `/map 0`→x−206；/where、/maps 두갈래길、/help；不存在 ID 留在原圖；/go 返回1000000。
3. `node server/scripts/browser_portal_probe.mjs 8595 --auto`
   - 隔離 AutoHero **事先建立**於 105040200、spawn byte9（真 west00 的正常入場位置）。
   - 用正常按鍵走到 x985、↓+Alt 下跳穿過真 type3門；沒有按 ↑、沒有 runtime 位置注入。
   - 自動到 105040100/east01，**index16,x900,y−1095**；恰好送出一次 portal east00。

以上 Chromium 三條流程均 PASS，JS errors=[]、橋接 error events=[]。
本機詳細 logs：`/tmp/portal-full-check-final.log`、`/tmp/portal-motion-final.log`、
`/tmp/browser-portal-{rope-top,roundtrip,auto}.log`；logs 是暫存，不作必備測試資料。

Data.wz 未修改，SHA256 `286abe74f4335ebfde3164fa8f55e195e926a6cf5165646796b3c2fba3962d0f`。

## 尚未宣稱完成

- 這不是原 Windows client 的動態 oracle 流量／逐像素全遊戲比對；本輪是反編譯證據＋原資料＋重建客戶端回歸。
- 滑鼠點門保留為瀏覽器便利功能，不當成原版唯一操作；伺服器還不是完整反作弊位置權威，
  原伺服器的等級／任務／道具門條件沒有憑空補上。
- 無效舊 spawn byte／缺失 tn 以 sp 恢復，是容錯政策；不冒稱等同 native 超界索引的 (0,−10)。
- 自然升級 AP/SP／HPMP 成長、HPMP AP、Detail／裝備 buff 合計、頻道／分流等仍有未完成部分；不套後期公式。

## 預覽部署

正式預覽 8495／登入8496／遊戲8497 已重啟載入本輪程式，沿用 `/tmp/kms111-save.json`；
CLI 明確開放 `--map-command admin,alt,newbie`。正式角色沒有作測試fixture，重啟前後 save SHA256一致。
隔離 8595／8596／8597 QA 已停止。正式 `/healthz`、main／motion／portals模組、map0／1000000 geometry
與100張 map catalog 皆 HTTP200；這些部署後檢查不登入／不改正式角色。
