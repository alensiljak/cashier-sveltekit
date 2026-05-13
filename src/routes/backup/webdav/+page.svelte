<script lang="ts">
    import { onMount } from 'svelte';
    import Toolbar from '$lib/components/Toolbar.svelte';
    import { settings, SettingKeys } from '$lib/settings';
    import { Setting } from '$lib/data/model';
    import db from '$lib/data/db';
    import { readFile, saveFile } from '$lib/utils/opfslib';
    import Notifier from '$lib/utils/notifier';
    import { WebDavClient } from '$lib/utils/webdav';
    import { SettingsIcon } from '@lucide/svelte';

    let includeSettings = $state(false);
    let includeCashierBean = $state(false);
    let showDownloadDialog = $state(false);
    let webdavUrl = $state('');
    let webdavUsername = $state('');
    let webdavPassword = $state('');
    let isUploading = $state(false);
    let isDownloading = $state(false);

    onMount(async () => {
        const saved = await settings.get<{ url: string; username: string; password: string }>(SettingKeys.webdavSettings);
        webdavUrl = saved?.url ?? '';
        webdavUsername = saved?.username ?? '';
        webdavPassword = saved?.password ?? '';
    });

    function client() {
        return new WebDavClient(webdavUrl, webdavUsername, webdavPassword);
    }

    async function upload() {
        if (!webdavUrl) { Notifier.error('WebDAV URL is not configured'); return; }
        isUploading = true;
        const dav = client();
        try {
            if (includeSettings) {
                const allSettings = await settings.getAll();
                const json = JSON.stringify(allSettings, null, 2);
                const res = await dav.put('settings.json', json, 'application/json; charset=utf-8');
                if (res.ok) Notifier.success('Settings uploaded');
                else Notifier.error(`Upload failed for settings.json: ${res.status} ${res.statusText}`);
            }
            if (includeCashierBean) {
                const content = await readFile('cashier.bean');
                if (!content) { Notifier.error('cashier.bean not found in local storage'); }
                else {
                    const res = await dav.put('cashier.bean', content);
                    if (res.ok) Notifier.success('cashier.bean uploaded');
                    else Notifier.error(`Upload failed for cashier.bean: ${res.status} ${res.statusText}`);
                }
            }
        } catch (err) {
            Notifier.error('Upload error: ' + (err as Error).message);
        } finally {
            isUploading = false;
        }
    }

    function onDownloadClick() {
        showDownloadDialog = true;
    }

    async function confirmDownload() {
        showDownloadDialog = false;
        if (!webdavUrl) { Notifier.error('WebDAV URL is not configured'); return; }
        isDownloading = true;
        const dav = client();
        try {
            if (includeSettings) {
                const res = await dav.get('settings.json');
                if (res.ok) {
                    const entries: Setting[] = JSON.parse(await res.text());
                    await db.settings.clear();
                    await db.settings.bulkPut(entries.map(e => new Setting(e.key, e.value)));
                    Notifier.success('Settings restored');
                } else {
                    Notifier.error(`Download failed for settings.json: ${res.status} ${res.statusText}`);
                }
            }
            if (includeCashierBean) {
                const res = await dav.get('cashier.bean');
                if (res.ok) {
                    await saveFile('cashier.bean', await res.text());
                    Notifier.success('cashier.bean restored');
                } else {
                    Notifier.error(`Download failed for cashier.bean: ${res.status} ${res.statusText}`);
                }
            }
        } catch (err) {
            Notifier.error('Download error: ' + (err as Error).message);
        } finally {
            isDownloading = false;
        }
    }

    function cancelDownload() {
        showDownloadDialog = false;
    }

    const selectedLabels = $derived([
        ...(includeSettings ? ['Settings'] : []),
        ...(includeCashierBean ? ['cashier.bean'] : [])
    ]);
</script>

{#snippet menuItems()}
    <li>
        <a href="/settings/webdav-cfg">
            <SettingsIcon size={16} />
            WebDAV Config
        </a>
    </li>
{/snippet}

<Toolbar title="WebDAV Backup" {menuItems} />

<main class="p-4 flex flex-col gap-6">
    {#if !webdavUrl}
    <section>
        <p>Make sure that you <a href="/settings/webdav-cfg" class="link link-primary">configure</a> your WebDAV connection before backup operations.</p>
    </section>
    {/if}
    <section class="my-4">
        <h2 class="text-lg font-semibold mb-3">Files</h2>
        <div class="flex flex-col gap-3">
            <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeSettings} />
                <span>Settings</span>
            </label>
            <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeCashierBean} />
                <span>cashier.bean</span>
            </label>
        </div>
    </section>

    <section class="flex gap-3">
        <button class="btn btn-primary" disabled={!includeSettings && !includeCashierBean || isUploading} onclick={upload}>
            {#if isUploading}<span class="loading loading-spinner loading-sm"></span>{/if}
            Upload
        </button>
        <button
            class="btn btn-outline btn-error"
            disabled={!includeSettings && !includeCashierBean || isDownloading}
            onclick={onDownloadClick}
        >
            {#if isDownloading}<span class="loading loading-spinner loading-sm"></span>{/if}
            Download
        </button>
    </section>
</main>

<!-- Download confirmation dialog -->
{#if showDownloadDialog}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Confirm Download</h3>
            <p class="py-4">
                The local content of
                <strong>{selectedLabels.join(' and ')}</strong>
                will be overwritten by the remote version. Continue?
            </p>
            <div class="modal-action">
                <button class="btn btn-ghost" onclick={cancelDownload}>Cancel</button>
                <button class="btn btn-warning" onclick={confirmDownload}>Overwrite</button>
            </div>
        </div>
        <div class="modal-backdrop" onclick={cancelDownload}></div>
    </div>
{/if}
