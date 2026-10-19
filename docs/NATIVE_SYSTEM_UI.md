# 原版 Menu／SysOpt、消耗品快捷格拖曳與悄悄話模式

> **後續ADR-059**：原GameOpt的miniMap／whisper、原0x1F聊天氣泡、密語拒收、64換行record已接（未測試）。
> 「密語與一般聊天wire無分類」舊判讀錯誤，已更正。見 [新證據與界線](NATIVE_GAME_OPTIONS_CHAT.md)。
> 下方保留ADR-058交付歷史，不代表最新缺口。

2026-10-18。**已編輯實作與回歸來源；未執行 test/check/typecheck/browser/VM/probe，也沒有功能 PASS。**
本輪不改存檔資料、裝備、AP/SP、技能或怪物規則；不是以開新角色替代既有進度。

## 1. 原版交叉來源

| 原檔依據 | 確認的行為／數值 | 接線 |
|---|---|---|
| 559E20 + PE vtable 588098／588028 | GameMenu 的 create=52C8E0，SysOpt create=52D800；不是55A090／55A440（那是刪除器） | 新 systemmenu.mjs，不拿 vtable 首項當初始化 |
| 461C50 + WZ GameMenu/backgrnd=176×240、SysOpt/backgrnd=347×225 | 800×600中心，整數右移1；座標312,180與226,187 | 同尺寸canvas原圖，DOM只做透明命中／焦點 |
| 52C8E0 + PE 5BC260／5BE784等 UTF16 字串 | CLOSE128,9；六列20,63+27i，136×23；Quest/Party/Community/GameOpt/SysOpt/Quit | 完整原按鈕位置；未有功能的四列 disabled，title／aria 明示 |
| 52D020／559E20 | 六列回index；3開GameOpt、4開SysOpt、5呼55D9F0 | 本輪接4與5；不把未完成GameOpt當成系統設定 |
| 559E20（ADR-090更正）| PE `00559EF5`起27bytes＝`mov eax,[ecx+98h]`／`sub eax,3`／`jz`／`dec`／`jz`／`dec`／`jnz loc_55A067`：**只有3／4／5有分支**，`UI/UIWindow.img`顶层也没有`Party`子树 | Quest／Party／Community停用是這版原況，不是漏接；派對資訊走`/파티정보`（[社交指令鏈](NATIVE_SOCIAL_COMMANDS.md)），不补后期样式party窗 |
| 55D9F0 | 關連線／重設context後回登入stage，不是銷毀角色或離開整個OS | browser關本WS、等待close清理、回title，可再次連線；由既有server下線保存 |
| 55A700 鍵盤分派 | Escape順序Item→Equip→Stat→Skill→GameMenu | 先取消拖曳／關窗，無窗才開Menu；輸入聊天時先退出編輯 |
| 52D800 + listing 52DD59..52DD72 | video 4段；BGM／SE各20段；音量slider116,84／116,118，寬122；mute320,84／320,118；OK200,183／Cancel270,183 | 只開放兩組音量與靜音；不偽造DirectX畫質與截圖目的地功能 |
| 43D360讀取／43D630保存／43DEB0套用 | soBGMVol／soSEVol預設15，mute預設0；`trunc(100*(step+1)/20)`；mute才是0 | 修原先瀏覽器預設100%為原百分比80%；第0段是5%而非靜音 |
| 52DE80／52DF20／52DF90／52E000 | 變更即preview；OK保存draft；Cancel套回原本snapshot，不保存draft | audio既有GainNode直接更新；取消不重啟BGM、不移動播放時鐘 |
| 457280／457240 | thumb中心`trunc(step*(width-27)/(count-1))+13`；找最近中心，等距保留較小index | 原WZ Slider track／thumb，滑鼠與鍵盤同20段；非CSS百分比slider |
| 446320／446370 | checkbox圖0正常、1按下、2勾選、3勾選按下 | 修正不能將1當勾選，四態讀真Basic.img |
| 463DF0／463F10 + CDraggable路由約106845..106932 | status→status重綁itemId並清同ID，覆蓋目的格、不交換；status→field只清設定 | quickslots純函數move／clear；沒有0x17／use／field drop請求 |
| 4F90F0 + 4FC180／4F9F20 | 拖曳先找真USE堆；快捷hover是template tooltip；drag層色80FFFFFF | 有物品才可起拖；半透明原iconRaw，hover沿用共用tooltip；沒有假造背包物件 |
| 4F8940／535AC0／535CE0(4,12)／535EF0／530C20 | 有recipient時按鈕回everyone；沒有時開type3文字輸入，預填上次名字；寬230+22，高textHeight+99 | 共用CUtilDlgEx白底／Border與OK/Cancel，不再注入`/w `字串 |
| PE 5BD308 CP949 | 原文「귓속말 상대를 입력하세요.」 | 保留原文提示；不在選收件人時自動送訊息 |
| 524A00(name,null,null) + 4F8940 `_stricmp` | 4..12 **CP949 bytes**；ASCII字母／數字或B0..C8+A1..FE；literal I/l不能合計≥4；不能給自己；null略過建角禁語名單 | 以瀏覽器EUC-KR decoder反建這個KS Hangul子集，不拿JS長度／UTF8長度替代，也不接受所有UHC音節 |
| 4FB160／4F8CB0 | recipient格fill局部245,186,79,17=FF315573；文字246,189用font0白字；非slash輸入按recipient送，slash仍走command | 畫面245,578與246,581，everyone「모두에게」；持續悄悄話模式與原0x23既有發送接通 |

