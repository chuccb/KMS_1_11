# 與原版的差異、部分完成與未實作總盤點

盤點日期：2026-10-18。程式基準：`4f9ad1b`（ADR-076 怪物主動攻擊交付之後）。
這是**靜態現況盤點**，不是遊戲驗收、逐像素比較或新的原版實機測量。本輪閱讀現行程式、ADR、原證整理與路線圖，未執行測試／check／typecheck／語法檢查／browser／VM／HTTP或登入probe。

## 先講結論

現在是「**已有相當多原資料與局部原規則的可玩重建**」，不是完整原版客戶端／原版伺服器。
剩下的主要差距依序是：

1. **底層移動、形狀碰撞、全域時鐘與同步還沒有整體等價**，所以即使速度常數或某個姿勢正確，整體手感仍可能不同。
2. **怪物／NPC只有部分控制分支**；新主動攻擊鏈不等於完整原owner AI／仇恨／狀態機。
3. **角色自然成長與任務進程不完整**；不能把開發工具配置職業／AP／SP當原遊戲流程。
4. **技能只開放12招完整施放白名單**，不是技能書能顯示的全部技能都能用。
5. **經濟與多人部分規則是重建政策**，不是從客戶端或WZ恢復了官方掉落、商店、經驗分配或人氣規則。
6. **UI、字型、特效混色、視窗管理與社交視窗仍有可見差異／缺口**。

不提供「已還原百分之幾」：缺乏完整原版功能母集合與當前動態驗收，百分比沒有可靠分母。
**Data.wz不是這些缺口的通用藉口。** 素材、客戶端行為、原伺服器規則是三件事；曾漏素材的reader不能以假fallback掩蓋，原server未知也不能反推WZ缺圖。

## 狀態怎麼讀

| 標記 | 含義 |
|---|---|
| **差異** | 現行程式或明示政策可確認與原native機制不等價；不一定是使用者看得見的故障 |
| **部分** | 已有可用路徑，但相關分支、生命週期、介面或規則未全部接通 |
| **未接** | 現行產品路徑尚未實作／開放；可能已有素材、codec或研究來源 |
| **未知** | 原客戶端／listing／WZ不足以證明原規則，或證據矛盾尚未解開；不能憑後版慣例補答案 |
| **未驗收** | 已有來源，但沒有當前版本的動態／像素／原機比對；不是已確認有bug，也不是PASS |

同一項可以同時是「部分＋差異＋未驗收」。以下不把尚未驗證的風險寫成已重現的遊戲故障。

## A. 最先影響整體手感的底層差距

