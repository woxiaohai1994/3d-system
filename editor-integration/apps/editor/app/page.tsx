'use client'

import { Editor } from '@pascal-app/editor'
import { AIPreview2D, AIPreview3D } from '@pascal-app/editor/ai/host'
import { Bot, Hammer, Layers, Package, Settings } from 'lucide-react'
import { AIPanel, AIProvider } from '@/components/ai-panel'
import { BuildTab } from '@/components/build-tab'
import { ModelLibraryPanel } from '@/components/model-library-panel'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

const SIDEBAR_TABS = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: <Layers className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'build',
    label: 'Build',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: <Hammer className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'items',
    label: 'Items',
    component: ModelLibraryPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
    icon: <Package className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'ai',
    label: 'AI Assistant',
    component: AIPanel,
    mobileDefaultSnap: 0.8,
    mobileIcon: <Bot className="h-5 w-5" />,
    icon: <Bot className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
    icon: <Settings className="h-6 w-6" strokeWidth={1.75} />,
  },
]

const PROJECT_ID = 'local-editor'

export default function Home() {
  return (
    <AIProvider key={PROJECT_ID} projectId={PROJECT_ID}>
      <div className="relative h-screen w-screen">
        <Editor
          viewerSceneSlot={<AIPreview3D />}
          floorplanSceneSlot={<AIPreview2D />}
          layoutVersion="v2"
          projectId={PROJECT_ID}
          sidebarTabs={SIDEBAR_TABS}
          viewerToolbarLeft={<CommunityViewerToolbarLeft />}
          viewerToolbarRight={<CommunityViewerToolbarRight />}
        />
      </div>
    </AIProvider>
  )
}
