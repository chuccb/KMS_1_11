# 原版跳躍怪、攻擊組圖與移動雲層

2026-10-18。**已實作，未執行 test/check/typecheck/browser/VM/probe；不是功能 PASS。**
依使用者要求，一輪處理資料／控制器／封包／畫面與相關生命週期，不以畫面假跳取代移動。
原 `MapleStory.exe`、反編譯 C／listing、`Shape2D.dll.c`、`Data.wz` 未改寫。

> 後續ADR-057（未測試）：雙面avatar／殘影中層、一般裝備slot遮擋、空中root深度、背景index z、
> remote cold-art guard等已補。見 [NATIVE_LAYER_PRIORITY.md](NATIVE_LAYER_PRIORITY.md)；本文件保留前輪紀錄。

## 原始證據與更正

| 來源 | 判讀 | 本輪接線 |
| --- | --- | --- |
| 48D080 | 移動能力依 **動作子樹**：fly→3；jump+move→2；move→1；皆無→0。jump 無 move 則模板載入失敗 | template 保留 moveAbility，不把 info.jump 當跳躍能力；不再讓靜止／飛行類走地面巡邏 |
| 53D920／53D980／53DAA0 | ability 1／2 分流。無追擊目標、在地面且決策到期，能力2先 `rand()%5==0`→5378D0，跳後不重設決策 timer；否則原 idle/walk 抽籤 | 世界 roam 增加起跳判斷；既有 deterministic patrol 仍僅作 fixture 政策 |
| 485960／5378D0／5382F0／53D3F0 | mob shoe 的 walk 百分比來自模板；普通 jump 係數1。地面起跳 -555，移動起跳至少80%步速、上限步速；站立起跳 drift×0.5。重力2000、終速670；最多30ms分步 | ordinary air path 使用共用 swept foothold／wall geometry，以最多30ms規劃，不是 RAF sine wave |
| 48D080 `info.link`；40AE20 | 模板以 `Mob/%s.img` 取 action 樹，原 info 仍供 HP／速度等；圖片載入的 link 以 `_wtoi` 遞迴 | ability／dieMs 取 action image；sprite action 路徑沿 link 解析，原 bodyAttack 不被來源怪覆蓋；畸形循環／過深拒絕 |
| body `swingO1/1,2/arm`、`swingO2/0,1/arm`、`stabO1/1/arm` | 同一個 arm part 的 z 會變成 armOverHair／armBelowHead | 不以 rank==arm 辨識手臂；保留原 z 排序，從實際 arm part 發布 hand anchor |
| 427F60／427FE0、508700 | 原武器動作表；攻速 clamp0..6，每格 `trunc(delay*(speed+5)/8)` | **不任意改攻速／姿勢**；保留 WZ delays、稀疏 afterimage 與左右鏡像 |
| 512F90→427F60 | normal weapon group 不在1..7時 selector=-1，攻擊返回0 | 移除無武器的假480ms三種單手劍 fallback；browser bridge 不把未知 action 偷換成第一個動作 |
| **508FC0** | movement `y>>1` 先映射到 body action；walk1／stand1／jump／ladder／rope 的 movement base 是2／4／6／14／16，不是 body action id×2 | 修正原先錯送0／4／70／72／74；本機發送、遠端解讀、繩梯深度一起修，mob hit1=14不誤當角色攀爬 |
| 427BF0／40D950 | stand1、stand2、alert 的 flag1 把 N 格擴為 2N−2；原3格待機是0→1→2→1 | 修正直接0→1→2→0的跳格；walk仍四格、繩梯仍按原條件凍結 |
| **46BDA0**、46D220 | 背景 loader；46A9F0 是物件 loader，先前 drawBack 註解引錯函式 | 更正來源；保留 Map/Back/bS.img/back/no 與原 origin／alpha／front／flip／cx/cy |
| 46BDA0 type4；Shape2D 10010AD0／10010C40 | type4 水平100px相對移動，時間 abs(trunc(20000/rx))ms。rx>0 向左，rx<0 向右；flag0x10000000持續累加，**不是 ping-pong**。x camera ratio=0，y ratio=ry，水平重複 | 用 field clock 計算位移；front/back 同一時鐘；rx=0 靜止，不除零 |
| 46D220 | 其他非零 type 由低位 bit1／bit2 決定橫／縱重複 | **不移植後期4～7自動捲動表**；5是水平、6是垂直、7雙向，4另有原版特殊分支 |