| 編號／狀態 | 剩餘問題 | 已有與未有的分界／影響 | 程式與證據入口 |
|---|---|---|---|
| A01 差異／部分 | 玩家不是完整CVecCtrl | 普通地面、空中、斜坡、繩梯、登台與受擊外力已有；`motion.mjs`仍採固定8ms步進，不是原引擎整個主迴圈／控制器的等價移植。參數正確不保證接地、轉向、摩擦、離平台等所有邊界一致 | `client/motion.mjs` 的 PHYSICS／advancePlayer；[姿勢](NATIVE_POSTURE_ATTACK.md) |
| A02 未接／部分 | 水中、飛行、特殊鞋／地圖物理 | 現有motion明示只涵蓋ordinary ground／air／ladder；不能把fly身體圖或jump姿勢當作飛行／游泳控制器。完整場地／鞋參數與特殊碰撞分支未接全 | `motion.mjs`、`mobmotion.mjs`、`game/map.ts`／`mobs.ts` |
| A03 差異／部分 | CShape2D與形狀池 | 已用當前WZ frame真lt/rb、swept RECT及碰撞內縮；仍非完整原shape pool、R-tree、ZList選敵順序與所有逐幀地形阻擋。多人／多怪同時重疊、邊界與高速狀況仍有差距 | `client/basiccombat.mjs`、`contact.mjs`、`magiccombat.mjs`；[魔法界線](NATIVE_MAGIC_SKILLS.md) |
| A04 差異 | 沒有共同原全域30ms相位 | 普通body、攻擊、raw受擊窗與FX已分時鐘，但RAF、8ms物理、field tick仍不是同一個native app phase；server預設field tick為90ms，due hit可延到下一tick | `motion.mjs`、`avatar-motion.mjs`；`net/loginserver.ts` 的 DEFAULT_MOB_TICK_MS／tickFields |
| A05 差異／部分 | 遠端插值、延遲與晚進場 | 已送未走完path、trim elapsed，怪物body可續相對age；仍非原owner預測／完整延遲校正。已飛的舊怪物球與歷史屍體不為新進者重建，不能稱全場景phase同步完成 | `motion.mjs` 的 beginPath／sampleMotion；`game/mobs.ts` 的 resumePackets／presentation；[ADR-076](NATIVE_MOB_ATTACKS.md) |
| A06 差異 | 背景分頁／冷載入政策 | 長間隔不追播不可見的全部輸入與命中，過期效果不重新播放；這是browser安全／效能政策，不等於native持續更新的每個中間snapshot | `motion.mjs`、`avatar-motion.mjs`、`mob-attack-effects.mjs`、`combat-assets.mjs` |
| A07 差異／未知 | 全域RNG呼叫序列與數值精度 | 傷害已有原ClientRandom與七值抽樣；動作選擇、火花、字位移仍有Math.random，成長／怪物選招另有server注入來源；未重放原全域種子與呼叫順序。JS double／x87暫存精度未逐輸入比對 | `main.js` 的動作與火花抽選；`net/webclient.ts` 的 attackRandom；`growth.ts`、`mob-attacks.mjs`；[數值](NATIVE_STATS_COMBAT.md) |

**A類應先成鏈處理，不宜再只改一個速度值：** 場地參數→控制器狀態→接地／牆／斜坡／繩梯→外力→movement wire→遠端插值→body action→碰撞→鏡頭／深度。

## B. 怪物與NPC

| 編號／狀態 | 剩餘問題 | 現況與影響 | 入口 |
|---|---|---|---|
| B01 部分／差異／未知 | 怪物owner、aggro與狀態機 | 地面roam、普通跳怪、KB、attack metadata／MP／effect-ball-hit已有；原controller指定、state−2／1..5轉移、追擊／換目標等未完整移植。現行是被已接受攻擊後engaged、找同場活著的該玩家之server政策，並非完整原AI | `game/mobs.ts`、`world.ts`；[怪物攻擊 §6](NATIVE_MOB_ATTACKS.md) |
| B02 未接／部分 | 飛行怪、水中怪與完整特殊KB | 顯示fly圖、基本向量阻尼／阻牆不等於完整539B10及flyer sweep；custom shoe、水中、追擊與所有碰撞分支仍缺 | `mob-reaction.mjs`、`mobmotion.mjs`；[KB界線](NATIVE_MOB_KB_NPC_STATE.md) |
| B03 未接／未知 | Monster skill／完整能力異常 | 本輪active attack不是monster skill系統；不能據此宣稱怪物施法、debuff與所有特殊狀態已接 | `game/mobs.ts`、`mob-attacks.mjs`；[ADR-076界線](NATIVE_MOB_ATTACKS.md) |
| B04 部分／差異／未知 | 重生、MP回復與屍體壽命規則 | 現行固定重生等待、重生回maxMP、以最長die動作保留屍體等是server政策；沒有原server完整spawn／regen規則。死亡變體與共用reader已補，不應再列為「永遠只die1」 | `game/mobs.ts` 的 MOB_RESPAWN_MS／lifecyclePackets／loadMobTemplate |
| B05 未接 | NPC自主漫步控制器 | action／speech／flip／名牌規則、controller relay與path sampler已有；CVecCtrlNpc／5398B0自主生成步行路徑、smoothing未完成。`--npc-walk`不是強制補成原AI | `client/npcbehavior.mjs`、`npcmotion.mjs`、`game/npcs.ts`；[NPC未完成](NATIVE_NPC_BEHAVIOR.md) |
| B06 未知／差異 | NPC額外動作索引與控制權 | 原sender extraIndex+2、receiver raw索引的矛盾未解；現行透明relay與第一可用member控制、250ms防洪是重建政策，部分額外表情不能保證每次抽選皆對應原行為 | `game/world.ts`、`client/npcbehavior.mjs`；[NPC索引](NATIVE_NPC_BEHAVIOR.md) |
| B07 部分／差異／未知 | NPC點擊不是原任務腳本 | 現行商店或info/speak分頁say；原quest（如begin5）、轉職、計程車、倉庫的條件／分支／價格／獎勵沒有完整原腳本 | `game/dialogue.ts`、`net/loginserver.ts` 的 handleObjectClick／talkTo；[NPC對話](NATIVE_NPC_DIALOGUE.md) |

