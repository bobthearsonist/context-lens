<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { pasteRequest } from '@/api'
import { useSessionStore } from '@/stores/session'
import { trackEvent } from '@/utils/analytics'

const emit = defineEmits<{ close: [] }>()

const store = useSessionStore()
const text = ref('')
const error = ref('')
const loading = ref(false)
const textareaEl = ref<HTMLTextAreaElement>()

onMounted(() => {
  textareaEl.value?.focus()
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

async function submit() {
  const raw = text.value.trim()
  if (!raw) return
  error.value = ''
  loading.value = true
  try {
    const { conversationId } = await pasteRequest(raw)
    trackEvent('paste')
    if (conversationId) {
      await store.loadConversationEntries(conversationId)
      store.selectSession(conversationId)
      store.setView('inspector')
    }
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="modal-backdrop" @click="onBackdropClick">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="paste-title">
      <div class="modal-header">
        <span id="paste-title" class="modal-title">Paste request</span>
        <button class="modal-close" aria-label="Close" @click="emit('close')">
          <i class="i-carbon-close" />
        </button>
      </div>

      <div class="modal-body">
        <p class="modal-hint">
          Paste a raw Anthropic or OpenAI request body (JSON). The full
          composition breakdown will appear as a new session.
        </p>
        <textarea
          ref="textareaEl"
          v-model="text"
          class="paste-textarea"
          placeholder='{ "model": "claude-sonnet-4-...", "messages": [...] }'
          spellcheck="false"
          autocomplete="off"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
        <p v-if="error" class="paste-error">{{ error }}</p>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="emit('close')">Cancel</button>
        <button
          class="btn-primary"
          :disabled="!text.trim() || loading"
          @click="submit"
        >
          <i v-if="loading" class="i-carbon-circle-dash spin" />
          <i v-else class="i-carbon-analytics" />
          {{ loading ? 'Analyzing…' : 'Analyze' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/mixins' as *;

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(2px);
}

.modal {
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: min(640px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 64px);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}

.modal-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  font-size: 16px;
  transition: color 0.1s;

  &:hover { color: var(--text-secondary); }
  &:focus-visible { @include focus-ring; }
}

.modal-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.modal-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.paste-textarea {
  width: 100%;
  min-height: 260px;
  flex: 1;
  background: var(--bg-base);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  padding: 10px 12px;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: var(--text-ghost); }

  &:focus {
    outline: none;
    border-color: var(--accent-blue);
  }
}

.paste-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--accent-red);
  font-family: var(--font-mono);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-dim);
}

.btn-secondary {
  font-size: var(--text-xs);
  padding: 5px 12px;
  background: none;
  border: 1px solid var(--border-dim);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s;

  &:hover {
    border-color: var(--border-mid);
    color: var(--text-primary);
  }

  &:focus-visible { @include focus-ring; }
}

.btn-primary {
  font-size: var(--text-xs);
  padding: 5px 14px;
  background: var(--accent-blue);
  border: 1px solid var(--accent-blue);
  border-radius: var(--radius-sm);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: opacity 0.1s;

  &:hover:not(:disabled) { opacity: 0.88; }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &:focus-visible { @include focus-ring; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spin {
  display: inline-block;
  animation: spin 0.7s linear infinite;
}
</style>