### 實際 Data.wz 交叉資料

- 跳躍橘菇是 **Mob/1210102.img（주황버섯）**，有 move／stand／jump；jump/0 為62×64、origin(28,64)。
  `Mob/0120100.img` 是 **스포아**，不能拿它沒有 jump 的資料判定所有蘑菇不會跳。
- `Map/Map/104040000.img`（헤네시스사냥터）有1210102出生點；`back/1` 是
  `Map/Back/grassySoil.img/back/1`，x=-16、y=-184、rx=-5、ry=-5、type4。
  此層是每4000ms向右100px，即25px/s；角色不動仍應移動，鏡頭水平移動不是它的 x 驅動。
- body swingO1 delays=300/150/350，stabO1=350/450；不是統一160ms。
  原起始劍1302000 speed2的每格比例為7/8。
- 注意：**起始劍1302000的 swingO1 圖是 navel 錨點**，不是所有武器都走 hand。
  本輪手臂修正補的是實際 hand 發布漏洞，不能說它單獨證明每把武器、每個姿勢已完全一致。

## 實作與生命週期

### 怪物不是只改圖片高度

- `client/mobmotion.mjs` 是共用的 ordinary air 規劃器，**由 server 執行**；瀏覽器不另跑怪物 AI。
  共用 `motion.mjs` 的 ground／air swept geometry，新增 mob 分步入口，不把玩家的80%最低速度套給慢怪。
- `game/mobs.ts` 規劃有 vx／vy／action／duration 的0x33路徑；跳躍 wire action 是 **mob 2<<1**，不是玩家 movement jump6。
- 空中段 foothold=0；落地是末端0ms正foothold記錄。若把正foothold寫在整段下降上，browser原投影邏輯會把跳躍壓回地上。
- browser 按當前 wire action 選 jump／move／stand，並容許 fly 圖片；hit／die 仍優先。
- server combat、死亡、掉落位置取同一條 sampled path，不預先把怪物放到將來落點。
- resumePackets 保留剩餘 duration、跳躍 action、速度及0ms落地，不再硬編 move；長落下按 horizon續接，不在空中重抽起跳。
- 落地後重新取落點 foothold chain 與原 spawn rx 範圍；死亡停路徑，重生清空空中速度／決策並回原出生點與範圍。

### movement state 與 body action 不能共用表

追查攻擊後的姿勢分流時，508FC0明確揭露原先混表：movement case3 才映射到 body action35（jump），
case7／8才映射36／37（ladder／rope）。先前直接將 body action35／36／37加倍為70／72／74送出，是錯的。
本機現在發2／4／6／14／16／18加facing，遠端按同表解讀；0依原default仍顯walk1。
actorDepth只對user/self解14／16，不把mob hit1的同值當繩梯。既有dead18並未改動。
這是修協定狀態接線，不是宣稱整套原physics已移植；較早文件中的70／72／74說法以本節為準。

### 攻擊畫面與載入

- 原 z 決定繪製順序，不決定 part 身份；armOverHair／armBelowHead 不改回 arm 掩蓋錯誤。
- 本機起攻前等待所選動作的每張 composed PNG 和 afterimage decode，再開始原 WZ 時鐘，避免冷載入跳回站姿。
  冷 emote／hit 臉可暫用**同一個攻擊 body frame**的 neutral 臉，不拿 stand frame 替代。
