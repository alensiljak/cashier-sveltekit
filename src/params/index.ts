import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	exportType: (param): 'journal' | 'scheduled' | undefined => {
		return param === 'journal' || param === 'scheduled' ? param : undefined;
	}
});
