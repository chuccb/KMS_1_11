# 原穿戴入口、可操作的遠距體驗與非同步戰鬥生命週期

2026-10-18，ADR-072。**未執行test／check／typecheck／語法／browser／VM／probe**；新增回歸來源不是PASS。
本輪接續[十技](NATIVE_RANGED_SKILLS.md)，不把沒有原證的魔法／Booster／Magic Guard規則猜成已實作。

## 1. 使用者回報正確：送武器沒有解決原等級要求

只讀掃描本Data.wz全部Character/Weapon/145、146、147族，按真requirements.level排序：

| 類別 | 最低原裝備 | 原要求 | 原PAD |
|---|---|---|---|
| 弓 | 1452002 워 보우 | Lv10，job mask4 | 25 |
| 弩 | 1462001 석궁 | Lv12，job mask4 | 29 |
| 拳套 | 1472000 가니어 | Lv10，job mask8 | 10 |

三者STR／DEX／INT／LUK需求皆0，但不是無等級／無職業要求。沒有Lv1同類武器；不能偽造Data.wz模板或只改reqLevel。
上一輪固定整組送三把而不補等級，Lv1換職業後仍不能穿。這是便利入口漏項，不應要求使用者先磨到Lv10。

### 現在的明確操作

1. `/tools`選弓手或盜賊預填；這僅填表，仍需勾同意並套用配置。沒有改原版轉職規則。
2. 遠距種類選**弓／弩／拳套**，由server回真名稱、ID與WZ requirements；畫面並列目前等級／職業。
3. 欲補等級需另勾**「明確補足所選武器最低等級」**。預設不勾；開／關工具、改種類、套預填、收到回覆都清掉此同意。
4. 已有上一輪武器可按**「已有武器：只補等級，不再次領取」**；缺裝備才按**「準備所選武器＋200枚相容彈藥」**。
5. I手動穿戴，K以原SP學相容技能，雙擊／拖原七鍵。沒有自動穿戴／轉職／加AP或SP／學技。

低於需求且未勾補等級就整組拒絕，回覆列明需求／目前等級；錯職業明示先套用相容職業，不白送不能穿的裝備。
已在bag或worn持有同ID武器不重複發放、不覆寫scrolled instance；普通彈藥仍是明確按鈕一次200的工具政策。
200受原slotMax與既有MAX_ITEM_STACK政策限制，不是原版贈品／掉寶量。

### 等級／HP／MP與交易原子性

- 最低等級讀WZ，不寫死10／12作為運算；不降既有等級，也沒有任意level/itemId的JSON入口。
- 對角色／items做clone；逐級以已查明的expToNextLevel／awardExp／4C7450 growth補足，不只是改level byte而漏HP／MP。
- 每跨一級重讀有效worn INT與成長被動，使用已學level的原x。RNG仍是server-owned，沒有聲稱復刻原process seed。
- 這是明示開發操作：保留原EXP餘額、原job／AP／SP／skills／mesos／地圖；活人補足時HP／MP填至新有效上限。
- 需求／空間／模板驗證、0x0D ack=false、0x0B result0與level effect全部準備可encode後才一次commit、persist。
- 任一失敗不改角色／背包／等級；不能先升級再回覆背包滿。成功提升等級使舊level的能力還原點失效；**不回溯等級／EXP／物品**。
- 此流程仍須目前已進場帳號／characterId匹配、`--test-tools`明確授權、confirmed與raiseLevel布林、shop／talk／trade／pending-shot守衛。
- 啟服不自動處理任何角色；沿用使用者最新save，並非回復研究起點的冷備。

## 2. 4636B0的穿戴順序續查更正

原`MapleStory.exe.c`的4636B0（約107382起），並交叉`.lst`的463795→463837／46384E→46386D：
先call4C5020、再清ZRef、最後call4C5420；中間沒有第二次4C5020。明確順序：

1. 讀來源裝備與目前部位。
2. `4C5020(character,worn,0,0)`先建立**完整有效穿戴集合**。
3. `465B50／465C60`找兩手／盾、套服／褲衝突；需要額外空位時先拒絕。
4. 在那份既有有效集合上刪除衝突部位、被替換部位。
5. `4C5420`計算BasicStat；檢查法師武器限制、性別、level、四主屬性、job mask。
6. 通過才55ACB0送0x17，client不先改背包。

**不是**先排除部位再重新跑一次4C5020。原集合內靠舊武器才能達需求的其他裝備，當次admission仍保留其屬性；
穿完後的有效集合再照4C5020重算，是另一個時點。這次更正之前canWear的過度refilter，不改平常statBasis的原反覆剔除演算法。

`client/equip-rules.mjs`現在是無DOM純規則：bodyPart／equipConflict／firstBagSlot／canWear。
原equipment.mjs仍re-export，視窗呼叫不用改介面；server共用同一規則，不複製第二套requirement算法。
不足等級顯示「需要LvN／目前LvM」，主屬性顯示STR等實際／需求，不只模糊說能力不足。

