import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.join(appDirectory, '../../..')
const dependencyAlias = (name: string) =>
  `./${path
    .relative(workspaceRoot, path.join(appDirectory, '../../node_modules', name))
    .split(path.sep)
    .join('/')}`
const portableBuild = process.env.PASCAL_PORTABLE_BUILD === '1'

const nextConfig: NextConfig = {
  ...(process.env.PASCAL_BOUNDARY_BUILD === '1' ? { distDir: '.next-integration-audit' } : {}),
  ...(portableBuild ? { output: 'standalone' as const, outputFileTracingRoot: workspaceRoot } : {}),
  logging: {
    browserToTerminal: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // MCP / package metadata returns `/editor/<id>` (hosted route). This open-source
  // app serves saved scenes at `/scene/<id>` — redirect so links and bookmarks work.
  async redirects() {
    return [
      {
        source: '/editor/:id',
        destination: '/scene/:id',
        permanent: false,
      },
    ]
  },
  transpilePackages: [
    '@xiaohai/pascal-string-lights',
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/mcp',
    '@pascal-app/plugin-pool',
    '@pascal-app/plugin-streetscape',
    '@pascal-app/plugin-trees',
    '@mint/pascal-plugin',
    '@pascal-app/plugin-bones',
    '@pascal-app/plugin-environment',
    '@dgreenheck/ez-tree',
  ],
  turbopack: {
    root: workspaceRoot,
    resolveAlias: {
      react: dependencyAlias('react'),
      three: dependencyAlias('three'),
      '@react-three/fiber': dependencyAlias('@react-three/fiber'),
      '@react-three/drei': dependencyAlias('@react-three/drei'),
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  images: {
    unoptimized:
      portableBuild ||
      (process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false),
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
