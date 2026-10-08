// OpenCode Go Live Catalog Extension v1.1.0
// 檔案位置：~/.pi/agent/extensions/opencode-go-live-catalog-v1.1.0/index.ts
//
// 本版修正 v1.0.0 的兩個問題：
//   1. v1.0.0 在 refreshModels 時只保留 gpt-*-luna 的動態模型，等於把 pi.dev 遠端目錄
//      的 overlay（例如改名後的 space-bunny）全部丟掉，因此 Pi 一直看不到新模型。
//   2. v1.0.0 直接回傳 Pi 內建靜態目錄的完整清單，因此上游已下架、但 Pi 版本尚未更新的
//      模型（例如 space-bunny-free）會一直顯示且無法呼叫。
//
// v1.1.0 的可見清單規則（getModels）：
//   內建靜態目錄 ∩ 即時訂閱目錄（在仍可呼叫的前提下保留 Pi 的官方定義）
//   ＋ models-store.json / pi.dev 遠端目錄 overlay（不在內建清單者）
//   ＋ 以 gpt-5.6-luna 為模板自動加入的 gpt-*-luna 新版本
//
// 安全設計：不寫入 models.json 與 auth.json、不外洩金鑰、只透過 provider catalog store 持久化。

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Api, Model, Provider, RefreshModelsContext } from "@earendil-works/pi-ai"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

// OpenCode Go 只提供 /v1/models 的 ID；不能從 ID 推測任意模型的協定與能力。
// 因此僅自動加入已由實測確認可沿用 Responses API 設定的 GPT-Luna 新版本。
const PROVIDER_ID = "opencode-go"
const MODELS_URL = "https://opencode.ai/zen/go/v1/models"
const REQUEST_TIMEOUT_MS = 10_000
const GPT_LUNA_PATTERN = /^gpt-(\d+(?:\.\d+)?)-luna$/
// 即時目錄回傳數量過少時視為可疑回應，此時不做任何裁切，避免把可用模型誤藏起來。
const MIN_LIVE_IDS_FOR_PRUNE = 5
const STORE_FILE_NAME = "models-store.json"

type LiveModelsResponse = {
  data?: Array<{ id?: unknown }>
}

/** 一次即時目錄查詢的結果。 */
type LiveSnapshot = {
  /** 訂閱當下實際可用的模型 ID。 */
  ids: Set<string>
}

/** 只取 models 欄位的寬鬆型別，避免綁死特定 pi-ai 版本的型別名稱。 */
type StoredLike = { models?: readonly unknown[] } | undefined

/** 檢查是否為可用的模型物件（只需要 id 與 api 就足以安全沿用）。 */
function isValidModel(value: unknown): value is Model<Api> {
  const model = value as Model<Api> | undefined
  return (
    typeof model?.id === "string" && model.id.length > 0 && typeof model?.api === "string"
  )
}

/** 依 id 去重，後出現者優先（overlay 與動態模型可覆寫內建定義）。 */
function dedupeById(models: readonly Model<Api>[]): Model<Api>[] {
  const merged = new Map<string, Model<Api>>()
  for (const model of models) merged.set(model.id, model)
  return [...merged.values()]
}

/**
 * 把清單限制在「即時訂閱目錄仍有」的模型。
 * 沒有即時資料（離線或查詢失敗）時完整保留，避免把 Pi 變成空的。
 */
function filterByLiveIds(models: readonly Model<Api>[], liveIds: Set<string> | null): Model<Api>[] {
  if (!liveIds || liveIds.size < MIN_LIVE_IDS_FOR_PRUNE) return [...models]
  return models.filter((model) => liveIds.has(model.id))
}

/**
 * 建立遠端目錄 overlay：Pi 內建清單沒有、且仍存在於即時訂閱目錄的模型。
 * 這是「保留 pi.dev overlay」的核心：v1.0.0 只保留 gpt-*-luna，這裡保留全部。
 */
function overlayFromStored(
  storedModels: readonly unknown[] | undefined,
  builtinIds: ReadonlySet<string>,
  liveIds: Set<string> | null,
): Model<Api>[] {
  const candidates = (storedModels ?? []).filter(isValidModel)
  return dedupeById(filterByLiveIds(
    candidates.filter((model) => !builtinIds.has(model.id)),
    liveIds,
  ))
}

/** 以已測試的 GPT-Luna Responses 設定建立後續版本，並保留 Pi 的 session header 流程。 */
function createGptLunaModel(id: string, prototype: Model<Api>): Model<Api> {
  const version = id.match(GPT_LUNA_PATTERN)?.[1] ?? id
  return {
    ...prototype,
    id,
    name: `GPT ${version} Luna (OpenCode Go; live catalog)`,
  }
}

/** 讀取 Pi 的 OpenCode Go API Key；只在記憶體中使用，絕不輸出或寫檔。 */
async function readApiKey(agentDir: string): Promise<string> {
  try {
    // auth.json 可能是 UTF-8 BOM；JSON.parse 需先移除 BOM。
    const authText = await readFile(join(agentDir, "auth.json"), "utf8")
    const auth = JSON.parse(authText.replace(/^\uFEFF/, "")) as {
      "opencode-go"?: { key?: unknown }
    }
    const key = auth["opencode-go"]?.key
    return typeof key === "string" ? key.trim() : ""
  } catch {
    return ""
  }
}

