const messages: Record<string, [string, string]> = {
  'viewport-key-saved': ['关键帧已记录', 'Keyframe saved'],
  'invalid-time': ['时间无效：至少间隔一帧，范围 0–600 秒', 'Invalid time or range'],
  recalculated: [
    '已保留未修改片段；合并段按原路线拟合',
    'Unchanged spans preserved; merged span fitted',
  ],
  'export-ready': ['视频已导出', 'Video exported'],
  cancelled: ['已取消导出', 'Export cancelled'],
  'export-failed': ['导出失败，请重试', 'Export failed. Try again.'],
  'codec-unavailable': ['当前浏览器不支持 MP4 编码', 'MP4 encoding is unavailable in this browser'],
  '浏览器不支持 MP4 编码': ['浏览器不支持 MP4 编码', 'MP4 encoding is unavailable in this browser'],
  'assets-unavailable': [
    '等待场景资源加载完成后再导出',
    'Wait for scene assets to load before exporting',
  ],
  'scene-changing': [
    '场景正在变化，请完成当前操作',
    'Finish the current operation before exporting',
  ],
  'object-track-invalid': [
    '物品已删除或父级改变，请修复轨道',
    'Repair the object track before continuing',
  ],
  'camera-track-invalid': [
    '相机或切镜引用失效，请检查输出设置',
    'Check the camera and cut output settings',
  ],
  'anchor-missed': ['未拾取到物品，请重试', 'No object was picked. Try again.'],
  'motion-limit': ['关键帧数量已达到上限', 'The keyframe limit has been reached'],
  'missing-site': ['场景未就绪', 'Scene is not ready'],
  'preset-last': [
    '请选择最后一个关键帧，再添加运动预设',
    'Select the last keyframe before adding a preset',
  ],
  'choose-target': ['请先选择环绕目标', 'Choose an orbit target first'],
}

export function motionStatusText(message: string, zh: boolean) {
  const translated = Object.hasOwn(messages, message) ? messages[message] : undefined
  if (translated) return translated[zh ? 0 : 1]
  return zh && /[A-Za-z]{2}/.test(message) ? '操作未完成，请检查设置后重试' : message
}
