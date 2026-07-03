<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import Toolbar from '$lib/components/Toolbar.svelte';
    import { settings, SettingKeys } from '$lib/settings';
    import { readFile } from '$lib/utils/opfslib';
    import { WebDavClient } from '$lib/utils/webdav';
    import db from '$lib/data/db';
    import { CheckIcon, CopyIcon } from '@lucide/svelte';

    type PreviewSection = { filename: string; content: string };

    let sections = $state<PreviewSection[]>([]);
    let loading = $state(true);
    let error = $state('');
    let source = $state<'local' | 'remote'>('local');
    let copiedIndex = $state<number | null>(null);

    async function copySection(content: string, index: number) {
        await navigator.clipboard.writeText(content);
        copiedIndex = index;
        setTimeout(() => { copiedIndex = null; }, 1500);
    }

    onMount(async () => {
        const params = page.url.searchParams;
        const files = params.getAll('f');
        source = (params.get('source') ?? 'local') as 'local' | 'remote';

        let dav: WebDavClient | null = null;
        if (source === 'remote') {
            const saved = await settings.get<{ url: string; username: string; password: string }>(SettingKeys.webdavSettings);
            if (!saved?.url) { error = 'WebDAV not configured.'; loading = false; return; }
            dav = new WebDavClient(saved.url, saved.username ?? '', saved.password ?? '');
        }

        const result: PreviewSection[] = [];
        try {
            if (files.includes('settings')) {
                let content: string;
                if (source === 'local') {
                    const allSettings = await settings.getAll();
                    content = JSON.stringify(allSettings, null, 2);
                } else {
                    const res = await dav!.get('settings.json');
                    content = res.ok ? await res.text() : `Error ${res.status}: ${res.statusText}`;
                }
                result.push({ filename: 'settings.json', content });
            }
            if (files.includes('bean')) {
                let content: string;
                if (source === 'local') {
                    content = await readFile('cashier.bean') ?? '(file not found)';
                } else {
                    const res = await dav!.get('cashier.bean');
                    content = res.ok ? await res.text() : `Error ${res.status}: ${res.statusText}`;
                }
                result.push({ filename: 'cashier.bean', content });
            }
            if (files.includes('scheduled')) {
                let content: string;
                if (source === 'local') {
                    const all = await db.scheduled.toArray();
                    content = JSON.stringify(all, null, 2);
                } else {
                    const res = await dav!.get('scheduled.json');
                    content = res.ok ? await res.text() : `Error ${res.status}: ${res.statusText}`;
                }
                result.push({ filename: 'scheduled.json', content });
            }
        } catch (err) {
            error = (err as Error).message;
        } finally {
            sections = result;
            loading = false;
        }
    });
</script>

<main class="h-screen flex flex-col overflow-hidden">
    <Toolbar title="Preview — {source === 'local' ? 'Local' : 'Remote'}" />

    <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {#if loading}
            <div class="flex items-center gap-2 text-base-content/60">
                <span class="loading loading-spinner loading-sm"></span>
                Loading…
            </div>
        {:else if error}
            <div class="alert alert-error text-sm">{error}</div>
        {:else}
            {#each sections as section, i}
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <p class="font-mono text-sm font-semibold text-base-content/70 flex-1">{section.filename}</p>
                        <button
                            class="btn btn-ghost btn-xs gap-1"
                            onclick={() => copySection(section.content, i)}
                            title="Copy to clipboard"
                        >
                            {#if copiedIndex === i}
                                <CheckIcon size={14} />
                                Copied
                            {:else}
                                <CopyIcon size={14} />
                                Copy
                            {/if}
                        </button>
                    </div>
                    <pre class="text-xs font-mono leading-5 overflow-x-auto rounded bg-base-200 p-2 select-text whitespace-pre">{section.content}</pre>
                </div>
            {/each}

            {#if sections.length === 0}
                <p class="text-sm text-base-content/50">No files selected.</p>
            {/if}
        {/if}
    </div>
</main>
