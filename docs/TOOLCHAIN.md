# 工具鏈版本、安裝與升級界線

2026-10-18／ADR-066。依使用者「仔細評估後升級到最新版本」要求，選**最新正式版**，不是 nightly／beta／RC。
版本由官方 GitHub release／tag 及 npm registry 查得；這是本輪固定基線，不宣稱永遠最新。

## 鎖定與變更

| 工具 | 舊環境／lock | 新基線 | 唯一設定入口 |
|---|---|---|---|
| Node.js | 22.22.3 | **26.12.0** | 根 `.node-version`，server engines 限定26.x |
| npm | 10.9.8 | **12.2.0** | `server/package.json` packageManager，engines限定12.x |
| TypeScript | 5.9.3 | **7.0.2** | devDependencies精確版＋package-lock.json |
| Node 型別 | 22.20.5 | **26.6.5** | devDependencies精確版＋package-lock.json |
| Python | 3.11.2 | **3.15.0** | 根 `.python-version` |
| checkout Action | v4 | **v7.0.1** | workflow 固定官方tag對應commit SHA |
| setup-node Action | v4 | **v7.1.0** | 同上，Node版本讀根版本檔 |
| setup-python Action | v5 | **v7.0.0** | 同上，Python版本讀根版本檔 |

來源：[Node release](https://github.com/nodejs/node/releases/tag/v26.12.0)、
[Node schedule](https://github.com/nodejs/Release/blob/main/schedule.json)、
[npm](https://registry.npmjs.org/npm/latest)、[TypeScript release](https://github.com/microsoft/TypeScript/releases/tag/v7.0.2)、
[Node型別](https://registry.npmjs.org/@types%2fnode/latest)、[CPython tag](https://github.com/python/cpython/tree/v3.15.0)、
[checkout](https://github.com/actions/checkout/releases/tag/v7.0.1)、
[setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0)、
[setup-python](https://github.com/actions/setup-python/releases/tag/v7.0.0)。

## 相容評估與刻意不改的部分

- npm12.2.0 的 engines 接受 Node26；Node型別改同一主版本。Node26在本日期仍是LTS前正式版，
  不是比LTS更保守的選擇；本次依使用者要求最新正式版，正式營運基線需另評估。
- Node 原生 type stripping 仍使用 erasable TypeScript；**不等於自動做型別檢查**。
- TypeScript7的compiler改以平台原生optional套件分發，lockfile因此增加平台項；不代表新增遊戲runtime依賴。
  編輯器語言服務不假設仍有舊tsserver入口；未設定未驗證的IDE override。
- TypeScript跨主要版本可能有新的診斷／模組解析差異；本輪未typecheck，不能聲稱0錯誤。
- 保留 strict、noEmit、erasableSyntaxOnly、nodenext 與 ES2023 target／lib；不為升級關掉檢查或亂改瀏覽器語法基線。
- Python只用標準庫，但舊腳本是否遇到3.15行為變更仍須後續驗證；不因能顯示版本就宣稱全部工具相容。
- 不更改遊戲規則、封包、玩家save格式、WZ資料、renderer或字型；不引入另一套引擎／前端框架。
- 不全域覆寫沙箱／作業系統的 Node／Python。新版本在 ignored `generated/toolchain/`，須明確啟用。

## 安裝與啟用

一般環境可用自己的版本管理器啟用 `.node-version`／`.python-version`，再安裝固定 npm 與 `server` 開發依賴。
沙箱受網路主機白名單限制，提供不需sudo的 Linux／Bash bootstrap：

```sh
# repository root；需要現有npm、curl、tar、make、gcc、perl；其他可選標準庫仍依系統開發函式庫而定
bash tools/bootstrap-toolchain.sh
source tools/env.sh
```

Node／npm由 npm registry 的固定版套件安裝；Python從官方 CPython `v3.15.0` tag source建置。
WZ工具需要zlib：沙箱沒有其開發檔，故一併本機建置 **zlib1.3.2** 與 **OpenSSL4.0.3**，
來源為各自官方tag：[zlib](https://github.com/madler/zlib/releases/tag/v1.3.2)、[OpenSSL](https://github.com/openssl/openssl/releases/tag/openssl-4.0.3)。
`tools/build-python.sh`負責此部分，函式庫與headers留在ignored工具目錄，不改系統版本。
不使用無法下載的release資產、不把下載失敗的檔案當成功安裝。
Python保留在source build tree供純標準庫工具使用，**不是全功能Python套件環境**；未安裝pip。
Python不啟用PGO、不跑make test、不做Python install／compileall；函式庫有本機install步驟。編譯器configure會做必要的建置能力偵測，不是遊戲probe。
zlib／SSL之外的sqlite、lzma、readline等可選模組仍可能因系統開發檔缺失而未建置；不宣稱完整Python發行環境。
缺少編譯器或必要函式庫建置失敗時bootstrap會失敗並保留 `generated/toolchain/python-build.log`，不靜默退回舊版本。

每個新shell都要重新 `source tools/env.sh`。Bash工具呼叫間不保留PATH；從外部呼叫時亦需啟用。
若ignored目錄未隨沙箱重建保留，可重跑bootstrap，**工具可以重建，玩家save不能用此法重建**。
腳本不啟動server、不建立帳號／存檔、不寫入 `.bashrc` 或系統目錄。
另提供 `tools/serve-existing-save.sh`：只接受已存在且非空的save，預設8515/8516/8517；
不自行停止舊程序／冷備、不授權體驗寫入工具，也不聲稱存檔內容已通過驗證。

`node --version`、`npm --version`、`tsc --version`、`python3 --version` 僅顯示工具版本；
它們不是測試、型別檢查或相容性驗收。執行時不需要server/node_modules，但開發編譯器／型別需要。

## CI 與保留的驗證界線

CI從根版本檔設定Node／Python，安裝固定npm後使用lockfile `npm ci --ignore-scripts`。
Actions用固定commit SHA，旁註對應tag，不用浮動latest；workflow只有contents:read，checkout不保留憑證。保留既有測試與CLI流程，沒有新增偷偷執行的typecheck步驟。
本輪提交有 `[skip ci]`，**未執行CI、專案test/check/typecheck/語法檢查/browser/VM/遊戲HTTP或登入probe**。
新工具安裝成功與server啟動成功都不能代替這些驗證。

## 存檔與目前沙箱恢復問題

續接時原碼可由已推送commit恢復，但先前 `generated/preview-death-20261018.json` 與冷備未出現在目前工作區。
這不是格式升級或工具腳本刪除save；本輪沒有建立替代角色、沒有拿新fixture冒充原進度。
原遊戲LIVE恢復須先取得真正save，再停服冷備並使用同路徑啟動；資料未到前不得自動seed。
重要資料應另行匯出保存，不以Git忽略目錄或舊程序識別當永久保存保證。


## 本輪實際安裝結果

沙箱中已安裝Node26.12.0／npm12.2.0與server開發依賴，TypeScript CLI顯示7.0.2。
第一次Python建置因缺開發檔而未包含zlib／SSL，沒有將它當完整交付；補上官方tag函式庫後重建成功。
Python3.15.0 source build現在包含WZ工具所需的zlib；函式庫版本顯示 **zlib1.3.2**、**OpenSSL4.0.3（2026-09-29）**。
沙箱仍缺sqlite3、lzma、bz2、readline等可選開發函式庫，不以這個最小工具環境代替完整Python套件發行版。
純安裝紀錄與版本顯示不是專案相容性證明。`serve-existing-save.sh`未執行；原遊戲LIVE未恢復。
