<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

// A text field that commits on change (blur/Enter) like a plain
// :value/@change binding, but survives re-renders while focused: Vue
// force-syncs a bound :value onto the DOM element on every patch, so any
// version bump or ticker firing mid-typing silently wiped the half-typed
// text. While the field has focus its local draft is authoritative;
// external values apply once focus leaves.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
    value: string;
    multiline?: boolean;
}>();

const emit = defineEmits<{ commit: [value: string] }>();

const draft = ref(props.value);
const focused = ref(false);

watch(() => props.value, (value) => {
    if (!focused.value) {
        draft.value = value;
    }
});

function onBlur(): void {
    focused.value = false;
    // The change event (commit) fires before blur; re-sync after the parent
    // has re-rendered so a rejected commit snaps back to the stored value.
    void nextTick(() => {
        if (!focused.value) {
            draft.value = props.value;
        }
    });
}
</script>

<template>
    <textarea
        v-if="multiline"
        v-bind="$attrs"
        v-model="draft"
        @focus="focused = true"
        @blur="onBlur()"
        @change="emit('commit', draft)"
    ></textarea>
    <input
        v-else
        v-bind="$attrs"
        v-model="draft"
        type="text"
        @focus="focused = true"
        @blur="onBlur()"
        @change="emit('commit', draft)"
    >
</template>
