import type { SyncStatus } from '../types';
import { STATUS_LABELS } from '../types';

/**
 * Render a sync status chip element.
 */
export function createStatusChip(status: SyncStatus): HTMLElement {
  const span = document.createElement('span');
  const classMap: Record<SyncStatus, string> = {
    draft: 'chip--draft',
    pending_sync: 'chip--pending',
    synced: 'chip--synced',
    error: 'chip--error',
  };
  span.className = `chip ${classMap[status]}`;
  span.textContent = STATUS_LABELS[status];
  return span;
}

/**
 * Update an existing chip element in place (avoids DOM thrash on list re-render).
 */
export function updateStatusChip(chip: HTMLElement, status: SyncStatus): void {
  chip.className = `chip chip--${status === 'pending_sync' ? 'pending' : status}`;
  chip.textContent = STATUS_LABELS[status];
}
