# 原版背包拖放／裝備窗驗證（2026-10-17）

> 後續狀態更正：本文件的驗證／未完成清單為當輪歷史。HP／MP自然成長與配點已由原表接上（**新改動未測試**），舊「成長表不在client」判讀已更正；自然AP/SP發放、完整Detail／buff仍缺。見 [STAT_GROWTH.md](STAT_GROWTH.md)／ADR-047。

> **歷史驗證範圍**：本文件的570／Chromium結果來自裝備窗這一輪。
> 後續已新增地面丟棄／背包擴充捲動／商店數量框，依使用者要求**未測試**；
> 最新操作與差異見 [INVENTORY_OPERATIONS.md](INVENTORY_OPERATIONS.md)，不能將舊PASS套用到新版本。

## 完成本輪範圍

- 背包格內拖放／兩個已佔用格互換（各分頁各自操作）；雙擊一般裝備穿戴。
- E 或原狀態列 EQUIP 開關原裝備窗；拖入正確部位穿戴，從已穿戴格拖回**空背包格**卸下。
- 176×315 原 `UI/UIWindow.img/Equip/backgrnd`、原 Close 圖與十四格原座標；視窗拖曳保存。
- 穿戴前依原 WZ 需求檢查性別、等級、職業、STR/DEX/INT/LUK與法師武器限制；先排除將換下／衝突的裝備。
- 換裝不只改圖：原 c2s0x17 → s2c0x0B → 真角色紀錄／存檔；自己外觀與其他人的0x28都接通。
- tooltip 顯示線上那件裝備的十五項 instance stats、cuc／ruc，不拿WZ模板能力冒充已升級的實物。

**不含**地面丟棄／拆疊、卷軸、現金裝備／寵物操作、完整裝備與buff能力總值。拖到視窗外會取消，
不是宣稱已還原原版丟棄提示。裝備卸下的雙擊路徑也未自行杜撰，使用已確證的拖放。

## 原版來源

來源是 `MapleStory.exe.c`、`.lst` 與原PE，配合真 `Data.wz`；不是執行Windows原client的動態oracle。

| 證據 | 內容 |
|---|---|
| `sub_4D89F0` | CUIEquip：type1，原框176×315；經CConfig取得視窗位置 |
| `sub_506440`／`sub_5065B0` | `(type,closeX,closeY,...)`，**不是**視窗起點；建立原Close control |
| `sub_43D750`／`sub_43E340` | type0/1/2預設位置分別(24,24)/(48,48)/(72,72)，不是(114,9)/(128,9) |
| `sub_4DA1C0`／`sub_4DA440` | 背包的close(114,9)，uiOpt0預設0、tab=opt+1，初始應是裝備分頁 |
| `sub_4F2450` | 能力窗type2，close(128,9)；本輪將browser自訂(20,35)改為原預設(72,72) |
| `sub_4D9110`／PE VA005BC368 | 十四個(s32 x,s32 y)，32px格，strict比較 `x0<x<x0+32`、Y同理 |
| `sub_4D8B60` | 已穿戴物件可成為CDraggableItem；原DragStart音效 |
| `sub_462DC0`／`sub_4636B0` | 背包雙擊裝備的部位／需求檢查，再送0x17；消耗品是另一條0x18/19 |
| `sub_4630A0`／`sub_463A50` | 拖入裝備部位或背包格；同格不送，count=-1 |
| `sub_4658E0` | 性別／等級／職業位元／四基礎能力及法師武器類型檢查 |
| `sub_465B50`／`sub_465C60` | 雙手武器／盾、套服／褲子互斥；換下格不得幫新裝備滿足需求 |
| `sub_55ACB0`／`sub_55BAB0` | HP>0、pending與500ms gate；只有非零0x0B result解除pending |
| CWvsApp scan0x12 → `sub_559890(...,1)` | E開關裝備窗；不是新造遊戲封包 |

舊背包文件將 `sub_506440(this,0,114,9,1)`誤讀成位置，已修正；保留使用者自己保存的視窗位置，不強制重設。
能力窗(20,35)先前是明示的browser政策，本輪以新查證的CConfig預設取代。清晰縮放仍共用800×600邏輯座標。

### 十四格座標（相對裝備窗）

```text
part1 (39,55)   2 (39,88)    3 (72,121)   4 (105,121)
part5 (39,154)  6 (39,187)   7 (39,220)   8 (6,187)
part9 (6,154)  10 (138,154) 11 (105,154) 12 (105,187)
part13(138,187)14 (105,253)
```

a7被反編譯器當成字串"7"，實際是座標表的一部分；從PE按14組signed dword抽取，
並用 `.lst:004D911C..004D9145` 的地址／步長／終止地址確認，不以字串內容猜格子。
UI有十四格不表示現金／寵物流程已完成；目前普通item部位只允許1..11。

## 資料與回包

- JSON `change-slot {tab,fromSlot,toSlot,count}`只橋接原0x17：
  `[op:u8][tab:u8][from:s16][to:s16][count:s16]`，搬移固定count=-1，穿戴用負格。
- ClientSession驗證欄位整數／signed16範圍／活角色／pending／500ms，不讓JSON數值經位元遮罩繞回其他格。
  空格等結構拒絕仍由game server回空0x0B，gate可再次開啟。
- `inventory`事件另帶ack，僅來自原0x0B非零result。進圖快照或result=0不釋放搬移pending。
- 客戶端不樂觀搬物品；拖曳只帶來源快照，若物品／地圖在讀需求或拖曳期間已變，取消舊手勢。
- 穿戴者不會收到自己的0x28：ClientSession依負格0x0B重建self.avatarItems。
  其他人解0x28，更新既有user的face／avatarItems，**保留其位置與移動path，不當成重新入場**。
