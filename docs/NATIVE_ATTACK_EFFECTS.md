# 攻擊殘影、命中特效與時序整鏈（2026-10-18；未測試）

本輪對使用者「攻擊的特效等，看起來和原版有出入」的續作。依指示，**沒有執行 test、check、typecheck、語法檢查、browser、VM 或 probe**；新增／修訂的回歸來源不代表通過。資料來自本 repo 的 `MapleStory.exe.c/.lst/.exe` 與 `Data.wz`，不是其他年代客戶端。啟服不視為測試成功。

## 1. 原證與先前錯誤的明確更正

| 原位置 | 交叉確認 | 實作 |
|---|---|---|
| 40A5E0 | stance 下 `lt/rb` 是矩形；枚舉的**第一個 Property 子節點**才承載一條 canvas 序列 | 不再把該節點名稱當 body frame。實際 swordOL tiers 0/1/5/10 的 swingO1 首節點均為 `2`，其中才有 `0` 等圖片 |
| 40EA70／listing 40EC5B–40ECA8 | 前 N−1 張 30ms，末張 200ms，a0=-1；中間 a1=-1，末張 a1=0 | 覆蓋通用 reader 的 delay／alpha，獨立 release 時鐘；不是逐 body frame 附件，也不是直接用 WZ delay |
| 5095A0、50B590 | deadline、方向、動作、素材與武器聲一起排程；raw release 是 scaled raw delays 除末幀之外的總和 | 本機／旁觀者／預覽共用獨立序列；武器 Attack 聲不在按鍵當下播放。body 收尾不清殘影，新一輪到期才換掉舊 layer |
| 507A20／40EA70 | 真殘影是 `user+380 = this[95]`，createLayer child z **5**，overlay main `+376`，origin controller | **撤回 ADR-057／舊圖層文件「user+368 child1 是 afterimage」判讀**。現在 body back、body front 畫完才畫殘影，名字在其後；仍與 avatar 主層一起排序 |
| 4BE270、50DAA0／50DD40 | 熟練度 passive 的 WZ `mastery`，不是已學 skill level；近身 mode0、射擊 mode1 | 瀏覽器、WS bridge、TCP admission、傷害公式與 relay 共用技能對應。保留 native s2c afterimage byte，不再固定 0 |
| 50D7F0、50D9F0 | 技能 hit 路徑優先；物理沒有技能路徑時才用原武器火花。魔法不是普通物理 fallback | `sword1/2/F`、`mace1/2/F` 真素材；不是 `blunt`，也沒有 `sword0`。技能宣告了路徑但無圖，不以武器圖掩蓋 |
| 485B80、4882F0、487A30 | 選取點→存 point−mobPosition→deadline 加當前 mobPosition→clamp 當前 RECT→建立獨立 world layer | 命中前隨怪物位移修正，播出後凍結 world point；已建立的圖不因怪物離場立即消失。damage>0 才有命中火花，flip 為 `!facingLeft` |
| 41F8A0 | root raw z `-1073471524`，現有世界排序轉為 **250310**；controller vector 只是 origin | cast／hit／damage 各項獨立排序，同 z 按建立順序，不再把 cast 塞 actor 中間或把所有 hit 集中畫在世界最後 |
| 50C460 | 1001003／2001003 是白色 avatar snapshot 特殊分支；雖 createLayer 最初 z0，後續 vtable+188 **明確 put_z(-1073471524)** | Armor flash 也在 250310；不是看見 createLayer z0 就留在地面層。既有 400ms／放大 snapshot 路徑保留，不冒稱完整 native raster/blend |
| 514D30、50DD40 | 條件式 5095A0 要上游回傳非空 afterimage；不能據「有 call」就讓所有魔法拿武器殘影 | 兩招已開放魔法仍走原技能 effect／ball／hit，不補普通武器殘影或物理火花 |

### 熟練度對應的意義

近身 weapon type 30/40 依序取 1100000、1200000 第一個非零；31/41→1100001、32/42→1200001、33→4200000、43→1300000、44→1300001。射擊 45→3100000、46→3200000、47→4100000，其他為 0。先 cap 已學 level，再取 WZ mastery，沿既有 native 公式 clamp 0..15；本檔案殘影 tiers 為 0..10。缺 tier 不偷退 tier0 圖／矩形。射擊 near 距離另依原分支取 **tier0 第一個近身矩形**，不能拿射手 mastery 的近身矩形代替。

