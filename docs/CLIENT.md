# 瀏覽器客戶端（`client/` ＋ `serve --web-port`）

## 2026-10-18 續作：原穿戴入口與非同步戰鬥（未測試）

原4636B0順序更正，純規則共用server正反swap並原子換裝；工具明確補原武器最低等級，不改需求或自動升級。
主動attackToken回原start clock，遠端固定receipt source／z／target與entity身份；完整見[NATIVE_EQUIP_ADMISSION](NATIVE_EQUIP_ADMISSION.md)／ADR-072。


## 2026-10-18：Arrow Blow／Double Shot／Lucky Seven、彈藥與攻速消費鏈（未測試）

支援主動技能總數增至十招；原K／七鍵共用入口，依原519380近身／蹲下／彈藥不足退普通近戰。
完整接原0x10／0x24、同疊多彈藥原子扣款、Lucky Seven LUK專用公式、Skill ball／實際彈藥、14px與星鏢120ms。
0x400已證為booster，raw speed先減後clamp、body／release／server一併消費，換有效武器僅清該欄；
**沒有以猜測的2開放Booster施放**。另依55BEB0恢復ACK重設200ms gate，不以RTT優化刪除原行為。
細節、原碼／WZ與重建政策、仍缺項見[NATIVE_RANGED_SKILLS](NATIVE_RANGED_SKILLS.md)／ADR-071。
未執行測試／typecheck／語法／browser／VM／probe，啟服亦非PASS。


## 2026-10-18：七個主動技能與完整入口鏈（未測試）

本批 Power Strike／Slash Blast／Double Stab、Iron Body／Magic Armor／Focus／Rage。
K雙擊已學技能列、圖示拖七鍵、原WZ算術／消耗、近戰多段／時間、增益期限／跨圖餘時、party邀請已接。
原0x1E與0x29 type1尾一起補；0x1D仍是SP，0x1F不是取消。
Focus20的acc是BSTR，原VariantChangeType接受；hs的MP文字與真值矛盾時不用文字算。
完整證據、數值分類、操作及尚缺技能見[ACTIVE_SKILLS](ACTIVE_SKILLS.md)／ADR-070。
沒有執行測試或probe，也不宣稱全技能／全Gr2D／原server已1:1。

## 2026-10-18：蹲下／蹲刺／警戒、攻擊雙時鐘與被動射程（未測試）

交叉原5426F0、50D700、512EE0／512F90、508690／508700／50B590、4BD3C1／513C80及WZ。
地面Down→prone；Down＋Ctrl→獨立32，不隨機混進站立攻擊、不耗彈、不假造徒手劍揮。
普通／射擊／空中強制攻擊遮蔽輸入，32保留Down但原guard禁止誤抓平台頂繩梯；警戒從接受攻擊起倒數3000。
拆開30ms逐幀身體時長與raw release；server／remote一起接；移除假160×3動畫／90×72×36範圍。
自然恢復讀body ID，修正繩梯36/37與jump35的編碼；原range被動接射程，不再永遠200。
補動作／姿勢合法性、move→attack寫入排序、晚加入姿勢／foothold、資源快取與冷攻擊sfx；不改玩家存檔。
`/tools`的唯讀閱覽加入普通近戰／32／射擊與弓弩拳套、分層特效／時間數值，無發包／耗彈／音效。
詳細硬編碼分類、證據、未知與server政策見 [NATIVE_POSTURE_ATTACK](NATIVE_POSTURE_ATTACK.md)／ADR-069。
仍非完整CVecCtrl／CShape2D／技能／全global30ms相位；未執行測試、typecheck、語法、browser、VM或probe。

## 2026-10-18：普通身體動作／武器姿勢／繩梯停格（未測試）

原武器info.walk／info.stand獨立決定walk1/2與stand1/2，雙手劍不是一律walk2。
讀原WZ幀序列／delay，站立與alert反向；依50B590與UI424740減30、到期換幀、捨棄overshoot。
繩梯倒數耗盡後按實際整數Y持幀，不用vy殘值；轉向／換裝／死亡復活／場地／斷線與offscreen一起接。
選角／創角共用，不再有100ms走路或500ms三格循環的第二套時鐘。
體驗工具新增獨立actor的唯讀動作閱覽，可比較三種武器與繩梯；不送遊戲操作、不給物品、不改save。
[NATIVE_AVATAR_MOTION](NATIVE_AVATAR_MOTION.md)／ADR-068；只呈現普通動作，不宣稱全部物理／強制技能／本機alert產生完成。

## 2026-10-18：臉部／眨眼／表情／臉飾（未測試）

臉部不再固定emotion/0或跟body frame跑。依原509070／509560／50B590與Gr2D／WZ接獨立時鐘、
2–5秒待機及1–3次眨眼、一般5000ms／WZ duration與受傷1500ms、vomit多幀及101同表情配件。
選角／創角／本人／旁觀者共用，換裝／換場／斷線與舊echo處理；F1–F7與按鈕共用guard，長按不重送。
另追完495F70 OR attr2 →539900→5398B0→520950，遠端受傷沿原movement relay，不造新HP／emotion packet。
API metadata、faceFrame合成／PNG cache／預熱、異常輸入與回歸來源一起補；沒有執行測試或登入probe。
詳細證據、未精確復刻的Gr2D／全movement界線、新隔離LIVE帳號見[NATIVE_FACE_ANIMATION](NATIVE_FACE_ANIMATION.md)／ADR-067。

## 2026-10-18：原道具／裝備／技能提示框（未測試）

按 CUIToolTip `5014C0/502780/5029A0/503210/5034E0/503840/503AF0/504480/525AE0` 與 listing、WZ 交叉還原。
背包、穿戴、商店、快捷道具與技能窗共用 renderer，不再用中文價格／數量／模板能力列表冒充原 tip。
新增需求 Can／Cannot 原圖字、normal icon 兩倍與 origin、原職業遮罩字色、性別／CUC 標題、signed 實例能力、
目前／下一級 hs、runtime 字型行高與各 caller anchor；資料更新後重命中，modal／拖曳／失焦清理舊 hover。
裝備需求逐項比有效 BasicStat，只有商店買入明確用模板；讀不到持有 instance stats 不回退到 WZ。
工具新增唯讀提示框閱覽，初心者不用套配置就能看技能 0／1／MAX。合成比較值與 CUC 明確標示，不改角色。
仍不代表技能施放、卷軸、cash／pet、任務腳本或完整原 GDI 字型已完成。
詳 [NATIVE_RICH_TOOLTIPS](NATIVE_RICH_TOOLTIPS.md)／ADR-064；新來源未執行，不以啟服當 PASS。


> `client/` 是目前唯一的客戶端實作主線：Canvas 2D 繪圖、DOM 輸入／命中層、Web Audio，
> 由 `serve --web-port` 直接提供，不是等待另一套引擎客戶端取代的暫時視窗。
> 完整還原仍在進行；本頁逐輪紀錄有歷史性，現行架構見 [ARCHITECTURE](ARCHITECTURE.md)，
> 工作優先序見 [ROADMAP](ROADMAP.md)，技術方向見 ADR-065。舊 PASS 不代表後續改動已驗證。

## 最新實作：NPC圖文內容與選項（2026-10-18，未測試）

補 `#i` 普通道具圖、`#s` normal技能圖、原尺寸／行底對齊／不同row高度、圖文與純圖選項／名稱tip。
`##` escape、整段量測折行、掛行／續行空白；實際高度連到命中、底線、捲動、鍵盤reveal與可及文字。
資源去重／4併行／128成功快取、首輪PNG等待；close／換圖／死亡／斷線取消、modal identity guard，字型到達保留輸入／焦點。
回覆端重新解析目前body，escaped `##L` 不再誤算有效選項。新增兩個唯讀入口；不是任務、沒有新增原server腳本。
[NATIVE_DIALOGUE_RICHTEXT](NATIVE_DIALOGUE_RICHTEXT.md)／ADR-063；未執行test/check/typecheck/語法檢查/browser/VM/probe，啟服非PASS。

