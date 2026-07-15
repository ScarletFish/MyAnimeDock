<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="'0 0 24 24'"
    :fill="isFilled ? color : 'none'"
    :stroke="isStroked ? color : 'none'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="className"
    @click="$emit('click')"
  >
    <template v-for="(path, index) in paths" :key="index">
      <path :d="path" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  color: 'currentColor',
  className: '',
});

defineEmits<{
  click: [];
}>();

// 图标路径数据映射表
const iconDataMap: Record<string, { d: string; fill?: boolean; stroke?: boolean }> = {
  home: {
    d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
    stroke: true,
  },
  search: {
    d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    stroke: true,
  },
  settings: {
    d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    stroke: true,
  },
  user: {
    d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    stroke: true,
  },
  cart: {
    d: 'M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6 M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    stroke: true,
  },
  message: {
    d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    stroke: true,
  },
  heart: {
    d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
    stroke: true,
  },
  bell: {
    d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
    stroke: true,
  },
  close: {
    d: 'M18 6L6 18 M6 6l12 12',
    stroke: true,
  },
  plus: {
    d: 'M12 5v14 M5 12h14',
    stroke: true,
  },
  arrowLeft: {
    d: 'M19 12H5 M12 19l-7-7 7-7',
    stroke: true,
  },
  more: {
    d: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    stroke: true,
  },
};

const iconData = computed(() => iconDataMap[props.name]);
const isFilled = computed(() => iconData.value?.fill ?? false);
const isStroked = computed(() => iconData.value?.stroke ?? true);
const paths = computed(() => {
  if (!iconData.value) return [];
  return iconData.value.d.split(' M').map((p, i) => (i === 0 ? p : `M${p}`));
});
</script>
