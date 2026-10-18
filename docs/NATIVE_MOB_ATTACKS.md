# 怪物主動攻擊、原 hit 回呼與 KB 共存（ADR-076）

更新：2026-10-18。**已寫入實作與回歸來源；依使用者指示，未執行 test、check、typecheck、語法檢查、browser、VM、HTTP／登入 probe。啟服不是功能 PASS。**

## 1. 本輪的重要更正：不能把主動命中與身體碰撞接成同一條傷害鏈

原檔是根目錄 `MapleStory.exe.c`／`.lst`，不是後版 MapleStory server 的怪物 attack schema。

- `487D10 → 4885D0／488BC0 → 488E30 → 4862C0` 選招、安排 effect／ball／hit。
- **本版 hit callback 是 `50DEC0`**：listing 的 `005875FC+8`（本機）、`0058767C+8`（遠端）均指它。C 約273611–273650，只從攻擊 entry+40 取 hit art，交 `41F8A0` 附玩家 vector，offset `(0,-30)`、flip=`(action&1)==0`。
- **沒有呼叫 5114A0、4C8ED0、55B870；沒有 HP、傷害骰或1500ms受傷鎖。** 不把另一個子 vtable 的 `50D7D0` 誤當這個 slot。
- 身體接觸是另一條 `511C60 → 491FF0 → 4C8ED0 → 5114A0`；仍依既有原 bodyAttack、真 frame RECT、stream2 RNG、HP 回報及受傷保護。
- `5273E0` 只有 selector0 Damage／selector1 Die，其他 return；`527550` 是武器 Attack／Attack2，不能移植成怪物 Attack 音。這輪**不捏造怪物攻擊聲**，既有受傷／死亡聲保留。

修正 `protocol/FINDINGS.md §4.33.2` 先前把選招放在同一傷害序列的誤導敘述。畫出一發球，不等於此EXE會因球碰到人而扣血。

## 2. WZ metadata，沒有從「有圖」推論「可出招」

`48E360` 讀 `attack1／attack2／attackF/info`：

| 欄位 | 原意／缺省 |
|---|---|
| type | 0矩形，1／2定向；缺省0 |
| conMP | 選招前比較怪物MP；缺省0 |
| range.lt／rb | type0原始左向RECT；右向取 `(-right,-left)` |
| range.sp／r | type1／2起點偏移與最大延伸距離 |
| effect／hit／ball | optional art property；路徑在 **info內**，不是攻擊body的兄弟 |
| effectAfter／attackAfter | 相對攻擊起點的ms；缺省0 |

讀取共用 `ArtReader` 的 link／UOL／single-canvas／canvas.value.props，不另抄一套 primitive reader；必需向量不合法不以圖片大小補出攻擊框。
own info 的 pushed／bodyAttack／MP 與 linked art info 分開；`/api/mob/<id>` 必須實際轉送 pushed、maxMP、attacks，不能只在內部加型別卻仍回傳舊的 actions-only JSON。

本包前輪逐 entry 唯讀查得：**只有9999997有有效 attack1/info**：

- type2、conMP2、effectAfter100、attackAfter300、sp=(23,-31)、r250，own MP60。
- body delays150／150／400：raw700，逐幀30ms sprite clock為150／150／420，共720。
- effect、ball各四幀80ms；hit兩幀無delay，使用FX framework缺省120ms。保留各自origin、a0/a1，不把effect的80ms量化成body的90ms。
- **9999999只有 attack1 身體圖、沒有info**；可在唯讀閱覽看圖，不能因此生成選招／球／傷害。

## 3. 選招幾何、方向與 Value

`487D10`：每招 conMP<=mp，先嘗試當前facing，再嘗試相反方向；每招最多一候選。非空候選均勻抽一個，index+10。
原版抽選呼叫獨立的 `4619F0` 狀態，並非玩家傷害stream2。本輪server注入uniform random政策，**不宣稱重建了owner完整RNG序列**；無候選不消耗選招random。