## 前輪實作：NPC idle／speech／controller（2026-10-18，未測試）

靜止NPC依原池與4–12秒抽選，由單一控制者送2F、全體含sender等3D才演出；controller離圖交接。
forced單次播放、30ms逐格、原normal五秒深紅氣泡／height錨點／隱藏名牌；場地／斷線／冷art清理。
動作圖link merge與行為metadata一跳link替換分開；signed索引不排序、不丟空槽。
**原sender+2／receiver raw guard/speech不一致仍未解**；透明relay與owner選擇明示為重建政策。
不宣稱全額外表情／原server／自主NPC走路完成。體驗工具→40000 Robin（69,275）＋唯讀NPC控制／回包資料。
[NATIVE_NPC_BEHAVIOR](NATIVE_NPC_BEHAVIOR.md)／ADR-062；未執行test/check/typecheck/語法檢查/browser/VM/probe。

## 前輪實作：NPC原動畫時間、CUtilDlgEx2與對話回覆（2026-10-18，未測試）

NPC缺省frame180ms；原Ex2八片邊框／七筆FillRect／Close2／按鈕／普通300及輸入230文字區。
保留say兩旗標，Prev回0、Next或OK回1、ESC／Close回FF。五種body完整到JSON，實際kind回0x15，
補CP949 byte-length、-1無上限、number／menu驗證、長文scroll、焦點／IME／modal隔離。
點擊info.speak逐頁是本地政策，不是原quest腳本；後續ADR-062已接NPC待機／controller，原server索引轉換與CVecCtrl仍缺。
體驗工具→「對話窗範例」可直接開五類唯讀UI；標示非原版，不發0x15或角色寫入。
來源、browser替代與完整未完成界線見 [NATIVE_NPC_DIALOGUE](NATIVE_NPC_DIALOGUE.md)／ADR-061。
**未執行測試／check／typecheck／browser／VM／probe；啟服不是PASS。**

## 前輪實作：原游標、NPC 命中／名牌與滑鼠互動（2026-10-18，未測試）

原 `UI/Basic.img/Cursor/arrow`，24×23／origin 0,0；此版本沒有後期 hand/pressed/move。
透過 browser cursor plane 顯示，覆蓋遊戲與透明 DOM 控件，沿用既有 CSS scale，不做 RAF 追鼠 sprite。
NPC 使用原 dc* 框（未指定時 -22,-65,22,0）、info.name 黃色名牌與 linked 動作素材，不再用猜測的大點擊框。
原 navy 提示框切角／keyline／邊界；item／skill 仍是 compact 內容，不聲稱完整原 icon／分區排版。
補 Canvas CCtrlButton 的狀態／進入音效與 logical down/up 配對；拖窗 release 不再執行兩次並抹除 click suppression。
blur／pointercancel／隱藏分頁取消拖曳／pressed，清舊 hover、移動鍵與 cold-action ticket；不提交物品操作或接受對話。
[交叉來源、方便入口、仍未完成範圍及保存紀錄](NATIVE_CURSOR_NPC_POINTER.md)／ADR-060。未執行測試／typecheck／browser／VM／probe。

## 前輪實作：原GameOpt、公開聊天氣泡與密語拒收（2026-10-18，未測試）

Menu→게임 옵션接原166×246視窗與六項位置；miniMap／whisper可操作，即時套用、OK本機存／Cancel還原。
公開聊天用原0x1F id+text，含自己且限同圖，白字log＋normal/dead五秒WZ氣泡；密語另為0x1A/0x12綠字。
關閉whisper時依原23/22拒收，仍記回覆對象；server限定真delivery的receipt，不能用任意名字偽造通知。
三秒shared find／whisper gate、64換行record／reader五秒追尾、輸入Esc／空字串左右鍵退出、IME與cold-action guard。
原13/type0系統公告淡黃，不再假裝System寄密語。沒有執行測試／typecheck／browser／VM／probe。
完整證據／方便入口／未完成範圍見 [NATIVE_GAME_OPTIONS_CHAT](NATIVE_GAME_OPTIONS_CHAT.md)／ADR-059。

## 前輪實作：原版 Menu／SysOpt、快捷格拖移／清除與收件人模式（2026-10-18，未測試）

依PE vtable與原52C8E0／52D800接原視窗、CLOSE／六列按鈕與音量／mute控制項。
兩組20段／預設15=80%／最低5%，獨立靜音；preview、OK本機保存、Cancel／Escape還原，不重播BGM。
Escape按原Item→Equip→Stat→Skill→Menu；Menu Quit關目前連線回標題，不刪角色；未實作四列明確disabled。
補消耗品快捷格互拖覆蓋與拖到空白場景清設定，不移格或丟棄道具；保留profile／field／庫存快照guard。
接CUtilDlgEx recipient輸入、上次名字／everyone切換、CP949 4..12 bytes／字符／self檢查，與原左下recipient格。
普通文字依recipient送悄悄話，slash command仍可用；IME組字Enter不誤送。補modal與本機cold-attack互動ticket。
沒有test/check/typecheck/browser/VM/probe；原hover動畫timing／GDI字形、DirectX畫質／截圖、GameOpt／BtChat／技能快捷施放仍缺。
見 [NATIVE_SYSTEM_UI.md](NATIVE_SYSTEM_UI.md)／ADR-058；沿用原save、停服冷備份後開LIVE。

## 前輪實作：原版 root／child 圖層與裝備遮擋（2026-10-18，未測試）

Gr2D 10013D40／100137B0 確認同z用序號而非y，overlay parent先比，不把角色兩面拆成global z±2。
補本機controller+2、空中page/group記憶、背景index深度與HTTP欄、bullet來源z、傷害／MISS固定層。
接zmap明示數值與smap／islot／vslot的一般裝備遮擋，移除正面多補backHair；雙面packed PNG以同origin畫
back→afterimage→front，Tomb child−1與名字child5不再當獨立世界層；名字改回腳下A0黑底。
遠端攻擊等圖ready、沿原事件時鐘，不在過期後重播。新增103000000授權圖層捷徑，沿用save不自動改角色。
未做test/check/typecheck/browser/VM/probe。完整CAvatar blocked-slot／cash、原Gr2D排程、UI focus仍未還原。
見 [NATIVE_LAYER_PRIORITY.md](NATIVE_LAYER_PRIORITY.md)／ADR-057。

## 前輪實作：跳躍怪／攻擊姿勢／移動雲層（2026-10-18，未測試）

補原動作子樹能力分類、無目標roam起跳與server ordinary air路徑、0x33 jump／0ms落地、
browser動作／中途進場／戰鬥位置／死亡重生；link動作圖與原模板數值分離。飛行／追擊仍未完整實作。
攻擊按實際arm身份求hand、等待所選原圖／afterimage decode，不任意改攻速；移除無武器假480ms劍姿勢與bridge未知action替換。
修movement/body action混表：jump6／ladder14／rope16，含發送、remote、繩梯深度；dead18不變。
修待機0→1→2→1、type4按field clock水平移動與大origin重複；聊天輸入上限補70。
體驗面板新增104040000跳躍怪／雲層捷徑，只在既有權限下點擊才移圖，不自動改進度。
沿用同save，停服冷備份後重啟；不跑test/check/typecheck/browser/VM/probe。
見 [NATIVE_JUMP_ATTACK_BACKGROUNDS.md](NATIVE_JUMP_ATTACK_BACKGROUNDS.md)／ADR-056；非完整CVecCtrl／CShape2D／全遊戲1:1。

