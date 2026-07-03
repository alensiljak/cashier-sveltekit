<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import Toolbar from '$lib/components/Toolbar.svelte';
    import { settings, SettingKeys } from '$lib/settings';
    import { readFile } from '$lib/utils/opfslib';
    import { WebDavClient } from '$lib/utils/webdav';
    import db from '$lib/data/db';
    import { buildDiffLines, type DiffSection } from '$lib/utils/diffText';

    let sections = $state<DiffSection[]>([]);
    let loading = $state(true);
    let error = $state('');

    onMount(async () => {
        const files = page.url.searchParams.getAll('f');
        const saved = await settings.get<{ url: string; username: string; password: string }>(SettingKeys.webdavSettings);
        if (!saved?.url) { error = 'WebDAV not configured.'; loading = false; return; }

        const dav = new WebDavClient(saved.url, saved.username ?? '', saved.password ?? '');
        const result: DiffSection[] = [];

        try {
            if (files.includes('settings')) {
                const allSettings = await settings.getAll();
                const localContent = JSON.stringify(allSettings, null, 2);
                const res = await dav.get('settings.json');
                if (res.ok) {
                    const remoteContent = await res.text();
                    const lines = buildDiffLines(remoteContent, localContent);
                    result.push({ filename: 'settings.json', lines, identical: lines.every(l => l.type === 'context') });
                } else {
                    error = `Cannot fetch remote settings.json: ${res.status} ${res.statusText}`;
                }
            }
            if (files.includes('bean')) {
                const localContent = await readFile('cashier.bean') ?? '';
                const res = await dav.get('cashier.bean');
                if (res.ok) {
                    const remoteContent = await res.text();
                    const lines = buildDiffLines(remoteContent, localContent);
                    result.push({ filename: 'cashier.bean', lines, identical: lines.every(l => l.type === 'context') });
                } else {
                    error = `Cannot fetch remote cashier.bean: ${res.status} ${res.statusText}`;
                }
            }
            if (files.includes('scheduled')) {
                const all = await db.scheduled.toArray();
                const localContent = JSON.stringify(all, null, 2);
                const res = await dav.get('scheduled.json');
                if (res.ok) {
                    const remoteContent = await res.text();
                    const lines = buildDiffLines(remoteContent, localContent);
                    result.push({ filename: 'scheduled.json', lines, identical: lines.every(l => l.type === 'context') });
                } else {
                    error = `Cannot fetch remote scheduled.json: ${res.status} ${res.statusText}`;
                }
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
    <Toolbar title="Diff — Local vs Remote" />

    <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {#if loading}
            <div class="flex items-center gap-2 text-base-content/60">
                <span class="loading loading-spinner loading-sm"></span>
                Loading…
            </div>
        {:else if error}
            <div class="alert alert-error text-sm">{error}</div>
        {:else}
            <div class="flex gap-4 text-xs text-base-content/60">
                <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm bg-success/40"></span>local only</span>
                <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm bg-error/40"></span>remote only</span>
            </div>

            {#each sections as section}
                <div>
                    <p class="font-mono text-sm font-semibold mb-1 text-base-content/70">{section.filename}</p>
                    {#if section.identical}
                        <p class="text-sm text-success">Files are identical.</p>
                    {:else}
                        <pre class="text-xs font-mono leading-5 overflow-x-auto rounded bg-base-200 p-2 select-text">{#each section.lines as line}{#if line.type === 'removed'}<span class="block bg-error/20 text-error-content whitespace-pre">- {line.content}</span>{:else if line.type === 'added'}<span class="block bg-success/20 text-success-content whitespace-pre">+ {line.content}</span>{:else}<span class="block text-base-content/50 whitespace-pre">  {line.content}</span>{/if}{/each}</pre>
                    {/if}
                </div>
            {/each}

            {#if sections.length === 0 && !error}
                <p class="text-sm text-base-content/50">No files selected.</p>
            {/if}
        {/if}
    </div>
</main>