## 3. 裝備入口不只攔瀏覽器

GameEntry於結構性applyChangeSlot之前用equipAdmission檢查：

- bag→worn，以及worn→已占用bag的**反向swap**（bag裡的物品也會穿回原部位）。
- empty bag unequip／一般bag move／drop不受無關requirement攔阻；不符合部位等仍由既有結構檢查拒絕。
- 真WZ需求、性別、職業、等級、有效既有裝備的實例主屬性、排除部位／兩手盾／套服褲；cash仍未開放，不偷偷混正常裝備。
- WZ缺席不能以無需求放行；`--data off`可移動／脫下，不能穿上未確認需求的物品。
- trade／死亡／shop／talk拒絕；0x17尾隨垃圾拒絕，解析失敗或拒絕仍回空0x0B解開等待，不靜默卡背包。
- clone上處理全部衝突搬移、預encode inventory與上限裁切的stat packet後才替換原items。
- 成功仍接有效weaponId→booster單欄取消、vitals上限裁切、avatarItems、0x28他人外觀與persist；不重置實例能力／RUC／CUC。

**界線**：原客戶端需求規則有直接證據；把它重做在server邊界與交易原子性是本重建安全政策，並非找到2003原server。
其他helper仍可單獨做結構性inventory操作，但正式GameEntry不再只相信caller聲稱已驗需求。

## 4. 主動攻擊時鐘／回覆對應，不造native ACK

原513C80／512F90先以動作起點排release／travel，再送封包。上輪bridge回覆後再加完整delayMs，
等於把瀏覽器→bridge／寫TCP的耗時加在本機body已開始之後。本輪補上：

- 本機開始動作時保留start、field identity、combat epoch、skill ID／level、原mob object與各目標的release+travel。
- browser/bridge JSON帶attackToken，只作非同步關聯，**原0x0F／0x10、0x23／0x24皆不加欄**。
- bridge在RNG前驗token域；回覆原token與damages，不另給一個從I/O完成才起算的release。
- browser按原start顯示；多目標各消費一次、重複回覆拒絕，錯field／epoch／skill／level／新生同ID怪物拒絕。
- 換場／死亡／斷線清ledger；token序列不歸零，不讓清理前的回覆誤認新攻擊。
- 128筆／10秒是**非同步UI資源上限**，不是原技能cooldown／飛行上限，不改原damage clock。

仍是client-reported／本機預測傷害，不是server承認造成傷害；沒有捏造原版admission ACK或重新抽傷害。

## 5. 遠端冷載入／離場重入

- 收到0x23／0x24 relay時立即固定射手source座標、root z、目標座標與mob identity，之後才await profile／skill metadata。
- 飛行方向與release仍用該次訊息，射手後續移動不讓彈體從新位置發射；冷素材不重啟原start。
- 若等待期間同ID怪物已換實體，不在新怪上畫舊damage／hit art；射出的舊彈道仍向原位置飛行。
- body已過期不補播武器／Use聲，body畫面亦不重新從第0幀開始。
- 已入列的buff／技能效果也綁remote entity身份；同角色ID離場再進，即使同look也不接上舊特效。
- 既有mob-hit identity、field epoch、body ticket與look守衛保留。不是完整CShape2D／牆ray／Gr2D移植。

## 來源／交付界線

新增equip-admission／attack-predictions回歸來源，更新ranged-skills來源覆蓋分族／明示level consent／最低級／原PAD與RUC／
只補等級／不重送武器／不改AP或技能／容量不足不變更；全部未執行。

冷備`generated/backups/preview-faces-before-equipment-20261018-*.json`保留**這次使用者操作後**最新進度；
本輪不重seed／不改角色進度。完成後以同`generated/preview-faces-20261018.json`、preview與observer授權重開8515／8516／8517。

### 前輪續追的魔法入口（後續已由ADR-073接通）

本輪另讀518BF0→5195D0→514D30與4C89D0：prone退普通近戰；magic action另由428040／PE5B2374決定，
不是把射擊動作改名；514D30選X±50到±300的shape ray、Skill ball有無又影響travel與牆檢查。
4C89D0有獨立七字cursor、INT／LUK命中、MAD／level mastery／技能mad與元素／MD，不是物理damage%公式。
這些路徑本輪**沒有開放施放**：尚未完整移植selector表、姿勢素材與shape／元素鏈，不用一半公式湊技能數。

**最新續作**：[NATIVE_MAGIC_SKILLS](NATIVE_MAGIC_SKILLS.md)已補selector／WZ動作／元素與完整施放鏈；並更正初讀細ray為491F20逐片擴高搜尋。原CShape2D／Gr2D界線仍保留，未執行測試。