## 前輪實作：原版截圖交叉核對 HUD／地圖名／聊天／快捷格（2026-10-18，未測試）

以原800×600遊戲內容而非 Windows 外框比對。補 EXP151px／整除／百分比、人物欄黑字；
PE 5B3A00 確認本輪來源字體為 **Gulim（굴림）**，不是舊註解的 Dotum。補 HP/MP/EXP hover數值。
接 WZ街名／地圖名／mark → HTTP artJson → 右上兩行白字黑影與原徽章；不硬編截圖地圖。
聊天改原434×84／六列與原 VScr捲軸，輸入位置修正；悄悄話按鈕先提供明示 browser `/w`捷徑，非原收件人窗。
補七格消耗品拖入／itemId去重／數量合計／最低slot使用、原normal icon與ItemNo位圖；設定為本機帳號角色profile。
只有200/201/202可綁，不把技能學習當施放；當時缺的消耗品互拖／拖出、Menu／收件人窗已在ADR-058接上（未測），BtChat仍缺。
沿用原save／角色，不自動修裝備／建角。未跑test/check/typecheck/browser/VM/probe。
見 [NATIVE_HUD_CHAT_QUICKSLOTS.md](NATIVE_HUD_CHAT_QUICKSLOTS.md)／ADR-055。

## 前輪實作：全零起始裝備／傷害資料鏈修補（2026-10-18，未測試）

原案例STR29但起始劍PAD0，Detail只剩29，原傷害公式乘0後clamp為1；不是把最低傷害強行調高。
補478270→47A740的tuc及15項inc*，新建角／新掉落／商店用同一WZ裝備工廠，既有實例仍保留。
修Character裝備價格與單件count；商店tooltip可看模板，背包／穿戴物即使0值也不以模板替換。
工具新增需確認的「修復舊全零起始裝備」，只限MakeCharInfo清單與全零／無升級特徵；不自動migration。
另顯示有效PAD及同次傷害trace，分辨MISS／PAD0／防禦等原因，不改原Detail與傷害算式。
沿用原save／角色；未執行測試或瀏覽器驗證。見 [NATIVE_EQUIPMENT_DAMAGE_FIX.md](NATIVE_EQUIPMENT_DAMAGE_FIX.md)／ADR-054。

## 前輪實作：Tomb／ghost、canvas alpha 與外力 relay（2026-10-18，未測試）

補原fall前800ms→land全1050ms→持末格；avatar繞行2000ms、淡出2500ms，新死亡立即spatial音效，
既死進場不重播。遠端action18優先於swing、leave／field／close清狀態；Tomb進原z-space scene。
補canvas.props的a0/a1、缺省alpha繼承、one-shot精確終點；portal缺省120ms及field初始動畫clock。
修正上一輪bodyAttack有讀卻沒進HTTP，導致網頁排除接觸怪物的漏接；未以舊bridge測試冒充網頁驗證。
外力attr2沿原0x0E／0x22傳送，0ms record不延長、facing依action低bit，不按位移翻臉。
工具增加confirmed 1HP入口，新LIVE為獨立新存檔。原檔來源、操作及明確未完成見
[NATIVE_DEATH_ANIMATION.md](NATIVE_DEATH_ANIMATION.md)／ADR-053。
未執行test/check/typecheck/browser/VM/probe，仍非完整CVecCtrl／CShape2D及原30ms同步。

## 前輪實作：原怪物碰撞、受傷／MISS、外力與復活（2026-10-18，未測試）

目前格lt/rb／swept／491FF0內縮、bodyAttack、獨立stream2的4C8ED0、原負0x1C回報→0x0D血量，
紫色字圖／MISS、signed 1500ms保護、bounded外力、hit表情；EVA藥水已接實際迴避。
修正表情未進URL/cache與canvas delay漏讀；死怪動畫優先，碰撞與普通矩形篩選改共用當前格。
死亡使用dead格／18|facing，>2200ms原Notice窗，OK／Enter送kind0、等原field復活。
工具有明示迴避領藥、盜賊填值與唯讀EVA／PDD／保護tick，不自動改角色。
本輪新獨立save，不冒稱恢復不在沙箱的舊進度。完整來源／政策／未完成與未執行回歸見
[NATIVE_CONTACT_REVIVE.md](NATIVE_CONTACT_REVIVE.md)。沒有執行任何測試、typecheck或瀏覽器驗證。

## 前輪實作：有效能力、原 Detail 與普通物理攻擊（2026-10-18，未測試）

S→Detail 啟用原176×192面板，主窗／詳情／實際攻擊／移動共用有效裝備集合；裝備HP/MP上限接恢復與補藥。
普通物理改用新定位4C7960的命中、武器動作、PD與mastery，傷害／MISS改用原NoRed圖；不再走舊近似式。
PAD/ACC藥水已接實際效果；工具勾選後可各領3瓶。當輪EVA只有合計；本輪碰撞與迴避已接，見上節。
不是全技能／全域RNG逐步一致；未執行測試／typecheck／browser／probe。詳見 [NATIVE_STATS_COMBAT.md](NATIVE_STATS_COMBAT.md)。

## 最新實作：原加速藥水／暫時能力與裝備移動值（未測試）

- 原0x0D tail實為duration／mask／s16 values／來源，已更正舊誤判並接上client；原iconRaw、32px右排、y45、alpha210。
- `2002001` 原speed8／180000ms改實際移動，重喝覆蓋／刷新、換圖保留deadline，到期清掉；
  穿戴裝備實例speed/jump依原兩階段clamp，非cash外觀／非WZ模板覆蓋。
- 體驗工具勾選後可明確發3瓶（會存檔，能力還原不回收），另有唯讀速度與剩餘秒數。
- 本輪另接 PAD/ACC；其餘無消費者的戰鬥buff仍整筆拒絕，完整CVecCtrl／CShape2D與技能施放未完成；本輪另接矩形碰撞受傷。
- 不執行測試，只啟服務。來源、斷線政策與步驟見 [TEMPORARY_STATS.md](TEMPORARY_STATS.md)。

## 最新實作：自然恢復與方便體驗的獨立工具（未測試）

- 558950 的獨立30ms HP／MP計時、站立／繩梯條件、1000000.hp／2000000.mp／1000002.time、地圖recovery；
  原0x1C固定0x1400 flags、另一delta補0，等0x0D回值才動數字。主動施放／其他被動／buff仍缺。
- 上方「體驗工具（非原版）」／`/tools`：查原地圖、明示配置職業／AP／SP、補滿／半血半魔、能力／技能還原點。
  在原畫布之外，不冒充原版UI；預設off，帳號獨立授權，只有確認後才修改／保存。
- 沿用同一進度，不重seed；第一個變更前自動建記憶體還原點，不跨重啟／不回溯EXP道具金錢，升級保護。
- **沒有執行任何測試／typecheck／browser／probe**；依使用者要求只啟服務。來源與步驟見 [RECOVERY_TEST_TOOLS.md](RECOVERY_TEST_TOOLS.md)。

## 最新實作：原技能窗與 SP 學習（未測試）

- K／HUD Skill 開啟原 176×315 CUISkill，四行與 I–IV 真 WZ 書、前置／滿級三態、原圖示與 SP 按鈕。
- 支援 tabs／鍵盤、捲軸／滾輪／拖曳滑塊、標題拖窗保存、modal 隔離；tooltip 的舊簡化版已由 ADR-064 原 type5／目前下一級版型取代，仍未做字型／像素驗收。
- SP 經原 0x1D／0x0E、500ms／pending、server 檢查、保存與已學 snapshot；同一 map32 接入成長被動。
- 職業名稱改讀原 PE 表，不再套後期名稱；初學者沒有書，現有隔離角色／SP／進度不變。
- **主動施放／快捷鍵拖放、其餘被動與 buff 仍未完成，不將學習紀錄冒充技能效果。**
- 本輪沒有執行測試、typecheck、browser 或 probe；完整來源／政策／差異見 [SKILLS.md](SKILLS.md)。

