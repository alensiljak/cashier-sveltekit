<script lang="ts">
    /**
     * @type {{
     *   todo_list: ReturnType<typeof import("./TodoListExample.svelte").create_todo_list>
     *   type: "done" | "todo"
     * }}
     */
    const { todo_list, type } = $props()
    
    const handle_dragenter = () => {
        todo_list.enter_drag(
            todo_list.$items[type].length,
            type
        )
    }
    </script>
    
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div style="user-select:none; width:6em; outline:.1em dashed; text-align:center; font-size:2em; opacity:.75em; cursor:pointer;"
            ondragenter={handle_dragenter}>
        Drag here!
    </div>