<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getAnalyticsConsent, setAnalyticsConsent, initAnalytics, trackPage } from '@/utils/analytics'

const visible = ref(false)

onMounted(() => {
  visible.value = getAnalyticsConsent() === null
})

function accept() {
  setAnalyticsConsent('granted')
  initAnalytics()
  trackPage('dashboard')
  visible.value = false
}

function decline() {
  setAnalyticsConsent('denied')
  visible.value = false
}
</script>

<template>
  <Transition name="consent-slide">
    <div v-if="visible" class="consent-banner">
      <div class="consent-content">
        <span class="consent-text">
          <strong>Help improve Context Lens?</strong>
          Anonymous page view stats only — never prompts, sessions, or API keys.
        </span>
        <div class="consent-actions">
          <button class="consent-btn consent-btn--accept" @click="accept">Sure</button>
          <button class="consent-btn consent-btn--decline" @click="decline">No thanks</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.consent-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-mid);
  padding: var(--space-3) var(--space-4);
}

.consent-content {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.consent-text {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.4;
  min-width: 200px;

  strong {
    color: var(--text-primary);
    font-weight: 500;
  }
}

.consent-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.consent-btn {
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-mid);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;

  &--accept {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
    color: #fff;

    &:hover {
      background: #0c93d0;
    }
  }

  &--decline {
    background: transparent;
    color: var(--text-dim);

    &:hover {
      background: var(--bg-hover);
      color: var(--text-secondary);
    }
  }
}

// Slide up from bottom
.consent-slide-enter-active {
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              opacity 0.2s ease;
}
.consent-slide-leave-active {
  transition: transform 0.2s ease,
              opacity 0.15s ease;
}
.consent-slide-enter-from {
  transform: translateY(100%);
  opacity: 0;
}
.consent-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
