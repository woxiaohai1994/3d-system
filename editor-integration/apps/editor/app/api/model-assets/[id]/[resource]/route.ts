import {
  modelFileHandler,
  modelCollectionHandler,
  modelStateHandler,
  publishModelHandler,
} from '@/lib/model-assets/handlers'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; resource: string }> }
export async function GET(request: Request, context: Context) {
  const { id, resource } = await context.params
  return modelFileHandler(request, id, resource)
}
export async function POST(request: Request, context: Context) {
  const { id, resource } = await context.params
  if (resource === 'collection') return modelCollectionHandler(request, id)
  if (resource === 'delete' || resource === 'restore')
    return modelStateHandler(request, id, resource === 'delete')
  return resource === 'publish'
    ? publishModelHandler(request, id)
    : new Response(null, { status: 404 })
}
