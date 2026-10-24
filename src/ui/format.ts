/** 83400 → "1:23.4" */
export const formatMs = (ms: number) => {
  const tenths = Math.round(ms / 100);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
};