- type0：與玩家 `5085E0` 矩形交集，Value=0。
- type1／2：`488220` 沿x每20px一段，段的垂直半寬=`trunc(距起點/4)`，top=y-half、bottom=y+half+1；第一段只有1px高。**是逐段展寬的楔形，不是「厚4px直線」、圓形半徑或一塊大包圍框。** Win32 RECT 的空／接邊不算交集。
- 有ball：Value打包signed16的x／y；近側內10px、窄框限中心，y=mob.y+sp.y再夾玩家top/bottom。原實作打包近側使用**選招前當前facing**，不是事後猜一個新朝向。
- 無ball：Value是characterId；type0不是characterId。保留u32位元，session事件不能丟掉它。

## 4. Projectile／effect／hit時鐘及移除

`488E30` 固定當時 origin與矩形，effectAfter／attackAfter不隨body delay重新縮放。

- effect到期附mob，flip取攻擊當時facing的反值；native pending effect只有一個slot，新招替換尚未建立的舊effect，已建立world layer不會因此消失。
- type0在attackAfter檢查一次RECT，無論有無命中都移除這個request。
- 無ball的定向招以characterId找玩家；本機在建立時另有近側距離<=r閘；本輪瀏覽器一致做此幾何閘，遠端差異列於政策界線。
- ball從 `(mob.x ± sp.x,mob.y+sp.y)` 朝Value方向延伸到r；release=attackAfter，壽命=`r*10ms`。不是在目標位置停下，也不是 `距離/玩家彈速`。
- **type2才呼 `420140`**（listing `486A8E..486ABE`）：vx=(x1-x0)/T、y=y0−40t+((y1−y0+40T)/T²)t²；初速−40，不套另一呼叫點的−250，不做全線性插值。
- **type1無此呼叫，跳到486C6E**；該vector只被MoveTo(sp)初始化，後續4208A0僅包成COM Variant，不是移動函式。本輪照此保留原點直到到期，**不自創直線彈道**。實際Data.wz未提供可用type1招，這個分支有來源fixture，無原遊戲動態驗收。
- `4862C0` C約142260–142330：取ball vector現在座標，PtInRect玩家swept RECT後呼50DEC0；**命中後沒有移除球、沒有每玩家一次標記**，可在下一30ms tick繼續放hit圖。約142330起的單次queue則到期後確實unlink／delete。不能套「打中即消失／pierce計數」的後版規則。
- ball loop以本身frame delay，z從mob actor；effect／hit用既有world FX z250310與建立序，hit跟玩家(0,-30)，不強塞玩家projectile z，不用feet-y排序。圖層建立後不因HTTP回來重起時鐘。

瀏覽器用獨立 `mob-attack-effects.mjs`，只產生世界art descriptor，**完全不接damage、RNG、HP或contactClock**。同一顯示更新最多一個30ms碰撞sample，不在hidden tab回來補歷史hit；冷metadata不重播過期effect／single-hit，不重起已到期飛彈。512 pending／world層上限是browser記憶體政策，不是原常數。

mob-leave刪掉其pending攻擊／球；已建立effect保持最後owner位置到期，hit跟玩家至到期／玩家離場；field切換／斷線清全部，metadata回包沿既有mapGeneration防舊場地復活。死亡先保留mob屍體存在期的queue，真正leave才清owner，不把body die當作所有world FX的終點。

## 5. Forced attack與KB不是同一個窗口

`4885D0／488BC0`：current10..12 + incoming7..9，**不換body action／facing，但仍設定raw hit窗與KB物理路徑**。

- server、browser分開 forced `{action,facing,since,duration}`、raw reactionUntil、attackUntil；hit封包照樣到達，KB path照樣替換巡邏。
- server frame量化與browser一致；AI不能在attackUntil／raw hit／forced顯示期間開始新巡邏或新招。多段仍按既有per-number pushed與raw窗判定，沒有把總傷害當一次KB。
- 冷metadata時也用bridge明示forcedDuration守住攻擊，不因「暫時還沒有body幀」被hit覆蓋。
- normal header可換掉forced，signed KEEP只更新path；不是所有incoming header都保護、也不是出招免推退。
- 死亡／重生清forced、KB、attack鎖及engaged id，重生MP回own maxMP。

