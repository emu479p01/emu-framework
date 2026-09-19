export interface ReportPageGeometry {
  size?: 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'Custom';
  orientation?: 'portrait' | 'landscape';
  width?: number;
  height?: number;
  /** Margins in CSS order: top, right, bottom, left. */
  margins?: [number, number, number, number];
}

export function reportCanvasWidth(page?: ReportPageGeometry): number {
  const dimensions = page?.size === 'A3' ? [842, 1191] : page?.size === 'A5' ? [420, 595] : page?.size === 'Letter' ? [612, 792] : page?.size === 'Legal' ? [612, 1008] : page?.size === 'Custom' ? [page.width ?? 595, page.height ?? 842] : [595, 842];
  const pageWidth = page?.orientation === 'landscape' ? dimensions[1] : dimensions[0];
  const margins = page?.margins ?? [40, 40, 40, 40];
  return Math.max(240, pageWidth - margins[1] - margins[3]);
}