- 圖像失敗可重取；active avatar frame 做 LRU，URL版號更新以避開舊 hand 組圖快取。
- 等待中再次確認角色／地圖／look／存活／面板／朝向／彈藥；正常 HP／MP self 更新不再只因 object clone 取消合法攻擊；返回待機時重置其動畫而非接回攻擊前的半截。
  命中目標也重新讀當前位置。過期 swing 不再把下一格 idle 的朝向固定為舊方向。
- 原有地面攻擊輸入鎖、空中動量、攻速整除、原攻擊／飛彈／音效時序保留；沒有提高最低傷害。

### 背景與其他漏接

- `background.mjs` 集中原版 type4 位移／其他 type bit 重複；`main.js` 前後背景都帶 field clock。
- 以 canvas footprint 而非 anchor 正規化重複，避免大 origin 留空；時間相位不隨圖片完成載入或每次 draw 重置。
- 上輪漏掉的聊天輸入 maxlength120→原70；DOM UTF-16長度仍不冒稱原CP949／字型逐位元組行為。
- 原體驗面板新增 **「跳躍怪／雲層 ·104040000」** 明示非原版捷徑。只在既有工具與 map-command 授權可用，
  點擊才沿既有 warp-map／原地圖命令移圖；不送裝備、不建角色、不自動改存檔。

## 尚未完成，不能據此聲稱1:1

- 這是原無目標 roam 的 ordinary jumping 分支，**不是完整原 CVecCtrlMob／aggro**。
  原追擊的距離／平台判斷、所有邊界跳旗／轉向，以及飛行／水中／特殊技能 AI 尚未完整移植。
  ability3不再假裝地面巡邏，但未新增任意飛行 AI。
- 使用原普通常數與最多30ms規劃，不等於全世界30ms同步或完整原 fixed-point／CShape2D。
  browser仍線性取樣 wire path；自訂 field/shoe physics、長落下越界回收等未全還原。
- 所有帽子遮髮／islot-vslot、技能施放、effect z／混色與全姿勢／全裝備逐像素一致，仍不可宣稱完成。
  原字體、DOM聊天、選擇畫面等既有界線仍有效。
- bridge 嚴格要求真 action 不是完成 TCP 全攻擊防作弊；不改既有原TCP的信任契約。
- 所有舊 PASS 都不是本輪驗證。新增 `server/test/native-jump-background-attack.test.ts` 僅保存回歸來源，
  涵蓋能力／air／落地／wire／late join／死亡重生／原WZ／hand identity／idle ping-pong／背景／bridge接線，**未執行**。

## 交付／存檔

沿用 `generated/preview-death-20261018.json` 的現有帳號／角色；停服後先冷備份，再用相同save與權限重啟。
不 seed、不自動修裝備、不回復或覆寫使用者在本輪前的進度。實際備份／啟服記錄在本文末追加；啟服不是功能驗證。

### 實際交付記錄

- 已停止舊 LIVE `kms-1-11-d63b9673`，再以 `cp -p` 冷備份至
  `generated/backups/preview-death-before-jump-attack-cloud-20261017-232306.json`（檔名為沙箱UTC時間）。
- 原save與冷備份 SHA256 都是
  `3c8736ada1c2b23fb8142d618fcc39972a74e0343e2ea7fb526c9fa7d8dc8c64`。
- 相同serve參數／同save重啟：`kms-1-11-1ec1eb7b`，PID7158；web8515／login8516／game8517，綁0.0.0.0。
  啟動讀到 **2帳號、1角色**，沒有用CLI帳號重新seed，沒有自動修復、移圖或回補進度；preview工具權限維持原設定。
- 以上只記錄停服／備份／啟服；使用者先前遊玩的舊log不是本輪功能PASS。
  未執行任何test/check/typecheck/browser/VM/probe。只做原檔資料讀取、人工讀碼及git diff --check空白檢查。
