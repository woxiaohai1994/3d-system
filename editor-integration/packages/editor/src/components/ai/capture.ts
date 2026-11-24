let capture: (() => Promise<string | null>) | null = null
export function setAICapture(next: (() => Promise<string | null>) | null) {
  capture = next
}
export async function captureScreenshot() {
  return capture ? capture() : null
}
