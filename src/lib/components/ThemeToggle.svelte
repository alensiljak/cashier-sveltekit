<script lang="ts">
  import { themeStore, toggleTheme } from '$lib/stores/themeStore';
  import { MoonIcon, SunIcon } from '@lucide/svelte';
  import { onMount } from 'svelte';

  let currentTheme: string = $state('');

  onMount(() => {
    const unsubscribe = themeStore.subscribe(value => {
      currentTheme = value;
    });
    
    return () => unsubscribe();
  });

  function toggleCurrentTheme() {
    toggleTheme();
  }
</script>

<button 
  class="btn btn-ghost btn-circle" 
  onclick={toggleCurrentTheme}
  aria-label="Toggle theme"
>
  {#if currentTheme.includes('dark')}
    <SunIcon size={20} />
  {:else}
    <MoonIcon size={20} />
  {/if}
</button>