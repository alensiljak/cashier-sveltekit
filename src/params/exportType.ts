import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param: string): param is 'journal' | 'scheduled' => {
	return param === 'journal' || param === 'scheduled';
}) satisfies ParamMatcher;