**不是缺口的原行為：** NPC自言自語期間暫隱名牌已有499D60證據，不能為了看似方便就刪掉；真正要修的是冷資源造成名牌／氣泡同時不可見的漏洞。
同樣，本EXE主動怪攻擊hit回呼50DEC0只放圖、不走HP傷害，是現有原證；不能以後期版本印象列成「忘了扣血」。身體碰撞傷害另走511C60鏈。

## C. 戰鬥、技能、成長與裝備

| 編號／狀態 | 剩餘問題 | 現況與影響 | 入口 |
|---|---|---|---|
| C01 部分 | 只有12招主動施放白名單 | 技能書／hs／圖示／前置可顯示，不等於技能已可施放。未開放者不應免費退化成基本攻擊 | `client/active-skills.mjs` 的 ACTIVE_SKILLS；`game/activeskills.ts` |
| C02 未接／未知 | Magic Guard、Booster、其他技能 | Magic Guard HP/MP分攤、MP不足與捨入、mask證據未全；Booster收值與攻速消費已接，但施放幅度未證明，沒有猜常見的2。Teleport／Heal／Dark Sight／Soul Arrow／Final Attack／mob debuff等未接全，不可套現代公式 | [遠距技能](NATIVE_RANGED_SKILLS.md)、[魔法](NATIVE_MAGIC_SKILLS.md) |
| C03 部分／未接 | 其餘被動、狀態異常與解除 | 已有成長、命中／迴避、mastery／射程等部分被動；不是所有職業分支都套用。手動buff取消、完整debuff與其圖示／數值／死亡／跨圖消費鏈未全部接 | `game/characterstats.ts`、`nativecombat.ts`、`client/temporarystats.mjs`；[第一批技能](ACTIVE_SKILLS.md) |
| C04 未接／未知 | 自然升級AP／SP發放 | HP／MP成長、EXP門檻、活人升級補滿與手動AP已有；`awardExp`仍不發自然AP／SP，原數量／規則未定位。不能把額外體驗點數當正常升級 | `game/exp.ts`、`growth.ts`、`ability.ts`；[成長 §4](STAT_GROWTH.md) |
| C05 未接／未知 | 自然轉職與完整角色進程 | job名稱、技能書與operator配置不等於原轉職條件、NPC任務、初次加成與後續進程。此缺口會阻斷自然遊玩，不只是缺一個視窗 | `client/jobs.mjs`、`game/testtools.ts`、`dialogue.ts`；[路線圖](ROADMAP.md) |
| C06 部分／差異 | 客戶端預測與server承認 | browser／bridge已限制WZ、武器、姿勢、資源等；普通／主動本機演出仍是預測，原TCP沒有新近戰admission ACK，拒絕不保證能完全撤銷已畫的效果。server仍接受原協定client-reported damage，不是完整server重算 | `net/webclient.ts`、`net/loginserver.ts`、`client/attack-predictions.mjs`；[施放政策](ACTIVE_SKILLS.md) |
| C07 部分／差異 | 其他飛彈、選敵與遠端資料 | 原命中點／tier／火花已補；仍非全追蹤分支／全shape pool。remote沒有他人完整已學被動表，空射不能精確還原其被動射程 | `main.js`、`basiccombat.mjs`、`magiccombat.mjs`；[攻擊特效](NATIVE_ATTACK_EFFECTS.md)、[姿勢界線](NATIVE_POSTURE_ATTACK.md) |
| C08 未接 | 卷軸強化 | spec204／c2s0x1A路徑有原證，但未有完整拖卷軸→需求→成功失敗→tuc/ruc/cuc→數值／特效→持久化鏈。tooltip可顯示捲數不代表能強化 | `game/items.ts` 開頭；`game/equipment.ts`、`client/main.js` |
| C09 部分／未知 | 裝備生成變異與完整avatar裝配 | 新裝備已用WZ模板inc*／tuc，非全零；舊實例不偷偷回填。原server的隨機裝備變異未知；完整body-level blocked slots、cash／pet／技能附著與assembler未完成 | `game/equipment.ts`、`avatar.ts`；[裝備數值修補](NATIVE_EQUIPMENT_DAMAGE_FIX.md)、[圖層](NATIVE_LAYER_PRIORITY.md) |
| C10 部分／未知 | 死亡代價／復活數值 | Tomb／ghost／延後復活窗與returnMap已有；現行revive直接補有效maxHP，未見完整死亡EXP損失／原server復活數值規則。不能因畫面像原版就推定這些數值已等價 | `net/loginserver.ts` 的 revive／handleVitals；`game/vitals.ts`；[死亡](NATIVE_DEATH_ANIMATION.md) |
| C11 部分／未接 | 其他消耗品機制 | HP／MP、百分比、回城與speed／PAD／MAD／ACC／EVA／PDD已有；MDD等無完整消費者的spec仍整件拒絕，未涵蓋所有USE效果 | `game/items.ts` 的 TIMED_CONSUME_FIELDS／unapplied；[消耗品](TEMPORARY_STATS.md) |