只讀原始EXE／C／listing與Data.wz；未改原檔。完整圖像仍由既有同origin `/api/png/` 讀取，沒有外部替代素材。
PE的部分寬字串在反編譯註解只顯示「UI」，本輪直接按section VA→raw讀到完整原路徑，沒有猜名字。

## 2. 操作入口

1. 原左下 **Menu**，或關閉I/E/S/K窗、退出聊天編輯後按 **Escape**，開原176×240選單。
2. 選 **시스템 옵션**，可拖BGM／音效slider；也可Tab選控制項，用←／→、PageUp／PageDown、Home／End。
   兩個靜音checkbox獨立；音量即時預覽。OK或slider焦點下Enter保存，Cancel／Escape還原開窗前設定。
3. 原工具列「聲音：關」仍是額外browser總靜音，不改／抹掉兩組native音量設定。
   例如BGM勾靜音、音效開啟時，切換總靜音再打開，不會擅自把BGM也打開。
4. 選 **게임종료**，結束目前連線並回標題；不是刪角／重seed。重新連線仍讀同一份既有存檔。
5. I→消耗品，把200/201/202拖到七格；格與格之間拖曳會搬綁定並覆蓋目的，不互換。
   把已綁的圖示拖到空白場景，清掉綁定、**不丟掉藥水**。其他UI／畫面外／blur／Escape取消。
   背包沒有該物品時保留0數量綁定，依原4F90F0不從空庫存開始拖；重新取得後可再搬／清。
6. 點聊天的原小箭頭，輸入收件人；之後直接打訊息會持續送悄悄話，收件人名稱顯示在左側原格。
   再點小箭頭回「모두에게」。保留上次收件人供下次輸入；換帳號／角色或下線清除，不寫進save。
   `/w 名字 訊息`與`/f 名字`仍可用，不必為切換模式重打斜線前綴。

## 3. 生命週期與安全

- 原系統設定是本機CConfig；browser用origin localStorage `kms111.soundSettings`，不是角色欄位。
  只保存OK；失敗／封鎖／壞JSON回預設，不阻擋進入遊戲。快捷格仍用原帳號／角色tuple profile。
- 傳圖、斷線、死亡復活窗或體驗工具會關掉系統窗並還原未確認預覽；快捷拖曳立即取消。
  拖曳另檢查owner／profile identity／itemEpoch／原itemId／當前真庫存，舊滑鼠release不改新人物設定。
- 全畫面DOM modal攔鍵盤與點擊、圈住Tab焦點；清原移動鍵，阻止攻擊、快捷使用和傳送點發送。
  遊戲世界**不暫停**。本輪沒有宣稱任意UI focus／z-order manager已完整重建。