- 另修0x0B **op2 swap**跨正／負格的解碼套用，兩端要查各自的bag／worn，不能只用來源容器。
- ItemView包含cuc、cash布林與十五項原wire數值；沒有bigint洩入JSON。ItemInfo提供原WZ的requirements／cash。
- 接受的搬移／穿脫立即persist，不等到斷線才落盤；原存檔格式不改，不回填／重擲舊裝備能力。

### 衝突與界線

雙手武器（14xxxxx）與盾（109）、套服（105）與褲子（106）的衝突來自原client函式。
server先規劃再原子套用；替換部位已佔用且還要卸衝突物時需另一空格，沒有空格則整筆拒絕。
衝突物放入第一個可用背包格是**重建server政策**，不稱已證明原server選格順序。
server仍照ADR-029只驗結構，不重抄client裝備能力需求；不能把正常UI檢查當完整反作弊。
其他AP／消耗品與搬移尚未統一成原CWvsApp全域pending；本輪保證的是搬移自己的ack／500ms路徑。

## 測試結果

- **標準 `cd server && npm run check`：570/570、strict TypeScript通過**。
- 新純前端5項：十四格／strict邊界、部位、需求與法師限制、排除新物／替換物／衝突物的instance加成、滿包。
- server純函式：四種互斥方向、空目的格可利用釋出的來源格、雙重替換需要額外空格且拒絕不半寫。
- 真TCP→WebSocket：換位／穿戴／本人self及旁觀0x28、instance stats、500ms、拒絕ack、卸下、立即存檔、非法欄位。
- VM：原登入／建刪角／Stat/AP／商店／portal仍通過；另驗本地需求拒絕不是JS error、沒有樂觀改包、
  非ack不開pending、remote look不丟path。
- WZ測試：原裝備框176×315、三種Close狀態、1002008等級5、1002023等級30/STR65/job1、1002000為cash。
  **不能因舊純協定測試用了1002000就把它當低等可穿的一般帽子**。

### 雙頁Chromium（只用equipment_fixture.mjs帳號）

1. 背包格1→5，再5↔2，原窗仍在(24,24)，不是把整張視窗拖走。
2. 雙擊1002008帽子穿上；真0x0B與本人外觀、旁觀user-look同步。
3. 雙擊1002023能力不足，**完全不送change-slot**。
4. 拖已穿戴帽回空格6、再拖回頭部；1002019替換，再換回1002008。
5. 該件帽子的STR3／cuc2／ruc4保留，非換成WZ模板；消耗品1→4保持3瓶，不誤喝藥。
6. 拖到視窗外、Escape取消均不送；裝備窗拖到(300,30)保存，Close與原EQUIP按鈕通過。
7. 重新登入保留裝備／instance值／藥水格與數量、裝備窗位置。
8. 旁觀頁實際請求含新帽1002019的合成avatar PNG，不只看到socket event。

主流程8個原搬移請求，count全部-1；JS errors=[]、HTTP errors=[]。
可重跑：probe只識別自己的精確fixture結束狀態，先用正常拖放還原，不注入角色位置或道具狀態。
截圖 `generated/validation/equipment-native-{owner,observer}.png`，不進Git。
本機最終log `/tmp/browser-equipment-render-confirmed.log`；詳細測試log只是暫存。

### 既有功能回歸

- 能力窗原預設(72,72)，六AP分配／500ms／重連／拖曳／原Stat按鈕通過；拖後整數位置(152,112)。
- 小地圖M／拖曳／背包遮擋、三種裁切尺寸與無node、原bitmap1:1通過。
- DPR1/1.25/1.5/2/3實體整數像素／overlay／模式保存通過。Chromium153的media-query更新需rendering opportunity；
  診斷停遊戲RAF時保留一次native RAF，不以手動呼叫resize假造DPR監聽成功。
- 真↑往返門／type1／tn／map0／無效map恢復通過；繩頂持續↑與放開，x718/y95/fh277/vy0穩定。
- Data.wz SHA256仍為 `286abe74f4335ebfde3164fa8f55e195e926a6cf5165646796b3c2fba3962d0f`。

## 重現與預覽狀態

```sh
# 只允許新建generated/validation中的fixture，拒絕覆寫既有檔。
node server/scripts/equipment_fixture.mjs generated/validation/equipment-qa-save.json
cd server
node src/cli.ts serve --port 8596 --game-port 8597 --web-port 8595 \
  --save ../generated/validation/equipment-qa-save.json --data ../Data.wz --ping off \
  --map-command gear,travel,climb,stat
# 另一shell，指定外部Playwright／Chromium後：
node server/scripts/browser_equipment_probe.mjs 8595
```

目前8595為隔離預覽：gear/gear、watch/watch；另有travel/climb/stat專用回歸fixture。
**不是正式角色存檔**。此工作環境未保有上一輪`/tmp/kms111-save.json`，也沒有可確認的正式存檔副本，
因此沒有在8495建立空白admin/newbie冒充恢復，更沒有由QA角色覆蓋正式進度。
正式資料需獨立持久備份，勿把`/tmp`當跨工作環境的儲存保證。

## 尚未宣稱完整還原

- 完整buff／裝備能力依賴鏈、能力窗base+bonus／Detail、技能與自然升級AP/SP／HPMP成長仍未齊。
- 當時未接的地面丟棄數量窗／背包擴充捲動已於後續一輪實作但未測試；卷軸目標、cash/wornCash、寵物、完整視窗堆疊管理仍未齊。
- 四像素拖曳slop、localStorage全browser偏好、滿包server原子策略是明示的重建／瀏覽器政策。
- tooltip多了真實裝備資料，但字型、排版、需求變色等尚非原CToolTip逐像素完成版。