### 目前12招，避免再混稱10招或全技能

| 類型 | ID與技能 |
|---|---|
| 自身／隊伍buff（4） | 1001003 Iron Body、2001003 Magic Armor、3001003 Focus、1101006 Rage |
| 主動近戰（3） | 1001004 Power Strike、1001005 Slash Blast、4001334 Double Stab |
| 主動遠距（3） | 3001004 Arrow Blow、3001005 Double Shot、4001344 Lucky Seven |
| 魔法攻擊（2） | 2001004 Energy Bolt、2001005 Magic Claw |

這個數字只代表白名單來源，不是12招都已經在當前版本動態驗收，更不是角色自帶12招。

## D. 經濟、任務、多人及保存規則

| 編號／狀態 | 剩餘問題 | 現況與影響 | 入口 |
|---|---|---|---|
| D01 未接／未知 | 原任務全流程 | 對話codec／五類dialog／富文字已有；任務狀態、接受／完成條件、殺怪／交物計數、獎勵及持久化不是完整產品鏈 | `game/dialogue.ts`、`protocol/quest.ts`；`client/npcdialogue.mjs`、`systemmenu.mjs` |
| D02 差異／未知 | 原掉落表／機率／金錢 | 現行defaultDropPolicy是金錢、對應雜物、按級藥水三種roll；60%／30%／5%、level×3金錢跨度等是本repo政策，不是原掉落表。原RNG演算法不會把自訂掉落機率變成官方機率 | `game/drops.ts` 的 constants／defaultDropPolicy |
| D03 差異／未知 | 原商店庫存與回收價 | item price有WZ來源，但何NPC賣何物、庫存、數量上限、sell ratio=0.5及部分取整屬重建政策；買賣／飛鏢補充可用不等於原商店經濟完成 | `game/shops.ts`；[商店與補充](MESO_RECHARGE.md) |
| D04 部分／未接／未知 | 組隊經驗、貢獻與掉落歸屬 | party名冊／邀請／指令與Rage收件者已有；awardKillExp仍對kill session發template.exp，沒有完整隊伍經驗分配與貢獻公式。完整掉落歸屬／分配規則亦未證明 | `net/loginserver.ts` 的 awardKillExp；`game/parties.ts`、`drops.ts` |
| D05 部分／未知 | 人氣規則與配額持久化 | 有server與protocol；Lv15門檻、UTC日月與順序是policy，ledger不入save，重啟即重置。不能把它當已恢復原server日／月配額 | `game/fame.ts`；browser完整人物資訊／給人氣UI也未接全 |
| D06 部分 | 交易／Messenger有server，不等於browser可用 | 邀請、交易房／道具金錢承諾及原子成交、三人聊天室已有規則／codec；ClientSession與完整瀏覽器操作／邀請／房間視窗沒有完整產品鏈 | `game/trades.ts`、`messenger.ts`；`net/loginserver.ts`；`client/systemmenu.mjs` |
| D07 未接／未知 | 倉庫／計程車／其他原NPC服務 | 沒有完整原服務腳本、條件、費用及流程；不能以/map或任意存取替代。已有trunk／taxi資料或對話素材不代表服務已實作 | `game/dialogue.ts`、`net/loginserver.ts`；[路線圖](ROADMAP.md) |
| D08 未接／部分 | Cash／pet／小遊戲 | cash tab、序號或avatar某些資料欄存在，不等於商城流程、寵物控制／物品／互動、小遊戲房與UI已完成；範圍仍應限本版原證，不補後版系統 | `protocol/itemslot.ts`、`game/avatar.ts`、`systemmenu.mjs`；原C有CCashShop但非現行browser完整產品路徑 |
| D09 差異／部分 | 暫時狀態／房間的重啟行為 | buff、party／交易／Messenger、人氣配額等runtime state並非全部持久；跨圖重播剩餘buff已接，但重開清除等是明示政策，沒有完整原斷線／重連恢復規則 | `game/save.ts`、`fame.ts`、`parties.ts`、`trades.ts`；[技能生命週期](ACTIVE_SKILLS.md) |
| D10 未接／部分 | 正式帳號／世界服務 | 原式登入／選世界／選角／建刪角已有；官方註冊／找回帳密／完整帳號服務、營運級世界服務／移交、所有重連失敗路徑沒有因此完成；本版是否另有頻道視窗需原證，不按後版直接列為確定缺失 | `client/selection.mjs`、`main.js` title流程；`net/loginserver.ts`、`save.ts` |

