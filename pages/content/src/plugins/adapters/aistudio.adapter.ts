import { BaseAdapterPlugin } from './base.adapter';
import type { AdapterCapability, PluginContext } from '../plugin-types';
import { waitForElement } from '@src/utils/dom';
import { logMessage } from '@src/utils/helpers';

const SYSTEM_INSTRUCTIONS_SELECTORS = {
  button: '[aria-label="System instructions"]',
  textarea: 'ms-system-instructions textarea.textarea',
};

export class AIStudioAdapter extends BaseAdapterPlugin {
  readonly name = 'AIStudioAdapter';
  readonly version = '2.0.0';
  readonly hostnames = ['aistudio.google.com'];
  readonly capabilities: AdapterCapability[] = [
    'text-insertion',
    'form-submission',
    'file-attachment',
    'dom-manipulation'
  ];
  
  async activate(): Promise<void> {
    if (this.currentStatus === 'active') {
      this.context?.logger.warn(`AI Studio adapter instance already active, skipping re-activation`);
      return;
    }

    await super.activate();
    this.context.logger.debug(`Activating AI Studio adapter...`);

    // Auto-set system instructions
    this.trySetSystemInstructions();

    this.context.eventBus.emit('adapter:activated', {
      pluginName: this.name,
      timestamp: Date.now()
    });
  }

  private findChatInputElement(): HTMLTextAreaElement | null {
    let chatInput = document.querySelector('textarea.textarea[placeholder="Type something"]');
    if (chatInput) return chatInput as HTMLTextAreaElement;
    
    chatInput = document.querySelector('textarea.textarea[aria-label="Type something or pick one from prompt gallery"]');
    if (chatInput) return chatInput as HTMLTextAreaElement;

    chatInput = document.querySelector("textarea.textarea[aria-label='Type something or tab to choose an example prompt']");
    if (chatInput) return chatInput as HTMLTextAreaElement;

    chatInput = document.querySelector("textarea.textarea[aria-label='Start typing a prompt']");
    if (chatInput) return chatInput as HTMLTextAreaElement;
    
    return null;
  }

  async insertText(text: string): Promise<boolean> {
    const chatInput = this.findChatInputElement();
    if (!chatInput) {
      this.context.logger.error('Could not find AI Studio chat input element');
      this.emitExecutionFailed('insertText', 'Chat input element not found');
      return false;
    }

    try {
      const currentText = chatInput.value;
      const formattedText = currentText ? `${currentText}\n\n${text}` : text;
      chatInput.value = formattedText;
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      chatInput.focus();
      this.emitExecutionCompleted('insertText', { text }, { success: true });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`Error inserting text: ${errorMessage}`);
      this.emitExecutionFailed('insertText', errorMessage);
      return false;
    }
  }

  async submitForm(): Promise<boolean> {
    const submitButton = document.querySelector('button[aria-label="Submit"]') as HTMLButtonElement;
    if (submitButton && !submitButton.disabled) {
      submitButton.click();
      this.emitExecutionCompleted('submitForm', {}, { success: true });
      return true;
    }
    this.emitExecutionFailed('submitForm', 'Submit button not found or disabled');
    return false;
  }

  async attachFile(file: File): Promise<boolean> {
    // AI Studio file attachment logic here
    this.context.logger.warn('attachFile not yet implemented for AIStudioAdapter.');
    return false;
  }

  isSupported(): boolean {
    return window.location.hostname.includes('aistudio.google.com');
  }

  private async trySetSystemInstructions(): Promise<void> {
    if (!this.context) return;
    
    const uiState = this.context.stores.ui?.();
    const { aistudioSystemInstructionsEnabled, aistudioSystemInstructions } = uiState?.preferences || {};

    if (!aistudioSystemInstructionsEnabled || !aistudioSystemInstructions) {
      this.context.logger.debug('Auto-set system instructions is disabled or instructions are empty.');
      return;
    }

    this.context.logger.debug('Attempting to set system instructions...');
    try {
      const button = await waitForElement(SYSTEM_INSTRUCTIONS_SELECTORS.button, 10000);
      if (!button) {
        this.context.logger.warn('System instructions button not found.');
        return;
      }

      this.context.logger.debug('Opening system instructions panel...');
      button.click();

      const textarea = (await waitForElement(
        SYSTEM_INSTRUCTIONS_SELECTORS.textarea,
        5000,
      )) as HTMLTextAreaElement | null;
      if (!textarea) {
        this.context.logger.warn('System instructions textarea not found after opening panel.');
        button.click(); // Attempt to close
        return;
      }

      if (textarea.value === aistudioSystemInstructions) {
        this.context.logger.debug('System instructions already set.');
        button.click();
        return;
      }

      this.context.logger.debug('Setting new system instructions...');
      textarea.value = aistudioSystemInstructions;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      this.context.logger.info('System instructions successfully set.');

      setTimeout(() => {
        this.context.logger.debug('Closing system instructions panel...');
        button.click();
      }, 200);

    } catch (error) {
      this.context.logger.error('Failed to set system instructions.', error);
    }
  }

  private emitExecutionCompleted(toolName: string, parameters: any, result: any) {
    this.context.eventBus.emit('tool:execution-completed', {
      execution: {
        id: this.generateCallId(), toolName, parameters, result,
        timestamp: Date.now(), status: 'success'
      }
    });
  }

  private emitExecutionFailed(toolName: string, error: string) {
    this.context.eventBus.emit('tool:execution-failed', {
      toolName, error, callId: this.generateCallId()
    });
  }

  private generateCallId(): string {
    return `aistudio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}