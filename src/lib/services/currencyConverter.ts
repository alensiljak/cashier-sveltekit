import fullLedgerService from './ledgerWorkerClient';

export interface ConversionResult {
	amount: number;
	currency: string;
}

export async function getCurrencies(): Promise<string[]> {
	await fullLedgerService.ensureLoaded();
	return fullLedgerService.getCurrencies();
}

export async function convert(amount: number, from: string, to: string): Promise<ConversionResult> {
	const result = await fullLedgerService.convertCurrency(amount, from, to);
	return { amount: parseFloat(result.number), currency: result.currency };
}
