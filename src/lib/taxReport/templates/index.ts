import type { TaxReportConfig } from '../types';
import { auIndividual } from './auIndividual';

/** Built-in templates. Choosing one copies it into the user's own config. */
export const taxReportTemplates: TaxReportConfig[] = [auIndividual];

export const defaultTaxReportConfig = auIndividual;
