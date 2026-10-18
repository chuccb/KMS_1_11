# 原版臉部動畫／表情／臉飾完整接線

2026-10-18，ADR-067。**程式與回歸來源已寫入，沒有執行測試、typecheck、語法檢查、browser、VM或遊戲probe。**
本輪使用原 C／listing／Data.wz 交叉，不靠後期攻略猜表情或時間。

## 1. 原始證據與此次修正

| 原位置 | 交叉結論與接線 |
|---|---|
| `408400`／`.lst 408804` | 每個表情預設持續 **5000ms**，若WZ表情節點有數字欄位則使用其值；不是舊寫死2500ms。 |
| `408A7B` | 每個**臉部幀**缺省delay為60ms，與body動畫／武器speed分開；WZ的blink為0/1/2各60ms，vomit為0/1各120ms。 |
| `509070` | 非0表情讀FACELOOKENTRY duration（或明確指定值），以native clock記截止時間；非0循環臉部幀，0回待機排程。 |
| `509560`／`.lst 50957x–50958C` | 普通眨眼等待 `rand()%3000+2000`，即2000..4999ms；不是固定每兩秒、也不是一直閉眼。 |
| `50B590` | 截止比較為嚴格 `now > deadline`；等待到期時排 `rand()%3+1` 次眨眼，完成後再排等待。 |
| Gr2D `100167C0` | 0x100保留／append既有queue；0x20走循環序列。瀏覽器以WZ幀序列及有限眨眼次數呈現，不重寫整套COM layer queue。 |
| `508260`／`509790` | SetAvatar重設表情／眨眼；允許索引0..8，vomit在body action32／33（proneStab／prone）被拒絕。 |
| `511E20`／`.lst 511FD8–511FEA` | F1..F7先本機SetFace，再送0x13；repeat flag不再送，F8不對應表情，F9..F12不送。F1雖叫hit，但按鍵版仍走一般duration。 |
| `5114A0` | 本人實際受傷的hit明確指定**1500ms**，不同於按F1的5000ms。 |
| `495F70`／`.lst 495F9F–495FB9` → `539900` → `5398B0` → `520950`／`.lst 520978–520990` | OR fragment.attr在duration判斷**之前**；out-param回到remote update，bit2設hit/1500。這輪才補完原先未追到的回傳鏈，不需要新增傷害／表情廣播。 |
| `408400` 第四個參數／WZ `Character/Accessory/0101*.img` | 101類臉飾有自己的blink/hit等同名同幀，canvas叫`default`；不是body stand/walk，也不是背包icon。102眼飾／103耳飾仍走原body列表。 |
| body frame `face=0` | 繩梯／背面動作不畫臉，也不畫臉飾；仍保留各自的真body／hair／equipment幀。 |

原臉20000／21000的default與blink0像素一致；blink1/2不同。這是唯讀WZ抽取／像素摘要，不是遊戲測試。
原圖origin在每幀有差異，例如21000 blink2為(14,7)；不能把上一幀裁切框或body frame index拿來用。

## 2. 端到端實作

- `game/face.ts` 提供真faceId的9類metadata，保留稀疏幀index、各幀delay、整體duration；不存在不造幀。
- `/api/face/<id>`為瀏覽器資源橋，不是原封包。`avatar.png`新增獨立`faceFrame`；HTTP、ArtProvider與頁面PNG快取鍵都包含它。
- compositor在brow anchor放臉與101臉飾，保留origin／z／slot遮蔽及兩面plane，背面共同隱藏。不得隨意拿frame0代替不存在的later frame。
- `client/faces.mjs`的時鐘不跟body stance／移動frame重啟。每個actor獨立，本人self快照合併保留時鐘；真正換外觀則重設。
- 一般表情5秒／WZ duration，受傷1.5秒；受傷或另一表情會替換前一表情，結束後回普通眨眼。
- 本人先呈現再送0x13；ClientSession的本地bridge echo不重新計時，也不能讓舊echo倒灌蓋掉較新表情。
- 旁觀者0x27用同一套時鐘；換圖建立新actor、離場丟棄actor、斷線重設本人。存檔及進場封包不保存短暫表情。
- remote attr2按既有path的片段時序消費，30ms呈現quantum；短／0ms片段跨越也OR，尾quantum保留，不在socket收到未來片段時立即受傷。
  不扣remote HP、不發新0x27、不拿attr1當受傷。**沒有重寫全部原CMovePath append/merge或全域30ms幾何**。
- F1..F7與現有瀏覽器輔助按鈕共用場地／連線／modal／attack override gate。輸入框不攔、長按不重送，保留Alt/Ctrl/Meta組合；瀏覽器／OS若仍保留某鍵，可用輔助按鈕。
- 選角三個槽、創角預覽共用這套臉部時鐘，切換body walk／stand不使眨眼重新開始。
- 小型幀預熱、64份metadata／256個avatar PNG快取有界，活躍姿勢按實際PNG membership重新預熱，避免一次性標記在PNG淘汰後失效；immutable資源回覆不修改actor、舊field或技能。
  失敗metadata退避5秒；冷表情圖片暫用**同一body姿勢的中性臉**，不為眨眼改成stand或灰色人形。
- c2s表情需恰好5bytes，拒絕trailing資料；這是重建輸入防護政策，並非擷取到的原server行為。

## 3. 界線與未執行回歸來源

`server/test/native-faces.test.ts`：名稱／等待範圍／1..3次、獨立clock、嚴格截止、hit與F1區別、vomit多幀、
換裝／snapshot、attr2短／零／尾片段、資源退避／abort、真WZ／face mask／背面／鏡像／PNG cache鍵。
`webclient.test.ts`追加全表情雙人relay、metadata、faceFrame PNG及非法參數HTTP來源；歷史VM shim只補新模組載入，**沒有執行或宣稱shim已驗收**。

這是完整接通目前已定位的臉部家族，不是宣稱完整Gr2D、所有傷害／狀態異常或原字型完成。
原remote受傷的全部閃色、magic attr4對應技能效果與全CVecCtrl仍屬其他系統；沒有憑attr2捏造它們。
表情本身原路徑沒有音效呼叫，不額外配假語音或怪物受傷聲。

## 4. 新隔離LIVE與資料

使用者明確同意「沒存檔也沒關係」後，這輪改用全新隔離save，而非繼續等待舊檔。
`tools/create-isolated-preview.ts`只建立**新generated/*.json**，exclusive-create拒絕覆蓋既有檔。
使用原MakeCharInfo與真正createCharacter／equipmentFromTemplate路徑建立兩個新初心者，沒有自動轉職／給SP／技能／金錢。
新角色起點101000000為無怪城鎮體驗安排，**不是原版新建角色起點或恢復舊進度**。

帳號 `preview / preview`、`observer / observer`，角色Preview／Observer，可分頁觀察同圖表情。
體驗工具與地圖命令只授權這兩個新帳號；後續改職業／領物仍須使用者在工具內明確確認。
重要save仍需另行匯出保存；ignored不是永久備份，這輪seed不是補救任何已遺失進度的還原器。