## 6. 權威政策，沒有冒充完整原owner AI

原 `4862C0` 出招另需forced<=−1、ability3或grounded、controller／aggro旗與state5；`488D90` 的MP ack又會做2→4、1/3→5等狀態轉移。**這些native狀態／owner轉移尚未完整搬進server。**

本輪明示server政策：被玩家已接受攻擊（含MISS／0）後engaged；只找該玩家仍同場且HP>0的最新field位置，不全圖找最近人；非flyer需grounded；MP足夠且raw／attack窗皆空才選招。tick先做attack再patrol，扣一次conMP、廣播原0x33＋0x34，所有玩家同一條權威path。不另加猜測cooldown／MP自然回復／偽Attack聲。

0x34是真u16 MP，不是HP，也不是「收到就hit1」；ClientSession／browser保留MP，唯讀inspect顯示MP與可用招式數。server考量現在HP的getter讀session.character，不捕捉可能已換掉的舊character快照。

晚進場：原native wire沒有當前forced影格的phase欄位；保留resumePackets trim未走path，forced尚存時以signed KEEP header續路徑，不能隨後一個普通header把已恢復phase又清掉。CLI同process另外提供**已驗證當前帳號／角色場地的browser-only phase sideband**（age／duration／raw剩餘／MP）；用相對age續播body，**不新增native opcode、不重播舊effect／release／hit**。已在飛的舊球與歷史屍體不為新進者重建；原global phase／延遲校正／owner本機預測仍非完整。

同鏈補漏：body contact的bridge驗frame原只允stand／move／hit1，現在涵蓋jump／fly／magic／throw／ball1/2／hit2/F／attack1/2/F，方向與body共用forced-facing。沒有bounds仍不碰撞，不用canvas尺寸造框。
死亡持續時間不再另讀舊node而漏single-canvas或link，改用同一份已解析actions的最長die1／die2／dieF量化長度；browser也不再固定die1。選擇變體及最長屍體保留期限是目前server呈現政策，不聲稱完整native死亡／重生控制已還原。

## 7. 方便查看，不生怪、不改進度

進遊戲後「體驗工具（非原版）」→ **唯讀 · 原怪物動作／主動攻擊鏈**：

- 預填9999997，可選左右、attack1／2／F、hit／die／一般動作與是否接info時序。
- 共用live純選招、拋物線、effect／hit排程，但使用獨立owner、canvas、metadata request、時鐘與queue；不消耗live RNG、不出聲、不發攻擊、不改角色或save。
- 9999999可看身體圖但會明示沒有info；缺動作不替代、不補假素材。虛線框是工具的玩家RECT示意，不偽稱原美術。
- 關閉／收合／切圖／斷線abort／generation清理；失敗5秒後重試。唯讀工具不暫停live世界。
- 戰鬥inspect另顯示附近怪物forced顯示剩餘與raw反應剩餘，避免兩個時鐘混稱「KB」。

## 8. 交付、存檔與未執行來源

停服後原檔冷備：`generated/backups/preview-faces-before-mob-attacks-20261018-065031.json`。
重開仍用 `generated/preview-faces-20261018.json`，ports8515／8516／8517、ping off、preview／observer tools與map命令開；沒有還原舊備份、沒有改角色／物品或換新進度。

`server/test/native-mob-attacks.test.ts` 包含geometry／MP／Value／curve／type1保留、forced保護與真KB、engagement／air gate、phase／respawn、ball重複hit、冷載入／remove、session bridge及真WZ fixtures；**全部只是未執行來源**。

仍缺：全owner/controller與native狀態機、aggro選人、monster skill、custom shoe／water、完整飛行AI／sweep、global30ms phase、歷史球latejoin、原GDI／Gr2D逐像素與動態比對。不聲稱全怪物玩法1:1完成。