## E. 畫面、UI、音效與操作

| 編號／狀態 | 剩餘問題 | 現況與影響 | 入口 |
|---|---|---|---|
| E01 差異／未驗收 | 原字型與文字度量 | Gulim／Dotum依系統可用性，合法KMSCJK fallback不是原Win32 GDI／IWzFont。字寬、baseline、CP949 CharNextA、換行、tooltip及氣泡尺寸不能聲稱逐像素等價 | `client/fonts/README.md`、`tooltip.mjs`、`chatlayout.mjs`；[tooltip](NATIVE_RICH_TOOLTIPS.md) |
| E02 部分／差異 | Gr2D混色、layer與avatar所有分支 | 真zmap、body front/back、child5殘影、世界FX與建立順序已有；native所有COM layer、blend／閃色、blocked-slot、同z同刻全域順序未全移植。remote全部受傷閃色／attr4家族也非完整 | `scene.mjs`、`game/avatar.ts`、`faces.mjs`；[圖層](NATIVE_LAYER_PRIORITY.md)、[臉部](NATIVE_FACE_ANIMATION.md) |
| E03 部分／未接 | 全視窗管理與UI動畫 | 單個視窗能拖曳／關閉不等於原window manager、焦點／遮擋／Tab／modal全鏈。Menu hover仍只取mouseOver第0格，selector／部分disabled框由browser畫，非原CCtrl全等價 | `client/systemmenu.mjs`、`main.js`；[系統UI](NATIVE_SYSTEM_UI.md) |
| E04 未接／部分 | 任務／Party／Community等完整視窗 | Menu的Quest／Party／Community仍停用；party指令／原式邀請不是完整party窗。交易、Messenger、人物資訊／人氣、原收件人選擇等UI未接全 | `systemmenu.mjs`、`gameoptions.mjs`、`session.ts` events；[聊天設定](NATIVE_GAME_OPTIONS_CHAT.md) |
| E05 未接／差異 | 中央公告、原取得道具提示 | 0x13目前只讀type0；type1中央公告尚未接。loot仍寫chat/log，沒有完整原4EB440螢幕提示 | `protocol/notice.ts`；`main.js` 的 system-notice／loot |
| E06 未知／平台差異 | 完整按鍵對照與本機設定 | 七原快捷格、技能／藥水拖放已有；其餘完整按鍵對照仍需逐入口確認，是否另有獨立改鍵窗要原證，不能直接要求後版自由改鍵UI。localStorage取代native registry，跨瀏覽器／裝置不等同原設定機制 | `quickslots.mjs`、`gameoptions.mjs`、`systemsettings.mjs` |
| E07 未接／平台差異 | 原DirectX畫質與截圖目的地 | SysOpt對應控制仍disabled；瀏覽器縮放／DPR不是soVideo，不能把browser截圖當原Win32路徑功能 | `systemmenu.mjs` 的 openSound；[SysOpt界線](NATIVE_SYSTEM_UI.md) |
| E08 部分／差異／未驗收 | BGM／音效播放端與觸發覆蓋 | 原Sound_DX8 payload／MP3或PCM、BGM與多條動作音已有；播放端改Web Audio、需手勢解鎖、有16並發上限與冷載入deadline。未逐聲／逐事件重建DirectSound／ACM全部行為；不能說音訊都沒有，也不能說所有原聲時序已一致 | `game/audio.ts`、`client/audio.mjs`；[音訊歷史](CLIMB_AUDIO_VALIDATION.md) |
| E09 部分／未驗收 | 所有地圖／特殊場地完整行為 | tile／obj、背景平移／parallax、portal、foothold／繩梯、BGM已有，不能再稱人工地形或雲不動。MapData／MapArt並未涵蓋原CField所有環境／特殊流程；未逐地圖動態對照，不從「能載入」推定全部可等價遊玩 | `game/map.ts`、`mapart.ts`、`client/background.mjs`、`portals.mjs` |
| E10 差異 | Browser便利入口不是原功能 | 上方工具／日誌、/map、可點portal、唯讀UI／角色／怪物閱覽皆是明示便利功能；不能把它們計入原流程完成，也不應混進原UI驗收 | `client/testtools.mjs`、`mob-attack-preview.mjs`、`main.js` |

