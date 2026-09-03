// ─────────────────────────────────────────────────────────────────────────────
// Custom Dropdown — replaces native <select> for dark theme compatibility
// ─────────────────────────────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
}

export interface DropdownConfig {
  id: string;
  placeholder: string;
  options: DropdownOption[];
  value?: string;
  onChange?: (value: string) => void;
}

/**
 * Creates a fully styled custom dropdown that matches the dark glassmorphism theme.
 * Returns the wrapper element and a getValue() helper.
 */
export function createDropdown(config: DropdownConfig): {
  element: HTMLElement;
  getValue: () => string;
  setValue: (v: string) => void;
} {
  const { id, placeholder, options, value = '', onChange } = config;

  let currentValue = value;

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-dropdown';
  wrapper.setAttribute('data-id', id);

  const selectedLabel = value
    ? (options.find((o) => o.value === value)?.label ?? placeholder)
    : placeholder;

  wrapper.innerHTML = /* html */ `
    <button type="button" class="custom-dropdown__trigger" id="${id}"
      aria-haspopup="listbox" aria-expanded="false" aria-label="${placeholder}">
      <span class="custom-dropdown__label ${!value ? 'custom-dropdown__label--placeholder' : ''}"
        id="${id}-label">${selectedLabel}</span>
      <span class="custom-dropdown__arrow">▾</span>
    </button>
    <ul class="custom-dropdown__menu" role="listbox" aria-labelledby="${id}" id="${id}-menu">
      ${options
        .map(
          (opt) => /* html */ `
        <li class="custom-dropdown__item ${opt.value === value ? 'custom-dropdown__item--selected' : ''}"
          role="option" data-value="${opt.value}"
          aria-selected="${opt.value === value}">
          ${opt.label}
        </li>`,
        )
        .join('')}
    </ul>
  `;

  const trigger = wrapper.querySelector<HTMLButtonElement>('.custom-dropdown__trigger')!;
  const menu = wrapper.querySelector<HTMLElement>('.custom-dropdown__menu')!;
  const labelEl = wrapper.querySelector<HTMLElement>('.custom-dropdown__label')!;

  const open = () => {
    wrapper.classList.add('custom-dropdown--open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  const close = () => {
    wrapper.classList.remove('custom-dropdown--open');
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    wrapper.classList.contains('custom-dropdown--open') ? close() : open();
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target as Node)) close();
  });

  // Select an option
  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (!item) return;

    const val = item.dataset.value!;
    const lbl = item.textContent!.trim();

    // Update selected state
    menu.querySelectorAll('.custom-dropdown__item').forEach((el) => {
      el.classList.remove('custom-dropdown__item--selected');
      el.setAttribute('aria-selected', 'false');
    });
    item.classList.add('custom-dropdown__item--selected');
    item.setAttribute('aria-selected', 'true');

    // Update trigger label
    labelEl.textContent = lbl;
    labelEl.classList.remove('custom-dropdown__label--placeholder');

    currentValue = val;
    close();
    onChange?.(val);
  });

  // Keyboard navigation
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  return {
    element: wrapper,
    getValue: () => currentValue,
    setValue: (v: string) => {
      const opt = options.find((o) => o.value === v);
      if (!opt) return;
      currentValue = v;
      labelEl.textContent = opt.label;
      labelEl.classList.remove('custom-dropdown__label--placeholder');
      menu.querySelectorAll<HTMLElement>('[data-value]').forEach((el) => {
        const selected = el.dataset.value === v;
        el.classList.toggle('custom-dropdown__item--selected', selected);
        el.setAttribute('aria-selected', String(selected));
      });
    },
  };
}
