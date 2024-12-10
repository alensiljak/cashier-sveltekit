<script lang="ts">
	import { CalendarClockIcon } from "lucide-svelte";
	import HomeCardTemplate from "./HomeCardTemplate.svelte";
	import { onMount } from "svelte";
	import { SettingKeys, settings } from "$lib/settings";
	import Notifier from "$lib/utils/notifier";
	import { goto } from "$app/navigation";
	import { backupScheduledXacts, getLatestFilename, getRemoteBackupCount } from "$lib/services/cloudBackupService";
	import db from "$lib/data/db";

    Notifier.init()

    let totalBackups;
    let lastBackup: string;
    let localXacts;

    onMount(async () => {
        await loadData()
    })

    async function loadData() {
        const serverUrl = await settings.get(SettingKeys.backupServerUrl)
        if(!serverUrl) {
            Notifier.warn('Backup server URL not set.')
            await goto('/cloud-backup-settings')
            return
        }

        let remoteBackups = await getRemoteBackupCount();
        totalBackups = remoteBackups;

        lastBackup = await getLatestFilename();
        lastBackup = lastBackup === '' ? 'n/a' : lastBackup;

        let localCount = await db.scheduled.count()
        localXacts = localCount
    }

    async function onBackupClick() {
        Notifier.warn('Not implemented')

        backupScheduledXacts();

        // clear cache
        
        await loadData()

        Notifier.success('Scheduled Transactions backup complete')
    }

    async function onRestoreClick() {
        Notifier.warn('Not implemented')
    }
</script>
<HomeCardTemplate>
	{#snippet icon()}
		<CalendarClockIcon />
	{/snippet}
	{#snippet title()}
    Scheduled Transactions
	{/snippet}
	{#snippet content()}
    <p>Total backups: {totalBackups}</p>
    <p>Last backup: {lastBackup}</p>
    <p>Local transactions: {localXacts}</p>
    {/snippet}
    {#snippet footer()}
    <div class="grid grid-cols-2 gap-4 place-items-center">
        <button type="button" class="btn variant-filled-primary" onclick={onBackupClick}>
            Backup</button>
        <button type="button" class="btn variant-filled-tertiary" onclick={onRestoreClick}>
            Restore</button>
    </div>
    {/snippet}
</HomeCardTemplate>