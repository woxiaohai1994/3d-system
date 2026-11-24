import IfcConverter from '@/components/IfcConverter'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 py-12">
      <div className="max-w-7xl mx-auto px-6 pb-4 space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">IFC → Pascal Converter</h1>

        <details className="text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            Early alpha — conversion limitations
          </summary>
          <p className="mt-3 leading-relaxed">
            IFC is a sprawling, loosely-followed standard and real-world exports vary a lot, so
            expect rough edges — misplaced or missing elements, default-height walls, skipped items.{' '}
            <a
              className="font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-700"
              href="https://github.com/pascalorg/editor/tree/main/apps/ifc-converter"
              rel="noopener noreferrer"
              target="_blank"
            >
              Contributions welcome
            </a>{' '}
            — a sample IFC that converts badly, or a PR improving the conversion, both help a lot.
          </p>
        </details>
      </div>
      <IfcConverter />
    </main>
  )
}
