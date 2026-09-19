export interface ReportPageGeometry {
  size?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  /** Margins in CSS order: top, right, bottom, left. */
  margins?: [number, number, number, number];
}

export function reportCanvasWidth(page?: ReportPageGeometry): number {
  const dimensions = page?.size === 'Letter' ? [612, 792] : [595, 842];
  const pageWidth = page?.orientation === 'landscape' ? dimensions[1] : dimensions[0];
  const margins = page?.margins ?? [40, 40, 40, 40];
  return Math.max(240, pageWidth - margins[1] - margins[3]);
}