## F. 驗證、文件與工程債：不是玩法缺口，但會妨礙準確判斷

1. **最新提交未執行驗證。** 有test來源、啟動成功、歷史版本PASS皆不能證明4f9ad1b所有鏈正確；本輪也不違反使用者指示去執行它們。
2. **歷史文件有已過時的未完成敘述。** 例如「技能十招」、「快捷技能未接」、「普通KB／跳怪未做」、「起始裝備必為全零」；應按後續ADR判讀，不能不加區分轉抄成現在缺口。
3. **事件與註解索引不同步。** `ClientSession`已有mob-stat事件與handler，但`CLIENT_EVENT_KINDS`索引未列它；mobs.ts部分舊總述仍寫raw死亡長度／MP觸發hit，與最新實作不同。本輪僅記錄，不據此宣稱遊戲事件被丟失：目前未查到該索引的產品呼叫端。
4. **大型main／跨層依賴。** `client/main.js`仍整合大量玩法／視窗／輸入；server import client純規則目前是實際架構，不是已建立shared層。改一項較容易漏掉其他caller／清理路徑。
5. **保存與營運安全非完整MMO。** JSON暫存rename不等於資料庫交易／多程序協調；TLS、帳號安全、備援／監控、容量與完整反作弊尚待專門處理。協定byte-exact不代表規則安全，更不代表玩法端到端完成。
6. **證據索引不等於功能清單。** schema的partial／skeleton有些只是原版unused lookup；不能機械地把每個skeleton都當一項玩家可見缺失。

