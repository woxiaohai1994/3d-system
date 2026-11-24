'use client'

import { setCatalogAssets } from '@pascal-app/editor/ai/runtime'
import {
  setLightAssets,
  setLightAssetCollectionHandler,
} from '@xiaohai/pascal-string-lights/assets'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ModelRecord } from '@/lib/model-assets/contracts'
import { initialTaxonomy, type ModelTaxonomy } from '@/lib/model-assets/taxonomy'

export async function modelRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '模型请求失败。')
  if (
    init?.method &&
    init.method !== 'GET' &&
    url.startsWith('/api/model-assets') &&
    typeof BroadcastChannel !== 'undefined'
  ) {
    const channel = new BroadcastChannel('model-library')
    channel.postMessage('changed')
    channel.close()
  }
  return result
}

const LibraryContext = createContext<{
  taxonomy: ModelTaxonomy
  records: ModelRecord[]
  error: string
  refresh: () => Promise<void>
} | null>(null)

export function ModelLibraryProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<ModelRecord[]>([])
  const [taxonomy, setTaxonomy] = useState(initialTaxonomy)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const result = (await modelRequest('/api/model-assets')) as {
        records: ModelRecord[]
        taxonomy: ModelTaxonomy
      }
      if (current !== generation.current) return
      setRecords(result.records)
      setTaxonomy(result.taxonomy)
      setLightAssets(
        result.records
          .filter((r) => r.status === 'published')
          .map((r) => ({
            ...r.asset,
            stringLight: r.collections?.includes('string-lights') ?? false,
            availableMaterials: [
              ...new Set([...(r.facts?.materials ?? []), ...(r.facts?.meshNames ?? [])]),
            ],
          })),
      )
      setCatalogAssets(
        result.records.filter((r) => r.status === 'published').map((r) => r.asset),
        {
          replace: true,
          excludedIds: result.records.filter((r) => r.status !== 'published').map((r) => r.id),
        },
      )
      setError('')
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : '模型库加载失败。')
      throw e
    }
  }, [])
  useEffect(() => {
    setLightAssetCollectionHandler(async (id, enabled) => {
      const record = records.find((r) => r.id === id)
      if (!record) throw new Error('模型不存在，请刷新模型库。')
      try {
        await modelRequest(`/api/model-assets/${encodeURIComponent(id)}/collection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: record.revision, collection: 'string-lights', enabled }),
        })
      } finally {
        await refresh()
      }
    })
    return () => setLightAssetCollectionHandler(null)
  }, [records, refresh])
  useEffect(() => {
    const reload = () => {
      void refresh().catch(() => {})
    }
    reload()
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('model-library') : null
    if (channel) channel.onmessage = reload
    window.addEventListener('focus', reload)
    return () => {
      channel?.close()
      window.removeEventListener('focus', reload)
      generation.current++
      setCatalogAssets([])
      setLightAssets([])
    }
  }, [refresh])
  return (
    <LibraryContext.Provider value={{ records, taxonomy, error, refresh }}>
      {children}
    </LibraryContext.Provider>
  )
}

export function useModelLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('ModelLibraryProvider is required')
  return value
}
