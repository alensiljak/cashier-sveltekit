<script lang="ts">
    /**
     * @type {{
     *   duration?: number
     *   index: number
     *   set_drag_element: (clientX: number, clientY: number, drag: HTMLElement) => void
     *   todo_list: ReturnType<typeof import("../TodoListExample.svelte").create_todo_list>
     *   type: "done" | "todo"
     * }}
     */
    const {
        duration = 400,
        index,
        set_drag_element,
        todo_list,
        type
    } = $props()
    
    import Dragable from "$lib/components/Dragable.svelte"
    
    const is_dragging = $derived(
        todo_list.$is_dragging
        && todo_list.$start_index === index
        && todo_list.$drag_type === type
    )
    const transform = $derived(
        todo_list.$is_dragging && todo_list.$drag_type === type
            ? todo_list.$start_index == index
                ? todo_list.$transform.reduce((p: any, c: any) => c ? p - c : p, 0)
                : todo_list.$transform[index]
            : 0
    )
    
    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    const handle_click = (event: MouseEvent): void => {
        alert(
            /** @type {HTMLElement} */(event.target as HTMLElement)/**/?.textContent
        )
    }
    const handle_dragenter = () => {
        todo_list.enter_drag(index, type)
    }
    const handle_dragstart = () => todo_list.start_drag(index, type)
    </script>
    
    <Dragable delay={300}
            ondragstart={handle_dragstart}
            setDragElement={set_drag_element}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div bind:offsetHeight={todo_list.heights[type][index]}
                style="border-radius:.5em; width:6em; outline:.1em solid; text-align:center; font-size:2em; cursor:pointer; transform:translateY({transform}px);
                {todo_list.$is_dragging && todo_list.$drag_type == type && `transition:${duration}ms`};
                {is_dragging && "opacity:.2; outline:.2em solid #aaa"};
                {!todo_list.$items[type][index] && "display:none"};"
                onclick={handle_click}
                ondragenter={handle_dragenter}>
            {todo_list.$items[type][index]}
        </div>
        <div slot="drag" style="width:5em; text-align:center; font-size:2.5em; cursor:move; color:#000;">
            {todo_list.$items[type][index] + "!!"}
        </div>
    </Dragable>