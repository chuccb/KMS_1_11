# 怪物 KB 控制鏈、NPC 氣泡／名牌與方向（2026-10-18）

後續補完：[ADR-076／怪物主動攻擊](NATIVE_MOB_ATTACKS.md) 已接 attack10..12 的 body/facing保護與真KB並存，
並以明示browser-only sideband續晚進場body相位；下文「尚未模型化」是ADR-075當時界線。完整owner狀態機仍未還原。

**狀態：已編輯實作與回歸來源；依使用者指示，未執行 test／check／typecheck／語法檢查／browser／VM／HTTP／登入 probe。啟服不代表 PASS。**

回報：怪物 KB 中仍繼續動、NPC 自言自語時名牌消失、部分 NPC 方向疑似顛倒。本輪讀本 repo EXE C、listing、WZ metadata，不借後版行為或假圖補素材。

## 一、怪物：不是每個正傷害都應播放 hit1

### 原證

- **48D080**：`info.pushed` 缺省為 **1**，寫入 template+72。這是每一段傷害能否觸發 KB 的門檻，不是移動距離、機率或整刀傷害總和。
- **512F90**（C 約278901）、remote 對應迴圈：每個目標先選 `rand()%hitActionCount+7`，沒有 hit action 為 **−1**。7/8/9 是 **hit1／hit2／hitF**，不是 hit3。當次目標各段沿用該 action，不能把 default0（move）當受傷動作。
- **487A30**：正傷害、damage>=pushed、當前沒有 active hit window、local attacker 與可反應狀態（−2/4/5）才進 4885D0。數字、火花和聲音不是無條件觸發 KB 的證據。
- **4885D0**：forced hit action 與 controller locomotion 是兩個狀態。取 **486180 raw frame delay 總和**；7..9 的暫停窗存到 mob+280，期間不能每段重開同一窗。推退方向與面朝方向相反：面向攻擊者，被推向其攻擊方向。
- **53D3F0**：預測路徑以 **最多30ms** 分段；初速度地面切線 **±130px/s**；drag 為 **40000 / shoe.mass**，這裡沿普通預設 mass100，即 **400px/s²**。不是玩家受傷的跳起／重力路徑，也不是持續以巡邏速度往前走。
- 地面連續正 foothold 可過斜坡；前後連結不存在／不是正地面時 clamp 在端點，不用巡邏 `rx0/rx1` 當碰撞壁。離地的地面怪在這個預算路徑內不加玩家跳躍，fly ability3 才有獨立向量積分分支。
- **4862C0** 的 sprite 逐幀扣30ms並丟棄 overshoot，與 raw hit window 不同。**488BC0** 測 header 的符號位：0x80 是 KEEP，不是 action64，也不能拿其低位改 facing。

### 本輪實裝

1. `MobTemplate` 讀真 pushed、hitActions、raw hitDurations；hit 素材由既有可解析 UOL／link 的 art reader 取得，不再假造受擊時長。
2. WS 普通／近身技能／遠距／魔法共同選真 hit action，寫入原 attack target byte；不再預設0。這是 presentation rand，不消耗原傷害七字 RNG cursor。
3. 每段結算時把 action／方向傳到 `MobField.applyDamage`：命中門檻後**替換舊巡邏／跳躍路徑**，保留 raw reactionUntil，暫停新 AI legs。不是只換圖片、卻繼續走向上一段終點。連 legacy immediate fallback 也逐數字結算，不把低於門檻的多段相加成假 KB；正常 WZ-admitted 攻擊仍走既有120ms分段排程。
4. 真 `0x33` forced header + CMovePath 廣播給所有玩家；path element 保留普通 movement action，沒有把 hit byte 誤當 locomotion。名字／碰撞／火花取樣與 body render 共用 forced-facing。
5. Browser 不再在每個正數字時強塞 hit1；依 authoritative 0x33 的 7/8/9 與真素材播放。收到 replacement 時以其 origin 開始，不能從舊巡邏 future endpoint 插值。冷圖不重起時鐘。
6. 動畫全部 mob actions 保留 rawDelay、另量化30ms顯示；server hit window 仍用 raw sum；forced sprite 播完量化幀或被普通 header 替換才回 base clock，KEEP 不清 forced pose，也不改方向；普通 header 替換時重置 base clock，不沿用 KB 開始前的巡邏時鐘。
7. 同窗口多段仍扣血／顯數字，但不反覆重啟推退；MISS／低於 pushed／−1 不假造 KB。死亡清 motion、velocity、reactionUntil；重生亦清窗，不能帶上上一隻生命的狀態。
8. 晚進場保留既有 `resumePackets` 的未完成路徑、trim 已走時間，不回播整段推退。native wire 沒有直接重建先前 forced sprite frame 的 phase；本輪不虛構額外 wire 欄位。

