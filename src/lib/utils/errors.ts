/**
 * Custom error types for better error handling and user-friendly messages
 */

export class AppError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly action?: string
	) {
		super(message);
		this.name = 'AppError';
	}
}

export class UserError extends AppError {
	constructor(
		message: string,
		action?: string,
		public readonly details?: string
	) {
		super(message, 'USER_ERROR', action);
		this.name = 'UserError';
	}
}

export class ValidationError extends AppError {
	constructor(
		message: string,
		public readonly field?: string,
		action?: string
	) {
		super(message, 'VALIDATION_ERROR', action);
		this.name = 'ValidationError';
	}
}

export class ApiError extends AppError {
	constructor(
		message: string,
		public readonly statusCode?: number,
		action?: string
	) {
		super(message, 'API_ERROR', action);
		this.name = 'ApiError';
	}
}

export class TimeoutError extends ApiError {
	constructor(operation: string, timeoutMs: number, action?: string) {
		super(
			`${operation} timed out after ${timeoutMs}ms`,
			408,
			action || 'Please check your connection and try again'
		);
		this.name = 'TimeoutError';
	}
}

export class NotFoundError extends AppError {
	constructor(resource: string, identifier?: string, action?: string) {
		super(
			identifier ? `${resource} "${identifier}" not found` : `${resource} not found`,
			'NOT_FOUND',
			action
		);
		this.name = 'NotFoundError';
	}
}

/**
 * Result type that includes both data and warnings
 */
export interface ResultWithWarnings<T> {
	data: T;
	warnings: string[];
}

/**
 * Helper to format error messages for display
 */
export function formatErrorForDisplay(error: unknown): {
	title: string;
	message: string;
	action?: string;
} {
	if (error instanceof AppError) {
		return {
			title: error.name,
			message: error.message,
			action: error.action
		};
	}

	if (error instanceof Error) {
		return {
			title: 'Error',
			message: error.message,
			action: 'Please try again or contact support if the problem persists'
		};
	}

	return {
		title: 'Unknown Error',
		message: 'An unexpected error occurred',
		action: 'Please try again or contact support'
	};
}
