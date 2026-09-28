<template>
  <div class="relative">
    <button
      class=" text-gray-700  dark:border-neutral-800  dark:text-white"
      @click="isOpen = true"
    >
      <IconoirSettings class="size-4 text-soft-900 hover:text-black dark:text-white dark:hover:text-white" />
    </button>

    <TransitionRoot
      as="template"
      :show="isOpen"
    >
      <Dialog
        class="relative z-10"
        @close="isOpen = false"
      >
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-gray-500/75 transition-opacity dark:bg-black/75" />
        </TransitionChild>
        <div class="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <TransitionChild
              as="template"
              enter="ease-out duration-300"
              enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enter-to="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leave-from="opacity-100 translate-y-0 sm:scale-100"
              leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel class="relative overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all dark:bg-black sm:my-8 sm:w-full sm:max-w-sm">
                <div class="px-4 pb-5 pt-5 sm:p-6">
                  <DialogTitle
                    as="h3"
                    class="text-base font-semibold leading-6 text-black dark:text-white"
                  >
                    Settings
                  </DialogTitle>

                  <div class="mt-5 flex flex-col gap-5">
                    <RadioGroup v-model="mode">
                      <RadioGroupLabel class="text-xs font-medium text-gray-500 dark:text-neutral-400">
                        Theme
                      </RadioGroupLabel>
                      <div class="mt-2 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-neutral-900">
                        <RadioGroupOption
                          v-for="option in themeOptions"
                          v-slot="{ checked }"
                          :key="option.value"
                          :value="option.value"
                          class="flex-1"
                        >
                          <div
                            class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors"
                            :class="checked
                              ? 'bg-white text-black shadow-sm dark:bg-neutral-700 dark:text-white'
                              : 'text-gray-500 hover:text-black dark:text-neutral-400 dark:hover:text-white'"
                          >
                            <component
                              :is="option.icon"
                              class="size-3.5"
                            />
                            {{ option.label }}
                          </div>
                        </RadioGroupOption>
                      </div>
                    </RadioGroup>

                    <RadioGroup v-model="fontSize">
                      <RadioGroupLabel class="text-xs font-medium text-gray-500 dark:text-neutral-400">
                        Font size
                      </RadioGroupLabel>
                      <div class="mt-2 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-neutral-900">
                        <RadioGroupOption
                          v-for="option in FONT_SIZES"
                          v-slot="{ checked }"
                          :key="option.value"
                          :value="option.value"
                          class="flex-1"
                        >
                          <div
                            class="cursor-pointer rounded-md py-1.5 text-center text-xs transition-colors"
                            :class="checked
                              ? 'bg-white text-black shadow-sm dark:bg-neutral-700 dark:text-white'
                              : 'text-gray-500 hover:text-black dark:text-neutral-400 dark:hover:text-white'"
                          >
                            {{ option.label }}
                          </div>
                        </RadioGroupOption>
                      </div>
                    </RadioGroup>

                    <RadioGroup v-model="deleteConfirmationChoice">
                      <RadioGroupLabel class="text-xs font-medium text-gray-500 dark:text-neutral-400">
                        Delete bookmark confirmation
                      </RadioGroupLabel>
                      <div class="mt-2 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-neutral-900">
                        <RadioGroupOption
                          v-for="option in deleteConfirmationOptions"
                          v-slot="{ checked }"
                          :key="option.value"
                          :value="option.value"
                          class="flex-1"
                        >
                          <div
                            class="cursor-pointer rounded-md py-1.5 text-center text-xs transition-colors"
                            :class="checked
                              ? 'bg-white text-black shadow-sm dark:bg-neutral-700 dark:text-white'
                              : 'text-gray-500 hover:text-black dark:text-neutral-400 dark:hover:text-white'"
                          >
                            {{ option.label }}
                          </div>
                        </RadioGroupOption>
                      </div>
                    </RadioGroup>

                    <BackupPanel />
                  </div>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue';
import {
  Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot,
  RadioGroup, RadioGroupOption, RadioGroupLabel,
} from '@headlessui/vue';
import {
  FONT_SIZES, fontSize, skipDeleteConfirmation, mode,
} from '@/composables/useAppSettings';
import BackupPanel from '@/ext/browser/components/BackupPanel.vue';
import IconoirSettings from '~icons/iconoir/settings?width=24px&height=24px';
import IconoirHalfMoon from '~icons/iconoir/half-moon?width=24px&height=24px';
import IconoirSunLight from '~icons/iconoir/sun-light?width=24px&height=24px';
import IconoirComputer from '~icons/iconoir/computer?width=24px&height=24px';

const isOpen = ref(false);

const deleteConfirmationChoice = computed({
  get: () => (skipDeleteConfirmation.value ? 'skip' : 'ask'),
  set: (value) => { skipDeleteConfirmation.value = value === 'skip'; },
});

const themeOptions = [
  { value: 'light', label: 'Light', icon: IconoirSunLight },
  { value: 'dark', label: 'Dark', icon: IconoirHalfMoon },
  { value: 'auto', label: 'System', icon: IconoirComputer },
];

const deleteConfirmationOptions = [
  { value: 'ask', label: 'Ask' },
  { value: 'skip', label: "Don't ask" },
];

</script>