**Server policy 界線**：原版 client 是 controller/owner 驅動，上述 reconstructed server 統一結算並發 0x33，並非找到了2003伺服器。數字仍用既有本機預測，KB 以 server path 為準，存在網路收包相位差，沒有冒稱原 native controller 的零延遲預測／全同步。普通 mass100、ground branch 是本輪重點；custom field/shoe、水中、完整 flyer sweep／飛行AI、aggro／monster skill、原CVecCtrl全域 phase 仍未完整移植；原 mob state −2/4/5 與 attack10..12 的不可覆蓋保護尚未模型化，不能宣稱全怪物攻擊／技能狀態互斥完成。flyer 此處只有基本阻牆／向量阻尼，不能稱完整539B10。

## 二、NPC 名牌：原版會隱藏，不直接刪掉原規則

**499D60** 明確在 `npc+24` 氣泡物件存在時，對 `npc+108` name layer 的 **vtable+232** put_color(**00FFFFFF**)，沒有氣泡則 FFFFFFFF。依既有 Gr2D color 語義，前者 alpha0。這是原版自言自語的行為，不是「名牌文字被資料清空」。**499C00 → 4373A0** 氣泡原5000ms／深紅字／normal frame；到期恢復名牌。

Browser 先前只用 speech timer 判名牌，冷載原 UI 氣泡框／anchor 未就緒時，可能「名牌已隱、氣泡又沒畫出」。新增 drawable readiness：真框及 anchor 尚未就緒先保留名牌；可畫出後仍遵守原版暫隱，到期／離場恢復或移除。這是 asynchronous browser 的冷資源政策，不把它說成原 engine 也非同步。

另更正 anchor：**433F50 取當下 layer 的 canvas0**，動畫已 shift 時不一定是儲存序列第0張。自言自語捕捉當時真正 frame 的 height；不是永遠 stand/0 高度或 dc 點擊框，也不讓後續每一幀把氣泡上下拖動。新 forced action 在第0格開始，speech-only 則取正在播的當前格。

## 三、NPC 方向：不靠位置差／不把所有 NPC 隨意倒翻

- **4990C0** 將 spawn packet 的整個 byte 存 npc+80；**499B70** 低bit為 facing、`byte>>1==2` 才是 NPC move。NPC 表與 mob/user 的動作表不同。
- **499900** 使用 **vtable+224 put_flip(bit==0)**，不是 `bit!=0`。本輪對照此 setter，保留原左右規則，不憑印象把所有NPC倒翻或強迫面向玩家。
- 原 sender/parser 的 `NpcEnterField` encoder 只寫 `&1`，session也沒有保留完整 action；現在 byte4/5 不會被削成 stand0/1，session分開保留 action 與 facing。
- **4998D0** 更新 movement byte，但 **forced action 期間不呼叫499900**，所以該 layer 的 flip 應凍結。現在 forced 開始捕捉 flip，期間收到相反方向 movement 不左右抖動，結束再套最新 base facing。普通 direction-only 更新也依原邏輯重置 base frame；點擊仍沿 49A670 的 own dc rectangle，不跟 sprite 翻面或 forced frame 高度改框。
- WZ metadata 已讀全部NPC life：66筆，22筆 f=1、14筆 f=0、30筆沒 f；其 own info 沒有 flip 欄。既有 `life.f`／missing-default mapping 本輪未擅改。沒有原server spawn capture可證明缺省應反轉，不將「部分看似朝反」宣稱已逐NPC像素驗證完畢。
- 既有 receiver signed索引／sender+2差異仍保留（ADR-062），不藉這次修方向偷改成其他版本的抽選池。

## 四、方便查看與保存

- 原體驗工具「NPC唯讀」補模板ID、座標、base facing bit、實際繪圖是否鏡像、名牌是否隨氣泡暫隱；不寫場地或強制演出。
- 戰鬥唯讀欄補附近三隻怪的ID、真 pushed、當前受擊 action與剩餘 raw窗。沒有新增自動攻擊、無敵、改裝或自動升級。
- 新 `native-mob-reaction.test.ts`、`native-npc-name-readiness.test.ts` 與追加 NPC behavior 回歸**來源**涵蓋門檻／重入、hitF、速度阻尼、地面邊界／斜坡、離地／固定怪、時鐘、巡邏替換、多段／死亡／重生／resume、signed KEEP、完整 NPC spawn byte、forced flip、當前 frame anchor、冷氣泡名牌。**全部未執行**。
- 同存檔 `generated/preview-faces-20261018.json`；停服後冷備 `generated/backups/preview-faces-before-mob-kb-npc-20261018-062506.json`。保留使用者本次遊玩的104040000／物品與角色進度，不回復舊備份。
