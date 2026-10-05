import { deviceSettings, DeviceSettingKeys } from '$lib/settings';

export interface S3Config {
	/** S3-compatible endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
	endpoint: string;
	region: string;
	bucket: string;
	/** Optional key prefix (folder) inside the bucket. */
	prefix: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export const emptyS3Config = (): S3Config => ({
	endpoint: '',
	region: 'auto',
	bucket: '',
	prefix: '',
	accessKeyId: '',
	secretAccessKey: ''
});

export function isS3Configured(cfg: S3Config | null): cfg is S3Config {
	return !!cfg && !!cfg.endpoint && !!cfg.bucket && !!cfg.accessKeyId && !!cfg.secretAccessKey;
}

export async function loadS3Config(): Promise<S3Config | null> {
	const saved = await deviceSettings.get<Partial<S3Config>>(DeviceSettingKeys.s3Settings);
	return saved ? { ...emptyS3Config(), ...saved } : null;
}

export async function saveS3Config(cfg: S3Config): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.s3Settings, { ...cfg });
}
