# pi-ext-opencode-go-catalog

[English](README.en.md) | **繁體中文**

一個 **Pi extension**，在 Pi／Pi-Web 建立模型 runtime 時接管 `opencode-go` 的模型清單，用來解決兩件事：

1. **顯示上游改名後的新 ID**（例如 `space-bunny`，取代已被 Pi 內建靜態目錄收錄的舊 ID）
2. **隱藏上游已下架的舊 ID**（例如 `space-bunny-free`——Pi 內建靜態目錄無法由使用者移除它）

> Pi 的模型清單有三層：**內建靜態目錄**（`@earendil-works/pi-ai`）∪ **pi.dev overlay**（`models-store.json`）
> ∪ **`~/.pi/agent/models.json`**。核心 overlay 只會**新增**，因此沒有這個 extension 時，
> `space-bunny` 與已下架的 `space-bunny-free` 會同時出現。**只有接管 provider 註冊才能裁切掉內建殘留。**

> 模型**能力／成本／context** 的正確性由另一個元件負責：
> [pi-opencode-go-models](https://github.com/terrydada-art/pi-opencode-go-models)（技能工具）。
> 兩者版本號各自獨立（本 extension v1.1.0 ≠ 技能 v1.2.0）。

---

## 運作方式

```text
getModels() = 內建靜態目錄（以即時訂閱目錄裁切）
            ∪ pi.dev overlay（store 內所有非內建 ID，且仍在即時目錄者）
            ∪ 以 gpt-5.6-luna 為模板的 gpt-*-luna 新版本

refreshModels() = 先還原 store 內的完整 overlay
                → 有網路且有金鑰時查詢即時目錄 /v1/models
                → persist 合併後清單（保留 lastModified / etag，讓 pi.dev 走 304 快取）
```

- 資料來源：`https://opencode.ai/zen/go/v1/models`（以 `auth.json` 的 `opencode-go` 憑證）。
- 上游查詢有 10 秒 timeout；失敗時採保守行為（不裁切），不影響 Pi 啟動。
- 只透過 Pi 的 provider catalog store persist API 更新 `models-store.json`，**不修改 `models.json`、`auth.json`**。

---

## 安裝

### A. 手動安裝（推薦）

```bash
mkdir -p ~/.pi/agent/extensions/pi-ext-opencode-go-catalog
cp index.ts package.json ~/.pi/agent/extensions/pi-ext-opencode-go-catalog/
```

重新啟動 Pi／Pi-Web 後生效。

### B. 以目錄形式（含版本號）

```bash
mkdir -p ~/.pi/agent/extensions/pi-ext-opencode-go-catalog-1.1.0
cp index.ts package.json ~/.pi/agent/extensions/pi-ext-opencode-go-catalog-1.1.0/
```

> Pi 會掃描 `~/.pi/agent/extensions/` 下的直接檔案（`*.ts`／`*.js`）與含 `index.ts`／`index.js` 的子目錄。

`package.json` 依賴 `@earendil-works/pi-ai`；一般情況下會解析到 Pi 執行時期的版本，
不需在 extension 目錄內自備 `node_modules`。

---

## 驗證

```bash
# 應該只看到 space-bunny（沒有 space-bunny-free）
pi --list-models opencode-go
```

實際輸出範例（Pi 1.0.2）：

```text
provider     model        context  max-out  thinking  images
opencode-go  space-bunny  1.0M     524.3K   yes       yes
```

也可以直接確認模型可呼叫：

```bash
pi -p --model opencode-go/space-bunny "Reply exactly: OK"
```

---

## 實測對照（2026-10-08，Pi 1.0.2）

| 狀態 | `space-bunny` | `space-bunny-free` |
| --- | --- | --- |
| 完全不放 extension（僅 Pi 核心 overlay） | 顯示 | **仍顯示** |
| 舊版 v1.0.0 extension | **消失** | 顯示 |
| **本版 v1.1.0** | 顯示 | **已隱藏** |

---

## 重要限制

1. **同一個 provider 只能由一個 extension 註冊。** 若另有 extension 也對 `opencode-go` 呼叫
   `pi.registerProvider`，兩者會衝突，Pi 會退回內建靜態目錄，看起來就像「extension 無效、
   已下架的 ID 又跑出來」。請確保只有本 extension 註冊該 provider。
2. 離線或即時目錄查詢失敗時會退回「不做裁切」的保守行為，此時已下架的 ID 可能再次出現；
   恢復連線後即回復。
3. Pi 顯示清單中的模型**不代表** API 一定可用；能力與可用性請以
   [pi-opencode-go-models](https://github.com/terrydada-art/pi-opencode-go-models) 的實測報告為準。

---

## 停用

```powershell
Rename-Item "$env:USERPROFILE\.pi\agent\extensions\pi-ext-opencode-go-catalog\index.ts" "index.ts.disabled"
```

停用後會改回 Pi 核心 overlay：`space-bunny` 仍會出現，但已下架的 `space-bunny-free` 會再次顯示。

---

## 安全設計

- 不寫入 `auth.json`、`models.json`；只在記憶體中使用 API Key，不輸出、不寫入日誌或報告。
- 遠端 overlay 只透過 Pi 的 provider catalog store persist API 更新。
- 上游查詢失敗不影響 Pi 啟動（優雅降級）。

---

## 版本歷程

| 版本 | 說明 |
| --- | --- |
| **v1.1.0**（現行） | 保留完整 pi.dev overlay（不再只留 `gpt-*-luna`）、以即時目錄裁切內建項目（隱藏已下架 ID） |
| v1.0.0 | 初版：只動態補上 `gpt-*-luna` 系列。**已封存**（會取代核心 overlay，導致改名後的新 ID 消失） |

舊版 v1.0.0 已封存於 <https://github.com/terrydada-art/pi-opencode-go-live-catalog>（GitHub archived，唯讀）。

---

## 授權

MIT，詳見 [LICENSE](LICENSE)。