## 最新實作：原武器基本動作／弓弩拳套射擊（未測試）

- Ctrl依原normal動作表及WZ每幀delay；有近敵／無彈保留近身路徑，有彈無近敵則射擊，空射也扣1發。
- 弓／弩／拳套讀各自動作與bullet素材；原0x10、旁觀0x24、庫存／0發飛鏢／補充生命週期已接通。
- 弩shoot2五幀、2型武器待機行走、原afterimage附件；命中數字／基本shot傷害等待飛行。
- **沒有執行測試／typecheck／瀏覽器**。碰撞／傷害／server排程仍有明示重建政策，並非全職業完成。
- 詳見 [BASIC_ATTACKS.md](BASIC_ATTACKS.md)；原版證據、具體限制與未執行測試來源分開列出。

## 最新實作：背包捲動／地面丟棄／商店數量（未測試）

- 超過24格的背包可用原捲軸／箭頭／滾輪，四個分頁各記自己的列，命中仍用真slot。
- 背包道具拖到場景：一般堆疊詢問數量；裝備／單件直接丟1、飛鏢整組，4031先確認。
- 商店買入／賣出改用原UtilDlgEx數量框：買預設1、賣預設整疊，可選部分；0x4B解除pending。
- 換圖／死亡／斷線取消數量框，送出前重查原slot；成功交易立即保存，WZ cash道具不可丟。
- **依使用者要求，本輪未執行任何測試或TypeScript檢查**。下方570等數字是歷史結果，並非本次驗證。
- 原版函式、操作與未完成界線見 [INVENTORY_OPERATIONS.md](INVENTORY_OPERATIONS.md)。

## 最新新增：背包拖放與原裝備窗（2026-10-17）

- **E／原EQUIP按鈕**開原176×315裝備窗；背包換位／互換、雙擊一般裝備穿戴、拖入部位穿戴與拖回空格卸下。
- 原0x17→0x0B落帳與立即保存；本人外觀及旁觀0x28同步。原需求檢查、500ms／非零ack gate、instance裝備能力／升級次數已接。
- 校正CConfig預設：背包(24,24)、裝備(48,48)、能力(72,72)。114/128,9是Close座標，不是視窗位置；
  新profile背包預設裝備頁，選過分頁／拖過的位置保存於localStorage。
- **570/570＋TS通過**，雙頁Chromium穿脫／外觀／重連／保存及既有功能回歸通過。
  範圍與差異見 [EQUIPMENT_VALIDATION.md](EQUIPMENT_VALIDATION.md)。
- 目前預覽為**隔離QA服**gear/gear、watch/watch；本工作環境未保有前輪/tmp正式存檔，未建立空白正式角色替代進度。

## 最新新增：清晰縮放＋原版小地圖（2026-10-17）

- 上方「清晰整數像素」（預設）／「原尺寸800×600」／「填滿視窗」可切換並記憶。
  保留800×600 backing與操作座標；預設依DPR取整數實體倍率，canvas／DOM一起對齊。
- 已實測舊fit的非整數倍率會使單像素寬度不均，**不是已證實雙線性混灰**；原素材柔邊與非原Dotum字型仍有差異。
- 原版 **M 小地圖**：八片原框、原bitmap 1:1、native crop、黃自己／紅玩家／綠NPC／藍可見門、原閃爍節拍。
  可拖曳保存，不吞背包／商店上層點擊；原圖沒有miniMap node就不造圖（100張中80有、20無）。
- 完整 **564/564＋TypeScript PASS**；五種DPR、真小地圖操作與傳送／繩頂登台回歸通過。
  原函式、精確尺寸與限制見 [DISPLAY_MINIMAP_VALIDATION.md](DISPLAY_MINIMAP_VALIDATION.md)。

## 最新修正：傳送門／繩頂與地圖命令（2026-10-17）

- 原版 **地面按 ↑** 使用 type1/2 門，type3 自動傳送；500ms＋0x19 pending gate。
- `tn` 指向的目的門已寫進 CharacterData+101 並保存，前端／伺服器／其他玩家落點一致，不再永遠 sp。
- 繩頂改回原 `sub_542DF0` 的 y1−5；八條真繩、三種刷新率及 Chromium 真登台穩定性均通過。
- `/map ID`（`/warp`、`/go`、`/헉맵`）、`/maps [關鍵字]`、`/where`、`/help`；
  map ID 0 有效。命令走原 0x0D，伺服器 `--map-command admin,alt` 明確授權，預設 off。
- 聊天 Enter 後正確退出輸入焦點，不再重新 focus 而鎖住方向鍵。
- 完整 **561/561＋TypeScript PASS**；原版來源、隔離 Chromium 與未完成項目見
  [PORTAL_CLIMB_VALIDATION.md](PORTAL_CLIMB_VALIDATION.md)。

## 本輪新增（2026-10-17）

- 原狀態列 **Stat**／**S** 可開能力窗；原 WZ／字座標、拖曳記憶、Close／Escape。
- **已有 AP** 可真分配 STR／DEX／INT／LUK／HP／MP，native c2s 0x1B → s2c 0x0D → 保存／重連；不是只加畫面數字。
- 靜態 scene 預排序／可見像素裁切／lazy PNG／跨圖快取及 blob 釋放；短樣本 drawImage 約 794→130/frame。
- 修正合併到達的進圖／pool／stat 順序，及升級 EXP 分母和戰鬥能力 snapshot 同步。
- **本次新接（未測試）**：原表自然 HP／MP 成長、已學被動 x/y、HP／MP AP 與立即保存；完整來源、更正與隔離帳號見 [STAT_GROWTH.md](STAT_GROWTH.md)。
- **後續更新**：技能學習／SP、Detail／有效裝備與部分buff已接（均未測）；自然AP/SP發放量、轉職、完整技能buff仍未完成。
  S 不再兼作向下移動，下繩索用 ArrowDown。來源、實測與差異見 [SMOOTH_STAT_VALIDATION.md](SMOOTH_STAT_VALIDATION.md)。

## 怎麼跑

```sh
cd server
node src/cli.ts serve \
  --port 8496 --game-port 8497 --web-port 8495 \
  --account admin:admin,alt:alt,newbie:newbie \
  --data ../Data.wz --start-mesos 200 --ping off
```

`--web-port` 是**頁面自己**的 port（HTTP＋`/ws`），另外兩個是 2003 協定的 TCP port。上面這組把頁面
放在 `8495`、login 放 `8496`、game 放 `8497`：預覽環境給使用者的網址就是 `https://<port>-<sandbox>`，
所以頁面拿第一個號碼；換一組號碼也完全可以（三個都要給，而且 `--web-port` 少了 `--game-port` 會被
拒絕——`0x03` 回包裡的位址瀏覽器用不到，ADR-034 決策 1）。`--data` 不給的話會找工作目錄的
`./Data.wz`。

打開 `http://127.0.0.1:8495/`，用 `admin:admin` 登入，選世界、選角色。

一個**空帳號**（例如 `--account newbie:newbie`）在選角頁下方有「建立角色」：輸入名字按下去，頁面送
`0x06`（十個外觀字）再送 `0x05`，新角色就出現在清單裡——這是 2003 client 建立角色的那兩包，沒有另開
後門。名字重複時伺服器的 `0x06` 會回「已取用」，頁面照實印出來。

