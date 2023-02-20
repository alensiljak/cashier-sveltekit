<nav>
    <button on:click={toggleSidebar} >Sidebar</button>

    Toolbar
</nav>

<script lang="ts">
	import { drawerVisible } from '$lib/store';

    function toggleSidebar() {
        let visible = $drawerVisible
        console.log('visible:', visible)

        drawerVisible.set(!visible)
    }
</script>