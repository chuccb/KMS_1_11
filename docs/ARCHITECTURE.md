# 目標架構（完整 MMO）

## 分層與依賴方向（單向，禁止反向）

```
                    ┌──────────── client/ (Godot 4.x, GDScript) ─────────────┐
                    │ scenes/ render/ input/ ui/ audio/                      │
                    │ + protocol/ (由 schema 產生或驗證的 codec)              │
                    └───────────────┬────────────────────────────────────────┘
                                    │ TCP（frame codec 由 protocol/ 決定）
                    ┌───────────────▼───────────────┐
                    │ server/ (TypeScript, Node 22)  │  login / world / channel / game
                    │ 使用 protocol/ 的同一份 codec   │  持久化 / 會話 / 地圖實例
                    └───────────────┬───────────────┘
                                    │ 讀取已轉檔的資料 + schema
        ┌───────────────────────────┴────────────────────────────┐
        │ protocol/  schema（單一來源） → codec + 測試向量          │
        └───────────────────────────┬────────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │ tools/ (Python, 離線執行)      │  Data.wz → PNG/JSON/OGG + manifest
                    └───────────────┬───────────────┘
                                    │
                              Data.wz（只讀）
```

## 目錄職責

| 目錄 | 職責 | 不可做的事 |
|---|---|---|
| `tools/` | 讀 `Data.wz`、還原資源、產生 `assets/` 與 metadata；分析 binary 的輔助腳本 | 不可被 runtime 依賴；不可改寫 `Data.wz` |
| `protocol/` | 協定唯一來源：訊息定義、欄位型別、測試向量（golden bytes）| 不可包含遊戲規則或狀態 |
| `server/` | 權威狀態：帳號、角色、地圖實例、怪物 AI、掉落、交易；封包處理 | 不可依賴 Godot；不可把未證實的協定寫成規格 |
| `client/` | 呈現與輸入：地圖分層繪製、動畫、UI、音訊、預測與插值 | 不可作為數值/規則的權威；不可直接讀 `Data.wz`（只讀 `assets/`）|
| `docs/` | evidence / architecture / protocol / 決策記錄 | 不可出現「未標證據的結論」 |

## 依賴規則（違反即為 bug）

1. `server` **不得** import `client`；`client` **不得** import `server`（唯一共用面是 `protocol/`）。
2. `client` 不得直接讀 `Data.wz`；只能讀 `assets/`（由 `tools/` 產生，可重建、不進 git）。
3. 任何「未在 `docs/protocol/FINDINGS.md` 被證實」的封包欄位，程式碼必須以 `HYPOTHESIS` 註解標明，並有測試可隨時改。
4. 數值（HP/EXP/掉寶/技能係數）以 **server 為權威**；client 只做顯示與預測。
5. 不得出現 Win32 / COM / DirectX 相容層；不得把 Hex-Rays C 逐行翻譯。

## 執行環境與工具鏈

| 需求 | 版本 | 備註 |
|---|---|---|
| Node.js | 22+ | 原生 TypeScript type stripping，`node --test` 內建 → 零依賴 |
| Python | 3.11+ | 只用標準庫（`unittest`），無需 pip 安裝 |
| Godot | 4.x 最新 stable（GDScript，**非 .NET 版**）| 為了保留 Web 匯出能力（C# 專案目前無法 export web）|
| Git | — | `assets/`、`bin/`、`.godot/` 一律 gitignore |

## CI

`.github/workflows/ci.yml`
- job `tools`：`python3 -m unittest discover -s tools/tests`（`Data.wz` 不存在時自動 skip）
- job `server`：`node --test server/test`
- job `protocol`：驗證 `protocol/schema/*` 與其產生的 golden 測試向量一致（Phase 1 起）