- 本機攻擊增加獨立localActionEpoch：等待PNG時開窗再關窗，也不事後補送那次Ctrl。
  不以combatEpoch取消旁觀角色的合法攻擊。快捷拖曳亦使舊本機載入ticket過期。
- 音量改既有GainNode，不重新decode／重播BGM；保留原音訊／autoplay解鎖。
  stop遞增effectGeneration，已離開stage後舊pending音效不能才開始播放。
- 文字輸入支援IME composition guard，按Enter確認韓文／中文組字不順便送聊天或確認收件人。
  收件人窗口只設本機recipient，不送find／check-new-name／任何建角或變更角色請求。

## 4. 仍未完成／與原生的界線

- Quest／Community／GameOpt視窗仍缺；**Party在這版原檔沒有對應分支**（ADR-090以PE机器码／C／listing／WZ顶层属性交叉确认），故不是「漏接的party窗」，派對資訊入口是`/파티정보`。原圖列出但disabled，不能把既有server組隊封包說成完整UI。
- SysOpt的DirectX畫質／Win32截圖目的地未移植，保留disabled位置，沒有把瀏覽器縮放冒稱原soVideo。
  PE 5BE860直接decode確認第一項「메이플스토리 폴더」、5BE854「바탕 화면」、5BE850「C:\」。
  原selector的disabled外框／文字為browser繪製，非逐像素原CCtrlComboBox；Menu hover目前取原mouseOver第0格，未重建全部高亮動畫timing。
- Native百分比已核對；Web Audio線性gain不等於證明DirectSound dB／driver／混音／重採樣逐樣本相同。
  localStorage亦不是Windows registry相容格式；browser總靜音是額外殼層功能。
- CUtilDlgEx文本使用原Border與尺寸公式，但browser量測、行高與fallback字形不是原IWzFont/GDI。
  無效收件人留在輸入窗內顯錯並讓人修正；原4F8940是關窗後向chat寫錯誤，這點未完全複製。
  ADR-059更正：接收端0x1F公開聊天與0x1A/0x12密語**有分類**；新記錄上限已改64換行record，字形量測仍非原GDI。
- 技能快捷格／施放／buff、完整鍵位設定、BtChat原窗、CShape2D／CVecCtrl、aggro／飛行、AP/SP自然發放／轉職、卷軸等既有缺口不因本輪完成。

## 5. 交付紀律

新增 `server/test/native-system-ui.test.ts`：20段／獨立mute／profile／原slider整數幾何／快捷搬清與stale
／CP949 recipient／既有gain更新與browser接線的**回歸來源**；全部未執行，不以檔名或assert數量當PASS。
只做人工原檔／原始碼／diff閱讀與 `git diff --check` 空白檢查，沒有test/check/typecheck/browser/VM/probe。
沿用 `generated/preview-death-20261018.json`，停服後冷備份，同參數重開LIVE；提交含 `[skip ci]`、非force推送。
實際備份與啟動記錄於交付時追加。

### 本輪冷備份／LIVE記錄

- 停止上一個LIVE `kms-1-11-648135c3` 後，保留當下最新進度，不恢復較舊備份。
- 冷備份：`generated/backups/preview-death-before-native-system-ui-20261018-080356.json`。
- 原save與備份SHA256同為 `cde894f36db6449980593658b2ad915d9bbc6f9d5ef7244fb50cb4a513904861`。
- 以同一個 `generated/preview-death-20261018.json` 重開 `kms-1-11-34df21b6`，PID10262。
  啟動log載入2帳號／1角色，既有account entries被忽略；沒有重建／改寫角色。
- Web8515／login8516／game8517全綁0.0.0.0；map-command／test-tools仍僅preview,demo，ping off。
  瀏覽器沿用same-origin `/ws`，不讓使用者的瀏覽器連sandbox localhost。
- 只確認程序啟動／監聽記錄，沒有訪HTTP／登入／瀏覽器操作，**不代表功能驗證通過**。