/** 直接讀取 models-store.json 中本 provider 的遠端 overlay（給 Pi-Web 啟動時立即使用）。 */
async function readStoredOverlayFromDisk(agentDir: string): Promise<readonly unknown[] | undefined> {
  try {
    const text = await readFile(join(agentDir, STORE_FILE_NAME), "utf8")
    const data = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, StoredLike>
    const entry = data?.[PROVIDER_ID]
    return entry?.models
  } catch {
    return undefined
  }
}

/** 查詢 OpenCode Go 即時目錄，回傳可用的模型 ID 與可安全加入的新模型。 */
async function fetchLiveCatalog(
  apiKey: string,
  builtinIds: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<LiveSnapshot | null> {
  const abortSignal = signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "Pi-OpenCodeGo-LiveCatalog/1.1",
      },
      signal: abortSignal,
    })
    if (!response.ok) return null
    const payload = (await response.json()) as LiveModelsResponse
    const ids = new Set(
      (payload.data ?? [])
        .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
        .filter((id) => id.length > 0),
    )
    return { ids }
  } catch {
    // 網路或認證暫時不可用時保持現有清單，不影響 Pi 啟動。
    return null
  }
}

/** 依即時目錄產生可自動加入的模型（目前為 gpt-*-luna 家族）。 */
function buildAdditions(
  liveIds: Set<string>,
  builtinModels: readonly Model<Api>[],
  builtinIds: ReadonlySet<string>,
): Model<Api>[] {
  const prototype = builtinModels.find((model) => model.id === "gpt-5.6-luna")
  if (!prototype) return []
  return [...liveIds]
    .filter((id) => !builtinIds.has(id) && GPT_LUNA_PATTERN.test(id))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => createGptLunaModel(id, prototype))
}

export default async function (pi: ExtensionAPI) {
  // 使用 Pi 內建 OpenCode Go provider，保留官方認證、三種 API 與動態 session header 行為。
  const builtin = builtinProviders().find((provider) => provider.id === PROVIDER_ID)
  if (!builtin) throw new Error("Pi built-in OpenCode Go provider is unavailable.")
  const builtinModels = builtin.getModels() as readonly Model<Api>[]
  const builtinIds: ReadonlySet<string> = new Set(builtinModels.map((model) => model.id))

  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")

  // 遠端 overlay（pi.dev 目錄）與自動加入的模型，兩者都是可覆寫內建定義的動態層。
  let overlayModels: Model<Api>[] = []
  let additions: Model<Api>[] = []
  let liveIds: Set<string> | null = null

  // 啟動時先讀 models-store.json，讓 Pi-Web 建立 runtime 的第一刻就看得到遠端目錄的新模型。
  {
    const startupApiKey = await readApiKey(agentDir)
    if (startupApiKey) {
      const snapshot = await fetchLiveCatalog(startupApiKey, builtinIds)
      if (snapshot) {
        liveIds = snapshot.ids
        additions = buildAdditions(snapshot.ids, builtinModels, builtinIds)
      }
    }
    overlayModels = overlayFromStored(await readStoredOverlayFromDisk(agentDir), builtinIds, liveIds)
  }

  const provider: Provider = {
    ...builtin,
    // 內建定義只在「訂閱目錄仍有」時保留；overlay 與動態模型可覆寫同名項目。
    getModels: () =>
      dedupeById([
        ...filterByLiveIds(builtinModels, liveIds),
        ...overlayModels,
        ...additions,
      ]),
    refreshModels: async (context: RefreshModelsContext) => {
      // 1) 離線階段：先還原 provider catalog store 內的遠端 overlay（不再只留 gpt-*-luna）。
      const restored = overlayFromStored(context.stored?.models, builtinIds, liveIds)
      if (restored.length > 0) {
        await context.publish({
          update: () => {
            overlayModels = restored
          },
        })
      }

      if (!context.allowNetwork || context.signal.aborted) return
      const credential = context.credential
      if (credential?.type !== "api_key" || !credential.key) return

      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const snapshot = await fetchLiveCatalog(credential.key, builtinIds, signal)
      if (!snapshot) return

      // 2) 已經有即時資料：更新 prune 依據並以最新的 overlay 重新篩選。
      liveIds = snapshot.ids
      const nextAdditions = buildAdditions(snapshot.ids, builtinModels, builtinIds)
      const nextOverlay = overlayFromStored(context.stored?.models, builtinIds, liveIds)
      // 持久化時保留 lastModified / etag，讓 pi.dev 的條件式抓取（304）繼續有效。
      await context.publish({
        persist: {
          ...(context.stored ?? {}),
          models: dedupeById([...nextOverlay, ...nextAdditions]),
          checkedAt: Date.now(),
        },
        update: () => {
          overlayModels = nextOverlay
          additions = nextAdditions
        },
      })
    },
  }

  pi.registerProvider(provider)
}
