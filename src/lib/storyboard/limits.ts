/** Per-creator daily cap on scene pictures. Failed attempts count, because the picture service rate-limits them too. */
export function sceneImageDailyLimit(): number {
  const n = Number.parseInt(process.env.VIDEO_IMAGE_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : 30;
}