## 已補過的內容，不再誤列為「完全沒做」

| 舊說法 | 目前應怎麼說 |
|---|---|
| 選世界／選角還是HTML卡片 | 已有原WZ畫面／透明hit targets；缺的是全帳號服務與像素／焦點細節，不是整個選擇畫面沒做 |
| 繩索姿勢、登台、portal都未做 | 都已有接線；完整CVecCtrl與所有特殊邊界未全等價，不代表這三項仍完全缺失 |
| 怪物不會跳、KB只是換圖 | 普通跳怪與替換物理路徑的KB已有；缺完整AI／特殊物理與動態驗收 |
| 怪物沒有主動攻擊 | ADR-076已接info／MP／Value／effect-ball-hit；缺完整owner狀態機／aggro／monster skill等 |
| 攻擊期間一定不能KB | 原版只保護攻擊body／facing，仍可KB；已分開窗口與物理 |
| 身體碰撞與主動球命中都應扣HP | 本EXE兩條不同鏈；50DEC0只出圖有原證，不引入後版傷害 |
| 只有7或10招、所有魔法未做 | 目前12招白名單，包括Energy Bolt／Magic Claw；其餘技能仍非全開 |
| 技能快捷格／buff／party完全未做 | 七格技能拖放、4buff、party指令／名冊／邀請已接；完整視窗與全部技能／分配規則仍缺 |
| 起始劍仍一定PAD0 | 新實例生成漏接已修；舊實例保留原值，明示修復工具不是自動回填。不要用歷史故障否認現在生成路徑 |
| 殘影仍附每個body frame、固定tier0 | ADR-074已改獨立時鐘、child5／真mastery tier／命中點與世界FX；全Gr2D仍未完成 |
| Data.wz缺tile／沒有原音訊 | parser讀取漏層已修，原音訊已有產品路徑；新缺口須先查reader／caller，不拿缺素材作預設答案 |

## 建議下一階段順序（不是本輪已完成的實作）

### P1：先解整體手感與同步

- **第一鏈：A01–A07**。把玩家控制器、場地參數、碰撞、時鐘、movement wire與remote呈現放在同一份對照表，不再逐個常數孤立微調。
- **第二鏈：B01–B06**。怪物owner／狀態／目標／移動與出招，NPC自主漫步及索引矛盾；保留未知，不用自訂state表冒充原版。
- **第三鏈：C06–C07＋E01–E03**。命中／預測／接受、圖層／字型／focus，先處理能跨多個技能和視窗受益的共用差異。

### P2：恢復自然遊玩閉環

- **C04–C05＋B07／D01／D07**：自然升級點數、轉職、任務與NPC服務，先補原證再寫條件與記帳，不以/tools替代。
- **C01–C03／C08／C11**：按本版dispatch逐招／逐道具補完整消耗、數值、圖聲、remote、取消、死亡／跨圖與保存。
- **D02–D05**：把官方未知的經濟／分配／配額與可證實的客戶端行為分開，不能將「可用policy」改名為「已還原」。

### P3：完整操作面與平台／營運

- E04–E08、D06／D08／D10：社交／任務／人物服務視窗、設定、聲音觸發覆蓋，以及本版有原證的其他系統。
- F類：收斂現況文件、事件索引、大型main與保存／安全；不以架構重寫代替玩法修復。

每一鏈的完成應包含：**原證→metadata／實例→規則→wire／bridge→畫面／圖聲→remote→取消／過期→死亡／換場／重生→保存→文件**。
依既有指示，執行驗收仍留給使用者；此清單不要求使用者逐項回報，也不聲稱本輪已做執行驗證。