在同一個伺服器上再開一個分頁、用 `alt:alt` 登入，兩個角色就會在同一個地圖看到彼此。

傳送點的原版操作是站在地面、靠近後按 **↑**（type1 隱藏門／type2 可見門）；type3 在範圍內自動觸發，
不必按 ↑、不必落地。可見門使用原 `MapHelper` 動畫；滑鼠點擊另保留為瀏覽器便利操作，並非原版唯一方式。
目的地由伺服器讀 `tm`／`tn` 決定；角色紀錄的 +101 帶正確目的門索引，`sp`（type0）不可當出口。

聊天指令由頁面轉成原封包，文字本身不作場地聊天：

| 輸入 | 做的事 |
|---|---|
| `/map ID`（`/warp`／`/go`／`/헉맵`） | 原 c2s 0x0D `[s32 mapId][empty name]`；需 `--map-command` 帳號授權，預設禁用 |
| `/maps [關鍵字]` | 從真 Data.wz 查 ID／地圖名／區域名，最多顯示20筆 |
| `/where`、`/help` | 現在的地圖與座標／命令說明 |
| `/w 名字 訊息` | c2s 0x23 kind0x06 密語；原 CP949 bytes |
| `/f 名字` | c2s 0x23 kind0x05 找人；回地圖 ID 或 −1 |

串流上面那一排按鈕是**表情**（`0x13`）：2003 client 用 F1–F7 送 1–7，目前也在場地可操作時攔截這七鍵；
瀏覽器／OS仍保留某鍵時可用同樣七張臉按鈕。0（中性眨眼）與 8 沒有對應的鍵，頁面也就沒有按鈕。

點 NPC 就是 `0x33`（`{t:"click",objectId}`），回來的可能是**商店**（`0x4A` → `CShopDlg`）或
**一句台詞**（`0x47` → 下面的對話框）。哪一個由伺服器決定：商店是 `game/shops.ts` 的表，台詞是
`Npc/<id>.img -> info/speak`，頁面兩者都不知道。

商店也是**畫在畫布上的原版視窗**：`UI/UIWindow.img/Shop/backgrnd`（407×291）貼在原版置中的
`(196,154)`（`sub_461C50` → `((800-w)>>1, (600-h)>>1)`）。左邊 6 列是店裡的貨、右邊 5 列是
**自己的背包**：右欄上緣那個 198 px 的深藍條就是原版的 `CCtrlTab`（id 1003，`sub_4B5A00` 之前
建立），四個分類 장비／소비／설치／기타 用 `UI/Basic.img/Tab` 的 `left`／`middle`／`fill`／`right`
拼出來（亮起的分頁白、隔壁那片用 `middle2` 的漸層），切換只影響右欄。按鈕是同一張圖的
`BtBuy`／`BtSell`／`BtRecharge`（hover 換 `mouseOver`、按下換 `pressed`），右上 `CLOSE` 是圖上的
章。**點右欄一列**選取要賣的東西（`sell` 188×34 的選取臉貼在原列上），**팔기** 開數量框（預設整疊）、
**충전** 對未滿的207飛鏢先原Yes/No確認再送recharge；費率／容量取WZ，0發組保留，詳見 `MESO_RECHARGE.md`（未測試）。**사기** 或**雙擊左列**開購買數量框（預設1、最大該列maxCount）。列數超過可視行時
左右各出現一條 `UI/Basic.img/VScr` 的捲軸，滾輪也能捲。視窗可拖曳（位置記在 `localStorage` 的
`kms111.shopAt`）。對話框的「確定」是主要按鈕（下一句），「關閉」是次要按鈕（結束）——跟 2003
client 的兩個按鈕一樣。

按 **`I`**（或右上「背包」）打開的背包是**畫在畫布上的原版視窗**，不是 HTML 面板：
`UI/UIWindow.img/Item/backgrnd`（162×315）預設貼在CConfig type0的(24,24)；
`sub_506440(this,0,114,9,1)`的114,9是Close按鈕局部座標，不是視窗位置。格子
（4×6、32 px、間距 35）、捲軸與下面 meso 欄都是圖上原本的；分頁標籤是 `sub_4DA440` 加到
`CCtrlTab` 的四個（장비／소비／설치／기타，依 `CharacterData.inventories` 的 equip／use／install／
etc 順序）。圖上第一格分頁是「亮起」的版本，頁面把同一張圖的亮起版（x=2）與平常版（x=36）蓋到
目前分頁上，讓選取狀態跟著換。**點分頁**切換、**點格子**選取並顯示道具說明、**雙擊消耗品**使用
（頁面送 `0x18`，203 家族的地圖卷軸送 `0x19`，跟 2003 client 的 `sub_462DC0` 同一個分流）、
**雙擊一般裝備**穿戴，或拖到E裝備窗的對應部位；已穿戴物拖回空格卸下。
**拖曳格內道具**可換位／互換，**拖曳視窗背景**可移動（位置存在 `localStorage`，對應原版存在 registry 的版面表）。喝不喝得到藥是
**伺服器**決定的，畫面只跟著回來的 `0x0B`（少一瓶）與 `0x0D`（HP 動了）走。數量與可升級次數
（`ruc` 是 0 時不印那個 0；先前starter全為0是生成漏接，本輪已補WZ值）畫在格子右下角。名字、描述與圖示不在
線路上：`0x0B`帶id／數量與裝備instance能力，但不帶名稱／描述，所以頁面向 `GET /api/item/<id>` 與
`GET /api/item/<id>/icon.png` 問，伺服器讀的是同一份 `Data.wz`（ADR-037）。查不到就只印 id——
不猜名字。裝備模板另含equipment.stats／ruc，僅供新物品與無實例的商店tooltip；背包與穿戴仍以原實例為準。

## 原版登入主畫面

進站先畫 `UI/Login.img/Title/backgrnd`（800×600），不是黑底 HTML 登入卡片。
`CTitle`／`sub_4D0000` 建立的 197×169 金屬選單在 **(302,358)**；`CUITitle`／`sub_4D05A0`
的四顆按鈕是選單內 (54,36／65／94／123)，直接使用 `BtNew`／`BtContinue`／`BtHomepage`／
`BtQuit` 的 normal／mouseOver／pressed 圖。版本字樣 `Ver. 1.11` 右對齊 (796,584)。

**이어하기** 打開 `Title/loginDlg`（306×169），`sub_461C50` 置中為 **(247,215)**。
`CUILogin`／`sub_4CEEC0` 的帳號與密碼輸入框分別在視窗內 (85,37)／(85,63)，176×14。
輸入框是真正的透明 HTML input，以 `#game-ui` 跟畫布等比縮放；金屬面板、查詢／確定／取消按鈕與
CheckBox 都是 canvas 上的 WZ 圖，不另外畫 CSS 視窗。Enter 可由帳號移至密碼並登入，Escape／取消
回到主選單，Tab 焦點留在登入視窗。連線中鎖定重複提交，失敗後可重試，舊連線的遲到事件不能覆蓋
新連線狀態。「記住帳號」只存 `kms111.loginUser`，**從不儲存密碼**；登入成功／取消時清空密碼欄。

這個重建伺服器沒有官方註冊／帳密查詢服務，這些按鈕會明確說明；瀏覽器也不能關閉不是由程式開啟的
分頁，所以「結束」提示直接關閉分頁，不假裝已結束程式。登入後的世界／角色選擇已改為原 WZ 畫面，
先選取再按原版確認按鈕；詳見 `FACING_SELECTION_VALIDATION.md`。建立角色現已接上原 newDlg、
男女各六組 MakeCharInfo 選項、預覽、Check 名稱與骰點，刪除須經原 YesNo 確認並真正持久化。
見 `CREATION_VALIDATION.md`；這不代表其餘遊戲系統已全部 1:1。

