import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['tests/donor-ai/**/*.vitest.ts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 2,
    isolate: true,
  },
})
