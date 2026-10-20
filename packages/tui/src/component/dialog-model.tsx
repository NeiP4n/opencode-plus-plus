import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogIntegration } from "./dialog-integration"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"
import { modelPreferenceKey } from "../model-preference"
import { useLocation } from "../context/location"
import { useClient } from "../context/client"
import { useT } from "../util/i18n"
import {
  FREEBUFF_PROVIDER_ID,
  freebuffFooter,
  type FreebuffPricing,
  type Translate,
} from "../util/freebuff-price"

// Freebuff charges freebucks per session, so the picker has to show the price of a
// model and the balance left before the user picks one. The core plugin resolves the
// catalog rows to the account's price table and answers with both.
const FREEBUFF_RPC_ID = "opencode.freebuff"

interface FreebuffStatusResponse {
  readonly balance?: number
  readonly prices?: ReadonlyArray<{ readonly key: string; readonly price?: number }>
}

// With onPick the choice goes to the caller (the global default model) instead of the
// current session's selection.
export function DialogModel(props: {
  providerID?: string
  title?: string
  onPick?: (model: { providerID: string; modelID: string }) => void
}) {
  const local = useLocal()
  const data = useData()
  const dialog = useDialog()
  const location = useLocation()
  const client = useClient()
  const t = useT()
  const [query, setQuery] = createSignal("")
  const favoritePriority = new Set(local.model.favorite().map(modelPreferenceKey))
  const [freebuffPricing, setFreebuffPricing] = createSignal<FreebuffPricing | undefined>()

  const connected = useConnected()
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])
  // Providers whose active access choice is an OAuth account instead of an API key.
  // `connections` lists stored credentials before environment names and the active one first.
  const subscriptions = createMemo(() => {
    const accounts = new Set(
      (data.location.integration.list(location.ref) ?? [])
        .filter((integration) => {
          const connection = integration.connections[0]
          return connection?.type === "credential" && connection.method === "oauth"
        })
        .map((integration) => integration.id),
    )
    return new Set(
      Array.from(providers().values())
        // The same integration key the server uses to decide whether a provider is available.
        .filter((provider) => accounts.has(provider.integrationID ?? provider.id))
        .map((provider) => provider.id),
    )
  })

  const showExtra = createMemo(() => connected() && !props.providerID)

  // The Freebuff balance and its price table live behind the provider's own RPC, so
  // they are fetched once per picker open and only when Freebuff rows are on screen.
  onMount(() => {
    if (!models().some((model) => model.providerID === FREEBUFF_PROVIDER_ID)) return
    void client.api.rpc
      .call({ rpcID: FREEBUFF_RPC_ID, method: "status", input: {} })
      .then((result) => {
        const output = result.output as FreebuffStatusResponse | undefined
        if (!output) return
        const prices: Record<string, number> = {}
        for (const entry of output.prices ?? []) {
          if (typeof entry.price === "number") prices[entry.key] = entry.price
        }
        setFreebuffPricing({
          prices,
          ...(typeof output.balance === "number" ? { balance: output.balance } : {}),
        })
      })
      .catch(() => undefined)
  })

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const model = models().find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        const provider = providers().get(model.providerID)
        return [
          {
            key: item,
            value: { providerID: model.providerID, modelID: model.id },
            title: model.name,
            releaseDate: model.time.released,
            description: provider?.name ?? model.providerID,
            category,
            footer: modelFooter(model, subscriptions(), freebuffPricing(), t),
            // While searching, the dialog shows the search footer instead of the
            // category, so the price of a Freebuff row has to travel with it.
            searchFooter: modelFooter(model, subscriptions(), freebuffPricing(), t),
            onSelect: () => {
              onSelect(model.providerID, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const modelOptions = sortModelOptions(
      models()
        .filter((model) => model.status !== "deprecated")
        .filter((model) => (props.providerID ? model.providerID === props.providerID : true))
        .map((model) => {
          const provider = providers().get(model.providerID)
          const key = modelPreferenceKey({ providerID: model.providerID, modelID: model.id })
          const favorite = favorites.some((item) => modelPreferenceKey(item) === key)
          return {
            value: { providerID: model.providerID, modelID: model.id },
            providerID: model.providerID,
            providerName: provider?.name ?? model.providerID,
            title: model.name,
            releaseDate: model.time.released,
            description: favorite ? "(Favorite)" : undefined,
            category: connected() ? (provider?.name ?? model.providerID) : undefined,
            footer: modelFooter(model, subscriptions(), freebuffPricing(), t),
            // While searching, the dialog shows the search footer instead of the
            // category, so the provider and the price of a Freebuff row both have to
            // travel with it.
            searchFooter: [provider?.name ?? model.providerID, modelFooter(model, subscriptions(), freebuffPricing(), t)]
              .filter(Boolean)
              .join(" · "),
            onSelect() {
              onSelect(model.providerID, model.id)
            },
          }
        })
        .filter((option) => {
          if (!showSections) return true
          if (
            favorites.some(
              (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
            )
          )
            return false
          if (
            recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID)
          )
            return false
          return true
        }),
      connected(),
    )

    if (needle) {
      return prioritizeFavorites(
        sortModelOptions(
          fuzzysort.go(needle, modelOptions, { keys: ["title", "category"] }).map((item) => item.obj),
          false,
        ),
        favoritePriority,
      )
    }

    return [...favoriteOptions, ...recentOptions, ...modelOptions]
  })

  const provider = createMemo(() => (props.providerID ? providers().get(props.providerID) : undefined))

  const title = createMemo(() => {
    const value = provider()
    if (!value) return props.title ?? "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    if (props.onPick) {
      dialog.clear()
      props.onPick({ providerID, modelID })
      return
    }
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.current()
    if (cur && list.includes(cur)) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect an integration" : "View all integrations",
          selection: "none",
          onTrigger() {
            dialog.replace(() => (
              <DialogIntegration
                onConnected={(providerID) =>
                  dialog.replace(() => <DialogModel providerID={providerID} title={props.title} onPick={props.onPick} />)
                }
              />
            ))
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      focusCurrent={false}
    />
  )
}

export function prioritizeFavorites<T extends { value: { providerID: string; modelID: string } }>(
  options: T[],
  favorites: Set<string>,
) {
  return options.toSorted(
    (a, b) => Number(favorites.has(modelPreferenceKey(b.value))) - Number(favorites.has(modelPreferenceKey(a.value))),
  )
}

export function sortModelOptions<
  T extends {
    providerID?: string
    providerName?: string
    releaseDate: string | number
    title: string
    footer?: string
  },
>(options: T[], grouped = true) {
  return options.toSorted((a, b) => {
    const provider = grouped
      ? Number(b.providerID === "opencode-go") - Number(a.providerID === "opencode-go") ||
        Number(b.providerID === "opencode") - Number(a.providerID === "opencode")
      : 0
    if (provider !== 0) return provider

    const name = grouped ? (a.providerName ?? "").localeCompare(b.providerName ?? "") : 0
    if (name !== 0) return name

    const free = Number(b.footer === "Free") - Number(a.footer === "Free")
    if (free !== 0) return free

    const release = Number(b.releaseDate) - Number(a.releaseDate)
    if (release !== 0) return release

    return a.title.localeCompare(b.title)
  })
}

function free(model: { cost: Array<{ input: number }> }) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)
}

// Models a provider lists but cannot serve on this account (subscription tiers,
// unsupported endpoints) stay in the list so their name is discoverable.
export function modelFooter(
  model: { id: string; cost: Array<{ input: number }>; enabled: boolean; providerID: string },
  subscriptions: ReadonlySet<string>,
  freebuff?: FreebuffPricing,
  t: Translate = (text) => text,
) {
  // Freebuff rows are priced in freebucks, not per token, so their zero token cost
  // says nothing about what a session costs. Show the real price instead.
  if (model.providerID === FREEBUFF_PROVIDER_ID)
    return freebuffFooter(model, freebuff, t)
  if (!model.enabled) return "Locked"
  if (free(model)) return "Free"
  // An empty cost array plus an OAuth account means the account covers usage: provider
  // plugins empty `cost` for subscription models (`draft.cost = []` in the OpenAI and
  // ChatGPT plugins). Empty cost alone stays unlabelled because it can also mean the
  // price is unknown, and an account alone can also fund per-token billing.
  if (model.cost.length === 0 && subscriptions.has(model.providerID)) return "Subscription"
  return undefined
}
