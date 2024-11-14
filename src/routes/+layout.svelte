<script>
import { initializeStores, Drawer } from '@skeletonlabs/skeleton';
import { getDrawerStore } from "@skeletonlabs/skeleton";
import '../app.css';

initializeStores();
const drawerStore = getDrawerStore();

drawerStore.open();
// drawerStore.close();
</script>

<Drawer width="w-[300px]">
	Cashier
</Drawer>

<slot></slot>