## 畫面上有什麼

畫面就是 2003 client 的 **800×600** 視野（`#view` 的內部尺寸固定，CSS 等比呈現、置中，
預設清晰整數實體像素模式，另有原尺寸／填滿；`image-rendering: pixelated`）。所有圖片都是伺服器直接從 `Data.wz` 解出來的 PNG，頁面不做任何
「用色塊代表角色」的替代。

| 元素 | 來源 | 誠實說明 |
|---|---|---|
| 背景（Back） | `GET /api/maps` | `[{id,name,streetName}]`，真 WZ 的只讀地圖清單，lazy cached |
| `GET /api/map/<id>/art` 的 `backs[]` ＋ `/api/png/<path>` | 依 WZ 的 `bS/no/x/y/rx/ry/type/cx/cy/a` 畫；`type` 1／3／4／6 橫向鋪、2／3／5／7 縱向鋪，`rx/ry` 是視差百分比，`cx/cy` 覆寫鋪貼間距 |
| 圖塊與物件（Tile／Obj） | 同上 `sprites[]` | 每一筆都有 `layer`（0–7）、`z`、`flip` 與動畫 `frames[]`；角色依foothold page/group排序；local比remote/mob多2。子圖層依父層分組，不是固定`CHARACTER_LAYER` |
| 傳送門 | `MapHelper.img/portal/game/pv` 的動畫 | 只畫 `pt == 2` 的可見傳送門（`pt == 0` 是出生點、`pt == 1` 是隱藏通道，原版都不畫） |
| 選角畫面 | `/api/avatar.png?face&hair&items&stance=stand1&frame=0` | 每個角色列都放上他自己的站立幀（`0x02` 的角色清單已帶 face／hair／worn ids），不是文字佔位 |
| 一張圖的尺寸與原點 | `/api/canvas/<archive path>` | 沒有 frame 表的圖（掉落的金幣堆 `Item/Special/0900.img/0900000X/iconRaw/N`）需要 `width/height/ox/oy`，PNG 本身帶不了 |
| 自己與其他玩家 | `/api/avatar.png?face&hair&items&stance&frame&flip` | 伺服器用 `Character/*` 的 canvas 依**身體的錨點**（`navel`／`neck`／`hand`／`brow`）組出一張 PNG，回傳的 `x-frame-dx`／`x-frame-dy` 是它相對腳底的位置 |
| 怪物 | `/api/mob/<id>` ＋ `/api/png/<path>` | `move`／`stand`／`hit` 動作表，延遲是 WZ 的 `delay`；朝向來自 `0x2F`／`0x30`（`facing` 0＝右、1＝左） |
| NPC | `/api/npc/<id>` ＋ `/api/png/<path>` | 站著不動（`0x3B` 的走動沒有畫）；朝向是地圖 `life/f` |
| 名字與表情 | `0x16`／`0x1C`／`0x27` | 名字是白字黑邊；表情就是**臉**——`0x27` 的值換成 `Face/<id>.img` 的九個表情資料夾之一（`/api/avatar.png?...&emotion=smile`），跟 2003 client 一樣按下去先換自己的臉再送封包 |
| 狀態列（HP／MP／EXP） | `UI/StatusBar.img` 的 `base/0`／`base/1`／`base/2` 與 `gauge/hp|mp|exp`（`/api/png`） | 完全是 2003 client 的版面：`CUIStatusBar` 是 (0,392) 的 800×208 視窗，左邊 243×208 面板、下面 446×27 聊天列、右邊 111×136 鍵盤圖；儀表是 1 px 條帶拉到 `163 × value / max`（`sub_4FA5E0`）。等級／職業／名字依 `sub_4FA170` 的 (54,116)／右對齊 136／(153,111) 畫。數字本身來自伺服器的 `self` 事件（`hp/maxHp/mp/maxMp/exp/expToNext`） |
| 聊天 | `0x1A` sub-op `0x12` | 場地聊天與**收到的密語**是同一包，所以畫面上長得一樣（線路上就是分不出來）；輸入框是 `base/1` 的白框上的一個透明 `<input>`，靠 `#game-ui` 跟畫布一起縮放 |
| 商店視窗（點 NPC） | `UI/UIWindow.img/Shop/backgrnd`／`buy`／`sell`／`Bt*` 與 `0x4A` 的列（價格來自 `info/price`）＋`/api/item/<id>` 的名字與圖示 | 原版 407×291、置中 (196,154)：左欄 6 列店貨、右欄 5 列背包（分類頁籤 장비／소비／설치／기타 用 `UI/Basic.img/Tab` 拼），選取臉是 `Shop/buy`／`sell`，捲軸是 `VScr`；買／賣／충전 都走 `{t:"shop"}`。買成功時是 `0x4B`＋`0x0B`＋`0x0D` |
| NPC 對話框 | `0x47` 五種body；現有game只送say（info.speak分頁是本地政策） | Prev=0、Next／OK=1、ESC／Close=FF；原Ex2素材，非完整quest腳本 |
| 背包視窗（`I`） | `UI/UIWindow.img/Item/backgrnd` ＋ `activeIcon` ＋ 每個 `0x0B` | 視窗、格子、分頁與 meso 欄都是原版圖；分頁用同一張圖的亮起／平常版本蓋上去，標籤依 `sub_4DA440` 的表。數量是線路的；名字／描述／圖示是 `/api/item/<id>` 從 `Data.wz` 讀的（ADR-037） |
| 右上「日誌」 | 所有事件 | 沒實作的封包會以 `unhandled packet 0x..` 出現 |

### 畫圖用到的端點

| 端點 | 回什麼 |
|---|---|
| `GET /api/map/<id>/art` | `{ backs[], sprites[], bounds, portalFrames[], missingTiles, missingTileSets[] }`。`backs[]` 是 `{path,ox,oy,x,y,rx,ry,type,cx,cy,a,z,front:false,flip}`；`sprites[]` 是 `{kind,x,y,z,layer,flip,frames[{path,delay,a0?,a1?,ox,oy}]}`，依tile／obj各自原公式排序，同z保留原插入順序；`bounds` 是相機可以顯示的矩形 |
| `GET /api/death` | `{fall[],land[]}`：原 Tomb queue／delay／origin；fall只排到至少800ms，land全格。原素材無法讀取時404，不生成替代圖 |
| `GET /api/png/<path>` | 一張 WZ canvas 的 PNG。`<path>` 是 `Map/…`、`Character/…`、`Mob/…`、`Npc/…`、`Effect/…`、`Item/…`、`UI/…` 其中之一，整個路徑 URL-encode 成一段；`..` 與其他檔案一律 404 |
| `GET /api/avatar.png?face&hair&items&stance&frame&flip&emotion&faceFrame` | 組好的一張角色 PNG；`x-frame-dx`／`x-frame-dy` 標頭是它左上角相對腳底的位置（頁面只加這兩個值） |
| `GET /api/npc/<id>`、`GET /api/mob/<id>` | `{templateId, actions}`，`actions` 是 `move`／`stand`／`hit` 各自的 `frames[]`；WZ 沒有的模板是 404 |

`missingTiles` 是「這張圖放了、但這份 `Data.wz` 裡沒有的圖塊」數量：這個 repo 的 `Data.wz` 是
**子集**，`Map/Tile` 只有 9 組（`brownBrick`／`coalMine`／`deepCave`／`dirtMine`／`holeBrick`／
`logMarble`／`wetWood`／`whiteMarble`／`woodMarble`），所以用 `grassySoil`／`dryRock`／`darkWood`
鋪地的圖（例如 암허스트서쪽필드 `1000000`）沒有地面 canvas 可畫。頁面在這種圖上改畫**腳踏點**的土
 platform（沒有「乾脆不畫」的選項——畫天空比畫土更誤導），並在日誌印一行缺哪幾組；`backs` 與
