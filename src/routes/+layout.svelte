<p>This is the layout</p>

<!-- Drawer / Sidebark -->
<nav class="drawer-container">
    <!-- bind:is_drawer_open -->
    <Drawer variant="dismissible">
        <Header>
            <Title>Super Drawer</Title>
            <Subtitle>It's the best drawer.</Subtitle>
          </Header>
    </Drawer>
</nav>

<slot></slot>

<script lang="ts">
    import Drawer, { Header, Title, Subtitle } from '@smui/drawer';
    import { drawerVisible } from '../store/store';
    
    let is_drawer_open = true; // drawerVisible

    drawerVisible.subscribe((value) => is_drawer_open = value);

</script>