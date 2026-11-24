export function downloadCameraBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[\\/:*?"<>|]/g, '-')
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