`obj` 照常畫。

這些端點都只**讀** `Data.wz`；`--data` 沒給就沒有圖，頁面記一行 `no art` 並只畫幾何（`/api/map/<id>`
仍然可用）。

## 操作的封包對照

| 動作 | 頁面送出的 JSON | 伺服器端送出的 2003 封包 |
|---|---|---|
| 登入 | `{t:"login",user,password}` | c2s `0x01` → s2c `0x01` |
| 選世界 | `{t:"world",index}` | c2s `0x02` → s2c `0x02` |
| 選角色 | `{t:"character",id}` | c2s `0x03` → s2c `0x03`，再連遊戲伺服器送 `0x04` |
| 建立角色 | `{t:"create",name}` | c2s `0x06` → s2c `0x04`，c2s `0x05` → s2c `0x05`（成功才帶角色紀錄） |
| 進地圖 | — | s2c `0x16`（＋ `0x2F`／`0x39`／`0x1C` 快照） |
| 說話 | `{t:"say",text}` | c2s `0x12` → s2c `0x1A`/`0x12` |
| 走一步 | `{t:"move",x,y,foothold}` | c2s `0x0E` ＋ 一個元素的 `CMovePath` → 其他人收 s2c `0x22` |
| ↑／自動／點傳送門換圖 | `{t:"portal",name}` | c2s `0x0D`（`kind=-1`＋門名）→ s2c `0x16` 進新圖 |
| 表情 | `{t:"emotion",value}` | c2s `0x13` → 其他人收 s2c `0x27`（送的人自己不會收到） |
| 密語 | `{t:"whisper",name,text}` | c2s `0x23` kind `0x06` → 對方收 `0x1A`/`0x12`，自己收 `0x1A`/`0x0A` |
| 找人在哪 | `{t:"find",name}` | c2s `0x23` kind `0x05` → `0x1A`/`0x09`（`u32 mapId`，`-1`＝不在線） |
| 點 NPC | `{t:"click",objectId}` | c2s `0x33` → 先 `0x19`，再 `0x4A`（商店）或 `0x47`（台詞） |
| 買東西 | `{t:"shop",action:"buy",row,itemId,count}` | c2s `0x16` → `0x4B`（結果）＋`0x0B`（格子）＋`0x0D`（mesos） |
| 關商店 | `{t:"shop",action:"close"}` | c2s `0x16` 的 close → **不回包**（2003 client 的 close 不 arm flag） |
| 回答對話 | `{t:"talk",answer}` | c2s `0x15`（answer 1＝下一句、0＝結束） |
| 用消耗品（雙擊） | `{t:"use",slot,itemId}` | c2s `0x18`（203 家族 `0x19`）→ s2c `0x0B`（少一瓶）＋`0x0D`（HP／MP 動了）；被拒絕時是空 `0x0B` |
| 揮擊（Ctrl） | `{t:"attack",mobId,facingLeft}` | c2s `0x1B` → s2c `0x34`（怪的 stat）／`0x30`（倒下動畫）／`0x31`（屍體消失），傷害數字在送的人自己的封包裡 |
| 升級特效（別人的） | — | s2c `0x29` |

## JSON 協定（我們的設計，不是證據）

伺服器 → 頁面的每一則訊息都是 `{ "t": <kind>, ... }`，`kind` 就是
`server/src/client/session.ts` 的 `ClientEvent["kind"]`：

```
field        { mapId, self, users[], mobs[], npcs[] }     ← 0x16 的快照
self         { self }                                     ← 0x0D 之後的完整狀態
inventory    { worn[], wornCash[], tabs[4] }              ← 0x16 之後一則，此後每個 0x0B 一則
shop-open    { shop: { shopId, items[] } }                ← 0x4A（價格與 maxCount 都是伺服器的）
shop-result  { code, message }                            ← 0x4B（0＝silent，成功）
npc-say      { npcId, message, body }                     ← 0x47 五種body（保留legacy事件名）
user-enter   { user }        user-leave { characterId }
user-move    { characterId, x, y, action, foothold }
user-emotion { characterId, emotion }
chat         { name, text }                              ← 0x1A/0x12（場地聊天與收到的密語同一包）
whisper-answer { name, delivered }                        ← 0x1A/0x0A（送的人收到的回覆；沒有文字）
find-answer  { name, mapId }                              ← 0x1A/0x09（mapId -1 ＝ 找不到）
level-up     { characterId }
mob-enter    { mob }         mob-move { mobId, x, y }
mob-die      { mobId }                                   ← 0x30 的正延遲：屍體演動畫，0x31 才移除
mob-leave    { mobId }
user-attack  { characterId, facingLeft, targets[] }       ← 0x23（別人的揮擊，含他們骰的數字）
drop-enter   { drop }                                    ← 0x43（money/value/x/y/mobId）
drop-leave   { dropId, reason, characterId? }             ← 0x44（taken 時 page 把圖示飛向那個人）
stat-basis   { basis, wornFacts, ammoPad }                 ← 原WZ計算資料，不是新增native封包
hit          { mobId, damage }                            ← 橋自己回的：這一下的數字（線路上沒有）
npc-enter    { npc }         npc-leave { npcId }
unknown      { opcode, bytes }                            ← 這個殼沒讀的封包
name-checked { name, result }                             ← 0x06 請求 → 0x04（0 可用／1 已用／−1 失敗）
deleted      { id, ok }                                   ← 0x07 請求 → 0x06
created      { ok, name, id?, reason? }                    ← 建立角色（0x05）的結果
disconnect   { reason }
error        { message }
```

頁面 → 伺服器：`warp-map`／`login`／`world`／`character`／`check-name`／`create`／`delete-character`／`say`／`move`／`portal`／`emotion`／
`whisper`／`find`／`use`／`click`／`shop`／`talk`／`attack`。建立相關訊息：

- `check-name {name, appearance[10]}`：只檢查，不新增角色。
- `create {name, appearance[10]}`：提交前重查同一個名稱與最新外觀／骰點；前六項限帳號性別的原 WZ 選項。
- `delete-character {id, confirmed:true}`：僅角色選擇階段、僅自己帳號的角色；取消確認不送封包。
- `GET /api/creation`：原 `MakeCharInfo` 順序、各素材 `info/name`、`ForbiddenName`。無 Data.wz 回 404，不另造假選項。

登入相關操作逐一串行，避免 check／create／delete 共用登入連線的回包互搶。
`login` 成功另附 `gender`（app8，舊存檔缺省 0）；app9 是名稱檢查權限旗標，不是性別。
對外 JSON 名稱為 Unicode；protocol／存檔內的名稱仍為 CP949 byte-string。

## 文字編碼（CP949，不是 UTF-8）

2003 client 的每一個字串都是 **CP949** 位元組（`protocol/cp949.ts`）：它把 bytes 直接交給 Windows
的 ANSI renderer，沒有碼頁轉換。所以這一條線上的中文（繁中）**送不出去**——`encodeCp949` 會拋
`U+XXXX is not a CP949 character`，橋把它當 `error` 回給頁面，頁面在聊天框印出來（遊戲中 `#status`
是藏起來的，錯誤另外進聊天框）。韓文與 ASCII 都正常。

收到的字也要用 CP949 解。這一刀之前 `ClientSession` 用 UTF-8 解 `0x1A` 的文字：ASCII 看起來沒問題，
`안녕`（CP949 `be c8 b3 e7`）卻會變成 `�ȳ�` 這種亂碼（`U+FFFD U+0233 U+FFFD`）——現在用的是
`decodeCp949`，測試裡有一句真的韓文密語釘住它。

