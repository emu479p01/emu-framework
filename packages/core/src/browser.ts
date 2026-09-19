/** Browser-safe runtime values. Keep this entry point free of Node.js dependencies. */
export { ENCRYPTED_FIELD_MASK } from './metadata/types.js';
export { pointsPerUnit, pointsToUnit, unitToPoints, reportPageDimensions, validateReportLayout } from './metadata/reportLayout.js';
export type { ReportDesignUnit, ReportLayoutDiagnostic } from './metadata/reportLayout.js';
