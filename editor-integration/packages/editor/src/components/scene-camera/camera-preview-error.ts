export function cameraPreviewErrorText(error: string, zh: boolean) {
  return zh ? '取景失败，请重试' : `Preview failed: ${error}`
}