## 刻意沒有的東西

- **怪物 AI 與怪物打你**：2003 client 自己跑怪的 AI（FINDINGS §4.20／ADR-008），頁面只畫伺服器
  送來的 `0x30`／`0x31`，怪不會主動攻擊、玩家不會掉血。衝擊（`0x1C`）與死亡／復活是伺服器側
  已有的路徑（ADR-021），頁面沒有接。
- **主動技能／魔法傷害**：已接[十招物理／箭鏢與增益](NATIVE_RANGED_SKILLS.md)，其他魔法／箭鏢主動技能等仍缺；不是所有技能完成。
  動作選擇與全域RNG仍未完全同步、CShape2D選敵／怪物暫時能力仍缺。
- **密語的「對方是不是在密你」**：線路上分不出來——送達的密語就是 `0x1A` 的 `0x12`，跟場地聊天同一包
  （FINDINGS 4.31）。頁面照實顯示，不假裝知道。
- **交易／組隊／郵件**：伺服器都有（`0x25`／`0x26`／`0x24`）；組隊已接[指令／名冊／邀請與Rage](ACTIVE_SKILLS.md)，交易／郵件頁面仍缺；歷史封包測試在
  `test/miniroom.test.ts`、`test/party.test.ts`、`test/messenger.test.ts`。商店的買、賣與補充
  封包來源在 `test/shops.test.ts`；最新補充成功路徑未執行測試，不沿用舊PASS。
- **背包與裝備的剩餘範圍**：一般搬移／穿脫、地面丟棄數量窗與容量捲動已接（最新項目未測試）；
  原金幣按鈕與meso丟棄已接（未測試）；背包內自由拆疊／合併、現金裝備／寵物未齊。拖到場景是丟棄，狀態列／瀏覽器外是取消。
- **卷軸（204）**：雖然一般拖放已接，卷軸目標／成功失敗效果仍未接，頁面不送該0x1A。
- **天氣／霧**：頁面尚未接。原版小地圖已完成上述範圍，來源是地圖的 `miniMap/canvas` 與 `UI/UIWindow.img/MiniMap`，不是 `MapHelper/mark`。
- **角色動作／碰撞**：已接走路、跳躍、下跳、牆與單向平台、攀爬、繩頂登台；坐下與完整技能動作仍未齊。
- **素材**：先前「Data.wz 少圖塊」結論已撤回；根因是 shared-name/type2 reader 漏讀。
  真100張地圖 missingTiles=0，沒有人工平台取代原圖塊。Data.wz 未修改。
- **傳送門**：↑／自動門／tn 落點已接；原伺服器的任務／等級限制與完整反作弊位置權威尚未完成。

## 測試

```sh
cd server
node --test test/websocket.test.ts test/webclient.test.ts
```

`websocket.test.ts`（9 則）釘住 RFC 6455 的三件事：`Sec-WebSocket-Accept` 的官方向量、client 訊框
一定要遮罩、server 訊框一定不遮罩。（第 9 則是「半關閉」：升級後的 socket 是 `allowHalfOpen`，瀏覽器被硬關只會送 FIN，
所以 `end` 也必須當成關閉，否則帳號的座位永遠不會放掉。）
`webclient.test.ts`（12 則）用 Node 內建的 `WebSocket` 當瀏覽器，
對**真的** `LoginServer`／`GameEntryServer` 走完登入→選角→進圖→說話→走路，外加靜態檔、
`/api/map/<id>` 與 `..` 的拒絕、一個空帳號用 `0x06`＋`0x05` 建立第一個角色再進去玩，以及點一扇門
換到另一張圖再走回來，一張臉、一通韓文密語（CP949 來回）、一次找不到人的密語與兩種 `/f` 答案，
背包（`inventory` 事件的形狀、`/api/item` 的三種答案、一次雙擊把 3 瓶喝成 2 瓶且 HP 20→50），
以及商店（點 NPC → `0x4A`、買 2 個 → `0x4B`＋`0x0B`＋`0x0D`、close 不回包）與 NPC 對話（`0x47` 的
兩句台詞用 `0x15` 走完）。

另外還有一支**對真的伺服器**跑的畫面探針：`node server/scripts/frame_probe.mjs 8495`。它把
`client/main.js` 放進一個 DOM shim（元素、會算次數的 2D context、會 `onload` 的 `Image`、Node 的
`WebSocket`）裡真的登入、選角、進圖，再跑真的 `requestAnimationFrame`；它斷言背景、圖塊／物件、
NPC 與角色的 avatar 都在**同一幀**被畫出來（헤네시스：3 幀 4118 次 `drawImage`、152 個不同來源）。
它不取代眼睛，但它釘住「資料到得了畫面」這一段；同一支探針還會把兩筆 `0x43`（一件道具、
一堆金幣）注入頁面，確認掉落的 `iconRaw`／`Item/Special/0900.img` 真的被畫出來。

還有一支**不用瀏覽器**的實機走查：`node server/scripts/play_probe.mjs 8495`——直接走瀏覽器協定
登入、從 헤네시스 過 `west00` 進獵場、Ctrl 式揮擊打到怪死、走到掉落物上等撿起，把每一步收到的
訊息（`hit`／`mob-die`／`drop-enter`／`drop-leave` taken／`loot`／`inventory`）印出來。

頁面的**繪圖**本身仍然只有眼睛能驗，但把它切開的那幾層有測試：`test/art.test.ts`（17 則）釘住
compositor 的原點／鏡射／alpha、UOL 解析與快取、`30000*layer-10*zM` 的深度、背景的 origin 與
「缺 canvas 就跳過」、`Character/*` 的槽位對應、avatar 的錨點合成（用真的 `Data.wz` 驗尺寸與
`dx/dy`），以及 NPC／mob 的圖檔名與 frame 表；`test/webclient.test.ts` 另外對**真的** HTTP 伺服器
驗 `/api/map/<id>/art`、`/api/png`（含 `..` 的拒絕）、`/api/avatar.png` 的標頭、`/api/npc`、`/api/mob`。

## 預覽環境

`serve` 的三個 port 都是參數，但只有 `--web-port` 那個會出現在預覽網址裡，所以本專案的預覽跑法固定是
**頁面 8495、login 8496、game 8497**；`https://8495-<sandbox>.e2b.app/` 就是頁面。把 login 放在
8495 的話，預覽只會拿到一段 2003 的位元組（瀏覽器把它當成壞掉的 HTTP），看起來就是「Sandbox not
found」之外的另一種空白。

**已實測**（2026-10-17，真的瀏覽器，不是 Node 的 `WebSocket`）：預覽 proxy 會轉發 `wss` 的 upgrade。
同一個分頁裡走完 登入（`admin`）→ 建立角色（`chui`，`0x06`＋`0x05`）→ 選角（`Hero`）→ 進地圖
（헤네시스 `100000000`）→ 送出一句聊天，伺服器日誌逐包對得上。所以「代理不轉發 upgrade」的備案
（HTTP 輪詢）**不需要**。

### 離線 UI 回歸

`node server/scripts/client_probe.mjs` 不需要伺服器、瀏覽器或外部套件：用 DOM／canvas shim 執行真正的
`client/main.js`，注入與 WebSocket 相同的事件，驗證登入面板與按鈕的素材路徑／座標／狀態、登入
取消／重試／防重送與密碼清理，以及原版商店座標的買／賣／雙擊、箭頭／軌道／滾輪／
拖曳滑塊、背包減少後捲動與選取清理、視窗拖曳在畫布外放開、位置儲存，以及 WZ 說明的字面 `\n`
換行。`server/test/client-ui.test.ts` 將它納入 `npm test`。這是互動回歸，不代替真 canvas 的像素檢查。
