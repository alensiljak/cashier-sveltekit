import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	exportType: (param): 'journal' | undefined => {
		return param === 'journal' ? param : undefined;
	}
});
