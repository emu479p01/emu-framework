import type { ReportBandMeta, ReportMeta, ReportPageMeta } from './types.js';

export type ReportDesignUnit = 'cm' | 'in' | 'px';
export interface ReportLayoutDiagnostic { path: string; code: string; message: string; severity: 'error' | 'warning' }

const PAGE_POINTS: Record<Exclude<NonNullable<ReportPageMeta['size']>, 'Custom'>, [number, number]> = {
  A3: [842, 1191], A4: [595, 842], A5: [420, 595], Letter: [612, 792], Legal: [612, 1008],
};

export function pointsPerUnit(unit: ReportDesignUnit): number { return unit === 'in' ? 72 : unit === 'cm' ? 72 / 2.54 : 0.75; }
export function pointsToUnit(points: number, unit: ReportDesignUnit): number { return points / pointsPerUnit(unit); }
export function unitToPoints(value: number, unit: ReportDesignUnit): number { return value * pointsPerUnit(unit); }

export function reportPageDimensions(page?: ReportPageMeta): [number, number] {
  const size = page?.size ?? 'A4';
  const dimensions: [number, number] = size === 'Custom' ? [page?.width ?? 595, page?.height ?? 842] : PAGE_POINTS[size];
  return page?.orientation === 'landscape' ? [dimensions[1], dimensions[0]] : dimensions;
}

export function validateReportLayout(report: ReportMeta): ReportLayoutDiagnostic[] {
  const strict = report.layoutVersion === 2; const severity = strict ? 'error' : 'warning'; const diagnostics: ReportLayoutDiagnostic[] = [];
  const add = (path: string, code: string, message: string, alwaysError = false) => diagnostics.push({ path, code, message, severity: alwaysError ? 'error' : severity });
  const page = report.page; const [pageWidth, pageHeight] = reportPageDimensions(page); const margins = page?.margins ?? [40, 40, 40, 40];
  if (page?.size === 'Custom' && (!(page.width && page.width > 0) || !(page.height && page.height > 0))) add('/page', 'custom_size', 'Custom paper requires positive width and height', true);
  margins.forEach((value, index) => { if (!Number.isFinite(value) || value < 0) add(`/page/margins/${index}`, 'negative_margin', 'Margins must be non-negative', true); });
  const usableWidth = pageWidth - margins[1] - margins[3]; const usableHeight = pageHeight - margins[0] - margins[2];
  if (usableWidth <= 0 || usableHeight <= 0) add('/page/margins', 'no_usable_area', 'Margins leave no printable page area', true);
  const validateBands = (bands: ReportBandMeta[], path: string, pageBands: boolean) => {
    let reserved = 0;
    bands.forEach((band, bandIndex) => {
      const bandPath = `${path}/${bandIndex}`;
      if (!Number.isFinite(band.height) || band.height < 0) add(`${bandPath}/height`, 'negative_band', 'Band height must be non-negative', true);
      if (pageBands && ['header', 'footer', 'pageHeader', 'pageFooter'].includes(band.kind)) reserved += Math.max(0, band.height);
      band.elements.forEach((element, elementIndex) => {
        const elementPath = `${bandPath}/elements/${elementIndex}`;
        if (![element.x, element.y, element.width, element.height].every(Number.isFinite) || element.x < 0 || element.y < 0 || element.width < 0 || element.height < 0) add(elementPath, 'negative_geometry', 'Element position and size must be finite and non-negative', true);
        if (element.x + element.width > usableWidth + 0.01) add(elementPath, 'element_width', `Element exceeds usable page width (${usableWidth.toFixed(2)}pt)`);
        if (element.y + element.height > band.height + 0.01) add(elementPath, 'element_height', `Element exceeds its ${band.kind} band (${band.height.toFixed(2)}pt)`);
        if (element.type === 'image') {
          if (!element.image) add(`${elementPath}/image`, 'image_source', 'Image element requires an asset or attachment source', true);
          else if (element.image.source === 'asset' && (!element.image.assetId || !report.assets?.some((asset) => asset.id === element.image!.assetId))) add(`${elementPath}/image/assetId`, 'image_asset', 'Image asset is missing', true);
          else if (element.image.source === 'attachment' && !element.image.attachmentIdField && !element.image.attachmentName) add(`${elementPath}/image`, 'image_attachment', 'Attachment image requires attachmentIdField or attachmentName', true);
        }
      });
      if (band.layout === 'tablix' && band.tablix) {
        const explicitWidth = band.tablix.columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
        if (explicitWidth > usableWidth + 0.01) add(`${bandPath}/tablix/columns`, 'tablix_width', `Tablix columns exceed usable page width (${usableWidth.toFixed(2)}pt)`);
      }
    });
    return reserved;
  };
  const reserved = validateBands(report.bands, '/bands', true); if (reserved > usableHeight + 0.01) add('/bands', 'page_bands_height', `Header and footer exceed usable page height (${usableHeight.toFixed(2)}pt)`);
  (report.lineSources ?? []).forEach((line, index) => validateBands(line.bands, `/lineSources/${index}/bands`, false));
  return diagnostics;
}
