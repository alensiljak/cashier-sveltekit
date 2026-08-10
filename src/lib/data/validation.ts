export interface ValidationIssue {
	kind: 'error' | 'warning';
	message: string;
}
