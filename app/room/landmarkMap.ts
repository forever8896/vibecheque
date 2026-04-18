// Maps a normalized MediaPipe landmark [0,1] in the source video frame
// to canvas pixel coords that line up with a CSS `object-cover` video
// element of the same bounds. Without this, the landmark→canvas mapping
// drifts horizontally or vertically whenever the tile's aspect ratio
// differs from the webcam's (which is basically always).
export type LandmarkMapper = (nx: number, ny: number) => {
  x: number;
  y: number;
};

export function makeLandmarkMapper(
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
): LandmarkMapper {
  if (videoW <= 0 || videoH <= 0 || canvasW <= 0 || canvasH <= 0) {
    return (nx, ny) => ({ x: nx * canvasW, y: ny * canvasH });
  }
  // object-cover picks the larger scale so the video fully covers
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const displayedW = videoW * scale;
  const displayedH = videoH * scale;
  const offsetX = (canvasW - displayedW) / 2;
  const offsetY = (canvasH - displayedH) / 2;
  return (nx, ny) => ({
    x: nx * displayedW + offsetX,
    y: ny * displayedH + offsetY,
  });
}
