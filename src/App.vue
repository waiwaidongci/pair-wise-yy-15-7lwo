<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppIcon,
  CollectionIcon,
  Edit1Icon,
  FileExportIcon,
  PrintIcon,
} from 'tdesign-icons-vue-next'
import { useBatchStore } from './stores/batchStore'

// 尽早激活批次仓库，使“模板变更 → 未开打批次失效”的监听在任何页面都生效。
useBatchStore()

const route = useRoute()
const router = useRouter()
const navItems = [
  { path: '/layout', label: '版面编辑', icon: Edit1Icon },
  { path: '/specimens', label: '清单校验', icon: CollectionIcon },
  { path: '/print', label: '打印预览', icon: PrintIcon },
  { path: '/templates', label: '模板库', icon: FileExportIcon },
]
const activePath = computed(() => navItems.find((item) => route.path.startsWith(item.path))?.path ?? '/layout')
</script>

<template>
  <div class="app-shell">
    <aside class="app-sider">
      <div class="brand">
        <div class="brand__mark">签</div>
        <div>
          <strong>标签工坊</strong>
          <span>SPECIMEN LABEL STUDIO</span>
        </div>
      </div>
      <nav class="app-nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ 'nav-item--active': activePath === item.path }"
          type="button"
          @click="router.push(item.path)"
        >
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="station-card">
        <AppIcon />
        <div>
          <strong>西南昆虫标本馆</strong>
          <span>标签任务 #2026-041</span>
        </div>
      </div>
      <div class="sider-footer">
        <span>物理单位 mm</span>
        <span>本地存储</span>
      </div>
    </aside>
    <div class="app-workspace">
      <header class="app-header">
        <div>
          <span>馆藏数字化工作台</span>
          <strong>{{ navItems.find((item) => item.path === activePath)?.label }}</strong>
        </div>
        <div class="header-status">
          <i />
          当前模板与打印预览实时同步
        </div>
      </header>
      <main class="app-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