物理 spark family：30/31/33/40/41/43/44 用 sword；32/37/38/42/45/46/47 用 mace。action 8/12/15/18/21/27/30 取 F，其他在 1/2 間選。50D7F0 本身呼叫亂數，所以**每次呼叫（每目標／段）選取**，不是整次攻擊強制共用一個變體；本輪有重新讀上游多段迴圈確認，未把錯誤假設寫成規則。

## 2. 本機、旁觀者與伺服器連動

- `attack-presentation.mjs/.d.mts`：統一 metadata tier、熟練度對應、獨立序列、world RECT、485B80 中點、impact clamp 與原 spark 名稱。
- `basicattack.ts`：各 tier 原矩形／首 Property 序列、各被動 level→mastery、六種 hit art；舊 `effects` 欄為空相容槽，沒有第二條錯誤 body-frame 播放路徑。
- body 仍走原本每幀 30ms 量化；殘影用 raw release 後的 30/200ms 獨立一次性動畫。`weaponEffects` 的 current／pending 分開檢查 look，離場／換場／死亡清理，不因 body 動作結束消失。
- Local 及 remote 每個目標捕捉原取樣點與 offset；飛彈 endpoint、預測 travel、JSON target x/y 共用這個點。`projectileLeg` 只在沒有 point 的 legacy 呼叫保留 root−20，相容而非宣稱原版定位。
- 普通近身也等 release 才結算，不再攻擊按下就跳數字／死亡；WS 普通攻擊也有 token，回覆必須對應當次目標實例，不能讓上一刀的延遲回覆附到下一刀。
- TCP basic melee 使用既有逐 hit queue；relay／彈藥扣除一次，release 時才扣怪血／EXP／drop。這是重建 server 的結算政策，不是找到了原 server 行為。
- WS bridge、TCP ranged 的 travel 改用 wire point；防護用 point 距怪根的現有重建 ranged target slop（水平65px／垂直100px）與玩家方向／範圍 admission，這是 server 政策，不冒稱 CShape2D。
- 命中火花與傷害數字在 impact 時保留各自建立序號；cast 在 await 素材前保留序號，冷載入完成次序不改圖層。已過期 art 不補播、不從頭重新計時。
- 武器音效預載、decode 前後 deadline／field epoch／look／實例身分檢查；旁觀者離場後不遲到補播。只預暖 tier0 和實際選用 tier，不把全武器所有 tier PNG 一次塞進下載佇列。
- 角色預覽與遊戲相同殘影時鐘／前後順序，body 結束回 stand，預覽循環依 body／殘影較晚結束再留間隔；沒有另造假附件動畫。帳號／存檔不自動改裝、升級或送裝。

資源常數另行區分：128 個效果／殘影記錄上限、武器聲至少200ms的冷載入截止窗、怪物受傷／死亡聲1000ms截止窗、預覽循環留200ms間隔，都是瀏覽器資源／可視化政策；不可把它們與 40EA70 末幀200ms 的原碼常數混為一談。

## 3. 邊界（不得宣稱完全 1:1）

本輪沒有完整移植 CShape2D pool／逐幀形狀、原全域 30ms phase、所有飛彈追蹤分支、所有技能／passive UI、native COM overlay／GDI blend、完整命中與反作弊系統。取樣仍用實際當前怪物 canvas RECT，沒有用缺素材假圖遮掩 parser。場景中的文字／像素字型與特殊閃光 blend 亦有已明示邊界；基本命中亂數是瀏覽器亂數，不是重播原 client RNG stream。

## 4. 整理與交付

回歸**來源**：`native-attack-effects.test.ts`（獨立時鐘／alpha、真 WZ tier 與首 Property、熟練度、反向 RECT／負座標中點、impact clamp／凍結、六種火花、wire tier、projectile endpoint、audio decode 取消及 wiring），以及更新 combat-assets／layer-priority／jump-background-attack 來源。全部未執行，未宣稱 PASS。

保存同一份 `generated/preview-faces-20261018.json`，停服後冷備 `generated/backups/preview-faces-before-attack-effects-20261018-055721.json`。完成以同 save、preview／observer 帳號及既有工具權限啟服；不回滾、不重建角色。原證與常數來歷集中在本文件及 ADR-074。
