<script lang="ts">
	import { CalendarClockIcon } from "lucide-svelte";
	import HomeCardTemplate from "./HomeCardTemplate.svelte";
	import { onMount } from "svelte";
	import { SettingKeys, settings } from "$lib/settings";
	import Notifier from "$lib/utils/notifier";
	import { goto } from "$app/navigation";
	import db from "$lib/data/db";
	import { CloudBackupService } from "$lib/services/cloudBackupService";
	import { BackupType } from "$lib/enums";

    Notifier.init()
    let backupSvc: CloudBackupService

    let totalBackups = $state(0);
    let lastBackup: string = $state('')
    let localXacts = $state(0);

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

        backupSvc = new CloudBackupService(serverUrl)

        totalBackups = await backupSvc.getRemoteBackupCount(BackupType.SCHEDULEDXACTS);

        lastBackup = await backupSvc.getLatestFilename();
        lastBackup = lastBackup === '' ? 'n/a' : lastBackup;

        let localCount = await db.scheduled.count()
        localXacts = localCount
    }

    async function onBackupClick() {
        backupSvc.backupScheduledXacts();

        backupSvc.clearCache()
        
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